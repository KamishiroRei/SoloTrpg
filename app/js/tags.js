/* ============================================
   TrpgRecode - 标签系统底层（Tag System）
   全局统一的"标签化"组件：任何 TRPG 数据（特性/装备/法术/状态/效果/熟练/豁免/资源）
   都以"标签"为基本展示单元，携带结构化信息，支持：
   - 类型化色系（种族/职业/背景/武器/护甲/状态/学派/来源…）
   - 浮动详情（hover 显示描述，绝对定位不改变布局）
   - 动态数值（@strmod/@pb/@level 表达式实时求值显示）
   - 来源标注（自动/自定义/职业·战士/背景·工匠…）
   - 移除/点击交互（removable / onClick）
   宿主提供本底层；规则插件通过 window.TrpgTag 使用（独立窗口内同源可用）。
   ============================================ */
(function () {
  'use strict';

  const TONES = {
    // 来源/类型色系：key -> { bg, border, color }
    race:     { bg: 'rgba(91,141,239,.14)',  border: 'rgba(91,141,239,.45)',  color: '#9dbdf7' },   // 种族·蓝
    cls:      { bg: 'rgba(201,168,76,.12)',  border: 'rgba(201,168,76,.45)',  color: '#e0c870' },   // 职业·金
    bg:       { bg: 'rgba(240,180,41,.12)',  border: 'rgba(240,180,41,.45)',  color: '#f0c95a' },   // 背景·琥珀
    subclass: { bg: 'rgba(201,168,76,.18)',  border: 'rgba(201,168,76,.55)',  color: '#f5d98a' },   // 副职·深金
    custom:   { bg: 'rgba(124,143,189,.12)', border: 'rgba(124,143,189,.4)',  color: '#a8b6d8' },   // 自定义·灰蓝
    feat:     { bg: 'rgba(201,168,76,.10)',  border: 'rgba(201,168,76,.4)',   color: '#d9c072' },   // 特性·金
    weapon:   { bg: 'rgba(229,72,77,.13)',   border: 'rgba(229,72,77,.45)',   color: '#ff8a8a' },   // 武器·红
    armor:    { bg: 'rgba(91,141,239,.13)',  border: 'rgba(91,141,239,.4)',   color: '#9dbdf7' },   // 护甲·蓝
    shield:   { bg: 'rgba(63,142,239,.15)',  border: 'rgba(63,142,239,.5)',   color: '#a8ccff' },   // 盾·亮蓝
    item:     { bg: 'rgba(46,204,113,.12)',  border: 'rgba(46,204,113,.4)',   color: '#7fd8a0' },   // 物品·绿
    wondrous: { bg: 'rgba(201,168,76,.12)',  border: 'rgba(201,168,76,.42)',  color: '#e0c870' },   // 奇物·金
    tool:     { bg: 'rgba(124,143,189,.12)', border: 'rgba(124,143,189,.4)',  color: '#a8b6d8' },   // 工具·灰蓝
    status:   { bg: 'rgba(229,72,77,.12)',   border: 'rgba(229,72,77,.4)',    color: '#ff8a8a' },   // 状态·红
    effect:   { bg: 'rgba(155,89,182,.13)',  border: 'rgba(155,89,182,.45)',  color: '#c79ae0' },   // 效果·紫
    spell:    { bg: 'rgba(91,141,239,.10)',  border: 'rgba(91,141,239,.38)',  color: '#9dbdf7' },   // 法术·蓝
    resource: { bg: 'rgba(240,180,41,.10)',  border: 'rgba(240,180,41,.4)',   color: '#f0c95a' },   // 资源·琥珀
    save:     { bg: 'rgba(88,160,90,.12)',   border: 'rgba(88,160,90,.4)',    color: '#9fe8a8' },   // 豁免·绿
    skill:    { bg: 'rgba(88,160,90,.10)',   border: 'rgba(88,160,90,.38)',   color: '#9fe8a8' },   // 技能·绿
    info:     { bg: 'rgba(124,143,189,.1)',  border: 'rgba(124,143,189,.35)', color: '#a8b6d8' },   // 信息
    gold:     { bg: 'rgba(201,168,76,.14)',  border: 'rgba(201,168,76,.5)',   color: '#f0d48a' },   // 金色高亮
    neutral:  { bg: 'rgba(255,255,255,.06)', border: 'rgba(255,255,255,.16)', color: '#cfcfe8' }    // 中性
  };

  // 法术学派 → 类型（供法术标签使用）
  const SCHOOL_TYPE = {
    '塑能': 'spell', '防护': 'spell', '咒法': 'spell', '预言': 'spell',
    '惑控': 'spell', '幻术': 'spell', '死灵': 'spell', '变化': 'spell'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 动态数值表达式求值：@pb=熟练加值 @level=等级 @strmod/@dexmod/@conmod/@intmod/@wismod/@chamod
  // 传入派生值上下文 { pb, level, mods:{str:..} }，返回求值后的数字
  function evalExpr(expr, ctx) {
    expr = String(expr || '').trim();
    if (!expr) return 0;
    var s = expr
      .replace(/@pb\b/gi, String(Number(ctx.pb) || 0))
      .replace(/@level\b/gi, String(Number(ctx.level) || 1))
      .replace(/@strmod\b/gi, String(Number(ctx.mods && ctx.mods.str) || 0))
      .replace(/@dexmod\b/gi, String(Number(ctx.mods && ctx.mods.dex) || 0))
      .replace(/@conmod\b/gi, String(Number(ctx.mods && ctx.mods.con) || 0))
      .replace(/@intmod\b/gi, String(Number(ctx.mods && ctx.mods.int) || 0))
      .replace(/@wismod\b/gi, String(Number(ctx.mods && ctx.mods.wis) || 0))
      .replace(/@chamod\b/gi, String(Number(ctx.mods && ctx.mods.cha) || 0));
    // 安全求值：仅允许数字与 + - * / ( ) 空格
    if (!/^[\d\s+\-*/().]+$/.test(s)) return null;
    try {
      // eslint-disable-next-line no-new-func
      var v = new Function('return (' + s + ')')();
      return typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null;
    } catch (e) { return null; }
  }

  // 渲染单个标签（返回 HTML 字符串）
  // opts: { name, type, tone, source, desc, detail, extra, dynamic, ctx, active, removable, onClick, dataAct, dataI, dataName, dataCat, rmAct, title }
  // rmAct：移除按钮（✕）点击时宿主应执行的行为标识（如 'item-del'），由宿主 click 委托的 data-tg-rm 分支处理
  function chip(opts) {
    opts = opts || {};
    var tone = TONES[opts.tone || opts.type] || TONES.neutral;
    var classes = ['tg'];
    if (opts.active) classes.push('on');
    if (opts.type) classes.push('tg-' + opts.type);
    var attrs = '';
    if (opts.dataAct) attrs += ' data-act="' + esc(opts.dataAct) + '"';
    if (opts.dataI !== undefined && opts.dataI !== null) attrs += ' data-i="' + opts.dataI + '"';
    if (opts.dataName !== undefined && opts.dataName !== null) attrs += ' data-name="' + esc(opts.dataName) + '"';
    if (opts.dataCat !== undefined && opts.dataCat !== null) attrs += ' data-cat="' + esc(opts.dataCat) + '"';
    if (opts.rmAct) attrs += ' data-tg-rm-act="' + esc(opts.rmAct) + '"';
    // 详情统一走浮动层（desc/detail 优先级）
    var detailText = opts.detail || opts.desc || '';
    if (detailText) attrs += ' data-tg-desc="' + encodeURIComponent(detailText) + '"';
    if (opts.meta) { try { attrs += ' data-tg-meta="' + encodeURIComponent(JSON.stringify(opts.meta)) + '"'; } catch (e) {} }
    if (opts.source) attrs += ' data-tg-source="' + encodeURIComponent(opts.source) + '"';
    attrs += ' data-tg-name="' + encodeURIComponent(opts.name == null ? '' : opts.name) + '"';
    var nameHtml = '<span class="tg-n">' + esc(opts.name == null ? '' : opts.name) + '</span>';
    var extraHtml = opts.extra != null && opts.extra !== ''
      ? '<span class="tg-x">' + esc(opts.extra) + '</span>' : '';
    var srcHtml = opts.source
      ? '<span class="tg-src">' + esc(opts.source) + '</span>' : '';
    var rmHtml = opts.removable
      ? '<button type="button" class="tg-rm" data-tg-rm="1" title="移除">✕</button>' : '';
    return '<span class="' + classes.join(' ') + '"' + attrs +
      (opts.title && !detailText ? ' title="' + esc(opts.title) + '"' : ' aria-label="' + esc(opts.title || opts.name || '') + '"') +
      ' style="' + (tone ? '--tg-bg:' + tone.bg + ';--tg-bd:' + tone.border + ';--tg-fg:' + tone.color + ';' : '') + '">' +
      nameHtml + extraHtml + srcHtml + rmHtml + '</span>';
  }

  // 浮动详情层（全局唯一，绝对定位）
  var tipEl = null;
  function ensureTip() {
    if (tipEl && document.body.contains(tipEl)) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'tg-tip';
    tipEl.style.display = 'none';
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(el) {
    var raw = el.getAttribute('data-tg-desc');
    if (!raw) return;
    var desc = '', name = '', source = '', meta = null;
    try { desc = decodeURIComponent(raw); } catch (e) { desc = raw; }
    try { name = decodeURIComponent(el.getAttribute('data-tg-name') || ''); } catch (e) {}
    try { source = decodeURIComponent(el.getAttribute('data-tg-source') || ''); } catch (e) {}
    try { meta = JSON.parse(decodeURIComponent(el.getAttribute('data-tg-meta') || '')); } catch (e) {}
    var rows = '';
    if (meta && typeof meta === 'object') Object.keys(meta).forEach(function(k) {
      if (meta[k] == null || meta[k] === '') return;
      rows += '<div class="tg-tip-row"><span>' + esc(k) + '</span><b>' + esc(Array.isArray(meta[k]) ? meta[k].join('、') : meta[k]) + '</b></div>';
    });
    var tip = ensureTip();
    tip.innerHTML = (name ? '<div class="tg-tip-title">' + esc(name) + (source ? '<small>' + esc(source) + '</small>' : '') + '</div>' : '') + rows + '<div class="tg-tip-b">' + esc(desc) + '</div>';
    tip.style.display = 'block';
    var rect = el.getBoundingClientRect();
    var left = Math.max(8, Math.min(window.innerWidth - 388, rect.left));
    var top = rect.bottom + 8;
    var h = Math.min(tip.offsetHeight || 260, window.innerHeight - 16);
    if (top + h > window.innerHeight) top = Math.max(8, rect.top - h - 8);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.style.display = 'none';
  }

  // 为容器绑定标签浮动详情（事件委托，幂等）
  function bindTips(root) {
    if (!root || root.__trpgTagTipsBound) return;
    root.__trpgTagTipsBound = true;
    root.addEventListener('mouseover', function (e) {
      var t = e.target;
      while (t && t !== root && !(t.getAttribute && t.getAttribute('data-tg-desc'))) t = t.parentNode;
      if (t && t !== root && t.getAttribute('data-tg-desc')) showTip(t);
    });
    root.addEventListener('mouseout', function (e) {
      var t = e.target;
      while (t && t !== root && !(t.getAttribute && t.getAttribute('data-tg-desc'))) t = t.parentNode;
      if (t && t !== root) hideTip();
    });
  }

  // 渲染一组标签（便捷）
  function chips(list, opts) {
    return (list || []).map(function (it) {
      return chip(typeof it === 'string' ? Object.assign({}, opts, { name: it }) : Object.assign({}, opts, it));
    }).join('');
  }

  // 动态数值标签：传入表达式与上下文，实时求值并显示（ctx 变化后重新渲染）
  function dynamic(name, expr, ctx, opts) {
    opts = Object.assign({}, opts);
    var v = evalExpr(expr, ctx);
    var txt = v === null ? '?' : (v >= 0 ? '+' : '') + v;
    opts.name = name;
    opts.extra = txt;
    opts.dynamic = expr;
    opts.title = opts.title || ('动态数值：' + expr + ' → ' + txt);
    return chip(opts);
  }

  // 从规则数据解析标签详情（供插件查询使用：feat/spell/weapon）
  // resolve(name, type, ctx) → Promise<string> 或 string；ctx.fetch 提供规则数据查询能力
  var resolveCache = {};
  function resolve(name, type, ctx) {
    var key = type + '|' + name;
    if (resolveCache[key]) return Promise.resolve(resolveCache[key]);
    return new Promise(function (done) {
      try {
        if (!ctx || typeof ctx.fetch !== 'function') { done(''); return; }
        ctx.fetch('/api/rules/index?system=' + encodeURIComponent(ctx.system || '') + '&q=' + encodeURIComponent(name) + '&limit=6')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var items = (data && data.items) || (Array.isArray(data) ? data : []);
            var hit = null;
            for (var i = 0; i < items.length; i++) {
              var t = String(items[i].title || items[i].name || '');
              if (t === name || String(t).indexOf(name) === 0) { hit = items[i]; break; }
            }
            if (!hit && items.length) hit = items[0];
            var sum = hit ? String(hit.summary || hit.content || '') : '';
            resolveCache[key] = sum;
            done(sum);
          })
          .catch(function () { resolveCache[key] = ''; done(''); });
      } catch (e) { done(''); }
    });
  }

  window.TrpgTag = {
    TONES: TONES,
    SCHOOL_TYPE: SCHOOL_TYPE,
    esc: esc,
    chip: chip,
    chips: chips,
    dynamic: dynamic,
    evalExpr: evalExpr,
    bindTips: bindTips,
    showTip: showTip,
    hideTip: hideTip,
    resolve: resolve
  };
})();
