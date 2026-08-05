/* ============================================
   TrpgRecode - UI管理模块
   ============================================ */

const UIManager = (() => {
  'use strict';
  console.log('[UI] 模块加载...');

  let _editingCharId = null;
  // 当前详情面板展示的角色 tokenId（<UpdateVariable> 数据回写后自动刷新）
  let _lastDetailTokenId = null;
  let _pendingCharacterAssets = null;
  let _imageTool = { image: null, originalDataUrl: '', cropPortrait: null, cropAvatar: null, crop: { x: 110, y: 40, w: 300, h: 225 }, dragging: false, dragOffsetX: 0, dragOffsetY: 0, zoom: 1 };
  let _encounter = { active: false, initiatives: [], currentIndex: 0, round: 1 };
  let _chatHistory = [];
  let _activeChannelId = 'story';
  let _chatChannels = [];
  let _channelUnread = {};
  let _currentAdventure = '默认'; // D+三级会话：当前冒险（规则书-冒险-频道）
  let _activeSheet = null;      // 当前规则系统的角色卡插件 { system, handler }
  let _charListEventsBound = false; // 角色列表事件委托是否已绑定（幂等标志，refreshCharacterList 兜底绑定）
  let _sheetCollector = null;   // 插件表单的收集函数（保存时调用，返回 { name, displayName, color, data }）
  let _pendingResume = null; // { userMessage, partialContent, partialReasoning, prompt, channelId } AI回复中断后的续接状态
  let _activeDevAbort = null; // 当前AI开发请求的AbortController（状态框"停止"按钮用）
  let _rulePollTimer = null; // 规则书接管进度轮询定时器
  let _ruleTaskViewSystem = null; // 当前内容视图正在显示的进度所属系统
  const DEFAULT_CHANNELS = [
    { id: 'story', name: '剧情', prompt: '你在剧情频道担任 GM。推进场景、扮演 NPC、维护叙事连续性；玩家行动由玩家决定。遇到判定或数据变化时调用当前规则模块，不在聊天中临时猜规则。', skills: ['gm-protocol'], avg: true },
    { id: 'combat', name: '战斗', prompt: '你在战斗频道管理先攻、回合、行动、伤害、状态与资源。所有结果读取当前规则模块并写回角色和会话数据，展示必要的骰值与加值。', skills: ['gm-protocol'] },
    { id: 'system', name: '系统', prompt: '你在系统频道担任 TrpgRecode 开发 Agent。先理解玩家真正要完成的跑团行为，再按需调用开发、规则书、角色系统或体验设计 SKILL，形成定位、修改、重载、验证闭环。', skills: ['agent-guide'] }
  ];
  const _settings = {
    provider: 'gpt',
    aiEnabled: false, aiMode: 'full', aiChatEnabled: true, aiQuickMode: false,
    gptKey: '', gptModel: 'gpt-4o', gptKeySet: false,
    customEndpoint: '', customKey: '', customModel: '', customKeySet: false,
    gridColor: '#3a3a5c', bgColor: '#1a1a2e', rangeColor: '#ff6b6b', cellSize: 50, maxChat: 200,
    compactTurns: 15, reasoningEffort: 'high'
  };

  function _esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function _el(id) { return document.getElementById(id); }
  function _loadSettings() { try { var s = JSON.parse(localStorage.getItem('trpg_settings')); if (s) Object.assign(_settings, s); } catch(e){} }
  function _saveSettings() { try { localStorage.setItem('trpg_settings', JSON.stringify(_settings)); } catch(e){} }
  function _loadChannels() { try { var c = JSON.parse(localStorage.getItem('trpg_chat_channels')); _chatChannels = Array.isArray(c) && c.length ? c : JSON.parse(JSON.stringify(DEFAULT_CHANNELS)); } catch(e) { _chatChannels = JSON.parse(JSON.stringify(DEFAULT_CHANNELS)); } }
  function _saveChannels() { try { localStorage.setItem('trpg_chat_channels', JSON.stringify(_chatChannels)); } catch(e){} }

  function _applySetting(id, key, type) { var e = _el(id); if (!e) return; if (type === 'checkbox') e.checked = _settings[key]; else e.value = _settings[key]; }
  function _populateSettingsForm() {
    _applySetting('setting-grid-color', 'gridColor');
    _applySetting('setting-range-color', 'rangeColor');
    _applySetting('setting-cell-size', 'cellSize');
    _applySetting('setting-provider', 'provider');
    _applySetting('setting-ai-enabled', 'aiEnabled', 'checkbox');
    _applySetting('setting-gm-ai-chat-enabled', 'aiChatEnabled', 'checkbox');
    _applySetting('setting-ai-mode', 'aiMode');
    _applySetting('setting-gpt-key', 'gptKey');
    _applySetting('setting-gpt-model', 'gptModel');
    _applySetting('setting-custom-endpoint', 'customEndpoint');
    _applySetting('setting-custom-key', 'customKey');
    _applySetting('setting-compact-turns', 'compactTurns');
    _applySetting('setting-reasoning-effort', 'reasoningEffort');
    // 自定义模型下拉：始终保留手动输入入口
    var cmSel = _el('setting-custom-model-select');
    if (cmSel) {
      cmSel.innerHTML = '';
      cmSel.appendChild(new Option('— 手动输入 —', ''));
      if (_settings.customModel) {
        cmSel.appendChild(new Option(_settings.customModel, _settings.customModel));
        cmSel.value = _settings.customModel;
      }
    }
    _applySetting('setting-custom-model-input', 'customModel');
    var prov = _settings.provider || 'gpt';
    var gptPanel = _el('provider-gpt');
    var customPanel = _el('provider-custom');
    if (gptPanel) gptPanel.style.display = prov === 'gpt' ? 'block' : 'none';
    if (customPanel) customPanel.style.display = prov === 'custom' ? 'block' : 'none';
    _el('setting-provider').value = prov;
    updateAIControls();
    // 打开设置页时自动拉取当前 provider 的模型列表（custom 已有端点才请求）
    if (prov === 'custom' && _settings.customEndpoint) fetchModels('custom');
    else if (prov === 'gpt' && _settings.gptKey) fetchModels('gpt');
  }

  // 本地无显式配置时，以后端 config.json 为初始值（WebView2窗口/换浏览器不丢配置）
  async function loadBackendConfig() {
    var localRaw = null;
    try { localRaw = localStorage.getItem('trpg_settings'); } catch (e) {}
    if (localRaw) return; // 本地已有显式配置，不覆盖
    if (!AIClient || typeof AIClient.loadConfig !== 'function') return;
    var cfg = null;
    try { cfg = await AIClient.loadConfig(); } catch (e) {}
    if (!cfg || !cfg.ai) return;
    var ai = cfg.ai;
    var prov = ai.activeProvider || 'gpt';
    var providers = ai.providers || {};
    var active = providers[prov] || {};
    _settings.provider = prov;
    _settings.aiEnabled = !!active.enabled;
    if (providers.gpt) {
      _settings.gptModel = providers.gpt.model || _settings.gptModel;
      if (providers.gpt.apiKey && providers.gpt.apiKey !== '***已设置***') _settings.gptKey = providers.gpt.apiKey;
      _settings.gptKeySet = providers.gpt.apiKey === '***已设置***';
    }
    if (providers.custom) {
      _settings.customEndpoint = providers.custom.endpoint || _settings.customEndpoint;
      _settings.customModel = providers.custom.model || _settings.customModel;
      if (providers.custom.apiKey && providers.custom.apiKey !== '***已设置***') _settings.customKey = providers.custom.apiKey;
      _settings.customKeySet = providers.custom.apiKey === '***已设置***';
    }
    AIClient.setActiveProvider(prov);
    _saveSettings();
    _populateSettingsForm();
    updateAIControls();
  }

  function isGMUser() {
    // 本地单人/未加入房间时视为GM；加入房间后只有房主是GM。
    return !Network || !Network.getRoomCode || !Network.getRoomCode() || Network.amIHost();
  }

  function canUseAIChat() {
    return isGMUser() && !!_settings.aiChatEnabled;
  }

  function updateAIControls() {
    var can = canUseAIChat();
    var row = _el('chat-ai-toggle-row');
    var toggle = _el('chat-ai-toggle');
    var hint = _el('chat-ai-toggle-hint');
    var sw = row ? row.querySelector('.chat-ai-switch') : null;
    if (row) row.style.display = can ? 'flex' : 'none';
    if (toggle) {
      if (!can) _settings.aiQuickMode = false;
      toggle.checked = !!_settings.aiQuickMode;
      toggle.disabled = !can;
    }
    if (sw) sw.classList.toggle('active', can && !!_settings.aiQuickMode);
    if (hint) {
      hint.textContent = can
        ? (_settings.aiQuickMode ? '开启：发送给AI' : '关闭：普通聊天')
        : '仅GM/房主可使用AI';
    }
    var gmAi = _el('setting-gm-ai-chat-enabled');
    if (gmAi) {
      gmAi.checked = !!_settings.aiChatEnabled;
      gmAi.disabled = !isGMUser();
      var row2 = gmAi.closest ? gmAi.closest('.setting-row') : null;
      if (row2) row2.classList.toggle('disabled', !isGMUser());
    }
    var chatInput = _el('chat-input');
    if (chatInput) {
      chatInput.placeholder = can && _settings.aiQuickMode
        ? 'AI开关已开启：输入内容直接发送给AI'
        : '输入消息或掷骰表达式（如 2d6+3）';
    }
  }

  function init() {
    _loadSettings();
    loadBackendConfig();
    if (AIClient && typeof AIClient.setCompactTurns === 'function') AIClient.setCompactTurns(_settings.compactTurns);
    _loadChannels();
    AIClient.onMessage = function(content, role) {
      if (role === 'ai') addChatMessage('ai', 'AI', content);
      else if (role === 'system') addChatMessage('system', 'AI', content);
    };
    AIClient.onStatusChange = function(status) { updateServerStatus(status); };
    // AI执行规则系统管理工具（删除/重新解析）后刷新列表
    AIClient.setOnToolExecuted(function(action, system) {
      refreshRulesList();
      addChatMessage('system', '规则书工具', (action === 'delete' ? 'AI已删除规则系统: ' : 'AI已触发重新解析: ') + system);
    });
    AIClient.setActiveProvider(_settings.provider || 'gpt');
    _setupToolbar();
    setupMovableMapToolbar();
    _setupTabs();
    setupChat();
    setupChatResize();
    setupDice();
    setupRules();
    setupModuleManager();
    setupCharacterImport();
    setupCharacterImageTool();
    setupModals();
    setupSettings();
    setupNetwork();
    setupCheckTool();
    setupPendingCharacterListener();
    restoreCharacters();
    _restoreChatLog(); // 恢复持久化的聊天记录（玩家输入+AI输出，不含系统消息）
    renderChatMessages();
    // 兜底：任何未显式落盘的 token 变更（如地图拖动位置）在关闭/刷新前统一保存
    window.addEventListener('beforeunload', persistCharacters);
    updateAIControls();
    setupCharacterListEvents();
    refreshCharacterList();
    window._chatHistory = _chatHistory;
    window._onMeasureComplete = function(sx, sy, ex, ey, dist) {
      addChatMessage('system', '测量', '距离: ' + dist.toFixed(1) + ' 格');
    };
    updateZoomLabel();
    // 开始界面（2026-08-05）：全局入口——选择规则书→冒险（或继续上次）后才进入内部
    // F5刷新保持（2026-08-05）：存在上次进入记录时直接恢复主界面（当前规则书+冒险），
    // 而不是每次刷新都回到开始界面（刷新=在当前界面重载，不是退出）
    var lastEntry = _loadLastEntry();
    if (lastEntry && lastEntry.system) {
      _selectedRuleSystem = lastEntry.system;
      _currentAdventure = lastEntry.adventure || '默认';
      try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {}
      enterMainInterface(); // 内部已加载当前频道服务端历史
    } else {
      renderStartScreen();
    }
  }

  function setupMovableMapToolbar() {
    var bar = _el('map-toolbar');
    var grip = _el('map-toolbar-grip');
    if (!bar || !grip || bar.dataset.dragReady === '1') return;
    bar.dataset.dragReady = '1';
    var key = 'trpg_map_toolbar_pos';
    function clampPos(x, y) {
      return {
        x: Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, x)),
        y: Math.max(76, Math.min(window.innerHeight - bar.offsetHeight - 8, y))
      };
    }
    function apply(x, y, save) {
      var p = clampPos(x, y);
      bar.style.left = p.x + 'px'; bar.style.top = p.y + 'px';
      if (save) try { localStorage.setItem(key, JSON.stringify(p)); } catch (e) {}
    }
    try { var saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved) apply(saved.x, saved.y, false); } catch (e) {}
    var moving = false, ox = 0, oy = 0;
    grip.addEventListener('pointerdown', function (e) {
      moving = true; var r = bar.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top;
      grip.setPointerCapture(e.pointerId); bar.classList.add('dragging'); e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) { if (moving) apply(e.clientX - ox, e.clientY - oy, false); });
    grip.addEventListener('pointerup', function (e) { if (!moving) return; moving = false; bar.classList.remove('dragging'); var r = bar.getBoundingClientRect(); apply(r.left, r.top, true); try { grip.releasePointerCapture(e.pointerId); } catch (_) {} });
    window.addEventListener('resize', function () { var r = bar.getBoundingClientRect(); apply(r.left, r.top, false); });
  }

  function _setupToolbar() {
    var bind = function(id, evt, fn) { var e = _el(id); if (e) e.addEventListener(evt, fn); };
    bind('btn-select', 'click', function() { MapEngine.setTool('select'); });
    bind('btn-pan', 'click', function() { MapEngine.setTool('pan'); });
    bind('btn-range', 'click', function() { openRangeModal(); });
    bind('btn-measure', 'click', function() { MapEngine.setTool('measure'); });
    bind('btn-zoomin', 'click', function() { MapEngine.zoomIn(); });
    bind('btn-zoomout', 'click', function() { MapEngine.zoomOut(); });
    bind('btn-zoomfit', 'click', function() { MapEngine.zoomFit(); });
    bind('btn-add-token', 'click', function() { openCharacterModal(); });
    bind('btn-clear-range', 'click', function() { MapEngine.clearRange(); });
    bind('btn-map-bg', 'click', function() { openBgModal(); });
    bind('toggle-grid', 'change', function() { MapEngine.setGridVisible(this.checked); });
    bind('toggle-snap', 'change', function() { MapEngine.setSnapToGrid(this.checked); });
    bind('grid-size-select', 'change', function() {
      var s = parseInt(this.value); MapEngine.setCellSize(s); _settings.cellSize = s; _saveSettings();
    });
  }

  function updateToolButtons(tool) {
    ['select', 'pan', 'range', 'measure'].forEach(function(t) {
      var b = _el('btn-' + t); if (b) b.classList.toggle('active', t === tool);
    });
  }

  function updateZoomLabel() {
    var l = _el('zoom-level'); if (l) l.textContent = Math.round(MapEngine.getZoom() * 100) + '%';
  }

  function updateServerStatus(status) {
    var e = _el('server-status'); if (!e) return;
    if (status === 'connected') {
      e.textContent = '\u25cf \u5728\u7ebf'; e.className = 'status-indicator online';
    } else {
      e.textContent = '\u25cf \u79bb\u7ebf'; e.className = 'status-indicator offline';
    }
  }

  // ── 规则书界面框架引擎（2026-08-05）：宿主只提供引擎，界面框架是规则书自身文件 ──
  // 新规则书无 ui/ 文件 → 用内置默认框架（DEFAULT_TABS）；AI 解析后写 Ruler/<系统>/ui/manifest.json 迭代定制。
  // manifest 结构: { tabs:[{id,icon,name,customPanel?}], hideTabs:[], theme:{cssVars}, sidebar:{...} }
  var DEFAULT_TABS = [
    { id: 'characters', icon: '👥', name: '角色' },
    { id: 'encounter', icon: '⚔', name: '遭遇' },
    { id: 'gm', icon: '🎭', name: 'GM' },
    { id: 'rules', icon: '📚', name: '规则' },
    { id: 'notes', icon: '📝', name: '笔记' },
    { id: 'settings', icon: '⚙', name: '设置' }
  ];
  var _uiManifest = null; // 当前规则书的界面框架（null=默认）

  // 加载并应用规则书 ui-manifest（引擎化：界面文件在规则书文件夹内）
  function applyUiManifest(system) {
    _uiManifest = null;
    // 重置主题变量（回到默认）
    resetThemeVars();
    fetch('/api/ui-manifest?system=' + encodeURIComponent(system || ''))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.manifest) return; // 无 manifest → 保持默认框架
        _uiManifest = data.manifest;
        var mf = data.manifest;
        // 1) 主题：覆盖 CSS 变量
        if (mf.theme && typeof mf.theme === 'object') applyThemeVars(mf.theme);
        // 2) 页签：重建（替换/追加/隐藏）
        if (Array.isArray(mf.tabs) && mf.tabs.length) renderDynamicTabs(mf.tabs, mf.hideTabs || []);
      })
      .catch(function() { /* 网络错误保持默认 */ });
  }

  function applyThemeVars(theme) {
    var root = document.documentElement;
    Object.keys(theme).forEach(function(k) {
      root.style.setProperty('--' + k, String(theme[k]));
    });
  }
  function resetThemeVars() {
    var root = document.documentElement;
    var defs = { bg: '#1a1a2e', 'bg-main': '#1a1a2e', 'bg-panel': '#16213e', 'bg-surface': '#1e2a4a', 'bg-hover': '#253358', 'bg-active': '#2a3f6e', border: '#2a2a4a', 'border-light': '#3a3a5c', 'text-primary': '#e0e0f0', 'text-secondary': '#a0a0c0', 'text-muted': '#6a6a8a', accent: '#c9a84c', 'accent-light': '#e0c870', 'accent-dark': '#a08030', danger: '#e05555' };
    Object.keys(defs).forEach(function(k) {
      root.style.setProperty('--' + k, defs[k]);
    });
  }

  // 动态重建页签（manifest 定制）：先清空原静态页签，按 manifest 生成；
  // 每个 tab 若有对应 ui/panels/<id>.html → iframe 加载（自定义面板）；否则用宿主默认面板 div
function renderDynamicTabs(tabs, hideTabs) {
var nav = document.querySelector('.panel-tabs');
if (!nav) return;
var hide = {};
(hideTabs || []).forEach(function(h) { hide[h] = true; });
// 2026-08-05：GM 页签（GM工具+模组）仅 GM/主机可见——非 GM 一律隐藏
var notGM = typeof isGMUser === 'function' && !isGMUser();
// 生成页签按钮
nav.innerHTML = '';
var firstVisible = null;
tabs.forEach(function(t, i) {
if (hide[t.id]) return;
if (notGM && t.id === 'gm') return; // 非 GM 隐藏 GM 页签
if (notGM && t.visibility === 'gm') return; // 2026-08-05：GM/PL 区分——visibility=gm 的页签仅 GM
if (!firstVisible) firstVisible = t;
      var btn = document.createElement('button');
      btn.className = 'panel-tab' + (i === 0 ? ' active' : '');
      btn.setAttribute('data-tab', t.id);
      btn.textContent = (t.icon || '') + ' ' + (t.name || t.id);
      btn.addEventListener('click', function() {
        nav.querySelectorAll('.panel-tab').forEach(function(x) { x.classList.remove('active'); });
        this.classList.add('active');
        document.querySelectorAll('.panel-content').forEach(function(p) { p.classList.remove('active'); });
        var c = _el('tab-' + t.id); if (c) c.classList.add('active');
        if (t.id === 'rules') { refreshModuleList(); }
        if (t.id === 'encounter') renderInitiativeList();
        if (t.id === 'settings') _populateSettingsForm();
      });
      nav.appendChild(btn);
    });
    // 为 manifest 新增的自定义 tab 创建面板容器（iframe 加载规则书 ui/panels/<id>.html）
    tabs.forEach(function(t) {
      if (hide[t.id]) return;
      if (!_el('tab-' + t.id)) {
        // 宿主无此面板 → 创建 iframe 面板（规则书自定义）
        var panel = document.createElement('div');
        panel.id = 'tab-' + t.id;
        panel.className = 'panel-content custom-panel' + (t.id === (firstVisible || {}).id ? ' active' : '');
        panel.innerHTML = '<iframe class="custom-panel-frame" src="/api/ui-panel?system=' + encodeURIComponent(_selectedRuleSystem || '') + '&panel=' + encodeURIComponent(t.id) + '" frameborder="0"></iframe>';
        var side = _el('side-panel');
        if (side) side.appendChild(panel);
      }
    });
    // 激活第一个可见 tab
    if (firstVisible) {
      nav.querySelectorAll('.panel-tab').forEach(function(x) {
        x.classList.toggle('active', x.getAttribute('data-tab') === firstVisible.id);
      });
      document.querySelectorAll('.panel-content').forEach(function(p) { p.classList.remove('active'); });
      var c = _el('tab-' + firstVisible.id); if (c) c.classList.add('active');
    }
  }

  function _setupTabs() {
    // 2026-08-05：GM 页签（GM工具+模组管理）仅 GM/主机可见——非 GM 隐藏
    if (typeof isGMUser === 'function' && !isGMUser()) {
      document.querySelectorAll('.panel-tab[data-tab="gm"]').forEach(function(t) { t.style.display = 'none'; });
    }
    document.querySelectorAll('.panel-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = this.getAttribute('data-tab');
        document.querySelectorAll('.panel-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel-content').forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        var c = _el('tab-' + target); if (c) c.classList.add('active');
        if (target === 'rules') { refreshModuleList(); }
        if (target === 'encounter') renderInitiativeList();
        if (target === 'settings') _populateSettingsForm();
      });
    });
    // 二级页签（作用域隔离：只切换同一面板内的 sub-tab / sub-panel，避免跨面板干扰）
    document.querySelectorAll('.sub-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var scope = this.closest('.panel-content') || document;
        scope.querySelectorAll('.sub-tab').forEach(function(t) { t.classList.remove('active'); });
        scope.querySelectorAll('.sub-panel').forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        var p = _el('sub-' + this.getAttribute('data-sub'));
        if (p) p.classList.add('active');
        if (this.getAttribute('data-sub') === 'modules') refreshModuleList();
      });
    });
  }

  function setupChat() {
    var chatInput = _el('chat-input');
    renderChannelTabs();
    var addBtn = _el('btn-channel-add'); if (addBtn) addBtn.addEventListener('click', createChannel);
    var delBtn = _el('btn-channel-del'); if (delBtn) delBtn.addEventListener('click', deleteChannel);
    // 频道归档：保留jsonl文件，从主栏隐藏；再次点击列出归档频道供恢复
    var arcBtn = _el('btn-channel-archive');
    if (arcBtn) arcBtn.addEventListener('click', archiveChannelMenu);
    var upBtn = _el('btn-channel-up'); if (upBtn) upBtn.addEventListener('click', function() { moveChannel(-1); });
    var downBtn = _el('btn-channel-down'); if (downBtn) downBtn.addEventListener('click', function() { moveChannel(1); });
    var promptBtn = _el('btn-channel-prompt'); if (promptBtn) promptBtn.addEventListener('click', editChannelPrompt);
    // 频道弹层按钮（2026-08-06 多行提示词）
    var cmClose = _el('channel-modal-close'); if (cmClose) cmClose.addEventListener('click', closeChannelModal);
    var cmCancel = _el('channel-modal-cancel'); if (cmCancel) cmCancel.addEventListener('click', closeChannelModal);
    var cmSave = _el('channel-modal-save'); if (cmSave) cmSave.addEventListener('click', saveChannelModal);
    var cmModal = _el('channel-modal');
    if (cmModal) cmModal.addEventListener('mousedown', function(e) { if (e.target === cmModal) closeChannelModal(); });
    // 冒险选择器（D+三级会话：规则书-冒险-频道；默认'默认'，从服务端读取冒险列表）
    var advSelect = _el('adventure-select');
    if (advSelect) {
      advSelect.addEventListener('change', function() {
        _currentAdventure = advSelect.value || '默认';
        try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {}
        renderChannelTabs();
      });
    }
    loadAdventureList();
    // 主菜单侧边栏（2026-08-05 v2 抽屉式）：☰ 按钮开/关，左侧滑出 + 右侧遮罩
    var menuBtn = _el('btn-main-menu');
    if (menuBtn) menuBtn.addEventListener('click', openGlobalSidebar);
    var gsClose = _el('btn-gs-close');
    if (gsClose) gsClose.addEventListener('click', closeGlobalSidebar);
    var gsMask = _el('sidebar-mask');
    if (gsMask) gsMask.addEventListener('click', closeGlobalSidebar);
    var backBtn = _el('btn-start-back');
    if (backBtn) backBtn.addEventListener('click', function() { _startRuleStep = false; renderStartScreen(); });
    var gsMain = _el('btn-gs-main');
    if (gsMain) gsMain.addEventListener('click', function() { _startRuleStep = false; renderStartScreen(); closeGlobalSidebar(); });
    // 开始界面上传/新建冒险（复用规则书文件输入）
    var startUpload = _el('btn-start-upload');
    if (startUpload) startUpload.addEventListener('click', function() {
      var fi2 = _el('rulebook-file-input'); if (fi2) fi2.click();
      else addChatMessage('system', '规则书', '请到右侧「📚规则」页签上传规则书。');
    });
    var startNewAdv = _el('btn-start-new-adv');
    if (startNewAdv) startNewAdv.addEventListener('click', function() {
      var nn = prompt('新冒险名称：');
      if (!nn || !nn.trim()) return;
      fetch('/api/adventures/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: _pendingStartRule || _selectedRuleSystem || '', name: nn.trim() }) })
        .then(function(r) { return r.json(); })
        .then(function(d) { if (d.success) { _currentAdventure = d.adventure; try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {} pickAdventure(d.adventure); } else alert(d.error || '创建失败'); })
        .catch(function(e) { alert('创建失败: ' + (e.message || e)); });
    });
    // 开始界面拖放上传（2026-08-05 v5）：无特效，纯功能——拖文件到窗口任意位置即上传（复用既有流程）
    document.addEventListener('dragover', function(e) { e.preventDefault(); });
    document.addEventListener('drop', function(e) {
      e.preventDefault();
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var f = files[0];
      var fi3 = _el('rulebook-file-input');
      if (!fi3) { return; }
      var dt = new DataTransfer();
      dt.items.add(f);
      fi3.files = dt.files;
      fi3.dispatchEvent(new Event('change', { bubbles: true }));
    });
    var historyBtn = _el('btn-channel-history');
    if (historyBtn) historyBtn.addEventListener('click', viewChannelHistory);
    // 2026-08-05：清空当前频道对话（系统频道开发记录不保留）——删除服务端 jsonl + 清空本地历史
    var clearBtn = _el('btn-channel-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        var ch = getActiveChannel();
        if (!ch) return;
        if (!confirm('清空「' + ch.name + '」频道的全部对话？\n开发记录将不可恢复（本地历史与服务器会话一并清空）。')) return;
        var sys = _selectedRuleSystem || '';
        var adv = _currentAdventure || '默认';
        fetch('/api/sessions/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: sys, adventure: adv, channel: ch.id })
        }).catch(function() {});
        // 清空本地聊天历史（该频道）
        _chatHistory = _chatHistory.filter(function(m) { return (m.channelId || 'story') !== ch.id; });
        _persistChatLog();
        renderChatMessages();
        addChatMessage('system', '频道', '已清空「' + ch.name + '」频道对话。');
      });
      // 系统频道才显示清空按钮（剧情/战斗等保留记录）
      var ch = getActiveChannel();
      if (ch && ch.id === 'system') clearBtn.style.display = '';
    }
    // 冒险管理面板：打开/关闭/新建/搜索
    var advMgrBtn = _el('btn-adventure-manage');
    if (advMgrBtn) advMgrBtn.addEventListener('click', toggleAdventurePanel);
    var advCloseBtn = _el('btn-adv-close');
    if (advCloseBtn) advCloseBtn.addEventListener('click', function() { var p = _el('adventure-panel'); if (p) p.style.display = 'none'; var b2 = _el('btn-adventure-manage'); if (b2) b2.classList.remove('active'); });
    var advCreateBtn = _el('btn-adv-create');
    if (advCreateBtn) advCreateBtn.addEventListener('click', function() {
      var nn = prompt('新冒险名称：');
      if (!nn || !nn.trim()) return;
      fetch('/api/adventures/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: _selectedRuleSystem || '', name: nn.trim() }) })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) { _currentAdventure = d.adventure; try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {} loadAdventureList(); }
          else alert(d.error || '创建失败');
        })
        .catch(function(e) { alert('创建失败: ' + (e.message || e)); });
    });
    var advSearch = _el('adv-search');
    if (advSearch) advSearch.addEventListener('input', function() { renderAdventurePanel(_advPanelData); });
    // AI开发状态框：点击头部折叠/展开
    var devHead = _el('ai-dev-status');
    if (devHead) devHead.addEventListener('click', function(e) {
      if (e.target && (e.target.id === 'ai-dev-collapse' || e.target.className === 'ai-dev-collapse')) {
        var body = _el('ai-dev-body');
        var btn = _el('ai-dev-collapse');
        if (body) {
          var collapsed = body.classList.toggle('collapsed');
          if (btn) btn.textContent = collapsed ? '＋' : '−';
        }
      }
    });
    var aiToggle = _el('chat-ai-toggle');
    if (aiToggle) aiToggle.addEventListener('change', function() {
      if (!canUseAIChat()) {
        this.checked = false;
        _settings.aiQuickMode = false;
        _saveSettings();
        updateAIControls();
        addChatMessage('system', 'AI', '只有GM/房主可以打开AI开关。');
        return;
      }
      _settings.aiQuickMode = !!this.checked;
      _saveSettings();
      updateAIControls();
    });
    function autoResizeChatInput() {
      if (!chatInput) return;
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    }
    // 输入草稿：自动保存到 localStorage，发送失败/关窗后不丢内容
    function saveDraft() { try { localStorage.setItem('trpg_chat_draft', chatInput.value); } catch (e) {} }
    function clearDraft() { try { localStorage.removeItem('trpg_chat_draft'); } catch (e) {} }
    function _sendChat() {
      if (!chatInput) return;
      var text = chatInput.value.trim(); if (!text) return;
      // 续接触发词：有中断未完成的回复时，"继续"让AI从断点续写
      if (_pendingResume && /^(继续|继续写|继续生成|continue|resume)$/i.test(text)) {
        chatInput.value = ''; clearDraft(); autoResizeChatInput();
        resumeAI();
        return;
      }
      if (text.startsWith('/ai')) {
        if (!canUseAIChat()) {
          addChatMessage('system', 'AI', '只有GM/房主可以向AI提问。');
          return; // 保留输入内容
        }
        var aiMsg = text.replace(/^\/ai\s*/, '');
        if (aiMsg) {
          chatInput.value = ''; clearDraft(); autoResizeChatInput();
          sendToAI(aiMsg); // 发送失败时 sendToAI 会把内容放回输入框
        }
        return;
      }
      var result = DiceSystem.smartRoll(text);
      if (result) {
        addChatMessage('dice', '骰子', DiceSystem.formatResult(result));
        if (AIClient && typeof AIClient.recordRoll === 'function') AIClient.recordRoll(text, result, '');
        if (Network.isConnected()) Network.sendDiceRoll(text, result);
        chatInput.value = ''; clearDraft(); autoResizeChatInput();
      } else {
        // GM快速AI开关：开启时普通文本直接交给AI；关闭时作为普通聊天。
        if (canUseAIChat() && _settings.aiQuickMode) {
          chatInput.value = ''; clearDraft(); autoResizeChatInput();
          sendToAI(text); // 发送失败时 sendToAI 会把内容放回输入框
        } else {
          // 2026-08-06：本地聊天同样显示"角色名（你）"
          var myChar = getMyCharacterName();
          addChatMessage('user', myChar ? myChar + '（你）' : '你', text);
          chatInput.value = ''; clearDraft(); autoResizeChatInput();
        }
      }
    }
    var btn = _el('btn-send'); if (btn) btn.addEventListener('click', _sendChat);
    if (chatInput) {
      // 恢复上次未发送的草稿
      try {
        var draft = localStorage.getItem('trpg_chat_draft');
        if (draft) { chatInput.value = draft; autoResizeChatInput(); }
      } catch (e) {}
      chatInput.addEventListener('input', function() { autoResizeChatInput(); saveDraft(); });
      chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendChat(); }
      });
      autoResizeChatInput();
    }
  }

  function getActiveChannel() {
    return _chatChannels.find(function(c) { return c.id === _activeChannelId; }) || _chatChannels[0] || DEFAULT_CHANNELS[0];
  }

  function renderChannelTabs() {
    var tabs = _el('chat-channel-tabs'); if (!tabs) return;
    tabs.innerHTML = '';
    _chatChannels.forEach(function(ch) {
      if (ch.archived) return; // 归档频道不在主栏显示（保留jsonl可恢复）
      var btn = document.createElement('button');
      btn.className = 'chat-channel-tab' + (ch.id === _activeChannelId ? ' active' : '');
      btn.title = ch.prompt || ch.name;
      var label = document.createElement('span');
      label.textContent = (ch.avg ? '🎭 ' : '') + ch.name;
      btn.appendChild(label);
      var unread = _channelUnread[ch.id] || 0;
      if (ch.id !== _activeChannelId && unread > 0) {
        var dot = document.createElement('span');
        dot.className = 'channel-unread-dot';
        dot.textContent = unread > 99 ? '99+' : String(unread);
        btn.appendChild(dot);
      }
      btn.addEventListener('click', function() {
        _activeChannelId = ch.id;
        _channelUnread[ch.id] = 0;
        renderChannelTabs();
        renderChatMessages();
        // 2026-08-05：清空按钮仅系统频道显示
        var clearBtn = _el('btn-channel-clear');
        if (clearBtn) clearBtn.style.display = (ch.id === 'system') ? '' : 'none';
        // 2026-08-05：切换频道时加载该频道的服务端历史（若有新内容）
        loadChannelHistoryFromServer(ch.id);
      });
      tabs.appendChild(btn);
    });
    renderChatMessages();
  }

  function createChannel() {
    openChannelModal(null, true);
  }

  function moveChannel(delta) {
    var idx = _chatChannels.findIndex(function(c) { return c.id === _activeChannelId; });
    var ni = idx + delta;
    if (idx < 0 || ni < 0 || ni >= _chatChannels.length) return;
    var item = _chatChannels.splice(idx, 1)[0];
    _chatChannels.splice(ni, 0, item);
    _saveChannels();
    renderChannelTabs();
  }

  // 删除频道：默认3个（剧情/战斗/系统）不可删除，仅新增频道可删
  function deleteChannel() {
    var ch = getActiveChannel();
    if (!ch) return;
    if (DEFAULT_CHANNELS.some(function(d) { return d.id === ch.id; })) {
      alert('默认频道（剧情/战斗/系统）不可删除，仅可删除新增频道。');
      return;
    }
    if (!confirm('彻底删除频道「' + ch.name + '」？\n此操作将删除该频道的本地会话文件（jsonl），不可恢复。若想保留历史请使用「归档」或先「历史」导出查阅。')) return;
    var idx = _chatChannels.findIndex(function(c) { return c.id === ch.id; });
    if (idx < 0) return;
    _chatChannels.splice(idx, 1);
    // 删除该频道的消息记录（内存+持久化）
    _chatHistory = _chatHistory.filter(function(m) { return (m.channelId || 'story') !== ch.id; });
    _persistChatLog();
    delete _channelUnread[ch.id];
    _activeChannelId = _chatChannels[0] ? _chatChannels[0].id : 'story';
    _saveChannels();
    renderChannelTabs();
    // 彻底删除服务端会话文件（jsonl）
    fetch('/api/sessions/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: _selectedRuleSystem || '', adventure: _currentAdventure || '默认', channel: ch.id })
    }).catch(function() { /* 后端删除失败不阻塞界面 */ });
    addChatMessage('system', '频道', '已彻底删除频道: ' + ch.name);
  }

  // 频道归档菜单：归档当前频道 / 列出已归档频道供恢复（归档保留jsonl，删除才彻底删）
  function archiveChannelMenu() {
    var ch = getActiveChannel();
    var archivedList = _chatChannels.filter(function(c) { return c.archived; });
    var promptText = '频道归档管理：\n\n' +
      (archivedList.length ? '已归档频道：\n' + archivedList.map(function(c, i) { return (i + 1) + '. ' + c.name; }).join('\n') + '\n\n' : '（无已归档频道）\n\n') +
      (ch && !ch.archived ? '操作：\n  1=归档当前频道「' + ch.name + '」\n' : '') +
      '  恢复 = 输入要恢复的频道名\n  取消 = 关闭';
    var ans = prompt(promptText, ch && !ch.archived ? '1' : '');
    if (!ans) return;
    if (ans.trim() === '1' && ch && !ch.archived) {
      if (!confirm('归档频道「' + ch.name + '」？本地会话文件保留，可从归档列表恢复。')) return;
      ch.archived = true;
      _saveChannels();
      _activeChannelId = _chatChannels.find(function(c) { return !c.archived; }) ? _chatChannels.find(function(c) { return !c.archived; }).id : 'story';
      renderChannelTabs();
      addChatMessage('system', '频道', '已归档频道: ' + ch.name + '（可点🗄恢复）');
      return;
    }
    var restore = archivedList.find(function(c) { return c.name === ans.trim(); });
    if (restore) {
      restore.archived = false;
      _saveChannels();
      _activeChannelId = restore.id;
      renderChannelTabs();
      addChatMessage('system', '频道', '已恢复频道: ' + restore.name);
    } else {
      alert('未找到频道「' + ans + '」。');
    }
  }

  // 频道弹层（新建/提示词编辑）：多行 textarea 输入，2026-08-06 取代浏览器单行 prompt()
  var _channelModalCtx = null;
  function openChannelModal(ch, isNew) {
    var modal = _el('channel-modal'); if (!modal) return;
    var title = _el('channel-modal-title'); if (title) title.textContent = isNew ? '新建频道' : '频道设置（提示词）';
    var nameEl = _el('channel-modal-name');
    if (nameEl) nameEl.value = ch ? (ch.name || '') : '';
    var promptEl = _el('channel-modal-prompt');
    if (promptEl) promptEl.value = ch ? (ch.prompt || '') : '';
    var avgCb = _el('channel-modal-avg');
    if (avgCb) avgCb.checked = !!(ch && ch.avg);
    _channelModalCtx = { ch: ch, isNew: isNew };
    modal.style.display = 'flex';
    if (isNew && nameEl) nameEl.focus();
    else if (promptEl) promptEl.focus();
  }
  function closeChannelModal() {
    var modal = _el('channel-modal'); if (modal) modal.style.display = 'none';
    _channelModalCtx = null;
  }
  function saveChannelModal() {
    var ctx = _channelModalCtx; if (!ctx) return;
    var modal = _el('channel-modal'); if (!modal) return;
    var name = (_el('channel-modal-name').value || '').trim();
    var promptEl = _el('channel-modal-prompt');
    var prompt = promptEl ? promptEl.value : '';
    var avgCb = _el('channel-modal-avg');
    var avg = !!(avgCb && avgCb.checked);
    if (!name) { alert('请填写频道名称'); return; }
    if (ctx.isNew) {
      var ch = { id: 'ch_' + Date.now(), name: name, prompt: prompt };
      if (avg) ch.avg = true;
      _chatChannels.push(ch);
      _activeChannelId = ch.id;
    } else if (ctx.ch) {
      ctx.ch.name = name;
      ctx.ch.prompt = prompt;
      if (avg) ctx.ch.avg = true; else delete ctx.ch.avg;
    }
    _saveChannels();
    modal.style.display = 'none';
    _channelModalCtx = null;
    renderChannelTabs();
  }

  function editChannelPrompt() {
    var ch = getActiveChannel();
    if (!ch) return;
    openChannelModal(ch, false);
  }

  function renderChatMessages() {
    var cont = _el('chat-messages'); if (!cont) return;
    cont.innerHTML = '';
    var max = _settings.maxChat || 200;
    // 2026-08-05 全站重构：AVG 频道渲染历史时按消息顺序重建立绘舞台快照，
    // 每条消息显示其"当时的立绘状态"（倒回查看时立绘与对话进程一致）
    var avgOn = avgEnabledFor(_activeChannelId);
    var histStage = { left: null, right: null, speaking: null };
    _chatHistory.filter(function(m) { return (m.channelId || 'story') === _activeChannelId; }).slice(-max).forEach(function(m) {
      var snap = null;
      if (avgOn && m.type === 'ai') {
        var d = extractPortraitDirective(m.message);
        if (d) {
          if (d.clear) {
            histStage = { left: null, right: null, speaking: null };
          } else if (d.name) {
            var actor = resolvePortraitActor(d.name);
            var hasL = histStage.left && histStage.left.name === actor.name;
            var hasR = histStage.right && histStage.right.name === actor.name;
            if (!hasL && !hasR) {
              if (!histStage.left) histStage.left = actor;
              else if (!histStage.right) histStage.right = actor;
              else {
                if (histStage.speaking && histStage.speaking.name === histStage.left.name) histStage.right = actor;
                else histStage.left = actor;
              }
            }
            histStage.speaking = actor;
          }
          snap = { left: histStage.left, right: histStage.right, speaking: histStage.speaking };
        }
      }
      appendChatMessageElement(cont, m, snap);
    });
    cont.scrollTop = cont.scrollHeight;
    renderAvgStageBar();
  }

  // ── 服务端会话历史加载（2026-08-05 修复）：主界面聊天区与历史窗口同源 ──
  // 聊天区历史此前只依赖 localStorage（可能被清空/跨会话丢失），导致"聊天区看不到历史、历史窗口能看到"。
  // 现在进入界面/切换频道时从服务端 jsonl（/api/sessions/read）加载 user/assistant 消息到聊天区，
  // tool 消息不显示（与历史窗口显示策略一致）。
  var _serverHistLoaded = {}; // channelId -> 最后加载的 assistant 时间戳（去重用）

  function loadChannelHistoryFromServer(channelId, force) {
    var sys = _selectedRuleSystem || '';
    var adv = _currentAdventure || '默认';
    if (!sys) return;
    fetch('/api/sessions/read?system=' + encodeURIComponent(sys) + '&adventure=' + encodeURIComponent(adv) + '&channel=' + encodeURIComponent(channelId || 'story'))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.messages || !data.messages.length) return;
        var lastLoaded = _serverHistLoaded[channelId] || 0;
        var loaded = 0;
        data.messages.forEach(function(m) {
          if (m.role !== 'user' && m.role !== 'assistant') return; // tool 消息不显示给用户
          var text = String(m.content || '').trim();
          if (!text) return;
          // 跳过系统注入消息（【会话起点】与动态摘要等，对用户无意义）
          if (text.indexOf('【会话起点】') === 0) return;
          if (m.role === 'user' && text === '继续') return; // 内部续接指令不显示
          var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          var key = channelId + '|' + (m.role === 'user' ? 'user' : 'ai') + '|' + text.substring(0, 80);
          // 与 localStorage 历史去重：同内容同类型不重复添加
          var dup = _chatHistory.some(function(x) {
            return (x.channelId || 'story') === channelId && x.type === (m.role === 'user' ? 'user' : 'ai') && String(x.message || '').indexOf(text.substring(0, 60)) >= 0;
          });
          if (dup) { loaded++; return; }
          _chatHistory.push({ time: time, sender: m.role === 'user' ? '你' : 'AI', message: text, type: m.role === 'user' ? 'user' : 'ai', channelId: channelId });
          loaded++;
        });
        if (loaded > 0) {
          var max = _settings.maxChat || 200;
          while (_chatHistory.length > max) _chatHistory.shift();
          _persistChatLog();
          if (channelId === _activeChannelId) renderChatMessages();
        }
        _serverHistLoaded[channelId] = Date.now();
      })
      .catch(function() { /* 服务端无历史或网络错误时静默（本地历史仍可用） */ });
  }

  // ── 聊天记录持久化（2026-08-05）：只保存玩家输入(user)与AI输出正文(ai/dice)，
  //    不保存系统消息（工具调用/进度通知/状态提示等 type=system 的消息） ──
  var CHAT_LOG_KEY = 'trpg_chat_log';
  var SAVEABLE_TYPES = { user: 1, ai: 1, dice: 1 };

  function _persistChatLog() {
    try {
      var keep = _chatHistory.filter(function(m) { return SAVEABLE_TYPES[m.type]; });
      // 只保留最近 maxChat 条（与界面一致），避免无限增长
      var max = _settings.maxChat || 200;
      if (keep.length > max) keep = keep.slice(keep.length - max);
      localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(keep));
    } catch (e) { /* 存储不可用或超出容量时静默 */ }
  }

  function _restoreChatLog() {
    try {
      var raw = localStorage.getItem(CHAT_LOG_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      // 只恢复可保存类型；过滤损坏条目
      var valid = arr.filter(function(m) {
        return m && m.message && SAVEABLE_TYPES[m.type] && (m.channelId || 'story');
      });
      if (!valid.length) return;
      // 合并回历史（保留现有 system 消息在正确顺序：先恢复旧记录，再追加未持久化的新消息）
      var existing = _chatHistory.slice();
      var existingIds = {};
      existing.forEach(function(m, i) {
        var key = m.time + '|' + m.type + '|' + m.sender + '|' + (m.message || '').substring(0, 60);
        existingIds[key] = true;
      });
      var merged = valid.filter(function(m) {
        var key = m.time + '|' + m.type + '|' + m.sender + '|' + (m.message || '').substring(0, 60);
        if (existingIds[key]) return false;
        existingIds[key] = true;
        return true;
      });
      if (merged.length) _chatHistory = merged.concat(existing);
      var max = _settings.maxChat || 200;
      while (_chatHistory.length > max) _chatHistory.shift();
    } catch (e) { /* 恢复失败不影响使用 */ }
  }

  function appendChatMessageElement(cont, msg, stageSnapshot) {
    if (msg.reasoning) {
      appendAIElementWithReasoning(cont, msg);
      return;
    }
    // 2026-08-06 AVG 立绘模式：频道标记"显示发言立绘"且 AI 输出 <portrait name="角色名"> 时
    // 以"双人立绘舞台+文字"布局渲染（开始对话者居左、新来者居右、发言者高亮、另一方压暗）
    if (msg.type === 'ai') {
      // 插图指令：<illustration> 以插图临时代替地图（过场），<illustration clear> 恢复
      var ill = extractIllustrationDirective(msg.message);
      if (ill) {
        if (ill.clear) hideIllustration();
        else if (ill.url) showIllustration(ill.url, ill.caption);
        msg = Object.assign({}, msg, { message: stripIllustrationTags(msg.message) });
      }
      var avgDirective = extractPortraitDirective(msg.message);
      if (avgDirective) {
        if (avgEnabledFor(msg.channelId || _activeChannelId)) {
          renderAVGMessage(cont, msg, avgDirective, stageSnapshot);
          return;
        }
        // 频道未标记"显示发言立绘"：剥离立绘标签，按普通消息显示正文
        msg = Object.assign({}, msg, { message: avgDirective.text });
      }
    }
    // 玩家发言驱动立绘舞台：当前频道启用 AVG 时，玩家消息按发送者匹配角色立绘并高亮
    if (msg.type === 'user' && avgEnabledFor(msg.channelId || _activeChannelId) && !stageSnapshot) {
      var pActor = resolvePortraitActor(msg.sender && msg.sender !== '你' ? msg.sender : '');
      if (pActor && pActor.name && msg.sender !== '你') {
        stageSpeak(pActor);
        renderAvgStageBar();
      }
    }
    // 2026-08-05 条目化：撤回占位——已撤回消息显示"XX撤回了一条消息"，不显示内容
    if (msg.status === 'retracted') {
      var rd = document.createElement('div');
      rd.className = 'chat-message system chat-retracted-note';
      rd.innerHTML = '<span class="msg-sender">系统:</span><span class="msg-text chat-retracted-text">' + _esc(msg.retractedBy || '有人') + ' 撤回了一条消息</span>';
      cont.appendChild(rd);
      return;
    }
    var div = document.createElement('div');
    div.className = 'chat-message ' + msg.type;
    div.setAttribute('data-msgid', msg.id || '');
    // 操作区（2026-08-05）：编辑（作者本人）、撤回（作者本人或GM）、许可（GM+联机+pending）
    var ops = '';
    var canEdit = (msg.type === 'user' && msg.author === 'local') || (msg.type === 'ai' && typeof isGMUser === 'function' && isGMUser());
    var canRetract = canEdit || (typeof isGMUser === 'function' && isGMUser());
    if (msg.status === 'pending' && typeof isGMUser === 'function' && isGMUser() && Network && Network.isConnected && Network.isConnected() && Network.getRoomCode && Network.getRoomCode()) {
      ops += '<span class="msg-op msg-op-approve" title="许可：广播给所有玩家">✅ 许可</span>' +
             '<span class="msg-op msg-op-reject" title="拒绝：不广播并移除">↩ 拒绝</span>';
    } else {
      if (canEdit) ops += '<span class="msg-op msg-op-edit" title="编辑">✎</span>';
      if (canRetract) ops += '<span class="msg-op msg-op-retract" title="撤回">↩</span>';
    }
    var pendingBadge = (msg.status === 'pending') ? '<span class="msg-pending-badge">📋 待许可</span>' : '';
    var editedMark = msg.edited ? ' <span class="msg-edited-mark" title="已编辑">(已编辑)</span>' : '';
    div.innerHTML = '<span class="msg-time">' + _esc(msg.time) + '</span>' +
      '<span class="msg-sender">' + _esc(msg.sender) + ':</span>' +
      pendingBadge +
      '<span class="msg-text">' + simpleMarkdown(msg.message) + editedMark + '</span>' +
      (ops ? '<span class="msg-ops">' + ops + '</span>' : '');
    // 绑定操作
    if (div.querySelector('.msg-op-approve')) {
      div.querySelector('.msg-op-approve').addEventListener('click', function() { approveAIMessage(msg); });
    }
    if (div.querySelector('.msg-op-reject')) {
      div.querySelector('.msg-op-reject').addEventListener('click', function() { rejectAIMessage(msg); });
    }
    if (div.querySelector('.msg-op-edit')) {
      div.querySelector('.msg-op-edit').addEventListener('click', function() { startEditMessage(div, msg); });
    }
    if (div.querySelector('.msg-op-retract')) {
      div.querySelector('.msg-op-retract').addEventListener('click', function() { retractMessage(msg); });
    }
    cont.appendChild(div);
  }

  function addChatMessage(type, sender, message, channelId) {
    var cont = _el('chat-messages'); if (!cont) return;
    var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    // 系统消息默认路由到系统频道；用户消息留在当前频道
    var targetChannel = channelId || (type === 'system' ? 'system' : _activeChannelId) || 'story';
    // 目标频道不存在时（如旧存档缺系统频道）自动补齐
    if (!_chatChannels.some(function(c) { return c.id === targetChannel; })) {
      var def = DEFAULT_CHANNELS.find(function(c) { return c.id === targetChannel; });
      if (def) _chatChannels.push(JSON.parse(JSON.stringify(def)));
    }
    // 条目化（2026-08-05）：唯一 id + 作者归属（权限：编辑/撤回校验）
    var item = { id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), time: time, sender: sender, message: message, type: type, channelId: targetChannel, author: type === 'user' ? 'local' : (type === 'ai' ? 'ai' : 'system'), status: 'normal' };
    _chatHistory.push(item);
    if (targetChannel === _activeChannelId) {
      appendChatMessageElement(cont, item);
      cont.scrollTop = cont.scrollHeight;
    } else {
      // 非活跃频道收到消息：未读计数+1，刷新红点
      _channelUnread[targetChannel] = (_channelUnread[targetChannel] || 0) + 1;
      renderChannelTabs();
    }
    var max = _settings.maxChat || 200;
    while (_chatHistory.length > max) _chatHistory.shift();
    while (cont.children.length > max) { if (cont.firstChild) cont.removeChild(cont.firstChild); }
    _persistChatLog();
  }

  function setupChatResize() {
    var handle = _el('bottom-resize-handle'); var panel = _el('bottom-panel'); var main = _el('main-area');
    if (!handle || !panel || !main) return;
    var saved = parseInt(localStorage.getItem('trpg_bottom_height') || '220', 10);
    applyBottomHeight(saved);
    var dragging = false;
    handle.addEventListener('mousedown', function(e) { dragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      applyBottomHeight(window.innerHeight - e.clientY);
    });
    window.addEventListener('mouseup', function() { if (dragging) localStorage.setItem('trpg_bottom_height', String(panel.offsetHeight)); dragging = false; });
    // 2026-08-05 全站重构：地图是最底层铺满全窗口（fixed inset:0），底部聊天区是浮动层，
    // 调整聊天高度只改变浮动层自身，地图比例不再随之变动。
    function applyBottomHeight(h) {
      h = Math.max(120, Math.min(Math.round(window.innerHeight * 0.7), h || 220));
      panel.style.height = h + 'px';
      main.style.height = '';
      main.style.top = '0'; main.style.left = '0'; main.style.right = '0'; main.style.bottom = '0';
      // 2026-08-06：右侧面板底部与聊天栏顶对齐（同层级浮动层互不遮挡），角色列表/详情不再被聊天栏盖住
      var side = _el('side-panel');
      if (side) side.style.bottom = (h + 4) + 'px';
      if (window.MapEngine && typeof window.MapEngine.resize === 'function') {
        try { window.MapEngine.resize(); } catch (e) {}
      }
    }
  }

  function setupDice() {
    document.querySelectorAll('.dice-btn[data-dice]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var expr = this.getAttribute('data-dice');
        var result = DiceSystem.smartRoll(expr);
        if (result) {
          addChatMessage('dice', '骰子', DiceSystem.formatResult(result));
          if (AIClient && typeof AIClient.recordRoll === 'function') AIClient.recordRoll(expr, result, '');
          if (Network.isConnected()) Network.sendDiceRoll(expr, result);
        }
      });
    });
    var bc = _el('btn-custom-dice'); if (bc) bc.addEventListener('click', function() { openDiceModal(); });
  }

  // ── AI对话（通过聊天集成） ─────────────────────

  var AI_MODE_PROMPTS = {
    full: '当前模式：完整GM带团。负责剧情推进、NPC扮演、规则判定与数据管理（HP/资源/物品/状态精确更新）。融合角色设定与世界观，不盲目吹捧玩家角色。记忆不可靠，不确定时翻查规则书和模组。需要规则时回复[[search:关键词]]。剧情对话支持AVG双人立绘模式：用 <portrait name="角色名">对话文本</portrait> 让该角色发言并显示立绘（首次出现的角色居左，第二位居右，当前发言者高亮、另一方压暗，模拟完整AVG），</portrait> 或 <portrait clear> 关闭立绘。过场/无需地图移动的场景：用 <illustration src="模组路径或图片URL" caption="标题">描述</illustration> 以插图临时代替地图，<illustration clear> 结束插图恢复地图。',
    scene: '当前模式：场景描写。只负责描写环境、氛围、NPC外观和行为。不干预玩家之间的扮演对话，不替玩家做决定，不判定行动结果。玩家要求场景变化或地图更新时照做。需要模组设定时回复[[module:关键词]]。NPC出场说话时可用 <portrait name="角色名">对话文本</portrait> 显示立绘（双人舞台：首次居左、第二位居右、发言者高亮另一方压暗），</portrait> 或 <portrait clear> 关闭。过场插图：<illustration src="模组路径或URL" caption="标题">描述</illustration> 或 <illustration clear> 结束。',
    rules: '当前模式：规则助手。只回答规则问题，引用规则书原文。不做剧情推进，不描写场景，不替玩家决策。需要查规则时回复[[search:关键词]]。'
  };

  // 对标opencode的reasoningSummary：从"**标题**\n\n正文"提取思考摘要标题
  function reasoningSummaryText(text) {
    var content = String(text || '').trim();
    if (!content) return '';
    var match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
    if (match) return match[1].trim();
    return content.length > 80 ? content.substring(0, 80) + '…' : content;
  }

  // 带思考摘要的AI消息（对标opencode：摘要标题独立显示，正文可展开）
  function addAIMessageWithReasoning(reasoningText, content, channelId) {
    var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    var targetChannel = channelId || _activeChannelId || 'story';
    // 2026-08-05 思考显示区分：仅系统频道（开发）保留 AI 思考展示；
    // 剧情/战斗等玩家频道不保存不显示思考内容（沉浸感），只显示正文
    var keepReasoning = targetChannel === 'system';
    // 2026-08-05 联机许可流程：房间内 AI 输出先 pending（仅GM可见），GM 许可后才广播给玩家；
    // 单机（无房间）直接 normal 显示。GM 触发 AI 时本端为 GM。
    var inRoom = !!(Network && Network.isConnected && Network.isConnected() && Network.getRoomCode && Network.getRoomCode());
    var item = { id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), time: time, sender: 'AI', message: content, type: 'ai', channelId: targetChannel, author: 'ai', status: inRoom && targetChannel !== 'system' ? 'pending' : 'normal', reasoning: keepReasoning ? (reasoningText || '') : '' };
    _chatHistory.push(item);
    var cont = _el('chat-messages');
    if (cont && item.channelId === _activeChannelId) {
      appendAIElementWithReasoning(cont, item);
      cont.scrollTop = cont.scrollHeight;
    } else if (item.channelId !== _activeChannelId) {
      _channelUnread[item.channelId] = (_channelUnread[item.channelId] || 0) + 1;
      renderChannelTabs();
    }
    var max = _settings.maxChat || 200;
    while (_chatHistory.length > max) _chatHistory.shift();
    while (cont && cont.children.length > max) { if (cont.firstChild) cont.removeChild(cont.firstChild); }
    // 联机：pending 不广播，等待 GM 点「✅ 许可」；系统频道消息直接广播（开发流程）
    if (Network && Network.isConnected && Network.isConnected() && isGMUser() && item.status === 'normal') {
      Network.sendAIChat(content, targetChannel, item.id);
    }
    _persistChatLog();
  }

  function appendAIElementWithReasoning(cont, msg) {
    var div = document.createElement('div');
    div.className = 'chat-message ai';
    div.setAttribute('data-msgid', msg.id || '');
    var reasoningHtml = '';
    if (msg.reasoning) {
      var summary = reasoningSummaryText(msg.reasoning);
      reasoningHtml = '<div class="chat-reasoning" title="点击展开/收起思考内容">💭 ' + _esc(summary) +
        '<div class="chat-reasoning-body" style="display:none;">' + _esc(msg.reasoning) + '</div></div>';
    }
    // 2026-08-05：AI 消息操作区（GM 可编辑/撤回；pending 显示许可/拒绝）
    var ops = '';
    var isGM = typeof isGMUser === 'function' && isGMUser();
    if (msg.status === 'pending' && isGM && Network && Network.isConnected && Network.isConnected() && Network.getRoomCode && Network.getRoomCode()) {
      ops = '<span class="msg-op msg-op-approve" title="许可：广播给所有玩家">✅ 许可</span>' +
            '<span class="msg-op msg-op-reject" title="拒绝：不广播并移除">↩ 拒绝</span>';
    } else if (isGM) {
      ops = '<span class="msg-op msg-op-edit" title="编辑">✎</span>' +
            '<span class="msg-op msg-op-retract" title="撤回">↩</span>';
    }
    var pendingBadge = (msg.status === 'pending') ? '<span class="msg-pending-badge">📋 待许可</span>' : '';
    var editedMark = msg.edited ? ' <span class="msg-edited-mark" title="已编辑">(已编辑)</span>' : '';
    div.innerHTML = '<span class="msg-time">' + _esc(msg.time) + '</span>' +
      '<span class="msg-sender">AI:</span>' + pendingBadge + reasoningHtml +
      '<span class="msg-text">' + simpleMarkdown(msg.message) + editedMark + '</span>' +
      (ops ? '<span class="msg-ops">' + ops + '</span>' : '');
    var reasonHead = div.querySelector('.chat-reasoning');
    if (reasonHead) {
      reasonHead.addEventListener('click', function() {
        var body = div.querySelector('.chat-reasoning-body');
        if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });
    }
    if (div.querySelector('.msg-op-approve')) div.querySelector('.msg-op-approve').addEventListener('click', function() { approveAIMessage(msg); });
    if (div.querySelector('.msg-op-reject')) div.querySelector('.msg-op-reject').addEventListener('click', function() { rejectAIMessage(msg); });
    if (div.querySelector('.msg-op-edit')) div.querySelector('.msg-op-edit').addEventListener('click', function() { startEditMessage(div, msg); });
    if (div.querySelector('.msg-op-retract')) div.querySelector('.msg-op-retract').addEventListener('click', function() { retractMessage(msg); });
    cont.appendChild(div);
  }

  // 发送失败时把内容放回输入框（不丢用户输入）
  function restoreChatInput(msg) {
    var inp = _el('chat-input');
    if (!inp) return;
    inp.value = msg;
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    try { localStorage.setItem('trpg_chat_draft', msg); } catch (e) {}
  }

  // ── 条目化操作（2026-08-05）：编辑/撤回/许可 ──
  // 权限：作者本人可编辑/撤回自己的消息；GM 可撤回任何消息（不可编辑玩家的）；AI 消息归属 GM。

  // 编辑：原地变输入框 → 保存 → 更新本地+服务端 jsonl+广播
  function startEditMessage(div, msg) {
    if (!div || !msg) return;
    var textEl = div.querySelector('.msg-text');
    if (!textEl) return;
    var old = msg.message;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'msg-edit-input';
    input.value = old;
    input.style.width = '100%';
    var done = function(save) {
      var newText = input.value;
      if (save && newText && newText !== old) {
        msg.message = newText;
        msg.edited = true;
        _persistChatLog();
        // 服务端 jsonl 更新
        updateSessionMessage(msg, newText);
        // 联机广播编辑（服务端校验作者后转发）
        if (Network && Network.isConnected && Network.isConnected() && msg.id) {
          Network.sendChatEdit(msg.id, newText, msg.channelId);
        }
        textEl.innerHTML = simpleMarkdown(newText) + ' <span class="msg-edited-mark" title="已编辑">(已编辑)</span>';
      }
      if (input.parentNode) input.parentNode.replaceChild(textEl, input);
    };
    textEl.parentNode.replaceChild(input, textEl);
    input.focus();
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', function() { done(true); });
  }

  // 撤回：确认 → 本地移除（显示占位）+ 服务端 jsonl 删除 + 广播（作者/GM 均可）
  function retractMessage(msg) {
    if (!msg || !msg.id) return;
    if (!confirm('撤回这条消息？（所有端将移除该消息）')) return;
    var by = (typeof isGMUser === 'function' && isGMUser()) ? 'GM' : '你';
    // 本地：标记为撤回占位（不直接删除条目——占位显示"XX撤回了一条消息"）
    msg.status = 'retracted';
    msg.retractedBy = by;
    msg.message = '';
    _persistChatLog();
    renderChatMessages();
    // 服务端 jsonl 删除该条
    removeSessionMessage(msg);
    // 联机广播撤回（服务端校验作者/GM后转发）
    if (Network && Network.isConnected && Network.isConnected()) {
      Network.sendChatRetract(msg.id, msg.channelId);
    }
  }

  // 联机 GM 许可：AI 消息从 pending → approved 并广播给玩家
  function approveAIMessage(msg) {
    if (!msg) return;
    msg.status = 'approved';
    _persistChatLog();
    renderChatMessages();
    if (Network && Network.isConnected && Network.isConnected()) {
      Network.sendAIChat(msg.message, msg.channelId, msg.id);
    }
  }

  // 联机 GM 拒绝：pending AI 消息不广播，本地移除
  function rejectAIMessage(msg) {
    if (!msg) return;
    msg.status = 'retracted';
    msg.retractedBy = 'GM';
    msg.message = '';
    _persistChatLog();
    renderChatMessages();
    removeSessionMessage(msg);
  }

  // 服务端 jsonl：删除指定 id 的消息
  function removeSessionMessage(msg) {
    if (!_selectedRuleSystem) return;
    fetch('/api/sessions/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: _selectedRuleSystem, adventure: _currentAdventure || '默认', channel: msg.channelId || 'story', id: msg.id })
    }).catch(function() {});
  }

  // 服务端 jsonl：更新指定 id 的消息内容
  function updateSessionMessage(msg, newText) {
    if (!_selectedRuleSystem) return;
    fetch('/api/sessions/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: _selectedRuleSystem, adventure: _currentAdventure || '默认', channel: msg.channelId || 'story', id: msg.id, content: newText })
    }).catch(function() {});
  }

  // 玩家端同步处理：其他端编辑了消息 → 本地原地更新
  function handleRemoteChatEdited(data) {
    var id = data && data.id;
    if (!id) return;
    var hit = _chatHistory.filter(function(m) { return m.id === id; });
    if (!hit.length) return;
    hit.forEach(function(m) {
      m.message = data.newText;
      m.edited = true;
    });
    _persistChatLog();
    if (data.channelId === _activeChannelId) renderChatMessages();
  }

  // 玩家端同步处理：其他端撤回了消息 → 本地标记占位
  function handleRemoteChatRetracted(data) {
    var id = data && data.id;
    if (!id) return;
    var hit = _chatHistory.filter(function(m) { return m.id === id; });
    if (!hit.length) return;
    hit.forEach(function(m) {
      m.status = 'retracted';
      m.retractedBy = data.by || '有人';
      m.message = '';
    });
    _persistChatLog();
    if (data.channelId === _activeChannelId) renderChatMessages();
  }

  // 玩家端收到 AI 广播（GM 许可后）：正常显示（无操作按钮——非作者非GM）
  function handleRemoteAIChat(data) {
    addChatMessage('ai', 'AI', data.text || '', data.channelId || _activeChannelId || 'story');
    // 远端消息不带操作权限（author 非本地）——addChatMessage 已给 author:'ai'，
    // 但远端玩家 isGMUser()=false 时按钮自然不渲染；GM 主机收到自己广播不回显（broadcast 不含自己）
  }

  // ── AI 开发状态框（2026-08-05）：系统频道工具调用/进度/用量摘要，对标opencode reasoningSummary ──
  var _devStatus = { round: 0, input: 0, output: 0, total: 0, steps: [] };
  function updateDevStatus(update) {
    var box = _el('ai-dev-status'); if (!box) return;
    box.style.display = 'block';
    if (update.phase) { _devStatus.phase = update.phase; }
    if (update.summary) { _devStatus.summary = update.summary; }
    if (update.tool) {
      var args = update.args || {};
      var brief = '';
      try {
        var argStr = JSON.stringify(args);
        brief = argStr.length > 90 ? argStr.substring(0, 90) + '…' : argStr;
      } catch (e) { brief = ''; }
      var file = args.path || args.rel || args.pattern || args.command || args.url || '';
      _devStatus.steps.unshift({
        tool: update.tool,
        brief: brief,
        file: String(file).substring(0, 80),
        ok: false
      });
      if (_devStatus.steps.length > 8) _devStatus.steps.pop();
    }
    if (update.toolResult) {
      var last = _devStatus.steps[0];
      if (last && last.tool === update.toolResult) last.ok = !!update.ok;
    }
    if (update.round) { _devStatus.round = update.round; }
    if (update.input !== undefined) { _devStatus.input = update.input; _devStatus.output = update.output; _devStatus.total = update.total; _devStatus.cacheHit = update.cacheHit || 0; }
    renderDevStatus();
  }
  function renderDevStatus() {
    var box = _el('ai-dev-status'); if (!box) return;
    var titleEl = _el('ai-dev-title'); if (titleEl) titleEl.textContent = '🤖 AI 开发中' + (_devStatus.round ? '（第' + _devStatus.round + '轮）' : '');
    var phaseEl = _el('ai-dev-phase'); if (phaseEl) phaseEl.textContent = _devStatus.phase || '';
    var sumEl = _el('ai-dev-summary'); if (sumEl) sumEl.textContent = _devStatus.summary || '';
    var stepsEl = _el('ai-dev-steps');
    if (stepsEl) {
      if (_devStatus.steps.length) {
        stepsEl.innerHTML = _devStatus.steps.map(function (s) {
          var icon = s.ok ? '<span class="st-ok">✓</span>' : '<span class="st-tool">⚙</span>';
          var file = s.file ? ' <span class="st-file">' + _esc(s.file) + '</span>' : '';
          var brief = s.brief ? ' <span class="st-brief">' + _esc(s.brief) + '</span>' : '';
          return '<div class="ai-dev-step">' + icon + ' ' + _esc(s.tool) + file + brief + '</div>';
        }).join('');
      } else {
        stepsEl.innerHTML = '';
      }
    }
    var tokenEl = _el('ai-dev-token');
    if (tokenEl && _devStatus.total > 0) {
      var hitText = _devStatus.cacheHit > 0 ? '，缓存命中 ' + _devStatus.cacheHit + '（按1/10计费）' : '';
      tokenEl.textContent = '本轮输入 ' + _devStatus.input + ' / 输出 ' + _devStatus.output + ' / 合计 ' + _devStatus.total + ' tokens' + hitText;
    }
  }
  function hideDevStatus() {
    _devStatus = { round: 0, input: 0, output: 0, total: 0, steps: [] };
    var box = _el('ai-dev-status'); if (box) box.style.display = 'none';
  }

  // ── D+会话管理：冒险列表加载（三级：规则书-冒险-频道） ──
  function loadAdventureList() {
    var advSelect = _el('adventure-select'); if (!advSelect) return;
    try { var saved = localStorage.getItem('trpg_current_adventure'); if (saved) _currentAdventure = saved; } catch (e) {}
    var sys = _selectedRuleSystem || '';
    fetch('/api/adventures/list?system=' + encodeURIComponent(sys))
      .then(function(r) { return r.ok ? r.json() : []; })
      .then(function(list) {
        var active = list.filter(function(a) { return !a.archived; });
        var options = [];
        if (!active.length) options.push('默认');
        active.forEach(function(a) { if (options.indexOf(a.name) < 0) options.push(a.name); });
        advSelect.innerHTML = '';
        options.forEach(function(adv) {
          var opt = document.createElement('option');
          opt.value = adv; opt.textContent = adv;
          if (adv === _currentAdventure) opt.selected = true;
          advSelect.appendChild(opt);
        });
        if (options.indexOf(_currentAdventure) < 0) _currentAdventure = options[0] || '默认';
        renderAdventurePanel(list);
      })
      .catch(function() { advSelect.innerHTML = '<option>默认</option>'; });
  }

  // 冒险管理面板渲染（内嵌展开：搜索/归档/删除/标签/统计）
  var _advPanelData = [];
  function renderAdventurePanel(list) {
    _advPanelData = list || [];
    var listEl = _el('adv-list'); if (!listEl) return;
    var kw = '';
    var searchEl = _el('adv-search'); if (searchEl) kw = String(searchEl.value || '').trim();
    var filtered = _advPanelData.filter(function(a) { return !kw || a.name.indexOf(kw) >= 0 || (a.tags || []).join(',').indexOf(kw) >= 0; });
    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.innerHTML = '<div class="adv-empty">（无匹配冒险）</div>';
      return;
    }
    filtered.forEach(function(a) {
      var row = document.createElement('div');
      row.className = 'adv-item' + (a.name === _currentAdventure ? ' active' : '') + (a.archived ? ' archived' : '');
      var tags = (a.tags || []).map(function(t) { return '<span class="adv-tag">' + _esc(t) + '</span>'; }).join('');
      var lastActive = a.lastActiveAt ? new Date(a.lastActiveAt).toLocaleString('zh-CN', { hour12: false }) : '—';
      row.innerHTML =
        '<div class="adv-item-main">' +
          '<span class="adv-name">' + (a.archived ? '🗄 ' : '🗂 ') + _esc(a.name) + '</span>' +
          '<span class="adv-meta">' + (a.channels || 0) + '频道 · ' + (a.messages || 0) + '消息 · 最后 ' + lastActive + '</span>' +
          '<span class="adv-tags">' + tags + '</span>' +
        '</div>' +
        '<div class="adv-item-actions">' +
          (a.archived ? '<button class="btn-small adv-unarchive" title="取消归档">↩ 恢复</button>' : '<button class="btn-small adv-open" title="切换到此冒险">打开</button>') +
          '<button class="btn-small adv-rename" title="重命名">重命名</button>' +
          '<button class="btn-small adv-tagbtn" title="编辑标签">标签</button>' +
          '<button class="btn-small adv-archive" title="归档（保留文件可检索）">' + (a.archived ? '已归档' : '归档') + '</button>' +
          '<button class="btn-small adv-del" title="彻底删除（含文件）">删除</button>' +
        '</div>';
      // 事件
      var openBtn = row.querySelector('.adv-open');
      if (openBtn) openBtn.addEventListener('click', function() {
        _currentAdventure = a.name;
        try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {}
        var sel = _el('adventure-select'); if (sel) sel.value = a.name;
        renderChannelTabs();
        loadAdventureList();
      });
      var unarcBtn = row.querySelector('.adv-unarchive');
      if (unarcBtn) unarcBtn.addEventListener('click', function() {
        apiAdvArchive(a.name, false);
      });
      var renBtn = row.querySelector('.adv-rename');
      if (renBtn) renBtn.addEventListener('click', function() {
        var nn = prompt('新冒险名称：', a.name);
        if (!nn || nn.trim() === a.name) return;
        fetch('/api/adventures/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: _selectedRuleSystem || '', name: a.name, newName: nn.trim() }) })
          .then(function(r) { return r.json(); })
          .then(function(d) { if (d.success) { if (_currentAdventure === a.name) _currentAdventure = d.adventure; loadAdventureList(); } else alert(d.error || '重命名失败'); })
          .catch(function(e) { alert('重命名失败: ' + (e.message || e)); });
      });
      var tagBtn = row.querySelector('.adv-tagbtn');
      if (tagBtn) tagBtn.addEventListener('click', function() {
        var ts = prompt('标签（逗号分隔）：', (a.tags || []).join(','));
        if (ts === null) return;
        var tags = ts.split(/[,，]/).map(function(t) { return t.trim(); }).filter(Boolean);
        fetch('/api/adventures/tag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: _selectedRuleSystem || '', name: a.name, tags: tags }) })
          .then(function(r) { return r.json(); })
          .then(function() { loadAdventureList(); })
          .catch(function(e) { alert('标签更新失败: ' + (e.message || e)); });
      });
      var arcBtn = row.querySelector('.adv-archive');
      if (arcBtn) arcBtn.addEventListener('click', function() {
        if (!a.archived) {
          if (!confirm('归档冒险「' + a.name + '」？归档后保留全部本地文件，可在管理面板恢复。')) return;
        }
        apiAdvArchive(a.name, !a.archived);
      });
      var delBtn = row.querySelector('.adv-del');
      if (delBtn) delBtn.addEventListener('click', function() {
        if (!confirm('彻底删除冒险「' + a.name + '」？\n此操作将删除全部本地文件（含所有频道会话），不可恢复！')) return;
        if (!confirm('再次确认：冒险「' + a.name + '」将被彻底删除，确定？')) return;
        fetch('/api/adventures/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: _selectedRuleSystem || '', name: a.name }) })
          .then(function(r) { return r.json(); })
          .then(function(d) { if (d.success) { if (_currentAdventure === a.name) _currentAdventure = '默认'; loadAdventureList(); } else alert(d.error || '删除失败'); })
          .catch(function(e) { alert('删除失败: ' + (e.message || e)); });
      });
      listEl.appendChild(row);
    });
  }

  function apiAdvArchive(name, archived) {
    fetch('/api/adventures/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: _selectedRuleSystem || '', name: name, archived: archived }) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.success) { loadAdventureList(); } else alert(d.error || '归档失败'); })
      .catch(function(e) { alert('归档失败: ' + (e.message || e)); });
  }

  // 打开/关闭冒险管理面板（📁 按钮页签式高亮，面板悬浮地图底部向上打开）
  function toggleAdventurePanel() {
    var panel = _el('adventure-panel'); if (!panel) return;
    var show = panel.style.display === 'none';
    panel.style.display = show ? 'block' : 'none';
    var btn = _el('btn-adventure-manage');
    if (btn) btn.classList.toggle('active', show);
    if (show) loadAdventureList();
  }

  // 查阅当前频道的历史会话记录（只读展示，删除频道不影响本地历史）
  function viewChannelHistory() {
    var ch = getActiveChannel(); if (!ch) return;
    var sys = _selectedRuleSystem || '';
    var adv = _currentAdventure || '默认';
    // 2026-08-05：改用独立页面（app/history.html）打开历史——window.open 带 URL 不触发弹窗拦截提示，
    // 页面自行 fetch 渲染（不再 document.write，避免 WebView2 渲染时序问题导致全黑）
    var url = 'history.html?system=' + encodeURIComponent(sys) + '&adventure=' + encodeURIComponent(adv) + '&channel=' + encodeURIComponent(ch.id) + '&name=' + encodeURIComponent(ch.name || ch.id);
    window.open(url, '_blank');
  }

  function sendToAI(msg) {
    // 手动中止支持（2026-08-05）：状态框"■ 停止"按钮 abort 当前AI请求
    var devCtrl = new AbortController();
    _activeDevAbort = devCtrl;
    var stopBtn = _el('ai-dev-stop');
    if (stopBtn) {
      stopBtn.style.display = 'inline-block';
      stopBtn.onclick = function() {
        devCtrl.abort();
        stopBtn.style.display = 'none';
        addChatMessage('system', 'AI', '已手动中止AI开发。已生成的部分内容已保留，输入「继续」可从断点续写。');
      };
    }
    // 任务开始立即显示开发状态框（即使AI先思考不调工具也可见）
    var devBox = _el('ai-dev-status');
    if (devBox) {
      devBox.style.display = 'block';
      var devTitle = _el('ai-dev-title');
      if (devTitle) devTitle.textContent = '🤖 AI 开发中';
      var devPhase = _el('ai-dev-phase');
      if (devPhase) devPhase.textContent = '思考中...';
      var devSteps = _el('ai-dev-steps');
      if (devSteps) devSteps.innerHTML = '';
    }
    if (!canUseAIChat()) {
      addChatMessage('system', 'AI', '只有GM/房主可以向AI提问。');
      restoreChatInput(msg);
      return;
    }
    if (!_settings.aiEnabled) {
      addChatMessage('system', 'AI', 'AI模型未启用。请由GM在设置中开启模型调用。');
      restoreChatInput(msg);
      return;
    }
    if (!AIClient.isConnected()) {
      addChatMessage('system', 'AI', '世界尚未苏醒：运行 SoloTrpg 后才能与 AI 对话。');
      restoreChatInput(msg);
      return;
    }
    addChatMessage('user', '你', msg);
    var ch = getActiveChannel();
    var sendChannelId = _activeChannelId || 'story';
    var prompt;
    // 系统频道不注入GM模式提示词（模式提示词面向玩家频道带团，对系统频道无意义，省token）
    if (ch.id === 'system') {
      prompt = '';
    } else {
      prompt = (AI_MODE_PROMPTS[_settings.aiMode] || AI_MODE_PROMPTS.full) + '\n\n当前频道：' + (ch.name || '') + '\n频道提示词：' + (ch.prompt || '');
    }
    // 系统频道使用最小基础提示词，并按任务动态加载 SKILL。
    if (ch.id === 'system') {
      var skillNames = Array.isArray(ch.skills) && ch.skills.length ? ch.skills : ['agent-guide'];
      prompt += (ch.prompt || '') + '\n\n按任务真实内容动态加载 SKILL，而不是把全部规范永久塞进上下文。当前频道建议先加载：' +
        skillNames.map(function(n) { return 'skill {"name":"' + n + '"}'; }).join('、') + '。' +
        '\n涉及规则书解析与规则模块：rulebook-development；角色卡、背包、标签、权限与版本：character-system；界面交互与真实玩家流程：gameplay-ux；插件接口：plugin-authoring；带团规则调用：gm-protocol。' +
        '\n规则系统操作标记：删除 [[rules:delete:规则系统名]]；重新解析 [[rules:reparse:规则系统名]]。';
    }
    var cont = _el('chat-messages');
    var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    var placeholder = null;
    if (cont) {
      placeholder = document.createElement('div');
      placeholder.className = 'chat-message ai';
      placeholder.innerHTML = '<span class="msg-time">' + _esc(time) + '</span>' +
        '<span class="msg-sender">AI:</span><span class="msg-text thinking-text">⏳ 思考中...</span>';
      cont.appendChild(placeholder);
      cont.scrollTop = cont.scrollHeight;
    }
    var updatePlaceholder = function(text, isReasoning) {
      if (!placeholder || !cont) return;
      var textEl = placeholder.querySelector('.msg-text');
      if (!textEl) return;
      if (isReasoning) {
        // 深度思考中：显示实时摘要（对标opencode）
        textEl.className = 'msg-text thinking-text';
        textEl.innerHTML = '💭 ' + _esc(reasoningSummaryText(text));
      } else {
        // 已有正文输出：显示正文预览
        var clean = String(text || '').replace(/\[\[(search|module):.+?\]\]/g, '').trim();
        textEl.className = 'msg-text';
        textEl.innerHTML = clean ? simpleMarkdown(clean) : '⏳ 思考中...';
      }
      cont.scrollTop = cont.scrollHeight;
    };
    var chatReq = (ch.id === 'system')
      ? AIClient.sendSystemChat(msg, {
          customSystemPrompt: prompt,
          system: _selectedRuleSystem || '',
          adventure: _currentAdventure || '默认',
          channel: 'system',
          signal: devCtrl.signal,
          onStream: function(update) {
            if (update.type === 'reasoning') {
              updatePlaceholder(update.text, true);
              updateDevStatus({ phase: '思考', summary: reasoningSummaryText(update.text) });
            } else if (update.type === 'content') {
              updatePlaceholder(update.text, false);
            }
          },
          onTool: function(tool, args) {
            // 工具调用：只更新开发状态框摘要，不刷聊天栏
            updateDevStatus({ tool: tool, args: args, phase: '执行中' });
          },
          onToolResult: function(tool, result) {
            updateDevStatus({ toolResult: tool, ok: String(result || '').indexOf('已写入') >= 0 || String(result || '').indexOf('已编辑') >= 0 });
          },
          onUsage: function(round, usage) {
            var input = usage.prompt_tokens || usage.input_tokens || 0;
            var output = usage.completion_tokens || usage.output_tokens || 0;
            var total = usage.total_tokens || (input + output);
            var hit = usage.prompt_cache_hit_tokens || usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens || 0;
            updateDevStatus({ round: round, input: input, output: output, total: total, cacheHit: hit });
          }
         })
      : AIClient.sendMessage(msg, {
          customSystemPrompt: prompt,
          suppressFinalMessage: true,
          system: _selectedRuleSystem || '',
          adventure: _currentAdventure || '默认',
          channel: sendChannelId,
          signal: devCtrl.signal,
          onStream: function(update) {
            if (update.type === 'reasoning') {
              // 2026-08-05：非系统频道思考不显示内容，只显示"AI思考中"（沉浸感）
              if (sendChannelId === 'system') updatePlaceholder(update.text, true);
              else {
                var textEl = placeholder ? placeholder.querySelector('.msg-text') : null;
                if (textEl) { textEl.className = 'msg-text thinking-text'; textEl.innerHTML = '💭 AI思考中…'; }
              }
            }
            else if (update.type === 'content') updatePlaceholder(update.text, false);
          }
        });
    chatReq.then(function(result) {
      if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      hideDevStatus(); // 任务结束隐藏开发状态框（AI已用正文总结）
      _activeDevAbort = null;
      var stopBtn2 = _el('ai-dev-stop'); if (stopBtn2) stopBtn2.style.display = 'none';
      if (result && result.interrupted) {
        // 流中断：保存续接状态，显示已生成部分，提示输入"继续"
        _pendingResume = { userMessage: msg, partialContent: result.partialContent || '', partialReasoning: result.partialReasoning || '', prompt: prompt, channelId: sendChannelId };
        if (result.partialContent) addChatMessage('ai', 'AI', result.partialContent + '\n\n——（生成中断）', sendChannelId);
        addChatMessage('system', 'AI', '回复生成中断，已保存中断前的内容。输入「继续」可让AI从断点续写。');
        return;
      }
      _pendingResume = null;
      if (result && result.content) {
        if (result.reasoningContent) addAIMessageWithReasoning(result.reasoningContent, result.content, sendChannelId);
        else addChatMessage('ai', 'AI', result.content, sendChannelId);
      }
    }).catch(function(e) {
      if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      hideDevStatus();
      _activeDevAbort = null;
      var stopBtn3 = _el('ai-dev-stop'); if (stopBtn3) stopBtn3.style.display = 'none';
      addChatMessage('system', 'AI', '错误: ' + (e.message || '与世界的联络中断'));
    });
  }

  // 从断点续写：把中断前已生成的部分内容带给AI，让它自然继续
  function resumeAI() {
    if (!_pendingResume) return;
    var pending = _pendingResume;
    _pendingResume = null;
    var ch = getActiveChannel();
    var cont = _el('chat-messages');
    var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    var placeholder = null;
    if (cont) {
      placeholder = document.createElement('div');
      placeholder.className = 'chat-message ai';
      placeholder.innerHTML = '<span class="msg-time">' + _esc(time) + '</span>' +
        '<span class="msg-sender">AI:</span><span class="msg-text thinking-text">💭 继续中...</span>';
      cont.appendChild(placeholder);
      cont.scrollTop = cont.scrollHeight;
    }
    AIClient.sendMessage('请继续完成刚才中断的回复：不要重复已生成的内容，直接从断点继续。', {
      customSystemPrompt: pending.prompt,
      resumeFrom: pending.partialContent,
      resumeReasoning: pending.partialReasoning,
      suppressFinalMessage: true,
      onStream: function(update) {
        if (!placeholder || !cont) return;
        var textEl = placeholder.querySelector('.msg-text');
        if (!textEl) return;
        if (update.type === 'reasoning') {
          textEl.className = 'msg-text thinking-text';
          textEl.innerHTML = '💭 ' + _esc(reasoningSummaryText(update.text));
        } else {
          var clean = String(update.text || '').replace(/\[\[(search|module):.+?\]\]/g, '').trim();
          textEl.className = 'msg-text';
          textEl.innerHTML = clean ? simpleMarkdown(clean) : '继续中...';
        }
        cont.scrollTop = cont.scrollHeight;
      }
    }).then(function(result) {
      if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      if (result && result.interrupted) {
        _pendingResume = Object.assign({}, pending, { partialContent: (pending.partialContent || '') + (result.partialContent || ''), partialReasoning: (pending.partialReasoning || '') + (result.partialReasoning || '') });
        if (result.partialContent) addChatMessage('ai', 'AI', result.partialContent + '\n\n——（续写中断）', pending.channelId);
        addChatMessage('system', 'AI', '续写再次中断，输入「继续」可再次续接。');
        return;
      }
      if (result && result.content) {
        if (result.reasoningContent) addAIMessageWithReasoning(result.reasoningContent, result.content, pending.channelId);
        else addChatMessage('ai', 'AI', result.content, pending.channelId);
      }
    }).catch(function(e) {
      if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      addChatMessage('system', 'AI', '续接失败: ' + (e.message || '与世界的联络中断'));
    });
  }

  function setupRules() {
    var ub = _el('btn-upload-rulebook'); var fi = _el('rulebook-file-input');
    var ruleActionBtn = _el('btn-rule-action');
    if (ruleActionBtn) ruleActionBtn.addEventListener('click', handleRuleActionClick);
    if (ub && fi) {
      ub.addEventListener('click', function() { fi.click(); });
      fi.addEventListener('change', function() {
        var f = this.files[0]; if (!f) return;
        var ce = _el('rules-content-view');
        var startedAt = Date.now();
        if (ce) ce.innerHTML = '<div class="rules-placeholder">正在展开书卷：' + _esc(f.name) + '<br>完成后，AI 会通读全书并整理为可查询的世界规则。</div>';
        addChatMessage('system', '规则书', '正在收录: ' + f.name + '...');
        AIClient.readFile(f, function(progress) {
          var msg = '';
          if (progress.phase === 'upload') {
            msg = '收录中：' + progress.percent + '%<br>书卷：' + _esc(f.name);
          } else {
            msg = '正在翻阅书卷：' + _esc(f.name);
          }
          if (ce) ce.innerHTML = '<div class="rules-placeholder">' + msg + '</div>';
        }).then(function(data) {
          var elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          if (data && !data.error) {
            if (data.mode === 'ai_ingest_required') {
              addChatMessage('system', '规则书', '已保存母本: ' + f.name + ' → ' + data.originalPath + '，用时 ' + elapsed + ' 秒。正在向AI发送规则书接管任务。');
              renderRuleTaskProgress(data.system, data, [{ phase: 'saved', message: '已保存原初母本：' + (data.originalPath || '') }]);
              refreshRulesList().then(function() {
                if (data.system) loadRuleSystemSettings(data.system, data);
              });
              if (data.aiPrompt) {
                AIClient.appendRuleTaskLog(data.system, 'agent_starting', '启动规则书多阶段接管Agent', { promptPath: data.promptPath });
                renderRuleTaskProgress(data.system, data, [
                  { phase: 'saved', message: '已保存原初母本：' + (data.originalPath || '') },
                  { phase: 'agent_starting', message: '启动规则书多阶段接管Agent' }
                ]);
                // 执行期间轮询刷新进度 + SSE实时动态（对标opencode实时显示）
                _ruleLiveEvents = [];
                _ruleAgentAbort = new AbortController();
                startRuleTaskPolling(data.system, data);
                AIClient.runRulebookAgent(data.system, { signal: _ruleAgentAbort.signal, onEvent: appendRuleLiveEvent }).then(function(result) {
                  _ruleAgentAbort = null;
                  if (result && result.aborted) return;
                  if (result && result.error) addChatMessage('system', '规则书Agent', '执行失败: ' + result.error, 'system');
                  else {
                    var renamedText = result.renamed ? '，规则系统名更新为 ' + result.system : '';
                    var note = result.planEmpty ? '（AI未返回有效解析计划）' : (result.emptyResponse ? '（AI返回空响应，见日志ai_empty_response）' : '');
                    addChatMessage('system', '规则书Agent', '多阶段接管完成：HTML层级 ' + (result.htmlCount || 0) + '，可用检索源 ' + (result.sourceCount || 0) + '，图片 ' + (result.imageCount || 0) + renamedText + note, 'system');
                  }
                  var finalSystem = result && result.system ? result.system : data.system;
                  if (finalSystem !== data.system) refreshRulesList();
                  loadRuleTaskProgress(finalSystem, Object.assign({}, data, { system: finalSystem }));
                  stopRuleTaskPolling();
                }).catch(function(e) {
                  addChatMessage('system', '规则书Agent', '执行失败: ' + (e.message || '与世界的联络中断'), 'system');
                  AIClient.appendRuleTaskLog(data.system, 'agent_failed', '规则书Agent执行失败', { error: e.message || '连接失败' });
                  loadRuleTaskProgress(data.system, data);
                });
              }
              return;
            }
            var pages = data.pages || data.chapters || data.sections || 0;
            var imageCount = data.imageCount || 0;
            var extractedFiles = data.extractedFiles || 0;
            addChatMessage('system', '规则书', '已拆解: ' + f.name + ' → ' + (data.total_md || pages) + '个MD文件，图片 ' + imageCount + ' 个，用时 ' + elapsed + ' 秒 → Ruler/' + data.system + '/source/');
            if (ce) ce.innerHTML = '<div class="rules-placeholder">拆解完成，正在加载内容...<br>系统：' + _esc(data.system) + '<br>文件：' + _esc(data.fileName || '') + '<br>解包文件：' + extractedFiles + '<br>图片：' + imageCount + '</div>';
            refreshRulesList().then(function() {
              if (data.system) loadRuleSystemSettings(data.system, data);
            });
          } else {
            var err = data ? data.error : '与世界的联络中断';
            addChatMessage('system', '错误', '拆解失败: ' + err);
            if (ce) ce.innerHTML = '<div class="rules-placeholder">拆解失败：' + _esc(err) + '<br>请查看 Logs/latest.log。</div>';
          }
        });
        this.value = '';
      });
    }
  }

// ── 模组管理（GM页签内：导入文件夹/文件 → 树状浏览 → 预览/删除） ──
function setupModuleManager() {
var folderBtn = _el('btn-module-folder');
var fileBtn = _el('btn-module-file');
var folderInput = _el('module-folder-input');
var fileInput = _el('module-file-input');
// 2026-08-05：模组是 GM/主机功能——非 GM 隐藏入口（联机时普通玩家不可见不可操作）
if (typeof isGMUser === 'function' && !isGMUser()) {
if (folderBtn) folderBtn.style.display = 'none';
if (fileBtn) fileBtn.style.display = 'none';
return;
}
    if (folderBtn && folderInput) {
      folderBtn.addEventListener('click', function() { folderInput.click(); });
      folderInput.addEventListener('change', function() {
        if (this.files && this.files.length) uploadModuleFiles(this.files, true);
        this.value = '';
      });
    }
    if (fileBtn && fileInput) {
      fileBtn.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function() {
        if (this.files && this.files.length) uploadModuleFiles(this.files, false);
        this.value = '';
      });
    }
  }

  function _moduleSystem() {
    var sys = _selectedRuleSystem || '';
    return sys;
  }

  // 上传模组：isFolder=true 时用 webkitRelativePath 保留完整目录结构
  function uploadModuleFiles(fileList, isFolder) {
    // 2026-08-05：模组导入仅 GM/主机可操作
    if (typeof isGMUser === 'function' && !isGMUser()) {
      addChatMessage('system', '模组', '模组管理是 GM/主机功能，普通玩家不可操作。');
      return;
    }
    var sys = _moduleSystem();
    if (!sys) {
      addChatMessage('system', '模组', '请先在「📚 规则书」列表中选择规则系统，再导入模组。');
      return;
    }
    var arr = Array.prototype.slice.call(fileList);
    var fd = new FormData();
    fd.append('system', sys);
    arr.forEach(function(f) {
      fd.append('files', f);
      var rel = isFolder && f.webkitRelativePath ? f.webkitRelativePath : f.name;
      fd.append('relPath', rel);
    });
    var ce = _el('module-tree');
    if (ce) ce.innerHTML = '<div class="rules-empty">正在导入模组：' + arr.length + ' 个文件…</div>';
    fetch('/api/module/upload', { method: 'POST', body: fd }).then(function(r) { return r.json(); }).then(function(data) {
      if (data && data.success) {
        addChatMessage('system', '模组', '已导入 ' + data.total + ' 个文件 → ' + sys + ' 的模组目录');
      } else {
        addChatMessage('system', '错误', '模组导入失败: ' + ((data && data.error) || '未知错误'));
      }
      refreshModuleList();
    }).catch(function(e) {
      addChatMessage('system', '错误', '模组导入失败: ' + (e.message || '与世界的联络中断'));
      refreshModuleList();
    });
  }

  function refreshModuleList() {
    var treeEl = _el('module-tree'); if (!treeEl) return;
    var sys = _moduleSystem();
    if (!sys) {
      treeEl.innerHTML = '<div class="rules-empty">尚未选择规则系统。<br>模组将导入到所选规则系统目录下，<br>请先在「📚 规则书」页选择系统。</div>';
      return;
    }
    fetch('/api/module/list?system=' + encodeURIComponent(sys)).then(function(r) { return r.ok ? r.json() : { tree: [] }; }).then(function(data) {
      var tree = (data && data.tree) || [];
      if (!tree.length) {
        treeEl.innerHTML = '<div class="rules-empty">尚未导入模组。<br>点击上方「📂 导入文件夹」选择模组目录，<br>或「📄 导入文件」选择模组文档。</div>';
        return;
      }
      treeEl.innerHTML = renderModuleTree(tree, '');
      bindModuleTreeEvents(treeEl);
    }).catch(function(e) {
      treeEl.innerHTML = '<div class="rules-empty">模组列表加载失败：' + _esc(e.message || '') + '</div>';
    });
  }

  function renderModuleTree(items, prefix) {
    var html = '';
    items.forEach(function(item) {
      var rel = prefix + item.name;
      if (item.type === 'dir') {
        html += '<div class="module-node module-dir" data-path="' + _esc(rel) + '">' +
          '<span class="module-caret">▼</span><span class="module-icon">📁</span>' +
          '<span class="module-name">' + _esc(item.name) + '</span>' +
          '<span class="module-del" title="删除整个文件夹">🗑</span></div>';
        if (item.children && item.children.length) {
          html += '<div class="module-children" data-parent="' + _esc(rel) + '">' + renderModuleTree(item.children, rel + '/') + '</div>';
        }
      } else {
        var sizeTxt = item.size > 1024 ? (item.size / 1024).toFixed(1) + ' KB' : item.size + ' B';
        html += '<div class="module-node module-file" data-path="' + _esc(rel) + '">' +
          '<span class="module-icon">📄</span>' +
          '<span class="module-name">' + _esc(item.name) + '</span>' +
          '<span class="module-size">' + sizeTxt + '</span>' +
          '<span class="module-del" title="删除文件">🗑</span></div>';
      }
    });
    return html;
  }

  function bindModuleTreeEvents(container) {
    container.querySelectorAll('.module-dir').forEach(function(dir) {
      dir.addEventListener('click', function(e) {
        if (e.target.classList.contains('module-del')) {
          deleteModuleItem(this.getAttribute('data-path'));
          e.stopPropagation();
          return;
        }
        var rel = this.getAttribute('data-path');
        var kids = null;
        container.querySelectorAll('.module-children').forEach(function(k) {
          if (k.getAttribute('data-parent') === rel) kids = k;
        });
        var caret = this.querySelector('.module-caret');
        if (kids) {
          var hidden = kids.style.display === 'none';
          kids.style.display = hidden ? '' : 'none';
          if (caret) caret.textContent = hidden ? '▼' : '▶';
        }
      });
    });
    container.querySelectorAll('.module-file').forEach(function(file) {
      file.addEventListener('click', function(e) {
        if (e.target.classList.contains('module-del')) {
          deleteModuleItem(this.getAttribute('data-path'));
          e.stopPropagation();
          return;
        }
        previewModuleFile(this.getAttribute('data-path'));
      });
    });
  }

  function deleteModuleItem(rel) {
    var sys = _moduleSystem();
    if (!sys || !rel) return;
    if (!confirm('确定删除模组项「' + rel + '」？此操作不可恢复。')) return;
    fetch('/api/module/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: sys, path: rel }) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.success) { addChatMessage('system', '模组', '已删除: ' + rel); refreshModuleList(); }
        else addChatMessage('system', '错误', '删除失败: ' + ((data && data.error) || '未知错误'));
      }).catch(function(e) { addChatMessage('system', '错误', '删除失败: ' + (e.message || '')); });
  }

  function previewModuleFile(rel) {
    var sys = _moduleSystem();
    var ce = _el('module-preview'); if (!ce || !sys) return;
    ce.innerHTML = '<div class="rules-placeholder">加载中：' + _esc(rel) + '</div>';
    fetch('/api/module/read?system=' + encodeURIComponent(sys) + '&path=' + encodeURIComponent(rel)).then(function(r) { return r.json(); }).then(function(data) {
      if (data && data.error) { ce.innerHTML = '<div class="rules-placeholder">加载失败：' + _esc(data.error) + '</div>'; return; }
      if (data.binary) {
        ce.innerHTML = '<div class="rules-placeholder">📦 二进制文件：' + _esc(data.name) + '<br>大小：' + (data.size > 1024 ? (data.size / 1024).toFixed(1) + ' KB' : data.size + ' B') + '<br>请在系统资源管理器中查看。</div>';
        return;
      }
      var html = '<div class="module-preview-head">' + _esc(rel) + (data.truncated ? '<span style="color:#ffa;margin-left:6px;">（已截断，仅前 20000 字符）</span>' : '') + '</div>';
      var content = data.content || '';
      if (/\.(md|markdown|txt|htm|html)$/i.test(rel)) html += simpleMarkdown(content);
      else html += '<pre class="module-preview-pre">' + _esc(content) + '</pre>';
      ce.innerHTML = html;
    }).catch(function(e) { ce.innerHTML = '<div class="rules-placeholder">加载失败：' + _esc(e.message || '') + '</div>'; });
  }

  // 2026-08-05 翻新：规则速查不再有"选择规则书"列表（选择在开始界面完成）；
  // 本函数保留兼容接口——确保规则速查区渲染当前规则书内容（无内容时才重新加载）
  function refreshRulesList() {
    var ce = _el('rules-content-view');
    if (ce && _selectedRuleSystem && (!ce.innerHTML || ce.innerHTML.indexOf('rules-placeholder') >= 0)) {
      loadRuleSystemSettings(_selectedRuleSystem);
    }
    return Promise.resolve();
  }

  // ── 开始界面（全局入口：规则书→冒险，2026-08-05） ──
  var _startRuleStep = false; // true=冒险选择步骤
  var _pendingStartRule = null; // 开始界面中待选的规则书

  // 记忆"继续上次"（localStorage）
  function _saveLastEntry() {
    try { localStorage.setItem('trpg_last_entry', JSON.stringify({ system: _selectedRuleSystem || '', adventure: _currentAdventure || '默认', time: Date.now() })); } catch (e) {}
  }
  function _loadLastEntry() {
    try { var v = JSON.parse(localStorage.getItem('trpg_last_entry')); return v && v.system ? v : null; } catch (e) { return null; }
  }

  // 渲染开始界面（规则书选择 → 冒险选择）
  // 渲染开始界面 v2（2026-08-05）：两步清晰流程 + 上传/新建入口
  function renderStartScreen() {
    var screen = _el('start-screen'); if (!screen) return;
    var stepRules = _el('start-step-rules');
    var stepAdv = _el('start-step-adventure');
    var ruleList = _el('start-rule-list');
    var advList = _el('start-adv-list');
    var advTitle = _el('start-adv-title-text');
    var cont = _el('start-continue');
    var backBtn = _el('btn-start-back');
    var hint = _el('start-hint');
    if (!_startRuleStep) {
      // ── 步骤1：规则书选择 ──
      stepAdv.style.display = 'none';
      if (stepRules) stepRules.style.display = 'block';
      backBtn.style.display = 'none';
      if (hint) hint.textContent = '选择规则书开始；首次使用请先「上传规则书」';
      // 继续上次
      var last = _loadLastEntry();
      if (last && cont) {
        var t = new Date(last.time || Date.now());
        cont.innerHTML = '<button class="start-continue-btn" id="btn-continue-last">▶ 继续上次：' + _esc(last.system) + ' · ' + _esc(last.adventure) + '（' + t.toLocaleString('zh-CN', { hour12: false }) + '）</button>';
        cont.style.display = 'block';
        var cb = _el('btn-continue-last');
        if (cb) cb.addEventListener('click', function() {
          _selectedRuleSystem = last.system;
          _currentAdventure = last.adventure || '默认';
          try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {}
          _saveLastEntry();
          enterMainInterface();
        });
      } else if (cont) { cont.style.display = 'none'; }
      // 规则书卡片（含操作按钮：进入 / 管理）
      // 连接重试（2026-08-05）：启动时 AIClient 可能尚未完成连接检测（isConnected=false 返回空列表），
      // 显示"连接中"并延迟重试，避免误报"无规则书"
      function loadStartRules() {
        AIClient.getRuleSystems().then(function(sys) {
          if (!sys || !sys.length) {
            if (AIClient.isConnected && !AIClient.isConnected()) {
              ruleList.innerHTML = '<div class="start-empty"><p>⏳ 正在读取规则书...</p></div>';
              setTimeout(loadStartRules, 800);
              return;
            }
            ruleList.innerHTML = '<div class="start-empty">' +
              '<p>尚未收录任何世界规则书。</p>' +
              '<p class="start-empty-sub">点击右上角「📤 上传规则书」开始：上传 PDF/CHM/TXT/MD 后，AI 会通读全书并整理为可查询的世界规则。</p>' +
              '</div>';
            return;
          }
        ruleList.innerHTML = '';
        sys.forEach(function(s) {
          var sn = s.name || s.system;
          // 玩家视角信息：显示来源母本（原初文件），不显示"AI检索源数"等技术指标
          var origin = s.settings && s.settings.originalFiles && s.settings.originalFiles.length
            ? s.settings.originalFiles.join('、')
            : '';
          var card = document.createElement('div');
          card.className = 'start-rule-card';
          card.innerHTML =
            '<div class="sr-main">' +
              '<div class="sr-name">' + _esc(sn) + '</div>' +
              (origin ? '<div class="sr-meta">' + _esc(origin) + '</div>' : '') +
            '</div>' +
            '<div class="sr-actions">' +
              '<button class="btn-small sr-enter" data-sn="' + _esc(sn) + '">进入 ▸</button>' +
            '</div>';
          card.querySelector('.sr-enter').addEventListener('click', function() {
            _pendingStartRule = sn;
            _startRuleStep = true;
            renderStartScreen();
          });
          ruleList.appendChild(card);
        });
        }).catch(function() { ruleList.innerHTML = '<div class="start-empty"><p>加载规则书列表失败。</p></div>'; });
      }
      loadStartRules();
    } else {
      // ── 步骤2：冒险选择 ──
      if (stepRules) stepRules.style.display = 'none';
      stepAdv.style.display = 'block';
      cont.style.display = 'none';
      backBtn.style.display = 'inline-block';
      if (hint) hint.textContent = '选择冒险进入；也可「＋ 新建冒险」或返回规则书';
      if (advTitle) advTitle.textContent = '📚 ' + _esc(_pendingStartRule || '') + ' — 选择冒险';
      var sys = _pendingStartRule || '';
      fetch('/api/adventures/list?system=' + encodeURIComponent(sys)).then(function(r) { return r.ok ? r.json() : []; }).then(function(list) {
        var active = list.filter(function(a) { return !a.archived; });
        advList.innerHTML = '';
        if (!active.length) {
          advList.innerHTML = '<div class="start-empty"><p>该规则书暂无冒险。</p><p class="start-empty-sub">点击「＋ 新建冒险」创建第一个冒险（或使用默认冒险）。</p></div>';
          var dcard = document.createElement('div');
          dcard.className = 'start-adv-card';
          dcard.innerHTML = '<span class="sa-name">🗂 默认</span><span class="sa-meta">默认冒险</span><button class="btn-small">进入 ▸</button>';
          dcard.addEventListener('click', function() { pickAdventure('默认'); });
          advList.appendChild(dcard);
          return;
        }
        active.forEach(function(a) {
          var card = document.createElement('div');
          card.className = 'start-adv-card';
          card.innerHTML = '<span class="sa-name">🗂 ' + _esc(a.name) + '</span>' +
            '<span class="sa-meta">' + (a.channels || 0) + '频道 · ' + (a.messages || 0) + '消息</span>' +
            '<button class="btn-small">进入 ▸</button>';
          card.addEventListener('click', function() { pickAdventure(a.name); });
          advList.appendChild(card);
        });
      }).catch(function() { advList.innerHTML = '<div class="start-empty"><p>冒险列表加载失败。</p></div>'; });
    }
    screen.style.display = 'flex';
  }
  function pickAdventure(adv) {
    if (!_pendingStartRule) return;
    _selectedRuleSystem = _pendingStartRule;
    _currentAdventure = adv;
    try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {}
    _saveLastEntry();
    enterMainInterface();
  }

  // 进入内部界面（隐藏开始界面，加载规则书配置）
function enterMainInterface() {
var screen = _el('start-screen'); if (screen) screen.style.display = 'none';
_startRuleStep = false;
if (_selectedRuleSystem) {
loadRuleSystemSettings(_selectedRuleSystem);
updateRuleActionButton();
if (typeof loadAdventureList === 'function') loadAdventureList();
refreshRulesList();
renderChannelTabs();
// 2026-08-05：进入主界面后从服务端加载当前频道历史（聊天区与历史窗口同源）
setTimeout(function() { loadChannelHistoryFromServer(_activeChannelId, true); }, 300);
}
}

  // 全局侧边栏（抽屉式：左侧滑出 + 右侧遮罩）
  function openGlobalSidebar() {
    var sb = _el('global-sidebar'); if (!sb) return;
    var mask = _el('sidebar-mask');
    renderGlobalSidebar();
    sb.style.display = 'flex';
    if (mask) { mask.style.display = 'block'; }
    // 触发滑入动画
    requestAnimationFrame(function() { sb.classList.add('open'); if (mask) mask.classList.add('open'); });
  }
  function closeGlobalSidebar() {
    var sb = _el('global-sidebar'); if (!sb) return;
    var mask = _el('sidebar-mask');
    sb.classList.remove('open');
    if (mask) mask.classList.remove('open');
    setTimeout(function() {
      sb.style.display = 'none';
      if (mask) mask.style.display = 'none';
    }, 220); // 等待滑出动画完成
  }
  function renderGlobalSidebar() {
    var ruleEl = _el('gs-rule-list'); var advEl = _el('gs-adventure-list');
    var roomEl = _el('gs-room-info');
    if (roomEl) roomEl.textContent = document.getElementById('room-display') ? document.getElementById('room-display').textContent : '未加入房间';
    AIClient.getRuleSystems().then(function(sys) {
      if (ruleEl) {
        ruleEl.innerHTML = '';
        (sys || []).forEach(function(s) {
          var sn = s.name || s.system;
          var item = document.createElement('div');
          item.className = 'gs-item' + (sn === _selectedRuleSystem ? ' active' : '');
          item.innerHTML = '<span>📚 ' + _esc(sn) + '</span>';
          item.addEventListener('click', function() {
            _selectedRuleSystem = sn;
            loadRuleSystemSettings(sn);
            updateRuleActionButton();
            if (typeof loadAdventureList === 'function') loadAdventureList();
            renderGlobalSidebar();
          });
          ruleEl.appendChild(item);
        });
      }
    });
    if (advEl && _selectedRuleSystem) {
      fetch('/api/adventures/list?system=' + encodeURIComponent(_selectedRuleSystem)).then(function(r) { return r.ok ? r.json() : []; }).then(function(list) {
        advEl.innerHTML = '';
        list.filter(function(a) { return !a.archived; }).forEach(function(a) {
          var item = document.createElement('div');
          item.className = 'gs-item' + (a.name === _currentAdventure ? ' active' : '');
          item.innerHTML = '<span>🗂 ' + _esc(a.name) + '</span>';
          item.addEventListener('click', function() {
            _currentAdventure = a.name;
            try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {}
            _saveLastEntry();
            renderGlobalSidebar();
            renderChannelTabs();
          });
          advEl.appendChild(item);
        });
      });
    } else if (advEl) advEl.innerHTML = '<div class="start-hint">（先选择规则书）</div>';
  }

  // 框架级操作按钮：对当前选中的规则书执行（解析中显示"停止解析"，否则"删除"）
  var _selectedRuleSystem = null;
  var _ruleAgentAbort = null; // 当前Agent会话的AbortController（停止解析用）
  function updateRuleActionButton() {
    var btn = _el('btn-rule-action'); if (!btn) return;
    if (!_selectedRuleSystem) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    var parsing = _rulePollTimer !== null;
    if (parsing) {
      btn.textContent = '■ 停止解析';
      btn.title = '停止正在进行的规则书解析（对当前选中的 ' + _selectedRuleSystem + '）';
      btn.style.color = '#ff7b7b';
    } else {
      btn.textContent = '✕ 删除规则书';
      btn.title = '删除当前选中的规则书（' + _selectedRuleSystem + '，含母本与全部拆解产物）';
      btn.style.color = '';
    }
  }

  function handleRuleActionClick() {
    if (!_selectedRuleSystem) return;
    if (_rulePollTimer) {
      // 正在解析：停止
      if (!confirm('停止解析「' + _selectedRuleSystem + '」？已完成的阶段会保留，可稍后继续解析。')) return;
      stopRuleAgent();
      return;
    }
    // 删除
    if (!confirm('删除规则书「' + _selectedRuleSystem + '」？\n母本、拆解文本、图片资产、日志将全部删除，且不可恢复。')) return;
    fetch(AIClient.getServerUrl() + '/api/rules/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: _selectedRuleSystem })
    }).then(function(resp) { return resp.json(); }).then(function(data) {
      if (data && data.success) {
        addChatMessage('system', '规则书', '已删除规则书: ' + _selectedRuleSystem);
        _selectedRuleSystem = null;
        var ce = _el('rules-content-view');
        if (ce) ce.innerHTML = '<div class="rules-placeholder">规则书已删除。</div>';
        updateRuleActionButton();
        refreshRulesList();
      } else {
        addChatMessage('system', '规则书', '删除失败: ' + ((data && data.error) || '未知错误'));
      }
    }).catch(function(e) {
      addChatMessage('system', '规则书', '删除失败: ' + (e.message || '与世界的联络中断'));
    });
  }

  // 停止解析：abort前端Agent会话fetch → 后端检测到断开后中止循环并写日志
  function stopRuleAgent() {
    if (_ruleAgentAbort) {
      _ruleAgentAbort.abort();
      _ruleAgentAbort = null;
    }
    stopRuleTaskPolling();
    addChatMessage('system', '规则书', '已请求停止解析: ' + (_selectedRuleSystem || ''));
    updateRuleActionButton();
    if (_selectedRuleSystem) loadRuleTaskProgress(_selectedRuleSystem, {});
  }

  function renderRuleSettings(system, settings, uploadSummary) {
    settings = settings || {};
    var actions = settings.actions || [];
    var html = '';
    if (uploadSummary) {
      if (uploadSummary.mode === 'ai_ingest_required') {
        html += '<div class="rules-placeholder" style="text-align:left;">母本已保存：' + _esc(uploadSummary.originalPath || '') + '<br>AI接管任务：' + _esc(uploadSummary.promptPath || '') + '</div>';
      } else {
        html += '<div class="rules-placeholder" style="text-align:left;">拆解摘要：MD ' + _esc(uploadSummary.total_md || 0) + ' 个；图片 ' + _esc(uploadSummary.imageCount || 0) + ' 个；解包文件 ' + _esc(uploadSummary.extractedFiles || 0) + ' 个；路径 Ruler/' + _esc(system) + '/</div>';
      }
    }
    html += '<div class="rules-placeholder" style="text-align:left;">';
    html += '<h4 style="margin:0 0 8px 0;">' + _esc(system) + '：AI解析出的规则设置</h4>';
    html += '<div>上传规则书后启动解析流程，系统会根据解析结果生成配置选项、检索索引和资产清单。</div>';
    html += '<div style="margin-top:8px;">AI检索源：' + _esc(settings.fileCount || 0) + ' 个</div>';
    if (settings.topLevelSources && settings.topLevelSources.length) {
      html += '<div style="margin-top:8px;">资料分组：' + settings.topLevelSources.map(_esc).join('、') + '</div>';
    }
    html += '</div>';
    if (actions.length) {
      html += '<div class="rules-placeholder" style="text-align:left;">';
      actions.forEach(function(action) {
        html += '<div style="border:1px solid #3a3a5c;border-radius:6px;padding:8px;margin-bottom:8px;">';
        html += '<div style="font-weight:bold;color:#4ecdc4;">' + _esc(action.title || action.type || '规则设置') + '</div>';
        html += '<div style="margin-top:4px;">' + _esc(action.detail || '') + '</div>';
        if (action.examples && action.examples.length) html += '<div style="margin-top:4px;color:#aaa;">示例来源：' + action.examples.map(_esc).join('；') + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderRuleTaskProgress(system, uploadSummary, logs) {
    var ce = _el('rules-content-view'); if (!ce) return;
    _ruleTaskViewSystem = system;
    logs = logs || [];
    var lastPhase = logs.length ? (logs[logs.length - 1].phase || '') : '';
    var done = lastPhase === 'agent_done';
    var html = '<div class="rules-placeholder" style="text-align:left;">';
    html += '<h4 style="margin:0 0 8px 0;">' + _esc(system) + '：规则书接管进度</h4>';
    if (uploadSummary) {
      html += '<div>母本：' + _esc(uploadSummary.originalPath || '') + '</div>';
      html += '<div>任务提示：' + _esc(uploadSummary.promptPath || '') + '</div>';
    }
    html += '<div>日志：Ruler/' + _esc(system) + '/tasks/ingest.log</div>';
    html += '<div style="margin-top:8px;">当前状态：' + _esc(logs.length ? (logs[logs.length - 1].message || logs[logs.length - 1].phase) : '等待任务记录') + '</div>';
    // 中断后可续接：Agent失败/中止或停留在中间阶段时，提供"继续解析"按钮
    if (logs.length && !done) {
      html += '<div style="margin-top:10px;"><button id="btn-resume-rule-agent" class="btn-small accent">▶ 继续解析（续接中断任务）</button></div>';
    }
    html += '</div>';
    // 实时动态区（AI思考摘要、工具调用、工具结果）
    html += '<div class="rules-placeholder" style="text-align:left;">';
    html += '<div style="font-weight:bold;color:var(--accent-light);margin-bottom:6px;">实时动态</div>';
    html += '<div id="rule-live-events"></div>';
    html += '</div>';
    html += '<div class="rules-placeholder" style="text-align:left;">';
    html += '<div style="font-weight:bold;color:#4ecdc4;margin-bottom:6px;">本地日志</div>';
    if (logs.length) {
      logs.forEach(function(item) {
        html += '<div style="border-bottom:1px solid #333;padding:4px 0;">';
        html += '<span style="color:#aaa;">' + _esc(item.time || '') + '</span> ';
        html += '<span style="color:#4ecdc4;">[' + _esc(item.phase || 'event') + ']</span> ';
        html += _esc(item.message || '');
        html += '</div>';
      });
    } else {
      html += '<div>暂无日志。</div>';
    }
    html += '</div>';
    ce.innerHTML = html;
    renderRuleLiveEvents();
    var resumeBtn = _el('btn-resume-rule-agent');
    if (resumeBtn) resumeBtn.addEventListener('click', function() { resumeRuleAgent(system, uploadSummary); });
  }

  // Agent实时动态事件（SSE推送）：phase/tool/tool_result/reasoning/ai_text/error
  let _ruleLiveEvents = [];
  function appendRuleLiveEvent(evt) {
    if (!evt) return;
    var line = '';
    if (evt.type === 'phase') line = '【' + _esc(evt.message) + '】';
    else if (evt.type === 'round') line = '第 ' + evt.round + ' 轮';
    else if (evt.type === 'reasoning') line = '💭 ' + _esc(evt.text);
    else if (evt.type === 'tool') line = '🔧 工具调用: <b>' + _esc(evt.tool) + '</b> ' + _esc(JSON.stringify(evt.args || {}).substring(0, 150));
    else if (evt.type === 'tool_result') line = '↳ ' + _esc(String(evt.result || '').replace(/\n/g, ' ').substring(0, 200));
    else if (evt.type === 'tokens') {
      line = evt.summary
        ? '⚡ 本次解析token总计：输入 ' + evt.input + ' / 输出 ' + evt.output + ' / 思考 ' + evt.reasoning + ' / 合计 ' + evt.total
        : '⚡ 第' + evt.round + '轮 token：输入 ' + evt.input + ' / 输出 ' + evt.output + ' / 思考 ' + evt.reasoning + ' / 合计 ' + evt.total;
    }
    else if (evt.type === 'ai_text') line = '💬 ' + _esc(String(evt.text || '').substring(0, 200));
    else if (evt.type === 'error') line = '⚠ ' + _esc(evt.error || '');
    else if (evt.type === 'question') {
      // AI提问：弹窗等待用户回答，提交后恢复Agent
      var answer = prompt('🤖 AI提问：' + (evt.text || ''));
      fetch(AIClient.getServerUrl() + '/api/agent-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: evt.id, answer: answer === null ? '（用户取消回答）' : answer })
      }).catch(function() { /* 连接失败忽略 */ });
      line = '❓ AI提问：' + _esc(evt.text || '') + ' → 已等待回答';
    }
    if (!line) return;
    _ruleLiveEvents.push({ line: line, isError: evt.type === 'error' });
    if (_ruleLiveEvents.length > 60) _ruleLiveEvents.shift();
    renderRuleLiveEvents();
    // 关键事件同步到系统频道（通知 + 对话栏，对标opencode）
    if (evt.type === 'phase' || evt.type === 'error') {
      addChatMessage('system', '规则书Agent', evt.type === 'phase' ? evt.message : ('解析错误: ' + evt.error));
    }
  }

  function renderRuleLiveEvents() {
    var box = _el('rule-live-events'); if (!box) return;
    var html = '';
    for (var i = 0; i < _ruleLiveEvents.length; i++) {
      var item = _ruleLiveEvents[i];
      html += '<div style="padding:3px 0;border-bottom:1px solid #2a2a4a;' + (item.isError ? 'color:#ff7b7b;' : '') + '">' + item.line + '</div>';
    }
    box.innerHTML = html || '<div style="color:#6a6a8a;">等待Agent动态...</div>';
    var ce = _el('rules-content-view');
    if (ce) ce.scrollTop = ce.scrollHeight;
  }

  // 续接规则书解析任务：复用Agent流程（本地工具步骤幂等，AI分析重新执行），不重新上传
  function resumeRuleAgent(system, uploadSummary) {
    var ce = _el('rules-content-view');
    _ruleTaskViewSystem = system; // 立即标记进度视图所属系统，轮询/SSE事件才能更新右侧
    _selectedRuleSystem = system;
    updateRuleActionButton();
    if (ce) ce.innerHTML = '<div class="rules-placeholder">正在续接规则书解析任务...</div>';
    addChatMessage('system', '规则书Agent', '用户触发续接，开始继续解析: ' + system);
    // 先渲染进度视图（含实时动态容器），再启动轮询与SSE
    _ruleLiveEvents = [];
    loadRuleTaskProgress(system, uploadSummary || {});
    _ruleAgentAbort = new AbortController();
    startRuleTaskPolling(system, uploadSummary || {});
    AIClient.runRulebookAgent(system, { resume: true, signal: _ruleAgentAbort.signal, onEvent: appendRuleLiveEvent }).then(function(result) {
      _ruleAgentAbort = null;
      if (result && result.aborted) return;
      if (result && result.error) {
        addChatMessage('system', '规则书Agent', '续接执行失败: ' + result.error);
        loadRuleTaskProgress(system, uploadSummary);
        stopRuleTaskPolling();
        return;
      }
      var renamedText = result.renamed ? '，规则系统名更新为 ' + result.system : '';
      var note = result.planEmpty ? '（AI未返回有效解析计划）' : (result.emptyResponse ? '（AI返回空响应，见日志ai_empty_response）' : '');
      addChatMessage('system', '规则书Agent', '续接完成：HTML层级 ' + (result.htmlCount || 0) + '，可用检索源 ' + (result.sourceCount || 0) + '，图片 ' + (result.imageCount || 0) + renamedText + note);
      var finalSystem = result.system || system;
      if (finalSystem !== system) refreshRulesList();
      loadRuleTaskProgress(finalSystem, uploadSummary || {});
      stopRuleTaskPolling();
    }).catch(function(e) {
      addChatMessage('system', '规则书Agent', '续接执行失败: ' + (e.message || '连接失败'));
      loadRuleTaskProgress(system, uploadSummary);
      stopRuleTaskPolling();
    });
  }

  function loadRuleTaskProgress(system, uploadSummary) {
    AIClient.getRuleTaskStatus(system).then(function(status) {
      if (status && !status.error) renderRuleTaskProgress(system, uploadSummary || status.manifest || {}, status.logs || []);
    });
  }

  // 进度轮询：任务执行期间每2.5秒刷新右侧进度（对标opencode的实时动态）
  function startRuleTaskPolling(system, uploadSummary) {
    stopRuleTaskPolling();
    var poll = function() {
      AIClient.getRuleTaskStatus(system).then(function(status) {
        if (!status || status.error) return;
        // 仅当右侧仍显示该系统的进度视图时才刷新，避免覆盖用户已切换的视图
        if (_ruleTaskViewSystem === system && _el('rules-content-view')) {
          renderRuleTaskProgress(system, uploadSummary || status.manifest || {}, status.logs || []);
        }
        var lastPhase = status.logs && status.logs.length ? status.logs[status.logs.length - 1].phase : '';
        var finished = ['agent_done', 'agent_failed', 'agent_aborted', 'ai_empty_response', 'ai_plan_empty'].indexOf(lastPhase) !== -1;
        if (finished) stopRuleTaskPolling();
      });
    };
    _rulePollTimer = setInterval(poll, 2500);
    poll();
  }

  function stopRuleTaskPolling() {
    if (_rulePollTimer) { clearInterval(_rulePollTimer); _rulePollTimer = null; }
    updateRuleActionButton();
  }

function loadRuleSystemSettings(system, uploadSummary) {
var ce = _el('rules-content-view'); if (!ce) return;
_ruleTaskViewSystem = null;
_selectedRuleSystem = system;
// 2026-08-05 引擎化：应用该规则书的界面框架（无 ui/manifest.json 则用默认框架）
applyUiManifest(system);
// GM 面板 iframe（引擎化：加载规则书 ui/panels/gm.html，带 system 参数）
var gmFrame = _el('gm-panel-frame');
if (gmFrame) gmFrame.src = '/api/ui-panel?system=' + encodeURIComponent(system) + '&panel=gm';
updateRuleActionButton();
refreshModuleList();
    ce.innerHTML = '<div class="rules-placeholder">正在解析规则设置...</div>';
    AIClient.getRuleSystems().then(function(sys) {
      var item = (sys || []).find(function(s) { return (s.name || s.system) === system; });
      if (!item) {
        ce.innerHTML = '<div class="rules-placeholder">无法加载规则系统：' + _esc(system) + '</div>';
        return;
      }
      var settingsHtml = renderRuleSettings(system, item.settings || {}, uploadSummary);
      // 叠加解析任务状态：未完成时显示中断原因与"继续解析"入口（无需重新上传）
      AIClient.getRuleTaskStatus(system).then(function(status) {
        if (status && !status.error && status.logs && status.logs.length) {
          var logs = status.logs;
          var last = logs[logs.length - 1];
          // 曾完成过解析即视为已完成（最后一条可能是后续中断测试留下的非完成阶段）
          if (!logs.some(function(l) { return l.phase === 'agent_done'; })) {
            var statusHtml = '<div class="rules-placeholder" style="text-align:left;">' +
              '<h4 style="margin:0 0 8px 0;">' + _esc(system) + '：解析任务状态</h4>' +
              '<div>上次进度：' + _esc(last.message || last.phase || '未知阶段') + '</div>' +
              '<div style="margin-top:6px;color:#aaa;">解析因中断未完成，点击下方按钮让AI从上次断点继续解析，无需重新上传文件。</div>' +
              '<div style="margin-top:10px;"><button id="btn-resume-rule-agent" class="btn-small accent">▶ 继续解析（续接中断任务）</button></div>' +
              '</div>';
            ce.innerHTML = statusHtml + settingsHtml;
            var btn = _el('btn-resume-rule-agent');
            if (btn) btn.addEventListener('click', function() { resumeRuleAgent(system, uploadSummary); });
            return;
          }
        }
        ce.innerHTML = settingsHtml;
        // 大型功能独立窗口标准：存在规则树时提供"规则树导航"独立窗口入口
        fetch('/Ruler/' + encodeURIComponent(system) + '/compressed/rule_tree.json')
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(tree) {
            if (tree && tree.tree && tree.tree.length && ce) {
              var btn = document.createElement('button');
              btn.className = 'btn-small accent';
              btn.style.cssText = 'display:block;width:100%;margin:0 0 8px;';
              btn.textContent = '📚 规则树导航（独立窗口）';
              btn.onclick = function() { window.open('/rule-tree.html?system=' + encodeURIComponent(system), '_blank'); };
              ce.insertBefore(btn, ce.firstChild);
            }
          })
          .catch(function() {});
      });
      // 加载该系统的动态插件（AI编写的追加功能，热加载）
      if (window.PluginRuntime) {
        PluginRuntime.unloadSystemPlugins();
        PluginRuntime.loadSystemPlugins(system).then(function() {
          // 动态链接：角色界面使用该规则的角色卡插件（type=character-sheet）
          var sheet = PluginRuntime.getCharacterSheet();
          _activeSheet = sheet ? { system: system, handler: sheet.handler } : null;
          refreshCharacterList();
        });
      } else {
        _activeSheet = null;
      }
    });
  }

  function loadRuleContent(system, file, uploadSummary) {
    var ce = _el('rules-content-view'); if (!ce) return;
    ce.innerHTML = '<div class="rules-placeholder">加载中...</div>';
    AIClient.getRuleContent(system, file).then(function(data) {
      if (data && typeof data.content === 'string') {
        var summary = uploadSummary ? '<div class="rules-placeholder" style="text-align:left;">拆解摘要：MD 1 个；图片 ' + (uploadSummary.imageCount || 0) + ' 个；解包文件 ' + (uploadSummary.extractedFiles || 0) + ' 个；路径 Ruler/' + _esc(system) + '/' + _esc(file) + '</div>' : '';
        if (data.content.trim()) ce.innerHTML = summary + simpleMarkdown(data.content);
        else ce.innerHTML = summary + '<div class="rules-placeholder">规则文件已生成，但内容为空。说明拆解器没有从该文件提取到正文。</div>';
      }
      else { ce.innerHTML = '<div class="rules-placeholder">无法加载规则内容：' + _esc(data && data.error ? data.error : '未知错误') + '</div>'; }
    });
  }

  function setupCharacterImport() {
    var ib = _el('btn-import-xlsx'); var fi = _el('xlsx-file-input');
    if (ib && fi) {
      ib.addEventListener('click', function() { fi.click(); });
      fi.addEventListener('change', function() {
        var f = this.files[0]; if (!f) return;
        AIClient.readFile(f, 'xlsx').then(function(data) {
          if (data) {
            var tpl = TemplateRenderer.getActiveTemplate();
            var mapped = TemplateRenderer.mapXlsxToTemplate(data, tpl);
            var name = mapped.name || mapped.Name || f.name.replace(/\.[^.]+$/, '');
            var tok = MapEngine.addToken({ name: name, displayName: name, color: '#4ecdc4', gridX: Math.round(Math.random()*10-5), gridY: Math.round(Math.random()*10-5), data: mapped });
            if (mapped.HP && mapped.HP.current !== undefined) MapEngine.updateToken(tok.id, { hp: mapped.HP.current, maxHp: mapped.HP.max });
            if (mapped.AC !== undefined) MapEngine.updateToken(tok.id, { ac: mapped.AC });
            refreshCharacterList(); persistCharacters(); addChatMessage('system', '导入', '已导入角色: ' + name);
          }
        });
        this.value = '';
      });
    }
    var bn = _el('btn-new-character'); if (bn) bn.addEventListener('click', function() { openCharacterModal(); });
    // 2026-08-06 入口统一：修改角色卡入口已移入角色卡页面内部（sheet.html 内"✏️ 编辑"按钮，按权限显示），
    // 宿主右上角/角色面板不再出现"修改角色卡"切换按钮。
    var be = _el('btn-edit-character');
    if (be) be.style.display = 'none';
  }

  // 2026-08-06：入口统一后不再切换新建/修改按钮，保留函数名避免遗漏调用点，行为=无操作
  function updateCharacterActionButton() { }

  // ── 规则专属角色卡（动态链接：角色界面按当前规则系统加载 character-sheet 插件） ──

  function getSheetHandler() {
    return _activeSheet && _activeSheet.handler ? _activeSheet.handler : null;
  }

  function makeSheetContext(token) {
    var sys = (_activeSheet && _activeSheet.system) || _selectedRuleSystem || '';
    return {
      system: sys,
      token: token || null,
      fetch: function(path) { return fetch(getServerUrl() + path); },
      openRuleFile: function(file) {
        if (window.PluginRuntime && typeof PluginRuntime.openRuleFile === 'function') PluginRuntime.openRuleFile(sys, file);
      }
    };
  }

  function setupSheetForm() {
    var handler = getSheetHandler();
    var def = _el('char-default-form'); var sf = _el('char-sheet-form');
    _sheetCollector = null;
    if (handler && typeof handler.renderCreate === 'function') {
      if (def) def.style.display = 'none';
      if (sf) { sf.style.display = 'block'; sf.innerHTML = ''; }
      try {
        handler.renderCreate(sf, makeSheetContext(_editingCharId ? MapEngine.getTokenById(_editingCharId) : null), function(collect) {
          _sheetCollector = typeof collect === 'function' ? collect : null;
        });
      } catch (err) {
        if (sf) sf.innerHTML = '<div style="color:#ff7b7b;">角色卡表单渲染错误: ' + _esc(err.message) + '</div>';
      }
    } else {
      if (def) def.style.display = '';
      if (sf) { sf.style.display = 'none'; sf.innerHTML = ''; }
    }
  }

  function getTokenAvatarHtml(token, cls) {
    var avatar = token.avatarUrl || (token.data && token.data.assets && (token.data.assets.avatarFramed || token.data.assets.avatar));
    if (avatar) return '<img class="' + cls + ' avatar-image" src="' + _esc(avatar) + '" alt="">';
    var initial = (token.displayName || token.name || '?').charAt(0);
    return '<div class="' + cls + '" style="background:' + (token.color || '#4ecdc4') + '">' + _esc(initial) + '</div>';
  }

  // ── 多角色持久化（角色列表落盘 + 启动恢复） ──
  // 设计：角色是玩家跨会话的持久资产。token 数据写入 localStorage 'trpg_characters'，
  // 刷新/重启后 restoreCharacters() 原样恢复（头像/HP/AC/数据/位置），多角色可切换、可删除。
  var CHARACTER_STORE_KEY = 'trpg_characters';

  function persistCharacters() {
    try {
      var tokens = MapEngine.getAllTokens();
      var arr = (tokens || []).map(function(t) {
        return {
          id: t.id,
          name: t.name,
          displayName: t.displayName,
          color: t.color,
          gridX: t.gridX, gridY: t.gridY,
          hp: t.hp, maxHp: t.maxHp, ac: t.ac,
          avatarUrl: t.avatarUrl,
          category: getTokenCategory(t), // 2026-08-06：角色分类持久化
          owner: t.owner || null, // 2026-08-06：角色归属（创建者玩家名）持久化
          data: t.data || null
        };
      });
      localStorage.setItem(CHARACTER_STORE_KEY, JSON.stringify(arr));
      scheduleCharacterArchive(arr); // 2026-08-06：GM 原始版本备份（服务端存档）
    } catch (e) { /* 存储不可用时静默，不打断游戏 */ }
  }

  // ── GM 原始版本备份（2026-08-06）：角色保存后防抖同步到服务端存档 ──
  // 服务端保留 current.json + versions/ 历史，GM 可对比/恢复（/api/characters/*）
  var _archiveTimer = null;
  function scheduleCharacterArchive(arr) {
    if (!arr || !arr.length) return;
    if (_archiveTimer) clearTimeout(_archiveTimer);
    _archiveTimer = setTimeout(function() {
      _archiveTimer = null;
      var sys = _selectedRuleSystem || '';
      var adv = _currentAdventure || '默认';
      fetch('/api/characters/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: sys, adventure: adv, characters: arr })
      }).catch(function() { /* 后端不可用不阻塞界面 */ });
    }, 2500);
  }

  function restoreCharacters() {
    var arr = null;
    try { arr = JSON.parse(localStorage.getItem(CHARACTER_STORE_KEY)); } catch (e) {}
    if (!Array.isArray(arr) || !arr.length) return;
    var idMap = {};
    arr.forEach(function(s) {
      if (!s || !s.name) return;
      var tok = null;
      try {
        tok = MapEngine.addToken({
          id: s.id,
          name: s.name,
          displayName: s.displayName || s.name,
          color: s.color || '#4ecdc4',
          gridX: s.gridX || 0, gridY: s.gridY || 0,
          hp: s.hp, maxHp: s.maxHp, ac: s.ac,
          avatarUrl: s.avatarUrl || '', category: s.category || '玩家',
          conditions: s.conditions || [], owner: s.owner || null,
          data: s.data || {}
        });
      } catch (e) { return; }
      if (!tok) return;
      var oldId = s.id, newId = tok.id;
      if (oldId && oldId !== newId) idMap[oldId] = newId;
      var patch = {};
      if (s.hp !== undefined) patch.hp = s.hp;
      if (s.maxHp !== undefined) patch.maxHp = s.maxHp;
      if (s.ac !== undefined) patch.ac = s.ac;
      if (s.avatarUrl) patch.avatarUrl = s.avatarUrl;
      if (s.category) patch.category = s.category;
      if (s.owner) patch.owner = s.owner; // 2026-08-06：恢复角色归属
      if (Object.keys(patch).length) {
        try { MapEngine.updateToken(newId, patch); } catch (e2) {}
      }
      // 迁移独立角色卡窗口快照键（trpg_sheet_<oldId> → trpg_sheet_<newId>）
      if (oldId && oldId !== newId) {
        try {
          var snap = localStorage.getItem('trpg_sheet_' + oldId);
          if (snap) { localStorage.setItem('trpg_sheet_' + newId, snap); localStorage.removeItem('trpg_sheet_' + oldId); }
        } catch (e3) {}
      }
    });
    if (Object.keys(idMap).length) {
      try { localStorage.setItem('trpg_char_idmap', JSON.stringify(idMap)); } catch (e4) {}
    }
  }

  // ── 角色分类分页（2026-08-06）：玩家/友方/敌人/NPC + 动态自定义分类 ──
  var DEFAULT_CHAR_CATEGORIES = ['玩家', '友方', '敌人', 'NPC'];
  var CHAR_CAT_STORE_KEY = 'trpg_char_categories';
  var _charCategoryFilter = null; // null=未初始化，首次渲染默认选中「玩家」

  function getCharCategories() {
    var cats = null;
    try { cats = JSON.parse(localStorage.getItem(CHAR_CAT_STORE_KEY)); } catch (e) {}
    if (!Array.isArray(cats) || !cats.length) cats = DEFAULT_CHAR_CATEGORIES.slice();
    return cats;
  }
  function saveCharCategories(cats) {
    try { localStorage.setItem(CHAR_CAT_STORE_KEY, JSON.stringify(cats)); } catch (e) {}
  }
  function getTokenCategory(t) {
    if (!t) return '玩家';
    var c = t.category || (t.data && t.data.category) || '玩家';
    return c || '玩家';
  }
  function setTokenCategory(t, cat) {
    t.category = cat;
    try { MapEngine.updateToken(t.id, { category: cat, data: Object.assign({}, t.data || {}, { category: cat }) }); } catch (e) {}
    persistCharacters();
  }

  function renderCharacterCategoryTabs() {
    var tabsEl = _el('char-category-tabs'); if (!tabsEl) return;
    if (_charCategoryFilter === null) _charCategoryFilter = '玩家';
    var cats = getCharCategories();
    var counts = {};
    MapEngine.getAllTokens().forEach(function(t) { var c = getTokenCategory(t); counts[c] = (counts[c] || 0) + 1; });
    tabsEl.innerHTML = '';
    cats.forEach(function(cat) {
      var btn = document.createElement('button');
      btn.className = 'char-category-tab' + (cat === _charCategoryFilter ? ' active' : '');
      btn.textContent = cat + ' (' + (counts[cat] || 0) + ')';
      btn.title = '点击查看；把角色条目拖到这里即可调整分类';
      btn.dataset.category = cat;
      btn.addEventListener('click', function() { _charCategoryFilter = cat; renderCharacterCategoryTabs(); refreshCharacterList(); });
      btn.addEventListener('dragover', function(e) { if (e.dataTransfer.types.indexOf('text/trpg-character') >= 0 || e.dataTransfer.types.indexOf('text/plain') >= 0) { e.preventDefault(); btn.classList.add('drag-over'); } });
      btn.addEventListener('dragleave', function() { btn.classList.remove('drag-over'); });
      btn.addEventListener('drop', function(e) {
        e.preventDefault(); btn.classList.remove('drag-over');
        var id = e.dataTransfer.getData('text/trpg-character') || e.dataTransfer.getData('text/plain');
        var t = MapEngine.getTokenById(id);
        if (!t || !canEditCharacter(id)) return;
        setTokenCategory(t, cat); _charCategoryFilter = cat; renderCharacterCategoryTabs(); refreshCharacterList();
      });
      tabsEl.appendChild(btn);
    });
    var addBtn = document.createElement('button'); addBtn.className = 'char-category-tab char-category-add'; addBtn.textContent = '＋'; addBtn.title = '添加自定义分类';
    addBtn.addEventListener('click', function() { var name = prompt('新分类名称'); if (!name || !name.trim()) return; name = name.trim(); if (cats.indexOf(name) < 0) { cats.push(name); saveCharCategories(cats); } _charCategoryFilter = name; renderCharacterCategoryTabs(); refreshCharacterList(); });
    tabsEl.appendChild(addBtn);
  }


  // ── 2026-08-06 联机权限（模块级，角色列表/钩子/独立窗口共用） ──
  // 角色修改权限——单机全权；联机=创建者（owner 玩家名）或 GM
  function canEditCharacter(tokenId) {
    if (!Network || !Network.isConnected || !Network.isConnected()) return true;
    if (isGMUser()) return true;
    var t = MapEngine.getTokenById(tokenId);
    if (!t) return true;
    var myName = (Network.getMyName && Network.getMyName()) || '';
    return !t.owner || t.owner === myName; // owner 缺失视为旧数据/自己创建
  }
  // 当前绑定的"我的角色"名（聊天显示"角色名（玩家名）"）
  function getMyCharacterName() {
    try {
      var cid = localStorage.getItem('trpg_my_character') || '';
      if (!cid) return '';
      var t = MapEngine.getTokenById(cid);
      return t ? (t.displayName || t.name || '') : '';
    } catch (e) { return ''; }
  }
  // 权限快照（独立窗口 sheet.html/character-create.html 读取）
  function writePermSnapshot(tokenId) {
    try {
      var t = MapEngine.getTokenById(tokenId);
      if (!t) return;
      localStorage.setItem('trpg_perm_' + tokenId, JSON.stringify({
        canEdit: canEditCharacter(tokenId),
        isGM: isGMUser(),
        owner: t.owner || ''
      }));
    } catch (e) {}
  }
  function writeAllPermSnapshots() {
    MapEngine.getAllTokens().forEach(function (t) { writePermSnapshot(t.id); });
  }

  function refreshCharacterList() {
    setupCharacterListEvents();
    var listEl = _el('character-list'); if (!listEl) return;
    renderCharacterCategoryTabs();
    var tokens = MapEngine.getAllTokens(); listEl.innerHTML = '';
    if (!tokens.length) { listEl.innerHTML = '<div class="char-list-empty">暂无角色<br><br>点击「＋ 新建」创建角色，或导入已有角色卡</div>'; return; }
    var cat = _charCategoryFilter || '玩家';
    var filtered = tokens.filter(function(t) { return getTokenCategory(t) === cat; });
    if (!filtered.length) { listEl.innerHTML = '<div class="char-list-empty">分类「' + _esc(cat) + '」暂无角色<br><span>可把其他分类的角色条目拖到此分页</span></div>'; return; }
    var myCharId = ''; try { myCharId = localStorage.getItem('trpg_my_character') || ''; } catch (e) {}
    filtered.forEach(function(t) {
      writePermSnapshot(t.id);
      var canEdit = canEditCharacter(t.id), isMyChar = t.id === myCharId, d = t.data || {};
      var item = document.createElement('div'); item.className = 'character-list-item' + (isMyChar ? ' my-char' : '') + (t.id === _lastDetailTokenId ? ' selected' : ''); item.dataset.id = t.id; item.draggable = !!canEdit;
      var lv = d.level !== undefined ? d.level : (d.Level !== undefined ? d.Level : '');
      var cls = d.class || d.Class || '', race = d.race || t.race || '', bg = d.background || t.background || '';
      var infoBits = [(lv !== '' ? 'Lv' + lv : ''), race, cls].filter(Boolean).join(' · ');
      var hp = t.hp !== undefined ? t.hp : (d.HP && d.HP.current), maxHp = t.maxHp !== undefined ? t.maxHp : (d.HP && d.HP.max);
      var ac = t.ac !== undefined ? t.ac : (d.AC !== undefined ? d.AC : '');
      var pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round(hp / maxHp * 100))) : 0;
      var tip = '<b>' + _esc(t.displayName || t.name) + '</b><br>' + _esc(infoBits || '未填写角色概况');
      if (bg) tip += '<br>背景：' + _esc(bg); if (ac !== '') tip += '<br>护甲等级：' + _esc(ac); if (hp !== undefined) tip += '<br>生命值：' + _esc(hp) + '/' + _esc(maxHp || '?');
      if (t.owner) tip += '<br>控制者：' + _esc(t.owner); if (canEdit) tip += '<br><span style="color:var(--text-muted)">拖到上方分页可改变分类</span>';
      item.dataset.tooltip = tip;
      item.innerHTML = getTokenAvatarHtml(t, 'char-list-avatar') +
        '<div class="char-list-info"><div class="char-list-name">' + _esc(t.displayName || t.name) + (isMyChar ? ' <span class="my-char-mark">⭐</span>' : '') + '</div>' +
        '<div class="char-list-sub">' + _esc(infoBits) + (ac !== '' ? ' · AC ' + _esc(ac) : '') + '</div>' +
        '<div class="char-list-hp"><span>HP ' + _esc(hp === undefined ? '?' : hp) + '/' + _esc(maxHp || '?') + '</span><i class="hp-bar-mini-track"><i style="width:' + pct + '%"></i></i></div></div>' +
        '<button class="btn-small char-open-btn" data-act="open-sheet" data-id="' + t.id + '" title="打开角色卡">角色卡</button>' +
        '<button class="btn-small my-char-btn' + (isMyChar ? ' accent' : '') + '" data-act="set-my-char" data-id="' + t.id + '" title="设为我的角色">' + (isMyChar ? '⭐' : '☆') + '</button>' +
        (isGMUser() && Network.isConnected() ? '<button class="btn-small transfer-btn" data-act="char-transfer" data-id="' + t.id + '" title="转交控制权">⇄</button>' : '') +
        (canEdit ? '<button class="btn-small danger char-del-btn" data-id="' + t.id + '" title="删除角色">✕</button>' : '<span class="char-readonly" title="只读">🔒</span>');
      item.addEventListener('dragstart', function(e) { if (!canEdit) { e.preventDefault(); return; } e.dataTransfer.setData('text/trpg-character', t.id); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); });
      item.addEventListener('dragend', function() { item.classList.remove('dragging'); document.querySelectorAll('.char-category-tab').forEach(function(x){x.classList.remove('drag-over');}); });
      item.addEventListener('mouseenter', showCharacterFloatTip); item.addEventListener('mousemove', moveCharacterFloatTip); item.addEventListener('mouseleave', hideCharacterFloatTip);
      listEl.appendChild(item);
    });
  }

  var _charFloatTip = null;
  function showCharacterFloatTip(e) { var html = e.currentTarget && e.currentTarget.dataset.tooltip; if (!html) return; hideCharacterFloatTip(); _charFloatTip = document.createElement('div'); _charFloatTip.className = 'char-float-tip'; _charFloatTip.innerHTML = html; document.body.appendChild(_charFloatTip); moveCharacterFloatTip(e); }
  function moveCharacterFloatTip(e) { if (!_charFloatTip) return; var x = e.clientX + 16, y = e.clientY + 14; var r = _charFloatTip.getBoundingClientRect(); if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8; _charFloatTip.style.left = Math.max(8,x) + 'px'; _charFloatTip.style.top = Math.max(8,y) + 'px'; }
  function hideCharacterFloatTip() { if (_charFloatTip) _charFloatTip.remove(); _charFloatTip = null; }

  // 2026-08-06：绑定"我的角色"（聊天以角色名发言；默认自己创建的即自动绑定）
  function setMyCharacter(tokenId) {
    try { localStorage.setItem('trpg_my_character', tokenId); } catch (e) {}
    refreshCharacterList();
    var t = MapEngine.getTokenById(tokenId);
    if (t) addChatMessage('system', '角色', '已把「' + (t.displayName || t.name) + '」设为你的人物（聊天将以该角色名义发言）。');
  }
  // 2026-08-06：GM 转交角色控制权
  function transferCharacter(tokenId) {
    var t = MapEngine.getTokenById(tokenId); if (!t) return;
    var to = prompt('把「' + (t.displayName || t.name) + '」的控制权转交给哪位玩家？（输入玩家名）', '');
    if (!to || !to.trim()) return;
    if (Network.isConnected()) Network.sendTokenTransfer(tokenId, to.trim());
    else { t.owner = to.trim(); refreshCharacterList(); addChatMessage('system', '权限', '已把控制权转交给「' + to.trim() + '」（单机本地记录）。'); }
  }

  // 角色列表事件委托（绑定一次，动态列表项全部生效；幂等：重复调用无副作用）
  function setupCharacterListEvents() {
    if (_charListEventsBound) return;
    var listEl = _el('character-list'); if (!listEl) return; _charListEventsBound = true;
    listEl.addEventListener('click', function(e) {
      var action = e.target.closest ? e.target.closest('[data-act]') : null;
      if (action) {
        e.stopPropagation(); var id = action.getAttribute('data-id'), act = action.getAttribute('data-act');
        if (act === 'open-sheet') openCharacterSheet(id);
        else if (act === 'set-my-char') setMyCharacter(id);
        else if (act === 'char-transfer') transferCharacter(id);
        return;
      }
      var del = e.target.closest ? e.target.closest('.char-del-btn') : null; if (del) { e.stopPropagation(); deleteCharacter(del.dataset.id); return; }
      var item = e.target.closest ? e.target.closest('.character-list-item') : null; if (item) selectCharacter(item.dataset.id);
    });
  }

  // 2026-08-06：角色详情一律在操作系统级独立窗口（sheet.html）显示。
  // 主窗口角色面板不内嵌长详情（曾与聊天栏同级框造成层级遮挡）；此处只做选中高亮 + 快照写入 + 开窗。
  function selectCharacter(id) {
    var token = MapEngine.getTokenById(id); if (!token) return;
    _lastDetailTokenId = id;
    var category = getTokenCategory(token);
    if (_charCategoryFilter !== category) { _charCategoryFilter = category; renderCharacterCategoryTabs(); refreshCharacterList(); }
    var le = _el('character-list'); if (le) { le.querySelectorAll('.character-list-item').forEach(function(i){ i.classList.toggle('selected', i.dataset.id === id); }); var item = Array.prototype.find.call(le.querySelectorAll('.character-list-item'), function(i){ return i.dataset.id === id; }); if (item) item.scrollIntoView({ block: 'nearest' }); }
    try { localStorage.setItem('trpg_sheet_' + id, JSON.stringify(token)); } catch (e) {}
  }

  function openCharacterSheet(id) {
    var token = MapEngine.getTokenById(id); if (!token) return;
    selectCharacter(id); writePermSnapshot(id);
    try { localStorage.setItem('trpg_sheet_' + id, JSON.stringify(token)); } catch (e) {}
    var sys = _selectedRuleSystem || '';
    try { window.open('/sheet.html?id=' + encodeURIComponent(id) + '&system=' + encodeURIComponent(sys), '_blank'); } catch (e) { addChatMessage('system','角色卡','无法打开角色卡窗口：'+e.message); }
  }

  // 2026-08-06：不再渲染内嵌详情；改为同步角色卡快照并通知已打开的独立窗口刷新（storage 事件）。
  // 保留函数名与调用点（UpdateVariable 回写/图片保存/地图点选后刷新），行为改为"数据快照同步"。
  function showCharacterDetail(tokenId) {
    var token = MapEngine.getTokenById(tokenId);
    if (!token) return;
    _lastDetailTokenId = tokenId;
    var le = _el('character-list');
    if (le) {
      le.querySelectorAll('.character-list-item').forEach(function(i) { i.classList.remove('selected'); });
      var item = le.querySelector('.character-list-item[data-id="' + tokenId + '"]');
      if (item) item.classList.add('selected');
    }
    try {
      localStorage.setItem('trpg_sheet_' + tokenId, JSON.stringify(token));
    } catch (e) {}
  }

  function damageCharacter(tokenId) {
    var ai = _el('hp-amount-' + tokenId); applyHPChange(tokenId, ai ? -Math.abs(parseInt(ai.value) || 0) : -1);
  }
  function healCharacter(tokenId) {
    var ai = _el('hp-amount-' + tokenId); applyHPChange(tokenId, ai ? Math.abs(parseInt(ai.value) || 0) : 1);
  }

  function applyHPChange(tokenId, delta) {
    var token = MapEngine.getTokenById(tokenId); if (!token) return;
    var newHp = Math.max(0, (token.hp || 0) + delta);
    if (token.maxHp) newHp = Math.min(token.maxHp, newHp);
    MapEngine.updateToken(tokenId, { hp: newHp });
    // 同步角色卡数据字段，保证独立角色卡窗口/刷新后一致
    if (token.data && token.data.HP) { token.data.HP.current = newHp; }
    persistCharacters();
    var label = delta > 0 ? '治疗' : '伤害';
    addChatMessage('system', label, _esc(token.displayName || token.name) + ' ' + label + ': ' + Math.abs(delta) + ' (HP: ' + newHp + '/' + (token.maxHp || '?') + ')');
    showCharacterDetail(tokenId);
  }

  function openCharacterModal() {
    // 独立窗口标准：新建角色卡在操作系统级新窗口打开（宿主 WebView2 接管 window.open）
    var sys = _selectedRuleSystem || '';
    window.open('/character-create.html?system=' + encodeURIComponent(sys), '_blank');
  }

  function openCharacterModalForEdit(tokenId) {
    var token = MapEngine.getTokenById(tokenId); if (!token || !canEditCharacter(tokenId)) return;
    try { localStorage.setItem('trpg_sheet_' + tokenId, JSON.stringify(token)); } catch (e) {}
    var sys = _selectedRuleSystem || '';
    window.open('/sheet.html?id=' + encodeURIComponent(tokenId) + '&system=' + encodeURIComponent(sys) + '&edit=1', '_blank');
  }

  // 独立窗口标准：接收角色卡创建窗口（character-create.html）的保存结果
  function setupPendingCharacterListener() {
    window.addEventListener('storage', function(e) {
      // 2026-08-06：角色卡独立窗口恢复历史版本 → 主窗口应用恢复数据
      if (e.key && e.key.indexOf('trpg_char_restore_') === 0 && e.newValue) {
        var rId = e.key.substring('trpg_char_restore_'.length);
        try {
          var rch = JSON.parse(e.newValue);
          var rTok = MapEngine.getTokenById(rId);
          if (rTok && rch) {
            var up = { data: rch.data || rTok.data || {} };
            if (rch.hp !== undefined) up.hp = rch.hp;
            if (rch.maxHp !== undefined) up.maxHp = rch.maxHp;
            if (rch.ac !== undefined) up.ac = rch.ac;
            if (rch.category) up.category = rch.category;
            MapEngine.updateToken(rId, up);
            persistCharacters();
            refreshCharacterList();
            addChatMessage('system', '角色卡', '已从历史版本恢复角色: ' + ((rch.displayName) || rch.name || ''));
          }
        } catch (err) {}
        try { localStorage.removeItem(e.key); } catch (err) {}
        return;
      }
      if (e.key !== 'trpg_pending_character') return;
      var val = null;
      try { val = JSON.parse(e.newValue); } catch (err) {}
      if (!val || typeof val !== 'object') return;
      try { localStorage.removeItem('trpg_pending_character'); } catch (err) {}
      var data = val.data || {};
      if (val.action === 'update' && val.id) {
        var up = { name: val.name, displayName: val.displayName, color: val.color, data: data };
        if (data.assets && (data.assets.avatarFramed || data.assets.avatar)) up.avatarUrl = data.assets.avatarFramed || data.assets.avatar;
        if (val.category) up.category = val.category;
        var hpV = data.HP || data.HP_current;
        if (hpV && typeof hpV === 'object') { up.hp = hpV.current; up.maxHp = hpV.max; }
        if (data.AC !== undefined) up.ac = parseInt(data.AC) || data.AC;
        MapEngine.updateToken(val.id, up);
        try { localStorage.setItem('trpg_sheet_' + val.id, JSON.stringify(MapEngine.getTokenById(val.id))); } catch (err) {}
      } else {
        var tok = MapEngine.addToken({ name: val.name, displayName: val.displayName, color: val.color, gridX: 0, gridY: 0, data: data });
        if (data.assets && (data.assets.avatarFramed || data.assets.avatar)) MapEngine.updateToken(tok.id, { avatarUrl: data.assets.avatarFramed || data.assets.avatar });
        if (val.category) MapEngine.updateToken(tok.id, { category: val.category });
        var hpV = data.HP || data.HP_current;
        if (hpV && typeof hpV === 'object') MapEngine.updateToken(tok.id, { hp: hpV.current, maxHp: hpV.max });
        if (data.AC !== undefined) MapEngine.updateToken(tok.id, { ac: parseInt(data.AC) || data.AC });
        try { localStorage.setItem('trpg_sheet_' + tok.id, JSON.stringify(MapEngine.getTokenById(tok.id))); } catch (err) {}
      }
      refreshCharacterList();
      persistCharacters();
      addChatMessage('system', '角色卡', '已' + (val.action === 'update' ? '更新' : '创建') + '角色: ' + val.name);
    });
  }

  function saveCharacter() {
    var n = _el('char-name'); var d = _el('char-display'); var c = _el('char-color'); var da = _el('char-data');
    var data, name, displayName, color;
    if (_sheetCollector && typeof _sheetCollector === 'function') {
      // 规则专属角色卡：由插件表单收集并校验
      var collected = _sheetCollector();
      if (!collected || typeof collected !== 'object') {
        addChatMessage('system', '错误', '角色卡数据未通过校验或未填写完整。');
        return;
      }
      data = collected.data || collected;
      name = String(collected.name || (data && data.name) || (n ? n.value.trim() : '') || '未命名');
      displayName = String(collected.displayName || name);
      color = collected.color || (c ? c.value : '#4ecdc4');
    } else {
      name = n ? n.value.trim() : '未命名';
      displayName = d ? d.value.trim() : name;
      color = c ? c.value : '#4ecdc4';
      var dataStr = da ? da.value.trim() : '{}';
      try { data = JSON.parse(dataStr); } catch(e) { addChatMessage('system', '错误', '角色数据JSON格式错误，请检查。'); return; }
    }
    if (_pendingCharacterAssets) {
      data.assets = Object.assign({}, data.assets || {}, _pendingCharacterAssets);
    }
    if (_editingCharId) {
      var up = { name: name, displayName: displayName, color: color, data: data };
      if (data.assets && data.assets.avatarFramed) up.avatarUrl = data.assets.avatarFramed;
      var hpV = data.HP || data.HP_current;
      if (hpV && typeof hpV === 'object') { up.hp = hpV.current; up.maxHp = hpV.max; }
      if (data.AC !== undefined) up.ac = parseInt(data.AC) || data.AC;
      MapEngine.updateToken(_editingCharId, up);
    } else {
      var tok = MapEngine.addToken({ name: name, displayName: displayName, color: color, gridX: 0, gridY: 0, data: data });
      if (data.assets && data.assets.avatarFramed) MapEngine.updateToken(tok.id, { avatarUrl: data.assets.avatarFramed });
      var hpV = data.HP || data.HP_current;
      if (hpV && typeof hpV === 'object') MapEngine.updateToken(tok.id, { hp: hpV.current, maxHp: hpV.max });
      if (data.AC !== undefined) MapEngine.updateToken(tok.id, { ac: parseInt(data.AC) || data.AC });
    }
    closeModal('character-modal'); refreshCharacterList(); persistCharacters(); _editingCharId = null; _pendingCharacterAssets = null; _sheetCollector = null;
  }

  function setupCharacterImageTool() {
    var openBtn = _el('btn-open-character-image');
    if (openBtn) openBtn.addEventListener('click', openCharacterImageModal);
    var cancelBtn = _el('btn-char-image-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function() { closeModal('character-image-modal'); });
    var fileInput = _el('char-image-file');
    if (fileInput) fileInput.addEventListener('change', loadCharacterImageFile);
    var target = _el('char-image-target');
    if (target) target.addEventListener('change', function() { resetImageCropForTarget(this.value); drawCharacterImageTool(); });
    var zoom = _el('char-image-zoom');
    if (zoom) zoom.addEventListener('input', function() { _imageTool.zoom = parseFloat(this.value) || 1; drawCharacterImageTool(); });
    var canvas = _el('char-image-canvas');
    if (canvas) {
      canvas.addEventListener('mousedown', startImageCropDrag);
      canvas.addEventListener('mousemove', moveImageCropDrag);
      canvas.addEventListener('mouseup', endImageCropDrag);
      canvas.addEventListener('mouseleave', endImageCropDrag);
    }
    var p = _el('btn-char-image-use-portrait'); if (p) p.addEventListener('click', function() { recordCurrentCrop('portrait'); });
    var a = _el('btn-char-image-use-avatar'); if (a) a.addEventListener('click', function() { recordCurrentCrop('avatar'); });
    var s = _el('btn-char-image-save'); if (s) s.addEventListener('click', saveCharacterImageAssets);
  }

  function openCharacterImageModal() {
    var name = (_el('char-name') || {}).value || (_el('char-display') || {}).value || '未命名角色';
    var nameInput = _el('char-image-name'); if (nameInput) nameInput.value = name.trim() || '未命名角色';
    var fileInput = _el('char-image-file'); if (fileInput) fileInput.value = '';
    _imageTool = { image: null, originalDataUrl: '', cropPortrait: null, cropAvatar: null, target: 'portrait', crop: { x: 110, y: 40, w: 300, h: 225 }, dragging: false, dragOffsetX: 0, dragOffsetY: 0, zoom: 1 };
    var zoom = _el('char-image-zoom'); if (zoom) zoom.value = '1';
    fillCharacterImageSystems();
    clearImagePreviews();
    drawCharacterImageTool();
    openModal('character-image-modal');
  }

  function fillCharacterImageSystems() {
    var sel = _el('char-image-system'); if (!sel) return;
    sel.innerHTML = '<option value="Common">Common</option>';
    AIClient.getRuleSystems().then(function(systems) {
      (systems || []).forEach(function(s) {
        var name = s.name || s.system;
        if (name) sel.appendChild(new Option(name, name));
      });
    });
  }

  function loadCharacterImageFile() {
    var f = this.files && this.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        _imageTool.image = img;
        _imageTool.originalDataUrl = e.target.result;
        resetImageCropForTarget((_el('char-image-target') || {}).value || 'portrait');
        drawCharacterImageTool();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(f);
  }

  function resetImageCropForTarget(target) {
    var canvas = _el('char-image-canvas'); if (!canvas) return;
    _imageTool.target = target || 'portrait';
    if (target === 'avatar') {
      // 圆形裁剪：圆心 + 半径（用户拖动圆框控制剪切范围，形成圆形头像）
      var r = Math.min(canvas.width, canvas.height) * 0.32;
      _imageTool.crop = { x: canvas.width / 2, y: canvas.height / 2, r: r };
    } else {
      var ratio = 3 / 4;
      var h = Math.min(canvas.height - 50, 330);
      var w = h * ratio;
      if (w > canvas.width - 50) { w = canvas.width - 50; h = w / ratio; }
      _imageTool.crop = { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w: w, h: h };
    }
  }

  function drawCharacterImageTool() {
    var canvas = _el('char-image-canvas'); if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f0f1a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!_imageTool.image) {
      ctx.fillStyle = '#6a6a8a'; ctx.textAlign = 'center'; ctx.font = '14px sans-serif';
      ctx.fillText('选择角色图片后在这里裁剪', canvas.width / 2, canvas.height / 2);
      return;
    }
    var img = _imageTool.image;
    var fit = Math.min(canvas.width / img.width, canvas.height / img.height) * _imageTool.zoom;
    var dw = img.width * fit, dh = img.height * fit;
    var dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2;
    _imageTool.draw = { dx: dx, dy: dy, dw: dw, dh: dh, scale: fit };
    var c = _imageTool.crop;
    var isCircle = _imageTool.target === 'avatar';
    if (isCircle) {
      // 圆形裁剪：圆外半透明遮罩 + 金色圆环 + 右下角缩放手柄
      ctx.drawImage(img, dx, dy, dw, dh);
      var mask = document.createElement('canvas');
      mask.width = canvas.width; mask.height = canvas.height;
      var mctx = mask.getContext('2d');
      mctx.fillStyle = 'rgba(0,0,0,0.5)'; mctx.fillRect(0, 0, mask.width, mask.height);
      mctx.globalCompositeOperation = 'destination-out';
      mctx.beginPath(); mctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); mctx.fill();
      ctx.drawImage(mask, 0, 0);
      ctx.strokeStyle = '#e0c870'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke();
      // 缩放手柄（右下角）
      var hx = c.x + c.r * 0.7, hy = c.y + c.r * 0.7;
      ctx.fillStyle = '#e0c870'; ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a2e'; ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a8ab0'; ctx.textAlign = 'left'; ctx.font = '12px sans-serif';
      ctx.fillText('拖动圆框移动 · 右下角手柄缩放 · 圆形头像', 12, canvas.height - 10);
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, c.y); ctx.fillRect(0, c.y + c.h, canvas.width, canvas.height - c.y - c.h);
      ctx.fillRect(0, c.y, c.x, c.h); ctx.fillRect(c.x + c.w, c.y, canvas.width - c.x - c.w, c.h);
      ctx.strokeStyle = '#e0c870'; ctx.lineWidth = 2; ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = '#e0c870'; ctx.fillRect(c.x + c.w - 10, c.y + c.h - 10, 10, 10);
    }
  }

  function startImageCropDrag(e) {
    if (!_imageTool.image) return;
    var rect = this.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var c = _imageTool.crop;
    var isCircle = _imageTool.target === 'avatar';
    if (isCircle) {
      // 手柄：右下角 40px 内 → 缩放；圆内 → 拖动
      var hx = c.x + c.r * 0.7, hy = c.y + c.r * 0.7;
      if (Math.hypot(x - hx, y - hy) <= 18) {
        _imageTool.dragging = 'resize';
        _imageTool.dragStartDist = Math.hypot(x - c.x, y - c.y);
        _imageTool.dragStartR = c.r;
      } else if (Math.hypot(x - c.x, y - c.y) <= c.r) {
        _imageTool.dragging = 'move';
        _imageTool.dragOffsetX = x - c.x;
        _imageTool.dragOffsetY = y - c.y;
      }
      return;
    }
    if (x >= c.x + c.w - 16 && y >= c.y + c.h - 16) {
      _imageTool.dragging = 'resize';
      _imageTool.dragStartW = c.w; _imageTool.dragStartH = c.h;
      _imageTool.dragStartX = x; _imageTool.dragStartY = y;
    } else if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
      _imageTool.dragging = 'move';
      _imageTool.dragOffsetX = x - c.x;
      _imageTool.dragOffsetY = y - c.y;
    }
  }

  function moveImageCropDrag(e) {
    if (!_imageTool.dragging) return;
    var rect = this.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var c = _imageTool.crop;
    if (_imageTool.target === 'avatar') {
      if (_imageTool.dragging === 'resize') {
        var dist = Math.max(24, Math.hypot(x - c.x, y - c.y));
        c.r = Math.min(this.width / 2, Math.min(this.height / 2, dist));
      } else if (_imageTool.dragging === 'move') {
        c.x = Math.max(c.r, Math.min(this.width - c.r, x - _imageTool.dragOffsetX));
        c.y = Math.max(c.r, Math.min(this.height - c.r, y - _imageTool.dragOffsetY));
      }
    } else {
      if (_imageTool.dragging === 'resize') {
        var ratio = 3 / 4;
        var nw = Math.max(40, x - c.x);
        var nh = Math.max(54, y - c.y);
        c.w = Math.min(this.width - c.x, Math.max(nw, nh * ratio));
        c.h = c.w / ratio;
      } else if (_imageTool.dragging === 'move') {
        c.x = Math.max(0, Math.min(this.width - c.w, x - _imageTool.dragOffsetX));
        c.y = Math.max(0, Math.min(this.height - c.h, y - _imageTool.dragOffsetY));
      }
    }
    drawCharacterImageTool();
  }

  function endImageCropDrag() { _imageTool.dragging = false; }

  function cropToDataUrl(crop, width, height, framed) {
    var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    var ctx = canvas.getContext('2d');
    var d = _imageTool.draw;
    var isCircle = _imageTool.target === 'avatar';
    if (isCircle) {
      // 圆形裁切：源图按圆心/半径取样，clip 圆形，输出透明底 PNG
      var sx = Math.max(0, (crop.x - d.dx) / d.scale - (crop.r / d.scale));
      var sy = Math.max(0, (crop.y - d.dy) / d.scale - (crop.r / d.scale));
      var sw = Math.min(_imageTool.image.width - sx, (crop.r * 2) / d.scale);
      var sh = Math.min(_imageTool.image.height - sy, (crop.r * 2) / d.scale);
      var cx = width / 2, cy = height / 2;
      var radius = Math.min(width, height) / 2;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(_imageTool.image, sx, sy, sw, sh, 0, 0, width, height);
      if (framed) {
        ctx.beginPath(); ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(10, width * 0.05); ctx.strokeStyle = '#c9a84c'; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, radius - 14, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(3, width * 0.015); ctx.strokeStyle = '#1a1a2e'; ctx.stroke();
      }
      return canvas.toDataURL('image/png');
    }
    var sx2 = Math.max(0, (crop.x - d.dx) / d.scale);
    var sy2 = Math.max(0, (crop.y - d.dy) / d.scale);
    var sw2 = Math.min(_imageTool.image.width - sx2, crop.w / d.scale);
    var sh2 = Math.min(_imageTool.image.height - sy2, crop.h / d.scale);
    ctx.drawImage(_imageTool.image, sx2, sy2, sw2, sh2, 0, 0, width, height);
    if (framed) {
      ctx.lineWidth = Math.max(12, width * 0.045);
      ctx.strokeStyle = '#c9a84c'; ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
      ctx.lineWidth = Math.max(4, width * 0.015);
      ctx.strokeStyle = '#1a1a2e'; ctx.strokeRect(ctx.lineWidth * 2, ctx.lineWidth * 2, width - ctx.lineWidth * 4, height - ctx.lineWidth * 4);
    }
    return canvas.toDataURL('image/png');
  }

  function recordCurrentCrop(target) {
    if (!_imageTool.image) { addChatMessage('system', '角色图片', '请先选择图片。'); return; }
    // 按目标对齐裁剪形状：portrait→矩形3:4，avatar→圆形（用户手动控制剪切范围形成圆形头像）
    var needShape = target === 'avatar' ? (_imageTool.target !== 'avatar') : (_imageTool.target === 'avatar');
    if (needShape) resetImageCropForTarget(target);
    if (target === 'portrait') {
      _imageTool.cropPortrait = Object.assign({}, _imageTool.crop);
      var p = cropToDataUrl(_imageTool.cropPortrait, 768, 1024, false);
      var pi = _el('char-image-portrait-preview'); if (pi) pi.src = p;
      addChatMessage('system', '角色图片', '已记录3:4垂直立绘裁剪。');
    } else {
      _imageTool.cropAvatar = Object.assign({}, _imageTool.crop);
      var a = cropToDataUrl(_imageTool.cropAvatar, 512, 512, false);
      var f = cropToDataUrl(_imageTool.cropAvatar, 512, 512, true);
      var ai = _el('char-image-avatar-preview'); if (ai) ai.src = a;
      var fi = _el('char-image-framed-preview'); if (fi) fi.src = f;
      addChatMessage('system', '角色图片', '已记录圆形头像裁剪。');
    }
  }

  function clearImagePreviews() {
    ['char-image-portrait-preview','char-image-avatar-preview','char-image-framed-preview'].forEach(function(id) { var e = _el(id); if (e) e.removeAttribute('src'); });
  }

  function saveCharacterImageAssets() {
    if (!_imageTool.image) { addChatMessage('system', '角色图片', '请先选择图片。'); return; }
    if (!_imageTool.cropPortrait) recordCurrentCrop('portrait');
    if (!_imageTool.cropAvatar) recordCurrentCrop('avatar');
    var system = (_el('char-image-system') || {}).value || 'Common';
    var characterName = ((_el('char-image-name') || {}).value || '未命名角色').trim();
    var payload = {
      system: system,
      characterName: characterName,
      images: {
        original: _imageTool.originalDataUrl,
        portrait: cropToDataUrl(_imageTool.cropPortrait, 768, 1024, false),
        avatar: cropToDataUrl(_imageTool.cropAvatar, 512, 512, false),
        avatarFramed: cropToDataUrl(_imageTool.cropAvatar, 512, 512, true)
      }
    };
    AIClient.uploadCharacterAssets(payload).then(function(data) {
      if (!data || data.error) { addChatMessage('system', '角色图片', '保存失败: ' + (data ? data.error : '连接失败')); return; }
      _pendingCharacterAssets = {
        system: data.system,
        characterName: data.characterName,
        portrait: data.images.portrait.url,
        avatar: data.images.avatar.url,
        avatarFramed: data.images.avatarFramed.url,
        original: data.images.original ? data.images.original.url : ''
      };
      var status = _el('char-image-status'); if (status) status.textContent = '形象已保存，保存角色后关联';
      if (_editingCharId) {
        var token = MapEngine.getTokenById(_editingCharId);
        if (token) {
          var nextData = Object.assign({}, token.data || {});
          nextData.assets = Object.assign({}, nextData.assets || {}, _pendingCharacterAssets);
          MapEngine.updateToken(_editingCharId, { data: nextData, avatarUrl: _pendingCharacterAssets.avatarFramed });
          refreshCharacterList(); showCharacterDetail(_editingCharId);
        }
      }
      closeModal('character-image-modal');
      addChatMessage('system', '角色图片', '已保存角色形象资产到 Ruler/' + data.system + '/assets/characters/' + data.characterName + '/');
    });
  }

  function deleteCharacter(tokenId) {
    var token = MapEngine.getTokenById(tokenId); if (!token) return;
    var name = token.displayName || token.name;
    // 加固：任何一步异常（地图重绘/网络同步/存储）都不阻断删除完成
    try { MapEngine.removeToken(tokenId); } catch (e) {}
    try { localStorage.removeItem('trpg_sheet_' + tokenId); } catch (e) {}
    refreshCharacterList();
    try { persistCharacters(); } catch (e) {}
    if (_editingCharId === tokenId) _editingCharId = null;
    if (_lastDetailTokenId === tokenId) { _lastDetailTokenId = null; }
    addChatMessage('system', '删除', '已删除角色: ' + _esc(name));
  }

  function rollAllInitiative() {
    var tokens = MapEngine.getAllTokens(); if (!tokens.length) return;
    var initiatives = tokens.map(function(t) {
      var bonus = 0;
      if (t.data) bonus = parseInt(t.data.initiative) || parseInt(t.data.Initiative) || parseInt(t.data.Init) || parseInt(t.data['先攻']) || parseInt(t.data['先攻加值']) || 0;
      var roll = DiceSystem.rollOne(20);
      return { id: t.id, name: t.displayName || t.name, roll: roll, bonus: bonus, total: roll + bonus };
    });
    initiatives.sort(function(a, b) { return b.total - a.total; });
    _encounter = { active: true, initiatives: initiatives, currentIndex: 0, round: 1 };
    renderInitiativeList();
    addChatMessage('system', '先攻', '全体先攻已掷出！（' + initiatives.length + ' 个角色）');
  }

  function nextTurn() {
    if (!_encounter.initiatives.length) return;
    _encounter.currentIndex++;
    if (_encounter.currentIndex >= _encounter.initiatives.length) { _encounter.currentIndex = 0; _encounter.round++; }
    renderInitiativeList();
    var curr = _encounter.initiatives[_encounter.currentIndex];
    addChatMessage('system', '遭遇', '第 ' + _encounter.round + ' 轮 - 轮到: ' + _esc(curr.name) + ' (先攻 ' + curr.total + ')');
  }

  function renderInitiativeList() {
    var le = _el('initiative-list'); if (!le) return;
    if (!_encounter.initiatives.length) {
      le.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">点击「🎲 全体先攻」开始战斗</div>';
      return;
    }
    var html = '<div style="padding:4px;font-size:11px;color:var(--accent-light);margin-bottom:4px;">第 ' + _encounter.round + ' 轮</div>';
    _encounter.initiatives.forEach(function(ini, idx) {
      var cls = idx === _encounter.currentIndex ? ' initiative-item active-turn' : ' initiative-item';
      html += '<div class="' + cls + '"><span class="init-num">' + ini.total + '</span><span>' + _esc(ini.name) + '</span><span style="font-size:10px;color:var(--text-muted);margin-left:auto;">1d20(' + ini.roll + ')' + (ini.bonus !== 0 ? (ini.bonus > 0 ? '+' : '') + ini.bonus : '') + '</span></div>';
    });
    le.innerHTML = html;
  }

  function setupModals() {
    var closeButtons = document.querySelectorAll('.modal');
    closeButtons.forEach(function(modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal(modal.id);
      });
    });
    var bindModal = function(btnId, fn) { var b = _el(btnId); if (b) b.addEventListener('click', fn); };
    bindModal('btn-range-confirm', applyRange);
    bindModal('btn-range-cancel', function() { closeModal('range-modal'); });
    bindModal('btn-char-save', saveCharacter);
    bindModal('btn-char-cancel', function() { closeModal('character-modal'); });
    bindModal('btn-dice-roll', rollCustomDice);
    bindModal('btn-dice-cancel', function() { closeModal('dice-modal'); });
    bindModal('btn-bg-apply', applyBackground);
    bindModal('btn-bg-remove', removeBackground);
    bindModal('btn-bg-cancel', function() { closeModal('bg-modal'); });
    bindModal('btn-ai-char-generate', function() {
      var prompt = _el('ai-char-prompt'); if (!prompt || !prompt.value.trim()) return;
      var resultEl = _el('ai-char-result'); var outputEl = _el('ai-char-output'); var applyBtn = _el('btn-ai-char-apply');
      if (resultEl) resultEl.style.display = 'block';
      if (outputEl) outputEl.value = '生成中...';
      AIClient.sendMessage('请根据以下描述生成一个完整的角色数据JSON（使用当前规则书模板格式）：\n' + prompt.value, {
        includeGameState: false,
        customSystemPrompt: '你是一个TRPG角色创建助手。请根据用户的描述，生成一个完整的角色JSON数据对象。只输出纯JSON，不要markdown包裹。'
      }).then(function(res) {
        if (res && res.content) {
          var jsonStr = res.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          if (outputEl) outputEl.value = jsonStr;
          if (applyBtn) {
            applyBtn.style.display = 'inline-block';
            applyBtn.onclick = function() {
              var charData = _el('char-data'); var charName = _el('char-name');
              if (charData) charData.value = jsonStr;
              if (charName) {
                try { var d = JSON.parse(jsonStr); if (d.name) charName.value = d.name; } catch(e) {}
              }
              closeModal('ai-char-modal');
              openModal('character-modal');
            };
          }
        }
      });
    });
    bindModal('btn-ai-char-cancel', function() { closeModal('ai-char-modal'); });
    var typeSel = _el('range-type');
    if (typeSel) typeSel.addEventListener('change', function() {
      var dw = _el('range-width-row'); var da = _el('range-angle-row');
      var v = this.value;
      if (dw) dw.style.display = (v === 'line') ? 'flex' : 'none';
      if (da) da.style.display = (v === 'cone') ? 'flex' : 'none';
    });
  }

  function openModal(id) {
    var modal = _el(id); if (modal) modal.style.display = 'flex';
  }

  function closeModal(id) {
    var modal = _el(id); if (modal) modal.style.display = 'none';
  }

  function openRangeModal() {
    var typeSel = _el('range-type'); if (typeSel) { typeSel.value = 'circle'; typeSel.dispatchEvent(new Event('change')); }
    var sizeEl = _el('range-size'); if (sizeEl) sizeEl.value = '20';
    var widthEl = _el('range-width'); if (widthEl) widthEl.value = '5';
    var angleEl = _el('range-angle'); if (angleEl) angleEl.value = '60';
    openModal('range-modal');
  }

  function applyRange() {
    var type = (_el('range-type') || {}).value || 'circle';
    var size = parseInt((_el('range-size') || {}).value) || 20;
    var width = parseInt((_el('range-width') || {}).value) || 5;
    var angle = parseInt((_el('range-angle') || {}).value) || 60;
    MapEngine.setRange(type, size, { width: width, angle: angle });
    closeModal('range-modal');
  }

  function rollCustomDice() {
    var expr = (_el('custom-dice-expr') || {}).value || '';
    var label = (_el('custom-dice-label') || {}).value || '';
    if (!expr) return;
    var result = DiceSystem.smartRoll(expr);
    if (result) {
      var formatted = DiceSystem.formatResult(result);
      addChatMessage('dice', label || '自定义掷骰', formatted);
      if (AIClient && typeof AIClient.recordRoll === 'function') AIClient.recordRoll(expr, result, label);
      if (Network.isConnected()) Network.sendDiceRoll(expr, result);
    } else {
      addChatMessage('system', '错误', '无效的掷骰表达式: ' + expr);
    }
    closeModal('dice-modal');
  }

  function openDiceModal() {
    var expr = _el('custom-dice-expr'); if (expr) expr.value = '';
    var label = _el('custom-dice-label'); if (label) label.value = '';
    openModal('dice-modal');
    setTimeout(function() { var e = _el('custom-dice-expr'); if (e) e.focus(); }, 100);
  }

  function openBgModal() {
    var fu = _el('bg-url-input'); if (fu) fu.value = '';
    var fx = _el('bg-offset-x'); if (fx) fx.value = '0';
    var fy = _el('bg-offset-y'); if (fy) fy.value = '0';
    var ff = _el('bg-file-input'); if (ff) ff.value = '';
    openModal('bg-modal');
  }

  function applyBackground() {
    var url = (_el('bg-url-input') || {}).value.trim();
    var ox = parseInt((_el('bg-offset-x') || {}).value) || 0;
    var oy = parseInt((_el('bg-offset-y') || {}).value) || 0;
    var fileInput = _el('bg-file-input');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() { MapEngine.setBackgroundImage(img, ox, oy); };
        img.src = e.target.result;
      };
      reader.readAsDataURL(fileInput.files[0]);
      closeModal('bg-modal');
      return;
    }
    if (url) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() { MapEngine.setBackgroundImage(img, ox, oy); };
      img.onerror = function() { addChatMessage('系统', '错误', '无法加载背景图片URL'); };
      img.src = url;
      closeModal('bg-modal');
    }
  }

  function removeBackground() {
    MapEngine.removeBackgroundImage();
    closeModal('bg-modal');
  }

  function setupSettings() {
    // 地图设置绑定
    ['setting-grid-color','setting-bg-color','setting-range-color'].forEach(function(id) {
      var e = _el(id); if (!e) return;
      e.addEventListener('change', function() { MapEngine.setGridColor(this.value); });
    });
    _el('setting-bg-color').addEventListener('change', function() { MapEngine.setBgColor(this.value); });
    _el('setting-range-color').addEventListener('change', function() { MapEngine.setRangeColor(this.value); });
    _el('setting-cell-size').addEventListener('change', function() { MapEngine.setCellSize(parseInt(this.value)||50); });

    // 提供商切换
    _el('setting-provider').addEventListener('change', function() {
      var v = this.value;
      _el('provider-gpt').style.display = v === 'gpt' ? 'block' : 'none';
      _el('provider-custom').style.display = v === 'custom' ? 'block' : 'none';
      AIClient.setActiveProvider(v);
    });

    // Key显示/隐藏
    _el('btn-toggle-gpt-key').addEventListener('click', function() {
      var inp = _el('setting-gpt-key');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    _el('btn-toggle-custom-key').addEventListener('click', function() {
      var inp = _el('setting-custom-key');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // 测试连接按钮
    _el('btn-test-gpt').addEventListener('click', function() { testConnection('gpt'); });
    _el('btn-test-custom').addEventListener('click', function() { testConnection('custom'); });

    // 刷新模型列表按钮
    _el('btn-refresh-gpt-models').addEventListener('click', function() { fetchModels('gpt'); });
    _el('btn-refresh-custom-models').addEventListener('click', function() { fetchModels('custom'); });

    // 手动输入优先；选择列表模型时清空手动框
    _el('setting-custom-model-input').addEventListener('input', function() {
      if (this.value.trim()) _el('setting-custom-model-select').value = '';
    });
    _el('setting-custom-model-select').addEventListener('change', function() {
      if (this.value) _el('setting-custom-model-input').value = '';
    });

    // 保存配置：本地界面与后端调用配置同时更新
    _el('btn-save-ai-config').addEventListener('click', async function() {
      _settings.provider = _el('setting-provider').value;
      _settings.aiEnabled = _el('setting-ai-enabled').checked;
      var gmAi = _el('setting-gm-ai-chat-enabled');
      if (gmAi && isGMUser()) _settings.aiChatEnabled = gmAi.checked;
      if (!_settings.aiChatEnabled) _settings.aiQuickMode = false;
      _settings.aiMode = _el('setting-ai-mode').value;
      var gptKeyInput = _el('setting-gpt-key').value.trim();
      _settings.gptKey = gptKeyInput || (_settings.gptKeySet ? '***已设置***' : '');
      _settings.gptModel = _el('setting-gpt-model').value;
      _settings.customEndpoint = _el('setting-custom-endpoint').value.trim();
      var customKeyInput = _el('setting-custom-key').value.trim();
      _settings.customKey = customKeyInput || (_settings.customKeySet ? '***已设置***' : '');
      _settings.customModel = _el('setting-custom-model-input').value.trim()
        || _el('setting-custom-model-select').value;
      _settings.compactTurns = parseInt(_el('setting-compact-turns').value) || 15;
      _settings.reasoningEffort = _el('setting-reasoning-effort').value || 'high';
      // 应用AI上下文整理间隔
      if (AIClient && typeof AIClient.setCompactTurns === 'function') AIClient.setCompactTurns(_settings.compactTurns);
      _saveSettings();
      updateAIControls();

      AIClient.setServerUrl(getServerUrl());
      AIClient.setActiveProvider(_settings.provider);

      var config = {
        ai: {
          activeProvider: _settings.provider,
          reasoningEffort: _settings.reasoningEffort,
          providers: {
            gpt: {
              name: 'GPT',
              endpoint: 'https://api.openai.com/v1/chat/completions',
              apiKey: _settings.gptKey,
              model: _settings.gptModel,
              enabled: _settings.aiEnabled && _settings.provider === 'gpt'
            },
            custom: {
              name: '自定义API',
              endpoint: _settings.customEndpoint,
              apiKey: _settings.customKey,
              model: _settings.customModel,
              enabled: _settings.aiEnabled && _settings.provider === 'custom'
            }
          }
        }
      };

      var saved = await AIClient.saveConfig(config);
      if (saved) {
        addChatMessage('system', '设置', 'AI配置已保存并应用');
      } else {
        addChatMessage('system', '设置', '后端未连接，AI配置保存失败');
      }
    });

    // 数据管理
    _el('btn-export-data').addEventListener('click', exportAllData);
    _el('btn-import-data').addEventListener('click', function() { _el('import-file-input').click(); });
    _el('import-file-input').addEventListener('change', importAllData);
    _el('btn-reset-all').addEventListener('click', function() {
      if (!confirm('确定要重置全部数据吗？此操作不可撤销。')) return;
      MapEngine.clearTokens();
      _chatHistory = [];
      try { localStorage.removeItem(CHAT_LOG_KEY); } catch (e) {}
      var cm = _el('chat-messages'); if (cm) cm.innerHTML = '';
      refreshCharacterList();
      var de = _el('character-detail'); if (de) de.style.display = 'none';
      AIClient.clearHistory();
      AIClient.clearRolls();
      addChatMessage('system', '重置', '所有数据已重置。');
    });
  }

  function getServerUrl() {
    // 自动检测：如果通过服务器访问则用当前origin，否则用默认
    if (window.location.port && window.location.port !== '5500' && window.location.port !== '8080') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  }

  function getProviderDraft(provider) {
    if (provider === 'gpt') {
      return {
        provider: 'gpt',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: _el('setting-gpt-key').value.trim(),
        model: _el('setting-gpt-model').value
      };
    }
    return {
      provider: 'custom',
      endpoint: _el('setting-custom-endpoint').value.trim(),
      apiKey: _el('setting-custom-key').value.trim(),
      model: _el('setting-custom-model-input').value.trim()
        || _el('setting-custom-model-select').value
    };
  }

  function setProviderStatus(provider, text, state) {
    var statusEl = _el(provider + '-status');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.title = text;
    statusEl.className = 'conn-status ' + state;
  }

  function testConnection(provider) {
    var draft = getProviderDraft(provider);
    setProviderStatus(provider, '检测中...', 'checking');

    if (!draft.endpoint) {
      setProviderStatus(provider, '未填写地址', 'failed');
      return;
    }
    if (provider === 'gpt' && !draft.apiKey) {
      setProviderStatus(provider, '未设置Key', 'failed');
      return;
    }
    if (!draft.model) {
      setProviderStatus(provider, '未选择模型', 'failed');
      return;
    }

    fetch(getServerUrl() + '/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft)
    })
      .then(async function(r) {
        var data = await r.json().catch(function() { return {}; });
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        return data;
      })
      .then(function(d) {
        setProviderStatus(provider, '已连接：' + (d.model || draft.model), 'connected');
      })
      .catch(function(e) {
        setProviderStatus(provider, e.message || '连接失败', 'failed');
      });
  }

  function fillModelSelect(provider, models) {
    var selId = provider === 'gpt' ? 'setting-gpt-model' : 'setting-custom-model-select';
    var sel = _el(selId);
    if (!sel) return;

    var savedModel = provider === 'gpt' ? _settings.gptModel : _settings.customModel;
    var currentModel = getProviderDraft(provider).model || savedModel;
    sel.innerHTML = '';

    if (provider === 'custom') {
      sel.appendChild(new Option('— 手动输入 —', ''));
    }

    models.forEach(function(model) {
      sel.appendChild(new Option(model, model));
    });

    if (currentModel && !models.includes(currentModel)) {
      sel.appendChild(new Option(currentModel + '（当前）', currentModel));
    }
    if (currentModel) sel.value = currentModel;
    if (!sel.value && models.length > 0) sel.value = models[0];

    if (provider === 'custom' && sel.value) {
      _el('setting-custom-model-input').value = '';
    }
  }

  function fetchModels(provider) {
    var draft = getProviderDraft(provider);
    setProviderStatus(provider, '获取中...', 'checking');

    if (!draft.endpoint) {
      setProviderStatus(provider, '未填写地址', 'failed');
      return;
    }
    if (provider === 'gpt' && !draft.apiKey) {
      setProviderStatus(provider, '未设置Key', 'failed');
      return;
    }

    fetch(getServerUrl() + '/api/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft)
    })
      .then(async function(r) {
        var data = await r.json().catch(function() { return {}; });
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        return data;
      })
      .then(function(d) {
        var models = Array.isArray(d.models) ? d.models : [];
        fillModelSelect(provider, models);

        // 地址只填服务根路径时，保存实际探测成功的Chat Completions地址。
        if (provider === 'custom' && d.endpoint) {
          _el('setting-custom-endpoint').value = d.endpoint;
        }

        if (models.length > 0) {
          setProviderStatus(provider, models.length + '个模型', 'connected');
        } else {
          setProviderStatus(provider, '接口未返回模型，可手动输入', 'unchecked');
        }
      })
      .catch(function(e) {
        // 保留手动输入，不再把真实连接错误伪装成“只有手动模式”。
        setProviderStatus(provider, e.message || '获取失败', 'failed');
      });
  }

  // ── 网络/房间 ────────────────────────────────────

  function setupNetwork() {
    Network.connect();

    Network.onRoomCreated = function(data) {
      var disp = _el('room-display');
      if (disp) {
        disp.innerHTML = '<span class="room-code">' + data.code + '</span>';
        disp.className = 'room-info active';
        disp.title = '点击复制房间链接';
      }
      addChatMessage('system', '房间', '房间已创建！码: ' + data.code + '。点击顶部房间码复制链接发给朋友。');
      updateAIControls();
      // 2026-08-06：GM 创建房间后把本地已有角色全量同步到房间（玩家加入即见）
      if (Network.isConnected() && MapEngine.getAllTokens().length) {
        setTimeout(function () { Network.sendTokenSyncAll(); }, 300);
      }
      // 我的名字按钮（GM 名）
      var mn = _el('btn-my-name');
      if (mn) { mn.style.display = ''; mn.textContent = '👤 ' + ((Network.getMyName && Network.getMyName()) || data.myName || '房主'); }
    };

    Network.onRoomJoined = function(data) {
      var disp = _el('room-display');
      if (disp) {
        disp.innerHTML = '<span class="room-code">' + data.code + '</span>';
        disp.className = 'room-info active';
      }
      addChatMessage('system', '房间', '已加入房间: ' + data.code);
      updateAIControls();
      // 2026-08-06：我的名字按钮（玩家名=身份）
      var mn2 = _el('btn-my-name');
      if (mn2) { mn2.style.display = ''; mn2.textContent = '👤 ' + ((Network.getMyName && Network.getMyName()) || data.myName || '未命名'); }
      // 2026-08-05：接入房间自动载入 GM 的开发内容（规则书+插件+界面框架）
      // 本地校验：当前已加载同一规则书且内容未变则跳过（不重复下载）
      if (data.system) {
        if (_selectedRuleSystem === data.system && _currentAdventure === (data.adventure || '默认')) {
          addChatMessage('system', '房间', '规则书「' + data.system + '」已在本地，无需重复载入。');
        } else {
          _selectedRuleSystem = data.system;
          _currentAdventure = data.adventure || '默认';
          try { localStorage.setItem('trpg_current_adventure', _currentAdventure); } catch (e) {}
          _saveLastEntry();
          enterMainInterface();
          addChatMessage('system', '房间', '已载入房主的内容：' + data.system + '（' + _currentAdventure + '）');
        }
      }
    };

    Network.onRoomError = function(msg) {
      alert(msg);
    };

    // 2026-08-05：GM 内容更新 → 玩家端全量重载（本地校验：未变化的文件不重复下载，见 plugins.js 缓存）
    Network.onContentUpdated = function(data) {
      addChatMessage('system', '房间', '房主更新了内容，正在同步最新版本…');
      if (_selectedRuleSystem) {
        // 重新加载插件（带哈希缓存校验）+ 重新应用界面框架
        if (window.PluginRuntime && typeof PluginRuntime.reloadSystemPlugins === 'function') {
          PluginRuntime.reloadSystemPlugins(_selectedRuleSystem);
        }
        applyUiManifest(_selectedRuleSystem);
        refreshRulesList();
        addChatMessage('system', '房间', '内容已同步到最新版本。');
      }
    };

    Network.onPlayersUpdate = function(players, host) {
      var disp = _el('room-display');
      var code = Network.getRoomCode();
      if (disp && code) {
        var count = Object.keys(players).length;
        disp.innerHTML = '<span class="room-code">' + code + '</span><span class="room-url-hint">' + count + '人在线</span>';
        disp.className = 'room-info active';
      }
      // 2026-08-06：联机时显示"我的名字"按钮（玩家名=身份，可改名）
      var mn = _el('btn-my-name');
      if (mn) {
        var my = (Network.getMyName && Network.getMyName()) || '';
        mn.style.display = code ? '' : 'none';
        mn.textContent = '👤 ' + (my || '未命名');
        mn.title = '我的玩家名：' + (my || '未命名') + '（同名进入房间=同一玩家；点击改名）';
      }
      updateAIControls();
    };

    // 2026-08-06：改名（身份变更——旧名创建的角色归属自动转给新名，GM 可再转交）
    var myNameBtn = _el('btn-my-name');
    if (myNameBtn) myNameBtn.addEventListener('click', function() {
      var cur = (Network.getMyName && Network.getMyName()) || '';
      var nn = prompt('你的玩家名（身份标识，同名进入=同一玩家）', cur);
      if (nn === null) return;
      nn = nn.trim();
      if (!nn || nn === cur) return;
      Network.renameMe(nn);
      addChatMessage('system', '房间', '已改名为「' + nn + '」（你创建的角色归属将转给新名字）。');
    });

    Network.onChat = function(data) {
      // 2026-08-06：聊天显示"角色名（玩家名）"
      var sender = (data.characterName && data.characterName !== data.sender)
        ? data.characterName + '（' + (data.sender || '玩家') + '）'
        : (data.sender || '玩家');
      addChatMessage('user', sender, data.text);
    };

    Network.onAIChat = function(data) {
      handleRemoteAIChat(data);
    };

    // 2026-08-05 条目化：远端编辑/撤回同步
    Network.onChatEdited = function(data) { handleRemoteChatEdited(data); };
    Network.onChatRetracted = function(data) { handleRemoteChatRetracted(data); };

    // 2026-08-06 联机权限：服务端拒绝（角色被他人/GM 修改权限拦截）→ 提示 + 回滚本地为合法镜像
    Network.onPermDenied = function(data) {
      addChatMessage('system', '权限', (data && data.message) || '无权限修改该角色（只读）。');
      if (data && data.token) {
        var t = data.token;
        _suppressNet = true;
        try { MapEngine.updateToken(t.id, t); } catch (e) {}
        _suppressNet = false;
        refreshCharacterList();
        writeAllPermSnapshots();
      }
    };
    // 2026-08-06：角色控制权转交广播（GM 转交 owner）
    Network.onTokenUpdated = function(data) {
      if (data && data.id) {
        var t = MapEngine.getTokenById(data.id);
        if (t && data.owner !== undefined) t.owner = data.owner;
        refreshCharacterList();
        writeAllPermSnapshots();
        addChatMessage('system', '权限', (data.by || 'GM') + ' 将角色控制权转交给了「' + (data.owner || '?') + '」');
      }
    };

    Network.onDiceRoll = function(data) {
      var who = data.player || '玩家';
      addChatMessage('dice', '🎲 ' + who, data.expression + ' → **' + data.result.total + '**');
    };

    // 房间按钮
_el('btn-create-room').addEventListener('click', function() {
if (!Network.isConnected()) {
addChatMessage('system', '房间', 'SoloTrpg后端未连接。请运行 start.bat 或 SoloTrpg.exe。');
return;
}
// 2026-08-06：GM 玩家名（房主身份=玩家名；持久于本机，同名重进=同一 GM）
var gmName = prompt('你的玩家名（房主/GM，可在角色面板改名）', (Network.getMyName && Network.getMyName()) || '房主');
if (gmName === null) return;
gmName = (gmName || '').trim() || '房主';
// 2026-08-05：房间绑定 GM 当前规则书+冒险
Network.createRoom(_selectedRuleSystem || '', _currentAdventure || '默认', gmName);
});

    _el('btn-join-room').addEventListener('click', function() {
      // 2026-08-06：预填已有玩家名（玩家名=身份，同名进入=同一玩家）；加载注册表（离线玩家下拉 + 输入匹配）
      var nameEl = _el('join-room-name');
      if (nameEl) {
        var saved = (Network.getMyName && Network.getMyName()) || '';
        if (!nameEl.value) nameEl.value = saved;
      }
      loadPlayerNameOptions();
      openModal('join-room-modal');
    });

    // 2026-08-06：加载玩家名注册表——"当前无人的玩家"下拉 + 输入自动匹配（方便本人重进）
    function loadPlayerNameOptions() {
      fetch(getServerUrl() + '/api/players/names').then(function (r) { return r.json(); })
        .then(function (data) {
          var list = (data && data.players) || [];
          // 输入匹配（datalist）
          var dl = _el('join-room-name-list');
          if (dl) dl.innerHTML = list.map(function (p) { return '<option value="' + _esc(p.name) + '">' + (p.online ? '（在线）' : '（离线可接入）') + '</option>'; }).join('');
          // 离线玩家下拉（当前无人 = 已注册且不在线）
          var off = _el('join-room-offline');
          if (off) {
            var offline = list.filter(function (p) { return !p.online; });
            off.innerHTML = '<option value="">— 选择当前无人的玩家名（本人重进用）—</option>' +
              offline.map(function (p) { return '<option value="' + _esc(p.name) + '">' + _esc(p.name) + '（可接入）</option>'; }).join('');
            if (!offline.length) off.innerHTML = '<option value="">— 暂无离线玩家名（输入新名字创建）—</option>';
          }
        })
        .catch(function () { /* 后端不可用：仅保留自输入 */ });
    }
    // 选择离线玩家 → 填入名字输入框
    var offSel = _el('join-room-offline');
    if (offSel) offSel.addEventListener('change', function() {
      var nameEl = _el('join-room-name');
      if (nameEl && this.value) nameEl.value = this.value;
    });

    _el('btn-join-confirm').addEventListener('click', function() {
      var code = _el('join-room-code').value.trim().toUpperCase();
      var name = _el('join-room-name').value.trim() || '玩家';
      if (!code) return;
      Network.joinRoom(code, name);
      closeModal('join-room-modal');
    });

    _el('btn-join-cancel').addEventListener('click', function() {
      closeModal('join-room-modal');
    });

    // 关闭服务（GUI 无控制台时的退出途径，仅本机生效）
    var shutdownBtn = _el('btn-shutdown-server');
    if (shutdownBtn) shutdownBtn.addEventListener('click', function() {
      if (!confirm('确定要关闭 SoloTrpg 服务并退出吗？')) return;
      fetch(getServerUrl() + '/api/shutdown', { method: 'POST' })
        .then(function(r) { return r.json().catch(function() { return {}; }); })
        .then(function(d) {
          if (d.success) {
            addChatMessage('system', '服务', '服务正在关闭，页面即将失效。');
          } else {
            addChatMessage('system', '服务', '关闭失败：' + (d.error || '未知错误'));
          }
        })
        .catch(function() {
          addChatMessage('system', '服务', '关闭请求失败（服务可能已停止）。');
        });
    });

    // 点击房间码复制链接
    _el('room-display').addEventListener('click', function() {
      var url = Network.getRoomUrl();
      if (!url) return;
      navigator.clipboard.writeText(url).then(function() {
        var orig = _el('room-display').innerHTML;
        _el('room-display').innerHTML = '已复制！';
        setTimeout(function() { _el('room-display').innerHTML = orig; }, 1500);
      }).catch(function() {
        prompt('复制此链接发给朋友：', url);
      });
    });

    // 钩子：标记操作时同步到网络（2026-08-06：角色归属=创建者玩家名；本地预检只读，服务端校验兜底；
    // canEditCharacter/getMyCharacterName/writePermSnapshot 为模块级函数，见角色列表区）
    var _suppressNet = false; // 回滚/远端应用时跳过网络广播

    var origAddToken = MapEngine.addToken;
    MapEngine.addToken = function(opts) {
      var token = origAddToken(opts);
      // 2026-08-06：归属=创建者玩家名；新建角色自动成为"我的角色"
      if (Network.isConnected()) {
        if (!token.owner) token.owner = (Network.getMyName && Network.getMyName()) || '';
        try { localStorage.setItem('trpg_my_character', token.id); } catch (e) {}
        Network.sendTokenAdd(token);
      }
      return token;
    };
    var origRemoveToken = MapEngine.removeToken;
    MapEngine.removeToken = function(id) {
      // 2026-08-06：删除角色本地预检（只读角色不可删；服务端校验兜底）
      if (!_suppressNet && Network.isConnected() && !canEditCharacter(id)) {
        var td = MapEngine.getTokenById(id);
        addChatMessage('system', '权限', '该角色由「' + (td && td.owner ? td.owner : '其他玩家') + '」创建，只有创建者或 GM 可删除（当前为只读）。');
        return;
      }
      origRemoveToken(id);
      if (Network.isConnected() && !_suppressNet) Network.sendTokenRemove(id);
    };
    var origUpdateToken = MapEngine.updateToken;
    MapEngine.updateToken = function(id, updates) {
      if (!_suppressNet && Network.isConnected()) {
        var isMove = (updates && (updates.gridX !== undefined || updates.gridY !== undefined));
        // 数据修改（非地图位置）预检权限：只读角色直接拦截并提示
        if (!isMove) {
          var t0 = MapEngine.getTokenById(id);
          if (t0 && !canEditCharacter(id)) {
            addChatMessage('system', '权限', '该角色由「' + (t0.owner || '其他玩家') + '」创建，只有创建者或 GM 可修改（当前为只读）。');
            return t0;
          }
        }
      }
      var result = origUpdateToken(id, updates);
      if (Network.isConnected() && !_suppressNet) {
        if (updates.gridX !== undefined || updates.gridY !== undefined) {
          Network.sendTokenMove(id, updates.gridX, updates.gridY);
        } else {
          Network.sendTokenUpdate(id, updates);
        }
      }
      return result;
    };
  }

  // 覆写addChatMessage以同步到网络（2026-08-06：聊天携带当前绑定角色名，远端显示"角色名（玩家名）"；骰子走 sendDiceRoll 专用通道）
  var _origAddChat = addChatMessage;
  addChatMessage = function(type, sender, text, channelId) {
    _origAddChat(type, sender, text, channelId);
    if (Network.isConnected() && type !== 'system' && type !== 'ai' && type !== 'dice') {
      Network.sendChat(text, channelId || _activeChannelId || 'story', '', getMyCharacterName());
    }
    if (Network.isConnected() && type === 'ai' && isGMUser()) {
      Network.sendAIChat(text, channelId || _activeChannelId || 'story');
    }
  };

  function exportAllData() {
    var mapState = MapEngine.exportState();
    var data = {
      version: 1,
      timestamp: Date.now(),
      mapState: mapState,
      settings: _settings,
      chatHistory: _chatHistory,
      encounter: _encounter
    };
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'trpg_recode_backup_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    addChatMessage('system', '导出', '数据已导出为JSON文件');
  }

  function importAllData() {
    var fileInput = _el('import-file-input');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);
        if (data.mapState) MapEngine.importState(data.mapState);
        if (data.settings) Object.assign(_settings, data.settings);
        if (data.chatHistory) { _chatHistory = data.chatHistory; renderChatMessages(); }
        if (data.encounter) { _encounter = data.encounter; }
        _saveSettings();
        refreshCharacterList();
        renderInitiativeList();
        addChatMessage('system', '导入', '数据已从JSON文件导入');
      } catch(err) {
        addChatMessage('system', '错误', '导入失败：文件格式无效');
      }
    };
    reader.readAsText(fileInput.files[0]);
    fileInput.value = '';
  }

  // ── 检定工具 ──────────────────────────────────

  var checkItems = [];

  function setupCheckTool() {
    // 2026-08-05 引擎化：检定工具入口已迁移到 GM 面板（规则书 ui/panels/gm.html，经 parent.UIManager.openDiceModal 调用）；
    // 宿主仅保留模态框本体逻辑，入口按钮绑定做 null 安全（旧布局残留时仍可用）
    var btn = _el('btn-check-tool');
    if (btn) btn.addEventListener('click', function() {
      openModal('check-modal');
      if (checkItems.length === 0) addCheckItem(); // 默认加一个空项
    });
    var addBtn = _el('btn-add-check'); if (addBtn) addBtn.addEventListener('click', addCheckItem);
    var closeBtn = _el('btn-check-close'); if (closeBtn) closeBtn.addEventListener('click', function() { closeModal('check-modal'); });
    var sendBtn = _el('btn-check-send-ai'); if (sendBtn) sendBtn.addEventListener('click', sendChecksToAI);
  }

  function addCheckItem() {
    var name = _el('check-name').value.trim() || '检定 ' + (checkItems.length + 1);
    var dice = _el('check-dice').value.trim() || '1d20';
    var dc = parseInt(_el('check-dc').value) || null;
    var info = _el('check-info').value.trim();

    checkItems.push({ name: name, dice: dice, dc: dc, info: info, result: null, done: false });

    _el('check-name').value = '';
    _el('check-dice').value = '';
    _el('check-dc').value = '';
    _el('check-info').value = '';
    _el('check-name').focus();
    renderCheckList();
  }

  function renderCheckList() {
    var list = _el('check-list');
    if (!list) return;
    if (checkItems.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:16px;">暂无检定项</div>';
      _el('btn-check-send-ai').style.display = 'none';
      return;
    }
    var html = '';
    var allDone = true;
    checkItems.forEach(function(item, i) {
      var doneClass = item.done ? ' done' : '';
      var resultHtml = '';
      if (item.done && item.result) {
        var failClass = item.dc && item.result.total < item.dc ? ' fail' : '';
        resultHtml = '<span class="check-result' + failClass + '">' + item.result.total;
        if (item.dc) resultHtml += ' / DC ' + item.dc + (item.result.total >= item.dc ? ' ✓' : ' ✗');
        resultHtml += '</span>';
      } else {
        allDone = false;
      }
      html += '<div class="check-item' + doneClass + '">';
      html += '<span class="check-label">' + _esc(item.name) + '</span>';
      html += '<span class="check-info">' + _esc(item.dice) + '</span>';
      if (item.info) html += '<span class="check-enemy-info">' + _esc(item.info) + '</span>';
      if (!item.done) {
        html += '<button class="btn-small" onclick="window._doCheckRoll(' + i + ')">🎲 掷骰</button>';
      }
      html += resultHtml;
      html += '<button class="check-remove" onclick="window._removeCheck(' + i + ')">✕</button>';
      html += '</div>';
    });
    list.innerHTML = html;
    _el('btn-check-send-ai').style.display = allDone ? 'inline-block' : 'none';
  }

  // 暴露到全局（因为onclick需要）
  window._doCheckRoll = function(i) {
    var item = checkItems[i];
    if (!item || item.done) return;
    var result = DiceSystem.smartRoll(item.dice);
    if (result) {
      item.result = result;
      item.done = true;
      renderCheckList();
    }
  };
  window._removeCheck = function(i) {
    checkItems.splice(i, 1);
    renderCheckList();
  };

  function sendChecksToAI() {
    var allDone = checkItems.every(function(c) { return c.done; });
    if (!allDone) { addChatMessage('system', '检定', '还有检定未完成'); return; }

    var summary = '检定结果汇总：\n';
    checkItems.forEach(function(c) {
      summary += c.name + ': ' + c.dice + ' → ' + c.result.total;
      if (c.dc) summary += ' (DC' + c.dc + (c.result.total >= c.dc ? ' 成功' : ' 失败') + ')';
      if (c.info) summary += ' [信息: ' + c.info + ']';
      summary += '\n';
    });

    addChatMessage('system', '检定', summary);
    if (_settings.aiEnabled) {
      sendToAI(summary);
    }

    checkItems = [];
    renderCheckList();
    closeModal('check-modal');
  }

  function onMapTokenSelected(token) {
    if (token) {
      var rightTab = document.querySelector('.panel-tab[data-tab="characters"]');
      if (rightTab && typeof rightTab.click === 'function') rightTab.click();
      selectCharacter(token.id);
    } else {
      _lastDetailTokenId = null;
      var le = _el('character-list'); if (le) le.querySelectorAll('.character-list-item').forEach(function(i) { i.classList.remove('selected'); });
    }
  }

  function onMapCoordUpdate(gx, gy) {
    var cd = _el('coord-display');
    if (cd) cd.innerHTML = 'X: ' + Math.round(gx) + ' &nbsp; Y: ' + Math.round(gy);
  }

  // ── AVG 双人立绘舞台（2026-08-05 全站重构）──
  // 规则：开始对话的角色出现在左侧，第二个不同角色出现在右侧；
  // 当前发言者立绘正常高亮，另一方压暗（filter: brightness）；<portrait clear> 清空舞台。
  // 频道需标记 avg（剧情频道默认开启；创建频道时可勾选"显示发言立绘"）。
  var _avgStage = { left: null, right: null, speaking: null }; // 每个: { name, url, color }

  // 当前频道是否启用 AVG 立绘
  function avgEnabledFor(channelId) {
    var ch = _chatChannels.find(function (c) { return c.id === (channelId || _activeChannelId); });
    return !!(ch && ch.avg);
  }

  function extractPortraitDirective(text) {
    var s = String(text || '');
    // 独立闭合标签 </portrait> = 关闭立绘（无正文）
    if (/<\/portrait>/i.test(s) && !/<portrait\b[^>]*name=/i.test(s)) {
      var cleanClose = s.replace(/<portrait\b[^>]*>/gi, '').replace(/<\/portrait>/gi, '').trim();
      return { clear: true, name: '', text: cleanClose };
    }
    var m = s.match(/<portrait\b([^>]*)>/i);
    if (!m) return null;
    var attrs = m[1] || '';
    var clear = /clear/i.test(attrs);
    var name = '';
    var nm = attrs.match(/name=["']([^"']+)["']/i);
    if (nm) name = nm[1].trim();
    var clean = s.replace(/<portrait\b[^>]*>/gi, '').replace(/<\/portrait>/gi, '').trim();
    return { clear: clear, name: name, text: clean };
  }

  // 按角色名在当前角色卡中找到立绘/头像源（精确匹配 → 包含匹配）
  function findPortraitSource(name) {
    var tokens = MapEngine.getAllTokens() || [];
    var t = null;
    for (var i = 0; i < tokens.length; i++) {
      var n = tokens[i].displayName || tokens[i].name || '';
      if (n === name) { t = tokens[i]; break; }
    }
    if (!t) {
      for (var j = 0; j < tokens.length; j++) {
        var n2 = tokens[j].displayName || tokens[j].name || '';
        if ((n2 && name && n2.indexOf(name) >= 0) || (n2 && name && name.indexOf(n2) >= 0)) { t = tokens[j]; break; }
      }
    }
    if (!t) return null;
    var d = t.data || {};
    var assets = d.assets || {};
    var url = assets.portrait || assets.avatarFramed || assets.avatar || t.avatarUrl || '';
    return { token: t, url: url, color: t.color || '#4ecdc4' };
  }

  // 解析角色立绘源（含查找失败时的占位）→ { name, url, color }
  function resolvePortraitActor(name) {
    var src = findPortraitSource(name);
    if (src) return { name: src.token.displayName || src.token.name || name, url: src.url, color: src.color };
    return { name: name || '？', url: '', color: '#4ecdc4' };
  }

  // 把某角色设为当前发言者：上舞台（左空→左；右空→右；已有→原位）+ 高亮
  function stageSpeak(actor) {
    if (!actor || !actor.name) return;
    var hasLeft = _avgStage.left && _avgStage.left.name === actor.name;
    var hasRight = _avgStage.right && _avgStage.right.name === actor.name;
    if (!hasLeft && !hasRight) {
      if (!_avgStage.left) _avgStage.left = actor;
      else if (!_avgStage.right) _avgStage.right = actor;
      else {
        // 两人已满：新发言者替换"非当前发言"侧（保持一人常驻一侧的 AVG 惯例）
        if (_avgStage.speaking && _avgStage.speaking.name === _avgStage.left.name) _avgStage.right = actor;
        else _avgStage.left = actor;
      }
    }
    _avgStage.speaking = actor;
  }

  // 舞台横条（聊天区顶部常驻：展示当前对话双方 + 当前发言高亮）
  function renderAvgStageBar() {
    var bar = _el('avg-stage-bar');
    if (!bar) return;
    if (!avgEnabledFor(_activeChannelId) || (!_avgStage.left && !_avgStage.right)) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }
    bar.style.display = 'flex';
    var html = '<span class="avg-bar-label">🎭 对话</span>';
    [_avgStage.left, _avgStage.right].forEach(function (a) {
      if (!a) return;
      var spk = _avgStage.speaking && _avgStage.speaking.name === a.name;
      html += '<span class="avg-bar-token' + (spk ? ' speaking' : ' dim') + '" title="' + _esc(a.name) + (spk ? '（正在发言）' : '') + '">' +
        (a.url ? '<img src="' + _esc(a.url) + '">' : '<span class="ph" style="background:' + _esc(a.color) + '">' + _esc(a.name.charAt(0)) + '</span>') +
        _esc(a.name) + '</span>';
    });
    html += '<button type="button" class="avg-bar-clear" title="关闭立绘舞台">✕ 关闭</button>';
    bar.innerHTML = html;
    var clearBtn = bar.querySelector('.avg-bar-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { _avgStage = { left: null, right: null, speaking: null }; renderAvgStageBar(); });
  }

  // 渲染单条 AVG 消息：双人舞台 + 文本（stage 参数 = 该消息时刻的舞台快照，历史回看时传入）
  function renderAVGMessage(cont, msg, avg, stageSnapshot) {
    var div = document.createElement('div');
    div.className = 'chat-message ai avg-msg';
    if (avg.clear) {
      _avgStage = { left: null, right: null, speaking: null };
      renderAvgStageBar();
      div.innerHTML = '<span class="msg-time">' + _esc(msg.time) + '</span><span class="msg-sender">AI:</span><span class="msg-text">' + simpleMarkdown(avg.text || '（立绘已关闭）') + '</span>';
      cont.appendChild(div);
      return;
    }
    // 更新舞台：发言角色（仅实时消息更新全局舞台；历史快照渲染不改全局）
    if (avg.name) {
      var actor = resolvePortraitActor(avg.name);
      if (!stageSnapshot) {
        stageSpeak(actor);
        renderAvgStageBar();
      }
    }
    var stage = stageSnapshot || { left: _avgStage.left, right: _avgStage.right, speaking: _avgStage.speaking };
    var p = stage.speaking;
    var displayName = p ? p.name : (avg.name || 'AI');
    // 双人舞台：左/右立绘，发言者高亮，另一方压暗
    var stageHtml = '';
    var sides = [{ k: 'left', v: stage.left }, { k: 'right', v: stage.right }];
    var visible = sides.filter(function (s) { return s.v; });
    if (visible.length) {
      stageHtml = '<div class="avg-stage' + (visible.length === 1 ? ' single' : '') + '">' +
        visible.map(function (s) {
          var a = s.v;
          var spk = stage.speaking && stage.speaking.name === a.name;
          var inner = a.url
            ? '<img src="' + _esc(a.url) + '" alt="' + _esc(a.name) + '">'
            : '<div class="avg-portrait avg-portrait-placeholder" style="background:' + _esc(a.color) + '"><div class="avg-placeholder-char">' + _esc((a.name || '?').charAt(0)) + '</div></div>';
          return '<div class="avg-portrait' + (spk ? ' speaking' : '') + '" title="' + _esc(a.name) + (spk ? '（正在发言）' : '') + '">' + inner +
            '<div class="avg-portrait-name">' + _esc(a.name) + '</div></div>';
        }).join('') + '</div>';
    }
    div.innerHTML = stageHtml +
      '<div class="avg-text"><span class="msg-time">' + _esc(msg.time) + '</span><span class="msg-sender">' + _esc(displayName) + ':</span><span class="msg-text">' + simpleMarkdown(avg.text) + '</span></div>';
    cont.appendChild(div);
  }

  // ── 插图系统（2026-08-05）：GM/AI 以插图临时代替地图（过场/无需移动的场景）──
  // AI 指令：<illustration src="URL或模组路径" caption="标题">...</illustration> 或 <illustration clear>
  // GM 工具：UIManager.showIllustration(url, caption) / hideIllustration()
  function showIllustration(url, caption) {
    try {
      hideIllustration();
      var ov = document.createElement('div');
      ov.id = 'illustration-overlay';
      ov.className = 'illustration-overlay';
      var src = String(url || '').trim();
      // 模组路径自动转资源 URL（module: 前缀 → /api/module/file）
      if (src.indexOf('module:') === 0) {
        src = '/api/module/file?system=' + encodeURIComponent(_selectedRuleSystem || '') + '&path=' + encodeURIComponent(src.slice(7).replace(/^\/+/, ''));
      }
      ov.innerHTML = '<button type="button" class="ill-close">⏹ 结束插图（恢复地图）</button>' +
        '<img src="' + _esc(src) + '" alt="插图" onerror="this.outerHTML=\'<div style=&quot;color:#ff7b7b;padding:20px;&quot;>插图加载失败：' + _esc(src) + '</div>\'">' +
        (caption ? '<div class="ill-caption">' + _esc(caption) + '</div>' : '');
      ov.addEventListener('click', function (e) {
        if (e.target === ov || e.target.classList.contains('ill-close')) hideIllustration();
      });
      document.body.appendChild(ov);
      // 地图作为最底层暂时隐藏（插图层 z-index 15 已盖住；再隐藏地图本体避免透出）
      var mc = _el('map-container');
      if (mc) mc.classList.add('map-hidden');
      addChatMessage('system', 'GM', '📖 已展示插图' + (caption ? '：' + caption : ''));
    } catch (e) { /* 静默 */ }
  }
  function hideIllustration() {
    var ov = document.getElementById('illustration-overlay');
    if (ov) ov.remove();
    var mc = _el('map-container');
    if (mc) mc.classList.remove('map-hidden');
  }
  function extractIllustrationDirective(text) {
    var s = String(text || '');
    // 完整块优先：<illustration src="..." caption="...">正文</illustration>
    var m = s.match(/<illustration\b([^>]*)>([\s\S]*?)<\/illustration>/i);
    if (m) {
      var attrs = m[1] || '';
      var src = attrs.match(/src=["']([^"']+)["']/i);
      var cap = attrs.match(/caption=["']([^"']+)["']/i);
      return {
        clear: /clear/i.test(attrs),
        url: src ? src[1].trim() : String(m[2] || '').trim(),
        caption: cap ? cap[1].trim() : ''
      };
    }
    // 独立 clear 指令
    if (/<illustration\s+clear\s*\/?>/i.test(s) || /<\/illustration>/i.test(s)) {
      return { clear: true, url: '', caption: '' };
    }
    return null;
  }
  function stripIllustrationTags(text) {
    return String(text || '').replace(/<illustration\b[^>]*>[\s\S]*?<\/illustration>/gi, '').replace(/<illustration\s+clear\s*\/?>/gi, '');
  }

  function simpleMarkdown(text) {
    if (!text) return '';
    var html = _esc(text);
    // ── GM标记渲染层（AI输出标记→宿主渲染精美界面，对标SillyTavern正则自动卡） ──
    // 1) <dice> 检定卡片（6行固定字段：发动技能/目标/情境/检定细节/判定结果/结果描述）
    html = html.replace(/&lt;dice&gt;([\s\S]*?)&lt;\/dice&gt;/gi, function(m, body) {
      return renderDiceCard(body);
    });
    // 2) <battlecheck> 战斗卡片（7行固定字段：发动者/目标/行动/检定类型/检定细节/判定结果/战果描述）
    html = html.replace(/&lt;battlecheck&gt;([\s\S]*?)&lt;\/battlecheck&gt;/gi, function(m, body) {
      return renderBattleCheckCard(body);
    });
    // 3) <char_info> 角色档案卡片（YAML）
    html = html.replace(/&lt;char_info&gt;([\s\S]*?)&lt;\/char_info&gt;/gi, function(m, body) {
      return renderCharInfoCard(body);
    });
    // 4) <UpdateVariable> 数据更新折叠卡片（解析 JSONPatch 并实际写入角色数据）
    html = html.replace(/&lt;UpdateVariable&gt;([\s\S]*?)&lt;\/UpdateVariable&gt;/gi, function(m, body) {
      return renderUpdateVariableCard(body);
    });
    // 5) <battle> 战斗地图原始块（隐藏元数据，显示时保持纯文本）
    html = html.replace(/&lt;battle&gt;([\s\S]*?)&lt;\/battle&gt;/gi, function(m, body) {
      return '<details class="gm-update-details" style="width:80%;margin:10px auto;"><summary class="gm-update-summary">🗺️ 战斗地图 <small style="margin-left:auto;font-size:.85em;color:#999;">点击查看/隐藏 ▼</small></summary><div class="gm-update-content">' + body + '</div></details>';
    });
    // 6) charGenerationThink 隐藏注释（不显示）
    html = html.replace(/&lt;!--\s*charGenerationThink:[\s\S]*?--&gt;/g, '');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 2026-08-05：图片语法 ![alt](url) → <img>（AI 引用模组/规则资源时动态加载显示，如 /api/module/file?...）
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:6px 0;" loading="lazy">');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ── <UpdateVariable> 数据回写：解析 JSONPatch 并实际应用（RFC6902）──
  // 反转义 <UpdateVariable> 块内的 HTML 实体，还原原始 JSON
  function _unescapeXml(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
  // 解析 JSONPatch（容错：容忍前后空白、Markdown 代码块围栏、多余逗号）
  function _parseJsonPatch(str) {
    str = String(str || '').trim();
    str = str.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    str = str.replace(/,\s*([\]}])/g, '$1'); // 容忍尾逗号
    var arr = null;
    try { arr = JSON.parse(str); } catch (e1) { /* 首次失败 */ }
    if (!Array.isArray(arr)) {
      // 可能被 <Analysis> 与 JSONPatch 混在一起：提取首个 [ ... ] 数组
      var m = str.match(/\[[\s\S]*\]/);
      if (m) { try { arr = JSON.parse(m[0].replace(/,\s*([\]}])/g, '$1')); } catch (e2) { arr = null; } }
    }
    return Array.isArray(arr) ? arr : null;
  }
  // RFC6902 指针求值：/a/b/c → 逐层取字段（含数组下标）
  function _resolvePointer(root, path) {
    if (!path) return { found: true, parent: null, key: null, value: root };
    if (path === '/') return { found: true, parent: null, key: null, value: root };
    var parts = path.replace(/^\//, '').split('/').map(function(p) { return p.replace(/~1/g, '/').replace(/~0/g, '~'); });
    var cur = root, parent = null, key = null;
    for (var i = 0; i < parts.length; i++) {
      var k = parts[i];
      if (cur == null || typeof cur !== 'object' || !(k in cur)) {
        return { found: false, parent: parent, key: key, value: undefined };
      }
      parent = cur; key = k; cur = cur[k];
    }
    return { found: true, parent: parent, key: key, value: cur };
  }
  // 对 obj 应用单个 patch 操作（支持 replace/delta/insert/remove/move，RFC6902）
  function _applyPatchOp(obj, op) {
    if (!op || typeof op !== 'object') return { ok: false, reason: '无效操作' };
    var o = String(op.op || '').toLowerCase();
    var path = String(op.path || '');
    if (!path) return { ok: false, reason: '缺少path' };
    if (path.split('/').some(function(p) { return /^_/.test(p); })) {
      return { ok: false, reason: '_开头字段只读，拒绝修改 ' + path };
    }
    var keys = path.replace(/^\//, '').split('/').filter(Boolean).map(function(p) { return p.replace(/~1/g, '/').replace(/~0/g, '~'); });
    if (keys.length === 0) return { ok: false, reason: '无效路径' };
    if (o === 'move') return _movePatchOp(obj, op);
    if (o === 'remove') {
      if (keys.length === 1) { delete obj[keys[0]]; return { ok: true }; }
      var cur = obj;
      for (var i = 0; i < keys.length - 1; i++) {
        if (cur == null || typeof cur !== 'object' || cur[keys[i]] == null) return { ok: false, reason: 'remove 目标不存在: ' + path };
        cur = cur[keys[i]];
      }
      var rk = keys[keys.length - 1];
      if (Array.isArray(cur)) cur.splice(Number(rk), 1);
      else delete cur[rk];
      return { ok: true };
    }
    // replace / delta / insert：定位父容器（自动创建中间对象，容错 AI 写新字段）
    var cur2 = obj;
    for (var j = 0; j < keys.length - 1; j++) {
      if (cur2[keys[j]] == null || typeof cur2[keys[j]] !== 'object') cur2[keys[j]] = {};
      cur2 = cur2[keys[j]];
    }
    var last = keys[keys.length - 1];
    if (o === 'replace') { cur2[last] = op.value; return { ok: true }; }
    if (o === 'delta') {
      var base = cur2[last];
      if (typeof base !== 'number' && base !== undefined && base !== null && isNaN(Number(base))) {
        return { ok: false, reason: 'delta 目标不是数字: ' + path };
      }
      cur2[last] = (Number(base) || 0) + (Number(op.value) || 0);
      return { ok: true, delta: true };
    }
    if (o === 'insert') {
      if (Array.isArray(cur2[last])) cur2[last].push(op.value);
      else cur2[last] = op.value;
      return { ok: true };
    }
    return { ok: false, reason: '不支持的操作: ' + o };
  }

  // RFC6902 move：from=源路径，path=目标路径
  function _movePatchOp(obj, op) {
    var from = String(op.from || '').replace(/^\//, '').split('/').filter(Boolean).map(function(p) { return p.replace(/~1/g, '/').replace(/~0/g, '~'); });
    if (from.length === 0) return { ok: false, reason: 'move 缺少from' };
    if (from.some(function(p) { return /^_/.test(p); })) return { ok: false, reason: '_开头字段只读' };
    var cur = obj;
    for (var i = 0; i < from.length - 1; i++) {
      if (cur == null || typeof cur !== 'object' || cur[from[i]] == null) return { ok: false, reason: 'move 源不存在: ' + op.from };
      cur = cur[from[i]];
    }
    var srcKey = from[from.length - 1];
    if (cur == null || typeof cur !== 'object' || !(srcKey in cur)) return { ok: false, reason: 'move 源不存在: ' + op.from };
    var val = cur[srcKey];
    if (Array.isArray(cur)) cur.splice(Number(srcKey), 1);
    else delete cur[srcKey];
    // 写入目标 path
    var path = String(op.path || '');
    if (!path) return { ok: false, reason: 'move 缺少目标path' };
    var toKeys = path.replace(/^\//, '').split('/').filter(Boolean).map(function(p) { return p.replace(/~1/g, '/').replace(/~0/g, '~'); });
    if (toKeys.length === 0) { obj = val; return { ok: true }; }
    var c2 = obj;
    for (var j = 0; j < toKeys.length - 1; j++) {
      if (c2[toKeys[j]] == null || typeof c2[toKeys[j]] !== 'object') c2[toKeys[j]] = {};
      c2 = c2[toKeys[j]];
    }
    var toKey = toKeys[toKeys.length - 1];
    if (Array.isArray(c2[toKey])) c2[toKey].push(val);
    else c2[toKey] = val;
    return { ok: true };
  }

  // 提取 <UpdateVariable> 块内的 JSONPatch 数组并应用
  function applyUpdateVariable(body, token) {
    if (!token || !token.data) return { applied: 0, ops: [], errors: [] };
    var raw = _unescapeXml(body);
    // 提取 Analysis（英文）与 JSONPatch 数组
    var analysis = '';
    var am = raw.match(/<Analysis>([\s\S]*?)<\/Analysis>/i);
    if (am) analysis = am[1].trim();
    var patchStr = '';
    var pm = raw.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/i);
    if (pm) patchStr = pm[1];
    else {
      var arrM = raw.match(/\[[\s\S]*\]/);
      if (arrM) patchStr = arrM[0];
    }
    var ops = _parseJsonPatch(patchStr);
    if (!ops) return { applied: 0, ops: [], errors: ['无法解析 JSONPatch'] };
    // 防重复应用：同一 JSONPatch 指纹只应用一次（历史消息重渲染时跳过）
    var fingerprint = JSON.stringify(ops);
    if (!token.data.__patchSeen) token.data.__patchSeen = [];
    if (token.data.__patchSeen.indexOf(fingerprint) !== -1) {
      return { applied: 0, ops: ops, errors: [], analysis: analysis, skipped: true };
    }
    var applied = 0, errors = [];
    for (var i = 0; i < ops.length; i++) {
      var res = _applyPatchOp(token.data, ops[i]);
      if (res.ok) applied++;
      else errors.push((ops[i].op || '?') + ' ' + (ops[i].path || '') + ': ' + res.reason);
    }
    if (applied > 0) token.data.__patchSeen.push(fingerprint);
    return { applied: applied, ops: ops, errors: errors, analysis: analysis };
  }

  // 渲染 <UpdateVariable> 卡片 + 应用数据
  function renderUpdateVariableCard(body) {
    // 先尝试应用（即使渲染失败也尝试数据更新）
    var targetToken = null;
    if (_lastDetailTokenId) targetToken = MapEngine.getTokenById(_lastDetailTokenId);
    var result = null;
    if (targetToken) {
      result = applyUpdateVariable(body, targetToken);
      if (result && result.applied > 0) {
        // 已实际修改 token.data —— 持久化 + 刷新 UI + 广播
        persistCharacters();
        MapEngine.updateToken(targetToken.id, { data: targetToken.data });
        if (_lastDetailTokenId) {
          try { showCharacterDetail(_lastDetailTokenId); } catch (e) {}
        }
      }
    } else {
      // 无当前选中角色：尝试从 token 集合中找第一个
      var all = MapEngine.getAllTokens();
      if (all && all.length === 1) {
        targetToken = all[0];
        result = applyUpdateVariable(body, targetToken);
        if (result && result.applied > 0) {
          persistCharacters(); MapEngine.updateToken(targetToken.id, { data: targetToken.data });
        }
      }
    }
    // 渲染折叠卡片
    var card = '<div class="gm-update-card"><details class="gm-update-details"><summary class="gm-update-summary">📊 数据更新';
    if (result) card += ' <span class="gm-update-badge">' + (result.skipped ? '已应用过' : ('已应用 ' + result.applied + ' 项')) + '</span>';
    card += ' <small style="margin-left:auto;font-size:.85em;color:#999;">点击查看/隐藏 ▼</small></summary><div class="gm-update-content">';
    if (result) {
      if (result.skipped) {
        card += '<div style="color:#888;margin-bottom:6px;">⏭ 此数据更新已应用过，未重复写入</div>';
      } else if (result.applied > 0) {
        card += '<div style="color:#7dd87d;margin-bottom:6px;">✓ 已应用 ' + result.applied + ' 项变更</div>';
      }
      if (result.errors && result.errors.length) {
        card += '<div style="color:#ffb86b;margin-bottom:6px;">⚠ ' + _esc(result.errors.join('；')) + '</div>';
      }
      if (result.analysis) card += '<div style="color:#888;font-size:.9em;margin-bottom:6px;">' + _esc(result.analysis) + '</div>';
      if (result.ops && result.ops.length) {
        card += '<pre style="margin:4px 0;padding:8px;background:#1a1d24;border-radius:6px;font-size:.85em;color:#9fe0ff;overflow-x:auto;">' + _esc(JSON.stringify(result.ops, null, 1)) + '</pre>';
      }
    } else {
      card += '<div style="color:#888;">未找到可更新的角色数据</div>';
    }
    card += '</div></details></div>';
    return card;
  }

  // 解析 <dice> 6行固定字段（字段名可中英：发动技能/目标/情境/检定细节/判定结果/结果描述）
  function parseFixedFields(body, fieldNames) {
    var obj = {};
    var cur = null;
    var lines = String(body || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^&gt;\s*/, '').replace(/^>\s*/, '').trim();
      if (!line) continue;
      var matched = false;
      for (var j = 0; j < fieldNames.length; j++) {
        var re = new RegExp('^(?:' + fieldNames[j] + ')\\s*[:：]\\s*([\\s\\S]*)$');
        var m = line.match(re);
        if (m) {
          obj[fieldNames[j]] = m[1].trim();
          cur = fieldNames[j];
          matched = true;
          break;
        }
      }
      if (!matched && cur && obj[cur]) {
        obj[cur] += '\n' + line;
      }
    }
    return obj;
  }

  // 判定结果着色
  function diceResultClass(result) {
    if (!result) return 'gm-result-neutral';
    if (/大成功|Critical Success|Nat ?20/i.test(result)) return 'gm-result-crit';
    if (/大失败|Critical Failure|Nat ?1/i.test(result)) return 'gm-result-fail';
    if (/失败|Failure/i.test(result)) return 'gm-result-fail';
    if (/成功|Success/i.test(result)) return 'gm-result-success';
    return 'gm-result-neutral';
  }

  // <dice> 检定卡片渲染
  function renderDiceCard(body) {
    var f = parseFixedFields(body, ['发动技能', '目标', '情境', '检定细节', '判定结果', '结果描述']);
    if (!f['发动技能'] && !f['检定细节']) return '<div class="gm-card"><div class="gm-card-body">' + body + '</div></div>';
    var result = f['判定结果'] || '';
    var cls = diceResultClass(result);
    var headerRight = result ? '<span class="gm-result-tag ' + cls + '">' + result + '</span>' : '';
    var html = '<div class="gm-card"><div class="gm-card-header"><span>🎲 判定' + (f['发动技能'] ? '：' + f['发动技能'] : '') + '</span>' + (f['目标'] ? '<span>目标：' + f['目标'] + '</span>' : '') + headerRight + '</div><div class="gm-card-body">';
    if (f['情境']) html += '<div><span class="gm-card-label">情境：</span>' + f['情境'] + '</div>';
    if (f['检定细节']) html += '<div class="gm-card-detail">' + f['检定细节'] + '</div>';
    if (f['结果描述']) html += '<div class="gm-card-desc">' + f['结果描述'] + '</div>';
    html += '</div></div>';
    return html;
  }

  // <battlecheck> 战斗卡片渲染
  function renderBattleCheckCard(body) {
    var f = parseFixedFields(body, ['发动者', '目标', '行动', '检定类型', '检定细节', '判定结果', '战果描述']);
    if (!f['行动'] && !f['检定细节']) return '<div class="gm-card"><div class="gm-card-body">' + body + '</div></div>';
    var result = f['判定结果'] || '';
    var cls = diceResultClass(result);
    var headerRight = result ? '<span class="gm-result-tag ' + cls + '">' + result + '</span>' : '';
    var html = '<div class="gm-card"><div class="gm-card-header"><span>⚔️ ' + (f['行动'] || '战斗结算') + '</span>' + (f['目标'] ? '<span>目标：' + f['目标'] + '</span>' : '') + headerRight + '</div><div class="gm-card-body">';
    if (f['发动者']) html += '<div><span class="gm-card-label">发动者：</span>' + f['发动者'] + '</div>';
    if (f['检定类型']) html += '<div><span class="gm-card-label">检定类型：</span>' + f['检定类型'] + '</div>';
    if (f['检定细节']) html += '<div class="gm-card-detail">' + f['检定细节'] + '</div>';
    if (f['战果描述']) html += '<div class="gm-card-desc">' + f['战果描述'] + '</div>';
    html += '</div></div>';
    return html;
  }

  // <char_info> YAML角色档案卡片渲染
  function renderCharInfoCard(body) {
    var lines = String(body || '').split(/\r?\n/);
    var html = '<div class="gm-char-card"><div class="gm-char-header"><span class="gm-char-name">🗡️ 角色档案</span></div><div class="gm-char-body">';
    var sectionTitle = null;
    var sectionOpen = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s*\|/, '').replace(/\s+$/, '');
      if (!line.trim()) continue;
      var m = line.match(/^(\s*)([^:：]+)\s*[:：]\s*(.*)$/);
      if (m) {
        var indent = m[1].length;
        var key = m[2].trim();
        var val = m[3].trim();
        if (indent === 0) {
          if (sectionOpen) html += '</div>';
          html += '<div class="gm-char-sec"><div class="gm-char-sec-title">' + key + '</div>';
          sectionTitle = key;
          sectionOpen = true;
          if (val) html += '<div class="gm-char-line">' + val + '</div>';
        } else if (sectionTitle) {
          if (val) html += '<div class="gm-char-line"><span class="gm-card-label">' + key + '：</span>' + val + '</div>';
          else html += '<div class="gm-char-line" style="font-weight:bold;color:#ddd;">' + key + '</div>';
        }
      } else if (sectionOpen && line.trim()) {
        html += '<div class="gm-char-multi">' + line.trim() + '</div>';
      }
    }
    if (sectionOpen) html += '</div>';
    html += '</div></div>';
    return html;
  }

  return {
    init: init,
    updateToolButtons: updateToolButtons,
    updateZoomLabel: updateZoomLabel,
    updateServerStatus: updateServerStatus,
    sendToAI: sendToAI,
    setupRules: setupRules,
    refreshRulesList: refreshRulesList,
    loadRuleContent: loadRuleContent,
    setupCharacterImport: setupCharacterImport,
    refreshCharacterList: refreshCharacterList,
    selectCharacter: selectCharacter,
    openCharacterSheet: openCharacterSheet,
    showCharacterDetail: showCharacterDetail,
    damageCharacter: damageCharacter,
    healCharacter: healCharacter,
    applyHPChange: applyHPChange,
    openCharacterModal: openCharacterModal,
    openCharacterModalForEdit: openCharacterModalForEdit,
    canEditCharacter: canEditCharacter, // 2026-08-06：联机权限（创建者或 GM 可编辑）
    setMyCharacter: setMyCharacter,
    transferCharacter: transferCharacter,
    saveCharacter: saveCharacter,
    deleteCharacter: deleteCharacter,
    rollAllInitiative: rollAllInitiative,
    nextTurn: nextTurn,
    renderInitiativeList: renderInitiativeList,
    setupModals: setupModals,
    openModal: openModal,
    closeModal: closeModal,
    openRangeModal: openRangeModal,
    applyRange: applyRange,
    rollCustomDice: rollCustomDice,
    openDiceModal: openDiceModal,
    openBgModal: openBgModal,
    applyBackground: applyBackground,
    removeBackground: removeBackground,
    setupSettings: setupSettings,
    exportAllData: exportAllData,
    importAllData: importAllData,
    onMapTokenSelected: onMapTokenSelected,
    onMapCoordUpdate: onMapCoordUpdate,
    addChatMessage: addChatMessage,
    simpleMarkdown: simpleMarkdown,
    // 2026-08-05 全站重构：AVG 舞台与插图系统（GM 面板/规则插件/系统频道 AI 通用）
    showIllustration: showIllustration,
    hideIllustration: hideIllustration,
    renderAvgStageBar: renderAvgStageBar,
    stageSpeak: stageSpeak,
    resolvePortraitActor: resolvePortraitActor,
    avgEnabledFor: avgEnabledFor
  };
})();

if (typeof window !== 'undefined') { window.UIManager = UIManager; }
