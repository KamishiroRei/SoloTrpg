/* ============================================
   TrpgRecode - 通用模板与角色卡渲染模块
   系统提供接口/容器，AI读取规则书后生成配置，模块负责渲染

   设计原则：
   1. 不预设任何规则系统的具体字段（无硬编码STR/DEX等）
   2. 接受AI生成的字段配置JSON，动态渲染界面
   3. 支持多种渲染类型：grid, list, bar, table, text, ability
   4. XLSX角色卡通过AI解析后映射到配置
   ============================================ */

const TemplateRenderer = (() => {
  'use strict';

  // ── 已加载的模板缓存 ─────────────────────────────

  let activeTemplate = null;       // 当前激活的模板配置
  let templateRegistry = {};       // { systemName: templateConfig }

  // ── 模板配置结构 ──────────────────────────────────

  /**
   * 模板配置规范（AI生成时遵循此结构）：
   *
   * {
   *   "systemName": "DND5e",
   *   "systemVersion": "1.0",
   *   "description": "来自AI读取规则书后自动生成",
   *   "sections": [
   *     {
   *       "id": "basic",
   *       "title": "基础信息",
   *       "type": "grid",          // grid | list | bar | table | custom
   *       "columns": 2,            // grid类型时每行列数
   *       "fields": [
   *         {
   *           "key": "name",       // 数据中的key
   *           "label": "名称",     // 显示标签
   *           "type": "text",      // text | number | bar | select | dice
   *           "default": "",       // 默认值
   *           "editable": true,    // 是否可编辑
   *           "barMaxKey": "maxHp" // bar类型时的最大值key
   *         }
   *       ]
   *     }
   *   ],
   *   "autoCardFields": [          // 自动卡XLSX映射
   *     { "col": "A", "key": "name", "label": "角色名" },
   *     { "col": "B", "key": "STR", "label": "力量" }
   *   ]
   * }
   */

  // ── 默认通用模板（当无AI生成模板时使用） ──────────

  const DEFAULT_TEMPLATE = {
    systemName: '通用',
    systemVersion: '1.0',
    description: '默认通用模板，建议让AI读取规则书后生成专用模板',
    sections: [
      {
        id: 'basic',
        title: '基础状态',
        type: 'grid',
        columns: 2,
        fields: [
          { key: 'HP_current', label: '当前HP', type: 'number', default: 10 },
          { key: 'HP_max', label: '最大HP', type: 'number', default: 10 },
          { key: 'AC', label: '护甲/防御', type: 'number', default: 10 },
          { key: 'Speed', label: '速度', type: 'text', default: '30ft' },
          { key: 'Initiative', label: '先攻加值', type: 'number', default: 0 }
        ]
      },
      {
        id: 'attributes',
        title: '属性值',
        type: 'grid',
        columns: 3,
        fields: [
          { key: 'ATTR_1', label: '属性1', type: 'number', default: 10 },
          { key: 'ATTR_2', label: '属性2', type: 'number', default: 10 },
          { key: 'ATTR_3', label: '属性3', type: 'number', default: 10 },
          { key: 'ATTR_4', label: '属性4', type: 'number', default: 10 },
          { key: 'ATTR_5', label: '属性5', type: 'number', default: 10 },
          { key: 'ATTR_6', label: '属性6', type: 'number', default: 10 }
        ]
      },
      {
        id: 'info',
        title: '附加信息',
        type: 'list',
        fields: [
          { key: 'Class', label: '职业/分类', type: 'text', default: '' },
          { key: 'Level', label: '等级', type: 'number', default: 1 },
          { key: 'Race', label: '种族/类型', type: 'text', default: '' }
        ]
      }
    ]
  };

  // ── 初始化 ────────────────────────────────────────

  function init() {
    // 尝试从localStorage加载模板
    loadTemplatesFromStorage();
  }

  function loadTemplatesFromStorage() {
    try {
      const saved = localStorage.getItem('trpg_templates');
      if (saved) {
        templateRegistry = JSON.parse(saved);
      }
    } catch (e) { /* ignore */ }
  }

  function saveTemplatesToStorage() {
    try {
      localStorage.setItem('trpg_templates', JSON.stringify(templateRegistry));
    } catch (e) { /* ignore */ }
  }

  // ── 模板管理 ──────────────────────────────────────

  /**
   * 注册一个模板（通常由AI生成后调用）
   */
  function registerTemplate(systemName, templateConfig) {
    templateRegistry[systemName] = templateConfig;
    saveTemplatesToStorage();
  }

  /**
   * 获取指定系统的模板
   */
  function getTemplate(systemName) {
    return templateRegistry[systemName] || DEFAULT_TEMPLATE;
  }

  /**
   * 设置当前激活的模板
   */
  function setActiveTemplate(systemName) {
    activeTemplate = getTemplate(systemName);
    return activeTemplate;
  }

  /**
   * 获取所有已注册的模板
   */
  function getAllTemplates() {
    return { ...templateRegistry };
  }

  /**
   * 从AI生成的配置JSON加载模板
   */
  function loadTemplateFromAI(configJson) {
    try {
      const config = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
      if (config.systemName && config.sections) {
        registerTemplate(config.systemName, config);
        return config;
      }
    } catch (e) {
      console.error('[模板] AI配置解析失败:', e);
    }
    return null;
  }

  // ── 渲染 ──────────────────────────────────────────

  /**
   * 根据模板和数据渲染角色详情HTML
   * @param {object} template - 模板配置
   * @param {object} data - 角色数据
   * @param {string} tokenId - 关联的地图标记ID
   * @returns {string} HTML
   */
  function renderCharacterSheet(template, data, tokenId) {
    if (!template || !template.sections) return '<div class="empty-sheet">无模板配置，请让AI生成</div>';

    let html = '';

    for (const section of template.sections) {
      html += `<div class="sheet-section">`;
      html += `<div class="sheet-section-title">${section.title}</div>`;

      switch (section.type) {
        case 'grid':
          html += renderGridSection(section, data);
          break;
        case 'list':
          html += renderListSection(section, data);
          break;
        case 'table':
          html += renderTableSection(section, data);
          break;
        case 'bar':
          html += renderBarSection(section, data);
          break;
        case 'custom':
          html += section.html || '';
          break;
        default:
          html += renderListSection(section, data);
      }

      html += `</div>`;
    }

    // HP操作栏（如果有HP字段）
    const hpField = findFieldByLabel(template, 'HP', '生命值', '当前HP', 'HP_current');
    if (hpField) {
      html += `
        <div class="sheet-section">
          <div class="char-hp-controls">
            <button class="btn-small danger" onclick="window.UIManager.damageCharacter('${tokenId}')">- 伤害</button>
            <input type="number" id="hp-amount-${tokenId}" value="0" min="-999" max="999" style="width:60px;">
            <button class="btn-small heal" onclick="window.UIManager.healCharacter('${tokenId}')">+ 治疗</button>
          </div>
        </div>
      `;
    }

    // 操作按钮
    html += `
      <div class="sheet-actions">
        <button class="btn-small" onclick="window.UIManager.selectCharacter('${tokenId}')">🗔 打开角色卡</button>
        <button class="btn-small" onclick="window.UIManager.openCharacterModalForEdit('${tokenId}')">✏ 编辑</button>
        <button class="btn-small danger" onclick="window.UIManager.deleteCharacter('${tokenId}')">✕ 删除</button>
      </div>
    `;

    return html;
  }

  function renderGridSection(section, data) {
    const columns = section.columns || 2;
    let html = `<div class="field-grid" style="grid-template-columns: repeat(${columns}, 1fr);">`;

    for (const field of section.fields) {
      const value = getFieldValue(data, field);
      html += `<div class="field-item">`;
      html += `<div class="field-value">${formatFieldValue(value, field)}</div>`;
      html += `<div class="field-label">${field.label}</div>`;
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderListSection(section, data) {
    let html = `<div class="field-list">`;

    for (const field of section.fields) {
      const value = getFieldValue(data, field);
      html += `
        <div class="field-row">
          <span class="field-key">${field.label}</span>
          <span class="field-value-text">${formatFieldValue(value, field)}</span>
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  function renderTableSection(section, data) {
    // section.fields是列定义，section.rowsKey指向数据中的数组
    if (!section.rowsKey) return '';

    const rows = data[section.rowsKey] || [];
    if (!rows.length) return '<div class="empty-table">暂无数据</div>';

    let html = `<table class="data-table"><thead><tr>`;
    for (const col of section.fields) {
      html += `<th>${col.label}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const row of rows) {
      html += `<tr>`;
      for (const col of section.fields) {
        html += `<td>${row[col.key] || ''}</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table>`;
    return html;
  }

  function renderBarSection(section, data) {
    let html = '';
    for (const field of section.fields) {
      const current = parseFloat(data[field.key]) || 0;
      const maxKey = field.barMaxKey || field.key + '_max';
      const max = parseFloat(data[maxKey]) || 100;
      const percent = max > 0 ? Math.max(0, Math.min(100, current / max * 100)) : 0;

      html += `
        <div class="bar-field">
          <div class="bar-label"><span>${field.label}</span><span>${current} / ${max}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${percent}%;background:${field.color || 'var(--success)'};"></div></div>
        </div>
      `;
    }
    return html;
  }

  // ── 辅助函数 ──────────────────────────────────────

  function getFieldValue(data, field) {
    if (field.key in data) return data[field.key];
    return field.default !== undefined ? field.default : '';
  }

  function formatFieldValue(value, field) {
    if (value === null || value === undefined) return '—';
    if (field.type === 'number') {
      if (typeof value === 'object' && value.current !== undefined) {
        return `${value.current} / ${value.max || '?'}`;
      }
      return String(value);
    }
    return String(value);
  }

  function findFieldByLabel(template, ...labels) {
    if (!template || !template.sections) return null;
    for (const section of template.sections) {
      for (const field of section.fields) {
        if (labels.some(l => field.label.includes(l) || field.key === l)) {
          return field;
        }
      }
    }
    return null;
  }

  // ── XLSX角色卡映射 ────────────────────────────────

  /**
   * 将XLSX数据映射到模板数据
   * 映射规则由模板中的autoCardFields定义
   */
  function mapXlsxToTemplate(xlsxData, template) {
    if (!template.autoCardFields || !xlsxData) return {};

    const result = {};

    // 取第一个工作表
    const sheets = Object.keys(xlsxData);
    const mainSheet = xlsxData[sheets[0]] || [];

    // 行式数据（第一行为表头）
    if (mainSheet.length > 0 && template.autoCardFields.length > 0) {
      const headerRow = mainSheet[0] || [];
      const dataRow = mainSheet[1] || [];

      // 按列映射
      for (const mapping of template.autoCardFields) {
        if (mapping.col) {
          const colIndex = colLetterToIndex(mapping.col);
          if (colIndex < dataRow.length) {
            result[mapping.key] = dataRow[colIndex];
          }
        }
      }
    }

    // 列式数据（每行是键值对）
    if (mainSheet.length > 0 && Object.keys(result).length === 0) {
      for (const row of mainSheet) {
        if (row.length >= 2 && row[0]) {
          const key = String(row[0]).trim();
          result[key] = row[1];
        }
      }
    }

    return result;
  }

  /**
   * AI根据规则书生成角色卡模板配置
   * 这个函数提供提示词模板，帮助AI生成正确的配置格式
   */
  function generateTemplatePrompt(ruleSystemName, ruleContext) {
    return `
请为"${ruleSystemName}"规则系统生成一个角色卡模板配置。输出纯JSON（不要markdown包裹）：

{
  "systemName": "${ruleSystemName}",
  "systemVersion": "1.0",
  "description": "AI根据规则书自动生成的角色卡模板",
  "sections": [
    {
      "id": "unique_id",
      "title": "区块标题",
      "type": "grid|list|table|bar",
      "columns": 2,
      "fields": [
        {
          "key": "data_field_key",
          "label": "显示标签",
          "type": "text|number",
          "default": "默认值",
          "editable": true
        }
      ]
    }
  ],
  "autoCardFields": [
    { "col": "A", "key": "name", "label": "角色名" }
  ]
}

请根据以下规则书内容生成完整的角色卡配置：
${ruleContext}
`;
  }

  // ── 工具函数 ──────────────────────────────────────

  function colLetterToIndex(col) {
    col = col.toUpperCase();
    let index = 0;
    for (let i = 0; i < col.length; i++) {
      index = index * 26 + (col.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  // ── 公开接口 ──────────────────────────────────────

  return {
    init,

    // 模板管理
    registerTemplate,
    getTemplate,
    setActiveTemplate,
    getAllTemplates,
    loadTemplateFromAI,

    // 渲染
    renderCharacterSheet,

    // XLSX映射
    mapXlsxToTemplate,

    // AI辅助
    generateTemplatePrompt,

    // 配置
    DEFAULT_TEMPLATE,
    getActiveTemplate: () => activeTemplate || DEFAULT_TEMPLATE
  };
})();

if (typeof window !== 'undefined') {
  window.TemplateRenderer = TemplateRenderer;
}
