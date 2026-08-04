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

    // 如果没有数据，创建示例角色
    if (window.MapEngine.getAllTokens().length === 0) {
      createSampleData();
    }

    window._trpgReady = true;
    console.log('TrpgRecode v2.0 初始化完成');
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

  function createSampleData() {
    const sampleTokens = [
      {
        name: '亚瑟·光刃',
        displayName: '亚瑟',
        color: '#4ecdc4',
        gridX: 3, gridY: 2,
        hp: 42, maxHp: 42,
        data: {
          'HP_current': 42, 'HP_max': 42,
          'AC': 18, 'Speed': '30ft',
          'STR': 18, 'DEX': 12, 'CON': 16,
          'INT': 10, 'WIS': 14, 'CHA': 12,
          'Class': '圣武士', 'Level': 5,
          'Initiative': 1
        }
      },
      {
        name: '莉娜·星火',
        displayName: '莉娜',
        color: '#ff6b9d',
        gridX: 0, gridY: 4,
        hp: 32, maxHp: 32,
        data: {
          'HP_current': 32, 'HP_max': 32,
          'AC': 14, 'Speed': '30ft',
          'STR': 8, 'DEX': 14, 'CON': 14,
          'INT': 18, 'WIS': 12, 'CHA': 10,
          'Class': '法师', 'Level': 5,
          'Initiative': 2
        }
      },
      {
        name: '索恩·暗影',
        displayName: '索恩',
        color: '#7c6ff7',
        gridX: -2, gridY: 1,
        hp: 38, maxHp: 38,
        data: {
          'HP_current': 38, 'HP_max': 38,
          'AC': 16, 'Speed': '35ft',
          'STR': 12, 'DEX': 18, 'CON': 14,
          'INT': 10, 'WIS': 16, 'CHA': 8,
          'Class': '游侠', 'Level': 5,
          'Initiative': 4
        }
      },
      {
        name: '格鲁姆·铁锤',
        displayName: '格鲁姆',
        color: '#f0a040',
        gridX: 5, gridY: 0,
        hp: 55, maxHp: 55,
        data: {
          'HP_current': 55, 'HP_max': 55,
          'AC': 17, 'Speed': '25ft',
          'STR': 20, 'DEX': 10, 'CON': 18,
          'INT': 8, 'WIS': 12, 'CHA': 10,
          'Class': '野蛮人', 'Level': 5,
          'Initiative': 0
        }
      }
    ];

    for (const t of sampleTokens) {
      window.MapEngine.addToken(t);
    }

    window.UIManager.refreshCharacterList();
    window.MapEngine.zoomFit();

    window.UIManager.addChatMessage('system', '系统',
      '欢迎使用 TrpgRecode！已加载示例冒险者小队。\n' +
      '• 输入 2d6+3 等表达式掷骰\n' +
      '• 以 /ai 开头可将消息发送给AI GM\n' +
      '• 在右侧「规则」面板上传规则书（PDF/CHM），AI会自动整理\n' +
      '• 在「设置」面板配置AI连接后即可使用全部AI功能'
    );
  }

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
