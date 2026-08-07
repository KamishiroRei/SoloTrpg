// ── AI 对话路由（chat / prompt-profile / system-chat / chat-stream；从 server.js 拆分） ──
// 依赖注入 ctx = { fs, path, appConfig, callAI, callAIStream, runGmToolLoop, runPluginTool, PLUGIN_TOOLS,
//   buildAiPromptProfile, cleanRuleName, lastUserContent, PROMPT_PROFILE_VERSION,
//   loadSession, appendSession, sessionFilePath, repairSessionTools, appendPrivateSession }
module.exports = function registerAiRoutes(app, ctx) {
  const {
    fs, path, appConfig, callAI, callAIStream, runGmToolLoop, runPluginTool, PLUGIN_TOOLS,
    buildAiPromptProfile, cleanRuleName, lastUserContent, PROMPT_PROFILE_VERSION,
    loadSession, appendSession, sessionFilePath, repairSessionTools, appendPrivateSession
  } = ctx;

  app.post('/api/ai/chat', async (req, res) => {
    const { messages, provider: reqProvider, model: reqModel, system: reqSystem, adventure: reqAdventure, channel: reqChannel, private: isPrivate } = req.body;
    const providerKey = reqProvider || appConfig.ai.activeProvider;
    const provider = appConfig.ai.providers[providerKey];
    if (!provider || !provider.enabled) return res.status(400).json({ error: 'AI提供商未启用或不存在' });
    if (!provider.endpoint) return res.status(400).json({ error: '请先设置API地址' });
    if (providerKey === 'gpt' && !provider.apiKey) return res.status(400).json({ error: '请先设置API Key' });
    const model = reqModel || provider.model;
    if (!model) return res.status(400).json({ error: '请先选择或输入模型' });
    try {
      const result = await callAI(provider.endpoint, provider.apiKey, model, messages, { reasoningEffort: appConfig.ai.reasoningEffort || 'high' });
      // D+会话持久化：玩家频道（带channel时）保存本轮 user+assistant 消息（私聊落私聊文件）
      if (reqChannel && Array.isArray(messages) && messages.length) {
        const lastUser = messages.slice().reverse().find(m => m.role === 'user');
        const savedMsgs = [];
        if (lastUser) savedMsgs.push({ role: 'user', content: String(lastUser.content || '') });
        savedMsgs.push({ role: 'assistant', content: String(result.content || '') });
        if (isPrivate) appendPrivateSession(reqSystem, String(reqAdventure || '默认'), 'ai', reqChannel, savedMsgs);
        else appendSession(reqSystem, String(reqAdventure || '默认'), reqChannel, savedMsgs);
      }
      res.json(result);
    } catch (err) {
      console.error('[AI] 调用失败:', err.message);
      res.status(500).json({ error: `AI调用失败: ${err.message}` });
    }
  });

  app.get('/api/ai/prompt-profile', (req, res) => {
    try {
      const prompt = buildAiPromptProfile({
        profile: req.query.profile || '',
        channel: req.query.channel || 'system',
        system: cleanRuleName(String(req.query.system || '')),
        moduleName: cleanRuleName(String(req.query.moduleName || '')),
        modulePath: String(req.query.modulePath || ''),
        taskPath: String(req.query.taskPath || ''),
        text: String(req.query.text || '')
      });
      res.type('text/plain; charset=utf-8').send(prompt);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 系统频道：opencode 式开发 Agent 循环（工具调用/压缩/空转检测；对标 opencode 源码，不硬编码轮数）
  app.post('/api/ai/system-chat', async (req, res) => {
    const { messages, provider: reqProvider, model: reqModel, system: reqSystem, reasoningEffort: reqEffort, adventure: reqAdventure, channel: reqChannel, promptProfile: reqPromptProfile, private: isPrivate } = req.body || {};
    const providerKey = reqProvider || appConfig.ai.activeProvider;
    const provider = appConfig.ai.providers[providerKey];
    if (!provider || !provider.enabled) return res.status(400).json({ error: 'AI提供商未启用或不存在' });
    const model = reqModel || provider.model;
    if (!model) return res.status(400).json({ error: '请先选择或输入模型' });

    const abortController = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abortController.abort(); });
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

    const sessAdventure = String(reqAdventure || '默认');
    const sessChannel = String(reqChannel || '');
    let loadedSession;
    try {
      // 私聊（导演指令）读取私聊会话文件作上下文，与公屏历史互不污染
      loadedSession = sessChannel ? (isPrivate ? loadPrivateSession(reqSystem, sessAdventure, 'ai', sessChannel) : loadSession(reqSystem, sessAdventure, sessChannel)) : [];
    } catch (e) {
      console.error('[会话] 加载历史失败:', e.message);
      loadedSession = [];
    }
    let history = Array.isArray(messages) ? messages.slice() : [];
    // 落盘统一入口：私聊（导演指令）写私聊会话文件，公屏写频道文件
    const persistSession = (msgs) => {
      if (!sessChannel) return;
      if (isPrivate) appendPrivateSession(reqSystem, sessAdventure, 'ai', sessChannel, msgs);
      else appendSession(reqSystem, sessAdventure, sessChannel, msgs);
    };
    // D+：本次请求的新 user 消息落盘（首次时含会话起点一并落盘；私聊落私聊文件）
    if (sessChannel) {
      const newUsers = history.filter(m => m.role === 'user' && String(m.content || '').indexOf('【会话起点】') < 0);
      if (!loadedSession.length) {
        const sysFirst = history.find(m => m.role === 'system');
        if (sysFirst) persistSession([{ role: 'user', content: '【会话起点】' + String(sysFirst.content || '').substring(0, 500) }]);
      }
      if (newUsers.length) persistSession(newUsers);
    }
    if (loadedSession.length) {
      let effectiveSession = loadedSession;
      if (sessChannel) {
        try {
          const histSize = loadedSession.reduce((sum, m) => sum + String(m.content || '').length, 0);
          if (histSize > 600000) {
            const sysMsgs = loadedSession.filter(m => m.role === 'system' && (String(m.content || '').indexOf('【会话起点】') >= 0 || String(m.content || '').indexOf('【对话自动压缩摘要') >= 0));
            const tail = loadedSession.slice(-60);
            effectiveSession = sysMsgs.concat(tail);
            console.log(`[会话] 历史超限自动精简（${histSize}字符 → ${effectiveSession.length}条）`);
          }
        } catch (e) { console.error('[会话] 精简失败（回退全量）:', e.message); }
      }
      const persistedUserMsgs = effectiveSession.filter(m => m.role === 'user').map(m => String(m.content));
      const freshMsgs = history.filter(m => m.role !== 'system' && !(m.role === 'user' && persistedUserMsgs.includes(String(m.content))));
      history = effectiveSession.concat(freshMsgs);
      if (!freshMsgs.length) {
        const lastUser = history.slice().reverse().find(m => m.role === 'user');
        if (!lastUser) history.push({ role: 'user', content: '继续' });
      }
    }
    // 发送前自愈：客户端历史/会话文件中可能残留孤儿 tool_calls（中断运行遗留），不修会触发 API 400
    history = repairSessionTools(history);
    const injectedPrompt = buildAiPromptProfile({
      profile: reqPromptProfile,
      channel: sessChannel || reqChannel || 'system',
      system: cleanRuleName(String(reqSystem || '')),
      text: lastUserContent(history)
    });
    const firstSystem = history.findIndex(m => m.role === 'system');
    if (firstSystem >= 0) {
      const sysContent = String(history[firstSystem].content || '');
      const addNote = sysContent.indexOf(PROMPT_PROFILE_VERSION) < 0 ? '\n\n' + injectedPrompt : '';
      history[firstSystem] = Object.assign({}, history[firstSystem], { content: sysContent + addNote });
    } else {
      history.unshift({ role: 'system', content: injectedPrompt });
    }
    if (sessChannel && loadedSession.length) {
      const lastMsg = loadedSession[loadedSession.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && typeof lastMsg.content === 'string' && lastMsg.content.trim().length > 50) {
        const resumeHint = '\n\n===== 会话续接提示 =====\n你正在继续一个已有会话。上一条AI结论是："' + String(lastMsg.content).substring(0, 300) + '"……\n如果本条消息是继续/追加需求，直接基于以上会话历史推进（历史完整可用），不要重新通读文件或重新搜索；除非新需求明确要求检查最新状态。';
        history[history.length - 1] = Object.assign({}, history[history.length - 1], {
          content: String(history[history.length - 1].content || '') + resumeHint
        });
      }
    }
    const cfgContextLimit = Number(appConfig.ai && appConfig.ai.contextLimit) || 128000;
    const cfgMaxOutput = Number(appConfig.ai && appConfig.ai.maxOutputTokens) || 8192;
    const usableBudget = Math.max(0, cfgContextLimit - Math.min(20000, cfgMaxOutput));
    const preserveRecentTokens = Math.min(8000, Math.max(2000, Math.floor(usableBudget * 0.25)));
    const TAIL_TURNS = 2;
    let rounds = 0;
    let lastCompactRound = loadedSession.length ? 0 : -99;
    let emptyRetries = 0;
    const READONLY_TOOL_NAMES = new Set(['read_file', 'grep', 'glob', 'list_files', 'list_tree', 'get_status', 'webfetch', 'websearch', 'skill']);
    let idleStreak = 0;
    let lastReadFiles = [];
    const IDLE_WARN_LEVEL1 = 3;
    const IDLE_WARN_LEVEL2 = 6;
    const SAME_FILE_REPEAT = 3;
    try {
      while (true) {
        if (abortController.signal.aborted) throw new Error('已中止');
        rounds++;
        const result = await callAI(provider.endpoint, provider.apiKey, model, history, {
          tools: PLUGIN_TOOLS,
          reasoningEffort: reqEffort || appConfig.ai.reasoningEffort,
          timeoutMs: 120000,
          signal: abortController.signal
        });
        if (result.usage) send({ type: 'usage', round: rounds, usage: result.usage });
        const raw = String(result.content || '').trim();
        const toolCalls = result.toolCalls || [];
        if (result.reasoningContent) send({ type: 'ai_thinking', text: String(result.reasoningContent) });
        if (raw) send({ type: 'ai_text', text: raw });
        if (!toolCalls.length) {
          // 空输出（无内容无工具调用）：重试推进，最多2次（防失控保留项）
          if (!raw && emptyRetries < 2) {
            emptyRetries++;
            history.push({ role: 'user', content: '你刚才没有输出内容也没有调用工具。请继续推进任务：基于已读取的信息直接修改插件（edit/write_file），完成后用纯文本总结。' });
            continue;
          }
          if (sessChannel && raw) persistSession([{ role: 'assistant', content: raw }]);
          send({ type: 'done', content: raw, rounds });
          res.end();
          return;
        }
        emptyRetries = 0;
        history.push({
          role: 'assistant',
          content: raw,
          tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } }))
        });
        if (result.reasoningContent) history[history.length - 1].reasoning_content = result.reasoningContent;
        if (sessChannel) persistSession([history[history.length - 1]]);
        for (const tc of toolCalls) {
          let args = {};
          try { args = JSON.parse(tc.arguments || '{}') || {}; } catch (e) { args = {}; }
          send({ type: 'tool', tool: tc.name, args });
          const out = await runPluginTool(tc.name, args, reqSystem, { emit: send, provider, model, signal: abortController.signal });
          send({ type: 'tool_result', tool: tc.name, result: out });
          // 工具结果完整入历史，不做外部截断：AI自行根据上下文长度预估读取量（full/按需模式）
          history.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
          if (sessChannel) persistSession([history[history.length - 1]]);
          if (tc.name === 'read_file' && args.path) {
            lastReadFiles.push(String(args.path).replace(/^plugins\//, '').replace(/^Ruler\/DND五版不全书\//, ''));
            if (lastReadFiles.length > 30) lastReadFiles.shift();
          }
        }
        const keepReasoningRounds = 2;
        const reasoningIdx = [];
        for (let hi = history.length - 1; hi >= 0; hi--) {
          if (history[hi].role === 'assistant' && history[hi].reasoning_content) {
            reasoningIdx.push(hi);
            if (reasoningIdx.length >= keepReasoningRounds) break;
          }
        }
        const keepSet = {};
        reasoningIdx.forEach(function (i) { keepSet[i] = true; });
        history.forEach(function (m, i) {
          if (m.role === 'assistant' && m.reasoning_content && !keepSet[i]) {
            m.reasoning_content = '';
          }
        });
        // 空转检测分级：连续"无正文输出+全只读工具"轮次
        const allReadOnly = toolCalls.length > 0 && toolCalls.every(tc => READONLY_TOOL_NAMES.has(tc.name));
        if (!raw && allReadOnly) {
          idleStreak++;
          const fileCount = {};
          lastReadFiles.forEach(function (f) { fileCount[f] = (fileCount[f] || 0) + 1; });
          const repeatFiles = Object.keys(fileCount).filter(function (f) { return fileCount[f] >= SAME_FILE_REPEAT; });
          if (repeatFiles.length > 0) {
            idleStreak = 0;
            lastReadFiles = [];
            const msg = '检测到你多次读取同一文件（' + repeatFiles.map(function (f) { return f + '×' + fileCount[f]; }).join('、') + '）。请自我评估：是否在重复读取已有信息？若是，立即用 grep 定位目标函数，一次读取200-400行目标区域后直接 edit/write_file 修改；若需求矛盾或无法执行，用 question 工具向用户指出矛盾点。';
            send({ type: 'ai_text', text: '⚠ ' + msg });
            history.push({ role: 'user', content: msg });
            continue;
          }
          if (idleStreak >= IDLE_WARN_LEVEL2) {
            idleStreak = 0;
            const msg = '检测到连续多轮只读取未修改。请立即停止继续读取：用已读信息直接 edit/write_file 完成修改，再验证。若需求矛盾无法执行，用 question 工具向用户指出矛盾点请求解答。';
            send({ type: 'ai_text', text: '⚠ ' + msg });
            history.push({ role: 'user', content: msg });
            continue;
          }
          if (idleStreak === IDLE_WARN_LEVEL1) {
            const msg = '提醒：已连续' + idleStreak + '轮只读取未修改。请自我评估是否在有效推进：若已有足够信息请直接 edit/write_file 修改；若需求不明确或矛盾，用 question 工具向用户确认；不要继续无目的探索。';
            send({ type: 'ai_text', text: '💡 ' + msg });
            history.push({ role: 'user', content: msg });
          }
        } else {
          idleStreak = 0;
          if (!allReadOnly) lastReadFiles = [];
        }
        const compactThreshold = Number(appConfig.ai && appConfig.ai.compactThreshold) || 0.7;
        const COMPACT_COOLDOWN_ROUNDS = 15;
        const usage = result.usage || {};
        const ctxTokens = usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
        if (ctxTokens >= usableBudget * compactThreshold && history.length > 6 && rounds - lastCompactRound > COMPACT_COOLDOWN_ROUNDS) {
          // 从尾部往前数 TAIL_TURNS 个 user 轮次，保留尾部预算 preserveRecentTokens
          const userIdx = [];
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'user') { userIdx.push(i); if (userIdx.length >= TAIL_TURNS) break; }
          }
          let tailStart = userIdx.length ? userIdx[userIdx.length - 1] : 2;
          if (tailStart < 2) tailStart = 2;
          const head = history.slice(0, 1);
          const tail = history.slice(tailStart);
          let lastSummaryIdx = -1;
          for (let i = history.length - 1; i >= 0; i--) {
            const m = history[i];
            if (m.role === 'system' && typeof m.content === 'string' && m.content.indexOf('【对话自动压缩摘要') >= 0) { lastSummaryIdx = i; break; }
          }
          const midStart = lastSummaryIdx >= 0 ? lastSummaryIdx : 1;
          const mid = history.slice(midStart, tailStart);
          try {
            const summary = await callAI(provider.endpoint, provider.apiKey, model, [
              { role: 'system', content: '你是对话压缩器。输入为【旧摘要】（上一次压缩结果，可能为空）+【新进展】（旧摘要之后的对话）。你的任务：把两者合并为一份**最新完整摘要**，供后续轮次直接继续执行。\n\n## 合并规则（强制）\n1. 以旧摘要为骨架，保留其全部有效小节与关键结论（目标/已确认内容/工作状态/下一步）。\n2. 把新进展中**新增/变化**的内容并入对应小节：新确认的文件与数据、新完成的修改、新决策、进展更新。\n3. 相同条目以新进展为准覆盖旧条目；过期/已完成的事项移入「已完成」。\n4. **只输出合并后的完整摘要**（不要重复新进展原文，不要提及压缩过程）。\n\n## 摘要模板（输出必须完整包含以下小节，即使为空）\n## 目标（Objective）\n- 用户要完成什么\n\n## 重要细节（Important Details）\n- 约束/偏好/决策/关键事实，或 (none)\n\n## 已确认内容（Confirmed Facts，必填）\n- 本任务已读取/确认过的文件与关键数据结论（如"种族列表：龙裔/矮人/精灵…已从X.htm读取"），每条一短行。\n\n## 工作状态（Work State）\n### 已完成（Completed）\n### 进行中（Active）\n### 受阻（Blocked）\n\n## 下一步（Next Move）\n1. ...\n\n## 相关文件（Relevant Files）\n- 路径：为什么相关\n\n规则：保留精确文件路径、工具名、关键数据；用简短要点不用长段落。' },
              { role: 'user', content: '## 旧摘要（上一次压缩结果，可能为空）\n' + (lastSummaryIdx >= 0 ? String(history[lastSummaryIdx].content || '').replace('【对话自动压缩摘要，原中间消息已移除】', '').trim() : '（无旧摘要）') + '\n\n## 新进展（旧摘要之后的对话，JSON）\n' + JSON.stringify(mid.filter(m => m !== history[midStart] || lastSummaryIdx < 0).map(m => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content.substring(0, 800) : '',
                tool: m.tool_calls && m.tool_calls[0] && m.tool_calls[0].function ? m.tool_calls[0].function.name : '',
                result: typeof m.content === 'string' ? '' : String(m.content || '').substring(0, 300)
              }))).substring(0, 60000) }
            ], { timeoutMs: 60000 });
            const summaryText = (summary && summary.content) ? String(summary.content).trim().substring(0, 4000) : '';
            if (summaryText) {
              history = head.concat([{ role: 'system', content: '【对话自动压缩摘要，原中间消息已移除】\n' + summaryText + '\n\n（摘要未覆盖的细节不再保留——如需要，请自行读取文件/数据确认，不要期望从历史中找到。）' }], tail);
            } else {
              history = head.concat(tail);
            }
            lastCompactRound = rounds;
            if (sessChannel && sessAdventure) {
              try {
                const file = sessionFilePath(reqSystem, sessAdventure, sessChannel);
                if (fs.existsSync(file)) {
                  const keepMsgs = history.filter(m => m.role !== 'system' || m.content.indexOf('【对话自动压缩摘要') >= 0 || m.content.indexOf('【会话起点】') >= 0);
                  const lines = keepMsgs
                    .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
                    .map(m => {
                      const slim = { role: m.role, content: m.content };
                      if (m.tool_calls) slim.tool_calls = m.tool_calls;
                      if (m.reasoning_content) slim.reasoning_content = m.reasoning_content;
                      if (m.role === 'tool') slim.tool_call_id = m.tool_call_id || '';
                      if (m.role === 'user' || m.role === 'assistant') slim.id = m.id || ('m_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
                      return JSON.stringify(slim);
                    });
                  fs.writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
                  console.log(`[会话] 压缩后已同步重写 jsonl（${lines.length} 条）`);
                }
              } catch (e) { console.error('[会话] 压缩落盘失败:', e.message); }
            }
            send({ type: 'ai_text', text: '（上下文已自动压缩，继续执行）' });
            history.push({ role: 'user', content: 'Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.' });
          } catch (e) {
            history = head.concat(tail);
          }
        }
      }
    } catch (err) {
      if (abortController.signal.aborted) { send({ type: 'aborted' }); res.end(); return; }
      send({ type: 'error', error: String(err.message || '').substring(0, 300) });
      res.end();
    }
  });

  app.post('/api/ai/chat-stream', async (req, res) => {
    const { messages, provider: reqProvider, model: reqModel, system: reqSystem, adventure: reqAdventure, channel: reqChannel, gmTools, private: isPrivate } = req.body;
    const providerKey = reqProvider || appConfig.ai.activeProvider;
    const provider = appConfig.ai.providers[providerKey];
    if (!provider || !provider.enabled) return res.status(400).json({ error: 'AI提供商未启用或不存在' });
    if (!provider.endpoint) return res.status(400).json({ error: '请先设置API地址' });
    if (providerKey === 'gpt' && !provider.apiKey) return res.status(400).json({ error: '请先设置API Key' });
    const model = reqModel || provider.model;
    if (!model) return res.status(400).json({ error: '请先选择或输入模型' });
    try {
      let sessContent = '';
      // 上下文连续性（服务端权威）：带 channel 的请求从会话文件加载历史作为 AI 记忆——
      // 此前完全依赖客户端内存 contextWindow，F5/重启即失忆（曾致 AI 忘掉已找到的设定集路径，从 C 盘根目录重新乱找）。
      // 会话共享：同一频道的公屏对话 + GM 私聊（导演指令）合并为同一个 AI 会话（按时间序、继承缓存）；
      // 私聊 user 消息标记【GM 导演指令】，AI 区分两者：指令权威且对玩家不可见。
      let payload = messages;
      if (reqChannel && Array.isArray(messages) && messages.length) {
        try {
          const strip = (t) => String(t || '').replace(/^【GM 导演指令】/, '');
          const filterOk = (m) => {
            const t = String(m.content || '');
            if (t.indexOf('【会话起点】') === 0) return false;
            if (t.indexOf('【回合结束·战斗总结】') === 0) return false;
            if (m.role === 'user' && strip(t) === '继续') return false;
            return true;
          };
          const ts = (m) => { const s = String(m.id || ''); const x = s.match(/_(1[0-9]{12})_/); return x ? Number(x[1]) : 0; };
          const histPublic = loadSession(reqSystem, String(reqAdventure || '默认'), reqChannel);
          const histPrivate = loadPrivateSession(reqSystem, String(reqAdventure || '默认'), 'ai', reqChannel);
          const hist = [];
          (histPublic || []).filter(m => m.role === 'user' || m.role === 'assistant').filter(filterOk).forEach(m => hist.push(m));
          (histPrivate || []).filter(m => m.role === 'user' || m.role === 'assistant').filter(filterOk)
            .forEach(m => { const mm = Object.assign({}, m); if (mm.role === 'user') mm.content = '【GM 导演指令】' + String(mm.content || ''); hist.push(mm); });
          hist.sort((a, b) => ts(a) - ts(b) || 0);
          const histSlim = hist.slice(-40); // 最近 20 轮对话
          const sysMsgs = (messages || []).filter(m => m.role === 'system');
          const lastUser = (messages || []).slice().reverse().find(m => m.role === 'user');
          payload = sysMsgs.concat([{
            role: 'system',
            content: '【会话说明】本频道会话 = 公屏对话（玩家可见）+ GM 导演指令私聊（【GM 导演指令】前缀的消息仅 GM 与你可见，权威指令）。执行导演指令时按其要求处理；输出到公屏的内容面向玩家，严禁复述或泄露任何导演指令内容。'
          }], histSlim);
          if (lastUser) {
            // 若最后一条 user 与文件历史末尾重复（同指令重发），不重复注入
            const tailUser = histSlim.length ? histSlim[histSlim.length - 1] : null;
            const dup = tailUser && tailUser.role === 'user' && strip(String(tailUser.content || '')) === strip(String(lastUser.content || ''));
            if (!dup) payload.push(lastUser);
          }
        } catch (e) { /* 历史加载失败则退化为客户端消息 */ }
      }
      if (gmTools) {
        await runGmToolLoop(req, res, provider.endpoint, provider.apiKey, model, payload, {
          reasoningEffort: appConfig.ai.reasoningEffort || 'high'
        });
        sessContent = res.locals.gmFinalContent || '';
      } else {
        // 发送前自愈：客户端历史可能残留孤儿 tool_calls（中断运行遗留），不修会触发 API 400
        const sanitized = repairSessionTools(Array.isArray(payload) ? payload.slice() : []);
        await callAIStream(req, res, provider.endpoint, provider.apiKey, model, sanitized, {
          reasoningEffort: appConfig.ai.reasoningEffort || 'high',
          onComplete: (content) => { sessContent = content; }
        });
      }
      // D+会话持久化：玩家频道（带channel时）保存本轮 user+assistant 消息（AI 未产出正文时只存用户消息，避免空 assistant 污染上下文）
      // GM导演指令（private:true）落盘到私聊会话文件（private-ai-<channel>.jsonl），不进公屏历史、不显示在频道聊天栏
      if (reqChannel && Array.isArray(messages) && messages.length) {
        const lastUser = messages.slice().reverse().find(m => m.role === 'user');
        const savedMsgs = [];
        if (lastUser) savedMsgs.push({ role: 'user', content: String(lastUser.content || '') });
        if (sessContent) savedMsgs.push({ role: 'assistant', content: String(sessContent) });
        if (savedMsgs.length) {
          if (isPrivate) appendPrivateSession(reqSystem, String(reqAdventure || '默认'), 'ai', reqChannel, savedMsgs);
          else appendSession(reqSystem, String(reqAdventure || '默认'), reqChannel, savedMsgs);
        }
      }
    } catch (err) {
      if (!res.writableEnded) {
        res.status(500).json({ error: `AI调用失败: ${err.message}` });
      }
    }
  });
};
