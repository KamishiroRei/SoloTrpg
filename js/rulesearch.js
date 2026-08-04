/* ============================================
   TrpgRecode - 规则书搜索引擎（前端）
   模糊搜索 → 压缩摘要 → token优化上下文注入

   设计：
   1. 本地缓存压缩索引（IndexedDB或内存）
   2. 搜索时只匹配摘要和关键词，不读原文
   3. 仅在需要原文时请求后端按偏移精确读取
   4. 搜索结果压缩后注入AI上下文
   ============================================ */

const RuleSearch = (() => {
  'use strict';

  // ── 本地缓存 ──────────────────────────────────────

  let searchIndex = null;      // 压缩索引 { byCategory, byKeyword, entries }
  let activeSystem = null;     // 当前激活的规则系统
  let serverUrl = 'http://localhost:3000';

  // ── 初始化 ────────────────────────────────────────

  function init(options = {}) {
    if (options.serverUrl) serverUrl = options.serverUrl;
    loadLocalCache();
  }

  /**
   * 从localStorage加载缓存的索引
   */
  function loadLocalCache() {
    try {
      const saved = localStorage.getItem('trpg_rule_index');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.system && data.index) {
          activeSystem = data.system;
          searchIndex = data.index;
          console.log('[规则搜索] 已加载本地缓存:', activeSystem, searchIndex.all?.length || 0, '条');
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function saveLocalCache() {
    try {
      if (searchIndex && activeSystem) {
        localStorage.setItem('trpg_rule_index', JSON.stringify({
          system: activeSystem,
          index: searchIndex,
          timestamp: Date.now()
        }));
      }
    } catch (e) { /* ignore */ }
  }

  // ── 从后端拉取压缩索引 ────────────────────────────

  async function loadSystemIndex(systemName) {
    try {
      const resp = await fetch(`${serverUrl}/api/rules/index?system=${encodeURIComponent(systemName)}`);
      if (!resp.ok) return false;

      const data = await resp.json();
      if (data.entries && data.entries.length > 0) {
        activeSystem = systemName;
        searchIndex = window.TextCompressor.buildIndex(data.entries);
        saveLocalCache();
        return true;
      }
    } catch (e) {
      console.warn('[规则搜索] 加载索引失败:', e.message);
    }
    return false;
  }

  /**
   * 自动扫描并加载所有可用的规则系统
   */
  async function autoDiscover() {
    try {
      const resp = await fetch(`${serverUrl}/api/rules/list`);
      if (!resp.ok) return [];

      const systems = await resp.json();
      const available = [];

      for (const sys of systems) {
        // 检查是否有压缩索引
        const hasIndex = sys.files.some(f => f === '_index.json' || f === 'compressed.md');
        available.push({
          name: sys.name,
          fileCount: sys.files.length,
          hasIndex,
          ready: hasIndex
        });
      }

      // 自动加载第一个有索引的系统
      for (const sys of available) {
        if (sys.ready && sys.name !== activeSystem) {
          await loadSystemIndex(sys.name);
          break;
        }
      }

      return available;
    } catch (e) {
      return [];
    }
  }

  // ── 搜索 ──────────────────────────────────────────

  /**
   * 执行模糊搜索
   * @param {string} query - 搜索词
   * @param {object} options - { category, maxResults }
   */
  function search(query, options = {}) {
    if (!searchIndex || !searchIndex.all) return [];

    let entries = searchIndex.all;

    // 分类过滤
    if (options.category && searchIndex.byCategory[options.category]) {
      const catIds = new Set(searchIndex.byCategory[options.category]);
      entries = entries.filter(e => catIds.has(e.id));
    }

    const results = window.TextCompressor.fuzzySearch(query, entries, searchIndex);

    return results.slice(0, options.maxResults || 15);
  }

  /**
   * 搜索并生成AI上下文
   */
  function searchForAI(query, maxChars = 2000) {
    const results = search(query);
    return window.TextCompressor.searchToContext(results, maxChars);
  }

  /**
   * 按分类获取条目列表
   */
  function getByCategory(category) {
    if (!searchIndex || !searchIndex.byCategory[category]) return [];
    const ids = searchIndex.byCategory[category];
    return ids.map(id => searchIndex.all.find(e => e.id === id)).filter(Boolean);
  }

  /**
   * 获取所有分类
   */
  function getCategories() {
    if (!searchIndex) return [];
    return Object.keys(searchIndex.byCategory);
  }

  // ── 原文检索（仅在需要完整内容时调用） ─────────────

  /**
   * 根据条目ID获取完整原文（从后端按偏移读取）
   */
  async function getFullText(entryId) {
    if (!searchIndex || !activeSystem) return null;

    const entry = searchIndex.all.find(e => e.id === entryId);
    if (!entry || !entry.sourceFile) return null;

    try {
      const resp = await fetch(
        `${serverUrl}/api/rules/source?system=${encodeURIComponent(activeSystem)}&file=${encodeURIComponent(entry.sourceFile)}&offset=${entry.sourceOffset || 0}&length=${entry.sourceLength || 2000}`
      );
      if (!resp.ok) return null;

      const data = await resp.json();
      return data.text;
    } catch (e) {
      return null;
    }
  }

  // ── AI上下文构建 ──────────────────────────────────

  /**
   * 为AI构建规则书上下文（压缩版，token优化）
   * 
   * 策略：
   * 1. 优先注入：当前选中角色的相关规则（职业、装备等关键词匹配）
   * 2. 按需注入：用户问题中提到的关键词搜索结果
   * 3. 概览注入：所有分类的一行摘要（如果context允许）
   */
  function buildAIContext(userQuery = '', gameState = null, maxTokens = 4000) {
    if (!searchIndex) return '';

    let context = '';
    let charCount = 0;

    // 1. 游戏状态相关规则（选中角色相关）
    if (gameState && gameState.selectedToken) {
      const charData = gameState.selectedToken.data || {};
      const keywords = [];

      // 提取角色相关的关键词
      if (charData['Class'] || charData['职业']) keywords.push(charData['Class'] || charData['职业']);
      if (charData['Race'] || charData['种族']) keywords.push(charData['Race'] || charData['种族']);
      if (charData['Level'] || charData['等级']) keywords.push('等级' + (charData['Level'] || charData['等级']));

      for (const kw of keywords) {
        if (kw) {
          const results = search(kw, { maxResults: 5 });
          if (results.length > 0) {
            const ctx = window.TextCompressor.searchToContext(results, 1000 - charCount);
            if (charCount + ctx.length < maxTokens * 3) {
              context += ctx + '\n';
              charCount += ctx.length;
            }
          }
        }
      }
    }

    // 2. 用户查询关键词
    if (userQuery && userQuery.length > 2) {
      const results = search(userQuery, { maxResults: 10 });
      if (results.length > 0) {
        const remaining = maxTokens * 3 - charCount;
        const ctx = window.TextCompressor.searchToContext(results, Math.min(remaining, 1500));
        if (ctx.length > 30) {
          context += '\n## 查询相关规则\n\n' + ctx + '\n';
        }
      }
    }

    return context;
  }

  // ── 状态查询 ──────────────────────────────────────

  function getStatus() {
    return {
      activeSystem,
      entryCount: searchIndex?.all?.length || 0,
      categories: getCategories(),
      ready: !!searchIndex
    };
  }

  // ── 公开接口 ──────────────────────────────────────

  return {
    init,
    loadSystemIndex,
    autoDiscover,
    search,
    searchForAI,
    getByCategory,
    getCategories,
    getFullText,
    buildAIContext,
    getStatus,
    getActiveSystem: () => activeSystem,
    isReady: () => !!searchIndex
  };
})();

if (typeof window !== 'undefined') {
  window.RuleSearch = RuleSearch;
}
