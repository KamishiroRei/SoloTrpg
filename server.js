/**
 * TrpgRecode - AI驱动的通用TRPG单人跑团平台
 * 后端服务：AI代理、规则书读取、文件缓存、角色卡解析
 *
 * 启动方式：node server.js
 * 默认端口：3000
 * Web界面：http://localhost:3000
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const http = require('http');
const https = require('https');

// ── 配置 ──────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = __dirname;
const RULER_DIR = path.join(PROJECT_ROOT, 'Ruler');
const ARCHIVE_DIR = path.join(PROJECT_ROOT, 'Archive');
const MODULE_DIR = path.join(PROJECT_ROOT, 'Module');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');

// 确保必要目录存在
[RULER_DIR, ARCHIVE_DIR, MODULE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 加载或创建配置
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error('[配置] 解析 config.json 失败，使用默认配置');
    }
  }
  // 默认配置
  return {
    ai: {
      providers: {
        openai: {
          name: 'OpenAI',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKey: '',
          model: 'gpt-4o',
          enabled: false
        },
        gptpro: {
          name: 'GPTPRO',
          endpoint: 'https://api.gptpro.io/v1/chat/completions',
          apiKey: '',
          model: 'gptpro',
          enabled: false
        },
        custom: {
          name: '自定义',
          endpoint: '',
          apiKey: '',
          model: '',
          enabled: false
        }
      },
      activeProvider: 'openai',
      systemPrompt: '你是一个专业的TRPG游戏主持人（GM），精通DND 5版及其他桌面角色扮演游戏规则。你需要根据当前游戏状态、角色数据和玩家输入来主持游戏。回答应直接、具体，引用规则时给出准确信息。'
    },
    server: {
      port: PORT
    }
  };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

let appConfig = loadConfig();

// ── Express 应用 ──────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(PROJECT_ROOT)); // 托管静态文件

// 文件上传目录
const uploadDir = path.join(PROJECT_ROOT, 'data', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── API: 配置管理 ─────────────────────────────────────

app.get('/api/config', (req, res) => {
  // 返回配置但隐藏 API Key（仅返回是否已设置）
  const safeConfig = JSON.parse(JSON.stringify(appConfig));
  for (const [key, provider] of Object.entries(safeConfig.ai.providers)) {
    provider.apiKey = provider.apiKey ? '***已设置***' : '';
  }
  res.json(safeConfig);
});

app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  // 合并配置，保留未提供的 API Key
  if (newConfig.ai && newConfig.ai.providers) {
    for (const [key, provider] of Object.entries(newConfig.ai.providers)) {
      if (provider.apiKey === '***已设置***' || provider.apiKey === '') {
        // 保留原有 Key
        provider.apiKey = appConfig.ai.providers[key]?.apiKey || '';
      }
    }
  }
  appConfig = { ...appConfig, ...newConfig };
  saveConfig(appConfig);
  res.json({ success: true });
});

app.post('/api/config/apikey', (req, res) => {
  const { provider, apiKey } = req.body;
  if (appConfig.ai.providers[provider]) {
    appConfig.ai.providers[provider].apiKey = apiKey;
    saveConfig(appConfig);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: '未知的AI提供商' });
  }
});

// ── API: AI 对话代理 ──────────────────────────────────

app.post('/api/ai/chat', async (req, res) => {
  const { messages, provider: reqProvider, model: reqModel } = req.body;

  const providerKey = reqProvider || appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];

  if (!provider || !provider.enabled) {
    return res.status(400).json({ error: 'AI提供商未启用或不存在' });
  }
  if (!provider.apiKey) {
    return res.status(400).json({ error: '请先设置API Key' });
  }
  if (!provider.endpoint) {
    return res.status(400).json({ error: '请先设置API端点' });
  }

  const model = reqModel || provider.model;

  try {
    const result = await callAI(provider.endpoint, provider.apiKey, model, messages);
    res.json(result);
  } catch (err) {
    console.error('[AI] 调用失败:', err.message);
    res.status(500).json({ error: `AI调用失败: ${err.message}` });
  }
});

async function callAI(endpoint, apiKey, model, messages) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 4096
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || JSON.stringify(json.error)));
          } else if (json.choices && json.choices[0]) {
            resolve({
              content: json.choices[0].message?.content || '',
              model: json.model,
              usage: json.usage
            });
          } else {
            reject(new Error('AI返回了未知格式的响应'));
          }
        } catch (e) {
          reject(new Error('解析AI响应失败: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.write(body);
    req.end();
  });
}

// ── API: 规则书管理 ──────────────────────────────────

/**
 * 获取规则书缓存列表
 */
app.get('/api/rules/list', (req, res) => {
  const systems = [];
  if (fs.existsSync(RULER_DIR)) {
    const entries = fs.readdirSync(RULER_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sysPath = path.join(RULER_DIR, entry.name);
        const files = fs.readdirSync(sysPath).filter(f => f.endsWith('.md'));
        systems.push({
          name: entry.name,
          files: files,
          path: sysPath
        });
      }
    }
  }
  res.json(systems);
});

/**
 * 读取规则缓存内容
 */
app.get('/api/rules/read', (req, res) => {
  const { system, file } = req.query;
  if (!system || !file) {
    return res.status(400).json({ error: '请指定系统名称和文件名' });
  }

  const filePath = path.join(RULER_DIR, system, file);
  // 安全检查：确保路径在Ruler目录内
  if (!filePath.startsWith(RULER_DIR)) {
    return res.status(403).json({ error: '禁止访问的路径' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }

  const content = fs.readFileSync(filePath, 'utf8');
  res.json({ content, system, file });
});

/**
 * 保存/更新规则缓存
 */
app.post('/api/rules/save', (req, res) => {
  const { system, file, content } = req.body;
  if (!system || !file) {
    return res.status(400).json({ error: '请指定系统名称和文件名' });
  }

  const sysDir = path.join(RULER_DIR, system);
  if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });

  const filePath = path.join(sysDir, file);
  if (!filePath.startsWith(RULER_DIR)) {
    return res.status(403).json({ error: '禁止访问的路径' });
  }

  fs.writeFileSync(filePath, content, 'utf8');
  res.json({ success: true, path: filePath });
});

/**
 * AI处理规则书内容：发送文本给AI，让AI总结为MD格式
 */
app.post('/api/rules/process', async (req, res) => {
  const { system, fileName, content, provider: reqProvider } = req.body;

  const providerKey = reqProvider || appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];

  if (!provider || !provider.enabled || !provider.apiKey) {
    return res.status(400).json({ error: 'AI未配置，无法处理规则书' });
  }

  const systemPrompt = `你是一个TRPG规则专家。请将以下规则书内容整理为清晰的结构化Markdown表格，便于快速查询和游戏时参考。

要求：
1. 使用Markdown表格整理核心数据（如职业表、武器表、法术表、技能表等）
2. 保留关键数值和机制描述
3. 按主题分章节，使用##标题
4. 对复杂规则添加简要的"快速参考"说明
5. 保留原文中的关键术语
6. 输出纯Markdown，不要多余说明`;

  try {
    const result = await callAI(provider.endpoint, provider.apiKey, provider.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请整理以下规则内容：\n\n${content.substring(0, 50000)}` }
    ]);

    // 自动保存到缓存
    if (system && fileName) {
      const sysDir = path.join(RULER_DIR, system);
      if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
      const mdFileName = fileName.replace(/\.(pdf|chm|txt)$/i, '.md');
      fs.writeFileSync(path.join(sysDir, mdFileName), result.content, 'utf8');
    }

    res.json({ content: result.content, cached: true });
  } catch (err) {
    res.status(500).json({ error: `AI处理失败: ${err.message}` });
  }
});

// ── API: 文件读取 ─────────────────────────────────────

/**
 * 读取上传的PDF文件内容
 */
const multer = require('multer');
const upload = multer({ dest: uploadDir, limits: { fileSize: 100 * 1024 * 1024 } });

app.post('/api/files/read-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  try {
    // 尝试使用 pdf-parse
    let pdfParse;
    try {
      pdfParse = require('pdf-parse');
    } catch (e) {
      return res.status(500).json({ error: 'PDF解析库未安装，请运行: npm install pdf-parse' });
    }

    const dataBuffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(dataBuffer);

    // 清理上传文件
    fs.unlinkSync(req.file.path);

    res.json({
      text: data.text,
      pages: data.numpages,
      fileName: req.file.originalname
    });
  } catch (err) {
    res.status(500).json({ error: `PDF解析失败: ${err.message}` });
  }
});

/**
 * 读取上传的CHM文件内容（Windows环境使用hh.exe解压）
 */
app.post('/api/files/read-chm', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  if (process.platform !== 'win32') {
    return res.status(500).json({ error: 'CHM解析仅在Windows系统支持' });
  }

  try {
    // 创建临时解压目录
    const extractDir = path.join(uploadDir, 'chm_extract_' + Date.now());
    fs.mkdirSync(extractDir, { recursive: true });

    // 使用Windows hh.exe解压CHM
    execSync(`hh.exe -decompile "${extractDir}" "${req.file.path}"`, {
      timeout: 30000,
      windowsHide: true
    });

    // 读取解压后的HTML文件
    const htmlFiles = [];
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.htm') || entry.name.endsWith('.html')) {
          htmlFiles.push(fullPath);
        }
      }
    }
    scanDir(extractDir);

    // 提取所有HTML文本（去除标签）
    let allText = '';
    for (const htmlFile of htmlFiles.slice(0, 200)) { // 限制文件数
      try {
        let html = fs.readFileSync(htmlFile, 'utf8');
        // 简单去标签
        html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        html = html.replace(/<[^>]+>/g, '\n');
        html = html.replace(/&nbsp;/g, ' ');
        html = html.replace(/&lt;/g, '<');
        html = html.replace(/&gt;/g, '>');
        html = html.replace(/&amp;/g, '&');
        html = html.replace(/&quot;/g, '"');
        html = html.replace(/\n{3,}/g, '\n\n');
        const relativeName = path.relative(extractDir, htmlFile);
        allText += `\n=== ${relativeName} ===\n${html.trim()}\n`;
      } catch (e) { /* 跳过无法读取的文件 */ }
    }

    // 清理
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.unlinkSync(req.file.path);

    res.json({
      text: allText.substring(0, 1000000), // 限制1MB
      fileName: req.file.originalname,
      filesProcessed: htmlFiles.length
    });
  } catch (err) {
    res.status(500).json({ error: `CHM解析失败: ${err.message}` });
  }
});

/**
 * 读取上传的XLSX文件
 */
app.post('/api/files/read-xlsx', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  try {
    let XLSX;
    try {
      XLSX = require('xlsx');
    } catch (e) {
      return res.status(500).json({ error: 'XLSX解析库未安装，请运行: npm install xlsx' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const result = {};

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      result[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    }

    fs.unlinkSync(req.file.path);

    res.json({
      sheets: result,
      sheetNames: workbook.SheetNames,
      fileName: req.file.originalname
    });
  } catch (err) {
    res.status(500).json({ error: `XLSX解析失败: ${err.message}` });
  }
});

/**
 * 读取文本文件
 */
app.post('/api/files/read-text', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  try {
    const text = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path);
    res.json({ text, fileName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: `文件读取失败: ${err.message}` });
  }
});

// ── API: 游戏状态获取（供AI上下文使用） ──────────────

app.get('/api/game/status', (req, res) => {
  res.json({
    message: '游戏状态由前端维护，请通过WebSocket或前端API获取',
    hint: '前端将游戏状态注入AI对话上下文'
  });
});

// ── API: 压缩索引（规则书搜索用） ────────────────────

/**
 * 获取规则系统的压缩索引（结构化条目JSON）
 */
app.get('/api/rules/index', (req, res) => {
  const { system } = req.query;
  if (!system) return res.status(400).json({ error: '请指定系统名称' });

  const systemDir = path.join(RULER_DIR, system);
  if (!fs.existsSync(systemDir)) return res.status(404).json({ error: '系统目录不存在' });

  // 优先读取 _index.json
  const indexFile = path.join(systemDir, '_index.json');
  if (fs.existsSync(indexFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: '索引文件损坏' });
    }
  }

  // 回退：扫描compressed/目录下的所有md文件，提取结构
  const compressedDir = path.join(systemDir, 'compressed');
  const entries = [];
  const sourceDir = path.join(systemDir, 'source');

  // 从compressed MD文件中提取条目
  if (fs.existsSync(compressedDir)) {
    const files = fs.readdirSync(compressedDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const md = fs.readFileSync(path.join(compressedDir, file), 'utf8');
        const parsed = parseMdToEntries(md, file, sourceDir);
        entries.push(...parsed);
      } catch (e) { /* skip */ }
    }
  }

  // 同时扫描source目录的原始文本
  if (fs.existsSync(sourceDir)) {
    const srcFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
    for (const file of srcFiles) {
      if (!entries.some(e => e.sourceFile === file)) {
        try {
          const text = fs.readFileSync(path.join(sourceDir, file), 'utf8');
          const parsed = extractStructuredServer(text, file);
          entries.push(...parsed);
        } catch (e) { /* skip */ }
      }
    }
  }

  const result = {
    system,
    entries,
    entryCount: entries.length,
    generatedAt: new Date().toISOString()
  };

  // 缓存索引
  try {
    fs.writeFileSync(indexFile, JSON.stringify(result, null, 2), 'utf8');
  } catch (e) { /* ignore */ }

  res.json(result);
});

/**
 * 从MD表格提取结构化条目
 */
function parseMdToEntries(md, sourceName, sourceDir) {
  const entries = [];
  const lines = md.split('\n');
  let entryId = 0;

  // 尝试解析表格
  let tableMode = false;
  let tableHeaders = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 检测表格
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      if (!tableMode && cells.length >= 2) {
        tableHeaders = cells;
        tableMode = true;
        continue;
      }
      if (line.includes('---')) continue;

      if (tableMode && cells.length >= 2) {
        const entry = {
          id: `t_${sourceName}_${entryId++}`,
          title: cells[0] || '',
          category: cells[1] ? cells[1].replace(/[*_]/g, '') : inferCategoryServer(cells[0]),
          keywords: extractKeywordsServer(cells[0] + ' ' + (cells[2] || '')),
          summary: cells.slice(2).join(' | ').substring(0, 300),
          sourceFile: sourceName
        };
        entries.push(entry);
      }
    } else if (line.startsWith('## ')) {
      tableMode = false;
    }
  }

  // 如果没有表格，按段落解析
  if (entries.length === 0) {
    const paragraphs = md.split(/\n\n+/).filter(p => p.trim().length > 20);
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].trim();
      const titleLine = para.split('\n')[0].replace(/^#+\s*/, '');
      entries.push({
        id: `p_${sourceName}_${i}`,
        title: titleLine.substring(0, 80),
        category: inferCategoryServer(titleLine),
        keywords: extractKeywordsServer(para.substring(0, 200)),
        summary: para.substring(0, 300).replace(/\n/g, ' '),
        sourceFile: sourceName
      });
    }
  }

  return entries;
}

function inferCategoryServer(text) {
  const lower = text.toLowerCase();
  if (/职业|class/i.test(lower)) return '职业';
  if (/法术|spell|魔法/i.test(lower)) return '法术';
  if (/装备|武器|防具|weapon|armor/i.test(lower)) return '装备';
  if (/怪物|monster/i.test(lower)) return '怪物';
  if (/技能|专长|feat|skill/i.test(lower)) return '技能';
  if (/种族|race/i.test(lower)) return '种族';
  if (/规则|判定|豁免|攻击骰|伤害骰/i.test(lower)) return '规则';
  if (/状态|condition/i.test(lower)) return '状态';
  return '其他';
}

function extractKeywordsServer(text) {
  const words = text.match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,}/g) || [];
  const stopWords = new Set(['可以','使用','一个','进行','需要','所有','这个','如果','或者','并且','不会','不是','没有']);
  const unique = [...new Set(words.filter(w => !stopWords.has(w)))];
  return unique.slice(0, 8);
}

function extractStructuredServer(text, sourceName) {
  const entries = [];
  const lines = text.split('\n');
  let currentTitle = '';
  let currentText = [];
  let entryId = 0;

  for (const line of lines) {
    const hMatch = line.match(/^#{1,3}\s+(.+)/);
    if (hMatch) {
      if (currentText.length > 2) {
        const combined = currentText.join(' ');
        entries.push({
          id: `s_${sourceName}_${entryId++}`,
          title: currentTitle.substring(0, 80),
          category: inferCategoryServer(currentTitle),
          keywords: extractKeywordsServer(currentTitle + ' ' + combined.substring(0, 100)),
          summary: combined.substring(0, 300),
          sourceFile: sourceName
        });
      }
      currentTitle = hMatch[1];
      currentText = [];
    } else if (line.trim()) {
      currentText.push(line.trim());
    }
  }

  return entries;
}

/**
 * 获取规则原文（按偏移和长度）
 */
app.get('/api/rules/source', (req, res) => {
  const { system, file, offset, length } = req.query;
  if (!system || !file) return res.status(400).json({ error: '参数不足' });

  // 检查多个可能的路径
  const paths = [
    path.join(RULER_DIR, system, 'source', file),
    path.join(RULER_DIR, system, file)
  ];

  let foundPath = null;
  for (const p of paths) {
    if (fs.existsSync(p)) { foundPath = p; break; }
  }

  if (!foundPath) return res.status(404).json({ error: '源文件不存在' });

  try {
    const stat = fs.statSync(foundPath);
    const off = parseInt(offset) || 0;
    const len = Math.min(parseInt(length) || 2000, 10000); // 最多10000字符

    const fd = fs.openSync(foundPath, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, off);
    fs.closeSync(fd);

    res.json({
      text: buf.toString('utf8'),
      offset: off,
      length: len,
      totalSize: stat.size,
      file
    });
  } catch (e) {
    res.status(500).json({ error: `读取失败: ${e.message}` });
  }
});

// ── API: 压缩处理（上传文件后AI压缩为标准表格） ──────

app.post('/api/rules/compress', async (req, res) => {
  const { system, fileName, entries, provider: reqProvider } = req.body;

  if (!entries || !entries.length) {
    return res.status(400).json({ error: '没有可压缩的条目' });
  }

  const providerKey = reqProvider || appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];

  if (!provider || !provider.enabled || !provider.apiKey) {
    return res.status(400).json({ error: 'AI未配置' });
  }

  try {
    // 分批压缩（每批最多50条）
    const batchSize = 50;
    let allCompressed = '';

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const prompt = buildCompressPromptServer(batch, system);

      const result = await callAI(provider.endpoint, provider.apiKey, provider.model, [
        { role: 'system', content: '你是规则书压缩专家。将TRPG规则精确压缩为标准化查表格式。只输出表格。' },
        { role: 'user', content: prompt }
      ]);

      allCompressed += result.content + '\n\n';
    }

    // 存储压缩结果
    if (system && fileName) {
      const sysDir = path.join(RULER_DIR, system, 'compressed');
      if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
      const mdName = fileName.replace(/\.[^.]+$/, '.md');
      fs.writeFileSync(path.join(sysDir, mdName), allCompressed, 'utf8');

      // 同时存储原始文本
      const sourceDir = path.join(RULER_DIR, system, 'source');
      if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
    }

    // 更新索引
    try {
      const indexPath = path.join(RULER_DIR, system, '_index.json');
      if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath); // 删除旧索引，下次请求时重建
    } catch (e) { /* ignore */ }

    res.json({ content: allCompressed, cached: true });
  } catch (err) {
    res.status(500).json({ error: `压缩失败: ${err.message}` });
  }
});

function buildCompressPromptServer(entries, systemName) {
  const items = entries.map(e =>
    `[${e.category || '其他'}] ${e.title}\n${(e.summary || '').substring(0, 300)}`
  ).join('\n---\n');

  return `将以下${systemName}规则书内容压缩为查表格式。每条1-2句核心机制，去除描述。格式：

| 分类 | 条目 | 关键词 | 压缩摘要 |
|------|------|--------|----------|
| 职业 | 战士 | 生命骰,d10,重甲 | HP d10, 熟练: 重甲/军用武器, 2级获得动作如潮 |

内容：
${items}

只输出表格，不要多余文字。`;
}

// ── 启动时自动扫描规则书任务区 ──────────────────────

function autoScanRulesOnStartup() {
  console.log('[规则扫描] 正在扫描规则书任务区...');

  if (!fs.existsSync(RULER_DIR)) return;

  const systems = fs.readdirSync(RULER_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  // 确保每个系统有source/和compressed/子目录
  for (const sys of systems) {
    const sysDir = path.join(RULER_DIR, sys);
    const sourceDir = path.join(sysDir, 'source');
    const compressedDir = path.join(sysDir, 'compressed');

    if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });
    if (!fs.existsSync(compressedDir)) fs.mkdirSync(compressedDir, { recursive: true });

    // 将系统根目录下的文件自动移到source/
    const rootFiles = fs.readdirSync(sysDir).filter(f => {
      const full = path.join(sysDir, f);
      return fs.statSync(full).isFile() && f !== '_index.json';
    });
    for (const f of rootFiles) {
      const src = path.join(sysDir, f);
      const dst = path.join(sourceDir, f);
      if (!fs.existsSync(dst)) {
        try {
          fs.renameSync(src, dst);
          console.log(`  [移动] ${f} → source/`);
        } catch (e) { /* ignore */ }
      }
    }

    // 统计文件
    const srcCount = fs.readdirSync(sourceDir).filter(f => f.endsWith('.txt') || f.endsWith('.md')).length;
    const compCount = fs.existsSync(compressedDir) ? fs.readdirSync(compressedDir).filter(f => f.endsWith('.md')).length : 0;

    if (srcCount > 0 || compCount > 0) {
      console.log(`  📚 ${sys}: source=${srcCount} 压缩=${compCount}`);
    }
  }

  if (systems.length === 0) {
    console.log('  （规则书任务区为空，上传PDF/CHM后自动创建）');
  }
}

// ── 健康检查 ──────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    aiConfigured: Object.values(appConfig.ai.providers).some(p => p.enabled && p.apiKey)
  });
});

// ── API: 自动存档（系统记录，不耗AI token） ─────────

/**
 * 记录对话到存档（追加模式）
 */
app.post('/api/archive/log', (req, res) => {
  const { user, ai, time, adventure } = req.body;

  const advName = adventure || 'default';
  const advDir = path.join(ARCHIVE_DIR, advName);
  if (!fs.existsSync(advDir)) fs.mkdirSync(advDir, { recursive: true });

  const logFile = path.join(advDir, 'conversation.txt');
  const entry = `[${time || new Date().toISOString()}]\n玩家: ${user}\nGM: ${ai}\n\n`;

  try {
    fs.appendFileSync(logFile, entry, 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 获取存档列表
 */
app.get('/api/archive/list', (req, res) => {
  if (!fs.existsSync(ARCHIVE_DIR)) return res.json([]);

  const adventures = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = path.join(ARCHIVE_DIR, d.name);
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
      return { name: d.name, files };
    });

  res.json(adventures);
});

/**
 * 读取存档内容
 */
app.get('/api/archive/read', (req, res) => {
  const { adventure, file } = req.query;
  const filePath = path.join(ARCHIVE_DIR, adventure || 'default', file || 'conversation.txt');

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '存档不存在' });

  try {
    const text = fs.readFileSync(filePath, 'utf8');
    res.json({ content: text, file });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: 模组搜索 ──────────────────────────────────

/**
 * 搜索模组/剧本内容
 */
app.get('/api/module/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });

  const results = [];

  function scanModules(dir, basePath = '') {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scanModules(fullPath, relPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        try {
          const text = fs.readFileSync(fullPath, 'utf8');
          // 简单搜索：匹配标题和段落
          const lines = text.split('\n');
          let currentTitle = entry.name;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('#')) currentTitle = line.replace(/^#+\s*/, '');

            if (line.toLowerCase().includes(q.toLowerCase())) {
              const context = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join(' ');
              results.push({
                title: currentTitle.substring(0, 60),
                type: entry.name.endsWith('.md') ? '剧本' : '文本',
                summary: context.substring(0, 200),
                file: relPath
              });
              if (results.length >= 10) return; // 限制结果数
            }
          }
        } catch (e) { /* skip */ }
      }
    }
  }

  scanModules(MODULE_DIR);
  res.json({ results: results.slice(0, 10), query: q });
});

/**
 * 获取模组列表
 */
app.get('/api/module/list', (req, res) => {
  if (!fs.existsSync(MODULE_DIR)) return res.json([]);

  function listModules(dir, basePath = '') {
    const result = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          type: 'dir',
          path: relPath,
          children: listModules(fullPath, relPath)
        });
      } else {
        result.push({
          name: entry.name,
          type: 'file',
          path: relPath,
          size: fs.statSync(fullPath).size
        });
      }
    }
    return result;
  }

  res.json(listModules(MODULE_DIR));
});

// ── 启动服务器 ────────────────────────────────────────

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log('  TrpgRecode 后端服务已启动');
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  规则书: ${RULER_DIR}`);
  console.log(`  模组:   ${MODULE_DIR}`);
  console.log(`  存档:   ${ARCHIVE_DIR}`);
  console.log('═══════════════════════════════════════════');

  // 自动扫描规则书任务区
  autoScanRulesOnStartup();

  const aiReady = Object.values(appConfig.ai.providers).some(p => p.enabled && p.apiKey);
  if (!aiReady) {
    console.log('  ⚠  AI未配置，请在界面设置中配置AI提供商和API Key');
    console.log('  ⚠  配置文件: config.json');
  }
});
