/* ============================================
   TrpgRecode - AI集成模块
   多模型支持、上下文组装、骰点感知、对话管理
   ============================================ */

const AIClient = (() => {
  'use strict';

  // ── 状态 ──────────────────────────────────────────

  let serverUrl = 'http://localhost:3000';  // 后端地址
  let isConnected = false;
  let activeProvider = 'openai';
  let conversationHistory = [];   // [{ role, content }]
  let verifiedRolls = [];         // [{ expression, result, timestamp, context }]
  let maxContextRolls = 50;       // 保留最近N个骰点
  let gameContextTemplate = '';   // 系统提示词中的游戏状态占位

  // 回调
  let onMessage = null;           // (content, role) => void
  let onStatusChange = null;      // (status) => void

  // ── 系统提示词 ────────────────────────────────────

  const BASE_SYSTEM_PROMPT = `你是一个专业的TRPG游戏主持人（GM），精通DND 5版及其他桌面角色扮演游戏规则。

你的职责：
1. 根据当前地图上的角色布局、角色数据和玩家输入来主持游戏
2. 正确解读骰子结果，区分「真实掷骰」和「文字提及」
3. 描述场景、NPC反应、战斗结果
4. 在需要时引用规则书内容（优先从规则缓存中查找）
5. 帮助管理先攻顺序、状态效果、环境因素
6. 生成NPC对话、环境描述、战斗叙事

重要规则：
- 只有标记为【已验证掷骰】的结果才是真实掷骰，不要将文字中形如"1d20"的表述当作真实掷骰
- 如果玩家提到了骰子但没有真实掷骰结果，请提示玩家先掷骰
- 引用规则时使用Markdown格式，重要信息用**粗体**标注
- 回答简洁直接，战斗轮次要清晰标注

当前系统时间：${new Date().toLocaleString('zh-CN')}`;

  // ── 初始化 ────────────────────────────────────────

  function init(options = {}) {
    if (options.serverUrl) serverUrl = options.serverUrl;
    if (options.onMessage) onMessage = options.onMessage;
    if (options.onStatusChange) onStatusChange = options.onStatusChange;

    checkConnection();
  }

  async function checkConnection() {
    try {
      const resp = await fetch(`${serverUrl}/api/health`);
      if (resp.ok) {
        const data = await resp.json();
        isConnected = true;
        if (onStatusChange) onStatusChange('connected');
        console.log('[AI] 服务器已连接:', data);
        return true;
      }
    } catch (e) {
      isConnected = false;
      if (onStatusChange) onStatusChange('disconnected');
      console.warn('[AI] 服务器未连接:', e.message);
    }
    return false;
  }

  // ── 配置管理 ──────────────────────────────────────

  async function loadConfig() {
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/config`);
      return await resp.json();
    } catch (e) {
      return null;
    }
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
    } catch (e) {
      return false;
    }
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
    } catch (e) {
      return false;
    }
  }

  // ── 游戏状态收集 ──────────────────────────────────

  /**
   * 收集当前游戏状态，用于构建AI上下文
   */
  function collectGameState() {
    const state = {
      tokens: [],
      selectedToken: null,
      chatRecent: [],
      verifiedRolls: [],
      mapInfo: {}
    };

    // 收集所有标记
    if (window.MapEngine) {
      const tokens = window.MapEngine.getAllTokens();
      state.tokens = tokens.map(t => ({
        id: t.id,
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
          id: sel.id,
          name: sel.displayName || sel.name,
          gridX: Math.round(sel.gridX),
          gridY: Math.round(sel.gridY),
          hp: sel.hp,
          maxHp: sel.maxHp,
          ac: sel.ac,
          conditions: sel.conditions || [],
          data: sel.data || {}
        };
      }
    }

    // 最近对话（非系统消息）
    if (window._chatHistory) {
      state.chatRecent = window._chatHistory.slice(-10);
    }

    // 已验证的骰点
    state.verifiedRolls = verifiedRolls.slice(-20);

    return state;
  }

  /**
   * 构建发送给AI的token优化上下文
   * 策略：游戏状态压缩 + 规则书按需检索（不全文注入）
   */
  function buildContext(userMessage, gameState) {
    const parts = [];
    let totalChars = 0;
    const maxChars = 6000; // 上下文总字符上限

    // ── 1. 游戏状态（紧凑一行式） ──
    if (gameState.tokens.length > 0) {
      const tokenLines = gameState.tokens.map(t => {
        const hp = t.hp !== undefined && t.maxHp ? `${t.hp}/${t.maxHp}` : '?';
        return `${t.name}(${t.gridX},${t.gridY}) HP${hp}`;
      });
      const line = '角色: ' + tokenLines.join(' | ');
      parts.push(line);
      totalChars += line.length;
    }

    // 选中角色详情
    if (gameState.selectedToken) {
      const st = gameState.selectedToken;
      let detail = `选中: ${st.name} `;
      if (st.data) {
        const kv = Object.entries(st.data)
          .filter(([,v]) => typeof v === 'string' || typeof v === 'number')
          .map(([k,v]) => `${k}=${v}`)
          .slice(0, 8);
        detail += kv.join(', ');
      }
      parts.push(detail);
      totalChars += detail.length;
    }

    // ── 2. 已验证骰点（最近5条） ──
    const rolls = gameState.verifiedRolls.slice(-5);
    if (rolls.length > 0) {
      const rollStr = '掷骰: ' + rolls.map(r => `${r.expression}=${r.result.total}`).join(', ');
      parts.push(rollStr);
      totalChars += rollStr.length;
    }

    // ── 3. 规则书压缩检索（按需注入） ──
    if (window.RuleSearch && window.RuleSearch.isReady()) {
      const remaining = maxChars - totalChars - 500;
      if (remaining > 200) {
        const ruleCtx = window.RuleSearch.buildAIContext(userMessage, gameState, Math.floor(remaining / 3));
        if (ruleCtx && ruleCtx.length > 20) {
          parts.push(ruleCtx);
          totalChars += ruleCtx.length;
        }
      }
    }

    return parts.join('\n');
  }

  // ── AI对话 ────────────────────────────────────────

  /**
   * 发送消息给AI
   * @param {string} userMessage - 用户消息
   * @param {object} options - { provider, model, includeGameState, customSystemPrompt }
   */
  async function sendMessage(userMessage, options = {}) {
    if (!isConnected) {
      const reconnected = await checkConnection();
      if (!reconnected) {
        if (onMessage) onMessage('❌ AI服务器未连接，请先启动后端服务：`node server.js`', 'system');
        return null;
      }
    }

    const gameState = options.includeGameState !== false ? collectGameState() : null;
    const contextText = gameState ? buildContext(userMessage, gameState) : '';

    // 构建消息列表
    const messages = [];

    // 系统提示词
    let systemPrompt = options.customSystemPrompt || BASE_SYSTEM_PROMPT;
    if (contextText) {
      systemPrompt += '\n\n' + contextText;
    }
    messages.push({ role: 'system', content: systemPrompt });

    // 历史对话（最近20轮）
    const recentHistory = conversationHistory.slice(-40);
    messages.push(...recentHistory);

    // 当前用户消息
    messages.push({ role: 'user', content: userMessage });

    try {
      const resp = await fetch(`${serverUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          provider: options.provider || activeProvider,
          model: options.model || null
        })
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'AI请求失败');
      }

      const data = await resp.json();

      // 保存到对话历史
      conversationHistory.push({ role: 'user', content: userMessage });
      conversationHistory.push({ role: 'assistant', content: data.content });

      // 限制历史长度
      while (conversationHistory.length > 100) {
        conversationHistory.shift();
      }

      // 回调
      if (onMessage) onMessage(data.content, 'ai');

      return data;
    } catch (err) {
      console.error('[AI] 对话失败:', err);
      if (onMessage) onMessage(`❌ AI错误: ${err.message}`, 'system');
      return null;
    }
  }

  // ── 骰点管理 ──────────────────────────────────────

  /**
   * 记录一个已验证的真实掷骰
   */
  function recordRoll(expression, result, context = '') {
    verifiedRolls.push({
      expression,
      result,
      context,
      time: new Date().toLocaleTimeString('zh-CN')
    });

    while (verifiedRolls.length > maxContextRolls) {
      verifiedRolls.shift();
    }
  }

  /**
   * 获取最近的掷骰记录
   */
  function getRecentRolls(count = 10) {
    return verifiedRolls.slice(-count);
  }

  /**
   * 清理掷骰记录
   */
  function clearRolls() {
    verifiedRolls = [];
  }

  // ── 对话管理 ──────────────────────────────────────

  function clearHistory() {
    conversationHistory = [];
  }

  function getHistory() {
    return [...conversationHistory];
  }

  function addSystemMessage(content) {
    conversationHistory.push({ role: 'system', content });
  }

  // ── 规则书查询 ────────────────────────────────────

  /**
   * 获取规则书缓存列表
   */
  async function getRuleSystems() {
    if (!isConnected) return [];
    try {
      const resp = await fetch(`${serverUrl}/api/rules/list`);
      return await resp.json();
    } catch (e) {
      return [];
    }
  }

  /**
   * 读取规则缓存内容
   */
  async function getRuleContent(system, file) {
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/read?system=${encodeURIComponent(system)}&file=${encodeURIComponent(file)}`);
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * 用AI处理规则文本
   */
  async function processRuleText(system, fileName, content) {
    if (!isConnected) return null;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, fileName, content })
      });
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * 保存规则缓存
   */
  async function saveRuleContent(system, file, content) {
    if (!isConnected) return false;
    try {
      const resp = await fetch(`${serverUrl}/api/rules/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, file, content })
      });
      return resp.ok;
    } catch (e) {
      return false;
    }
  }

  // ── 文件读取 ──────────────────────────────────────

  /**
   * 上传并读取文件
   */
  async function readFile(file, type) {
    if (!isConnected) return null;

    const formData = new FormData();
    formData.append('file', file);

    const endpoints = {
      pdf: '/api/files/read-pdf',
      chm: '/api/files/read-chm',
      xlsx: '/api/files/read-xlsx',
      text: '/api/files/read-text'
    };

    const endpoint = endpoints[type] || endpoints.text;

    try {
      const resp = await fetch(`${serverUrl}${endpoint}`, {
        method: 'POST',
        body: formData
      });
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  // ── 公开接口 ──────────────────────────────────────

  return {
    init,
    checkConnection,
    isConnected: () => isConnected,
    setServerUrl: (url) => { serverUrl = url; },
    getServerUrl: () => serverUrl,

    // 配置
    loadConfig,
    saveConfig,
    setApiKey,
    setActiveProvider: (p) => { activeProvider = p; },
    getActiveProvider: () => activeProvider,

    // 对话
    sendMessage,
    clearHistory,
    getHistory,
    addSystemMessage,

    // 骰点
    recordRoll,
    getRecentRolls,
    clearRolls,

    // 游戏状态
    collectGameState,
    buildContext,

    // 规则书
    getRuleSystems,
    getRuleContent,
    processRuleText,
    saveRuleContent,

    // 文件
    readFile,

    // 回调
    set onMessage(fn) { onMessage = fn; },
    set onStatusChange(fn) { onStatusChange = fn; }
  };
})();

if (typeof window !== 'undefined') {
  window.AIClient = AIClient;
}
