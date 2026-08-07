// ── 游戏状态/压缩索引/压缩处理/任务扫描/健康检查/关闭服务/立绘资产/模型发现 路由（从 server.js 整区搬迁） ──
// 依赖注入 ctx = { fs, path, RULER_DIR, RUNTIME_ROOT, cleanRuleName, readTextFileSmart, htmlToMarkdownDocument, htmlTitle, migrateAllCharacterAssets, migrateCharacterAssets, characterDir, appConfig, isNameTaken, loadAdventureMeta, cleanApiUrl, DEFAULT_PROVIDER_ENDPOINTS, resolveApiKey }
module.exports = function registerMiscRoutes(app, ctx) {
  const { fs, path, RULER_DIR, RUNTIME_ROOT, cleanRuleName, readTextFileSmart, htmlToMarkdownDocument, htmlTitle, migrateAllCharacterAssets, migrateCharacterAssets, characterDir, appConfig, isNameTaken, loadAdventureMeta, cleanApiUrl, DEFAULT_PROVIDER_ENDPOINTS, resolveApiKey } = ctx;

// ── API: 游戏状态获取（供AI上下文使用） ──────────────

app.get('/api/game/status', (req, res) => {
  res.json({
    message: '游戏状态由前端维护，请通过WebSocket或前端API获取',
    hint: '前端将游戏状态注入AI对话上下文'
  });
});

// ── API: 压缩索引（规则书搜索用） ────────────────────

/**
 * 获取规则系统的压缩索引（结构化条目JSON）
 */
app.get('/api/rules/index', (req, res) => {
  const { system, q } = req.query;
  if (!system) return res.status(400).json({ error: '请指定系统名称' });

  const systemDir = path.join(RULER_DIR, system);
  if (!fs.existsSync(systemDir)) return res.status(404).json({ error: '系统目录不存在' });

  // 优先读取 _index.json
  const indexFile = path.join(systemDir, '_index.json');
  if (fs.existsSync(indexFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      // 带 q 时查询完整索引，不受默认前150条展示限制。
      // 同时合并 compressed/rule_index.json 的 HTML 层级索引；否则职业页等真实 sourceFile 路径
      // 只存在于 rule_index.json 时，插件用“玩家手册2024/角色职业/圣武士/圣武士.htm”等精确路径会查不到。
      if (String(q || '').trim() && Array.isArray(data.entries)) {
        const terms = String(q).toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 80));
        const matchEntry = entry => {
          const text = [entry.title, entry.content, entry.sourceFile, entry.category]
            .map(value => String(value || '').toLocaleLowerCase()).join(' ');
          return terms.some(term => text.includes(term));
        };
        const htmlItems = [];
        const ruleIndexPath = path.join(systemDir, 'compressed', 'rule_index.json');
        if (fs.existsSync(ruleIndexPath)) {
          try {
            const ruleIndex = JSON.parse(fs.readFileSync(ruleIndexPath, 'utf8'));
            const excludedSet = new Set(Array.isArray(ruleIndex.excluded) ? ruleIndex.excluded : []);
            for (const file of (Array.isArray(ruleIndex.files) ? ruleIndex.files : [])) {
              if (!file || excludedSet.has(file.rel)) continue;
              const entry = {
                id: 'source-' + htmlItems.length,
                title: file.title || file.rel,
                category: String(file.rel || '').includes('/') ? String(file.rel).split('/')[0] : '规则正文',
                content: '',
                sourceFile: file.rel
              };
              if (matchEntry(entry)) htmlItems.push(entry);
            }
          } catch (e) { /* rule_index.json 损坏时只使用 _index.json */ }
        }
        const seen = new Set();
        const items = [];
        for (const entry of [...htmlItems, ...data.entries.filter(matchEntry)]) {
          const key = [entry.title, entry.sourceFile, entry.category].map(v => String(v || '')).join('\u0001');
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(entry);
          if (items.length >= limit) break;
        }
        return res.json({ system: data.system || system, items, total: items.length, query: String(q) });
      }
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: '索引文件损坏' });
    }
  }

  // 回退：扫描compressed/目录下的所有md文件，提取结构
  const compressedDir = path.join(systemDir, 'compressed');
  const entries = [];
  const sourceDir = path.join(systemDir, 'source');

  // 优先使用Agent生成的HTML层级索引（规范整理后的规则书资产）
  const ruleIndexPath = path.join(compressedDir, 'rule_index.json');
  if (fs.existsSync(ruleIndexPath)) {
    try {
      const ruleIndex = JSON.parse(fs.readFileSync(ruleIndexPath, 'utf8'));
      const excludedSet = new Set(Array.isArray(ruleIndex.excluded) ? ruleIndex.excluded : []);
      const files = (Array.isArray(ruleIndex.files) ? ruleIndex.files : []).filter(f => !excludedSet.has(f.rel));
      // 最多取前150个正文页生成搜索条目（HTML本地转文本，不耗AI token）
      const limited = files.slice(0, 150);
      for (const file of limited) {
        try {
          const fullPath = path.join(sourceDir, file.rel);
          if (!fs.existsSync(fullPath)) continue;
          const text = htmlToMarkdownDocument(readTextFileSmart(fullPath), file.title || '')
            .replace(/\s{3,}/g, ' ')
            .slice(0, 3000);
          entries.push({
            id: 'html-' + entries.length,
            title: file.title || file.rel,
            category: file.rel.includes('/') ? file.rel.split('/')[0] : '规则正文',
            content: text,
            sourceFile: file.rel
          });
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* 索引损坏则走md回退 */ }
  }

  // 从compressed MD文件中提取条目（兼容旧拆解产物）
  if (fs.existsSync(compressedDir)) {
    const files = fs.readdirSync(compressedDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const md = fs.readFileSync(path.join(compressedDir, file), 'utf8');
        const parsed = parseMdToEntries(md, file, sourceDir);
        entries.push(...parsed);
      } catch (e) { /* skip */ }
    }
  }

  // 同时扫描source目录的原始文本（兼容旧txt/md拆解产物）
  if (fs.existsSync(sourceDir)) {
    const srcFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
    for (const file of srcFiles) {
      if (!entries.some(e => e.sourceFile === file)) {
        try {
          const text = fs.readFileSync(path.join(sourceDir, file), 'utf8');
          const parsed = extractStructuredServer(text, file);
          entries.push(...parsed);
        } catch (e) { /* skip */ }
      }
    }
  }

  const result = {
    system,
    entries,
    entryCount: entries.length,
    generatedAt: new Date().toISOString()
  };

  // 缓存索引
  try {
    fs.writeFileSync(indexFile, JSON.stringify(result, null, 2), 'utf8');
  } catch (e) { /* ignore */ }

  res.json(result);
});

/**
 * 从MD表格提取结构化条目
 */
function parseMdToEntries(md, sourceName, sourceDir) {
  const entries = [];
  const lines = md.split('\n');
  let entryId = 0;

  // 尝试解析表格
  let tableMode = false;
  let tableHeaders = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 检测表格
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      if (!tableMode && cells.length >= 2) {
        tableHeaders = cells;
        tableMode = true;
        continue;
      }
      if (line.includes('---')) continue;

      if (tableMode && cells.length >= 2) {
        const entry = {
          id: `t_${sourceName}_${entryId++}`,
          title: cells[0] || '',
          category: cells[1] ? cells[1].replace(/[*_]/g, '') : inferCategoryServer(cells[0]),
          keywords: extractKeywordsServer(cells[0] + ' ' + (cells[2] || '')),
          summary: cells.slice(2).join(' | ').substring(0, 300),
          sourceFile: sourceName
        };
        entries.push(entry);
      }
    } else if (line.startsWith('## ')) {
      tableMode = false;
    }
  }

  // 如果没有表格，按段落解析
  if (entries.length === 0) {
    const paragraphs = md.split(/\n\n+/).filter(p => p.trim().length > 20);
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].trim();
      const titleLine = para.split('\n')[0].replace(/^#+\s*/, '');
      entries.push({
        id: `p_${sourceName}_${i}`,
        title: titleLine.substring(0, 80),
        category: inferCategoryServer(titleLine),
        keywords: extractKeywordsServer(para.substring(0, 200)),
        summary: para.substring(0, 300).replace(/\n/g, ' '),
        sourceFile: sourceName
      });
    }
  }

  return entries;
}

function inferCategoryServer(text) {
  const lower = text.toLowerCase();
  if (/职业|class/i.test(lower)) return '职业';
  if (/法术|spell|魔法/i.test(lower)) return '法术';
  if (/装备|武器|防具|weapon|armor/i.test(lower)) return '装备';
  if (/怪物|monster/i.test(lower)) return '怪物';
  if (/技能|专长|feat|skill/i.test(lower)) return '技能';
  if (/种族|race/i.test(lower)) return '种族';
  if (/规则|判定|豁免|攻击骰|伤害骰/i.test(lower)) return '规则';
  if (/状态|condition/i.test(lower)) return '状态';
  return '其他';
}

function extractKeywordsServer(text) {
  const words = text.match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || [];
  const stopWords = new Set(['可以','使用','一个','进行','需要','所有','这个','如果','或者','并且','不会','不是','没有']);
  const unique = [...new Set(words.filter(w => !stopWords.has(w)))];
  return unique.slice(0, 8);
}

function extractStructuredServer(text, sourceName) {
  const entries = [];
  const lines = text.split('\n');
  let currentTitle = '';
  let currentText = [];
  let entryId = 0;

  for (const line of lines) {
    const hMatch = line.match(/^#{1,3}\s+(.+)/);
    if (hMatch) {
      if (currentText.length > 2) {
        const combined = currentText.join(' ');
        entries.push({
          id: `s_${sourceName}_${entryId++}`,
          title: currentTitle.substring(0, 80),
          category: inferCategoryServer(currentTitle),
          keywords: extractKeywordsServer(currentTitle + ' ' + combined.substring(0, 100)),
          summary: combined.substring(0, 300),
          sourceFile: sourceName
        });
      }
      currentTitle = hMatch[1];
      currentText = [];
    } else if (line.trim()) {
      currentText.push(line.trim());
    }
  }

  return entries;
}

/**
 * 获取规则原文（按偏移和长度）
 */
// 读取规则系统 compressed/ 下的 JSON 数据文件（如 rule_spell_lists.json），原样返回
app.get('/api/rules/json', (req, res) => {
  const { system, file } = req.query;
  if (!system || !file) return res.status(400).json({ error: '参数不足' });

  const safeFile = path.normalize(String(file)).replace(/^([/\\])+/, '');
  if (!safeFile.toLowerCase().startsWith('compressed' + path.sep) || !/\.json$/i.test(safeFile)) {
    return res.status(400).json({ error: '仅允许读取 compressed/ 下的 .json 数据文件' });
  }

  const filePath = path.join(RULER_DIR, system, safeFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '数据文件不存在' });

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'JSON 解析失败: ' + e.message });
  }
});

app.get('/api/rules/source', (req, res) => {
  const { system, file, offset, length } = req.query;
  if (!system || !file) return res.status(400).json({ error: '参数不足' });

  // 检查多个可能的路径
  const paths = [
    path.join(RULER_DIR, system, 'source', file),
    path.join(RULER_DIR, system, file)
  ];

  let foundPath = null;
  for (const p of paths) {
    if (fs.existsSync(p)) { foundPath = p; break; }
  }

  if (!foundPath) return res.status(404).json({ error: '源文件不存在' });

  try {
    const off = parseInt(offset) || 0;
    const len = Math.min(parseInt(length) || 2000, 10000); // 最多10000字符
    let text = readTextFileSmart(foundPath);
    if (/\.(html?|xhtml)$/i.test(foundPath)) {
      text = htmlToMarkdownDocument(text, htmlTitle(text, path.basename(file)));
    }
    const totalSize = text.length;
    const slice = text.slice(off, off + len);

    res.json({
      text: slice,
      offset: off,
      length: len,
      totalSize,
      file
    });
  } catch (e) {
    res.status(500).json({ error: `读取失败: ${e.message}` });
  }
});

// ── API: 压缩处理（上传文件后AI压缩为标准表格） ──────

app.post('/api/rules/compress', async (req, res) => {
  const { system, fileName, entries, provider: reqProvider } = req.body;

  if (!entries || !entries.length) {
    return res.status(400).json({ error: '没有可压缩的条目' });
  }

  const providerKey = reqProvider || appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];

  if (!provider || !provider.enabled || !provider.apiKey) {
    return res.status(400).json({ error: 'AI未配置' });
  }

  try {
    // 分批压缩（每批最多50条）
    const batchSize = 50;
    let allCompressed = '';

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const prompt = buildCompressPromptServer(batch, system);

      const result = await callAI(provider.endpoint, provider.apiKey, provider.model, [
        { role: 'system', content: '你是规则书压缩专家。将TRPG规则精确压缩为标准化查表格式。只输出表格。' },
        { role: 'user', content: prompt }
      ]);

      allCompressed += result.content + '\n\n';
    }

    // 存储压缩结果
    if (system && fileName) {
      const sysDir = path.join(RULER_DIR, system, 'compressed');
      if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
      const mdName = fileName.replace(/\.[^.]+$/, '.md');
      fs.writeFileSync(path.join(sysDir, mdName), allCompressed, 'utf8');

      // 同时存储原始文本
      const sourceDir = path.join(RULER_DIR, system, 'source');
      if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
    }

    // 更新索引
    try {
      const indexPath = path.join(RULER_DIR, system, '_index.json');
      if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath); // 删除旧索引，下次请求时重建
    } catch (e) { /* ignore */ }

    res.json({ content: allCompressed, cached: true });
  } catch (err) {
    res.status(500).json({ error: `压缩失败: ${err.message}` });
  }
});

function buildCompressPromptServer(entries, systemName) {
  const items = entries.map(e =>
    `[${e.category || '其他'}] ${e.title}\n${(e.summary || '').substring(0, 300)}`
  ).join('\n---\n');

  return `将以下${systemName}规则书内容压缩为查表格式。每条1-2句核心机制，去除描述。格式：

| 分类 | 条目 | 关键词 | 压缩摘要 |
|------|------|--------|----------|
| 职业 | 战士 | 生命骰,d10,重甲 | HP d10, 熟练: 重甲/军用武器, 2级获得动作如潮 |

内容：
${items}

只输出表格，不要多余文字。`;
}

// ── 启动时自动扫描规则书任务区 ──────────────────────

function autoScanRulesOnStartup() {
  console.log('[规则扫描] 正在扫描规则书任务区...');
  migrateAllCharacterAssets();

  if (!fs.existsSync(RULER_DIR)) return;

  const systems = fs.readdirSync(RULER_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  // 确保每个系统有source/和compressed/子目录
  for (const sys of systems) {
    const sysDir = path.join(RULER_DIR, sys);
    const sourceDir = path.join(sysDir, 'source');
    const compressedDir = path.join(sysDir, 'compressed');

    if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
    if (!fs.existsSync(compressedDir)) fs.mkdirSync(compressedDir, { recursive: true });

    // 将系统根目录下的文件自动移到source/
    const rootFiles = fs.readdirSync(sysDir).filter(f => {
      const full = path.join(sysDir, f);
      return fs.statSync(full).isFile() && f !== '_index.json';
    });
    for (const f of rootFiles) {
      const src = path.join(sysDir, f);
      const dst = path.join(sourceDir, f);
      if (!fs.existsSync(dst)) {
        try {
          fs.renameSync(src, dst);
          console.log(`  [移动] ${f} → source/`);
        } catch (e) { /* ignore */ }
      }
    }

    // 统计文件
    const srcCount = fs.readdirSync(sourceDir).filter(f => f.endsWith('.txt') || f.endsWith('.md')).length;
    const compCount = fs.existsSync(compressedDir) ? fs.readdirSync(compressedDir).filter(f => f.endsWith('.md')).length : 0;

    if (srcCount > 0 || compCount > 0) {
      console.log(`  📚 ${sys}: source=${srcCount} 压缩=${compCount}`);
    }
  }

  if (systems.length === 0) {
    console.log('  （规则书任务区为空，上传PDF/CHM后自动创建）');
  }
}

// ── 健康检查 ──────────────────────────────────────────

// 前端连接诊断上报：AI 客户端连接检测失败时把原因 POST 到这里，进入后端日志供排查
app.post('/api/diag', (req, res) => {
  const info = (req.body && typeof req.body === 'object') ? req.body : {};
  try { console.log('[前端诊断] 连接失败上报:', JSON.stringify(info)); } catch (e) {}
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    aiConfigured: Object.values(appConfig.ai.providers).some(p => p.enabled && p.apiKey)
  });
});

app.get('/api/players/names', (req, res) => {
  try {
    let registry = {};
    try { registry = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, 'data', 'players.json'), 'utf8')) || {}; } catch (e) {}
    const names = Object.keys(registry).map((n) => ({
      name: n,
      online: isNameTaken(n)
    })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    res.json({ total: names.length, players: names });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: 关闭服务（仅本机，GUI 无控制台时的退出途径） ──

app.post('/api/shutdown', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('::ffff:127.0.0.1');
  if (!isLocal) return res.status(403).json({ error: '仅允许本机关闭服务' });
  res.json({ success: true, message: '服务正在关闭' });
  console.log('[启动] 收到本机关闭请求，退出中...');
  setTimeout(() => { process.exit(0); }, 200);
});



app.post('/api/characters/archive', (req, res) => {
  const { system, adventure, characters } = req.body || {};
  if (!Array.isArray(characters) || !characters.length) return res.json({ success: true, saved: 0, archived: 0 });
  let saved = 0, archived = 0;
  characters.forEach(c => {
    if (!c || !c.id) return;
    try { migrateCharacterAssets(cleanRuleName(String(system || '')), String(adventure || '默认'), c.id, c); } catch (e) { console.error('[角色资产] archive 迁移失败:', e.message); }
    const dir = characterDir(system, adventure, c.id);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const curFile = path.join(dir, 'current.json');
      const snapshotObject = { savedAt: new Date().toISOString(), character: c };
      const snapshot = JSON.stringify(snapshotObject, null, 2);
      let changed = true;
      if (fs.existsSync(curFile)) {
        let prev = '';
        try { prev = fs.readFileSync(curFile, 'utf8'); } catch (e) {}
        try {
          const previousObject = JSON.parse(prev || '{}');
          changed = JSON.stringify(previousObject.character || null) !== JSON.stringify(c);
        } catch (e) {
          changed = prev.trim() !== snapshot.trim();
        }
        if (changed && prev.trim()) {
          const vDir = path.join(dir, 'versions');
          fs.mkdirSync(vDir, { recursive: true });
          const vFile = path.join(vDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
          if (!fs.existsSync(vFile)) { fs.writeFileSync(vFile, prev, 'utf8'); archived++; }
        }
      }
      if (changed || !fs.existsSync(curFile)) fs.writeFileSync(curFile, snapshot, 'utf8');
      saved++;
    } catch (e) { console.error('[角色存档] 失败:', e.message); }
  });
  res.json({ success: true, saved, archived });
});

// GM 带团上下文（自动注入，替代 AI 手动检索）：角色卡摘要 + 活动模组上下文（AGENT.md 要点 + index.json 摘要，秘密标注）
app.get('/api/gm/context', (req, res) => {
  const { system, adventure } = req.query || {};
  const sys = cleanRuleName(String(system || ''));
  if (!sys) return res.json({ success: true, context: '' });
  const adv = String(adventure || '默认');
  const parts = [];
  // 角色卡摘要
  const charsDir = path.join(RULER_DIR, sys, '存档', adv, 'characters');
  if (fs.existsSync(charsDir)) {
    const summaries = [];
    for (const cdir of fs.readdirSync(charsDir, { withFileTypes: true })) {
      if (!cdir.isDirectory()) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(charsDir, cdir.name, 'current.json'), 'utf8'));
        const c = obj && obj.character;
        if (!c) continue;
        const d = c.data || {};
        const parts2 = [];
        parts2.push((c.displayName || c.name || '未命名') + (d.race ? '（' + d.race + ' ' + (d.class || '') + (d.subclass ? '/' + d.subclass : '') + ' Lv' + (d.level || 1) + '）' : ''));
        if (c.hp != null) parts2.push('HP ' + c.hp + '/' + c.maxHp);
        if (c.ac != null) parts2.push('AC ' + c.ac);
        if (d.abilityScores) parts2.push('属性 ' + Object.keys(d.abilityScores).map(k => k + (d.abilityScores[k] != null ? d.abilityScores[k] : '?')).join('/'));
        if (d.background) parts2.push('背景 ' + d.background);
        if (d.alignment) parts2.push('阵营 ' + d.alignment);
        const bio = d.bio || {};
        const bioNote = [bio.appearance, bio.personality, bio.backstory].filter(Boolean).join('；').slice(0, 200);
        if (bioNote) parts2.push('角色设定 ' + bioNote);
        summaries.push('- ' + parts2.join('，'));
      } catch (e) { /* 跳过坏档 */ }
    }
    if (summaries.length) parts.push('### 当前角色卡\n' + summaries.join('\n'));
  }
  // 活动模组上下文
  const meta = loadAdventureMeta(sys, adv);
  const modules = Array.isArray(meta.activeModules) ? meta.activeModules.slice() : (meta.activeModule ? [meta.activeModule] : []);
  if (modules.length) {
    const modParts = [];
    for (const m of modules) {
      try {
        const modRoot = path.join(RULER_DIR, sys, 'modules', m);
        const trpg = path.join(modRoot, '.trpg');
        if (!fs.existsSync(trpg)) { modParts.push('- ' + m + '（未完成整理：无 .trpg/）'); continue; }
        const ag = fs.existsSync(path.join(trpg, 'AGENT.md')) ? fs.readFileSync(path.join(trpg, 'AGENT.md'), 'utf8') : '';
        const idx = fs.existsSync(path.join(trpg, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(trpg, 'index.json'), 'utf8')) : {};
        const lines = [];
        lines.push('- ' + m + '（模组目录 Ruler/' + sys + '/modules/' + m + '）');
        if (ag) lines.push('  工作规范：' + String(ag).replace(/\s+/g, ' ').trim().slice(0, 300));
        const list = (arr, label) => {
          if (Array.isArray(arr) && arr.length) lines.push('  ' + label + '：' + arr.map(x => (x && (x.name || x.id || x.title)) || '?').join('、'));
        };
        list(idx.scenes, '场景');
        list(idx.locations, '地点');
        list(idx.entities, 'NPC/实体');
        list(idx.encounters, '遭遇');
        list(idx.items, '物品');
        list(idx.quests, '任务');
        if (Array.isArray(idx.secrets) && idx.secrets.length) {
          lines.push('  【GM 秘密，禁止向玩家泄露】' + idx.secrets.map(x => (x && (x.name || x.title || x.id)) || '?').join('、'));
        }
        modParts.push(lines.join('\n'));
      } catch (e) { modParts.push('- ' + m + '（读取失败：' + e.message + '）'); }
    }
    parts.push('### 当前活动模组\n' + modParts.join('\n'));
  }
  const context = parts.length
    ? '## 当前带团现场（自动注入；标【GM 秘密】的内容禁止向玩家复述）\n' + parts.join('\n\n')
    : '';
  res.json({ success: true, context });
});

// 读取冒险的全部角色卡（服务端存档优先：AI/外部工具直接修改 current.json 后，前端以此为准加载）
app.get('/api/characters/load', (req, res) => {
  const { system, adventure } = req.query || {};
  const sys = cleanRuleName(String(system || ''));
  if (!sys) return res.json({ success: true, characters: [] });
  const charsDir = path.join(RULER_DIR, sys, '存档', String(adventure || '默认'), 'characters');
  const characters = [];
  if (fs.existsSync(charsDir)) {
    for (const cdir of fs.readdirSync(charsDir, { withFileTypes: true })) {
      if (!cdir.isDirectory()) continue;
      const curFile = path.join(charsDir, cdir.name, 'current.json');
      if (!fs.existsSync(curFile)) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(curFile, 'utf8'));
        if (obj && obj.character) characters.push(obj.character);
      } catch (e) { console.error('[角色存档] 读取失败:', cdir.name, e.message); }
    }
  }
  res.json({ success: true, characters });
});

// 导出角色卡：角色 JSON + 立绘资源（base64）打包为单文件，供跨存档/跨团导入
app.post('/api/characters/export', (req, res) => {
  const { system, adventure, id } = req.body || {};
  const dir = characterDir(system, adventure, id);
  const curFile = path.join(dir, 'current.json');
  if (!fs.existsSync(curFile)) return res.status(404).json({ error: '角色卡不存在' });
  try {
    const obj = JSON.parse(fs.readFileSync(curFile, 'utf8'));
    const payload = { format: 'trpg-character', version: 1, exportedAt: new Date().toISOString(), system: cleanRuleName(String(system || '')), character: obj.character || {} };
    const cdata = payload.character.data || {};
    const urls = [];
    if (cdata.assets) {
      if (cdata.assets.portrait) urls.push(['portrait', cdata.assets.portrait]);
      if (cdata.assets.avatarFramed) urls.push(['avatarFramed', cdata.assets.avatarFramed]);
    }
    if (payload.character.avatarUrl) urls.push(['avatarUrl', payload.character.avatarUrl]);
    const assets = {};
    for (const [key, url] of urls) {
      const m = String(url).match(/\/icon\/([^/?]+)$/);
      if (!m) continue;
      const iconPath = path.join(dir, 'icon', decodeURIComponent(m[1]));
      if (fs.existsSync(iconPath)) {
        try {
          const ext = path.extname(iconPath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'application/octet-stream';
          assets[decodeURIComponent(m[1])] = { key, mime, data: fs.readFileSync(iconPath).toString('base64') };
        } catch (e) {}
      }
    }
    payload.assets = assets;
    res.json({ success: true, payload });
  } catch (e) { res.status(500).json({ error: '导出失败: ' + e.message }); }
});

// 导入角色卡：从导出包恢复为新角色（新 id，立绘重新落盘 icon 目录）
app.post('/api/characters/import', (req, res) => {
  const { system, adventure, payload } = req.body || {};
  if (!payload || !payload.character || !payload.character.id) return res.status(400).json({ error: '无效的角色卡数据' });
  try {
    const sys = cleanRuleName(String(system || ''));
    const adv = String(adventure || '默认');
    const newId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const character = JSON.parse(JSON.stringify(payload.character));
    character.id = newId;
    const dir = characterDir(sys, adv, newId);
    const iconDir = path.join(dir, 'icon');
    character.data = character.data || {};
    character.data.assets = character.data.assets || {};
    if (payload.assets) {
      for (const fileName of Object.keys(payload.assets)) {
        const a = payload.assets[fileName];
        if (!a || !a.data) continue;
        try {
          fs.mkdirSync(iconDir, { recursive: true });
          fs.writeFileSync(path.join(iconDir, fileName), Buffer.from(a.data, 'base64'));
          const url = `/Ruler/${encodeURIComponent(sys)}/存档/${encodeURIComponent(adv)}/characters/${encodeURIComponent(newId)}/icon/${encodeURIComponent(fileName)}`;
          if (a.key === 'portrait') character.data.assets.portrait = url;
          else if (a.key === 'avatarFramed') character.data.assets.avatarFramed = url;
          else if (a.key === 'avatarUrl') character.avatarUrl = url;
        } catch (e) { console.error('[角色导入] 资源落盘失败:', fileName, e.message); }
      }
    }
    if (character.data.assets.avatarFramed) character.avatarUrl = character.data.assets.avatarFramed;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ savedAt: new Date().toISOString(), character }, null, 2));
    res.json({ success: true, character });
  } catch (e) { res.status(500).json({ error: '导入失败: ' + e.message }); }
});

app.get('/api/characters/versions', (req, res) => {
  const { system, adventure, id } = req.query || {};
  const dir = characterDir(system, adventure, id);
  const out = { current: null, versions: [] };
  try {
    const curFile = path.join(dir, 'current.json');
    if (fs.existsSync(curFile)) {
      try {
        const cur = JSON.parse(fs.readFileSync(curFile, 'utf8'));
        out.current = { ts: cur.savedAt || 'current', character: cur.character };
      } catch (e) {}
    }
    const vDir = path.join(dir, 'versions');
    if (fs.existsSync(vDir)) {
      fs.readdirSync(vDir).filter(f => f.endsWith('.json')).sort().reverse().forEach(f => {
        try {
          const v = JSON.parse(fs.readFileSync(path.join(vDir, f), 'utf8'));
          out.versions.push({ ts: v.savedAt || f.replace('.json', ''), file: f, character: v.character });
        } catch (e) {}
      });
    }
  } catch (e) {}
  res.json(out);
});

app.get('/api/characters/version', (req, res) => {
  const { system, adventure, id, ts } = req.query || {};
  const dir = characterDir(system, adventure, id);
  try {
    const file = path.join(dir, 'versions', String(ts || '').replace(/[^a-zA-Z0-9_\-]/g, '_') + '.json');
    if (!fs.existsSync(file)) return res.status(404).json({ error: '版本不存在' });
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/characters/restore', (req, res) => {
  const { system, adventure, id, ts } = req.body || {};
  const dir = characterDir(system, adventure, id);
  try {
    const file = path.join(dir, 'versions', String(ts || '').replace(/[^a-zA-Z0-9_\-]/g, '_') + '.json');
    if (!fs.existsSync(file)) return res.status(404).json({ error: '版本不存在' });
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    // 恢复：先把当前内容压入 versions，再把目标版本写为 current
    const curFile = path.join(dir, 'current.json');
    if (fs.existsSync(curFile)) {
      const vDir = path.join(dir, 'versions');
      fs.mkdirSync(vDir, { recursive: true });
      const bkFile = path.join(vDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
      if (!fs.existsSync(bkFile)) fs.writeFileSync(bkFile, fs.readFileSync(curFile, 'utf8'), 'utf8');
    }
    fs.writeFileSync(curFile, JSON.stringify({ savedAt: new Date().toISOString(), character: v.character }, null, 2), 'utf8');
    res.json({ success: true, character: v.character });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

















// 冒险统计：频道数、总消息数、最后活跃（jsonl 文件 mtime）




// ── API: 世界状态（地图/token/位置/背景的持久化层；AI GM 工具与前端 MapEngine 共用） ──

function worldStateFile(system, adventure) {
  return path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档', String(adventure || '默认'), 'world-state.json');
}

app.get('/api/world-state', (req, res) => {
  // 前端轮询依赖每次拿到 body 判断"过期空状态"保护，禁止 304 缓存（ETag 动态化）
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('ETag', 'ws-' + Date.now());
  const { system, adventure } = req.query;
  try {
    const f = worldStateFile(system, adventure);
    if (!fs.existsSync(f)) return res.json({ success: true, rev: 0, state: null });
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const state = raw.state || null;
    res.json({ success: true, rev: raw._rev || 0, state });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/world-state/save', (req, res) => {
  const { system, adventure, state } = req.body || {};
  if (!state) return res.status(400).json({ error: '缺少 state' });
  try {
    // 防御：同一地图内 token 按 id 去重（保留最后一份=最新），防止前端历史累积的重复 token 落盘
    if (state && Array.isArray(state.maps)) {
      state.maps.forEach(m => {
        if (!Array.isArray(m.tokens)) return;
        const seen = new Set();
        m.tokens = m.tokens.filter(t => { if (!t || !t.id) return true; if (seen.has(t.id)) return false; seen.add(t.id); return true; });
      });
    }
    const f = worldStateFile(system, adventure);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const rev = Date.now();
    fs.writeFileSync(f, JSON.stringify({ _rev: rev, savedAt: new Date().toISOString(), state }, null, 1), 'utf8');
    res.json({ success: true, rev });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: 模型发现与连接测试 ──────────────────────────

app.post('/api/ai/models', async (req, res) => {
  const { provider: reqProvider = 'custom', endpoint: reqEndpoint, apiKey: reqApiKey } = req.body || {};
  const saved = appConfig.ai.providers[reqProvider] || {};
  const endpoint = cleanApiUrl(reqEndpoint || saved.endpoint || DEFAULT_PROVIDER_ENDPOINTS[reqProvider]);
  const apiKey = resolveApiKey(reqApiKey, saved.apiKey);

  if (!endpoint) {
    return res.status(400).json({ error: '请先填写API地址' });
  }
  if (reqProvider === 'gpt' && !apiKey) {
    return res.status(400).json({ error: '请先填写API Key' });
  }

  try {
    const result = await discoverModels(endpoint, apiKey);
    res.json({
      provider: reqProvider,
      models: result.models,
      endpoint: result.endpoint,
      modelsUrl: result.modelsUrl,
      manual: result.models.length === 0
    });
  } catch (err) {
    // 并非所有兼容服务都实现/models。明确返回原因，同时保留手动输入入口。
    res.status(502).json({
      provider: reqProvider,
      models: [],
      manual: true,
      error: `无法读取模型列表：${err.message}`
    });
  }
});

app.post('/api/ai/test', async (req, res) => {
  const {
    provider: reqProvider = 'custom',
    endpoint: reqEndpoint,
    apiKey: reqApiKey,
    model: reqModel
  } = req.body || {};

  const saved = appConfig.ai.providers[reqProvider] || {};
  const endpoint = cleanApiUrl(reqEndpoint || saved.endpoint || DEFAULT_PROVIDER_ENDPOINTS[reqProvider]);
  const apiKey = resolveApiKey(reqApiKey, saved.apiKey);
  let model = String(reqModel || saved.model || '').trim();

  if (!endpoint) return res.status(400).json({ error: '请先填写API地址' });
  if (reqProvider === 'gpt' && !apiKey) return res.status(400).json({ error: '请先填写API Key' });

  try {
    if (!model) {
      const discovered = await discoverModels(endpoint, apiKey);
      model = discovered.models[0] || '';
    }
    if (!model) return res.status(400).json({ error: '没有可用于测试的模型，请先选择或输入模型' });

    const result = await callAI(endpoint, apiKey, model, [
      { role: 'user', content: '只回复 OK' }
    ]);
    res.json({ success: true, model: result.model || model, content: result.content });
  } catch (err) {
    res.status(502).json({ error: `连接失败：${err.message}` });
  }
});

  return { autoScanRulesOnStartup };
};