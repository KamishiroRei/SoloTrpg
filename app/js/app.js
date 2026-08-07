/* ============================================
   TrpgRecode - 主控制器 v2.0
   初始化、模块协调、AI集成、数据持久化
   ============================================ */

(function () {
  'use strict';

  // ── 初始化 ────────────────────────────────────────

  function init() {
    // 初始化地图引擎
    const canvas = document.getElementById('map-canvas');
    if (!canvas) {
      console.error('找不到地图画布元素');
      return;
    }

    window.MapEngine.init(canvas, {
      cellSize: 50,
      gridColor: '#3a3a5c',
      bgColor: '#1a1a2e',
      rangeColor: '#ff6b6b',
      onTokenSelected: (token, anchor) => {
        window.UIManager.onMapTokenSelected(token, anchor);
      },
      onTokenMoved: (token, mapId) => window.UIManager.onMapTokenMoved(token, mapId),
      onCoordUpdate: (gx, gy, info) => {
        window.UIManager.onMapCoordUpdate(gx, gy, info);
      },
      onZoomChanged: () => window.UIManager.updateZoomLabel(),
      onMapsChanged: (maps, activeId) => window.UIManager.renderMapTabs(maps, activeId),
      onMapChanged: (map) => window.UIManager.onActiveMapChanged(map),
      onRangeDraft: (range, anchor) => window.UIManager.onRangeDraft(range, anchor),
      onRangeSelected: (range, anchor) => window.UIManager.onRangeSelected(range, anchor),
      onMeasureUpdate: (info, anchor) => window.UIManager.onMeasureUpdate(info, anchor),
      onMeasureComplete: (info) => window.UIManager.onMeasureComplete(info),
      onStateChanged: (state, reason) => window.UIManager.onMapStateChanged(state, reason)
    });

    // 初始化聊天历史（供AI上下文使用）
    window._chatHistory = [];

    // 初始化UI（包含AI、规则书等所有面板）
    // 攻坚修复：UI 初始化异常不得阻断后续连接检测（此前 UIManager.init 内任一抛错
    // 都会中断 init → initAIClient 不执行 → isConnected 永远 false → "世界尚未苏醒"）
    try {
      window.UIManager.init();
    } catch (err) {
      try {
        fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evt: 'ui-init-error', err: String((err && err.message) || err), stack: String((err && err.stack) || '').slice(0, 600), t: Date.now() }) }).catch(function () {});
      } catch (e2) {}
      console.error('[App] UIManager.init 异常（已隔离，继续连接检测）:', err);
    }

    // 初始化AI客户端（尝试连接后端）——无条件执行
    initAIClient();
    // 启动链路标记：app.js init 已执行到 initAIClient 之后（诊断用，写入后端日志）
    try {
      fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evt: 'app-init', t: Date.now() }) }).catch(function () {});
    } catch (e) {}

    // 窗口大小变化
    window.addEventListener('resize', () => {
      window.MapEngine.resize();
    });
    // 兜底：监听地图相关容器尺寸变化（WebView2 原生窗口缩放/侧栏调整等场景 window resize 可能不触发），
    // 保证被浮动面板遮挡的地图区域在窗口变化后立即重绘，避免出现未渲染的黑色区域。
    // 地图固定完整渲染原则：不做任何渲染节省，任何可能影响地图显示尺寸的变化都强制全量重绘。
    if (window.ResizeObserver) {
      try {
        var _ro = new ResizeObserver(() => {
          if (window.MapEngine && typeof window.MapEngine.resize === 'function') {
            try { window.MapEngine.resize(); } catch (e) {}
          }
        });
        ['map-canvas', 'map-wrapper', 'map-container', 'main-area', 'body'].forEach(function (id) {
          var el = id === 'body' ? document.body : document.getElementById(id);
          if (el) _ro.observe(el);
        });
      } catch (e) {
        // ResizeObserver 不可用时退化为 window resize 兜底
      }
    }

    // 加载本地存储的数据
    loadFromLocalStorage();

    window._trpgReady = true;
  }

  // ── AI客户端初始化 ────────────────────────────────

  function initAIClient() {
    // 立即连接检测（用户要求：开了就是开了，立刻响应立刻启动；禁止 setTimeout 硬编码延迟）
    try {
      fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evt: 'init-ai-now', t: Date.now() }) }).catch(function () {});
    } catch (e) {}
    if (window.AIClient) {
      window.AIClient.checkConnection().then(function (connected) {
        if (connected) {
          console.log('[App] AI服务器已连接');
        } else {
          console.log('[App] AI服务器未连接（可稍后在设置中配置）');
        }
      }).catch(function () {
        console.log('[App] AI连接检测异常');
      });
    } else {
      try {
        fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evt: 'aiclient-missing', t: Date.now() }) }).catch(function () {});
      } catch (e) {}
    }
  }

  // ── 本地存储 ──────────────────────────────────────

  function saveToLocalStorage() {
    try {
      const mapState = window.MapEngine.exportState();

      // 附加AI对话历史
      let aiHistory = [];
      if (window.AIClient) {
        aiHistory = window.AIClient.getHistory();
      }

      const data = {
        mapState,
        aiHistory: aiHistory.slice(-50), // 只保留最近50条
        chatHistory: window._chatHistory || [],
        timestamp: Date.now(),
        version: 2
      };

      localStorage.setItem('trpg_recode_save', JSON.stringify(data));
    } catch (e) {
      // localStorage 可能不可用或已满
      console.warn('[App] 自动保存失败:', e.message);
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('trpg_recode_save');
      if (!raw) return;

      let data = JSON.parse(raw);
      // 存档自动迁移
      data = migrateSave(data);

      if (data.mapState) {
        window.MapEngine.importState(data.mapState);
      }

      if (data.chatHistory) {
        window._chatHistory = data.chatHistory;
      }

      if (data.aiHistory && data.aiHistory.length > 0 && window.AIClient) {
        setTimeout(() => {
          for (const msg of data.aiHistory) {
            window.AIClient._addHistoryItem(msg);
          }
        }, 1500);
      }
    } catch (e) {
      console.warn('[App] 数据加载失败:', e.message);
    }
  }

  // 存档版本迁移（仅当格式结构性变化时增加case）
  function migrateSave(data) {
    const v = data.version || 1;
    if (v === 1) { data.version = 2; /* 预留：v1→v2迁移逻辑 */ }
    // if (v === 2) { /* 未来v2→v3迁移逻辑 */ data.version = 3; }
    return data;
  }

  // ── 示例数据 ──────────────────────────────────────

  // ── 自动保存 ──────────────────────────────────────

  function setupAutoSave() {
    setInterval(() => {
      if (window._trpgReady) {
        saveToLocalStorage();
      }
    }, 30000);

    window.addEventListener('beforeunload', () => {
      saveToLocalStorage();
    });
  }

  // ── 全局错误处理 ──────────────────────────────────

  window.addEventListener('error', (e) => {
    console.error('[App] 全局错误:', e.message, e.filename, e.lineno);
  });

  // ── 启动 ──────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      setupAutoSave();
    });
  } else {
    init();
    setupAutoSave();
  }

})();
