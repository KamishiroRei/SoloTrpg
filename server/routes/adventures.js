// ── 冒险/会话/模组活动/自动存档 路由 ──
// 依赖注入 ctx = { fs, path, RULER_DIR, cleanRuleName, listAdventures, loadAdventureMeta, saveAdventureMeta }
module.exports = function registerAdventureRoutes(app, ctx) {
  const { fs, path, RULER_DIR, cleanRuleName, listAdventures, loadAdventureMeta, saveAdventureMeta } = ctx;

  // 冒险列表（含元信息与统计）
  app.get('/api/adventures/list', (req, res) => {
    res.json(listAdventures(req.query.system || ''));
  });

  // 新建冒险
  app.post('/api/adventures/create', (req, res) => {
    const { system, name } = req.body || {};
    const adv = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if (!adv) return res.status(400).json({ error: '冒险名不能为空' });
    const sys = cleanRuleName(String(system || ''));
    const advDir = path.join(RULER_DIR, sys, '存档', adv);
    if (fs.existsSync(advDir)) return res.status(400).json({ error: '冒险已存在' });
    try {
      fs.mkdirSync(path.join(advDir, 'sessions'), { recursive: true });
      saveAdventureMeta(system, adv, { archived: false, tags: [], createdAt: new Date().toISOString() });
      res.json({ success: true, adventure: adv });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 重命名冒险（改目录名 + meta）
  app.post('/api/adventures/rename', (req, res) => {
    const { system, name, newName } = req.body || {};
    const adv = String(name || '');
    const adv2 = String(newName || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    if (!adv2 || adv2 === adv) return res.status(400).json({ error: '新名称无效' });
    const sys = cleanRuleName(String(system || ''));
    const oldDir = path.join(RULER_DIR, sys, '存档', adv);
    const newDir = path.join(RULER_DIR, sys, '存档', adv2);
    if (!fs.existsSync(oldDir)) return res.status(404).json({ error: '冒险不存在' });
    if (fs.existsSync(newDir)) return res.status(400).json({ error: '目标冒险已存在' });
    try {
      fs.renameSync(oldDir, newDir);
      res.json({ success: true, adventure: adv2 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 归档/取消归档冒险（保留文件，可检索）
  app.post('/api/adventures/archive', (req, res) => {
    const { system, name, archived } = req.body || {};
    const meta = loadAdventureMeta(system, String(name || ''));
    meta.archived = !!archived;
    saveAdventureMeta(system, String(name || ''), meta);
    res.json({ success: true, archived: !!archived });
  });

  // 编辑冒险标签
  app.post('/api/adventures/tag', (req, res) => {
    const { system, name, tags } = req.body || {};
    const meta = loadAdventureMeta(system, String(name || ''));
    meta.tags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20) : [];
    saveAdventureMeta(system, String(name || ''), meta);
    res.json({ success: true, tags: meta.tags });
  });

  // 当前活动模组（冒险级，可多个，存 meta.json）：带团时注入玩家频道 AI 提示词
  app.get('/api/module/active', (req, res) => {
    const { system, adventure } = req.query || {};
    const meta = loadAdventureMeta(cleanRuleName(String(system || '')), String(adventure || '默认'));
    const modules = Array.isArray(meta.activeModules) ? meta.activeModules.slice() : (meta.activeModule ? [meta.activeModule] : []);
    res.json({ success: true, modules, module: modules[0] || null });
  });

  app.post('/api/module/active', (req, res) => {
    const { system, adventure, module, clear } = req.body || {};
    const sys = cleanRuleName(String(system || ''));
    if (!sys) return res.status(400).json({ error: '缺少规则系统' });
    const meta = loadAdventureMeta(sys, String(adventure || '默认'));
    let modules = Array.isArray(meta.activeModules) ? meta.activeModules.slice() : (meta.activeModule ? [meta.activeModule] : []);
    if (clear) {
      modules = [];
    } else if (module) {
      const name = String(module).trim();
      if (name) {
        if (modules.includes(name)) modules = modules.filter(m => m !== name); // 再次设定=移除（切换）
        else modules.push(name);
      }
    }
    meta.activeModules = modules;
    delete meta.activeModule; // 单值字段已废弃，统一数组
    meta.activeModulesAt = new Date().toISOString();
    saveAdventureMeta(sys, String(adventure || '默认'), meta);
    res.json({ success: true, modules });
  });

  // 重置冒险：清空全部频道会话与带团进度，保留角色卡（characters/ 与立绘不删）
  app.post('/api/adventures/reset', (req, res) => {
    const { system, name } = req.body || {};
    const sys = cleanRuleName(String(system || ''));
    const advDir = path.join(RULER_DIR, sys, '存档', String(name || ''));
    if (!fs.existsSync(advDir)) return res.status(404).json({ error: '冒险不存在' });
    try {
      const sessionsDir = path.join(advDir, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        for (const f of fs.readdirSync(sessionsDir)) {
          // 清公屏会话与 AI 私聊（导演指令随冒险重置）；玩家之间私聊（private-pm-*）保留
          if (f.endsWith('.jsonl') && !f.startsWith('private-pm-')) fs.rmSync(path.join(sessionsDir, f), { force: true });
        }
      }
      const metaFile = path.join(advDir, 'meta.json');
      if (fs.existsSync(metaFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          delete meta.activeModules;
          delete meta.activeModule;
          delete meta.activeModulesAt;
          delete meta.lastActiveAt;
          fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
        } catch (e) { console.error('[冒险重置] meta 处理失败:', e.message); }
      }
      // 世界状态（地图/token/位置/背景）属带团进度，随重置清空；前端对空状态有保护，角色卡恢复不受影响
      const wsFile = path.join(advDir, 'world-state.json');
      if (fs.existsSync(wsFile)) fs.rmSync(wsFile, { force: true });
      res.json({ success: true, keptCharacters: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 自动存档（对话记录落盘 conversation.txt）
  app.post('/api/archive/log', (req, res) => {
    const { user, ai, time, system, adventure } = req.body;
    const sys = system || 'DND';
    const adv = adventure || '默认';
    const advDir = path.join(RULER_DIR, sys, '存档', adv);
    if (!fs.existsSync(advDir)) fs.mkdirSync(advDir, { recursive: true });
    const logFile = path.join(advDir, 'conversation.txt');
    const entry = `[${time || new Date().toISOString()}]\n玩家: ${user}\nGM: ${ai}\n\n`;
    try { fs.appendFileSync(logFile, entry, 'utf8'); res.json({ success: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/archive/list', (req, res) => {
    const system = req.query.system || '';
    const base = system ? path.join(RULER_DIR, system, '存档') : RULER_DIR;
    if (!fs.existsSync(base)) return res.json([]);
    const results = [];
    if (system) {
      fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => {
        const files = fs.readdirSync(path.join(base, d.name)).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
        results.push({ system, name: d.name, files });
      });
    } else {
      fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(sysDir => {
        const adir = path.join(base, sysDir.name, '存档');
        if (fs.existsSync(adir)) {
          fs.readdirSync(adir, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => {
            results.push({ system: sysDir.name, name: d.name, files: [] });
          });
        }
      });
    }
    res.json(results);
  });

  app.get('/api/archive/read', (req, res) => {
    const { system, adventure, file } = req.query;
    const filePath = path.join(RULER_DIR, system || 'DND', '存档', adventure || '默认', file || 'conversation.txt');
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '存档不存在' });
    try { res.json({ content: fs.readFileSync(filePath, 'utf8'), file }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 冒险笔记（纯文本落盘：AI 与 GM 共用的非规则化文本记忆；notes/ 目录按冒险隔离）──
  function notesDir(system, adventure) {
    return path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档', String(adventure || '默认'), 'notes');
  }
  function safeNoteName(name) {
    return String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\.{2,}/g, '.').slice(0, 80);
  }

  // 笔记列表
  app.get('/api/notes/list', (req, res) => {
    const dir = notesDir(req.query.system, req.query.adventure);
    if (!fs.existsSync(dir)) return res.json({ notes: [] });
    try {
      const notes = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isFile() && /\.(md|txt)$/i.test(e.name))
        .map(e => {
          const st = fs.statSync(path.join(dir, e.name));
          return { name: e.name.replace(/\.(md|txt)$/i, ''), file: e.name, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      res.json({ notes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 读取笔记
  app.get('/api/notes/read', (req, res) => {
    const file = safeNoteName(req.query.file);
    if (!file) return res.status(400).json({ error: '笔记名不能为空' });
    const fp = path.join(notesDir(req.query.system, req.query.adventure), file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '笔记不存在' });
    try { res.json({ content: fs.readFileSync(fp, 'utf8'), file }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 保存（新建/覆盖）笔记
  app.post('/api/notes/save', (req, res) => {
    const { system, adventure, file, content } = req.body || {};
    let name = safeNoteName(file);
    if (!name) return res.status(400).json({ error: '笔记名不能为空' });
    if (!/\.(md|txt)$/i.test(name)) name = name + '.md';
    const dir = notesDir(system, adventure);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), String(content || ''), 'utf8');
      res.json({ success: true, file: name });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 删除笔记
  app.post('/api/notes/delete', (req, res) => {
    const { system, adventure, file } = req.body || {};
    const name = safeNoteName(file);
    if (!name) return res.status(400).json({ error: '笔记名不能为空' });
    const fp = path.join(notesDir(system, adventure), name);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '笔记不存在' });
    try { fs.rmSync(fp, { force: true }); res.json({ success: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
};
