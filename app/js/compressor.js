/* ============================================
   TrpgRecode - 文本压缩与结构化摘要工具
   长文本 → 紧凑MD表格 → token优化上下文

   设计原则：
   1. 原始文本本地存档（source/），不丢数据
   2. AI日常只消费压缩摘要（compressed/），极致省token
   3. 每条摘要附带关键词，支持模糊检索
   4. 需要时再按条目定位原文，精确读取
   ============================================ */

const TextCompressor = (() => {
  'use strict';

  // ── 压缩条目结构 ──────────────────────────────────

  /**
   * 一条压缩记录：
   * {
   *   id: "唯一标识",
   *   title: "条目名称",
   *   category: "分类（职业/法术/装备/规则/怪物/...）",
   *   keywords: ["关键词1", "关键词2"],
   *   summary: "1-3句话压缩摘要（50-200字）",
   *   sourceFile: "原始文件名",
   *   sourceOffset: 1234,     // 原文中的字符偏移
   *   sourceLength: 5000      // 原文段落长度
   * }
   */

  // ── 客户端结构提取 ──────

  /**
   * 从文本中提取结构化条目
   * 适用于有明确标题格式的文档（如Markdown）
   */
  function extractStructured(text, sourceName = '') {
    const entries = [];
    const lines = text.split('\n');
    let currentSection = '';
    let currentContent = [];
    let charOffset = 0;
    let entryId = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检测标题（## 或 ###）
      const h2Match = line.match(/^##\s+(.+)/);
      const h3Match = line.match(/^###\s+(.+)/);
      const h1Match = line.match(/^#\s+(.+)/);

      if (h1Match || h2Match || h3Match) {
        // 保存上一个条目的内容
        if (currentContent.length > 2) {
          const entry = createEntry(
            entryId++, currentSection, currentContent, sourceName, charOffset
          );
          if (entry) entries.push(entry);
        }

        currentSection = (h1Match || h2Match || h3Match)[1].trim();
        currentContent = [];
      } else if (line.trim()) {
        currentContent.push(line.trim());
      }

      charOffset += line.length + 1;
    }

    // 最后一个条目
    if (currentContent.length > 2) {
      const entry = createEntry(entryId++, currentSection, currentContent, sourceName, charOffset);
      if (entry) entries.push(entry);
    }

    return entries;
  }

  function createEntry(id, title, contentLines, sourceName, offset) {
    const fullText = contentLines.join(' ');
    if (fullText.length < 10) return null;

    // 根据标题推断分类
    const category = inferCategory(title);
    // 提取关键词
    const keywords = extractKeywords(title, fullText);

    // 生成压缩摘要（取前200字作为基础摘要）
    let summary = fullText.substring(0, 200);
    if (fullText.length > 200) summary += '...';

    return {
      id: `e_${id}`,
      title,
      category,
      keywords,
      summary,
      sourceFile: sourceName,
      sourceText: fullText.substring(0, 500) // 客户端存储时截断，完整文本在服务端
    };
  }

  function inferCategory(title) {
    const lower = title.toLowerCase();
    if (/职业|class|profession/i.test(lower)) return '职业';
    if (/法术|spell|魔法|magic/i.test(lower)) return '法术';
    if (/装备|武器|防具|weapon|armor|item|equip/i.test(lower)) return '装备';
    if (/怪物|monster|creature|敌人/i.test(lower)) return '怪物';
    if (/技能|skill|feat|特性|专长/i.test(lower)) return '技能';
    if (/种族|race/i.test(lower)) return '种族';
    if (/规则|rule|mechanic|判定|检定|check|save/i.test(lower)) return '规则';
    if (/背景|background/i.test(lower)) return '背景';
    if (/状态|condition|effect/i.test(lower)) return '状态';
    return '其他';
  }

  function extractKeywords(title, text) {
    const keywords = new Set();
    // 从标题提取
    title.split(/[\s\-—（）\(\)]+/).forEach(w => {
      if (w.length >= 2 && !/^(的|和|与|或|在|是|有|不|了|着|过)$/i.test(w)) {
        keywords.add(w);
      }
    });

    // 从文本中提取带标记的关键词
    const marked = text.match(/\*\*(.+?)\*\*/g);
    if (marked) {
      marked.forEach(m => keywords.add(m.replace(/\*/g, '')));
    }

    // 提取数值+单位组合
    const numUnit = text.match(/\d+[英尺尺格ftm轮回合分钟小时天]+/g);
    if (numUnit) {
      numUnit.forEach(n => keywords.add(n));
    }

    return [...keywords].slice(0, 10);
  }

  // ── AI辅助压缩（通过后端调用AI生成高质量摘要） ──

  /**
   * AI生成压缩摘要的提示词模板
   */
  function buildCompressPrompt(entries, systemName) {
    const itemsText = entries.map(e =>
      `[${e.category}] ${e.title}\n内容: ${e.sourceText || e.summary}`
    ).join('\n\n---\n\n');

    return `请将以下${systemName}规则书内容压缩为标准化查表格式。每条保留1-2句核心机制（数值、条件、效果），去除描述性语言和例子。格式：

| 分类 | 条目 | 关键词 | 压缩摘要 |
|------|------|--------|----------|
| 职业 | 战士 | 生命骰,d10,重甲 | HP d10, 熟练: 重甲/军用武器, 2级获得动作如潮 |
| 法术 | 火球术 | 3环,塑能,8d6,150尺 | 150尺范围20尺半径, 8d6火焰, DEX豁免减半 |

只输出表格和必要的一行说明。不要任何多余文字。`;
  }

  // ── 压缩缓存管理 ──────────────────────────────────

  /**
   * 构建压缩索引（前端缓存）
   */
  function buildIndex(entries) {
    const index = {
      byCategory: {},
      byKeyword: {},
      all: entries
    };

    for (const entry of entries) {
      // 按分类
      if (!index.byCategory[entry.category]) {
        index.byCategory[entry.category] = [];
      }
      index.byCategory[entry.category].push(entry.id);

      // 按关键词
      for (const kw of entry.keywords) {
        const lowerKw = kw.toLowerCase();
        if (!index.byKeyword[lowerKw]) {
          index.byKeyword[lowerKw] = [];
        }
        index.byKeyword[lowerKw].push(entry.id);
      }
    }

    return index;
  }

  // ── 模糊搜索 ──────────────────────────────────────

  /**
   * 在压缩条目中进行模糊搜索
   * @param {string} query - 搜索词
   * @param {Array} entries - 所有条目
   * @param {Object} index - 关键词索引
   * @returns {Array} 匹配的条目（按相关度排序）
   */
  function fuzzySearch(query, entries, index) {
    if (!query || !entries.length) return [];

    const terms = query.toLowerCase().split(/[\s,，]+/).filter(t => t.length > 0);
    const scores = new Map();

    for (const term of terms) {
      // 精确关键词匹配
      if (index && index.byKeyword[term]) {
        for (const id of index.byKeyword[term]) {
          scores.set(id, (scores.get(id) || 0) + 10);
        }
      }

      // 部分关键词匹配
      if (index) {
        for (const [kw, ids] of Object.entries(index.byKeyword)) {
          if (kw.includes(term) || term.includes(kw)) {
            for (const id of ids) {
              scores.set(id, (scores.get(id) || 0) + 5);
            }
          }
        }
      }

      // 标题和摘要匹配
      for (const entry of entries) {
        const titleLower = entry.title.toLowerCase();
        const summaryLower = entry.summary.toLowerCase();
        if (titleLower.includes(term)) {
          scores.set(entry.id, (scores.get(entry.id) || 0) + 8);
        }
        if (summaryLower.includes(term)) {
          scores.set(entry.id, (scores.get(entry.id) || 0) + 3);
        }
      }
    }

    // 按分数排序
    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20) // 最多返回20条
      .map(([id]) => entries.find(e => e.id === id))
      .filter(Boolean);

    return ranked;
  }

  /**
   * 生成搜索结果的紧凑上下文（用于注入AI）
   */
  function searchToContext(results, maxChars = 2000) {
    if (!results.length) return '未找到相关规则条目。';

    let context = '## 相关规则条目（压缩摘要）\n\n';
    let charCount = 0;

    for (const r of results) {
      const line = `- [${r.category}] **${r.title}**: ${r.summary}\n`;
      if (charCount + line.length > maxChars) break;
      context += line;
      charCount += line.length;
    }

    if (results.length > (context.match(/\n- /g) || []).length) {
      context += `\n（共${results.length}条结果，以上为最相关的${(context.match(/\n- /g) || []).length}条）`;
    }

    return context;
  }

  // ── 公开接口 ──────────────────────────────────────

  return {
    extractStructured,
    buildCompressPrompt,
    buildIndex,
    fuzzySearch,
    searchToContext,
    inferCategory,
    extractKeywords
  };
})();

if (typeof window !== 'undefined') {
  window.TextCompressor = TextCompressor;
}
