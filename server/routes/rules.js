// ── 规则书路由（管理/读取/文件 API；从 server.js 拆分） ──
// 依赖注入 ctx = { fs, path, RULER_DIR, isPathAllowed, appConfig, callAI, cleanRuleName,
//   listFilesRecursive, loadRuleSystemSettings, readRulebookTaskStatus, appendRulebookTaskLog,
//   cleanRuleSystemDirForReparse, runRulebookIngestAgent }
module.exports = function registerRulesRoutes(app, ctx) {
  const {
    fs, path, RULER_DIR, isPathAllowed, appConfig, callAI, cleanRuleName,
    listFilesRecursive, loadRuleSystemSettings, readRulebookTaskStatus, appendRulebookTaskLog,
    cleanRuleSystemDirForReparse, runRulebookIngestAgent
  } = ctx;

  // 获取规则书缓存列表
  app.get('/api/rules/list', (req, res) => {
    const systems = [];
    if (fs.existsSync(RULER_DIR)) {
      const entries = fs.readdirSync(RULER_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sysPath = path.join(RULER_DIR, entry.name);
          const rootFiles = fs.readdirSync(sysPath).filter(f => f.endsWith('.md'));
          const sourceDir = path.join(sysPath, 'source');
          const sourceFiles = fs.existsSync(sourceDir)
            ? listFilesRecursive(sourceDir).filter(f => f.endsWith('.md')).map(f => `source/${f.replace(/\\/g, '/')}`)
            : [];
          const files = [...rootFiles, ...sourceFiles].sort((a, b) => a.localeCompare(b, 'zh-CN'));
          systems.push({
            name: entry.name,
            files: files,
            settings: loadRuleSystemSettings(sysPath, entry.name, files),
            path: sysPath
          });
        }
      }
    }
    res.json(systems);
  });

  // 读取规则缓存内容
  app.get('/api/rules/read', (req, res) => {
    const { system, file } = req.query;
    if (!system || !file) return res.status(400).json({ error: '请指定系统名称和文件名' });
    const filePath = path.join(RULER_DIR, system, file);
    if (!filePath.startsWith(RULER_DIR)) return res.status(403).json({ error: '禁止访问的路径' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    res.json({ content: fs.readFileSync(filePath, 'utf8'), system, file });
  });

  // 保存/更新规则缓存
  app.post('/api/rules/save', (req, res) => {
    const { system, file, content } = req.body;
    if (!system || !file) return res.status(400).json({ error: '请指定系统名称和文件名' });
    const sysDir = path.join(RULER_DIR, system);
    if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
    const filePath = path.join(sysDir, file);
    if (!filePath.startsWith(RULER_DIR)) return res.status(403).json({ error: '禁止访问的路径' });
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true, path: filePath });
  });

  app.get('/api/rules/task-status', (req, res) => {
    const { system } = req.query;
    if (!system) return res.status(400).json({ error: '请指定系统名称' });
    try { res.json(readRulebookTaskStatus(system)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/rules/task-log', (req, res) => {
    const { system, phase, message, detail } = req.body || {};
    if (!system) return res.status(400).json({ error: '请指定系统名称' });
    try {
      const entry = appendRulebookTaskLog(system, phase, message, detail || {});
      res.json({ success: true, entry });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/rules/agent-run', async (req, res) => {
    const { system, resume, reparse } = req.body || {};
    if (!system) return res.status(400).json({ error: '请指定系统名称' });
    const abortController = new AbortController();
    // 仅当响应未完成时连接关闭才算客户端断开；Node中req.on('close')在请求体读完即触发，不可用于断连判断
    res.on('close', () => { if (!res.writableEnded) abortController.abort(); });
    if (resume) appendRulebookTaskLog(system, 'agent_resumed', '用户触发续接，规则书接管Agent继续执行');
    if (reparse) {
      const reparseTarget = cleanRuleSystemDirForReparse(system);
      appendRulebookTaskLog(system, 'agent_reparse', '用户触发重新解析，已清空旧规则文本与配置', { cleared: reparseTarget });
    }
    const providerKey = appConfig.ai.activeProvider;
    const provider = appConfig.ai.providers[providerKey];
    if (!provider || !provider.enabled || !provider.endpoint || !provider.model) {
      return res.status(400).json({ error: 'AI未配置，无法启动规则书接管Agent' });
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    try {
      const result = await runRulebookIngestAgent(system, provider, { signal: abortController.signal, onEvent: send, resume: !!resume });
      send({ type: 'done', result });
      res.end();
    } catch (err) {
      if (abortController.signal.aborted) {
        appendRulebookTaskLog(system, 'agent_aborted', '前端连接关闭，规则书接管Agent已中止');
        send({ type: 'error', error: '任务已中止' });
        res.end();
        return;
      }
      appendRulebookTaskLog(system, 'agent_failed', '规则书接管Agent失败', { error: err.message });
      send({ type: 'error', error: err.message });
      res.end();
    }
  });

  // 删除规则系统（含目录内所有内容：母本、拆解、配置、日志）
  app.post('/api/rules/delete', (req, res) => {
    const { system } = req.body || {};
    if (!system) return res.status(400).json({ error: '请指定系统名称' });
    const safeSystem = cleanRuleName(system);
    const targetDir = path.join(RULER_DIR, safeSystem);
    if (!path.resolve(targetDir).startsWith(path.resolve(RULER_DIR))) return res.status(403).json({ error: '路径越界' });
    if (!fs.existsSync(targetDir)) return res.status(404).json({ error: '规则系统不存在' });
    fs.rmSync(targetDir, { recursive: true, force: true });
    console.log(`[规则书] 已删除规则系统: ${safeSystem}`);
    res.json({ success: true, system: safeSystem });
  });

  // AI文件写入（限定在Ruler内）
  app.post('/api/ai/write', (req, res) => {
    const { system, subpath, content } = req.body;
    const targetPath = path.resolve(RULER_DIR, system || 'DND', subpath || '');
    if (!isPathAllowed(targetPath)) return res.status(403).json({ error: '路径不在允许范围内' });
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
    res.json({ success: true, path: targetPath });
  });

  // AI处理规则书内容：发送文本给AI，让AI总结为MD格式
  app.post('/api/rules/process', async (req, res) => {
    const { system, fileName, content, provider: reqProvider } = req.body;
    const providerKey = reqProvider || appConfig.ai.activeProvider;
    const provider = appConfig.ai.providers[providerKey];
    if (!provider || !provider.enabled || !provider.apiKey) {
      return res.status(400).json({ error: 'AI未配置，无法处理规则书' });
    }
    const systemPrompt = `你是一个TRPG规则专家。请将以下规则书内容整理为清晰的结构化Markdown表格，便于快速查询和游戏时参考。

要求：
1. 使用Markdown表格整理核心数据（如职业表、武器表、法术表、技能表等）
2. 保留关键数值和机制描述
3. 按主题分章节，使用##标题
4. 对复杂规则添加简要的"快速参考"说明
5. 保留原文中的关键术语
6. 输出纯Markdown，不要多余说明`;
    try {
      const result = await callAI(provider.endpoint, provider.apiKey, provider.model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请整理以下规则内容：\n\n${content.substring(0, 50000)}` }
      ]);
      if (system && fileName) {
        const sysDir = path.join(RULER_DIR, system);
        if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
        const mdFileName = fileName.replace(/\.(pdf|chm|txt)$/i, '.md');
        fs.writeFileSync(path.join(sysDir, mdFileName), result.content, 'utf8');
      }
      res.json({ content: result.content, cached: true });
    } catch (err) {
      res.status(500).json({ error: `AI处理失败: ${err.message}` });
    }
  });
};
