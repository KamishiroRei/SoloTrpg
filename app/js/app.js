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
      onTokenSelected: (token) => {
        window.UIManager.onMapTokenSelected(token);
      },
      onCoordUpdate: (gx, gy) => {
        window.UIManager.onMapCoordUpdate(gx, gy);
      }
    });

    // 初始化聊天历史（供AI上下文使用）
    window._chatHistory = [];

    // 初始化UI（包含AI、规则书等所有面板）
    window.UIManager.init();

    // 初始化AI客户端（尝试连接后端）
    initAIClient();

    // 窗口大小变化
    window.addEventListener('resize', () => {
      window.MapEngine.resize();
    });

    // 加载本地存储的数据
    loadFromLocalStorage();

    window._trpgReady = true;
  }

  // ── AI客户端初始化 ────────────────────────────────

  function initAIClient() {
    // AI客户端的回调已在ui.js的setupAI中设置
    // 这里只做延迟连接检查
    setTimeout(async () => {
      if (window.AIClient) {
        const connected = await window.AIClient.checkConnection();
        if (connected) {
          console.log('[App] AI服务器已连接');
        } else {
          console.log('[App] AI服务器未连接（可稍后在设置中配置）');
        }
      }
    }, 1000);
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

      const data = JSON.parse(raw);
      if (data.mapState) {
        window.MapEngine.importState(data.mapState);
      }

      // 恢复聊天历史
      if (data.chatHistory) {
        window._chatHistory = data.chatHistory;
      }

      // AI历史由AIClient管理，延迟注入
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
