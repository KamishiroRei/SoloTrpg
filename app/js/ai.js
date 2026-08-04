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
  let activeProvider = 'gpt';
  let conversationHistory = [];   // 完整对话历史（系统自动存档用）
  let contextWindow = [];         // 注入AI的极简上下文（仅最近2-3轮）
  let verifiedRolls = [];

  let onMessage = null;
  let onStatusChange = null;
  let onToolCall = null;          // AI请求搜索规则/模组时的回调

  // ── 核心系统提示词（极小化，~300字） ──────────────

  const CORE_PROMPT = `你是TRPG的GM。严格遵守当前游戏规则，满足用户需求。

GM准则：
- 融合角色设定与世界观，合理解释一切事件
- 不盲目吹捧玩家角色，不把玩家角色作为世界中心
- 一切行为符合世界观和模组设定
- 剧情需要的恶意攻击、不利局面等不应规避
- 记忆不可靠，不确定时主动翻查规则书和模组

当你需要查阅规则时，回复：[[search:关键词]]
当你需要查阅模组/剧本时，回复：[[module:关键词]]
系统会自动返回压缩摘要。`;

  // ── 初始化 ────────────────────────────────────────

  function init(options = {}) {
    if (options.serverUrl) serverUrl = options.serverUrl;
    if (options.onMessage) onMessage = options.onMessage;
    if (options.onStatusChange) onStatusChange = options.onStatusChange;
    if (options.onToolCall) onToolCall = options.onToolCall;

    checkConnection();
  }

  async function checkConnection() {
    try {
      const resp = await fetch(`${serverUrl}/api/health`);
      if (resp.ok) {
        isConnected = true;
        if (onStatusChange) onStatusChange('connected');
        return true;
      }
    } catch (e) {
      isConnected = false;
      if (onStatusChange) onStatusChange('disconnected');
    }
    return false;
  }

  // ── 极小化上下文构建 ──────────────────────────────

  /**
   * 构建注入AI的上下文（token最小化）
   * 只包含：核心提示 + 压缩游戏状态 + 最近1-2轮对话
   * 规则书内容完全不注入
   */
  function buildMessages(userMessage, gameState) {
    const messages = [];

    // 1. 系统提示（固定，不含规则书）
    messages.push({ role: 'system', content: CORE_PROMPT });

    // 2. 游戏状态（一行式压缩）
    if (gameState && gameState.tokens && gameState.tokens.length > 0) {
      const stateLine = gameState.tokens.map(t => {
        const hp = t.hp !== undefined && t.maxHp ? `${t.hp}/${t.maxHp}` : '?';
        return `${t.name}(${t.gridX},${t.gridY}) HP${hp}`;
      }).join(' | ');
      messages.push({ role: 'system', content: `角色: ${stateLine}` });
    }

    // 最新骰点（仅最近3条）
    const recentRolls = verifiedRolls.slice(-3);
    if (recentRolls.length > 0) {
      const rollStr = recentRolls.map(r => `${r.expression}=${r.result.total}`).join(', ');
      messages.push({ role: 'system', content: `掷骰: ${rollStr}` });
    }

    // 3. 最近对话（仅2轮，4条消息）
    const recentHistory = contextWindow.slice(-4);
    messages.push(...recentHistory);

    // 4. 当前用户消息
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  // ── AI对话 ────────────────────────────────────────

  /**
   * 发送消息并处理工具调用
   */
  async function sendMessage(userMessage, options = {}) {
    if (!isConnected) {
      const reconnected = await checkConnection();
      if (!reconnected) {
        if (onMessage) onMessage('AI服务器未连接。启动后端：node server.js', 'system');
        return null;
      }
    }

    const gameState = options.includeGameState !== false ? collectGameState() : null;
    const messages = buildMessages(userMessage, gameState);

    try {
      const resp = await fetch(`${serverUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          provider: options.provider || activeProvider
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'AI请求失败');
      }

      const data = await resp.json();
      let content = data.content;

      // 检测工具调用 [[search:...]] 或 [[module:...]]
      const toolMatch = content.match(/\[\[(search|module):(.+?)\]\]/);
      if (toolMatch) {
        const toolType = toolMatch[1];
        const query = toolMatch[2].trim();

        // 先显示AI的初步回复（去掉工具调用标记）
        const displayContent = content.replace(/\[\[(search|module):.+?\]\]/g, '').trim();
        if (displayContent && onMessage) {
          onMessage(displayContent, 'ai');
        }

        // 执行搜索
        if (onToolCall) {
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
              gameState
            );
            // 在最前面添加搜索结果
            followUpMessages.splice(1, 0, { role: 'system', content: results });

            const resp2 = await fetch(`${serverUrl}/api/ai/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: followUpMessages,
                provider: options.provider || activeProvider
              })
            });

            if (resp2.ok) {
              const data2 = await resp2.json();
              content = data2.content;
            }
          }
        }
      }

      // 保存对话
      conversationHistory.push({ role: 'user', content: userMessage });
      conversationHistory.push({ role: 'assistant', content });
      contextWindow.push({ role: 'user', content: userMessage });
      contextWindow.push({ role: 'assistant', content });

      // 压缩上下文窗口
      while (contextWindow.length > 8) contextWindow.shift();
      while (conversationHistory.length > 200) conversationHistory.shift();

      // 回调
      if (onMessage) onMessage(content, 'ai');

      // 自动存档（异步，不阻塞）
      autoSaveConversation(userMessage, content);

      return { content };
    } catch (err) {
      console.error('[AI] 对话失败:', err);
      if (onMessage) onMessage(`AI错误: ${err.message}`, 'system');
      return null;
    }
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
      const resp = await fetch(`${serverUrl}/api/module/search?q=${encodeURIComponent(query)}`);
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
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/config`);
      return await resp.json();
    } catch (e) { return null; }
  }

  async function saveConfig(config) {
    if (!isConnected) return false;
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
    if (!isConnected) return false;
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

  async function readFile(file) {
    if (!isConnected) return null;
    const formData = new FormData();
    formData.append('file', file);
    // 用文件名（去扩展名）作为规则系统名
    const sysName = file.name.replace(/\.[^.]+$/, '');
    formData.append('system', sysName);
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

  // ── 公开接口 ──────────────────────────────────────

  return {
    init,
    checkConnection,
    isConnected: () => isConnected,
    setServerUrl: (url) => { serverUrl = url; },
    getServerUrl: () => serverUrl,

    sendMessage,
    searchRules,
    searchModule,
    clearHistory,
    getHistory,

    recordRoll,
    getRecentRolls,
    clearRolls,

    collectGameState,

    loadConfig, saveConfig, setApiKey,
    setActiveProvider: (p) => { activeProvider = p; },
    getActiveProvider: () => activeProvider,

    getRuleSystems, getRuleContent, readFile, processRuleText,

    set onMessage(fn) { onMessage = fn; },
    set onStatusChange(fn) { onStatusChange = fn; },
    set onToolCall(fn) { onToolCall = fn; }
  };
})();

if (typeof window !== 'undefined') {
  window.AIClient = AIClient;
}
