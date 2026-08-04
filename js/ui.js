/* ============================================
   TrpgRecode - UI管理模块
   ============================================ */

const UIManager = (() => {
  'use strict';

  let _editingCharId = null;
  let _encounter = { active: false, initiatives: [], currentIndex: 0, round: 1 };
  let _chatHistory = [];
  const _settings = {
    provider: 'gpt',
    gptKey: '', gptModel: 'gpt-4o',
    customEndpoint: '', customKey: '', customModel: '',
    gridColor: '#3a3a5c', bgColor: '#1a1a2e', rangeColor: '#ff6b6b', cellSize: 50, maxChat: 200
  };

  function _esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function _el(id) { return document.getElementById(id); }
  function _loadSettings() { try { var s = JSON.parse(localStorage.getItem('trpg_settings')); if (s) Object.assign(_settings, s); } catch(e){} }
  function _saveSettings() { try { localStorage.setItem('trpg_settings', JSON.stringify(_settings)); } catch(e){} }

  function _applySetting(id, key) { var e = _el(id); if (e) e.value = _settings[key]; }
  function _populateSettingsForm() {
    _applySetting('setting-grid-color', 'gridColor');
    _applySetting('setting-bg-color', 'bgColor');
    _applySetting('setting-range-color', 'rangeColor');
    _applySetting('setting-cell-size', 'cellSize');
    _applySetting('setting-provider', 'provider');
    _applySetting('setting-gpt-key', 'gptKey');
    _applySetting('setting-gpt-model', 'gptModel');
    _applySetting('setting-custom-endpoint', 'customEndpoint');
    _applySetting('setting-custom-key', 'customKey');
    _applySetting('setting-max-chat', 'maxChat');
    // 自定义模型下拉
    var cmSel = _el('setting-custom-model-select');
    if (cmSel && _settings.customModel) {
      cmSel.innerHTML = '<option value="' + _settings.customModel + '">' + _settings.customModel + '</option>';
      cmSel.value = _settings.customModel;
    }
    var prov = _settings.provider || 'gpt';
    var gptPanel = _el('provider-gpt');
    var customPanel = _el('provider-custom');
    if (gptPanel) gptPanel.style.display = prov === 'gpt' ? 'block' : 'none';
    if (customPanel) customPanel.style.display = prov === 'custom' ? 'block' : 'none';
    _el('setting-provider').value = prov;
  }

  function init() {
    _loadSettings();
    _setupToolbar();
    _setupTabs();
    setupChat();
    setupDice();
    setupAI();
    setupRules();
    setupCharacterImport();
    setupModals();
    setupSettings();
    refreshCharacterList();
    window._chatHistory = _chatHistory;
    window._onMeasureComplete = function(sx, sy, ex, ey, dist) {
      addChatMessage('system', '测量', '距离: ' + dist.toFixed(1) + ' 格');
    };
    AIClient.init({
      serverUrl: _settings.serverUrl,
      onMessage: function(content, role) { addAIMessage(role, content); },
      onStatusChange: function(status) { updateServerStatus(status); }
    });
    AIClient.setActiveProvider('openai');
    updateZoomLabel();
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
  }

  function setupChat() {
    var chatInput = _el('chat-input');
    function _sendChat() {
      if (!chatInput) return;
      var text = chatInput.value.trim(); if (!text) return;
      chatInput.value = '';
      if (text.startsWith('/ai')) {
        var aiMsg = text.replace(/^\/ai\s*/, '');
        if (aiMsg) {
          addChatMessage('system', '你', aiMsg);
          var aiIn = _el('ai-input'); if (aiIn) aiIn.value = aiMsg;
          sendToAI();
        }
        return;
      }
      var result = DiceSystem.smartRoll(text);
      if (result) {
        addChatMessage('dice', '骰子', DiceSystem.formatResult(result));
        if (AIClient && typeof AIClient.recordRoll === 'function') AIClient.recordRoll(text, result, '');
      } else {
        addChatMessage('user', '你', text);
      }
    }
    var btn = _el('btn-send'); if (btn) btn.addEventListener('click', _sendChat);
    if (chatInput) chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendChat(); }
    });
  }

  function addChatMessage(type, sender, message) {
    var cont = _el('chat-messages'); if (!cont) return;
    var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    var div = document.createElement('div');
    div.className = 'chat-message ' + type;
    div.innerHTML = '<span class="msg-time">' + _esc(time) + '</span>' +
      '<span class="msg-sender">' + _esc(sender) + ':</span>' +
      '<span class="msg-text">' + simpleMarkdown(message) + '</span>';
    cont.appendChild(div); cont.scrollTop = cont.scrollHeight;
    _chatHistory.push({ time: time, sender: sender, message: message, type: type });
    var max = _settings.maxChat || 200;
    while (_chatHistory.length > max) _chatHistory.shift();
    while (cont.children.length > max) { if (cont.firstChild) cont.removeChild(cont.firstChild); }
  }

  function setupDice() {
    document.querySelectorAll('.dice-btn[data-dice]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var expr = this.getAttribute('data-dice');
        var result = DiceSystem.smartRoll(expr);
        if (result) {
          addChatMessage('dice', '骰子', DiceSystem.formatResult(result));
          if (AIClient && typeof AIClient.recordRoll === 'function') AIClient.recordRoll(expr, result, '');
        }
      });
    });
    var bc = _el('btn-custom-dice'); if (bc) bc.addEventListener('click', function() { openDiceModal(); });
  }

  function setupAI() {
    var prov = _el('ai-provider-select'); var bc = _el('btn-ai-clear');
    var bs = _el('btn-ai-send'); var aiIn = _el('ai-input');
    if (prov) { prov.value = 'openai'; prov.addEventListener('change', function() { AIClient.setActiveProvider(this.value); }); }
    if (bc) bc.addEventListener('click', function() {
      AIClient.clearHistory();
      var md = _el('ai-messages'); if (md) md.innerHTML = '<div class="ai-welcome">对话历史已清除。AI游戏主持已就绪。</div>';
    });
    function _doSend() {
      if (!aiIn) return; var msg = aiIn.value.trim(); if (!msg) return;
      aiIn.value = ''; addAIMessage('user', msg);
      AIClient.sendMessage(msg, { provider: AIClient.getActiveProvider() });
    }
    if (bs) bs.addEventListener('click', _doSend);
    if (aiIn) aiIn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _doSend(); }
    });
  }

  function sendToAI() {
    var aiIn = _el('ai-input'); if (!aiIn) return;
    var msg = aiIn.value.trim(); if (!msg) return;
    aiIn.value = ''; addAIMessage('user', msg);
    AIClient.sendMessage(msg, { provider: AIClient.getActiveProvider() });
  }

  function addAIMessage(role, content) {
    var cont = _el('ai-messages'); if (!cont) return;
    if (cont.querySelector('.ai-welcome')) cont.innerHTML = '';
    var div = document.createElement('div'); div.className = 'ai-message ' + role;
    var labels = { user: '你', ai: 'AI GM', system: '系统' };
    var label = labels[role] || role;
    div.innerHTML = '<div class="ai-role">' + _esc(label) + '</div><div class="ai-content">' + simpleMarkdown(content) + '</div>';
    cont.appendChild(div); cont.scrollTop = cont.scrollHeight;
  }

  function setupRules() {
    var ub = _el('btn-upload-rulebook'); var fi = _el('rulebook-file-input');
    if (ub && fi) {
      ub.addEventListener('click', function() { fi.click(); });
      fi.addEventListener('change', function() {
        var f = this.files[0]; if (!f) return;
        var ext = f.name.split('.').pop().toLowerCase(); var type = 'text';
        if (ext === 'pdf') type = 'pdf'; else if (ext === 'chm') type = 'chm'; else if (ext === 'xlsx' || ext === 'xls') type = 'xlsx';
        AIClient.readFile(f, type).then(function(data) {
          if (data) {
            addChatMessage('system', '规则书', '已上传: ' + f.name);
            AIClient.processRuleText('通用', f.name, data.content || data.text || '').then(function() { refreshRulesList(); });
          } else { addChatMessage('system', '错误', '上传失败，请确保AI服务器已连接。'); }
        });
        this.value = '';
      });
    }
  }

  function refreshRulesList() {
    var listEl = _el('rules-system-list'); if (!listEl) return;
    AIClient.getRuleSystems().then(function(sys) {
      if (!sys || sys.length === 0) {
        listEl.innerHTML = '<div class="rules-empty">尚未加载规则书。<br>上传PDF/CHM文件后，AI会自动整理为可查询的Markdown表格。</div>';
        return;
      }
      var html = '';
      sys.forEach(function(s) {
        html += '<div class="rule-system-item" data-system="' + _esc(s.name || s.system) + '">' + _esc(s.name || s.system) + '</div>';
        if (s.files) s.files.forEach(function(f) {
          html += '<div class="rule-file-item" data-system="' + _esc(s.name) + '" data-file="' + _esc(f) + '">  \u{1F4C4} ' + _esc(f) + '</div>';
        });
      });
      listEl.innerHTML = html;
      listEl.querySelectorAll('.rule-system-item').forEach(function(item) {
        item.addEventListener('click', function() {
          listEl.querySelectorAll('.rule-system-item').forEach(function(e) { e.classList.remove('active'); });
          this.classList.add('active');
          var sn = this.getAttribute('data-system');
          var files = listEl.querySelectorAll('.rule-file-item[data-system="' + sn + '"]');
          if (files.length > 0) loadRuleContent(sn, files[0].getAttribute('data-file'));
        });
      });
      listEl.querySelectorAll('.rule-file-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
          e.stopPropagation();
          listEl.querySelectorAll('.rule-file-item').forEach(function(el) { el.classList.remove('active'); });
          this.classList.add('active');
          loadRuleContent(this.getAttribute('data-system'), this.getAttribute('data-file'));
        });
      });
    });
  }

  function loadRuleContent(system, file) {
    var ce = _el('rules-content-view'); if (!ce) return;
    ce.innerHTML = '<div class="rules-placeholder">加载中...</div>';
    AIClient.getRuleContent(system, file).then(function(data) {
      if (data && data.content) { ce.innerHTML = simpleMarkdown(data.content); }
      else { ce.innerHTML = '<div class="rules-placeholder">无法加载规则内容</div>'; }
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
            refreshCharacterList(); addChatMessage('system', '导入', '已导入角色: ' + name);
          }
        });
        this.value = '';
      });
    }
    var bn = _el('btn-new-character'); if (bn) bn.addEventListener('click', function() { openCharacterModal(); });
  }

  function refreshCharacterList() {
    var listEl = _el('character-list'); if (!listEl) return;
    var tokens = MapEngine.getAllTokens(); var html = '';
    tokens.forEach(function(t) {
      var initial = (t.displayName || t.name || '?').charAt(0);
      var hpStr = '?';
      if (t.hp !== undefined && t.maxHp !== undefined) {
        var pct = t.maxHp > 0 ? Math.round(t.hp / t.maxHp * 100) : 0;
        hpStr = 'HP: ' + t.hp + '/' + t.maxHp + ' <span class="hp-bar-mini" style="width:' + pct + 'px"></span>';
      }
      html += '<div class="character-list-item" onclick="window.UIManager.selectCharacter(\'' + t.id + '\')">' +
        '<div class="char-list-avatar" style="background:' + (t.color || '#4ecdc4') + '">' + _esc(initial) + '</div>' +
        '<div class="char-list-info"><div class="char-list-name">' + _esc(t.displayName || t.name) + '</div><div class="char-list-hp">' + hpStr + '</div></div>' +
        '<button class="btn-small danger" onclick="event.stopPropagation();window.UIManager.deleteCharacter(\'' + t.id + '\')" title="删除">\u2715</button>' +
        '</div>';
    });
    if (!tokens.length) html = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">暂无角色<br><br>点击「＋ 新建」创建角色，或「📥 导入卡」导入XLSX角色卡</div>';
    listEl.innerHTML = html;
  }

  function selectCharacter(id) {
    var token = MapEngine.getTokenById(id);
    if (token) { showCharacterDetail(id); }
  }

  function showCharacterDetail(tokenId) {
    var de = _el('character-detail'); var le = _el('character-list');
    if (!de || !le) return;
    le.querySelectorAll('.character-list-item').forEach(function(i) { i.classList.remove('selected'); });
    var item = le.querySelector('[onclick*="' + tokenId + '"]');
    if (item) item.classList.add('selected');
    var token = MapEngine.getTokenById(tokenId);
    if (!token) { de.style.display = 'none'; return; }
    var tpl = TemplateRenderer.getActiveTemplate();
    var data = token.data || {};
    var html = '<div class="char-sheet-header"><div class="char-sheet-avatar" style="background:' + (token.color || '#4ecdc4') + '">' +
      _esc((token.displayName || token.name || '?').charAt(0)) + '</div>' +
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
    var label = delta > 0 ? '治疗' : '伤害';
    addChatMessage('system', label, _esc(token.displayName || token.name) + ' ' + label + ': ' + Math.abs(delta) + ' (HP: ' + newHp + '/' + (token.maxHp || '?') + ')');
    showCharacterDetail(tokenId);
  }

  function openCharacterModal() {
    _editingCharId = null; var t = _el('char-modal-title'); if (t) t.textContent = '新建角色';
    var n = _el('char-name'); if (n) n.value = '';
    var d = _el('char-display'); if (d) d.value = '';
    var c = _el('char-color'); if (c) c.value = '#4ecdc4';
    var da = _el('char-data'); if (da) da.value = '{}';
    openModal('character-modal');
  }

  function openCharacterModalForEdit(tokenId) {
    var token = MapEngine.getTokenById(tokenId); if (!token) return;
    _editingCharId = tokenId;
    var t = _el('char-modal-title'); if (t) t.textContent = '编辑角色';
    var n = _el('char-name'); if (n) n.value = token.name || '';
    var d = _el('char-display'); if (d) d.value = token.displayName || '';
    var c = _el('char-color'); if (c) c.value = token.color || '#4ecdc4';
    var da = _el('char-data'); if (da) da.value = JSON.stringify(token.data || {}, null, 2);
    openModal('character-modal');
  }

  function saveCharacter() {
    var n = _el('char-name'); var d = _el('char-display'); var c = _el('char-color'); var da = _el('char-data');
    var name = n ? n.value.trim() : '未命名';
    var displayName = d ? d.value.trim() : name;
    var color = c ? c.value : '#4ecdc4';
    var dataStr = da ? da.value.trim() : '{}';
    var data; try { data = JSON.parse(dataStr); } catch(e) { addChatMessage('system', '错误', '角色数据JSON格式错误，请检查。'); return; }
    if (_editingCharId) {
      var up = { name: name, displayName: displayName, color: color, data: data };
      var hpV = data.HP || data.HP_current;
      if (hpV && typeof hpV === 'object') { up.hp = hpV.current; up.maxHp = hpV.max; }
      if (data.AC !== undefined) up.ac = parseInt(data.AC) || data.AC;
      MapEngine.updateToken(_editingCharId, up);
    } else {
      var tok = MapEngine.addToken({ name: name, displayName: displayName, color: color, gridX: 0, gridY: 0, data: data });
      var hpV = data.HP || data.HP_current;
      if (hpV && typeof hpV === 'object') MapEngine.updateToken(tok.id, { hp: hpV.current, maxHp: hpV.max });
      if (data.AC !== undefined) MapEngine.updateToken(tok.id, { ac: parseInt(data.AC) || data.AC });
    }
    closeModal('character-modal'); refreshCharacterList(); _editingCharId = null;
  }

  function deleteCharacter(tokenId) {
    var token = MapEngine.getTokenById(tokenId); if (!token) return;
    var name = token.displayName || token.name;
    MapEngine.removeToken(tokenId); refreshCharacterList();
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

    // 保存配置
    _el('btn-save-ai-config').addEventListener('click', function() {
      _settings.provider = _el('setting-provider').value;
      _settings.gptKey = _el('setting-gpt-key').value.trim();
      _settings.gptModel = _el('setting-gpt-model').value;
      _settings.customEndpoint = _el('setting-custom-endpoint').value.trim();
      _settings.customKey = _el('setting-custom-key').value.trim();
      _settings.customModel = _el('setting-custom-model-select').value.trim();
      _saveSettings();

      // 同步到AIClient和后端
      AIClient.setServerUrl(_settings.serverUrl);
      AIClient.setActiveProvider(_settings.provider === 'gpt' ? 'gpt' : 'custom');

      var activeKey = _settings.provider === 'gpt' ? _settings.gptKey : _settings.customKey;
      if (activeKey) AIClient.setApiKey(_settings.provider, activeKey);

      // 更新AI面板提供商选择
      var aiSel = _el('ai-provider-select');
      if (aiSel) aiSel.value = _settings.provider;

      addChatMessage('system', '设置', 'AI配置已保存');
    });

    // 数据管理
    _el('btn-export-data').addEventListener('click', exportAllData);
    _el('btn-import-data').addEventListener('click', function() { _el('import-file-input').click(); });
    _el('import-file-input').addEventListener('change', importAllData);
    _el('btn-reset-all').addEventListener('click', function() {
      if (!confirm('确定要重置全部数据吗？此操作不可撤销。')) return;
      MapEngine.clearTokens();
      _chatHistory = [];
      var cm = _el('chat-messages'); if (cm) cm.innerHTML = '';
      var am = _el('ai-messages'); if (am) am.innerHTML = '<div class="ai-welcome">对话历史已清空</div>';
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

  function testConnection(provider) {
    var statusEl = _el(provider + '-status');
    if (statusEl) { statusEl.textContent = '检测中...'; statusEl.className = 'conn-status checking'; }

    var url = getServerUrl();
    var key = provider === 'gpt' ? _el('setting-gpt-key').value.trim() : _el('setting-custom-key').value.trim();

    if (!key) {
      if (statusEl) { statusEl.textContent = '未设置Key'; statusEl.className = 'conn-status failed'; }
      return;
    }

    fetch(url + '/api/health')
      .then(function(r) { return r.json(); })
      .then(function() {
        return fetch(url + '/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'ping' }],
            provider: provider
          })
        });
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.content !== undefined) {
          if (statusEl) { statusEl.textContent = '已连接'; statusEl.className = 'conn-status connected'; }
        } else if (d.error) {
          if (statusEl) { statusEl.textContent = d.error.substring(0, 20); statusEl.className = 'conn-status failed'; }
        }
      })
      .catch(function(e) {
        if (statusEl) { statusEl.textContent = '连接失败'; statusEl.className = 'conn-status failed'; }
      });
  }

  function fetchModels(provider) {
    var statusEl = _el(provider + '-status');
    if (statusEl) { statusEl.textContent = '获取模型中...'; statusEl.className = 'conn-status checking'; }

    fetch(getServerUrl() + '/api/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: provider })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var selId = provider === 'gpt' ? 'setting-gpt-model' : 'setting-custom-model-select';
      var sel = _el(selId);
      if (sel && d.models) {
        sel.innerHTML = d.models.map(function(m) {
          return '<option value="' + m + '">' + m + '</option>';
        }).join('');
        // 恢复保存的模型选择
        var savedModel = provider === 'gpt' ? _settings.gptModel : _settings.customModel;
        if (savedModel) sel.value = savedModel;
      }
      if (statusEl) {
        statusEl.textContent = d.fallback ? '使用预设列表' : '已获取' + (d.models ? d.models.length + '个模型' : '');
        statusEl.className = 'conn-status connected';
      }
    })
    .catch(function(e) {
      if (statusEl) { statusEl.textContent = '获取失败'; statusEl.className = 'conn-status failed'; }
    });
  }

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
        if (data.chatHistory) { _chatHistory = data.chatHistory; }
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
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  return {
    init: init,
    updateToolButtons: updateToolButtons,
    updateZoomLabel: updateZoomLabel,
    updateServerStatus: updateServerStatus,
    setupAI: setupAI,
    sendToAI: sendToAI,
    addAIMessage: addAIMessage,
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

