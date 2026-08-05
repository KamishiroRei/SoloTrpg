/* ============================================
   TrpgRecode - UI管理模块
   ============================================ */

const UIManager = (() => {
  'use strict';
  console.log('[UI] 模块加载...');

  let _editingCharId = null;
  let _pendingCharacterAssets = null;
  let _imageTool = { image: null, originalDataUrl: '', cropPortrait: null, cropAvatar: null, crop: { x: 110, y: 40, w: 300, h: 225 }, dragging: false, dragOffsetX: 0, dragOffsetY: 0, zoom: 1 };
  let _encounter = { active: false, initiatives: [], currentIndex: 0, round: 1 };
  let _chatHistory = [];
  let _activeChannelId = 'story';
  let _chatChannels = [];
  let _channelUnread = {};
  let _currentAdventure = '默认'; // D+三级会话：当前冒险（规则书-冒险-频道）
  let _activeSheet = null;      // 当前规则系统的角色卡插件 { system, handler }
  let _sheetCollector = null;   // 插件表单的收集函数（保存时调用，返回 { name, displayName, color, data }）
  let _pendingResume = null; // { userMessage, partialContent, partialReasoning, prompt, channelId } AI回复中断后的续接状态
  let _activeDevAbort = null; // 当前AI开发请求的AbortController（状态框"停止"按钮用）
  let _rulePollTimer = null; // 规则书接管进度轮询定时器
  let _ruleTaskViewSystem = null; // 当前内容视图正在显示的进度所属系统
  const DEFAULT_CHANNELS = [
    { id: 'story', name: '剧情', prompt: '剧情频道：负责剧情描写、场景推进、NPC互动和叙事连续性。' },
    { id: 'combat', name: '战斗', prompt: '战斗频道：负责先攻、回合、行动、检定、伤害、状态和战场变化。' },
    { id: 'system', name: '系统', prompt: '系统频道：负责规则书解析、配置修改、工具任务、运行日志和系统需求。' }
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
    _setupTabs();
    setupChat();
    setupChatResize();
    setupDice();
    setupRules();
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
    refreshCharacterList();
    window._chatHistory = _chatHistory;
    window._onMeasureComplete = function(sx, sy, ex, ey, dist) {
      addChatMessage('system', '测量', '距离: ' + dist.toFixed(1) + ' 格');
    };
    updateZoomLabel();
    // 开始界面（2026-08-05）：全局入口——选择规则书→冒险（或继续上次）后才进入内部
    renderStartScreen();
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

  function _setupTabs() {
    document.querySelectorAll('.panel-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = this.getAttribute('data-tab');
        document.querySelectorAll('.panel-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel-content').forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        var c = _el('tab-' + target); if (c) c.classList.add('active');
        if (target === 'rules') refreshRulesList();
        if (target === 'encounter') renderInitiativeList();
        if (target === 'settings') _populateSettingsForm();
      });
    });
    // 设置面板二级页签
    document.querySelectorAll('.sub-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.sub-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelectorAll('.sub-panel').forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        var p = _el('sub-' + this.getAttribute('data-sub'));
        if (p) p.classList.add('active');
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
          addChatMessage('user', '你', text);
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
      label.textContent = ch.name;
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
      });
      tabs.appendChild(btn);
    });
    renderChatMessages();
  }

  function createChannel() {
    var name = prompt('频道名称');
    if (!name) return;
    var text = prompt('频道默认提示词（可留空）') || '';
    var id = 'ch_' + Date.now();
    _chatChannels.push({ id: id, name: name.trim(), prompt: text.trim() });
    _activeChannelId = id;
    _saveChannels();
    renderChannelTabs();
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

  function editChannelPrompt() {
    var ch = getActiveChannel();
    var text = prompt('频道默认提示词', ch.prompt || '');
    if (text === null) return;
    ch.prompt = text;
    _saveChannels();
  }

  function renderChatMessages() {
    var cont = _el('chat-messages'); if (!cont) return;
    cont.innerHTML = '';
    var max = _settings.maxChat || 200;
    _chatHistory.filter(function(m) { return (m.channelId || 'story') === _activeChannelId; }).slice(-max).forEach(function(m) {
      appendChatMessageElement(cont, m);
    });
    cont.scrollTop = cont.scrollHeight;
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

  function appendChatMessageElement(cont, msg) {
    if (msg.reasoning) {
      appendAIElementWithReasoning(cont, msg);
      return;
    }
    var div = document.createElement('div');
    div.className = 'chat-message ' + msg.type;
    div.innerHTML = '<span class="msg-time">' + _esc(msg.time) + '</span>' +
      '<span class="msg-sender">' + _esc(msg.sender) + ':</span>' +
      '<span class="msg-text">' + simpleMarkdown(msg.message) + '</span>';
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
    var item = { time: time, sender: sender, message: message, type: type, channelId: targetChannel };
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
    function applyBottomHeight(h) {
      h = Math.max(160, Math.min(420, h || 220));
      panel.style.height = h + 'px';
      main.style.height = 'calc(100vh - 42px - ' + h + 'px)';
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
    full: '当前模式：完整GM带团。负责剧情推进、NPC扮演、规则判定与数据管理（HP/资源/物品/状态精确更新）。融合角色设定与世界观，不盲目吹捧玩家角色。记忆不可靠，不确定时翻查规则书和模组。需要规则时回复[[search:关键词]]。',
    scene: '当前模式：场景描写。只负责描写环境、氛围、NPC外观和行为。不干预玩家之间的扮演对话，不替玩家做决定，不判定行动结果。玩家要求场景变化或地图更新时照做。需要模组设定时回复[[module:关键词]]。',
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
    var item = { time: time, sender: 'AI', message: content, type: 'ai', channelId: targetChannel, reasoning: reasoningText || '' };
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
    if (Network && Network.isConnected && Network.isConnected() && isGMUser()) {
      Network.sendAIChat(content, targetChannel);
    }
    _persistChatLog();
  }

  function appendAIElementWithReasoning(cont, msg) {
    var div = document.createElement('div');
    div.className = 'chat-message ai';
    var reasoningHtml = '';
    if (msg.reasoning) {
      var summary = reasoningSummaryText(msg.reasoning);
      reasoningHtml = '<div class="chat-reasoning" title="点击展开/收起思考内容">💭 ' + _esc(summary) +
        '<div class="chat-reasoning-body" style="display:none;">' + _esc(msg.reasoning) + '</div></div>';
    }
    div.innerHTML = '<span class="msg-time">' + _esc(msg.time) + '</span>' +
      '<span class="msg-sender">AI:</span>' + reasoningHtml +
      '<span class="msg-text">' + simpleMarkdown(msg.message) + '</span>';
    var reasonHead = div.querySelector('.chat-reasoning');
    if (reasonHead) {
      reasonHead.addEventListener('click', function() {
        var body = div.querySelector('.chat-reasoning-body');
        if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });
    }
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
    fetch('/api/sessions/read?system=' + encodeURIComponent(sys) + '&adventure=' + encodeURIComponent(adv) + '&channel=' + encodeURIComponent(ch.id))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.messages || !data.messages.length) {
          alert('该频道暂无持久化会话记录（历史在本地保留，删除频道不影响查阅）。');
          return;
        }
        var win = window.open('', '_blank');
        if (!win) { alert('请允许弹出窗口以查看历史。'); return; }
        var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>会话历史：' + _esc(ch.name) + '（' + _esc(adv) + '）</title>' +
          '<style>body{background:#14141d;color:#ddd;font-family:Consolas,monospace;padding:16px;max-width:900px;margin:auto}' +
          '.m{border:1px solid #2a2a3a;border-radius:6px;padding:8px 12px;margin:6px 0;white-space:pre-wrap;word-break:break-all}' +
          '.user{border-left:3px solid #6cb2ff}.assistant{border-left:3px solid #6ae08a}.tool{border-left:3px solid #c9a86a;color:#bbb;font-size:12px}' +
          '.h{margin-bottom:12px;color:#888}.h b{color:#fff}</style></head><body>' +
          '<div class="h"><b>规则书：</b>' + _esc(sys) + ' | <b>冒险：</b>' + _esc(adv) + ' | <b>频道：</b>' + _esc(ch.name) + ' | 共 ' + data.total + ' 条记录（只读）</div>';
        data.messages.forEach(function(m) {
          var role = m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'tool');
          var label = role === 'user' ? '👤 用户' : (role === 'assistant' ? '🤖 AI' : '🔧 工具');
          var content = String(m.content || '');
          if (content.length > 4000) content = content.substring(0, 4000) + '\n…（已截断显示）';
          if (m.tool_calls) content = '工具调用: ' + m.tool_calls.map(function(tc) { return tc.function && tc.function.name; }).join(', ') + '\n' + content;
          html += '<div class="m ' + role + '"><b>' + label + '</b><br>' + _esc(content) + '</div>';
        });
        html += '</body></html>';
        win.document.write(html); win.document.close();
      })
      .catch(function(e) { alert('读取历史失败: ' + (e.message || e)); });
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
    // 系统频道：授予规则系统管理工具（AI可直接输出标记，系统执行并回传结果）
    if (ch.id === 'system') {
      prompt += '你处于系统频道，负责让规则书专用功能真正可用。你可以使用插件文件工具直接读取、修改和创建 Ruler/<系统>/plugins/ 下的插件，也可以检查宿主渲染文件。\n' +
        '开工先调用 skill {"name":"agent-guide"} 加载工作方法（任务流程/设计审核/工具选择/需求澄清/空转检查/插件质量要求）；编写或修改规则书插件前必须调用 skill {"name":"plugin-authoring"}；涉及带团体验/判定/数据管理设计时必须调用 skill {"name":"gm-protocol"}。\n' +
        '本工具定位：动态解析TRPG规则书→自动生成配套角色卡与工具→AI作为GM带团。核心追求：TRPG的自由+电脑游戏的精准——AI以结构化标记输出判定与状态，系统渲染界面；角色血量等游戏数据以变量精确管理，AI可读可写，前端实时联动。\n' +
        '主动举一反三（强制）：唯一验收标准=最佳玩家游戏体验。收到需求先想"这个页面按游戏体验应该是什么样"，按正确内容组织编写（而非机械拆分旧结构）；主动发现并优化相关页面/同类问题，总结中列出主动优化项。\n' +
        '最高验收标准（唯一验收标准）：最佳玩家用户体验——真实玩家能否按规则书走完真实流程并顺畅完成每一步；程序写完/控件齐全永远不算完成。每个功能必须实际验证（正例命中+空例为空+点击可展开+数据来自规则书）。\n' +
        '在回复中直接输出标记：删除规则系统 [[rules:delete:规则系统名]]；重新解析规则系统 [[rules:reparse:规则系统名]]。';
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
            if (update.type === 'reasoning') updatePlaceholder(update.text, true);
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

  function refreshRulesList() {
    var listEl = _el('rules-system-list'); if (!listEl) return;
    return AIClient.getRuleSystems().then(function(sys) {
      if (!sys || sys.length === 0) {
        listEl.innerHTML = '<div class="rules-empty">尚未加载规则书。<br>上传PDF/CHM/TXT/MD后，系统会拆解为本地Markdown和资产文件。</div>';
        return;
      }
      var html = '';
      sys.forEach(function(s) {
        var count = s.settings && s.settings.fileCount !== undefined ? s.settings.fileCount : ((s.files && s.files.length) || 0);
        // 显示来源母本（玩家视角），不显示"AI检索源数"技术指标
        var origin = s.settings && s.settings.originalFiles && s.settings.originalFiles.length
          ? s.settings.originalFiles.join('、')
          : (count + ' 个内容文件');
        html += '<div class="rule-system-item" data-system="' + _esc(s.name || s.system) + '">' +
          '<span class="rule-system-name">' + _esc(s.name || s.system) + '</span>' +
          '<div class="rule-system-meta">' + _esc(origin) + '</div></div>';
      });
      listEl.innerHTML = html;
      listEl.querySelectorAll('.rule-system-item').forEach(function(item) {
        var sn = item.getAttribute('data-system');
        item.addEventListener('click', function() {
          listEl.querySelectorAll('.rule-system-item').forEach(function(el) { el.classList.remove('active'); });
          this.classList.add('active');
          _selectedRuleSystem = sn;
          loadRuleSystemSettings(sn);
          updateRuleActionButton();
          if (typeof loadAdventureList === 'function') loadAdventureList(); // 切换规则书后刷新冒险列表
          if (typeof _saveLastEntry === 'function') _saveLastEntry();
        });
      });
      updateRuleActionButton();
    });
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
    updateRuleActionButton();
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
  }

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
          data: t.data || null
        };
      });
      localStorage.setItem(CHARACTER_STORE_KEY, JSON.stringify(arr));
    } catch (e) { /* 存储不可用时静默，不打断游戏 */ }
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
          name: s.name,
          displayName: s.displayName || s.name,
          color: s.color || '#4ecdc4',
          gridX: s.gridX || 0, gridY: s.gridY || 0,
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

  function refreshCharacterList() {
    var listEl = _el('character-list'); if (!listEl) return;
    var tokens = MapEngine.getAllTokens(); var html = '';
    tokens.forEach(function(t) {
      var hpStr = '?';
      if (t.hp !== undefined && t.maxHp !== undefined) {
        var pct = t.maxHp > 0 ? Math.round(t.hp / t.maxHp * 100) : 0;
        hpStr = 'HP: ' + t.hp + '/' + t.maxHp + ' <span class="hp-bar-mini" style="width:' + pct + 'px"></span>';
      }
      html += '<div class="character-list-item" onclick="window.UIManager.selectCharacter(\'' + t.id + '\')">' +
        getTokenAvatarHtml(t, 'char-list-avatar') +
        '<div class="char-list-info"><div class="char-list-name">' + _esc(t.displayName || t.name) + '</div><div class="char-list-hp">' + hpStr + '</div></div>' +
        '<button class="btn-small danger" onclick="event.stopPropagation();window.UIManager.deleteCharacter(\'' + t.id + '\')" title="删除">\u2715</button>' +
        '</div>';
    });
    if (!tokens.length) html = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">暂无角色<br><br>点击「＋ 新建」创建角色，或「📥 导入卡」导入XLSX角色卡</div>';
    listEl.innerHTML = html;
  }

  function selectCharacter(id) {
    var token = MapEngine.getTokenById(id);
    if (token) {
      // 独立窗口标准：角色卡在操作系统级新窗口打开（宿主 WebView2 接管 window.open）
      try { localStorage.setItem('trpg_sheet_' + id, JSON.stringify(token)); } catch (e) {}
      var sys = _selectedRuleSystem || '';
      window.open('/sheet.html?id=' + encodeURIComponent(id) + '&system=' + encodeURIComponent(sys), '_blank');
      showCharacterDetail(id);
    }
  }

  function showCharacterDetail(tokenId) {
    var de = _el('character-detail'); var le = _el('character-list');
    if (!de || !le) return;
    le.querySelectorAll('.character-list-item').forEach(function(i) { i.classList.remove('selected'); });
    var item = le.querySelector('[onclick*="' + tokenId + '"]');
    if (item) item.classList.add('selected');
    var token = MapEngine.getTokenById(tokenId);
    if (!token) { de.style.display = 'none'; return; }
    // 规则专属角色卡优先：当前规则系统提供 character-sheet 插件时由插件渲染详情
    var handler = getSheetHandler();
    if (handler && typeof handler.renderDetail === 'function') {
      de.innerHTML = '';
      try {
        handler.renderDetail(de, token, makeSheetContext(token));
      } catch (err) {
        de.innerHTML = '<div style="color:#ff7b7b;">角色卡渲染错误: ' + _esc(err.message) + '</div>';
      }
      de.style.display = 'block';
      return;
    }
    var tpl = TemplateRenderer.getActiveTemplate();
    var data = token.data || {};
    var html = '<div class="char-sheet-header">' + getTokenAvatarHtml(token, 'char-sheet-avatar') +
      '<div class="char-sheet-title"><h3>' + _esc(token.displayName || token.name) + '</h3><span>' + _esc(token.name) + '</span></div></div>';
    html += TemplateRenderer.renderCharacterSheet(tpl, data, tokenId);
    de.innerHTML = html; de.style.display = 'block';
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
    var token = MapEngine.getTokenById(tokenId); if (!token) return;
    // 独立窗口标准：编辑角色卡同样在独立窗口打开
    try { localStorage.setItem('trpg_sheet_' + tokenId, JSON.stringify(token)); } catch (e) {}
    var sys = _selectedRuleSystem || '';
    window.open('/character-create.html?system=' + encodeURIComponent(sys) + '&id=' + encodeURIComponent(tokenId), '_blank');
  }

  // 独立窗口标准：接收角色卡创建窗口（character-create.html）的保存结果
  function setupPendingCharacterListener() {
    window.addEventListener('storage', function(e) {
      if (e.key !== 'trpg_pending_character') return;
      var val = null;
      try { val = JSON.parse(e.newValue); } catch (err) {}
      if (!val || typeof val !== 'object') return;
      try { localStorage.removeItem('trpg_pending_character'); } catch (err) {}
      var data = val.data || {};
      if (val.action === 'update' && val.id) {
        var up = { name: val.name, displayName: val.displayName, color: val.color, data: data };
        var hpV = data.HP || data.HP_current;
        if (hpV && typeof hpV === 'object') { up.hp = hpV.current; up.maxHp = hpV.max; }
        if (data.AC !== undefined) up.ac = parseInt(data.AC) || data.AC;
        MapEngine.updateToken(val.id, up);
        try { localStorage.setItem('trpg_sheet_' + val.id, JSON.stringify(MapEngine.getTokenById(val.id))); } catch (err) {}
      } else {
        var tok = MapEngine.addToken({ name: val.name, displayName: val.displayName, color: val.color, gridX: 0, gridY: 0, data: data });
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
    _imageTool = { image: null, originalDataUrl: '', cropPortrait: null, cropAvatar: null, crop: { x: 110, y: 40, w: 300, h: 225 }, dragging: false, dragOffsetX: 0, dragOffsetY: 0, zoom: 1 };
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
    var ratio = target === 'avatar' ? 1 : 4 / 3;
    var h = Math.min(canvas.height - 60, target === 'avatar' ? 260 : 270);
    var w = h * ratio;
    if (w > canvas.width - 60) { w = canvas.width - 60; h = w / ratio; }
    _imageTool.crop = { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w: w, h: h };
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
    ctx.drawImage(img, dx, dy, dw, dh);
    var c = _imageTool.crop;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, c.y); ctx.fillRect(0, c.y + c.h, canvas.width, canvas.height - c.y - c.h);
    ctx.fillRect(0, c.y, c.x, c.h); ctx.fillRect(c.x + c.w, c.y, canvas.width - c.x - c.w, c.h);
    ctx.strokeStyle = '#e0c870'; ctx.lineWidth = 2; ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = '#e0c870'; ctx.fillRect(c.x + c.w - 10, c.y + c.h - 10, 10, 10);
  }

  function startImageCropDrag(e) {
    if (!_imageTool.image) return;
    var rect = this.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var c = _imageTool.crop;
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
      _imageTool.dragging = true;
      _imageTool.dragOffsetX = x - c.x;
      _imageTool.dragOffsetY = y - c.y;
    }
  }

  function moveImageCropDrag(e) {
    if (!_imageTool.dragging) return;
    var rect = this.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var c = _imageTool.crop;
    c.x = Math.max(0, Math.min(this.width - c.w, x - _imageTool.dragOffsetX));
    c.y = Math.max(0, Math.min(this.height - c.h, y - _imageTool.dragOffsetY));
    drawCharacterImageTool();
  }

  function endImageCropDrag() { _imageTool.dragging = false; }

  function cropToDataUrl(crop, width, height, framed) {
    var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    var ctx = canvas.getContext('2d');
    var d = _imageTool.draw;
    var sx = Math.max(0, (crop.x - d.dx) / d.scale);
    var sy = Math.max(0, (crop.y - d.dy) / d.scale);
    var sw = Math.min(_imageTool.image.width - sx, crop.w / d.scale);
    var sh = Math.min(_imageTool.image.height - sy, crop.h / d.scale);
    ctx.drawImage(_imageTool.image, sx, sy, sw, sh, 0, 0, width, height);
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
    if (target === 'portrait') {
      _imageTool.cropPortrait = Object.assign({}, _imageTool.crop);
      var p = cropToDataUrl(_imageTool.cropPortrait, 800, 600, false);
      var pi = _el('char-image-portrait-preview'); if (pi) pi.src = p;
      addChatMessage('system', '角色图片', '已记录4:3立绘裁剪。');
    } else {
      _imageTool.cropAvatar = Object.assign({}, _imageTool.crop);
      var a = cropToDataUrl(_imageTool.cropAvatar, 512, 512, false);
      var f = cropToDataUrl(_imageTool.cropAvatar, 512, 512, true);
      var ai = _el('char-image-avatar-preview'); if (ai) ai.src = a;
      var fi = _el('char-image-framed-preview'); if (fi) fi.src = f;
      addChatMessage('system', '角色图片', '已记录1:1头像裁剪。');
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
        portrait: cropToDataUrl(_imageTool.cropPortrait, 800, 600, false),
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
    MapEngine.removeToken(tokenId); refreshCharacterList();
    try { localStorage.removeItem('trpg_sheet_' + tokenId); } catch (e) {}
    persistCharacters();
    var de = _el('character-detail'); if (de) de.style.display = 'none';
    if (_editingCharId === tokenId) _editingCharId = null;
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
    };

    Network.onRoomJoined = function(data) {
      var disp = _el('room-display');
      if (disp) {
        disp.innerHTML = '<span class="room-code">' + data.code + '</span>';
        disp.className = 'room-info active';
      }
      addChatMessage('system', '房间', '已加入房间: ' + data.code);
      updateAIControls();
    };

    Network.onRoomError = function(msg) {
      alert(msg);
    };

    Network.onPlayersUpdate = function(players, host) {
      var disp = _el('room-display');
      var code = Network.getRoomCode();
      if (disp && code) {
        var count = Object.keys(players).length;
        disp.innerHTML = '<span class="room-code">' + code + '</span><span class="room-url-hint">' + count + '人在线</span>';
        disp.className = 'room-info active';
      }
      updateAIControls();
    };

    Network.onChat = function(data) {
      addChatMessage('user', data.sender || '玩家', data.text);
    };

    Network.onAIChat = function(data) {
      addChatMessage('ai', 'AI', data.text || '', data.channelId || _activeChannelId || 'story');
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
      Network.createRoom();
    });

    _el('btn-join-room').addEventListener('click', function() {
      openModal('join-room-modal');
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

    // 钩子：标记操作时同步到网络
    var origAddToken = MapEngine.addToken;
    MapEngine.addToken = function(opts) {
      var token = origAddToken(opts);
      if (Network.isConnected()) Network.sendTokenAdd(token);
      return token;
    };
    var origRemoveToken = MapEngine.removeToken;
    MapEngine.removeToken = function(id) {
      origRemoveToken(id);
      if (Network.isConnected()) Network.sendTokenRemove(id);
    };
    var origUpdateToken = MapEngine.updateToken;
    MapEngine.updateToken = function(id, updates) {
      var result = origUpdateToken(id, updates);
      if (Network.isConnected()) {
        if (updates.gridX !== undefined || updates.gridY !== undefined) {
          Network.sendTokenMove(id, updates.gridX, updates.gridY);
        } else {
          Network.sendTokenUpdate(id, updates);
        }
      }
      return result;
    };
  }

  // 覆写addChatMessage以同步到网络
  var _origAddChat = addChatMessage;
  addChatMessage = function(type, sender, text, channelId) {
    _origAddChat(type, sender, text, channelId);
    if (Network.isConnected() && type !== 'system' && type !== 'ai') {
      Network.sendChat(text);
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
    _el('btn-check-tool').addEventListener('click', function() {
      openModal('check-modal');
      if (checkItems.length === 0) addCheckItem(); // 默认加一个空项
    });
    _el('btn-add-check').addEventListener('click', addCheckItem);
    _el('btn-check-close').addEventListener('click', function() { closeModal('check-modal'); });
    _el('btn-check-send-ai').addEventListener('click', sendChecksToAI);
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
      showCharacterDetail(token.id);
    } else {
      var de = _el('character-detail');
      if (de) de.style.display = 'none';
      var le = _el('character-list');
      if (le) le.querySelectorAll('.character-list-item').forEach(function(i) { i.classList.remove('selected'); });
    }
  }

  function onMapCoordUpdate(gx, gy) {
    var cd = _el('coord-display');
    if (cd) cd.innerHTML = 'X: ' + Math.round(gx) + ' &nbsp; Y: ' + Math.round(gy);
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
    // 4) <UpdateVariable> 数据更新折叠卡片
    html = html.replace(/&lt;UpdateVariable&gt;([\s\S]*?)&lt;\/UpdateVariable&gt;/gi, function(m, body) {
      return '<div class="gm-update-card"><details class="gm-update-details"><summary class="gm-update-summary">📊 数据更新 <small style="margin-left:auto;font-size:.85em;color:#999;">点击查看/隐藏 ▼</small></summary><div class="gm-update-content">' + body.replace(/&lt;/g, '&lt;').replace(/&gt;/g, '&gt;').replace(/&amp;/g, '&amp;') + '</div></details></div>';
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
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
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
    showCharacterDetail: showCharacterDetail,
    damageCharacter: damageCharacter,
    healCharacter: healCharacter,
    applyHPChange: applyHPChange,
    openCharacterModal: openCharacterModal,
    openCharacterModalForEdit: openCharacterModalForEdit,
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
    simpleMarkdown: simpleMarkdown
  };
})();

if (typeof window !== 'undefined') { window.UIManager = UIManager; }
