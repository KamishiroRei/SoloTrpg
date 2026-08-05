/* ============================================
   TrpgRecode - 插件运行时（核心）
   AI动态编写的功能模块 → 热加载执行
   插件模型：Ruler/<系统>/plugins/<插件id>/
     manifest.json  { id, name, version, type, description }
     index.js       entry代码（module.exports.register(api) 或 exports.default(api)）
   宿主渲染策略：Ruler/_host_plugins/<插件id>/（type=host）
     host插件通过 api.setStrategy() 覆盖渲染策略（容器/形态）
   ============================================ */

const PluginRuntime = (() => {
  'use strict';

  let serverUrl = (function() {
    if (typeof window !== 'undefined' && window.location.port && window.location.port !== '5500' && window.location.port !== '8080') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  })();

  let loaded = {};        // pluginId -> { manifest, exports }
  let activeSystem = null;

  // ── 渲染策略（默认：渲染到规则书详情面板内的#plugin-panels，无卡片头，直接显示render内容=按钮式） ──

  const DEFAULT_STRATEGY = {
    containerSelector: '#plugin-panels',   // 插件渲染容器
    headless: true,                        // 不渲染卡片头（📦标题条），直接显示插件render内容
    unloadButton: true                     // 面板右上角保留小✕卸载按钮
  };
  let strategy = Object.assign({}, DEFAULT_STRATEGY);
  let hostPluginsLoaded = false;

  // ── 插件API（注入给插件代码） ─────────────────────

  function openRuleFileInNewWindow(system, file) {
    // 通用打开式速查：新窗口打开可读视图（后端智能解码 GBK + HTML转Markdown，避免原始HTML乱码）
    const url = serverUrl + '/view.html?system=' + encodeURIComponent(system) + '&file=' + encodeURIComponent(file);
    window.open(url, '_blank');
  }

  function makePluginAPI(system, manifest) {
    const api = {
      system,
      manifest,
      onLoad: null,
      onUnload: null,
      addPanel: function(opts) { registerPanel(api, opts); },
      addTool: function(opts) { registerTool(opts); },
      fetch: (url, opts) => fetch(serverUrl + url, opts),
      log: (...args) => console.log(`[插件:${manifest.name}]`, ...args),
      warn: (...args) => console.warn(`[插件:${manifest.name}]`, ...args),
      // ── 规则专属角色卡（manifest.type = character-sheet） ──
      // handler = { renderCreate(container, ctx, done), renderDetail(container, token, ctx) }
      // done(collector)：collector() 返回 { name, displayName, color, data }，宿主保存
      registerCharacterSheet: function(handler) { api._sheetHandler = handler || null; },
      // ── 通用打开式速查（新窗口打开规则源文件） ──
      openRuleFile: function(file) { openRuleFileInNewWindow(system, file); },
      // ── 通用词条悬停（容器内 [data-term] 元素悬停显示效果摘要） ──
      bindTermTips: function(rootEl) {
        if (window.TrpgTermTip && rootEl) window.TrpgTermTip.bind(rootEl, system);
      }
    };
    return api;
  }

  function registerPanel(api, opts) {
    // 优先使用规则书详情容器 #rules-content-view 内部的 #plugin-panels；
    // 若不存在，则清空 #rules-content-view 并在其中创建容器（专用插件加载时替换通用说明，不会顶到下面）。
    const view = document.querySelector('#rules-content-view');
    let panels = view ? view.querySelector('#plugin-panels') : null;
    if (!panels) {
      if (!view) return;
      view.innerHTML = '';
      panels = document.createElement('div');
      panels.id = 'plugin-panels';
      view.appendChild(panels);
    }
    const box = document.createElement('div');
    box.className = 'plugin-panel' + (strategy.headless ? ' plugin-panel-headless' : '');
    box.dataset.pluginId = api.manifest.id;
    if (strategy.headless) {
      box.innerHTML = '<div class="plugin-panel-body"></div>';
      if (strategy.unloadButton) {
        box.innerHTML = '<button class="plugin-panel-close plugin-panel-close-float" title="卸载插件">✕</button>' + box.innerHTML;
      }
    } else {
      box.innerHTML = '<div class="plugin-panel-head">📦 ' + (opts.title || api.manifest.name) +
        '<button class="btn-small plugin-panel-close" title="卸载插件">✕</button></div>' +
        '<div class="plugin-panel-body"></div>';
    }
    const body = box.querySelector('.plugin-panel-body');
    box.querySelector('.plugin-panel-close').addEventListener('click', function() {
      unloadPlugin(api.manifest.id);
    });
    panels.appendChild(box);
    try {
      if (typeof opts.render === 'function') opts.render(body, api);
      else if (opts.html) body.innerHTML = opts.html;
    } catch (e) {
      body.innerHTML = '<div style="color:#ff7b7b;">插件渲染错误: ' + String(e.message) + '</div>';
    }
  }

  function registerTool(opts) {
    // 工具类插件：在规则书面板头部临时注入按钮（简化：直接执行一次）
    if (typeof opts.action === 'function') {
      try { opts.action(); } catch (e) { console.warn('[插件] 工具执行失败:', e); }
    }
  }

  // ── 宿主渲染策略插件（Ruler/_host_plugins/，type=host） ──

  async function loadHostPlugins() {
    if (hostPluginsLoaded) return;
    hostPluginsLoaded = true;
    try {
      const resp = await fetch(`${serverUrl}/api/plugins/host`);
      if (!resp.ok) return;
      const list = await resp.json();
      for (const manifest of list) {
        try {
          const resp2 = await fetch(`${serverUrl}/api/plugins/host-entry?id=${encodeURIComponent(manifest.id)}`);
          if (!resp2.ok) continue;
          const code = await resp2.text();
          const api = {
            manifest,
            setStrategy: function(partial) { strategy = Object.assign({}, strategy, partial || {}); },
            resetStrategy: function() { strategy = Object.assign({}, DEFAULT_STRATEGY); },
            getStrategy: function() { return Object.assign({}, strategy); },
            log: (...a) => console.log(`[host插件:${manifest.name}]`, ...a)
          };
          const fn = new Function('PluginAPI', code + '\n;return module.exports;');
          const exports = fn(api);
          if (exports && typeof exports.register === 'function') exports.register(api);
          console.log('[host插件] 已加载:', manifest.name);
        } catch (e) {
          console.warn('[host插件] 加载失败:', manifest.id, e);
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ── 插件加载 ──────────────────────────────────────

  async function loadSystemPlugins(system) {
    if (!system) return [];
    await loadHostPlugins();
    activeSystem = system;
    try {
      const resp = await fetch(`${serverUrl}/api/plugins/list?system=${encodeURIComponent(system)}`);
      if (!resp.ok) return [];
      const list = await resp.json();
      const ids = [];
      for (const manifest of list) {
        if (loaded[manifest.id]) { ids.push(manifest.id); continue; }
        try {
          await loadPlugin(system, manifest);
          ids.push(manifest.id);
        } catch (e) {
          console.warn('[插件] 加载失败:', manifest.id, e);
        }
      }
      return ids;
    } catch (e) {
      return [];
    }
  }

  async function loadPlugin(system, manifest) {
    const resp = await fetch(`${serverUrl}/api/plugins/entry?system=${encodeURIComponent(system)}&id=${encodeURIComponent(manifest.id)}`);
    if (!resp.ok) throw new Error('入口获取失败 HTTP ' + resp.status);
    const code = await resp.text();

    const module = { exports: {} };
    const api = makePluginAPI(system, manifest);
    const fn = new Function('module', 'exports', 'PluginAPI', code + '\n;return module.exports;');
    const exports = fn(module, module.exports, api);

    loaded[manifest.id] = { manifest, exports, api };
    if (exports && typeof exports.register === 'function') exports.register(api);
    else if (exports && typeof exports.default === 'function') exports.default(api);
    if (api.onLoad) api.onLoad();
    console.log('[插件] 已加载:', manifest.name, 'v' + (manifest.version || '1.0'));
    return loaded[manifest.id];
  }

  function unloadPlugin(id) {
    const item = loaded[id];
    if (!item) return;
    try {
      if (item.exports && typeof item.exports.unload === 'function') item.exports.unload();
    } catch (e) { /* ignore */ }
    delete loaded[id];
    document.querySelectorAll(`.plugin-panel[data-plugin-id="${id}"]`).forEach(el => el.remove());
    console.log('[插件] 已卸载:', id);
  }

  function unloadSystemPlugins() {
    for (const id of Object.keys(loaded)) unloadPlugin(id);
    activeSystem = null;
  }

  function getLoaded() { return Object.keys(loaded); }

  // 当前系统已加载的规则专属角色卡插件（manifest.type === 'character-sheet'）
  function getCharacterSheet() {
    for (const id of Object.keys(loaded)) {
      const item = loaded[id];
      if (item && item.manifest && item.manifest.type === 'character-sheet') {
        return { manifest: item.manifest, api: item.api, handler: (item.api && item.api._sheetHandler) || null };
      }
    }
    return null;
  }

  // ── 初始化 ────────────────────────────────────────

  function init(options = {}) {
    if (options.serverUrl) serverUrl = options.serverUrl;
  }

  return {
    init,
    loadSystemPlugins,
    loadHostPlugins,
    loadPlugin,
    unloadPlugin,
    unloadSystemPlugins,
    getLoaded,
    getCharacterSheet,
    openRuleFile: openRuleFileInNewWindow
  };
})();

if (typeof window !== 'undefined') window.PluginRuntime = PluginRuntime;

// ── 通用词条悬停（Term Hover Preview，宿主级，所有插件共用） ──
// 插件渲染词条时加 data-term="词条名"，容器内悬停自动查询规则索引并显示效果摘要
(function () {
  'use strict';
  let tipEl = null;
  const cache = {};
  const esc = function (s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  };
  function ensureEl() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'term-tip';
      tipEl.style.display = 'none';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function show(el, html) {
    const t = ensureEl();
    t.innerHTML = html;
    t.style.display = 'block';
    const rect = el.getBoundingClientRect();
    t.style.left = Math.max(4, Math.min(window.innerWidth - 320, rect.left)) + 'px';
    t.style.top = (rect.bottom + 6) + 'px';
  }
  function hide() { if (tipEl) tipEl.style.display = 'none'; }
  function serverUrl() {
    if (window.location.port && window.location.port !== '5500' && window.location.port !== '8080') return window.location.origin;
    return 'http://localhost:3000';
  }
  async function fetchTerm(system, term) {
    const key = system + '|' + term;
    if (cache[key]) return cache[key];
    let text = '';
    try {
      const resp = await fetch(serverUrl() + '/api/rules/index?system=' + encodeURIComponent(system) + '&q=' + encodeURIComponent(term) + '&limit=3');
      const data = await resp.json();
      const items = (data && data.items) || [];
      if (items.length) {
        const first = items[0];
        const content = String(first.content || first.title || first.rel || '').replace(/\s+/g, ' ').trim();
        text = '<b>' + esc(first.title || term) + '</b><br>' + esc(content.substring(0, 160)) +
          (first.rel ? '<br><span style="color:var(--text-muted);font-size:11px;">' + esc(first.rel) + '</span>' : '');
      } else {
        text = '<span class="term-tip-empty">未找到：' + esc(term) + '</span>';
      }
      cache[key] = text;
    } catch (e) {
      text = esc(term);
    }
    return text;
  }
  function bind(rootEl, system) {
    if (!rootEl) return;
    rootEl.addEventListener('mouseover', function (e) {
      const el = e.target && e.target.closest ? e.target.closest('[data-term]') : null;
      if (!el) return;
      const term = el.getAttribute('data-term');
      if (!term) return;
      fetchTerm(system || '', term).then(function (html) { show(el, html); });
    });
    rootEl.addEventListener('mouseout', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-term]')) hide();
    });
  }
  window.TrpgTermTip = { bind: bind, show: show, hide: hide };
})();
