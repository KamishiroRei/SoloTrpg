// ── 插件系统路由（AI 动态编写的功能模块，前端热加载） ──
// 依赖注入 ctx = { fs, path, RULER_DIR, HOST_PLUGINS_DIR, cleanRuleName, crypto, pendingQuestions }
module.exports = function registerPluginRoutes(app, ctx) {
  const { fs, path, RULER_DIR, HOST_PLUGINS_DIR, cleanRuleName, crypto, pendingQuestions } = ctx;

  // 用户回答 question 工具的问题
  app.post('/api/agent-answer', (req, res) => {
    const { id, answer } = req.body || {};
    const pending = pendingQuestions.get(id);
    if (!pending) return res.status(404).json({ error: '问题不存在或已超时' });
    clearTimeout(pending.timer);
    pendingQuestions.delete(id);
    pending.resolve(String(answer || ''));
    res.json({ success: true });
  });

  // 列出某规则系统的插件
  app.get('/api/plugins/list', (req, res) => {
    const { system } = req.query;
    if (!system) return res.status(400).json({ error: '请指定系统名称' });
    const safeSystem = cleanRuleName(system);
    const pluginsDir = path.join(RULER_DIR, safeSystem, 'plugins');
    const list = [];
    if (fs.existsSync(pluginsDir)) {
      for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(pluginsDir, entry.name, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest.id) {
              const entryPath = path.join(pluginsDir, entry.name, 'index.js');
              if (fs.existsSync(entryPath)) {
                manifest.hash = crypto.createHash('md5').update(fs.readFileSync(entryPath)).digest('hex');
              }
              list.push(manifest);
            }
          } catch (e) { /* 损坏的manifest跳过 */ }
        }
      }
    }
    res.json(list);
  });

  // 获取插件入口 JS
  app.get('/api/plugins/entry', (req, res) => {
    const { system, id } = req.query;
    if (!system || !id) return res.status(400).json({ error: '缺少参数' });
    const safeSystem = cleanRuleName(system);
    const safeId = cleanRuleName(id);
    const entryPath = path.join(RULER_DIR, safeSystem, 'plugins', safeId, 'index.js');
    if (!path.resolve(entryPath).startsWith(path.resolve(RULER_DIR))) return res.status(403).json({ error: '路径越界' });
    if (!fs.existsSync(entryPath)) return res.status(404).json({ error: '插件不存在' });
    res.type('application/javascript; charset=utf-8');
    res.send(fs.readFileSync(entryPath, 'utf8'));
  });

  // 宿主渲染策略插件（Ruler/_host_plugins/，type=host，全局生效）
  app.get('/api/plugins/host', (req, res) => {
    const list = [];
    try {
      if (fs.existsSync(HOST_PLUGINS_DIR)) {
        for (const entry of fs.readdirSync(HOST_PLUGINS_DIR, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const manifestPath = path.join(HOST_PLUGINS_DIR, entry.name, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              if (manifest.id && manifest.type === 'host') list.push(manifest);
            } catch (e) { /* 损坏的manifest跳过 */ }
          }
        }
      }
    } catch (e) { /* ignore */ }
    res.json(list);
  });

  app.get('/api/plugins/host-entry', (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: '缺少id' });
    const safeId = cleanRuleName(id);
    const entryPath = path.join(HOST_PLUGINS_DIR, safeId, 'index.js');
    if (!path.resolve(entryPath).startsWith(path.resolve(HOST_PLUGINS_DIR))) return res.status(403).json({ error: '路径越界' });
    if (!fs.existsSync(entryPath)) return res.status(404).json({ error: 'host插件不存在' });
    res.type('application/javascript; charset=utf-8');
    res.send(fs.readFileSync(entryPath, 'utf8'));
  });

  // 写入插件（AI 工具调用）：{ system, id, name, version, description, entry }
  app.post('/api/plugins/save', (req, res) => {
    const { system, id, name, version, description, entry } = req.body || {};
    if (!system || !id) return res.status(400).json({ error: '缺少system或id' });
    const safeSystem = cleanRuleName(system);
    const safeId = cleanRuleName(id);
    const pluginDir = path.join(RULER_DIR, safeSystem, 'plugins', safeId);
    if (!path.resolve(pluginDir).startsWith(path.resolve(RULER_DIR))) return res.status(403).json({ error: '路径越界' });
    fs.mkdirSync(pluginDir, { recursive: true });
    const manifest = {
      id: safeId,
      name: String(name || safeId),
      version: String(version || '1.0'),
      description: String(description || ''),
      type: 'panel',
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    if (typeof entry === 'string' && entry.trim()) {
      fs.writeFileSync(path.join(pluginDir, 'index.js'), entry, 'utf8');
    }
    console.log(`[插件] 已写入: ${safeSystem}/${safeId}`);
    res.json({ success: true, manifest });
  });
};
