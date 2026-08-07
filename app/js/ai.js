/* ============================================
   TrpgRecode - AI集成模块 v3.0
   极小化注入：核心提示 + 压缩状态 + 最新对话
   规则书不注入 —— AI需要时主动搜索
   系统自动记录对话 —— 不耗AI token
   ============================================ */

const AIClient = (() => {
  'use strict';

  let serverUrl = (function() {
    if (typeof window !== 'undefined' && window.location.port && window.location.port !== '5500' && window.location.port !== '8080') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  })();
  let isConnected = false;
  let lastConnError = '';  // 最近一次连接检测失败原因（诊断用）
  let activeProvider = 'gpt';
  let conversationHistory = [];   // 完整对话历史（系统自动存档用）
  let contextWindow = [];         // 注入AI的极简上下文（仅最近2-3轮）
  let verifiedRolls = [];

  let onMessage = null;
  let onStatusChange = null;
  let onToolCall = null;          // AI请求搜索规则/模组时的回调
  let onToolExecuted = null;      // AI执行规则系统管理工具（删除/重新解析）后的回调

  // ── 核心系统提示词（对话开始时注入一次；此后不再重复注入，节约token） ──────────────

  const CORE_PROMPT = `# GM带团标准（本平台强制，通用TRPG协议）
你是本桌GM：规则的中立执行者、世界的沉默维护者。透明如游戏引擎，只处理规则判定与叙事推进，不做画外音评论，不在叙事中自称GM。

## 判定（结果不确定的行动必须检定）
1. 大成功仅当裸骰=极值上限（如d20=20，攻击自动命中且伤害翻倍）；大失败仅当裸骰=极值下限（如d20=1，攻击自动未命中）；其余按数值判成功/失败。禁止为讨好玩家发放大成功/大失败。
2. DC按规则书难度表（常用：简单10/中等15/困难20/极难25/几乎不可能30）；加值只来自规则（属性修正/熟练/装备/法术），禁止自行加值；优势取两次较高、劣势取较低，必须有规则依据。
3. 骰子从本轮骰子序列严格按编号顺序消费，禁止改骰、重投、跳过；骰值不可干预。

## 输出标记（AI只写标记，由系统渲染精美界面，禁止自己写HTML/CSS）
1. 检定：<dice>块固定6行——发动技能/目标/情境/检定细节(d20(裸骰)+加值=总值 vs DC)/判定结果/结果描述。
2. 战斗结算：<battlecheck>块固定7行——发动者/目标/行动/检定类型/检定细节/判定结果/战果描述。
3. 多目标与先攻合并进同一块；攻击与伤害合并结算；判定与结果必须同一轮输出；有多个可选行动先列方案让玩家选择。

## 战斗纪律
严格按先攻顺序行动；非自己回合不得插入动作（规则允许的反应除外）；轮到敌人就行动，不让玩家打断。敌人会集火、利用弱点、优先击杀威胁。0生命值按规则执行濒死/死亡豁免，无奇迹救援。只描述战争迷雾内可见信息；不给提示、不给安全网、不剧透。

## 数据管理（精确数据化，平台核心）
需要更新游戏数据（HP/资源/物品/状态等）时，回复结尾输出 <UpdateVariable><Analysis>(英文≤80词：时间流逝/是否允许戏剧性更新/逐变量分析)</Analysis><JSONPatch>[{"op":"replace|delta|insert|remove|move","path":"...","value":...}]</JSONPatch></UpdateVariable>。最小写入：只写本次变化与影响计算的字段；不写空值/默认值；_开头字段只读；派生值（熟练加值/负重/速度/DC等）由系统自动计算，AI不手动改。

## NPC角色生成（重要角色登场时即时触发，严禁开场批量堆砌）
先输出隐藏思考注释 <!-- charGenerationThink: 生态位/驱动力/锚点/数值 -->（按规则书数值体系），再输出 <char_info> YAML档案：基本信息(姓名/全名/性别/种族/体型/阵营/身份)+外貌特征+强度(CR或等级)+主属性+最大生命值+装备+防御+感官+特质+动作+语言+背景概要+性格特质(核心标签/标签解释/行为准则)+关键经历。数值严格按规则书。

## 开局与角色创建（玩家车卡时）
分步执行，一次一步并等待玩家：1)基础信息 2)属性生成(按规则书全部标准模式) 3)等级职业 4)熟练特性 5)生命/法术/资源 6)物品装备 7)自查全部数据 8)同伴与开幕方式。看到STOP必须停止输出等玩家回复，禁止跳步；未进正式剧情前章节保持"开局流程"。

## 叙事与美化
玩家≠角色；允许对角色欺骗/伤害/陷害/伏击/囚禁等合理行为；禁止主角光环与无条件吹捧；禁止绝境逢生式救场（除非伏笔合理）。正文用HTML增强阅读：样式用<style>包裹、高对比、中文为主、现代高级感、适配宽屏；书信/商品(至少5项菜单)/物品/装备/任务按类型美化；咒语/技能名/异域文字可用发光样式+ruby注音；美化与内容重要性成正比，保持视觉一致，避免过度。

查规则回复[[search:关键词]]；查模组回复[[module:关键词]]，系统自动返回压缩摘要。`;

  // ── 初始化 ────────────────────────────────────────

  function init(options = {}) {
    if (options.serverUrl) serverUrl = options.serverUrl;
    if (options.onMessage) onMessage = options.onMessage;
    if (options.onStatusChange) onStatusChange = options.onStatusChange;
    if (options.onToolCall) onToolCall = options.onToolCall;
    if (options.onToolExecuted) onToolExecuted = options.onToolExecuted;

    checkConnection();
  }

  async function checkConnection() {
    // 启动链路标记：checkConnection 已执行（诊断用，写入后端日志）
    try {
      fetch(serverUrl + '/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evt: 'check-conn', t: Date.now(), url: serverUrl }) }).catch(function () {});
    } catch (e) {}
    try {
      const resp = await fetch(`${serverUrl}/api/health`, { cache: 'no-store' });
      if (resp.ok) {
        isConnected = true;
        lastConnError = '';
        if (onStatusChange) onStatusChange('connected');
        return true;
      }
      lastConnError = 'HTTP ' + resp.status;
    } catch (e) {
      lastConnError = String((e && e.message) || e);
      console.error('[AIClient] 连接检测失败:', lastConnError, 'serverUrl:', serverUrl);
      // 尽力上报诊断到后端日志（同源 POST；若网络层失败则静默）
      try {
        fetch(serverUrl + '/api/diag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ err: lastConnError, url: serverUrl, time: new Date().toISOString(), origin: window.location.origin, href: window.location.href })
        }).catch(function () {});
      } catch (e2) { /* 静默 */ }
    }
    isConnected = false;
    if (onStatusChange) onStatusChange('disconnected');
    return false;
  }


  let compactTurns = 15;       // 多少轮自动整理一次（设置可调）
  let compactSummary = '';     // 早期对话的整理摘要

  function setCompactTurns(n) {
    compactTurns = Math.max(3, Math.min(100, parseInt(n) || 15));
  }

  // 对话超过整理间隔时，把最早的部分压缩为摘要（本地拼接，不额外调用AI）
  function maybeCompactContext() {
    const maxMsgs = compactTurns * 2;
    if (contextWindow.length <= maxMsgs) return;
    const overflow = contextWindow.length - maxMsgs;
    const old = contextWindow.splice(0, overflow);
    for (const item of old) {
      const text = String(item.content || '').replace(/\s+/g, ' ').trim().substring(0, 40);
      if (!text) continue;
      const tag = item.role === 'user' ? '玩家:' : (item.role === 'assistant' ? 'GM:' : '');
      compactSummary = (compactSummary ? compactSummary + '；' : '') + tag + text;
    }
    if (compactSummary.length > 800) compactSummary = compactSummary.substring(compactSummary.length - 800);
  }

  /**
   * 构建注入AI的上下文（token最小化）
   * 包含：核心提示 + 整理摘要 + 压缩游戏状态 + 最近N轮对话（N=整理间隔）
   * 规则书内容完全不注入
   */
  function buildMessages(userMessage, gameState, options = {}) {
    const messages = [];

    // 1. 系统提示：GM带团标准（CORE_PROMPT）固定注入一次在对话开头，之后不重复注入（节约token）；
    //    自定义提示（频道模式/频道提示词）作为补充附加其后
    //    缓存优化：固定内容（系统提示/整理摘要/历史）必须放在最前形成稳定前缀，变化的块（游戏状态/骰点）后置，
    //    否则每次变化都会使后续全部前缀失效（DeepSeek 前缀缓存全断，全价计费）
    const custom = options.customSystemPrompt ? String(options.customSystemPrompt).trim() : '';
    messages.push({ role: 'system', content: custom ? (CORE_PROMPT + '\n\n' + custom) : CORE_PROMPT });

    if (compactSummary) {
      messages.push({ role: 'system', content: '此前对话整理：' + compactSummary });
    }

    // 2. 最近对话（整理间隔内的轮次）——会话内累积追加，前缀稳定命中缓存
    const recentHistory = contextWindow.slice(-(compactTurns * 2));
    messages.push(...recentHistory);

    // 3. 游戏状态（一行式压缩）——变化块后置，不破坏固定前缀
    if (gameState && gameState.tokens && gameState.tokens.length > 0) {
      const stateLine = gameState.tokens.map(t => {
        const hp = t.hp !== undefined && t.maxHp ? `${t.hp}/${t.maxHp}` : '?';
        return `${t.name}(${t.gridX},${t.gridY}) HP${hp}`;
      }).join(' | ');
      messages.push({ role: 'system', content: `角色: ${stateLine}` });
    }

    // 4. 最新骰点（仅最近3条）
    const recentRolls = verifiedRolls.slice(-3);
    if (recentRolls.length > 0) {
      const rollStr = recentRolls.map(r => `${r.expression}=${r.result.total}`).join(', ');
      messages.push({ role: 'system', content: `掷骰: ${rollStr}` });
    }

    // 5. 当前用户消息
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  // ── AI对话 ────────────────────────────────────────

  // 执行规则系统管理工具（delete/reparse），供AI在系统频道调用
  async function runRuleSystemTool(action, system) {
    if (!isConnected) return '后端未连接';
    try {
      const endpoint = action === 'delete' ? '/api/rules/delete' : '/api/rules/agent-run';
      const body = action === 'delete' ? { system } : { system, reparse: true };
      const resp = await fetch(`${serverUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      if (!resp.ok || data.error) return `失败: ${data.error || ('HTTP ' + resp.status)}`;
      if (action === 'delete') return `已删除规则系统「${data.system}」`;
      return `已重新解析「${data.system}」：候选HTML ${data.htmlCount || 0}，规则文本 ${data.sourceCount || 0}，图片 ${data.imageCount || 0}`;
    } catch (e) {
      return '执行失败: ' + (e.message || '连接失败');
    }
  }

  /**
   * 发送消息（优先流式SSE，后端不支持时回退普通接口）
   * options.onStream: ({type:'reasoning'|'content', text}) => void 实时增量回调
   */
  async function sendMessage(userMessage, options = {}) {
    if (!isConnected) {
      const reconnected = await checkConnection();
      if (!reconnected) {
        if (onMessage) onMessage('SoloTrpg后端未连接。请运行 start.bat 或 SoloTrpg.exe。', 'system');
        return null;
      }
    }

    const gameState = options.includeGameState !== false ? collectGameState() : null;
    const messages = buildMessages(userMessage, gameState, options);

    if (options.resumeFrom) {
      const resumeMsg = { role: 'assistant', content: String(options.resumeFrom || '') };
      if (options.resumeReasoning) resumeMsg.reasoning_content = String(options.resumeReasoning);
      messages.splice(messages.length - 1, 0, resumeMsg);
    }

    try {
      let content = '';
      let reasoningContent = '';

      // 先尝试流式
      const streamResp = await fetch(`${serverUrl}/api/ai/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          provider: options.provider || activeProvider,
          system: options.system || '',
          adventure: options.adventure || '默认',
          channel: options.channel || '',
          promptProfile: options.promptProfile || '',
          gmTools: !!options.gmTools,
          private: !!options.private
        }),
        signal: options.signal || null
      });

      if (streamResp.ok) {
        const streamed = await readStream(streamResp, options.onStream || null);
        // 流中断：返回已生成的部分内容，由调用方保存并提示"继续"
        if (streamed.interrupted) {
          return { interrupted: true, partialContent: streamed.content, partialReasoning: streamed.reasoningContent, userMessage };
        }
        content = streamed.content;
        reasoningContent = streamed.reasoningContent;
      } else if (streamResp.status === 404) {
        // 旧后端无流式接口：回退普通接口
        const plain = await fetch(`${serverUrl}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            provider: options.provider || activeProvider,
            system: options.system || '',
            adventure: options.adventure || '默认',
            channel: options.channel || '',
            promptProfile: options.promptProfile || ''
          })
        });
        if (!plain.ok) {
          const err = await plain.json();
          throw new Error(err.error || 'AI请求失败');
        }
        const data = await plain.json();
        content = data.content;
        reasoningContent = data.reasoningContent || '';
        if (options.onStream) {
          if (reasoningContent) options.onStream({ type: 'reasoning', text: reasoningContent });
          if (content) options.onStream({ type: 'content', text: content });
        }
      } else {
        const err = await streamResp.json();
        throw new Error(err.error || 'AI请求失败');
      }

      // 检测工具调用 [[search:...]] / [[module:...]] / [[rules:delete:系统名]] / [[rules:reparse:系统名]] / [[map:bg:图片路径]]
      const toolMatch = content.match(/\[\[(search|module|rules|map):(.+?)\]\]/);
      if (toolMatch) {
        const toolType = toolMatch[1];
        const rawQuery = toolMatch[2].trim();
        const displayContent = content.replace(/\[\[(search|module|rules|map):.+?\]\]/g, '').trim();
        if (displayContent && onMessage) {
          onMessage(displayContent, 'ai');
        }
        if (toolType === 'rules') {
          // 规则系统管理工具：delete / reparse
          const rulesMatch = rawQuery.match(/^(delete|reparse):(.+)$/);
          if (rulesMatch) {
            const action = rulesMatch[1];
            const targetSystem = rulesMatch[2].trim();
            const resultText = await runRuleSystemTool(action, targetSystem);
            const followUpMessages = buildMessages(
              `${action === 'delete' ? '规则系统删除' : '规则系统重新解析'}结果：${resultText}。请告知用户结果。`,
              gameState,
              options
            );
            const followResp = await fetch(`${serverUrl}/api/ai/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: followUpMessages,
                provider: options.provider || activeProvider
              })
            });
            if (followResp.ok) {
              const data2 = await followResp.json();
              content = data2.content;
              reasoningContent = data2.reasoningContent || '';
            } else {
              content = resultText;
            }
            if (onToolExecuted) onToolExecuted(action, targetSystem, resultText);
          }
        } else if (toolType === 'map') {
          // 地图背景切换 [[map:bg:图片路径]]：应用后保留正文，不中断对话
          content = displayContent || content.replace(/\[\[map:.+?\]\]/g, '').trim();
          try {
            const bgPath = rawQuery.replace(/^bg:/, '').trim();
            let url = bgPath;
            if (bgPath.indexOf('module:') === 0) {
              url = '/api/module/file?system=' + encodeURIComponent(options.system || '') + '&path=' + encodeURIComponent(bgPath.slice(7).replace(/^\/+/, ''));
            }
            if (window.MapEngine && typeof window.MapEngine.setBackgroundSource === 'function') {
              window.MapEngine.setBackgroundSource(url);
              if (onMessage) onMessage('🗺 已切换地图背景：' + bgPath, 'system');
            }
          } catch (e) { /* 背景应用失败不打断对话 */ }
        } else if (onToolCall) {
          // 执行搜索
          const query = rawQuery;
          const results = await onToolCall(toolType, query);
          if (results) {
            // 将搜索结果作为系统消息注入，继续对话
            conversationHistory.push({ role: 'user', content: userMessage });
            conversationHistory.push({ role: 'assistant', content: displayContent || '（搜索中...）' });
            contextWindow.push({ role: 'user', content: userMessage });
            contextWindow.push({ role: 'assistant', content: displayContent || '（搜索中...）' });

            // 重新发送，带上搜索结果
            const followUpMessages = buildMessages(
              `以上是${toolType === 'search' ? '规则书' : '模组'}的搜索结果。请根据这些信息继续回复。`,
              gameState,
              options
            );
            // 在最前面添加搜索结果
            followUpMessages.splice(1, 0, { role: 'system', content: results });

            const followResp = await fetch(`${serverUrl}/api/ai/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: followUpMessages,
                provider: options.provider || activeProvider
              })
            });

            if (followResp.ok) {
              const data2 = await followResp.json();
              content = data2.content;
              reasoningContent = data2.reasoningContent || '';
            }
          }
        }
      }

      // 保存对话
      conversationHistory.push({ role: 'user', content: userMessage });
      const assistantMessage = { role: 'assistant', content };
      if (reasoningContent) assistantMessage.reasoning_content = reasoningContent;
      conversationHistory.push(assistantMessage);
      contextWindow.push({ role: 'user', content: userMessage });
      contextWindow.push({ ...assistantMessage });

      maybeCompactContext();
      while (conversationHistory.length > 200) conversationHistory.shift();

      // 回调（suppressFinalMessage时由调用方自行渲染，避免重复显示）
      if (onMessage && !options.suppressFinalMessage) onMessage(content, 'ai');

      // 自动存档（异步，不阻塞）
      autoSaveConversation(userMessage, content);

      return { content, reasoningContent };
    } catch (err) {
      console.error('[AI] 对话失败:', err);
      if (onMessage) onMessage(`AI错误: ${err.message}`, 'system');
      return null;
    }
  }

  // 系统频道AI对话（带插件文件工具）：后端执行工具循环直到AI纯文本回复，SSE流式返回
  async function sendSystemChat(userMessage, options = {}) {
    const messages = [
      { role: 'system', content: options.customSystemPrompt || '你是系统管理员AI，负责维护规则书插件。' },
      { role: 'user', content: userMessage }
    ];
    const resp = await fetch(`${serverUrl}/api/ai/system-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        provider: options.provider || activeProvider,
        system: options.system || '',
        adventure: options.adventure || '默认',
        channel: options.channel || '',
        promptProfile: options.promptProfile || '',
        private: !!options.private
      }),
      signal: options.signal || null
    });
    if (!resp.ok) {
      let errText = '系统对话请求失败';
      try { const e = await resp.json(); errText = e.error || errText; } catch (e2) { /* ignore */ }
      throw new Error(errText);
    }
    if (!resp.body) throw new Error('AI 响应为空，请重试');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoningContent = '';
    let interrupted = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const evt of events) {
        const line = evt.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let json;
        try { json = JSON.parse(data); } catch (e) { continue; }
        if (json.type === 'reasoning') {
          reasoningContent += json.delta || '';
          if (options.onStream) options.onStream({ type: 'reasoning', text: json.delta });
        } else if (json.type === 'content') {
          content += json.delta || '';
          if (options.onStream) options.onStream({ type: 'content', text: json.delta });
        } else if (json.type === 'ai_thinking') {
          reasoningContent += json.text || '';
          if (options.onStream) options.onStream({ type: 'reasoning', text: json.text });
        } else if (json.type === 'ai_text') {
          if (options.onStream) options.onStream({ type: 'content', text: json.text });
        } else if (json.type === 'tool') {
          if (options.onTool) options.onTool(json.tool, json.args);
        } else if (json.type === 'tool_result') {
          if (options.onToolResult) options.onToolResult(json.tool, json.result);
        } else if (json.type === 'usage') {
          if (options.onUsage) options.onUsage(json.round, json.usage || {});
        } else if (json.type === 'done') {
          content = content || json.content || '';
        } else if (json.type === 'aborted') {
          interrupted = true;
        } else if (json.type === 'error') {
          throw new Error(json.error || '系统对话错误');
        }
      }
    }
    return { content, reasoningContent, interrupted };
  }

  // 读取SSE流，解析reasoning/content增量；网络中断时返回已收到的部分内容
  async function readStream(resp, onStream) {
    if (!resp || !resp.body) throw new Error('AI 响应为空，请重试');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let fullReasoning = '';
    let interrupted = false;
    let abortError = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop();
        for (const evt of events) {
          const dataLine = evt.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let msg;
          try { msg = JSON.parse(payload); } catch (e) { continue; }
          if (msg.type === 'reasoning') {
            fullReasoning += msg.delta || '';
            if (onStream) onStream({ type: 'reasoning', text: fullReasoning });
          } else if (msg.type === 'content') {
            fullContent += msg.delta || '';
            if (onStream) onStream({ type: 'content', text: fullContent });
          } else if (msg.type === 'tool') {
            if (onStream) onStream({ type: 'tool', name: msg.name || '' });
          } else if (msg.type === 'tool_result') {
            if (onStream) onStream({ type: 'tool_result', name: msg.name || '', ok: !!msg.ok });
          } else if (msg.type === 'done') {
            if (msg.content) fullContent = msg.content;
            if (msg.reasoningContent) fullReasoning = msg.reasoningContent;
          } else if (msg.type === 'error') {
            throw new Error(msg.error || 'AI流式请求失败');
          } else if (msg.type === 'aborted') {
            interrupted = true;
            abortError = new Error('请求已中止');
          }
        }
      }
    } catch (err) {
      // 网络/流中断：保留已生成的部分内容，供"继续"续接
      interrupted = true;
      abortError = err;
    }
    if (interrupted && (fullContent || fullReasoning)) {
      return { content: fullContent, reasoningContent: fullReasoning, interrupted: true };
    }
    if (interrupted) throw (abortError || new Error('AI流式请求中断'));
    return { content: fullContent, reasoningContent: fullReasoning };
  }

  // ── 工具搜索（供外部调用） ────────────────────────

  /**
   * AI请求搜索规则书
   */
  async function searchRules(query) {
    if (window.RuleSearch && window.RuleSearch.isReady()) {
      const results = window.RuleSearch.search(query, { maxResults: 8 });
      if (results.length > 0) {
        return window.TextCompressor.searchToContext(results, 1500);
      }
    }
    return null;
  }

  /**
   * AI请求搜索模组/剧本
   */
  async function searchModule(query) {
    if (!isConnected) return null;
    try {
      const system = window.UIManager && window.UIManager.getCurrentRuleSystem ? window.UIManager.getCurrentRuleSystem() : '';
      const view = window.UIManager && window.UIManager.getModuleAccessView ? window.UIManager.getModuleAccessView() : 'player';
      if (!system) return null;
      const resp = await fetch(`${serverUrl}/api/module/search?system=${encodeURIComponent(system)}&view=${encodeURIComponent(view)}&q=${encodeURIComponent(query)}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.results && data.results.length > 0) {
        return data.results.map(r => `- [${r.type}] ${r.title}: ${r.summary}`).join('\n');
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ── 游戏状态收集（压缩版） ────────────────────────

  function collectGameState() {
    const state = { tokens: [], selectedToken: null };

    if (window.MapEngine) {
      const tokens = window.MapEngine.getAllTokens();
      state.tokens = tokens.map(t => ({
        name: t.displayName || t.name,
        gridX: Math.round(t.gridX),
        gridY: Math.round(t.gridY),
        hp: t.hp,
        maxHp: t.maxHp,
        ac: t.ac,
        conditions: t.conditions || [],
        data: t.data || {}
      }));

      const sel = window.MapEngine.getSelectedToken();
      if (sel) {
        state.selectedToken = {
          name: sel.displayName || sel.name,
          data: sel.data || {}
        };
      }
    }

    return state;
  }

  // ── 骰点管理 ──────────────────────────────────────

  function recordRoll(expression, result, context = '') {
    verifiedRolls.push({ expression, result, context, time: new Date().toLocaleTimeString('zh-CN') });
    while (verifiedRolls.length > 20) verifiedRolls.shift();
  }

  function getRecentRolls(count = 5) {
    return verifiedRolls.slice(-count);
  }

  function clearRolls() {
    verifiedRolls = [];
  }

  // ── 对话管理 ──────────────────────────────────────

  function clearHistory() {
    conversationHistory = [];
    contextWindow = [];
    compactSummary = '';
  }

  function getHistory() {
    return [...conversationHistory];
  }

  // ── 自动存档（系统记录，不耗AI token） ────────────

  async function autoSaveConversation(userMsg, aiMsg) {
    if (!isConnected) return;
    try {
      await fetch(`${serverUrl}/api/archive/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: userMsg,
          ai: aiMsg,
          time: new Date().toISOString()
        })
      });
    } catch (e) { /* 静默失败 */ }
  }

  // ── 配置管理 ──────────────────────────────────────

  async function loadConfig() {
    if (!isConnected && !(await checkConnection())) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/config`);
      return await resp.json();
    } catch (e) { return null; }
  }

  async function saveConfig(config) {
    if (!isConnected && !(await checkConnection())) return false;
    try {
      const resp = await fetch(`${serverUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      return resp.ok;
    } catch (e) { return false; }
  }

  async function setApiKey(provider, apiKey) {
    if (!isConnected && !(await checkConnection())) return false;
    try {
      const resp = await fetch(`${serverUrl}/api/config/apikey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey })
      });
      return resp.ok;
    } catch (e) { return false; }
  }

  // ── 规则书/模组查询 ──────────────────────────────

  async function getRuleSystems() {
    if (!isConnected) return [];
    try {
      const resp = await fetch(`${serverUrl}/api/rules/list`);
      return await resp.json();
    } catch (e) { return []; }
  }

  async function getRuleContent(system, file) {
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/read?system=${encodeURIComponent(system)}&file=${encodeURIComponent(file)}`);
      return await resp.json();
    } catch (e) { return null; }
  }

  async function readFile(file, onProgress) {
    if (!isConnected && !(await checkConnection())) return null;
    const formData = new FormData();
    formData.append('file', file);
    // 用文件名（去扩展名）作为规则系统名
    const sysName = file.name.replace(/\.[^.]+$/, '');
    formData.append('system', sysName);

    if (typeof onProgress === 'function') {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${serverUrl}/api/files/upload`, true);
        xhr.upload.onprogress = function(evt) {
          if (evt.lengthComputable) {
            onProgress({ phase: 'upload', percent: Math.round((evt.loaded / evt.total) * 100), loaded: evt.loaded, total: evt.total });
          }
        };
        xhr.onload = function() {
          try { resolve(JSON.parse(xhr.responseText || '{}')); }
          catch (e) { resolve({ error: '服务器返回内容无法解析' }); }
        };
        xhr.onerror = function() { resolve(null); };
        xhr.ontimeout = function() { resolve({ error: '上传超时' }); };
        xhr.send(formData);
        onProgress({ phase: 'start', percent: 0 });
      });
    }

    try {
      const resp = await fetch(`${serverUrl}/api/files/upload`, { method: 'POST', body: formData });
      return await resp.json();
    } catch (e) { return null; }
  }

  async function processRuleText(system, fileName, content) {
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, fileName, content })
      });
      return await resp.json();
    } catch (e) { return null; }
  }

  async function getRuleTaskStatus(system) {
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/task-status?system=${encodeURIComponent(system)}`);
      return await resp.json();
    } catch (e) { return null; }
  }

  async function appendRuleTaskLog(system, phase, message, detail) {
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/task-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, phase, message, detail: detail || {} })
      });
      return await resp.json();
    } catch (e) { return null; }
  }

  // 规则书Agent会话（SSE流式）：实时接收阶段/AI思考/工具调用事件
  async function runRulebookAgent(system, options) {
    if (!isConnected && !(await checkConnection())) return null;
    const onEvent = options && typeof options.onEvent === 'function' ? options.onEvent : null;
    const ctrl = options && options.signal ? options.signal : null;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/agent-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, resume: !!(options && options.resume), reparse: !!(options && options.reparse) }),
        signal: ctrl
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        return data || { error: 'HTTP ' + resp.status };
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop();
        for (const evt of events) {
          const dataLine = evt.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          let msg;
          try { msg = JSON.parse(payload); } catch (e) { continue; }
          if (msg.type === 'done') {
            finalResult = msg.result || msg;
          } else if (msg.type === 'error') {
            if (onEvent) onEvent(msg);
            finalResult = finalResult || { error: msg.error || 'Agent执行失败' };
          } else if (onEvent) {
            onEvent(msg);
          }
        }
      }
      return finalResult || { error: 'Agent无返回' };
    } catch (e) {
      // 用户主动停止解析：返回aborted标记，不视为错误
      if (ctrl && ctrl.aborted) return { aborted: true };
      return { error: e.message || '规则书Agent连接失败' };
    }
  }

  async function uploadCharacterAssets(payload) {
    if (!isConnected && !(await checkConnection())) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/assets/character-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await resp.json();
    } catch (e) { return null; }
  }

  // ── 公开接口 ──────────────────────────────────────

  return {
    init,
    checkConnection,
    isConnected: () => isConnected,
    getLastConnError: () => lastConnError,
    setServerUrl: (url) => { if (url) serverUrl = String(url).replace(/\/+$/, ''); },
    getServerUrl: () => serverUrl,

    sendMessage,
    sendSystemChat,
    searchRules,
    searchModule,
    clearHistory,
    getHistory,

    recordRoll,
    getRecentRolls,
    clearRolls,
    setCompactTurns,

    collectGameState,

    loadConfig, saveConfig, setApiKey,
    setActiveProvider: (p) => { activeProvider = p; },
    getActiveProvider: () => activeProvider,
    setOnToolExecuted: (fn) => { onToolExecuted = fn; },
    runRuleSystemTool,

    getRuleSystems, getRuleContent, readFile, processRuleText, getRuleTaskStatus, appendRuleTaskLog, runRulebookAgent, uploadCharacterAssets,

    set onMessage(fn) { onMessage = fn; },
    set onStatusChange(fn) { onStatusChange = fn; },
    set onToolCall(fn) { onToolCall = fn; }
  };
})();

if (typeof window !== 'undefined') {
  window.AIClient = AIClient;
}
