// ── 战斗/回合/反应 UI 模块（从 ui.js 拆分） ──
// 依赖 UIManager._internal（由 ui.js 挂载：el/esc/addChatMessage/sendToAI/getServerUrl/
// activeChannelId/selectedRuleSystem/currentAdventure）
// 通用框架原则：本模块只实现"事件上报→询问弹窗→选择→结算"通用链路与回合推进，
// 具体规则书功能（反应/借机等）由引擎按行为数据驱动，本模块不感知规则书概念。
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.UIManager) return;
  var I = window.UIManager._internal || {};
  if (!I.el || !I.sendToAI) return;

  var _el = I.el;
  var _esc = I.esc;
  var addChatMessage = I.addChatMessage;
  var sendToAI = I.sendToAI;
  var getServerUrl = I.getServerUrl;
  var activeChannelId = I.activeChannelId;
  var selectedRuleSystem = I.selectedRuleSystem;
  var currentAdventure = I.currentAdventure;

  // ── 战斗回合（自然语言入口：开始战斗/结束回合/结束战斗） ──
  function getCombatPayload() {
    return { system: selectedRuleSystem() || '', adventure: currentAdventure() || '默认' };
  }
  function startCombat() {
    fetch(getServerUrl() + '/api/combat/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getCombatPayload()) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          var names = (d.combat.units || []).map(function(u) { return u.name + (u.faction === 'enemy' ? ' ⚔' : ''); }).join('、');
          addChatMessage('system', '战斗', '⚔ 战斗开始：回合 1。参战：' + names, activeChannelId() || 'story');
        } else addChatMessage('system', '战斗', d.error || '开始战斗失败', activeChannelId() || 'story');
      })
      .catch(function(e) { addChatMessage('system', '战斗', '开始战斗失败: ' + (e.message || e), activeChannelId() || 'story'); });
  }
  function endCombatRound() {
    fetch(getServerUrl() + '/api/combat/end-round', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getCombatPayload()) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.success) { addChatMessage('system', '战斗', d.error || '结束回合失败', activeChannelId() || 'story'); return; }
        (d.speaks || []).forEach(function(s) { addChatMessage('ai', s.unit, s.text, activeChannelId() || 'story'); });
        (d.changes || []).forEach(function(c) { addChatMessage('system', '战斗', c, activeChannelId() || 'story'); });
        (d.handoffs || []).forEach(function(h) { addChatMessage('system', '战斗', '⚠ ' + h.unit + ' 触发特殊情况，AI 将接管其行为。', activeChannelId() || 'story'); });
        var summary = '【回合结束·战斗总结】第 ' + (d.round - 1) + ' 回合已结束。本回合 NPC 自动反应：' +
          (d.speaks || []).map(function(s) { return s.unit + '说「' + s.text + '」'; }).join('；') +
          (d.changes && d.changes.length ? '；状态变化：' + d.changes.join('；') : '') +
          '。请总结本回合战斗，输出战斗画面描述（面向玩家，可直接显示）。';
        sendToAI(summary, { silent: true, channelId: activeChannelId() || 'story' });
      })
      .catch(function(e) { addChatMessage('system', '战斗', '结束回合失败: ' + (e.message || e), activeChannelId() || 'story'); });
  }
  function endCombat() {
    fetch(getServerUrl() + '/api/combat/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getCombatPayload()) })
      .then(function(r) { return r.json(); })
      .then(function(d) { addChatMessage('system', '战斗', d.success ? '⚔ 战斗已结束。' : (d.error || '结束战斗失败'), activeChannelId() || 'story'); })
      .catch(function(e) { addChatMessage('system', '战斗', '结束战斗失败: ' + (e.message || e), activeChannelId() || 'story'); });
  }

  // ── 引擎驱动回合推进：[[turn:end]] → 行动者切换 / 回合轮转 / 战斗结束判定 ──
  function handleTurnAdvance() {
    var cid = activeChannelId() || 'story';
    fetch(getServerUrl() + '/api/combat/advance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: selectedRuleSystem() || '', adventure: currentAdventure() || '默认' }) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.success) {
          if (d.error) addChatMessage('system', '战斗', d.error, cid);
          return;
        }
        if (d.advance === 'turn') {
          addChatMessage('system', '战斗', '⏩ 轮到 ' + d.next + ' 行动（回合 ' + d.round + '）', cid);
          return;
        }
        if (d.roundEnd) {
          (d.speaks || []).forEach(function(s) { addChatMessage('ai', s.unit, s.text, cid); });
          (d.changes || []).forEach(function(c) { addChatMessage('system', '战斗', c, cid); });
          (d.handoffs || []).forEach(function(h) { addChatMessage('system', '战斗', '⚠ ' + h.unit + ' 触发特殊情况，AI 将接管其行为。', cid); });
          if (d.battleEnd) {
            addChatMessage('system', '战斗', '⚔ ' + d.battleEnd.text, cid);
            sendToAI('【战斗结束·收尾】战斗已结束（' + d.battleEnd.text + '）。请对整场战斗做简短收尾描述（面向玩家，可直接显示）。不要输出 [[turn:end]]。', { silent: true, channelId: cid });
            return;
          }
          addChatMessage('system', '战斗', '🔁 回合 ' + d.round + ' 开始，轮到 ' + (d.next || '—') + ' 行动', cid);
          sendToAI('【回合结束·战斗总结】第 ' + (d.round - 1) + ' 回合已结束，自动进入回合 ' + d.round + '。本回合 NPC 自动反应：' +
            (d.speaks || []).map(function(s) { return s.unit + '说「' + s.text + '」'; }).join('；') +
            (d.changes && d.changes.length ? '；状态变化：' + d.changes.join('；') : '') +
            '。请总结本回合战斗，输出战斗画面描述（面向玩家，可直接显示）。不要输出 [[turn:end]]。', { silent: true, channelId: cid });
        }
      })
      .catch(function() {});
  }

  // ── 事件总线与询问原语：[[event:...]] → 引擎生成询问 → 弹窗选择 → AI 结算 ──
  function parseEventMarks(content) {
    var evs = [];
    var re = /\[\[event:([a-zA-Z]+)(?:\|([^\[\]]*))?\]\]/g;
    var m;
    while ((m = re.exec(String(content || '')))) {
      var parts = String(m[2] || '').split('|');
      evs.push({ type: m[1], source: parts[0] || '', target: parts[1] || '', detail: parts[2] || '' });
    }
    return evs;
  }
  function handleCombatEvents(evs) {
    if (!evs || !evs.length) return;
    var sys = selectedRuleSystem() || '';
    var adv = currentAdventure() || '默认';
    var chain = Promise.resolve();
    evs.forEach(function(ev) {
      chain = chain.then(function() {
        return fetch(getServerUrl() + '/api/combat/event', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: sys, adventure: adv, event: ev })
        }).then(function(r) { return r.json(); }).catch(function() { return {}; });
      });
    });
    chain.then(function() { pollAndResolveAsks(); });
  }
  function pollAndResolveAsks() {
    var sys = selectedRuleSystem() || '';
    var adv = currentAdventure() || '默认';
    fetch(getServerUrl() + '/api/combat/asks?system=' + encodeURIComponent(sys) + '&adventure=' + encodeURIComponent(adv))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.success || !d.pending || !d.pending.length) return;
        var chain = Promise.resolve();
        var chosen = [];
        d.pending.forEach(function(item) {
          chain = chain.then(function() { return askChoice(item); }).then(function(choice) {
            return fetch(getServerUrl() + '/api/combat/ask', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ system: sys, adventure: adv, unit: item.unit, askId: item.id, optionIndex: choice ? choice.optionIndex : undefined, skip: !choice })
            }).then(function(r) { return r.json(); }).catch(function() { return {}; });
          }).then(function(d2) {
            if (d2 && d2.success && !d2.skipped) {
              addChatMessage('system', '战斗', '⚔ ' + d2.unit + ' 选择：' + (d2.option && d2.option.label ? d2.option.label : ''), activeChannelId() || 'story');
              if (d2.executed && d2.executed.length) {
                d2.executed.forEach(function(e) { addChatMessage('system', '战斗', e, activeChannelId() || 'story'); });
              } else {
                chosen.push(d2);
              }
            } else if (d2 && d2.success && d2.skipped) {
              addChatMessage('system', '战斗', d2.unit + ' 选择不行动。', activeChannelId() || 'story');
            }
          });
        });
        chain.then(function() {
          if (chosen.length) {
            var txt = chosen.map(function(d2) {
              return '单位「' + d2.unit + '」选择「' + (d2.option && d2.option.label ? d2.option.label : '') + '」' + (d2.option && d2.option.desc ? '（' + d2.option.desc + '）' : '');
            }).join('；');
            sendToAI('【选择结算】' + txt + '。请按当前规则书规则结算这些选择并继续剧情（需要掷骰的按规则正常结算）。不要输出 [[turn:end]]。', { silent: true, channelId: activeChannelId() || 'story' });
          }
        });
      })
      .catch(function() {});
  }
  function askChoice(item) {
    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'reaction-overlay';
      var box = document.createElement('div');
      box.className = 'reaction-box';
      var opts = (item.options || []).map(function(o, i) {
        return '<button type="button" class="btn-small reaction-opt" data-i="' + i + '" title="' + _esc(o.desc || '') + '">' + _esc(o.label) + '</button>';
      }).join('');
      box.innerHTML =
        '<div class="reaction-title">⚔ ' + _esc(item.title || '行动选择') + '</div>' +
        '<div class="reaction-who">' + _esc(item.unit) + '</div>' +
        '<div class="reaction-desc">' + _esc(item.desc || '') + '</div>' +
        '<div class="reaction-opts">' + opts + '<button type="button" class="btn-small reaction-skip">不行动</button></div>';
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      function close(v) { try { document.body.removeChild(overlay); } catch (e) {} resolve(v); }
      overlay.addEventListener('click', function(e) {
        var opt = e.target.closest('.reaction-opt');
        if (opt) { close({ optionIndex: Number(opt.getAttribute('data-i') || 0) }); return; }
        if (e.target.closest('.reaction-skip') || e.target === overlay) close(null);
      });
    });
  }

  window.CombatUI = {
    startCombat: startCombat,
    endCombatRound: endCombatRound,
    endCombat: endCombat,
    handleTurnAdvance: handleTurnAdvance,
    parseEventMarks: parseEventMarks,
    handleCombatEvents: handleCombatEvents
  };
})();
