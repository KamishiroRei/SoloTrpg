// ── 战斗路由（combat API） ──
// 依赖注入 ctx = { engine }（createCombatEngine 实例）；由 server.js 挂载
// 通用框架原则：这些 API 只暴露"事件总线/询问原语/回合状态机"等通用机制，
// 规则书功能（DND 反应等）由 AI 用行为数据建立，路由不感知任何规则书概念。

module.exports = function registerCombatRoutes(app, ctx) {
  const engine = ctx.engine;

  app.get('/api/combat/state', (req, res) => {
    const st = engine.loadCombatState(req.query.system, req.query.adventure);
    res.json({ success: true, combat: st });
  });

  app.post('/api/combat/start', (req, res) => {
    const { system, adventure } = req.body || {};
    res.json(engine.startCombat(system, adventure));
  });

  app.post('/api/combat/advance', (req, res) => {
    const { system, adventure } = req.body || {};
    res.json(engine.advance(system, adventure));
  });

  app.post('/api/combat/end-round', (req, res) => {
    const { system, adventure } = req.body || {};
    res.json(engine.endRound(system, adventure));
  });

  app.post('/api/combat/end', (req, res) => {
    const { system, adventure } = req.body || {};
    try { res.json(engine.endCombat(system, adventure)); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // 事件总线：外部事件上报（[[event:hook|source|target]]）→ 匹配 hook 规则 → 生成询问/执行
  app.post('/api/combat/event', (req, res) => {
    const { system, adventure } = req.body || {};
    const ev = (req.body || {}).event || {};
    res.json(engine.emitEvent(system, adventure, ev));
  });

  // 读取待处理询问（不消费）
  app.get('/api/combat/asks', (req, res) => {
    res.json(engine.getPendingAsks(req.query.system, req.query.adventure));
  });

  // 选择/跳过询问（选项带 actions 由引擎执行，否则返回给 AI 结算）
  app.post('/api/combat/ask', (req, res) => {
    const { system, adventure, unit, askId, optionIndex, skip } = req.body || {};
    res.json(engine.askSelect(system, adventure, unit, askId, optionIndex, !!skip));
  });

  // 兼容旧名（反应语义 → 统一询问语义）
  app.get('/api/combat/reactions', (req, res) => {
    res.json(engine.getPendingAsks(req.query.system, req.query.adventure));
  });
  app.post('/api/combat/react', (req, res) => {
    const { system, adventure, unit, reactionId, optionIndex, skip } = req.body || {};
    res.json(engine.askSelect(system, adventure, unit, reactionId || '', optionIndex, !!skip));
  });

  app.get('/api/combat/pending-handoffs', (req, res) => {
    const { system, adventure } = req.query || {};
    const list = engine.loadHandoffs(system, adventure);
    engine.saveHandoffs(system, adventure, []);
    res.json({ success: true, handoffs: list });
  });
};
