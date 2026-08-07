// ── 模组资料/导入任务 + 规则书UI框架 + 会话历史 路由（从 server.js 拆分） ──
// 依赖注入 ctx = { fs, path, RULER_DIR, SOURCE_ROOT, RUNTIME_ROOT, cleanRuleName, crypto,
//   renderPromptTemplate, PROMPT_PROFILE_VERSION, readTextFileSmart, stripHtmlToText,
//   upload, uploadDir, removeTempFile, sessionFilePath, loadSession,
//   privateSessionFilePath, appendPrivateSession, loadPrivateSession, listPrivateSessions }
module.exports = function registerModuleRoutes(app, ctx) {
  const {
    fs, path, RULER_DIR, SOURCE_ROOT, RUNTIME_ROOT, cleanRuleName, crypto,
    renderPromptTemplate, PROMPT_PROFILE_VERSION, readTextFileSmart, stripHtmlToText,
    upload, uploadDir, removeTempFile, sessionFilePath, loadSession,
    privateSessionFilePath, appendPrivateSession, loadPrivateSession, listPrivateSessions
  } = ctx;

  function safeRelativeModulePath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .filter(part => part && part !== '.' && part !== '..')
      .map(part => cleanRuleName(part))
      .join('/');
  }

  function moduleStorage(system, create = true) {
    const safeSystem = cleanRuleName(String(system || ''));
    if (!safeSystem) throw new Error('未选择规则系统');
    const systemDir = path.join(RULER_DIR, safeSystem);
    const root = path.join(systemDir, 'modules');
    if (create) {
      fs.mkdirSync(root, { recursive: true });
      const legacyRoots = [path.join(systemDir, '模组'), path.join(systemDir, 'source', '模组')];
      for (const legacy of legacyRoots) {
        if (!fs.existsSync(legacy)) continue;
        for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const from = path.join(legacy, entry.name);
          const manifest = path.join(from, '.trpg', 'module-manifest.json');
          if (!fs.existsSync(manifest)) continue;
          const to = path.join(root, cleanRuleName(entry.name));
          if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
        }
      }
    }
    return { safeSystem, systemDir, root };
  }

  function resolveModulePath(system, rel, mustExist = false) {
    const storage = moduleStorage(system, true);
    const safeRel = safeRelativeModulePath(rel);
    const full = path.resolve(storage.root, safeRel);
    if (full !== path.resolve(storage.root) && !full.startsWith(path.resolve(storage.root) + path.sep)) {
      throw new Error('模组路径越界');
    }
    if (mustExist && !fs.existsSync(full)) throw new Error('目标不存在');
    return { ...storage, safeRel, full };
  }

  function registeredModuleDirs(storage) {
    if (!fs.existsSync(storage.root)) return [];
    return fs.readdirSync(storage.root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(storage.root, entry.name, '.trpg', 'module-manifest.json')))
      .map(entry => ({ name: entry.name, dir: path.join(storage.root, entry.name) }));
  }

  function publicModuleFiles(storage, moduleName) {
    const indexPath = path.join(storage.root, cleanRuleName(moduleName), '.trpg', 'public-index.json');
    if (!fs.existsSync(indexPath)) return new Set();
    try {
      const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const files = Array.isArray(data.files) ? data.files : [];
      return new Set(files.map(item => safeRelativeModulePath(typeof item === 'string' ? item : item && item.path)).filter(Boolean));
    } catch (error) {
      return new Set();
    }
  }

  function modulePathVisible(storage, safeRel, view) {
    if (view === 'gm') return true;
    const parts = safeRelativeModulePath(safeRel).split('/').filter(Boolean);
    if (parts.length < 2) return false;
    const moduleName = parts.shift();
    if (!fs.existsSync(path.join(storage.root, moduleName, '.trpg', 'module-manifest.json'))) return false;
    return publicModuleFiles(storage, moduleName).has(parts.join('/'));
  }

  function listModuleTree(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.name !== '.DS_Store' && entry.name !== '.trpg')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
      .map(entry => {
        const full = path.join(dir, entry.name);
        const item = { name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size: entry.isFile() ? fs.statSync(full).size : 0 };
        if (entry.isDirectory()) item.children = listModuleTree(full);
        return item;
      });
  }

  function moduleNameFromUpload(files, relPaths) {
    const normalized = files.map((file, index) => safeRelativeModulePath(relPaths[index] || file.originalname || file.filename));
    const firstParts = normalized.map(rel => rel.split('/').filter(Boolean));
    const commonRoot = firstParts.length && firstParts.every(parts => parts.length > 1 && parts[0] === firstParts[0][0])
      ? firstParts[0][0]
      : '';
    if (commonRoot) return { moduleName: cleanRuleName(commonRoot), normalized, stripRoot: true };
    if (files.length === 1) {
      const stem = path.basename(normalized[0] || files[0].originalname || '未命名模组', path.extname(normalized[0] || files[0].originalname || ''));
      return { moduleName: cleanRuleName(stem || '未命名模组'), normalized, stripRoot: false };
    }
    const now = new Date();
    const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), '-', String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('');
    return { moduleName: `导入模组-${stamp}`, normalized, stripRoot: false };
  }

  function buildModuleImportPrompt(system, moduleName, moduleRootRelative, files) {
    const sourceList = files.slice(0, 200).map(file => `- ${file.rel} (${file.size} B)`).join('\n');
    const templatePath = path.join(SOURCE_ROOT, 'docs', 'prompts', 'module-ingest.md');
    let template = '';
    try { template = fs.readFileSync(templatePath, 'utf8'); } catch (error) { template = '读取原始模组，建立可带团的场景、实体、线索、遭遇、媒体与规则链接索引，并完成验证。'; }
    return renderPromptTemplate(template, {
      system,
      moduleName,
      modulePath: moduleRootRelative,
      promptProfileVersion: PROMPT_PROFILE_VERSION
    }) +
      `\n\n## 本次任务\n\n模组名：${moduleName}\n任务目录：${moduleRootRelative}\n\n已复制的原始文件：\n${sourceList || '- 尚无可列出的文件'}\n\n请使用项目文件工具实际读取、整理、写入并验证。`;
  }

  function writeModuleImportTask(system, moduleName, moduleDir, savedFiles) {
    const storage = moduleStorage(system, true);
    const taskId = `module-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const moduleRel = path.relative(RUNTIME_ROOT, moduleDir).replace(/\\/g, '/');
    const prompt = buildModuleImportPrompt(storage.safeSystem, moduleName, moduleRel, savedFiles);
    const metaDir = path.join(moduleDir, '.trpg');
    const taskDir = path.join(storage.systemDir, 'tasks');
    const projectTaskDir = path.join(RUNTIME_ROOT, 'AI任务', `模组导入-${taskId}`);
    fs.mkdirSync(metaDir, { recursive: true });
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(projectTaskDir, { recursive: true });
    const task = {
      id: taskId,
      type: 'module_ingest',
      status: 'await_ai_ingest',
      system: storage.safeSystem,
      moduleName,
      modulePath: moduleRel,
      sourceFiles: savedFiles,
      promptPath: `${moduleRel}/.trpg/import-task.md`,
      createdAt: new Date().toISOString()
    };
    const agentGuide = `# ${moduleName} 模组工作规范\n\n本目录中的原始资料是事实来源。AI 开始带团或继续开发前，应先读取 .trpg/module-manifest.json、.trpg/index.json 与「资料/」拆解文件。\n\n- 所有规则裁定链接到 Ruler/${storage.safeSystem}/source/ 的精确来源。\n- 场景、NPC、怪物、地点、遭遇、物品、线索、秘密与插图使用稳定 ID，索引与「资料/」拆解文件互相引用。\n- **带团按需读取（强制）**：模组已拆解为「资料/」下按主题组织的多文件（故事大纲/NPC/怪物/遭遇/地点/物品/线索/秘密等，见 index.json）；带团时按需读取对应文件，禁止每次全量重读原始 PDF。\n- **场景媒体（强制）**：进入新场景时查媒体索引，模组提供场景图时自动用 <illustration>（过场CG）或 [[map:bg:]]（地图背景）展示，图片位于 assets/ 子目录。\n- GM 秘密与玩家可见信息分离。\n- 原始资料只读，整理文件可持续迭代。\n- 带团期间发生的状态变化写入玩家存档，不回写原始模组。\n`;
    const index = {
      moduleName,
      system: storage.safeSystem,
      status: 'await_ai_ingest',
      audience: 'gm',
      publication: { released: [], updatedAt: new Date().toISOString() },
      sources: savedFiles.map(file => file.rel),
      scenes: [],
      entities: [],
      assets: [],
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(metaDir, 'module-manifest.json'), JSON.stringify(task, null, 2), 'utf8');
    fs.writeFileSync(path.join(metaDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
    fs.writeFileSync(path.join(metaDir, 'AGENT.md'), agentGuide, 'utf8');
    fs.writeFileSync(path.join(metaDir, 'import-task.md'), prompt, 'utf8');
    fs.writeFileSync(path.join(taskDir, `module-import-${taskId}.json`), JSON.stringify(task, null, 2), 'utf8');
    fs.writeFileSync(path.join(projectTaskDir, 'task.json'), JSON.stringify(task, null, 2), 'utf8');
    fs.writeFileSync(path.join(projectTaskDir, 'prompt.md'), prompt, 'utf8');
    console.log(`[模组导入] ${storage.safeSystem}/${moduleName} 已建立 AI 整理任务 ${taskId}`);
    return { task, prompt };
  }

  app.get('/api/module/search', (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      if (!q) return res.json({ results: [] });
      const storage = moduleStorage(req.query.system || '', true);
      const view = String(req.query.view || '') === 'gm' ? 'gm' : 'player';
      const results = [];
      function scan(dir, moduleName) {
        if (results.length >= 20 || !fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '.trpg') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) scan(full, moduleName);
          else if (/\.(md|txt|html?|json)$/i.test(entry.name)) {
            const rel = path.relative(storage.root, full).replace(/\\/g, '/');
            if (view !== 'gm' && !modulePathVisible(storage, rel, view)) continue;
            try {
              const text = readTextFileSmart(full);
              if ((entry.name + '\n' + text).toLowerCase().includes(q)) {
                results.push({ title: entry.name, type: '模组', moduleName, audience: view === 'gm' ? 'gm' : 'public', summary: stripHtmlToText(text).slice(0, 260), file: rel });
              }
            } catch (error) { }
          }
          if (results.length >= 20) break;
        }
      }
      registeredModuleDirs(storage).forEach(module => scan(module.dir, module.name));
      res.json({ results, query: q, system: storage.safeSystem, view });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/module/list', (req, res) => {
    try {
      const storage = moduleStorage(req.query.system || '', true);
      const gmView = String(req.query.view || '') === 'gm';
      const tree = [];
      if (fs.existsSync(storage.root)) {
        for (const entry of fs.readdirSync(storage.root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const moduleDir = path.join(storage.root, entry.name);
          const manifestPath = path.join(moduleDir, '.trpg', 'module-manifest.json');
          const indexPath = path.join(moduleDir, '.trpg', 'index.json');
          if (!fs.existsSync(manifestPath)) continue;
          let manifest = {}, index = {};
          try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) { }
          try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (error) { }
          const audience = index.audience || manifest.audience || 'gm';
          const publicIndexPath = path.join(moduleDir, '.trpg', 'public-index.json');
          if (!gmView && audience === 'gm' && !fs.existsSync(publicIndexPath)) continue;
          let children = [];
          if (gmView) children = listModuleTree(moduleDir);
          else if (fs.existsSync(publicIndexPath)) {
            try {
              const publicIndex = JSON.parse(fs.readFileSync(publicIndexPath, 'utf8'));
              children = Array.isArray(publicIndex.files) ? publicIndex.files.map(item => {
                const file = safeRelativeModulePath(typeof item === 'string' ? item : item && item.path);
                return file ? { name: path.basename(file), type: 'file', size: 0, publicPath: safeRelativeModulePath(entry.name + '/' + file) } : null;
              }).filter(Boolean) : [];
            } catch (error) { children = []; }
            if (!children.length) continue;
          }
          tree.push({ name: entry.name, type: 'dir', audience, status: index.status || manifest.status || 'await_ai_ingest', children });
        }
      }
      tree.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      res.json({ system: storage.safeSystem, base: storage.root, tree, view: gmView ? 'gm' : 'player' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/module/upload', upload.array('files'), (req, res) => {
    const tempFiles = req.files || [];
    try {
      const storage = moduleStorage(req.body.system || '', true);
      if (!tempFiles.length) return res.status(400).json({ error: '未收到文件' });
      const relPaths = Array.isArray(req.body.relPath) ? req.body.relPath : [req.body.relPath || null];
      const uploadInfo = moduleNameFromUpload(tempFiles, relPaths);
      const moduleDir = path.join(storage.root, uploadInfo.moduleName);
      fs.mkdirSync(moduleDir, { recursive: true });
      const saved = [];
      tempFiles.forEach((file, index) => {
        const parts = uploadInfo.normalized[index].split('/').filter(Boolean);
        const localParts = uploadInfo.stripRoot ? parts.slice(1) : parts;
        const rel = safeRelativeModulePath(localParts.join('/') || file.originalname || file.filename);
        const target = path.resolve(moduleDir, rel);
        if (!target.startsWith(path.resolve(moduleDir) + path.sep) && target !== path.resolve(moduleDir)) throw new Error('模组文件路径越界');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        fs.renameSync(file.path, target);
        saved.push({ rel: path.relative(moduleDir, target).replace(/\\/g, '/'), size: file.size });
      });
      const queued = writeModuleImportTask(storage.safeSystem, uploadInfo.moduleName, moduleDir, saved);
      res.json({
        success: true,
        system: storage.safeSystem,
        moduleName: uploadInfo.moduleName,
        sourcePath: path.relative(RUNTIME_ROOT, moduleDir).replace(/\\/g, '/'),
        saved,
        total: saved.length,
        taskId: queued.task.id,
        taskPath: queued.task.promptPath,
        taskStatus: queued.task.status,
        prompt: queued.prompt
      });
    } catch (error) {
      tempFiles.forEach(file => removeTempFile(file.path));
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/module/task/status', (req, res) => {
    try {
      const system = cleanRuleName(String(req.body.system || ''));
      const moduleName = cleanRuleName(String(req.body.moduleName || ''));
      const taskId = String(req.body.taskId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const status = ['await_ai_ingest', 'running', 'completed', 'failed'].includes(req.body.status) ? req.body.status : 'running';
      if (!system || !moduleName || !taskId) return res.status(400).json({ error: '参数缺失' });
      const storage = moduleStorage(system, true);
      const taskPath = path.join(storage.systemDir, 'tasks', `module-import-${taskId}.json`);
      if (!fs.existsSync(taskPath)) return res.status(404).json({ error: '任务不存在' });
      const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
      task.status = status;
      task.updatedAt = new Date().toISOString();
      task.message = String(req.body.message || '').slice(0, 2000);
      fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
      const metaDir = path.join(storage.root, moduleName, '.trpg');
      fs.mkdirSync(metaDir, { recursive: true });
      fs.writeFileSync(path.join(metaDir, 'module-manifest.json'), JSON.stringify(task, null, 2), 'utf8');
      const indexPath = path.join(metaDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        try {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
          index.status = status;
          index.updatedAt = task.updatedAt;
          fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
        } catch (error) { }
      }
      fs.appendFileSync(path.join(metaDir, 'import.log'), JSON.stringify({ time: task.updatedAt, status, message: task.message }) + '\n', 'utf8');
      res.json({ success: true, task });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/module/read', (req, res) => {
    try {
      const target = resolveModulePath(req.query.system || '', req.query.path || '', true);
      const view = String(req.query.view || '') === 'gm' ? 'gm' : 'player';
      if (!modulePathVisible(target, target.safeRel, view)) return res.status(403).json({ error: '该模组资料尚未向玩家公开' });
      if (!fs.statSync(target.full).isFile()) return res.status(400).json({ error: '目标不是文件' });
      const ext = path.extname(target.full).toLowerCase();
      const maxLen = 30000;
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.zip', '.rar', '.7z', '.pdf', '.chm', '.xlsx', '.docx', '.mp3', '.wav', '.ogg'].includes(ext)) {
        return res.json({ binary: true, name: path.basename(target.full), size: fs.statSync(target.full).size, url: `/api/module/file?system=${encodeURIComponent(target.safeSystem)}&path=${encodeURIComponent(target.safeRel)}&view=${view}` });
      }
      const raw = readTextFileSmart(target.full);
      const isHtml = /\.html?$/i.test(ext);
      const content = isHtml ? stripHtmlToText(raw) : raw;
      res.json({ binary: false, format: isHtml ? 'html-text' : 'text', name: path.basename(target.full), size: fs.statSync(target.full).size, content: content.slice(0, maxLen), truncated: content.length > maxLen });
    } catch (error) {
      res.status(error.message === '目标不存在' ? 404 : 500).json({ error: error.message });
    }
  });

  app.get('/api/module/media', (req, res) => {
    try {
      const storage = moduleStorage(req.query.system || '', true);
      const view = String(req.query.view || '') === 'gm' ? 'gm' : 'player';
      const images = [];
      function scan(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '.trpg' && entry.isDirectory()) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) scan(full);
          else if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(entry.name)) {
            const rel = path.relative(storage.root, full).replace(/\\/g, '/');
            if (!modulePathVisible(storage, rel, view)) continue;
            images.push({ name: path.basename(entry.name, path.extname(entry.name)), path: rel, moduleName: rel.split('/')[0] || '', url: `/api/module/file?system=${encodeURIComponent(storage.safeSystem)}&path=${encodeURIComponent(rel)}&view=${view}`, size: fs.statSync(full).size });
          }
        }
      }
      registeredModuleDirs(storage).forEach(module => scan(module.dir));
      images.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }));
      res.json({ system: storage.safeSystem, total: images.length, images });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 确保规则书有 ui/ 目录：无则从 app/default-ui/ 复制一份（隔离：此后只读规则书自己的副本）
  function ensureRuleUi(system) {
    try {
      const uiDir = path.join(RULER_DIR, system, 'ui');
      if (fs.existsSync(uiDir)) return true;
      const defaultUi = path.join(SOURCE_ROOT, 'app', 'default-ui');
      if (!fs.existsSync(defaultUi)) return false;
      fs.mkdirSync(path.dirname(uiDir), { recursive: true });
      fs.cpSync(defaultUi, uiDir, { recursive: true });
      console.log(`[UI框架] ${system}：已从默认模板复制 ui/（隔离副本）`);
      return true;
    } catch (e) {
      console.error('[UI框架] 复制默认ui失败:', e.message);
      return false;
    }
  }

  app.get('/api/ui-manifest', (req, res) => {
    const system = cleanRuleName(String(req.query.system || ''));
    if (!system) return res.status(400).json({ error: '参数缺失' });
    ensureRuleUi(system);
    const mf = path.join(RULER_DIR, system, 'ui', 'manifest.json');
    if (!fs.existsSync(mf)) return res.status(404).json({ error: '无自定义界面（使用默认框架）' });
    try {
      const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
      res.json({ system, manifest });
    } catch (e) { res.status(500).json({ error: 'manifest 解析失败: ' + e.message }); }
  });

  app.get('/api/ui-panel', (req, res) => {
    try {
      const system = cleanRuleName(String(req.query.system || ''));
      const panel = String(req.query.panel || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!system || !panel) return res.status(400).json({ error: '参数缺失' });
      const full = path.join(RULER_DIR, system, 'ui', 'panels', panel + '.html');
      if (!fs.existsSync(full)) return res.status(404).json({ error: '面板不存在' });
      const html = fs.readFileSync(full, 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/module/file', (req, res) => {
    try {
      const target = resolveModulePath(req.query.system || '', req.query.path || '', true);
      const view = String(req.query.view || '') === 'gm' ? 'gm' : 'player';
      if (!modulePathVisible(target, target.safeRel, view)) return res.status(403).end();
      if (!fs.statSync(target.full).isFile()) return res.status(404).end();
      const ext = path.extname(target.full).toLowerCase();
      const mime = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.pdf': 'application/pdf'
      }[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(target.full);
    } catch (error) {
      res.status(error.message === '目标不存在' ? 404 : 500).end();
    }
  });

  app.post('/api/module/delete', (req, res) => {
    try {
      const target = resolveModulePath(req.body.system || '', req.body.path || '', true);
      if (!target.safeRel) return res.status(400).json({ error: '缺少路径' });
      fs.rmSync(target.full, { recursive: true, force: true });
      res.json({ success: true, removed: target.safeRel });
    } catch (error) {
      res.status(error.message === '目标不存在' ? 404 : 500).json({ error: error.message });
    }
  });

  // 列出某规则系统下的全部冒险（含各冒险的会话文件）
  app.get('/api/sessions/list', (req, res) => {
    const system = req.query.system || '';
    const sys = cleanRuleName(String(system));
    const base = path.join(RULER_DIR, sys, '存档');
    if (!fs.existsSync(base)) return res.json([]);
    const result = [];
    try {
      fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(adv => {
        const sessionsDir = path.join(base, adv.name, 'sessions');
        const sessions = [];
        if (fs.existsSync(sessionsDir)) {
          fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')).forEach(f => {
            sessions.push({ channel: f.replace(/\.jsonl$/, ''), size: fs.statSync(path.join(sessionsDir, f)).size });
          });
        }
        result.push({ adventure: adv.name, sessions });
      });
    } catch (e) { /* ignore */ }
    res.json(result);
  });

  // 读取某会话历史（只读查阅，格式：消息数组）
  // scope=ai → AI 私聊（GM导演指令，private-ai-<channel>.jsonl）；scope=pm → 玩家私聊（private-pm-<a>-<b>.jsonl，key 为归一化会话对）
  app.get('/api/sessions/read', (req, res) => {
    const { system, adventure, channel, scope } = req.query;
    let file, msgs, label;
    if (scope === 'ai' || scope === 'pm') {
      file = privateSessionFilePath(system, adventure, scope, channel);
      msgs = loadPrivateSession(system, adventure, scope, channel);
      label = channel || '';
    } else {
      file = sessionFilePath(system, adventure, channel);
      msgs = loadSession(system, adventure, channel);
      label = channel || '';
    }
    if (!fs.existsSync(file)) return res.status(404).json({ error: '会话不存在' });
    res.json({ system, adventure, channel: label, scope: scope || 'public', total: msgs.length, messages: msgs });
  });

  // 私聊会话列表（供历史窗口切换公屏/私聊）：{ ai: [{key,size}], pm: [{key,size}] }
  app.get('/api/sessions/private-list', (req, res) => {
    const { system, adventure } = req.query;
    res.json({ success: true, ...listPrivateSessions(system, adventure) });
  });

  app.post('/api/sessions/remove', (req, res) => {
    const { system, adventure, channel, id } = req.body || {};
    if (!system || !id) return res.status(400).json({ error: '参数缺失' });
    const file = sessionFilePath(system, adventure, channel || 'story');
    if (!fs.existsSync(file)) return res.json({ success: true });
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      const kept = lines.filter(l => {
        try { const m = JSON.parse(l); return !(m && m.id === id); } catch (e) { return true; }
      });
      fs.writeFileSync(file, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sessions/edit', (req, res) => {
    const { system, adventure, channel, id, content } = req.body || {};
    if (!system || !id) return res.status(400).json({ error: '参数缺失' });
    const file = sessionFilePath(system, adventure, channel || 'story');
    if (!fs.existsSync(file)) return res.status(404).json({ error: '会话不存在' });
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      let found = false;
      const out = lines.map(l => {
        try {
          const m = JSON.parse(l);
          if (m && m.id === id) { found = true; m.content = String(content || ''); m.edited = true; return JSON.stringify(m); }
          return l;
        } catch (e) { return l; }
      });
      if (!found) return res.status(404).json({ error: '消息不存在' });
      fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
