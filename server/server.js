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
const util = require('util');
const { TextDecoder } = require('util');
const zlib = require('zlib');
const fetch = require('node-fetch');
const { execFileSync, execSync, execFile } = require('child_process');

// ── 配置 ──────────────────────────────────────────────

const PORT = Number(process.env.PORT || 3000);
const isPkg = typeof process.pkg !== 'undefined';

// server.js 是开发模式与 EXE 模式唯一的后端入口。
// 打包后 __dirname 位于只读快照；界面资源从快照读取，配置、规则书与上传文件写到 EXE 同级目录。
const SOURCE_ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = isPkg ? path.dirname(process.execPath) : SOURCE_ROOT;
const APP_DIR = path.join(SOURCE_ROOT, 'app');
const RULER_DIR = path.join(RUNTIME_ROOT, 'Ruler');
const SHARED_TOOLS_DIR = path.join(RULER_DIR, '_shared_tools'); // AI沉淀的跨规则书共享工具库（持久保留）
const HOST_PLUGINS_DIR = path.join(RULER_DIR, '_host_plugins'); // 宿主渲染策略插件（type=host，全局生效）
const CONFIG_PATH = path.join(RUNTIME_ROOT, 'config.json');
const LEGACY_CONFIG_PATH = isPkg ? '' : path.join(__dirname, 'config.json');
const RUNTIME_DIR = path.join(RUNTIME_ROOT, 'data', 'runtime');
const SERVER_LOCK_PATH = path.join(RUNTIME_DIR, 'server.lock');

// start.bat 以 Debug 模式启动源码。调试日志既实时显示，也写入项目根目录 Logs。
// EXE 是发布入口，不依赖这套调试启动流程。
const DEBUG_MODE = !isPkg && (
  process.argv.includes('--debug') ||
  process.env.SOLOTRPG_DEBUG === '1'
);
const LOG_DIR = process.env.SOLOTRPG_LOG_DIR
  ? path.resolve(process.env.SOLOTRPG_LOG_DIR)
  : path.join(RUNTIME_ROOT, 'Logs');
let SESSION_LOG_PATH = '';
let LATEST_LOG_PATH = '';

function formatLocalTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function formatLogFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function setupDebugLogging() {
  // 源码 Debug 模式与控制台模式（EXE/GUI）都写日志文件：GUI 无控制台，日志文件是唯一排错入口
  if (!DEBUG_MODE && !isPkg) return;

  fs.mkdirSync(LOG_DIR, { recursive: true });
  SESSION_LOG_PATH = path.join(LOG_DIR, `debug-${formatLogFilename()}.log`);
  LATEST_LOG_PATH = path.join(LOG_DIR, 'latest.log');
  fs.writeFileSync(SESSION_LOG_PATH, '', 'utf8');
  if (process.env.SOLOTRPG_KEEP_LAUNCH_LOG === '1' && fs.existsSync(LATEST_LOG_PATH)) {
    fs.appendFileSync(LATEST_LOG_PATH, '\n', 'utf8');
  } else {
    fs.writeFileSync(LATEST_LOG_PATH, '', 'utf8');
  }

  const levels = {
    log: 'INFO',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG'
  };

  for (const [method, label] of Object.entries(levels)) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const message = util.formatWithOptions({ colors: false, depth: 6 }, ...args);
      const line = `[${formatLocalTimestamp()}] [${label}] ${message}`;
      original(line);
      try {
        fs.appendFileSync(SESSION_LOG_PATH, `${line}\n`, 'utf8');
        fs.appendFileSync(LATEST_LOG_PATH, `${line}\n`, 'utf8');
      } catch (error) {
        original(`[日志] 写入失败: ${error.message}`);
      }
    };
  }

  process.on('unhandledRejection', reason => {
    console.error('[进程] 未处理的异步错误:', reason);
  });
  process.on('uncaughtException', error => {
    console.error('[进程] 未捕获异常:', error);
    process.exit(1);
  });

  console.log('[调试] Debug 模式已启用');
  console.log(`[调试] 当前日志: ${LATEST_LOG_PATH}`);
  console.log(`[调试] 会话日志: ${SESSION_LOG_PATH}`);
}

setupDebugLogging();

// AI文件操作授权：覆盖软件根目录所有内容（含自身源码，便于AI自我迭代）
const AI_ALLOWED_DIRS = [RUNTIME_ROOT];

function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  return AI_ALLOWED_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));
}

// 加载或创建配置
function loadConfig() {
  const sourcePath = fs.existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : (LEGACY_CONFIG_PATH && fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : null);

  if (sourcePath) {
    try {
      const config = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      // 旧版start.bat把配置写在server目录；迁移到项目根目录后与EXE模式共用。
      if (sourcePath === LEGACY_CONFIG_PATH && !fs.existsSync(CONFIG_PATH)) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
      }
      return config;
    } catch (e) {
      console.error('[配置] 解析 config.json 失败，使用默认配置');
    }
  }
  // 默认配置
  return {
    ai: {
      providers: {
        gpt: {
          name: 'GPT',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKey: '',
          model: 'gpt-4o',
          enabled: false
        },
        custom: {
          name: '自定义API',
          endpoint: '',
          apiKey: '',
          model: '',
          enabled: false
        }
      },
      activeProvider: 'gpt',
      systemPrompt: ''
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

// ── AI提供商地址与模型发现 ────────────────────────────

const DEFAULT_PROVIDER_ENDPOINTS = {
  gpt: 'https://api.openai.com/v1/chat/completions'
};

function cleanApiUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function stripApiAction(url) {
  let result = cleanApiUrl(url);
  const suffixes = ['/chat/completions', '/responses', '/completions', '/models'];
  const lower = result.toLowerCase();
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  return result.replace(/\/+$/, '');
}

/**
 * 接受基础地址或完整Chat Completions地址，并统一推导模型与对话接口。
 * 例如：
 * - https://api.deepseek.com
 * - https://api.deepseek.com/v1
 * - https://api.deepseek.com/v1/chat/completions
 */
function resolveApiUrls(endpoint) {
  const raw = cleanApiUrl(endpoint);
  if (!raw) return { baseUrl: '', chatUrl: '', modelsUrl: '' };

  const baseUrl = stripApiAction(raw);
  const lower = raw.toLowerCase();
  const chatUrl = lower.endsWith('/chat/completions')
    ? raw
    : `${baseUrl}/chat/completions`;

  return {
    baseUrl,
    chatUrl,
    modelsUrl: `${baseUrl}/models`
  };
}

function resolveApiKey(inputKey, savedKey) {
  if (inputKey === undefined || inputKey === null || inputKey === '***已设置***') {
    return savedKey || '';
  }
  // 请求中明确传入空字符串时视为清除认证，兼容无需Key的本地服务。
  return String(inputKey).trim();
}

function authHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function parseModelList(payload) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

  const models = source
    .map(item => {
      if (typeof item === 'string') return item;
      return item?.id || item?.model || item?.name || '';
    })
    .map(id => String(id).trim())
    .filter(Boolean);

  return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}

async function readErrorResponse(resp) {
  const text = await resp.text().catch(() => '');
  if (!text) return `HTTP ${resp.status}`;
  try {
    const json = JSON.parse(text);
    return json?.error?.message || json?.error || json?.message || text;
  } catch (e) {
    return text;
  }
}

/**
 * 按OpenAI兼容规范读取 /models。
 * 若用户只输入服务根地址，则在标准地址失败后补试 /v1/models，
 * 并把实际成功的Chat Completions地址返回给前端保存。
 */
async function discoverModels(endpoint, apiKey) {
  const { baseUrl, modelsUrl } = resolveApiUrls(endpoint);
  if (!baseUrl) throw new Error('请先填写API地址');

  const candidates = [modelsUrl];
  if (!baseUrl.toLowerCase().endsWith('/v1')) {
    candidates.push(`${baseUrl}/v1/models`);
  }

  const errors = [];

  for (const url of [...new Set(candidates)]) {
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: authHeaders(apiKey),
        timeout: 30000
      });

      if (!resp.ok) {
        errors.push(`${url}: ${await readErrorResponse(resp)}`);
        continue;
      }

      const payload = await resp.json();
      const models = parseModelList(payload);
      const resolvedBase = url.replace(/\/models\/?$/i, '');
      return {
        models,
        modelsUrl: url,
        endpoint: `${resolvedBase}/chat/completions`
      };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  throw new Error(errors.join('；') || '模型接口不可用');
}

// ── Express 应用 ──────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

if (DEBUG_MODE) {
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsedMs.toFixed(1)}ms)`);
    });
    next();
  });
}

app.use(express.static(APP_DIR));
app.get('/', (req, res) => res.redirect('/index.html'));

// 文件上传目录
const uploadDir = path.join(RUNTIME_ROOT, 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(RULER_DIR, { recursive: true });
app.use('/Ruler', express.static(RULER_DIR));

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
  const incoming = req.body || {};
  const currentAi = appConfig.ai || { providers: {}, activeProvider: 'gpt', systemPrompt: '' };
  const incomingAi = incoming.ai || {};
  const mergedProviders = { ...currentAi.providers };

  for (const [key, providerInput] of Object.entries(incomingAi.providers || {})) {
    const current = currentAi.providers?.[key] || {};
    const endpoint = cleanApiUrl(providerInput.endpoint || current.endpoint || DEFAULT_PROVIDER_ENDPOINTS[key]);
    mergedProviders[key] = {
      ...current,
      ...providerInput,
      endpoint,
      apiKey: resolveApiKey(providerInput.apiKey, current.apiKey)
    };
  }

  appConfig = {
    ...appConfig,
    ...incoming,
    ai: {
      ...currentAi,
      ...incomingAi,
      providers: mergedProviders
    }
  };

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
  const { messages, provider: reqProvider, model: reqModel, system: reqSystem, adventure: reqAdventure, channel: reqChannel } = req.body;

  const providerKey = reqProvider || appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];

  if (!provider || !provider.enabled) {
    return res.status(400).json({ error: 'AI提供商未启用或不存在' });
  }
  if (!provider.endpoint) {
    return res.status(400).json({ error: '请先设置API地址' });
  }
  // 自定义OpenAI兼容服务允许无Key运行；GPT仍要求认证。
  if (providerKey === 'gpt' && !provider.apiKey) {
    return res.status(400).json({ error: '请先设置API Key' });
  }

  const model = reqModel || provider.model;
  if (!model) {
    return res.status(400).json({ error: '请先选择或输入模型' });
  }

  try {
    const result = await callAI(provider.endpoint, provider.apiKey, model, messages, { reasoningEffort: appConfig.ai.reasoningEffort || 'high' });
    // D+会话持久化：玩家频道（带channel时）保存本轮 user+assistant 消息
    if (reqChannel && Array.isArray(messages) && messages.length) {
      const lastUser = messages.slice().reverse().find(m => m.role === 'user');
      const savedMsgs = [];
      if (lastUser) savedMsgs.push({ role: 'user', content: String(lastUser.content || '') });
      savedMsgs.push({ role: 'assistant', content: String(result.content || '') });
      appendSession(reqSystem, String(reqAdventure || '默认'), reqChannel, savedMsgs);
    }
    res.json(result);
  } catch (err) {
    console.error('[AI] 调用失败:', err.message);
    res.status(500).json({ error: `AI调用失败: ${err.message}` });
  }
});

// 系统频道工具对话（SSE）：完全对标 opencode 标准工具集，AI可读写规则书插件文件与软件自身源码，供AI自主迭代修复
// 工具规范唯一标准（2026-08-05）：每个工具的 description 即其规范（何时用/参数语义/关键规则），
// 不再散落于 agent-guide；agent-guide 只保留行为规范（设计审核/举一反三等）按需加载
const PLUGIN_TOOLS = [
  { type: 'function', function: { name: 'glob', description: '按glob模式找文件（如 **/*.js、plugins/**）。用于定位文件路径；想知道目录结构用 list_files。', parameters: { type: 'object', properties: { system: { type: 'string', description: '规则系统名/__host__/__app__/__root__' }, pattern: { type: 'string' }, limit: { type: 'number', description: '最大返回数，默认50' } }, required: ['system', 'pattern'] } } },
  { type: 'function', function: { name: 'list_files', description: '列出目录内容（显示文件数，比bash省token）。path空=根目录。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string', description: '相对目录，空=根' } }, required: ['system'] } } },
  { type: 'function', function: { name: 'grep', description: '正则搜索文本返回行号/片段。定位大文件目标函数用（先grep拿行号再read_file精确读），优先于反复read_file。', parameters: { type: 'object', properties: { system: { type: 'string' }, pattern: { type: 'string', description: 'JavaScript正则' }, path: { type: 'string', description: '可选：限定文件或目录' } }, required: ['system', 'pattern'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取文件。参数自判：full=true全量（≤60K文件首选）；line=<行号>+lines=<行数>按行读；offset+limit按字符；不传参数中小文件直接返回完整内容、大文件返回规模提示。大文件(>60K)禁止顺序扫读：先grep定位行号再读±50行。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string' }, full: { type: 'boolean', description: 'true=全量' }, line: { type: 'number', description: '起始行号' }, lines: { type: 'number', description: '行数，缺省读到尾' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['system', 'path'] } } },
  { type: 'function', function: { name: 'write_file', description: '写入/覆盖文件（可新建）。路径相对对应scope根（system=__root__时=项目根）。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, required: ['system', 'path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: '在文件中替换文本（增量编辑）。oldText必须精确匹配文件内容；找不到时用grep重新定位。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['system', 'path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'bash', description: '执行命令（Windows cmd，超时30秒）。工作目录=对应scope根（__root__=项目根），返回附带[cwd:路径]；不要写相对cd，直接用根目录相对路径或绝对路径；统计/枚举类需求优先用list_files/glob。', parameters: { type: 'object', properties: { system: { type: 'string', description: '同文件工具；缺省__root__' }, command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'todowrite', description: '维护任务清单（跨轮次跟踪）。复杂任务开工先拆解为todo列表。', parameters: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string' } } } } }, required: ['todos'] } } },
  { type: 'function', function: { name: 'skill', description: '加载技能文档：agent-guide（工作方法：任务流程/设计审核/举一反三/数据落盘，开工或需要时加载）；plugin-authoring（插件编写规范，改插件前必读）；gm-protocol（GM带团协议）；gm-standard（玩家频道标准）。', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'webfetch', description: '抓取网页内容（转文本）', parameters: { type: 'object', properties: { url: { type: 'string' }, maxChars: { type: 'number', description: '缺省=完整返回' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'websearch', description: '联网搜索（DuckDuckGo，无需key）', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'question', description: '向用户提问并等待回答（需求矛盾/无法执行时用，禁止盲目执行）', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'task', description: '派发子任务给独立子Agent执行并返回结果', parameters: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] } } }
];

// ── bash 工具统一执行（2026-08-05 统合归一）：system-chat 与解析 Agent 共用 ──
// 统一行为：cwd 附带提示（AI无需猜路径）、cd 引导、失败时返回 cwd 帮助修正、统计类命令引导
async function execBashTool(cmd, cwd) {
  if (!cmd) return '请提供命令';
  // 统计/枚举类命令引导（两处工具集都有 list_files/glob，提示统一）
  if (/^(findstr|dir|tree|wc|ls|ll)\b/i.test(cmd.trim())) {
    return '提示：统计文件/行数/目录结构建议用 list_files/glob/list_tree 工具（更省token且结果结构化）。若确实需要执行命令，可继续直接写完整命令（如 type 文件、python 脚本等）。';
  }
  try {
    const stdout = await execFileAsync(process.env.ComSpec || 'cmd.exe', ['/c', cmd], { timeout: 30000, cwd });
    const outText = typeof stdout === 'string' ? stdout : String(stdout && stdout.stdout !== undefined ? stdout.stdout : stdout);
    const cwdNote = `[cwd: ${cwd}]` + (/^cd\s/i.test(cmd.trim()) ? '\n（工作目录已定位，通常无需再 cd；相对路径直接基于该目录写）' : '');
    // 输出完整返回，不做外部截断（2026-08-05）：AI自行预估上下文长度
    return cwdNote + '\n' + String(outText || '（命令执行完成，无输出）');
  } catch (e) {
    // 失败时告知 cwd，帮助AI修正路径（避免反复用错误相对路径）
    return '命令执行失败: ' + String(e.message || '').substring(0, 300) + `\n[当前工作目录: ${cwd}]（命令基于此目录执行；不要用相对 cd，直接用绝对路径或基于此目录的相对路径）`;
  }
}

// 执行系统频道插件工具（路径校验：plugins/ + app/ + _host_plugins/ + __root__ 软件根目录全授权；
// 2026-08-05 解除宿主白名单限制：写权限范围=项目文件夹，宿主文件（app/）同属可修改范围）
// 完全对标 opencode 标准工具集：glob/list_files/grep/read_file/write_file/edit/bash/todowrite/skill/webfetch/websearch/question/task
const APP_WHITELIST = ['app/js/plugins.js', 'app/js/ui.js', 'app/index.html', 'app/css/style.css']; // AI可修改的宿主渲染/规则详情文件

async function runPluginTool(tool, args, defaultSystem, ctx) {
  const emit = ctx && ctx.emit;
  const sys = cleanRuleName(String(args.system || defaultSystem || ''));
  let rel = String(args.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  let target, scope;
  let isRootScope = false;
  // 只读解禁（2026-08-05）：只读工具（read_file/glob/grep/list_files）允许读取系统任意位置（绝对路径）；
  // 写操作（write_file/edit/bash）仍仅限本项目文件夹内
  const READONLY_TOOLS = ['read_file', 'glob', 'grep', 'list_files'];
  const absPathMatch = rel.match(/^([A-Za-z]:\/|\\\\)/);
  const isAbsReadOnly = absPathMatch && READONLY_TOOLS.includes(tool);
  if (absPathMatch && !isAbsReadOnly) {
    return '路径越界：写操作仅允许项目文件夹内（请使用 root/ 前缀访问本项目）；绝对路径只读仅限 read_file/glob/grep/list_files';
  }
  const SKIP_ROOT_DIRS = ['node_modules', '.git', 'data', 'Logs', 'AI任务'];
  if (isAbsReadOnly) {
    // 系统任意位置只读：直接解析绝对路径，不限制项目范围
    target = path.resolve(rel);
    scope = rel;
  } else if (rel.startsWith('_host_plugins/') || sys === '__host__') {
    // 宿主渲染策略插件目录（Ruler/_host_plugins/）
    const hostRoot = path.resolve(HOST_PLUGINS_DIR);
    target = path.resolve(path.join(hostRoot, rel.replace(/^_host_plugins\//, '')));
    if (!target.startsWith(hostRoot)) return '路径越界：仅允许操作 _host_plugins/ 目录内文件';
    scope = '_host_plugins/' + rel.replace(/^_host_plugins\//, '');
  } else if (rel.startsWith('app/') || sys === '__app__') {
    // 宿主文件（2026-08-05 解除白名单限制：写权限范围=项目文件夹，app/ 下任意文件可读写）
    const appRoot = path.resolve(path.join(SOURCE_ROOT, 'app'));
    target = path.resolve(path.join(appRoot, rel.replace(/^app\//, '')));
    if (!target.startsWith(appRoot)) return '路径越界：仅允许操作 app/ 目录内文件';
    scope = rel;
  } else if (rel.startsWith('root/') || sys === '__root__') {
    // __root__：软件根目录全授权（自身源码、配置等所有内容）
    const root = path.resolve(RUNTIME_ROOT);
    target = path.resolve(path.join(root, rel.replace(/^root\//, '')));
    if (!target.startsWith(root)) return '路径越界：仅允许操作软件根目录内文件';
    scope = rel.replace(/^root\//, '') || '.';
    isRootScope = true;
  } else {
    if (!sys) return '未指定规则系统（system 参数为空）';
    rel = rel.replace(/^plugins\//, '');
    let effectiveSys = sys;
    let pluginRoot = path.resolve(path.join(RULER_DIR, effectiveSys, 'plugins'));
    const fallbackSys = cleanRuleName(String(defaultSystem || ''));
    if (!fs.existsSync(pluginRoot) && fallbackSys && fallbackSys !== effectiveSys) {
      effectiveSys = fallbackSys;
      pluginRoot = path.resolve(path.join(RULER_DIR, effectiveSys, 'plugins'));
    }
    target = path.resolve(path.join(pluginRoot, rel));
    if (!target.startsWith(pluginRoot)) return '路径越界：仅允许操作 plugins/ 目录内文件';
    scope = 'plugins/' + rel;
  }
  switch (tool) {
    case 'grep': {
      let re;
      try { re = new RegExp(String(args.pattern || ''), 'i'); } catch (e) { return '正则无效：' + e.message; }
      const roots = [];
      const pushFile = (file, label) => { if (fs.existsSync(file) && fs.statSync(file).isFile()) roots.push({ file, label }); };
      const walk = (dir, prefix) => {
        if (!fs.existsSync(dir)) return;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          const label = prefix ? prefix + '/' + ent.name : ent.name;
          if (ent.isDirectory()) walk(full, label);
          else if (/\.(js|json|md|css|html|txt)$/i.test(ent.name)) roots.push({ file: full, label });
        }
      };
      if (isAbsReadOnly) {
        // 系统任意位置只读搜索：直接递归绝对路径
        const walkAny = (dir, prefix) => {
          if (!fs.existsSync(dir)) return;
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            const label = prefix ? prefix + '/' + ent.name : ent.name;
            if (ent.isDirectory()) walkAny(full, label);
            else if (/\.(js|json|md|css|html|txt|bat|ps1|cmd|yml|yaml|png|jpg|jpeg|gif|webp)$/i.test(ent.name)) roots.push({ file: full, label });
          }
        };
        if (fs.existsSync(target) && fs.statSync(target).isFile()) pushFile(target, rel);
        else walkAny(target, rel || '');
      } else if (isRootScope) {
        const root = path.resolve(RUNTIME_ROOT);
        const start = path.resolve(path.join(root, rel.replace(/^root\//, '')));
        if (!start.startsWith(root)) return '路径越界';
        const walkRoot = (dir, prefix) => {
          if (!fs.existsSync(dir)) return;
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.isDirectory() && SKIP_ROOT_DIRS.includes(ent.name)) continue;
            const full = path.join(dir, ent.name);
            const label = prefix ? prefix + '/' + ent.name : ent.name;
            if (ent.isDirectory()) walkRoot(full, label);
            else if (/\.(js|json|md|css|html|txt|bat|ps1|cmd)$/i.test(ent.name)) roots.push({ file: full, label });
          }
        };
        if (fs.existsSync(start) && fs.statSync(start).isFile()) pushFile(start, rel.replace(/^root\//, '') || '.');
        else walkRoot(start, rel.replace(/^root\//, '') || '');
      } else if (rel.startsWith('_host_plugins/') || sys === '__host__') {
        const hostRoot = path.resolve(HOST_PLUGINS_DIR);
        const start = path.resolve(path.join(hostRoot, rel.replace(/^_host_plugins\//, '')));
        if (!start.startsWith(hostRoot)) return '路径越界';
        if (fs.existsSync(start) && fs.statSync(start).isFile()) pushFile(start, '_host_plugins/' + rel.replace(/^_host_plugins\//, ''));
        else walk(start, rel.replace(/^_host_plugins\//, ''));
      } else if (rel.startsWith('app/') || sys === '__app__') {
        // 2026-08-05：app/ 全目录可搜索（不再限制白名单）
        const appRoot = path.resolve(path.join(SOURCE_ROOT, 'app'));
        const start = path.resolve(path.join(appRoot, rel.replace(/^app\//, '')));
        if (!start.startsWith(appRoot)) return '路径越界';
        if (fs.existsSync(start) && fs.statSync(start).isFile()) pushFile(start, rel.replace(/^app\//, ''));
        else walk(start, rel.replace(/^app\//, ''));
      } else {
        if (!sys) return '未指定规则系统（system 参数为空）';
        let effectiveSys = sys;
        let pluginRoot = path.resolve(path.join(RULER_DIR, effectiveSys, 'plugins'));
        const fallbackSys = cleanRuleName(String(defaultSystem || ''));
        if (!fs.existsSync(pluginRoot) && fallbackSys && fallbackSys !== effectiveSys) pluginRoot = path.resolve(path.join(RULER_DIR, fallbackSys, 'plugins'));
        const start = path.resolve(path.join(pluginRoot, rel));
        if (!start.startsWith(pluginRoot)) return '路径越界';
        if (fs.existsSync(start) && fs.statSync(start).isFile()) pushFile(start, 'plugins/' + rel);
        else walk(start, rel);
      }
      const hits = [];
      for (const item of roots) {
        let text = '';
        try { text = readTextFileSmart(item.file); } catch (e) { continue; }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) hits.push(`${item.label}:${i + 1}: ${lines[i].trim().substring(0, 220)}`);
          if (hits.length >= 80) return hits.join('\n') + '\n……（仅显示前80条）';
        }
      }
      return hits.length ? hits.join('\n') : '未找到匹配：' + String(args.pattern || '');
    }
    case 'list_files': {
      if (isAbsReadOnly) {
        // 系统任意位置只读列目录
        if (!fs.existsSync(target)) return '目录不存在：' + rel;
        return fs.readdirSync(target, { withFileTypes: true })
          .map(e => (e.isDirectory() ? e.name + '/' : e.name))
          .join('\n') || '（空目录）';
      }
      if (isRootScope) {
        const root = path.resolve(RUNTIME_ROOT);
        const dir = path.resolve(path.join(root, rel.replace(/^root\//, '')));
        if (!dir.startsWith(root)) return '路径越界';
        if (!fs.existsSync(dir)) return '目录不存在：' + (rel || '.');
        return fs.readdirSync(dir, { withFileTypes: true })
          .filter(e => !(e.isDirectory() && SKIP_ROOT_DIRS.includes(e.name)))
          .map(e => (e.isDirectory() ? e.name + '/' : `${e.name} (${fs.statSync(path.join(dir, e.name)).size}B)`))
          .join('\n') || '（空目录）';
      }
      if (rel.startsWith('_host_plugins/') || sys === '__host__') {
        if (!fs.existsSync(HOST_PLUGINS_DIR)) return '（_host_plugins/ 目录为空或不存在）';
        const hostRoot = path.resolve(HOST_PLUGINS_DIR);
        const dir = path.join(hostRoot, rel.replace(/^_host_plugins\//, ''));
        if (!path.resolve(dir).startsWith(hostRoot)) return '路径越界';
        if (!fs.existsSync(dir)) return '目录不存在：_host_plugins/' + rel;
        return fs.readdirSync(dir, { withFileTypes: true })
          .map(e => (e.isDirectory() ? e.name + '/' : e.name))
          .join('\n') || '（空目录）';
      }
      if (rel.startsWith('app/') || sys === '__app__') {
        // 2026-08-05：app/ 全目录可列出（不再限制白名单）
        const appRoot = path.resolve(path.join(SOURCE_ROOT, 'app'));
        const dir = path.resolve(path.join(appRoot, rel.replace(/^app\//, '')));
        if (!dir.startsWith(appRoot)) return '路径越界';
        if (!fs.existsSync(dir)) return '目录不存在：app/' + rel;
        return fs.readdirSync(dir, { withFileTypes: true })
          .map(e => (e.isDirectory() ? e.name + '/' : e.name))
          .join('\n') || '（空目录）';
      }
      let effectiveSys = sys;
      let pluginRoot = path.resolve(path.join(RULER_DIR, effectiveSys, 'plugins'));
      const fallbackSys = cleanRuleName(String(defaultSystem || ''));
      if (!fs.existsSync(pluginRoot) && fallbackSys && fallbackSys !== effectiveSys) pluginRoot = path.resolve(path.join(RULER_DIR, fallbackSys, 'plugins'));
      const dir = path.join(pluginRoot, rel);
      if (!path.resolve(dir).startsWith(pluginRoot)) return '路径越界';
      if (!fs.existsSync(dir)) return '目录不存在：plugins/' + rel;
      return fs.readdirSync(dir, { withFileTypes: true })
        .map(e => (e.isDirectory() ? e.name + '/' : `${e.name} (${fs.statSync(path.join(dir, e.name)).size}B)`))
        .join('\n') || '（空目录）';
    }
    case 'read_file': {
      if (!fs.existsSync(target)) return '文件不存在：' + scope;
      if (fs.statSync(target).isDirectory()) return '这是目录，请用 list_files 查看：' + scope;
      const full = readTextFileSmart(target);
      const allLines = full.split(/\r?\n/);
      const total = full.length;
      // 读取参数完全由AI自行判断（2026-08-05）：不设外部固定默认值（如limit=4000/lines=80），
      // 传什么用什么；不传参数时返回完整内容（中小文件）或规模提示（大文件由AI决定读取方式）
      const wantFull = args.full === true || String(args.full) === 'true';
      const hasLine = args.line != null;
      const hasOffset = args.offset != null;
      // ① 显式 full=true 或未传任何定位参数且文件不大 → 全量返回完整内容
      if (wantFull || (!hasLine && !hasOffset && full.length <= 30000)) {
        return `${scope}（全量：${allLines.length}行 / ${total}字符）：\n${full}`;
      }
      // ② 未传任何定位参数但文件较大 → 返回规模信息，读取方式由AI决定
      if (!hasLine && !hasOffset) {
        return `${scope} 是大文件（${allLines.length}行 / ${total}字符）。读取方式：full=true 全量读取；line=<起始行> [lines=<行数>，不传则读到文件尾]；或 offset=<字符位置> [limit=<字符数>，不传则读到文件尾]。请自行判断读取量。`;
      }
      // ③ 按行读取：lines 不传则读到文件尾（不设固定80行）
      if (hasLine) {
        const startLine = Math.max(1, parseInt(args.line) || 1);
        const count = args.lines != null ? Math.max(1, parseInt(args.lines) || 1) : (allLines.length - startLine + 1);
        const endLine = Math.min(allLines.length, startLine + count - 1);
        const out = [];
        for (let i = startLine; i <= endLine; i++) out.push(`${i}: ${allLines[i - 1]}`);
        return `${scope}（共${allLines.length}行，本次显示 ${startLine}-${endLine}）：\n${out.join('\n')}${endLine < allLines.length ? `\n……（继续读取请用 line=${endLine + 1}）` : ''}`;
      }
      // ④ 按字符滚动：limit 不传则读到文件尾（不设固定4000字符）
      const offset = Math.max(0, parseInt(args.offset) || 0);
      const limit = args.limit != null ? Math.max(1, parseInt(args.limit) || 1) : (total - offset);
      const part = full.substring(offset, offset + limit);
      const end = Math.min(offset + limit, total);
      const more = end < total;
      return `${scope}（共${allLines.length}行 / ${total}字符，本次显示 ${offset}-${end}）：\n${part}${more ? `\n……（已显示 ${offset}-${end}/${total}，继续读取请用 offset=${end}）` : ''}`;
    }
    case 'write_file': {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(args.content || ''), 'utf8');
      return '已写入 ' + scope + '（' + String(args.content || '').length + '字符）';
    }
    case 'edit': {
      if (!fs.existsSync(target)) return '文件不存在：' + scope;
      const content = fs.readFileSync(target, 'utf8');
      const oldText = String(args.oldText || '');
      if (!oldText) return '请提供oldText';
      if (!content.includes(oldText)) return '未找到要替换的文本：' + oldText.substring(0, 50) + '…';
      const count = content.split(oldText).length - 1;
      fs.writeFileSync(target, content.split(oldText).join(String(args.newText || '')), 'utf8');
      return '已编辑 ' + scope + '（替换' + count + '处）';
    }
    case 'glob': {
      // 对标opencode glob：按模式找文件（limit由AI自行判断，不设固定上限）
      const pattern = String(args.pattern || '**/*').replace(/\\/g, '/');
      const limit = Math.max(1, parseInt(args.limit) || 50);
      let re;
      try { re = globToRegex(pattern); } catch (e) { return '无效glob模式：' + e.message; }
      const hits = [];
      const walk = (dir, prefix) => {
        if (hits.length >= limit) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of entries) {
          if (hits.length >= limit) return;
          const label = prefix ? prefix + '/' + ent.name : ent.name;
          if (isRootScope && ent.isDirectory() && SKIP_ROOT_DIRS.includes(ent.name)) continue;
          if (ent.isDirectory()) walk(path.join(dir, ent.name), label);
          else if (re.test(label)) hits.push(label);
        }
      };
      if (fs.existsSync(target)) {
        if (fs.statSync(target).isFile()) { if (re.test(rel)) hits.push(rel); }
        else walk(target, rel || '');
      }
      return hits.length ? `匹配${hits.length}个：\n${hits.slice(0, limit).join('\n')}` : '（无匹配）';
    }
    case 'bash': {
      // 对标opencode bash：执行命令（工作目录=对应scope根，超时30s）——统一逻辑见 execBashTool
      const cmd = String(args.command || '');
      const cwd = isRootScope ? path.resolve(RUNTIME_ROOT) : path.dirname(target);
      return await execBashTool(cmd, cwd);
    }
    case 'todowrite': {
      // 对标opencode todowrite：维护任务清单（写入 data/todo.json）
      const todos = Array.isArray(args.todos) ? args.todos : [];
      try {
        fs.mkdirSync(path.join(RUNTIME_ROOT, 'data'), { recursive: true });
        fs.writeFileSync(path.join(RUNTIME_ROOT, 'data', 'todo.json'), JSON.stringify({ updatedAt: new Date().toISOString(), todos }, null, 2), 'utf8');
      } catch (e) { /* ignore */ }
      const summary = todos.map(t => `[${t.status || 'pending'}] ${t.content || t}`).join('；');
      return `任务清单已更新（${todos.length}项）：${summary}`;
    }
    case 'skill': {
      // 对标opencode skill：加载技能文档
      const name = String(args.name || '');
      if (name === 'plugin-authoring') return PLUGIN_AUTHORING_SKILL;
      if (name === 'gm-protocol') return GM_PROTOCOL_SKILL;
      if (name === 'gm-standard') return GM_STANDARD;
      if (name === 'agent-guide') return AGENT_GUIDE_SKILL;
      return `未知skill：${name}。可用：plugin-authoring（插件编写规范）、gm-protocol（GM带团协议：判定标记/变量数据管理/开局流程/NPC生成/战斗平衡/美化规范）、gm-standard（玩家频道实际注入的GM带团标准提示词）、agent-guide（AI工作方法：任务流程/工具选择/需求澄清/空转检查）`;
    }
    case 'webfetch': {
      // 对标opencode webfetch：抓取网页内容
      const url = String(args.url || '');
      if (!/^https?:\/\//i.test(url)) return '请提供有效URL（http/https）';
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TrpgRecode/1.0' },
          signal: AbortSignal.timeout(15000)
        });
        if (!resp.ok) return `抓取失败 HTTP ${resp.status}`;
        const ct = String(resp.headers.get('content-type') || '');
        let text = '';
        if (/html|xml/i.test(ct)) text = stripHtmlToText(await resp.text());
        else text = await resp.text();
        const maxChars = parseInt(args.maxChars) || 0; // 不设默认截断，AI自行判断；0=完整返回
        return `URL: ${url}\n内容:\n${text.replace(/\s{3,}/g, ' ').substring(0, maxChars)}`;
      } catch (e) {
        return '抓取失败: ' + String(e.message || e).substring(0, 300);
      }
    }
    case 'websearch': {
      // 对标opencode websearch：联网搜索（DuckDuckGo，无需key）
      const query = String(args.query || '');
      if (!query) return '请提供搜索词';
      try {
        const resp = await fetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(15000)
        });
        const html = await resp.text();
        const results = [];
        const linkRe = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        const snipRe = /<td class="result-snippet">([\s\S]*?)<\/td>/g;
        const snippets = [];
        let m;
        while ((m = snipRe.exec(html)) && snippets.length < 10) snippets.push(stripHtmlToText(m[1]).trim());
        let i = 0;
        while ((m = linkRe.exec(html)) && i < 8) {
          const title = stripHtmlToText(m[2]).trim();
          if (!title) continue;
          results.push(`${i + 1}. ${title}\n   ${m[1]}\n   ${snippets[i] || ''}`.substring(0, 400));
          i++;
        }
        return results.length ? `搜索结果（DuckDuckGo）：\n${results.join('\n\n')}` : '无搜索结果';
      } catch (e) {
        return '搜索失败: ' + String(e.message || e).substring(0, 300);
      }
    }
    case 'question': {
      // 对标opencode question：向用户提问并等待回答（SSE推送，120秒超时）
      const text = String(args.text || '');
      if (!text) return '请提供问题内容';
      if (!emit) return '（当前环境无法推送问题）';
      const id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const answer = await new Promise((resolve) => {
        const timer = setTimeout(() => { pendingQuestions.delete(id); resolve('（用户未在120秒内回答）'); }, 120000);
        pendingQuestions.set(id, { resolve, timer });
        emit({ type: 'question', id, text });
      });
      return `用户回答：${answer}`;
    }
    case 'task': {
      // 对标opencode task：派发子任务给独立子Agent执行
      const description = String(args.description || '');
      if (!description) return '请提供子任务描述';
      if (!ctx || !ctx.provider || !ctx.model) return '（当前环境无法派发子任务）';
      try {
        const subResult = await callAI(ctx.provider.endpoint, ctx.provider.apiKey, ctx.model, [
          { role: 'system', content: '你是TrpgRecode的子任务Agent。独立完成描述的任务并返回结果，简洁直接，不要多余寒暄。' },
          { role: 'user', content: description }
        ], { reasoningEffort: appConfig.ai.reasoningEffort || 'high', timeoutMs: 90000, signal: ctx.signal });
        return '子任务结果：\n' + String(subResult.content || '');
      } catch (e) {
        return '子任务失败: ' + String(e.message || '').substring(0, 300);
      }
    }
    default:
      return '未知工具：' + tool;
  }
}

// ── 通用TRPG带团标准（GM_STANDARD，从SillyTavern大型DND世界书【DD5e v1.2.4 / D&D 2024 v1.02】提炼，去DND化通用化） ──
// 注入策略：只在对话开始时注入一次（system 位），随后不重复注入；详细协议细节由 skill gm-protocol 按需加载
const GM_STANDARD = `# GM带团标准（通用TRPG协议，本平台强制）
你是本桌GM：规则的中立执行者、世界的沉默维护者。你透明如游戏引擎，只处理规则判定与叙事推进，不做画外音评论，不在叙事中自称GM。

## 一、判定协议（任何结果不确定的行动必须检定）
1. 结果分级：大成功（仅当裸骰=规则极值上限如20；攻击自动命中且伤害骰翻倍）/ 成功 / 失败 / 大失败（仅当裸骰=极值下限如1；攻击自动未命中）。其余一律按数值判定，禁止为讨好玩家发放大成功/大失败。
2. 难度DC：按规则书难度表设定（常用：简单10 / 中等15 / 困难20 / 极难25 / 几乎不可能30），结合情景定DC。
3. 加值：只来自规则（属性修正/熟练/装备/法术等），禁止自行加值；优势取两次较高、劣势取较低，必须有规则依据才给。
4. 骰子：从本轮骰子序列严格按编号顺序消费，禁止改骰、重投、跳过；骰值不可干预（规则明确允许的除外）。

## 二、输出格式（AI只输出标记，由系统渲染精美界面；禁止自己写HTML/CSS）
1. 检定（属性/技能/豁免/对抗）：<dice> 块固定6行——发动技能/目标/情境/检定细节(d20(裸骰)+加值=总值 vs DC)/判定结果/结果描述。
2. 战斗结算（攻击/伤害/先攻/范围豁免等）：<battlecheck> 块固定7行——发动者/目标/行动/检定类型/检定细节/判定结果/战果描述。
3. 多目标与先攻合并进同一块；攻击与伤害合并结算；纯伤害也可用。判定与结果必须同一轮输出；有多个可选行动时先列方案让玩家选择。

## 三、战斗纪律
1. 严格按先攻顺序行动；非自己回合不得插入动作（规则允许的反应除外）；轮到敌人就行动，不让玩家打断。
2. 敌人会集火、利用弱点、优先击杀威胁。0生命值按规则执行濒死/死亡豁免，无奇迹救援。
3. 只描述战争迷雾内可见信息；不给提示、不给安全网、不剧透。

## 四、变量与状态（精确数据管理，平台核心能力）
1. 需要更新游戏数据（HP/资源/物品/状态/位置等）时，回复结尾输出：
   <UpdateVariable><Analysis>(英文≤80词：时间流逝/是否允许戏剧性更新/逐变量分析)</Analysis><JSONPatch>[{"op":"replace|delta|insert|remove|move","path":"...","value":...}]</JSONPatch></UpdateVariable>
2. 最小写入：只写本次变化与影响计算的字段；不写空值/默认值；_开头字段只读；派生值（熟练加值/负重/速度/DC等）由系统自动计算，AI不手动改。

## 五、NPC角色生成（重要角色登场时即时触发，严禁开场批量堆砌）
1. 先输出隐藏思考注释 <!-- charGenerationThink: 生态位/驱动力/锚点/数值 -->（按规则书数值体系）。
2. 再输出 <char_info> YAML 档案：基本信息(姓名/全名/性别/种族/体型/阵营/身份)+外貌特征+强度(CR或等级)+主属性+最大生命值+装备+防御+感官+特质+动作+语言+背景概要+性格特质(核心标签/标签解释/行为准则)+关键经历。数值严格按规则书。

## 六、开局与角色创建流程（玩家车卡时）
分步执行，一次一步并等待玩家：1)基础信息(姓名/种族/背景) 2)属性生成(按规则书全部标准模式) 3)等级与职业 4)熟练/特性 5)生命值/法术/资源 6)物品装备 7)自查全部数据 8)同伴与开幕方式。看到STOP必须停止输出等玩家回复，禁止跳步；未进入正式剧情前章节保持"开局流程"。

## 七、叙事原则
1. 玩家≠角色；允许对角色欺骗/伤害/陷害/伏击/囚禁等一切合理行为；禁止主角光环与无条件吹捧。
2. 弱化运气：禁止绝境逢生式救场（神秘人/神祇出手/时光回溯/恰好捡到神器），除非伏笔合理。
3. 剧情推进符合逻辑与场景设定；NPC按动机行动。

## 八、美化规范（正文用HTML增强阅读，参考世界书美化协议）
1. 样式用<style>包裹；颜色与背景高对比；主要信息用中文；现代高级感、适配宽屏。
2. 书信/纸张/卡片/诗歌/屏幕按类型美化；商品至少生成5项菜单；物品/装备/任务用彩色卡片按稀有度配色。
3. 咒语/技能名/异域文字可用发光样式+ruby注音。美化程度与内容重要性成正比，保持视觉一致，避免过度。`;

// 详细带团协议 skill（系统频道按需加载；含变量结构/标记格式/效果系统等完整规范）
const AGENT_GUIDE_SKILL = `# AI工作方法（Agent Guide Skill）

本平台定位：动态解析任意TRPG规则书→自动生成配套角色卡与工具（插件）→AI作为GM带团。
核心追求：TRPG的自由 + 电脑游戏的精准。AI以结构化标记输出判定与状态，系统渲染精美界面；角色血量等一切游戏数据以变量精确管理，AI可读可写，前端实时联动。

## 一、任务流程（收到任何需求先走此流程）
1. 理解任务目标并规划：复杂任务先 todowrite 拆解，明确每个子任务与验收标准。
2. 设计审核（一切修改前必做，两层）：
   - 第一层 设计目的（游戏策划视角）：这个行为在游戏中的设计目的是什么、谁在执行、意图是什么（命中/结算/成长/速查/扮演）、期望的游戏结果是什么、问题与设计目的的偏差在哪。禁止直接跳"程序上怎么修"，先回答"游戏上应该是什么样"。
   - 第二层 游戏合理性与用户体验（玩家视角）：玩家看到什么、是否符合直觉、是否直观方便操作、在带团流程（创建→升级→战斗→速查）中是否自然可达、是否符合规则书原文。
   - 两层通过后才能事实检查与修改。
3. 定位与读取：grep 定位关键词/函数名 → read_file 读取目标区域。
4. 立即 edit/write_file 修改，不要停留于探索。
5. 实际验证修改（正例命中 + 空例为空 + 点击可展开 + 数据来自规则书）。
6. 全部完成后再用纯文本总结。

## 二、自然语言需求处理（用户只用自然语言，不提供代码/路径/结构）
- 收到需求后第一步用 grep 在相关文件定位关键词/函数名（如需求"骰点分配"就 grep 骰点|roll4d6|attrMode|ability），然后 read_file 读取目标区域，立即修改并验证。
- 禁止通读整个超大文件、禁止反复小窗口读取同一文件（连续只读无输出会被空转检测提醒）。
- 需求模糊时按最合理解释直接实施，不要反复确认。

## 三、工具选择引导（按目标选工具，效率优先）
- 读文件优先用 read_file 的 full=true 全量模式一次读全（中小文件首选，避免多轮窗口读取空转）；大文件用 grep 定位行号 + line/lines 一次读200-400行。
- 想知道文件行数/大小/目录结构→用 list_files/glob（会显示文件数），或 read_file 第一行。
- 想在文件里找关键词→grep；想修改文件→edit/write_file。
- bash 只在真正需要命令执行的场景使用（启动/构建/运行脚本等），文件操作一律用专用工具；python 先 write_file 写脚本再执行，禁止 python -c 内联。

## 四、需求澄清（自行驳斥，强制）
用户需求可能思考不明确、表述矛盾或无法执行。收到需求先判断是否可执行：若需求存在矛盾（如"既要A又要非A"）、关键信息缺失导致无法实施、或规则书与需求冲突，必须立即用 question 工具向用户指出矛盾点并请求解答（说明矛盾在哪、需要用户确认什么），禁止盲目执行、禁止反复猜测空转；需求合理但模糊时按最合理解释直接实施。

## 五、自我空转检查（每轮工具调用后自我评估）
检查自己是否在有效推进——是否反复读取同一文件？是否只读未改超过2轮？是否在无谓地探索？若是，立即转为：grep 定位目标函数 → 一次读取200-400行 → edit/write_file 修改；若已读信息足够就直接修改，不再读取。任务必须落地产物（探索最多占一半轮次）。

## 六、插件质量要求（编写/修改插件时）
- 功能必须依据当前规则书实际内容，禁止套用其他规则结构。
- 检索不得只依赖首页或前150条索引；必须处理常见中英文、旧版/新版和同义名称（例如圣武士、帕拉丁、Paladin），查询无结果时应尝试别名并明确显示命中数。
- 修改后要用实际查询验证至少一个正例和一个无结果例。
- 规则索引接口支持 /api/rules/index?system=系统名&q=关键词&limit=数量。
- 专用功能入口应位于规则详情主体的有效区域，按钮点击展开、不常驻大面板、不弹窗。

## 七、主动举一反三与自主优化（强制，2026-08-05 确立）
> 背景：曾出现"机械化拆解"问题——AI 只按字面需求做最小改动（如把旧角色卡拆分成页），不思考"这个页面按游戏体验应该是什么样"，导致结构与需求脱节。本平台唯一验收标准是**最佳玩家游戏体验**，程序"做完"不算完成。

- **收到需求后，先问自己三问**：
  1. 用户描述的现象背后，期望的**游戏体验**是什么（玩家在这个页面要完成什么流程）？
  2. 当前实现与这个体验的差距在哪（不只修字面问题）？
  3. 有没有**同类问题**（其他页面/其他频道/其他功能）存在同样或相关的体验缺陷？一并优化。
- **页面/功能按"应该是什么样"编写，而非"把旧的拆分"**：每个页面独立思考其内容组织（示例：基础信息页应整合种族/职业/背景/阵营等创建信息为完整区块，而非把旧卡字段拆散平铺）。
- **主动优化清单**（每项任务完成前自查）：布局是否按玩家视角组织？数据是否联动（改一处自动更新相关处）？有无缺失的关联功能（如选了职业是否自动给出职业熟练/装备）？交互是否有明确反馈？与宿主主题是否一致？
- 发现与需求相关的**额外缺陷**（不只字面问题）时，直接一并修复并在总结中说明；发现**超出范围但明显影响体验**的问题时，用 question 工具征询是否一并处理。
- 总结必须列出：本次主动发现并优化的问题（无则写"无"）。

## 九、大文件读取与检索降级（强制，2026-08-05 确立）
> 背景：character-builder/index.js 达 200KB/3459 行，AI 曾顺序小窗口扫读 4+ 次仍只覆盖部分，触发重复读取提醒；JSON 索引检索"巧匠"未命中（格式差异）后浪费轮次。以下规则避免同类低效：

- **大文件（>60K 字符）禁止顺序窗口扫读**：先用 grep 定位目标函数名/关键词（如「function renderDetail」「技巧工匠」「巧匠」），拿到行号后**只读目标行段（±50行）**；需要多处时分别 grep 定位，禁止从第1行往后逐段读。
- **中小文件（≤60K）用 full=true 一次读全**（不要分窗口）。
- **JSON/索引检索无结果时先查格式**：「"title": "X"」与「"title":"X"」（有无空格）可能不同；先用 grep 在索引文件搜关键词本身（如「巧匠」）确认存在性与确切格式，再调整检索；仍无果才降级读源文（source/ 下对应 .htm）。
- **数据字典类内容（种族/职业/背景/专长列表）优先从 compressed/ 产物读取**（rule_settings.json、rule_tables.md、rule_index.json），找不到才去 source/ 源文，避免逐个读 htm。
- **bash 命令路径规范**：bash 工具的工作目录=对应 scope 根（system=__root__ 时=项目根目录），返回结果会附带 [cwd: 路径]。**不要写相对 cd**（如「cd Ruler/xxx」在已定位的 cwd 上会失败）；直接用基于根目录的相对路径（如「node _tools/_verify.js」）或绝对路径。需要切换目录时用「cd /d 绝对路径」。

## 八、长线任务的数据落盘与防重读（强制，2026-08-05 确立）
> 背景：长线大项目（如角色卡重构）中，AI 大量读取源文数据后上下文超预算触发压缩，压缩后 AI 丢失"读过什么"再次重读，形成"读→压→重读"循环，浪费 token 与轮次。解决：**数据确认后立即落盘，上下文只留操作状态**。

- **数据收集期落盘**：当你需要读取大量规则数据（种族/职业/背景/法术列表等）用于构建功能时，把**确认后的数据要点写入任务文件**（「AI任务/<任务名>/ref/data.json」或项目「_tools/」下的数据文件），而不是全部留在对话上下文里。后续使用直接读自己的落盘文件。
- **读过的文件做标记**：每读完一个文件，在落盘文件中记录「文件路径: 关键数据摘要」；上下文压缩后，先读落盘文件恢复"已确认内容"，**不得重读已落盘记录的源文**。
- **压缩后恢复**：上下文被自动压缩后，第一步是读取自己的落盘文件（若有）恢复数据上下文，然后基于压缩摘要的"下一步"继续执行；不要重新探索目录或重读已确认文件。
- 判定标准：同一源文文件不因压缩而重复读取；压缩后的第一轮必须从落盘文件或压缩摘要直接续接推进。
`;

const GM_PROTOCOL_SKILL = `# GM带团协议（GM Protocol Skill）

本平台定位：动态解析任意TRPG规则书→自动生成配套角色卡与工具（插件）→AI作为GM带团。
核心追求：TRPG的自由 + 电脑游戏的精准。AI以结构化标记输出判定与状态，系统以正则/渲染器转成精美界面；角色血量等一切游戏数据以变量精确管理，AI可读可写，前端实时联动。

## 一、判定输出标记（AI只写标记，渲染交给前端）
1. 检定块 <dice>...</dice>，固定6行（字段名不可改）：
   发动技能: ...
   目标: ...
   情境: ...
   检定细节: d20(裸骰) + 加值 = 总值 vs DC
   判定结果: 大成功（Critical Success）| 成功（Success）| 失败（Failure）| 大失败（Critical Failure）
   结果描述: ...
   铁律：仅当裸骰=20才是大成功、裸骰=1才是大失败，加值再高也不算；禁止讨好玩家。
2. 战斗块 <battlecheck>...</battlecheck>，固定7行：
   发动者: ... / 目标: ... / 行动: ... / 检定类型: ... / 检定细节: ... / 判定结果: 命中|未命中|豁免成功|豁免失败|先攻已确定|造成N点伤害|半伤|专注维持成功 等 / 战果描述: ...
   攻击与伤害合并同一块；多目标范围效果目标写"火球范围内的3名敌人"，其他目标结果放战果描述；先攻多单位合并一块。
3. 角色档案 <char_info>...</char_info>：YAML，字段见GM_STANDARD第五节；生成前先输出 <!-- charGenerationThink: 生态位/驱动力/锚点/数值 -->。
4. 数据更新 <UpdateVariable>...</UpdateVariable>：<Analysis>（英文≤80词，含时间流逝/是否允许戏剧性更新/逐变量分析）+ <JSONPatch>（RFC6902：replace/delta/insert/remove/move；_开头字段只读）。
5. 战斗地图 <battle>...</battle>（可选大型战斗）：管道分隔字段行 UnitId|init 16|hp 32/40|pos x,y|status prone,poisoned|portrait url|att 0|next；status仅用规则标准状态词。

## 二、变量数据管理（精确数据化）
- 角色数据模型（示例DND风格，各规则书按自身内容定义，禁止硬编码其他规则结构）：
  世界(时间/地点/章节/任务) + 角色列表{角色名: {基础信息(姓名/种族/职业/等级/阵营/语言/外貌/性格/背景), 属性, 生命值(当前/最大/临时/生命骰), 护甲等级, 先攻, 速度, 负重, 当前状态, 熟练配置, 特性, 能力资源(当前/最大/恢复规则), 物品(已装备/数量/重量/魔法属性), 施法(法术位/准备/法术), 钱币}}。
- 派生值自动计算（前端schema transform，AI不手改）：总等级=职业等级和；熟练加值=floor((总等级-1)/4)+2；负重=物品重量和，负重状态分未负重/负重/重载/超载并影响速度；AC按护甲公式+敏捷限制。
- 最小写入：只写"本次变化"与"会影响计算的字段"；不写空字段/默认值/旧值；系统自动补全缺省字段。
- effectTags/effects 效果系统：规则化效果键（如 ac_plus_1/save_plus_1/spell_dc_plus_1/weapon_damage_d4）或结构化 effects（target/mode/value，value可引用 @pb/@level/@strmod 等表达式），由前端自动累计到派生值。

## 三、开局流程（分步，一次一步，STOP等待）
1)基础信息 2)属性生成（规则书全部标准模式：购点/骰点/标准数组/手动，骰点自动出结果可重复、不展示过程） 3)等级与职业（介绍主属性/护甲/武器熟练/生命骰） 4)熟练配置/特性选择 5)生命值/法术/资源录入 6)物品装备（护甲影响AC，武器确认伤害公式） 7)自查所有变量 8)同伴与开幕方式（模组/设定/随机/自定义）。
未进入正式剧情前，章节保持"开局流程"。禁止代替用户做选择（除非用户明确要求）。

## 四、NPC角色生成（char_info）
触发：除玩家外重要角色或可能战斗的敌方登场即时触发，严禁开场批量堆砌。
思考四维：生态位（靠什么生存）/驱动力（底层动因）/锚点（辨识度特征）/数值（等级属性装备严格按规则书）。
档案字段：基本信息/外貌特征/强度/主属性/最大生命值/装备/防御/感官/特质/动作/语言/背景概要/性格特质(核心标签/标签解释/行为准则)/关键经历。白描原则，拒绝流水账与八股形容词。

## 五、战斗面板与平衡
- 战斗面板<battle>用于需要战术定位的战斗；一般战斗用<battlecheck>结算即可。
- 敌人不是沙包：集火、利用弱点、优先击杀威胁；轮到敌人就行动，不让玩家打断回合。
- 战斗平衡（参考Lazy Encounter Benchmark）：总遭遇基准≈队伍总等级/4（1-4级）或/2（5级+），单怪CR上限≈平均等级（或×1.5）；超基准=潜在致命。高等级(11+)基准×0.75或×1。超模队伍按"虚拟同等级角色"计入公式。

## 六、美化规范（与GM_STANDARD第八节一致）
CSS用<style>包裹、高对比、中文为主、现代高级感、适配宽屏；书信/商品/物品/装备/任务/咒语按类型美化；异域文字发光+ruby注音；美化与内容重要性成正比，保持视觉一致，避免过度。骰检/战斗结算卡为系统正则渲染，AI不要重复包裹HTML。

## 七、插件落地要求
规则书专用功能（创卡/升级/法术/速查/遭遇）以插件形式落到 Ruler/<系统>/plugins/<id>/；涉及本协议标记的渲染，参考宿主正则渲染机制实现（AI输出标记→前端渲染），插件可提供渲染函数而非要求AI写HTML。

## 八、电子游戏级体验标准（2026-08-05 确立，最高规格；所有规则书模块按此迭代）
本平台不是演示工具，而是**基于TRPG原本规则的半电子游戏**：功能齐全、体验完好、自动注意并思考各种细节。标杆参考：SillyTavern 大型 DND 世界书角色卡（Ruler/_shared_tools/reference/DND2024角色卡标杆/，可只读参考其状态栏HTML/正则/变量schema）。
- **定位**：每个规则系统=完整可玩的电子游戏模块；玩家按规则书走完整流程（创建→升级→战斗→速查→休息）每一步顺畅、数据精准、界面精美。
- **数据化精准**：一切游戏数据（HP/AC/先攻/法术位/物品/状态/资源）结构化存储、可读可改、派生值按规则书公式自动计算实时联动；装备/效果能影响数值（effectTags/effects），禁止纯文本摆数据。
- **角色卡等大型模块必含**（参数来自规则书）：①多角色管理（持久化+恢复+切换+删除+头像）②分页/标签导航（属性/背包/特性/法术/笔记/背景）③查看/编辑双模式 ④数据化字段（物品类别/数量/价格/装备/效果；法术环阶/学派/施法时间/距离/成分/持续/专注）⑤派生值自动计算链 ⑥效果系统（effectTags+effects，@pb/@strmod表达式）⑦玩家驱动掷骰（成长/HP/属性/攻击/豁免/技能可点击掷骰，日志高亮大成功/大失败）⑧休息与资源（短休/长休、法术位格点、资源恢复规则）⑨状态管理（HP当前/最大/临时、状态列表、死亡豁免、灵感）⑩AI接口（当前状态摘要供带团AI读取）。
- **视觉强制标准**（解决"看不清"）：主题与宿主一致——宿主深色高对比（背景#1a1a2e系/文字#e0e0f0系），插件必须深色主题或自带完整浅色容器（禁止浅色卡片嵌深色页面割裂）；文字对比度≥4.5:1（WCAG AA），禁止 #999/#aaa 级别浅灰小字做正文；语义色彩（红=危险/激活、绿=成功/恢复、金=资源、蓝=信息）；标题衬线奇幻字体（Cinzel/Noto Serif SC）+正文现代无衬线；悬停反馈/tooltip/保存通知/展开收起动画；头像可换可裁剪、自定义滚动条、空状态友好文案。
- **验收唯一标准**：真实玩家按规则书走完真实流程每一步顺畅；核对"看不清/点不动/改不了/算不对/数据不落盘"五类缺陷为零；对照本节清单逐项核查。`;

// 系统频道AI对话（SSE）：工具循环直到AI纯文本回复（对标opencode）
app.post('/api/ai/system-chat', async (req, res) => {
  const { messages, provider: reqProvider, model: reqModel, system: reqSystem, reasoningEffort: reqEffort, adventure: reqAdventure, channel: reqChannel } = req.body || {};
  const providerKey = reqProvider || appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];
  if (!provider || !provider.enabled) return res.status(400).json({ error: 'AI提供商未启用或不存在' });
  const model = reqModel || provider.model;
  if (!model) return res.status(400).json({ error: '请先选择或输入模型' });

  const abortController = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abortController.abort(); });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  // 对标 opencode：会话消息完整保留（不截断），历史超预算时用 LLM 压缩（compact）
  // D+会话持久化（2026-08-05）：规则书-冒险-频道三级会话。有 channel 时加载本地 jsonl 历史续用，
  // 循环中增量保存；无 channel 时为传统一次性会话（不持久化）
  const sessAdventure = String(reqAdventure || '默认');
  const sessChannel = String(reqChannel || '');
  const loadedSession = sessChannel ? loadSession(reqSystem, sessAdventure, sessChannel) : [];
  let history = Array.isArray(messages) ? messages.slice() : [];
  // D+：本次请求的新 user 消息落盘（首次时含会话起点一并落盘）
  if (sessChannel) {
    const newUsers = history.filter(m => m.role === 'user' && String(m.content || '').indexOf('【会话起点】') < 0);
    if (!loadedSession.length) {
      const sysFirst = history.find(m => m.role === 'system');
      if (sysFirst) appendSession(reqSystem, sessAdventure, sessChannel, [{ role: 'user', content: '【会话起点】' + String(sysFirst.content || '').substring(0, 500) }]);
    }
    if (newUsers.length) appendSession(reqSystem, sessAdventure, sessChannel, newUsers);
  }
  if (loadedSession.length) {
    // 已持久化历史 + 本次新消息：history 以 jsonl 为准，附加未持久化的新 user 消息
    const persistedUserMsgs = loadedSession.filter(m => m.role === 'user').map(m => String(m.content));
    const freshMsgs = history.filter(m => m.role !== 'system' && !(m.role === 'user' && persistedUserMsgs.includes(String(m.content))));
    history = loadedSession.concat(freshMsgs);
    if (!freshMsgs.length) {
      // 无新消息（纯续问场景兜底）：确保最后一条是 user
      const lastUser = history.slice().reverse().find(m => m.role === 'user');
      if (!lastUser) history.push({ role: 'user', content: '继续' });
    }
  }
  // 最小必要注入（对标 opencode system prompt 动态构建；不写超长 WORK_RULE，规范细节由 skill 工具按需加载）
  // 工具规范=各工具 description（唯一标准）；行为规范（设计审核/举一反三/数据落盘/大文件读取）用 skill agent-guide 按需加载
  const SYSTEM_NOTE = '你是TrpgRecode的自主迭代AI（对标opencode）。工作流程：理解任务目标→规划（复杂任务先todowrite）→定位读取→edit/write_file修改→验证→纯文本总结。唯一验收标准=最佳玩家游戏体验，程序"做完"不算完成；收到需求先想游戏体验应是什么样，主动举一反三优化相关页面与同类问题。开工先调用 skill {"name":"agent-guide"} 加载工作方法（任务流程/设计审核/举一反三/数据落盘/大文件读取）；编写或修改规则书插件前必须调用 skill {"name":"plugin-authoring"}；涉及带团体验/判定/数据管理设计时必须调用 skill {"name":"gm-protocol"}。system参数（所有文件/搜索工具）：规则系统名/__host__/__app__/__root__（软件根目录）。授权：system=__root__有软件根目录读写权（可改 server/、app/、config.json）；只读工具可访问系统任意绝对路径；grep与list_files自动跳过 node_modules/.git/data/Logs/AI任务；修改服务端源码（server/）后必须在最终总结中提醒重启后端生效。协议：无轮数上限、不硬编码maxTokens、reasoningEffort由配置/请求驱动、思考与正文完整推送、工具结果完整保留、历史超预算时自动LLM压缩（compact），防失控仅保留单次调用超时、连接断开中止、空输出重试2次。';
  const firstSystem = history.findIndex(m => m.role === 'system');
  if (firstSystem >= 0) {
    // 防重复注入：system 已含 SYSTEM_NOTE 则不重复拼接
    const sysContent = String(history[firstSystem].content || '');
    const addNote = sysContent.indexOf(SYSTEM_NOTE.substring(0, 30)) < 0 ? '\n\n' + SYSTEM_NOTE : '';
    history[firstSystem] = Object.assign({}, history[firstSystem], { content: sysContent + addNote });
  } else {
    history.unshift({ role: 'system', content: SYSTEM_NOTE });
  }
  // 继续场景引导（2026-08-05）：加载历史后，若最后一条是 assistant 正文（上次任务已完成结论），
  // 注入提示引导 AI 直接基于历史推进，避免"继续"时重新漫长搜索探索
  if (sessChannel && loadedSession.length) {
    const lastMsg = loadedSession[loadedSession.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && typeof lastMsg.content === 'string' && lastMsg.content.trim().length > 50) {
      const resumeHint = '\n\n===== 会话续接提示 =====\n你正在继续一个已有会话。上一条AI结论是："' + String(lastMsg.content).substring(0, 300) + '"……\n如果本条消息是继续/追加需求，直接基于以上会话历史推进（历史完整可用），不要重新通读文件或重新搜索；除非新需求明确要求检查最新状态。';
      history[history.length - 1] = Object.assign({}, history[history.length - 1], {
        content: String(history[history.length - 1].content || '') + resumeHint
      });
    }
  }
  // 对标 opencode overflow.ts：usable = contextLimit - min(20000, maxOutputTokens)
  // contextLimit/maxOutputTokens 来自 config.json ai 配置（可选，缺省 128000/8192），用户可在设置中调整
  const cfgContextLimit = Number(appConfig.ai && appConfig.ai.contextLimit) || 128000;
  const cfgMaxOutput = Number(appConfig.ai && appConfig.ai.maxOutputTokens) || 8192;
  const usableBudget = Math.max(0, cfgContextLimit - Math.min(20000, cfgMaxOutput));
  // 对标 opencode compaction.ts：preserve_recent_tokens = min(8000, max(2000, 25% usable))
  const preserveRecentTokens = Math.min(8000, Math.max(2000, Math.floor(usableBudget * 0.25)));
  const TAIL_TURNS = 2; // 对标 opencode 默认 tail_turns=2
  // 工具输出完整保留入历史，不做外部截断（2026-08-05）：由AI根据自身上下文长度合理预估，
  // 禁止外部设置字符上限（如TOOL_OUTPUT_MAX_CHARS）干扰AI对信息的完整获取
  let rounds = 0;
  let lastCompactRound = -99; // compact 冷却（2026-08-05）：记录上次压缩轮次，避免"压→读→再压"抖动
  let emptyRetries = 0;
  // 空转检测分级（2026-08-05）：连续"无正文输出+只读工具"轮次分级提醒（等级1温和/等级2强提示）；
  // 同时检测同一文件被重复读取（≥3次视为问题引导提示）；提醒让AI自我评估，避免硬干扰其有效规划
  const READONLY_TOOL_NAMES = new Set(['read_file', 'grep', 'glob', 'list_files', 'list_tree', 'get_status', 'webfetch', 'websearch', 'skill']);
  let idleStreak = 0;
  let lastReadFiles = [];
  const IDLE_WARN_LEVEL1 = 3;   // 连续3轮只读无输出 → 等级1温和提醒（自我评估）
  const IDLE_WARN_LEVEL2 = 6;   // 连续6轮仍只读无输出 → 等级2强提示（立即修改）
  const SAME_FILE_REPEAT = 3;   // 同一文件被读取≥3次 → 引导提示
  try {
    while (true) {
      if (abortController.signal.aborted) throw new Error('已中止');
      rounds++;
      const result = await callAI(provider.endpoint, provider.apiKey, model, history, {
        tools: PLUGIN_TOOLS,
        // 对标内置 opencode：不硬编码 maxTokens；reasoningEffort 由配置/请求体决定（默认配置值，未配置则由模型自动）
        reasoningEffort: reqEffort || appConfig.ai.reasoningEffort,
        timeoutMs: 120000,
        signal: abortController.signal
      });
      if (result.usage) send({ type: 'usage', round: rounds, usage: result.usage });
      const raw = String(result.content || '').trim();
      const toolCalls = result.toolCalls || [];
      // 对标 opencode：思考内容完整推送（ai_thinking，不截断），正文完整推送（ai_text）
      if (result.reasoningContent) send({ type: 'ai_thinking', text: String(result.reasoningContent) });
      if (raw) send({ type: 'ai_text', text: raw });
      if (!toolCalls.length) {
        // 空输出（无内容无工具调用）：重试推进，最多2次（防失控保留项）
        if (!raw && emptyRetries < 2) {
          emptyRetries++;
          history.push({ role: 'user', content: '你刚才没有输出内容也没有调用工具。请继续推进任务：基于已读取的信息直接修改插件（edit/write_file），完成后用纯文本总结。' });
          continue;
        }
        // D+会话持久化：结束轮（无工具调用）的 assistant 正文也落盘——否则"继续"时 AI 看不到上次结论
        if (sessChannel && raw) appendSession(reqSystem, sessAdventure, sessChannel, [{ role: 'assistant', content: raw }]);
        send({ type: 'done', content: raw, rounds });
        res.end();
        return;
      }
      emptyRetries = 0;
      history.push({
        role: 'assistant',
        content: raw,
        tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } }))
      });
      if (result.reasoningContent) history[history.length - 1].reasoning_content = result.reasoningContent;
      // D+会话持久化：本轮 assistant 消息落盘（工具结果在下方循环后落盘）
      if (sessChannel) appendSession(reqSystem, sessAdventure, sessChannel, [history[history.length - 1]]);
      for (const tc of toolCalls) {
        let args = {};
        try { args = JSON.parse(tc.arguments || '{}') || {}; } catch (e) { args = {}; }
        send({ type: 'tool', tool: tc.name, args });
        const out = await runPluginTool(tc.name, args, reqSystem, { emit: send, provider, model, signal: abortController.signal });
        send({ type: 'tool_result', tool: tc.name, result: out });
        // 工具结果完整入历史，不做外部截断：AI自行根据上下文长度预估读取量（full/按需模式）
        history.push({ role: 'tool', tool_call_id: tc.id, content: String(out) });
        // D+会话持久化：工具结果落盘
        if (sessChannel) appendSession(reqSystem, sessAdventure, sessChannel, [history[history.length - 1]]);
        // 记录本轮读取的文件（用于同一文件重复读取检测）
        if (tc.name === 'read_file' && args.path) {
          lastReadFiles.push(String(args.path).replace(/^plugins\//, '').replace(/^Ruler\/DND五版不全书\//, ''));
          if (lastReadFiles.length > 30) lastReadFiles.shift();
        }
      }
      // 思考token精简（2026-08-05）：历史只保留最近2轮assistant的完整reasoning_content，
      // 更早轮次的思考内容置空（DeepSeek接受空字符串），避免多轮开发反复重发完整思考链；
      // 正文content与工具结果完整保留（模型主要依赖结论而非早期思考过程）
      const keepReasoningRounds = 2;
      const reasoningIdx = [];
      for (let hi = history.length - 1; hi >= 0; hi--) {
        if (history[hi].role === 'assistant' && history[hi].reasoning_content) {
          reasoningIdx.push(hi);
          if (reasoningIdx.length >= keepReasoningRounds) break;
        }
      }
      const keepSet = {};
      reasoningIdx.forEach(function (i) { keepSet[i] = true; });
      history.forEach(function (m, i) {
        if (m.role === 'assistant' && m.reasoning_content && !keepSet[i]) {
          m.reasoning_content = '';
        }
      });
      // 空转检测分级：连续"无正文输出+全只读工具"轮次
      const allReadOnly = toolCalls.length > 0 && toolCalls.every(tc => READONLY_TOOL_NAMES.has(tc.name));
      if (!raw && allReadOnly) {
        idleStreak++;
        // 同一文件重复读取检测（视为问题引导提示）
        const fileCount = {};
        lastReadFiles.forEach(function (f) { fileCount[f] = (fileCount[f] || 0) + 1; });
        const repeatFiles = Object.keys(fileCount).filter(function (f) { return fileCount[f] >= SAME_FILE_REPEAT; });
        if (repeatFiles.length > 0) {
          idleStreak = 0;
          lastReadFiles = [];
          const msg = '检测到你多次读取同一文件（' + repeatFiles.map(function (f) { return f + '×' + fileCount[f]; }).join('、') + '）。请自我评估：是否在重复读取已有信息？若是，立即用 grep 定位目标函数，一次读取200-400行目标区域后直接 edit/write_file 修改；若需求矛盾或无法执行，用 question 工具向用户指出矛盾点。';
          send({ type: 'ai_text', text: '⚠ ' + msg });
          history.push({ role: 'user', content: msg });
          continue;
        }
        if (idleStreak >= IDLE_WARN_LEVEL2) {
          idleStreak = 0;
          const msg = '检测到连续多轮只读取未修改。请立即停止继续读取：用已读信息直接 edit/write_file 完成修改，再验证。若需求矛盾无法执行，用 question 工具向用户指出矛盾点请求解答。';
          send({ type: 'ai_text', text: '⚠ ' + msg });
          history.push({ role: 'user', content: msg });
          continue;
        }
        if (idleStreak === IDLE_WARN_LEVEL1) {
          const msg = '提醒：已连续' + idleStreak + '轮只读取未修改。请自我评估是否在有效推进：若已有足够信息请直接 edit/write_file 修改；若需求不明确或矛盾，用 question 工具向用户确认；不要继续无目的探索。';
          send({ type: 'ai_text', text: '💡 ' + msg });
          history.push({ role: 'user', content: msg });
        }
      } else {
        idleStreak = 0;
        if (!allReadOnly) lastReadFiles = []; // 出现写操作/正文输出则清空读取记录
      }
      // compact 触发（2026-08-05 调整）：默认预算的70%即触发（数据收集期过长会提前压，
      // 但配合冷却与已确认内容落盘避免抖动；原60%实测压缩过频）；
      // 可通过 config.json ai.compactThreshold 覆盖（0-1，1=满预算）
      // 冷却机制（2026-08-05）：压缩后 COMPACT_COOLDOWN_ROUNDS 轮内不再次触发，
      // 避免"压缩→AI重读→再达阈值→再压缩"的抖动循环（长线大项目数据收集期常见）
      const compactThreshold = Number(appConfig.ai && appConfig.ai.compactThreshold) || 0.7;
      const COMPACT_COOLDOWN_ROUNDS = 15;
      const usage = result.usage || {};
      const ctxTokens = usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
      if (ctxTokens >= usableBudget * compactThreshold && history.length > 6 && rounds - lastCompactRound > COMPACT_COOLDOWN_ROUNDS) {
        // 从尾部往前数 TAIL_TURNS 个 user 轮次，保留尾部预算 preserveRecentTokens
        const userIdx = [];
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'user') { userIdx.push(i); if (userIdx.length >= TAIL_TURNS) break; }
        }
        let tailStart = userIdx.length ? userIdx[userIdx.length - 1] : 2;
        if (tailStart < 2) tailStart = 2;
        const head = history.slice(0, 1);
        const tail = history.slice(tailStart);
        const mid = history.slice(1, tailStart);
        try {
          const summary = await callAI(provider.endpoint, provider.apiKey, model, [
            { role: 'system', content: '你是对话压缩器。用简洁中文按以下模板总结任务对话进展，供后续轮次直接继续执行：\n## 目标（Objective）\n- 用户要完成什么\n\n## 重要细节（Important Details）\n- 约束/偏好/决策/关键事实，或 (none)\n\n## 已确认内容（Confirmed Facts，必填）\n- 本任务已读取/确认过的文件与关键数据结论（如"种族列表：龙裔/矮人/精灵…已从X.htm读取"、"职业起始装备见rule_tables.md第N行"），每条一短行；这样压缩后AI不必重读已确认内容。\n\n## 工作状态（Work State）\n### 已完成（Completed）\n### 进行中（Active）\n### 受阻（Blocked）\n\n## 下一步（Next Move）\n1. ...\n\n## 相关文件（Relevant Files）\n- 路径：为什么相关\n\n规则：保留每个小节即使为空；用简短要点不用长段落；保留精确文件路径、工具名、关键数据；**已确认内容小节必须尽量完整列出已读取文件及其数据要点，防止AI压缩后回头重读**；不要提及压缩过程。' },
            { role: 'user', content: JSON.stringify(mid.map(m => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content.substring(0, 800) : '',
              tool: m.tool_calls && m.tool_calls[0] && m.tool_calls[0].function ? m.tool_calls[0].function.name : '',
              result: typeof m.content === 'string' ? '' : String(m.content || '').substring(0, 300)
            }))).substring(0, 60000) }
          ], { timeoutMs: 60000 });
          const summaryText = (summary && summary.content) ? String(summary.content).trim().substring(0, 4000) : '';
          if (summaryText) {
            history = head.concat([{ role: 'system', content: '【对话自动压缩摘要，原中间消息已移除】\n' + summaryText }], tail);
          } else {
            history = head.concat(tail);
          }
          lastCompactRound = rounds; // 冷却起点：本轮压缩后 COMPACT_COOLDOWN_ROUNDS 内不重复触发
          send({ type: 'ai_text', text: '（上下文已自动压缩，继续执行）' });
          // 对标 opencode：压缩后 auto 继续提示语（英文原文）
          history.push({ role: 'user', content: 'Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.' });
        } catch (e) {
          history = head.concat(tail);
        }
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) { send({ type: 'aborted' }); res.end(); return; }
    send({ type: 'error', error: String(err.message || '').substring(0, 300) });
    res.end();
  }
});

// 流式AI对话（SSE）：reasoning/content增量实时推送，对标opencode思考摘要体验
app.post('/api/ai/chat-stream', async (req, res) => {
  const { messages, provider: reqProvider, model: reqModel, system: reqSystem, adventure: reqAdventure, channel: reqChannel } = req.body;

  const providerKey = reqProvider || appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];

  if (!provider || !provider.enabled) {
    return res.status(400).json({ error: 'AI提供商未启用或不存在' });
  }
  if (!provider.endpoint) {
    return res.status(400).json({ error: '请先设置API地址' });
  }
  if (providerKey === 'gpt' && !provider.apiKey) {
    return res.status(400).json({ error: '请先设置API Key' });
  }

  const model = reqModel || provider.model;
  if (!model) {
    return res.status(400).json({ error: '请先选择或输入模型' });
  }

  try {
    let sessContent = '';
    await callAIStream(req, res, provider.endpoint, provider.apiKey, model, messages, {
      reasoningEffort: appConfig.ai.reasoningEffort || 'high',
      onComplete: (content) => { sessContent = content; }
    });
    // D+会话持久化：玩家频道（带channel时）保存本轮 user+assistant 消息
    if (reqChannel && Array.isArray(messages) && messages.length) {
      const lastUser = messages.slice().reverse().find(m => m.role === 'user');
      const savedMsgs = [];
      if (lastUser) savedMsgs.push({ role: 'user', content: String(lastUser.content || '') });
      savedMsgs.push({ role: 'assistant', content: String(sessContent || '') });
      appendSession(reqSystem, String(reqAdventure || '默认'), reqChannel, savedMsgs);
    }
  } catch (err) {
    if (!res.writableEnded) {
      res.status(500).json({ error: `AI调用失败: ${err.message}` });
    }
  }
});

async function callAIStream(req, res, endpoint, apiKey, model, messages, options = {}) {
  const { chatUrl } = resolveApiUrls(endpoint);
  const isDeepSeek = /deepseek/i.test(`${chatUrl} ${model}`);
  const timeoutMs = Math.max(5000, Math.min(options.timeoutMs || 120000, 120000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const requestMessages = (messages || []).map(message => {
    const next = { ...message };
    if (isDeepSeek && next.role === 'assistant') {
      next.reasoning_content = typeof next.reasoning_content === 'string' ? next.reasoning_content : '';
    } else if (!isDeepSeek) {
      delete next.reasoning_content;
    }
    return next;
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullContent = '';
  let fullReasoning = '';
  try {
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: requestMessages,
        stream: true,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        // DeepSeek v4 思考开关（对标opencode openai-chat协议）
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {})
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      const error = await readErrorResponse(resp);
      res.write(`data: ${JSON.stringify({ type: 'error', error: String(error).substring(0, 300) })}\n\n`);
      res.end();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const evt of events) {
        const dataLine = evt.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        const data = dataLine.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch (e) { continue; }
        const delta = json.choices && json.choices[0] ? json.choices[0].delta : {};
        if (delta && typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          fullReasoning += delta.reasoning_content;
          res.write(`data: ${JSON.stringify({ type: 'reasoning', delta: delta.reasoning_content })}\n\n`);
        }
        if (delta && typeof delta.content === 'string' && delta.content) {
          fullContent += delta.content;
          res.write(`data: ${JSON.stringify({ type: 'content', delta: delta.content })}\n\n`);
        }
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent, reasoningContent: fullReasoning })}\n\n`);
    res.end();
    // D+会话持久化钩子：完整内容在流结束后可用
    if (options.onComplete) options.onComplete(fullContent, fullReasoning);
  } catch (err) {
    const aborted = controller.signal.aborted;
    const payload = aborted
      ? { type: 'aborted' }
      : { type: 'error', error: String(err.message || '流式调用失败').substring(0, 300) };
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); res.end(); } catch (e) { /* 连接已断 */ }
  } finally {
    clearTimeout(timer);
  }
}

async function callAI(endpoint, apiKey, model, messages, options = {}) {
  const startTime = Date.now();
  const { chatUrl } = resolveApiUrls(endpoint);
  const lastMsg = messages[messages.length - 1]?.content?.substring?.(0, 50) || '';
  const isDeepSeek = /deepseek/i.test(`${chatUrl} ${model}`);
  const timeoutMs = Math.max(5000, Math.min(options.timeoutMs || 120000, 120000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  // DeepSeek思考模型要求历史中的assistant消息始终带回reasoning_content。
  // OpenCode也在发送前执行同类补全，避免第二轮开始被API拒绝。
  const requestMessages = (messages || []).map(message => {
    const next = { ...message };
    if (isDeepSeek && next.role === 'assistant') {
      next.reasoning_content = typeof next.reasoning_content === 'string' ? next.reasoning_content : '';
    } else if (!isDeepSeek) {
      delete next.reasoning_content;
    }
    return next;
  });

  console.log(`[AI] → ${chatUrl.substring(0, 80)} model=${model} msg="${lastMsg}"`);

  try {
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: requestMessages,
        stream: false,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.tools && options.tools.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
        // DeepSeek v4 思考开关（对标opencode openai-chat协议）：不传则模型默认不思考
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {})
      }),
      signal: controller.signal,
      timeout: timeoutMs
    });

    const elapsed = Date.now() - startTime;

    if (!resp.ok) {
      const error = await readErrorResponse(resp);
      console.log(`[AI] ✗ ${resp.status} (${elapsed}ms): ${String(error).substring(0, 300)}`);
      throw new Error(`HTTP ${resp.status}: ${String(error).substring(0, 300)}`);
    }

    const json = await resp.json();
    if (json.error) {
      const message = json.error.message || json.error;
      console.log(`[AI] ✗ API错误 (${elapsed}ms): ${message}`);
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }

    if (json.choices && json.choices[0]) {
      const message = json.choices[0].message || {};
      let content = message.content || '';
      if (Array.isArray(content)) {
        content = content
          .map(part => typeof part === 'string' ? part : (part?.text || part?.content || ''))
          .join('');
      }
      const reasoningContent = message.reasoning_content || '';
      // 原生工具调用（opencode模式）：模型直接返回tool_calls，无需从文本抠JSON
      const toolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length
        ? message.tool_calls.map(tc => ({
            id: tc.id || ('call_' + Math.random().toString(36).slice(2, 10)),
            name: tc.function && tc.function.name,
            arguments: tc.function && tc.function.arguments
          }))
        : [];
      console.log(`[AI] ✓ (${elapsed}ms) → ${content.length}字符${toolCalls.length ? `, ${toolCalls.length}个工具调用` : ''}${json.usage && json.usage.prompt_cache_hit_tokens ? `, 缓存命中${json.usage.prompt_cache_hit_tokens}` : ''}`);
      return {
        content,
        reasoningContent,
        model: json.model || model,
        usage: json.usage,
        toolCalls
      };
    }

    console.log(`[AI] ✗ 未知响应格式 (${elapsed}ms)`);
    throw new Error('AI返回了未知格式的响应');
  } catch (err) {
    if (controller.signal.aborted) err = new Error('AI调用已中止或超时');
    if (!err.message.startsWith('HTTP') && !err.message.includes('AI返回') && !err.message.includes('API错误')) {
      console.log(`[AI] ✗ 网络: ${err.message}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
        const rootFiles = fs.readdirSync(sysPath).filter(f => f.endsWith('.md'));
        const sourceDir = path.join(sysPath, 'source');
        const sourceFiles = fs.existsSync(sourceDir)
          ? listFilesRecursive(sourceDir).filter(f => f.endsWith('.md')).map(f => `source/${f.replace(/\\/g, '/')}`)
          : [];
        const files = [...rootFiles, ...sourceFiles].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        systems.push({
          name: entry.name,
          files: files,
          settings: loadRuleSystemSettings(sysPath, entry.name, files),
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

app.get('/api/rules/task-status', (req, res) => {
  const { system } = req.query;
  if (!system) return res.status(400).json({ error: '请指定系统名称' });
  try {
    res.json(readRulebookTaskStatus(system));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rules/task-log', (req, res) => {
  const { system, phase, message, detail } = req.body || {};
  if (!system) return res.status(400).json({ error: '请指定系统名称' });
  try {
    const entry = appendRulebookTaskLog(system, phase, message, detail || {});
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 规则书Agent会话（SSE实时推送：阶段/AI思考/工具调用/结果，对标opencode实时动态）
app.post('/api/rules/agent-run', async (req, res) => {
  const { system, resume, reparse } = req.body || {};
  if (!system) return res.status(400).json({ error: '请指定系统名称' });
  const abortController = new AbortController();
  // 仅当响应未完成时连接关闭才算客户端断开；Node中req.on('close')在请求体读完即触发，不可用于断连判断
  res.on('close', () => { if (!res.writableEnded) abortController.abort(); });
  if (resume) appendRulebookTaskLog(system, 'agent_resumed', '用户触发续接，规则书接管Agent继续执行');
  if (reparse) {
    // 重新解析：清空旧拆解产物（source/compressed），保留母本original与图片资产assets
    const reparseTarget = cleanRuleSystemDirForReparse(system);
    appendRulebookTaskLog(system, 'agent_reparse', '用户触发重新解析，已清空旧规则文本与配置', { cleared: reparseTarget });
  }
  const providerKey = appConfig.ai.activeProvider;
  const provider = appConfig.ai.providers[providerKey];
  if (!provider || !provider.enabled || !provider.endpoint || !provider.model) {
    return res.status(400).json({ error: 'AI未配置，无法启动规则书接管Agent' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  try {
    const result = await runRulebookIngestAgent(system, provider, { signal: abortController.signal, onEvent: send, resume: !!resume });
    send({ type: 'done', result });
    res.end();
  } catch (err) {
    if (abortController.signal.aborted) {
      appendRulebookTaskLog(system, 'agent_aborted', '前端连接关闭，规则书接管Agent已中止');
      send({ type: 'error', error: '任务已中止' });
      res.end();
      return;
    }
    appendRulebookTaskLog(system, 'agent_failed', '规则书接管Agent失败', { error: err.message });
    send({ type: 'error', error: err.message });
    res.end();
  }
});

// 删除规则系统（含目录内所有内容：母本、拆解、配置、日志）
app.post('/api/rules/delete', (req, res) => {
  const { system } = req.body || {};
  if (!system) return res.status(400).json({ error: '请指定系统名称' });
  const safeSystem = cleanRuleName(system);
  const targetDir = path.join(RULER_DIR, safeSystem);
  if (!path.resolve(targetDir).startsWith(path.resolve(RULER_DIR))) return res.status(403).json({ error: '路径越界' });
  if (!fs.existsSync(targetDir)) return res.status(404).json({ error: '规则系统不存在' });
  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log(`[规则书] 已删除规则系统: ${safeSystem}`);
  res.json({ success: true, system: safeSystem });
});

// ── 插件系统API（AI动态编写的功能模块，前端热加载） ──────
// 等待中的用户提问（question工具用）
const pendingQuestions = new Map();

// 用户回答question工具的问题
app.post('/api/agent-answer', (req, res) => {
  const { id, answer } = req.body || {};
  const pending = pendingQuestions.get(id);
  if (!pending) return res.status(404).json({ error: '问题不存在或已超时' });
  clearTimeout(pending.timer);
  pendingQuestions.delete(id);
  pending.resolve(String(answer || ''));
  res.json({ success: true });
});

// 列出某规则系统的插件
app.get('/api/plugins/list', (req, res) => {
  const { system } = req.query;
  if (!system) return res.status(400).json({ error: '请指定系统名称' });
  const safeSystem = cleanRuleName(system);
  const pluginsDir = path.join(RULER_DIR, safeSystem, 'plugins');
  const list = [];
  if (fs.existsSync(pluginsDir)) {
    for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(pluginsDir, entry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (manifest.id) list.push(manifest);
        } catch (e) { /* 损坏的manifest跳过 */ }
      }
    }
  }
  res.json(list);
});

// 获取插件入口JS
app.get('/api/plugins/entry', (req, res) => {
  const { system, id } = req.query;
  if (!system || !id) return res.status(400).json({ error: '缺少参数' });
  const safeSystem = cleanRuleName(system);
  const safeId = cleanRuleName(id);
  const entryPath = path.join(RULER_DIR, safeSystem, 'plugins', safeId, 'index.js');
  if (!path.resolve(entryPath).startsWith(path.resolve(RULER_DIR))) return res.status(403).json({ error: '路径越界' });
  if (!fs.existsSync(entryPath)) return res.status(404).json({ error: '插件不存在' });
  res.type('application/javascript; charset=utf-8');
  res.send(fs.readFileSync(entryPath, 'utf8'));
});

// 宿主渲染策略插件（Ruler/_host_plugins/，type=host，全局生效）
app.get('/api/plugins/host', (req, res) => {
  const list = [];
  try {
    if (fs.existsSync(HOST_PLUGINS_DIR)) {
      for (const entry of fs.readdirSync(HOST_PLUGINS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(HOST_PLUGINS_DIR, entry.name, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest.id && manifest.type === 'host') list.push(manifest);
          } catch (e) { /* 损坏的manifest跳过 */ }
        }
      }
    }
  } catch (e) { /* ignore */ }
  res.json(list);
});

app.get('/api/plugins/host-entry', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: '缺少id' });
  const safeId = cleanRuleName(id);
  const entryPath = path.join(HOST_PLUGINS_DIR, safeId, 'index.js');
  if (!path.resolve(entryPath).startsWith(path.resolve(HOST_PLUGINS_DIR))) return res.status(403).json({ error: '路径越界' });
  if (!fs.existsSync(entryPath)) return res.status(404).json({ error: 'host插件不存在' });
  res.type('application/javascript; charset=utf-8');
  res.send(fs.readFileSync(entryPath, 'utf8'));
});

// 写入插件（AI工具调用）：{ system, id, name, version, description, entry }
app.post('/api/plugins/save', (req, res) => {
  const { system, id, name, version, description, entry } = req.body || {};
  if (!system || !id) return res.status(400).json({ error: '缺少system或id' });
  const safeSystem = cleanRuleName(system);
  const safeId = cleanRuleName(id);
  const pluginDir = path.join(RULER_DIR, safeSystem, 'plugins', safeId);
  if (!path.resolve(pluginDir).startsWith(path.resolve(RULER_DIR))) return res.status(403).json({ error: '路径越界' });
  fs.mkdirSync(pluginDir, { recursive: true });
  const manifest = {
    id: safeId,
    name: String(name || safeId),
    version: String(version || '1.0'),
    description: String(description || ''),
    type: 'panel',
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (typeof entry === 'string' && entry.trim()) {
    fs.writeFileSync(path.join(pluginDir, 'index.js'), entry, 'utf8');
  }
  console.log(`[插件] 已写入: ${safeSystem}/${safeId}`);
  res.json({ success: true, manifest });
});

// ── AI文件写入（限定在Ruler内） ──────

app.post('/api/ai/write', (req, res) => {
  const { system, subpath, content } = req.body;
  const targetPath = path.resolve(RULER_DIR, system || 'DND', subpath || '');
  if (!isPathAllowed(targetPath)) return res.status(403).json({ error: '路径不在允许范围内' });
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
  res.json({ success: true, path: targetPath });
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

function cleanRuleName(value) {
  const name = String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return name || '未命名规则书';
}

function fixUploadOriginalName(name) {
  const raw = String(name || '未命名规则书');
  if (!/[ÃÂäåçæèé]/.test(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded && !decoded.includes('�') ? decoded : raw;
  } catch (e) {
    return raw;
  }
}

function removeTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) { /* ignore */ }
}

function saveRuleSourceFile(system, fileName, content) {
  const safeSystem = cleanRuleName(system);
  const safeFileName = cleanRuleName(fileName).replace(/\.[^.]+$/, '.md');
  const sourceDir = path.join(RULER_DIR, safeSystem, 'source');
  const compressedDir = path.join(RULER_DIR, safeSystem, 'compressed');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(compressedDir, { recursive: true });

  const targetPath = path.join(sourceDir, safeFileName);
  fs.writeFileSync(targetPath, content, 'utf8');
  return { system: safeSystem, fileName: safeFileName, path: targetPath };
}

function saveRuleOriginalFile(system, originalName, tempPath) {
  const safeSystem = cleanRuleName(system);
  const safeOriginalName = cleanRuleName(originalName);
  const originalDir = path.join(RULER_DIR, safeSystem, 'original');
  fs.mkdirSync(originalDir, { recursive: true });

  let finalName = safeOriginalName;
  let finalPath = path.join(originalDir, finalName);
  const parsed = path.parse(safeOriginalName);
  let index = 2;
  while (fs.existsSync(finalPath)) {
    finalName = `${parsed.name}-${index++}${parsed.ext}`;
    finalPath = path.join(originalDir, finalName);
  }

  fs.copyFileSync(tempPath, finalPath);
  return {
    system: safeSystem,
    fileName: finalName,
    path: finalPath,
    relativePath: `Ruler/${safeSystem}/original/${finalName}`
  };
}

function buildRulebookIngestPrompt(savedOriginal, kind) {
  const system = savedOriginal.system;
  const relativePath = savedOriginal.relativePath.replace(/\\/g, '/');
  return `规则书解析任务。\n\n对象文件：${relativePath}\n当前规则系统条目：Ruler/${system}/\n文件类型：${kind}\n\n执行边界：关闭网页或后端后不继续执行；不自动重试；单轮AI调用限制输出长度和超时；优先使用抽样和索引节约token。\n\n核心要义：\n1. 上传时自动创建的文件夹名只是临时承载名，不一定是最终规则系统名。解析后应根据书名、版本、语种、资料类型给出合适的 canonicalSystemName；例如上传名含“不全书”但内容实际是 DND5E 规则合集时，应改成更准确、稳定、可复用的名称。\n2. 工具已完成的步骤不要重复做。图片资产已经由工具拆解时，不要要求重新拆图片；只确认 manifest 和资产路径是否可用于索引。\n3. AI负责判断规则书结构和命名，工具负责解包、列目录、提取图片、改名、写文件。\n4. 规则文本必须根据实际目录、标题、正文和链接关系决定如何拆解；不要使用固定书名、固定章节名或固定优先级。\n5. 忽略 CHM 自用内容，例如导航页、索引页、搜索页、按钮、模板、脚本、样式、空白页、纯资源页。\n6. 生成 Ruler/<最终规则系统名>/compressed/rule_settings.json，actions 表示选择该规则后应执行的配置动作，例如载入规则、追加拓展、激活模组等，由本书实际内容决定。\n\n请开始有限解析。`;
}

function writeRulebookIngestTask(savedOriginal, kind) {
  const systemDir = path.join(RULER_DIR, savedOriginal.system);
  const taskDir = path.join(systemDir, 'tasks');
  fs.mkdirSync(taskDir, { recursive: true });
  const prompt = buildRulebookIngestPrompt(savedOriginal, kind);
  const manifest = {
    system: savedOriginal.system,
    kind,
    originalFileName: savedOriginal.fileName,
    originalPath: savedOriginal.relativePath,
    status: 'await_ai_ingest',
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(systemDir, 'original', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(taskDir, 'rulebook_ingest_prompt.md'), prompt, 'utf8');
  appendRulebookTaskLog(savedOriginal.system, 'created', `已创建规则书接管任务。母本：${savedOriginal.relativePath}`);
  return { prompt, manifest, promptPath: `Ruler/${savedOriginal.system}/tasks/rulebook_ingest_prompt.md` };
}

function rulebookTaskDir(system) {
  const safeSystem = cleanRuleName(system);
  const taskDir = path.join(RULER_DIR, safeSystem, 'tasks');
  if (!path.resolve(taskDir).startsWith(path.resolve(RULER_DIR))) throw new Error('规则书任务路径越界');
  fs.mkdirSync(taskDir, { recursive: true });
  return { safeSystem, taskDir };
}

function appendRulebookTaskLog(system, phase, message, detail = {}) {
  const { safeSystem, taskDir } = rulebookTaskDir(system);
  const entry = {
    time: new Date().toISOString(),
    system: safeSystem,
    phase: String(phase || 'event'),
    message: String(message || ''),
    detail
  };
  const line = JSON.stringify(entry);
  fs.appendFileSync(path.join(taskDir, 'ingest.log'), `${line}\n`, 'utf8');
  fs.writeFileSync(path.join(taskDir, 'latest-status.json'), JSON.stringify(entry, null, 2), 'utf8');
  console.log(`[规则书接管] ${safeSystem} ${entry.phase}: ${entry.message}`);
  return entry;
}

function readRulebookTaskStatus(system) {
  const { safeSystem, taskDir } = rulebookTaskDir(system);
  const logPath = path.join(taskDir, 'ingest.log');
  const statusPath = path.join(taskDir, 'latest-status.json');
  const manifestPath = path.join(RULER_DIR, safeSystem, 'original', 'manifest.json');
  const promptPath = path.join(taskDir, 'rulebook_ingest_prompt.md');
  const logLines = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-200)
    : [];
  let latest = null;
  let manifest = null;
  try { if (fs.existsSync(statusPath)) latest = JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch (e) { latest = null; }
  try { if (fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { manifest = null; }
  return {
    system: safeSystem,
    latest,
    manifest,
    promptPath: fs.existsSync(promptPath) ? `Ruler/${safeSystem}/tasks/rulebook_ingest_prompt.md` : '',
    logPath: `Ruler/${safeSystem}/tasks/ingest.log`,
    logs: logLines.map(line => {
      try { return JSON.parse(line); } catch (e) { return { time: '', phase: 'raw', message: line }; }
    })
  };
}

function listFilesRecursive(rootDir) {
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.push(path.relative(rootDir, fullPath));
    }
  }
  if (fs.existsSync(rootDir)) walk(rootDir);
  return files;
}

function ruleFileDisplayName(file) {
  return String(file || '')
    .replace(/^source\//, '')
    .replace(/\.md$/i, '')
    .replace(/\/index$/i, '')
    .replace(/\//g, ' / ');
}

function uniqueLimited(values, limit = 8) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function loadRuleSystemSettings(sysPath, system, files = []) {
  const settingsPath = path.join(sysPath, 'compressed', 'rule_settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      console.warn(`[规则书] 读取AI规则设置失败 ${settingsPath}: ${e.message}`);
    }
  }

  const sourceFiles = files.filter(f => String(f || '').replace(/\\/g, '/').startsWith('source/'));
  const originalDir = path.join(sysPath, 'original');
  const originals = fs.existsSync(originalDir)
    ? fs.readdirSync(originalDir).filter(name => /\.(chm|pdf|txt|md)$/i.test(name))
    : [];
  return {
    system,
    audience: '上传规则书后启动AI解析，会自动根据AI分析生成配置选项。',
    fileCount: sourceFiles.length,
    originalFiles: originals,
    topLevelSources: [],
    actions: originals.length > 0 && sourceFiles.length === 0
      ? [{
          type: 'await_ai_ingest',
          title: '等待AI接管解析',
          detail: '已保存原初母本。解析流程会使用工具查看、解包、判断结构、忽略CHM自用内容，并生成配置选项。',
          examples: originals
        }]
      : []
  };
}

function listExtractedRuleFiles(extractDir) {
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (/\.(htm|html)$/i.test(entry.name)) {
        const rel = path.relative(extractDir, fullPath).replace(/\\/g, '/');
        const html = readTextFileSmart(fullPath);
        files.push({ rel, title: htmlTitle(html, path.basename(rel, path.extname(rel))), size: Buffer.byteLength(html) });
      }
    }
  }
  walk(extractDir);
  return files.sort((a, b) => a.rel.localeCompare(b.rel, 'zh-CN', { numeric: true }));
}

function compactRuleSample(extractDir, item, maxChars = 900) {
  const fullPath = path.join(extractDir, item.rel);
  const text = htmlToMarkdownDocument(readTextFileSmart(fullPath), item.title)
    .replace(/\s{3,}/g, ' ')
    .slice(0, maxChars);
  return `FILE: ${item.rel}\nTITLE: ${item.title}\nTEXT: ${text}`;
}

// 解析AI输出：尝试所有```json块，取"包含最多已知字段"的块，避免取到示例/空占位块
const AI_PLAN_FIELDS = ['canonicalSystemName', 'renameReason', 'ignoreHints', 'sourceGroups', 'sourceFiles', 'actions', 'selectHints'];

// 异步执行子进程（避免execFileSync阻塞事件循环，导致进度轮询/SSE被卡住）
function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: options.timeout || 60000, windowsHide: true, maxBuffer: 1024 * 1024 * 16, cwd: options.cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').toString().substring(0, 500)));
      else resolve(stdout || '');
    });
  });
}

// glob模式转正则（支持 **、*、?，对标opencode glob工具）
function globToRegex(pattern) {
  let out = '';
  const str = String(pattern || '');
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '*') {
      if (str[i + 1] === '*') { out += '.*'; i++; }
      else out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\.^$+{}()[]|'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp('^' + out + '$', 'i');
}

// ── 规则书解析Agent（对标opencode：skill提示词 + 指定文件 + 完整工具集自主调用） ──────
const AGENT_TOOL_PROMPT = `你是规则书解析Agent。规则书HTML已规范在source/，图片已提取，工具见系统工具列表。

平台定位（解析必须服务的目标）：动态解析任意TRPG规则书→自动生成配套角色卡与工具（插件）→AI作为GM带团。核心追求：TRPG的自由+电脑游戏的精准——带团时AI以结构化标记输出判定与状态，系统渲染界面；角色血量等游戏数据以变量精确管理。因此解析产物必须让后续AI能：①查规则（索引/压缩表/规则树）②生成角色卡与工具（数据化字段）③带团判定（数值公式/DC/加值规则）。

设计审核（一切修改前必做，2026-08-04）：任何修改先过两层审核再动手——第一层设计目的审核（游戏策划视角）：这个行为在游戏中的设计目的是什么、谁在执行、意图是什么、期望的游戏结果是什么、问题与设计目的的偏差在哪；禁止只从程序层找修复点。第二层游戏合理性与用户体验审核（玩家视角）：玩家看到什么、是否符合直觉、是否直观方便操作、是否符合规则书原文。两层通过后才能事实检查与修改。

最高验收标准（强制，唯一验收标准）：完整还原规则书并产出最佳玩家体验，程序"写完"永远不算完成。解析产物（压缩表/设置/插件）必须支撑真实玩家走完完整流程（属性生成→角色构成→装备→掷骰→升级→速查），缺任一环节=未完成。禁止把任务想简单；动手前先理解全书结构并规划（todowrite），再按规划实施并实际验证。

带团数据化要求（本平台特有）：write_settings 时应提取该规则书的"可数据化核心"——属性与技能映射、判定公式（d20/骰式+加值 vs DC/难度等级表）、血量/资源/状态等数值字段、角色卡字段清单、开局与升级流程要点、战斗结算规则（命中/伤害/濒死）；这些是后续插件与GM带团的数据基础。涉及带团体验设计时可用 skill {"name":"gm-protocol"} 加载GM带团协议。

工作方法：
1. 先看初始消息中的一级目录概览与疑似目录页建立全书结构；找特定内容用grep搜内容或glob按文件名定位，不要逐页翻索引。
2. 抽样read_file确认正文与垃圾页，用exclude_file排除导航/索引/搜索/模板/脚本/样式/空页/纯资源页（不删文件）。需要确认排除/压缩进度时用get_status，禁止写python或脚本去读rule_index.json/rule_tables.md等产物文件。
3. 职业表、法术表、装备表等核心数据页用compress_to_table压缩为查表表格，供后续查询直接消费。
4. 根据实际内容用write_settings写入规则设置；规则系统名不合适时用rename_system改名（占位名会被系统拒绝）。
5. 需要追加功能时（职业升级工具、法术查询等）：先用skill工具加载plugin-authoring规范，再用write_file编写插件到plugins/<id>/，前端热加载生效。界面定律：规则书相关功能必须放入规则书详情面板——详情区显示入口按钮，点击按钮展开功能面板；禁止常驻堆叠大面板或独立弹窗；专用功能必须填充/替换同一个详情容器，不要另起一个独立模块把"上传规则书后启动解析流程……"等通用占位说明顶到下面。插件必须实际验证：正例命中、空例为空、点击可展开、数据来自规则书。
6. 全部完成后，自然语言总结工作成果（含验证证据）——输出纯文本即任务完成。
7. 收尾前：若尚未编写插件，先用skill工具加载plugin-authoring规范，再为本书核心玩法编写1-3个实用插件（如职业升级工具、法术查询面板、怪物速查、遭遇生成器）到plugins/<id>/，前端会热加载。

环境：Windows。bash是cmd环境（无ls/rm/cat/curl；列目录用list_tree或list_files；python先write_file写脚本再执行「python 脚本路径」，禁止python -c内联）。
工具选择引导（效率优先）：想知道文件行数/大小/目录结构→用 list_files/list_tree/glob（会显示大小与数量），或 read_file 读第一行（返回中显示总行数）；想在文件里找关键词→grep；读文件→read_file（一次读200-400行减少轮次）；修改→edit/write_file；bash 只在真正需要命令执行的场景使用（启动/构建/运行脚本），文件操作一律用专用工具。
脚本规范：临时脚本（一次性、与本次解析强相关）写入 _tools/ 目录，会话结束系统自动清理；通用可复用脚本（目录统计、HTML解析、表格处理等）写入 Ruler/_shared_tools/ 沉淀为共享工具，后续解析其他规则书可直接复用（初始消息会列出已有共享工具）。不要创建 tmp_* 或 scripts/ 等其他位置。
约束：节约token，抽样阅读，不反复翻同一页索引，不套固定书名或章节顺序。`;

// 列出共享工具库（Ruler/_shared_tools/）现有工具清单
function listSharedTools() {
  try {
    if (!fs.existsSync(SHARED_TOOLS_DIR)) return '';
    return fs.readdirSync(SHARED_TOOLS_DIR, { withFileTypes: true })
      .map(e => e.name)
      .join('\n');
  } catch (e) { return ''; }
}

// 疑似目录/索引页检测（给AI的初始入口，避免在6817个文件里迷路）
function detectTocCandidates(files, limit = 8) {
  const patterns = /(index|contents|toc|目录|索引|目錄|tableofcontents|content)/i;
  const hits = files
    .filter(f => patterns.test(f.rel) && f.size < 200000)
    .sort((a, b) => a.rel.length - b.rel.length)
    .slice(0, limit);
  return hits.map(f => `${f.rel} | ${f.title}`);
}

// 疑似垃圾页候选检测（文件名模式匹配，工具层0 token生成，供AI直接排除或忽略）
function detectGarbageCandidates(files, limit = 40) {
  const patterns = /(模板|目录|索引|导航|搜索|鸣谢|更新日志|旧版说明|分隔|空白|网站介绍|骰娘|写在前面)/i;
  const hits = files
    .filter(f => patterns.test(f.rel) && !/模板生物/.test(f.rel) && f.size < 300000)
    .sort((a, b) => a.rel.length - b.rel.length)
    .slice(0, limit);
  return hits.map(f => f.rel);
}

// 在解包目录上执行AI请求的工具
async function runAgentTool(tool, args, ctx) {
  const extractDir = ctx.extractDir;
  const safeSystem = ctx.safeSystem;
  args = args || {};
  switch (tool) {
    case 'glob': {
      // 对标opencode glob：按模式找文件（优先索引HTML；无匹配时回退文件系统查找其他产物文件）
      let pattern = String(args.pattern || '**/*.html');
      if (pattern.startsWith('source/')) pattern = pattern.slice(7); // 索引rel不含source/前缀，兼容两种视角
      const limit = Math.min(100, parseInt(args.limit) || 50);
      let re;
      try { re = globToRegex(pattern); } catch (e) { return '无效glob模式'; }
      const hits = ctx.indexFiles.filter(f => re.test(f.rel));
      if (hits.length) {
        const sliced = hits.slice(0, limit);
        return `匹配${hits.length}个：\n${sliced.map(f => f.rel).join('\n') || '（无匹配）'}`;
      }
      // 回退：递归扫描系统目录匹配（覆盖compressed/_tools/plugins等非HTML文件）
      const fsHits = [];
      const walkGlob = (dir, prefix) => {
        if (fsHits.length >= limit) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries) {
          if (fsHits.length >= limit) return;
          const p = prefix ? prefix + '/' + e.name : e.name;
          if (e.isDirectory()) walkGlob(path.join(dir, e.name), p);
          else if (re.test(p)) fsHits.push(p);
        }
      };
      walkGlob(ctx.systemDir, '');
      return fsHits.length
        ? `匹配${fsHits.length}个（非索引文件）：\n${fsHits.slice(0, limit).join('\n')}`
        : '（无匹配）';
    }
    case 'grep': {
      // 对标opencode grep：按正则搜索文件内容
      const pattern = String(args.pattern || '');
      if (!pattern) return '请提供正则表达式';
      let re;
      try { re = new RegExp(pattern, 'i'); } catch (e) { return '无效正则: ' + e.message; }
      const include = String(args.include || '').replace(/^source\//, '');
      const pathFilter = String(args.path || '').replace(/^source\//, '').toLowerCase();
      const limit = Math.min(50, parseInt(args.limit) || 20);
      const matches = [];
      for (const f of ctx.indexFiles) {
        if (pathFilter && !f.rel.toLowerCase().includes(pathFilter)) continue;
        if (include && !globToRegex(include).test(f.rel)) continue;
        try {
          const text = htmlToMarkdownDocument(readTextFileSmart(path.join(extractDir, f.rel)), f.title);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length && matches.length < limit; i++) {
            if (re.test(lines[i])) {
              matches.push(`${f.rel}: Line ${i + 1}: ${lines[i].trim().substring(0, 150)}`);
            }
          }
        } catch (e) { /* 文件读取失败跳过 */ }
        if (matches.length >= limit) break;
      }
      return matches.length ? `找到${matches.length}个匹配：\n${matches.join('\n')}` : '未找到匹配';
    }
    case 'write_file': {
      // 对标opencode write：写任意文件（限定规则系统目录内或共享工具库）
      const rel = cleanRelativePath(String(args.path || ''));
      const targetPath = path.join(ctx.systemDir, rel);
      const inShared = path.resolve(targetPath).startsWith(path.resolve(SHARED_TOOLS_DIR));
      if (!inShared && !path.resolve(targetPath).startsWith(path.resolve(ctx.systemDir))) return '路径越界，写入拒绝';
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, String(args.content || ''), 'utf8');
      return `已写入 ${rel}（${String(args.content || '').length}字符）`;
    }
    case 'list_files': {
      // 对标opencode list：列目录
      let rel = String(args.path || '').replace(/\\/g, '/');
      let dir = path.join(ctx.systemDir, rel);
      if (!path.resolve(dir).startsWith(path.resolve(ctx.systemDir))) return '路径越界';
      if (!fs.existsSync(dir) && rel && !rel.startsWith('source/')) {
        // 兼容无source/前缀的路径（与索引rel视角一致）
        const alt = path.join(ctx.systemDir, 'source', rel);
        if (fs.existsSync(alt)) { dir = alt; rel = 'source/' + rel.replace(/^\/+/, ''); }
      }
      if (!fs.existsSync(dir)) return `目录不存在：${rel || '/'}`;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const lines = entries.slice(0, 100).map(e => (e.isDirectory() ? e.name + '/' : e.name));
      return `${rel || '规则系统根目录'}（共${entries.length}项）：\n${lines.join('\n') || '（空目录）'}`;
    }
    case 'list_tree': {
      // 补充工具：递归目录树（替代AI自写ls/tree脚本），[D]=目录 [F]=文件
      let rel = String(args.path || '').replace(/\\/g, '/');
      const maxDepth = Math.max(1, Math.min(4, parseInt(args.depth) || 2));
      const limit = Math.max(10, Math.min(300, parseInt(args.limit) || 150));
      let dir = path.join(ctx.systemDir, rel);
      if (!path.resolve(dir).startsWith(path.resolve(ctx.systemDir))) return '路径越界';
      if (!fs.existsSync(dir) && rel && !rel.startsWith('source/')) {
        // 兼容无source/前缀的路径
        const alt = path.join(ctx.systemDir, 'source', rel);
        if (fs.existsSync(alt)) { dir = alt; rel = 'source/' + rel.replace(/^\/+/, ''); }
      }
      if (!fs.existsSync(dir)) return `目录不存在：${rel || '/'}`;
      const lines = [];
      let count = 0;
      let truncated = false;
      function walkTree(cur, prefix, depth) {
        if (truncated) return;
        let entries;
        try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { return; }
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh');
        });
        for (const e of entries) {
          if (count >= limit) { truncated = true; return; }
          lines.push(`${prefix}${e.isDirectory() ? '[D] ' : '[F] '}${e.name}`);
          count++;
          if (e.isDirectory() && depth < maxDepth) {
            walkTree(path.join(cur, e.name), prefix + '    ', depth + 1);
          }
        }
      }
      walkTree(dir, '', 0);
      return `${rel || '规则系统根目录'}（显示${count}项${truncated ? '，已达上限' : ''}）：\n${lines.join('\n') || '（空目录）'}`;
    }
    case 'bash': {
      // 对标opencode bash：执行命令（工作目录=规则系统目录，超时30s）——统一逻辑见 execBashTool
      const cmd = String(args.command || '');
      return await execBashTool(cmd, ctx.systemDir);
    }
    case 'todowrite': {
      // 对标opencode todowrite：维护任务清单
      const todos = Array.isArray(args.todos) ? args.todos : [];
      ctx.todos = todos;
      try {
        fs.mkdirSync(path.join(ctx.systemDir, 'tasks'), { recursive: true });
        fs.writeFileSync(path.join(ctx.systemDir, 'tasks', 'todo.json'), JSON.stringify({ updatedAt: new Date().toISOString(), todos }, null, 2), 'utf8');
      } catch (e) { /* ignore */ }
      const summary = todos.map(t => `[${t.status || 'pending'}] ${t.content || t}`).join('；');
      return `任务清单已更新（${todos.length}项）：${summary}`;
    }
    case 'get_status': {
      // 查看当前解析状态（防止AI写脚本读rule_index.json/rule_tables.md）
      const excluded = ctx.excluded || [];
      const compressed = ctx.compressedTables ? Array.from(ctx.compressedTables) : [];
      const tablesPath = path.join(ctx.systemDir, 'compressed', 'rule_tables.md');
      const tablesLen = fs.existsSync(tablesPath) ? fs.statSync(tablesPath).size : 0;
      const settingsPath = path.join(ctx.systemDir, 'compressed', 'rule_settings.json');
      const hasSettings = fs.existsSync(settingsPath);
      return `解析状态：总页数${ctx.indexFiles.length}；已排除${excluded.length}页（${excluded.join('、').substring(0, 400) || '无'}）；已压缩表格${compressed.length}个（${compressed.join('、').substring(0, 300) || '无'}）；rule_tables.md ${tablesLen}字符；rule_settings.json ${hasSettings ? '已写入' : '未写入'}。`;
    }
    case 'skill': {
      // 对标opencode skill：加载技能文档
      const name = String(args.name || '');
      if (name === 'plugin-authoring') return PLUGIN_AUTHORING_SKILL;
      if (name === 'gm-protocol') return GM_PROTOCOL_SKILL;
      if (name === 'gm-standard') return GM_STANDARD;
      return `未知skill：${name}。可用：plugin-authoring（插件编写规范）、gm-protocol（GM带团协议：判定标记/变量数据管理/开局流程/NPC生成/战斗平衡/美化规范）、gm-standard（玩家频道实际注入的GM带团标准提示词）`;
    }
    case 'webfetch': {
      // 对标opencode webfetch：抓取网页内容
      const url = String(args.url || '');
      if (!/^https?:\/\//i.test(url)) return '请提供有效URL（http/https）';
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TrpgRecode/1.0' },
          signal: AbortSignal.timeout(15000)
        });
        if (!resp.ok) return `抓取失败 HTTP ${resp.status}`;
        const ct = String(resp.headers.get('content-type') || '');
        let text = '';
        if (/html|xml/i.test(ct)) text = stripHtmlToText(await resp.text());
        else text = await resp.text();
        const maxChars = parseInt(args.maxChars) || 0; // 不设默认截断，AI自行判断；0=完整返回
        return `URL: ${url}\n内容:\n${text.replace(/\s{3,}/g, ' ').substring(0, maxChars)}`;
      } catch (e) {
        return '抓取失败: ' + String(e.message || e).substring(0, 300);
      }
    }
    case 'websearch': {
      // 对标opencode websearch：联网搜索（DuckDuckGo，无需key）
      const query = String(args.query || '');
      if (!query) return '请提供搜索词';
      try {
        const resp = await fetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(15000)
        });
        const html = await resp.text();
        const results = [];
        const linkRe = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        const snipRe = /<td class="result-snippet">([\s\S]*?)<\/td>/g;
        const snippets = [];
        let m;
        while ((m = snipRe.exec(html)) && snippets.length < 10) snippets.push(stripHtmlToText(m[1]).trim());
        let i = 0;
        while ((m = linkRe.exec(html)) && i < 8) {
          const title = stripHtmlToText(m[2]).trim();
          if (!title) continue;
          results.push(`${i + 1}. ${title}\n   ${m[1]}\n   ${snippets[i] || ''}`.substring(0, 400));
          i++;
        }
        return results.length ? `搜索结果（DuckDuckGo）：\n${results.join('\n\n')}` : '无搜索结果';
      } catch (e) {
        return '搜索失败: ' + String(e.message || e).substring(0, 300);
      }
    }
    case 'edit': {
      // 对标opencode edit：在文件中替换文本（增量编辑）
      const rel = cleanRelativePath(String(args.path || ''));
      const targetPath = path.join(ctx.systemDir, rel);
      const inShared = path.resolve(targetPath).startsWith(path.resolve(SHARED_TOOLS_DIR));
      if (!inShared && !path.resolve(targetPath).startsWith(path.resolve(ctx.systemDir))) return '路径越界';
      if (!fs.existsSync(targetPath)) return `文件不存在：${rel}`;
      const oldText = String(args.oldText || '');
      const newText = String(args.newText || '');
      if (!oldText) return '请提供oldText（要替换的原文）';
      const content = fs.readFileSync(targetPath, 'utf8');
      if (!content.includes(oldText)) return `未找到要替换的文本：${oldText.substring(0, 50)}…`;
      const count = content.split(oldText).length - 1;
      fs.writeFileSync(targetPath, content.split(oldText).join(newText), 'utf8');
      return `已编辑 ${rel}（替换${count}处）`;
    }
    case 'question': {
      // 对标opencode question：向用户提问并等待回答（SSE推送，120秒超时）
      const text = String(args.text || '');
      if (!text) return '请提供问题内容';
      const id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const answer = await new Promise((resolve) => {
        const timer = setTimeout(() => { pendingQuestions.delete(id); resolve('（用户未在120秒内回答）'); }, 120000);
        pendingQuestions.set(id, { resolve, timer });
        if (ctx.emit) ctx.emit({ type: 'question', id, text });
        else resolve('（问题推送失败）');
      });
      return `用户回答：${answer}`;
    }
    case 'task': {
      // 对标opencode task：派发子任务给独立子Agent执行
      const description = String(args.description || '');
      if (!description) return '请提供子任务描述';
      try {
        const subResult = await ctx.callAI([
          { role: 'system', content: '你是TrpgRecode的子任务Agent。独立完成描述的任务并返回结果，简洁直接，不要多余寒暄。' },
          { role: 'user', content: description }
        ], { reasoningEffort: appConfig.ai.reasoningEffort || 'high', maxTokens: 2000, timeoutMs: 90000, signal: ctx.signal });
        return '子任务结果：\n' + String(subResult.content || '');
      } catch (e) {
        return '子任务失败: ' + String(e.message || '').substring(0, 300);
      }
    }
    case 'read_file': {
      const rel = String(args.rel || '').replace(/\\/g, '/').replace(/^source\//, '');
      const file = ctx.indexFiles.find(f => f.rel === rel);
      // 不设固定默认截断（2026-08-05）：maxChars/offset 由AI自行判断；maxChars 不传=完整返回
      const maxChars = parseInt(args.maxChars) || 0;
      const offset = Math.max(0, parseInt(args.offset) || 0);
      if (!file) {
        // 回退：直接读系统目录内的产物文件（compressed/*.md|json、_tools/*.py 等非HTML）
        const directPath = path.join(ctx.systemDir, rel);
        if (path.resolve(directPath).startsWith(path.resolve(ctx.systemDir)) && fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
          const raw = readTextFileSmart(directPath);
          const part = maxChars > 0 ? raw.substring(offset, offset + maxChars) : raw.substring(offset);
          const more = maxChars > 0 && offset + maxChars < raw.length;
          return `FILE: ${rel}\nTEXT:\n${part.replace(/\s{3,}/g, ' ')}${more ? `\n……（继续读取请用 offset=${offset + maxChars}）` : ''}`;
        }
        return `文件不存在：${rel}。可用list_files或glob查找。`;
      }
      const text = htmlToMarkdownDocument(readTextFileSmart(path.join(extractDir, rel)), file.title)
        .replace(/\s{3,}/g, ' ');
      const part = maxChars > 0 ? text.slice(offset, offset + maxChars) : text.slice(offset);
      const more = maxChars > 0 && offset + maxChars < text.length;
      return `FILE: ${rel}\nTITLE: ${file.title}\nTEXT:\n${part}${more ? `\n……（已显示 ${offset}-${offset + maxChars}，继续读取请用 offset=${offset + maxChars}）` : ''}`;
    }
    case 'exclude_file': {
      const rel = String(args.rel || '').replace(/\\/g, '/').replace(/^source\//, '');
      if (!ctx.indexFiles.some(f => f.rel === rel)) return `文件不存在：${rel}`;
      if (ctx.excluded.includes(rel)) return `已排除过：${rel}`;
      ctx.excluded.push(rel);
      saveRuleIndex(ctx);
      return `已排除 ${rel}（原因：${args.reason || '非正文页'}）`;
    }
    case 'write_settings': {
      const settings = args.settings && typeof args.settings === 'object' ? args.settings : {};
      const compressedDir = path.join(ctx.systemDir, 'compressed');
      fs.mkdirSync(compressedDir, { recursive: true });
      const merged = Object.assign({
        system: safeSystem,
        audience: '上传规则书后启动AI解析，会自动根据AI分析生成配置选项。',
        fileCount: ctx.indexFiles.length - ctx.excluded.length,
        originalFiles: [ctx.originalName]
      }, settings, { system: safeSystem, fileCount: ctx.indexFiles.length - ctx.excluded.length, originalFiles: [ctx.originalName] });
      fs.writeFileSync(path.join(compressedDir, 'rule_settings.json'), JSON.stringify(merged, null, 2), 'utf8');
      return `已写入 compressed/rule_settings.json（检索源${merged.fileCount}个）`;
    }
    case 'compress_to_table': {
      // 支持单页rel或批量rels（一次压缩多页，减少AI往返）
      const relList = Array.isArray(args.rels) && args.rels.length
        ? args.rels.map(r => String(r).replace(/\\/g, '/').replace(/^source\//, ''))
        : [String(args.rel || '').replace(/\\/g, '/').replace(/^source\//, '')];
      const results = [];
      for (const rel of relList) {
        const file = ctx.indexFiles.find(f => f.rel === rel);
        if (!file) { results.push(`文件不存在：${rel}`); continue; }
        if (ctx.compressedTables.has(rel)) { results.push(`已压缩过：${rel}`); continue; }
        const text = htmlToMarkdownDocument(readTextFileSmart(path.join(extractDir, rel)), file.title)
          .replace(/\s{3,}/g, ' ')
          .slice(0, 4000);
        if (!text.trim()) { results.push(`页面无有效正文：${rel}`); continue; }
        const prompt = buildCompressPromptServer([{ category: safeSystem, title: file.title, summary: text }], safeSystem);
        let table = '';
        const compressAttempt = async (effort) => {
          const compressResult = await ctx.callAI([
            { role: 'system', content: '你是规则书压缩专家。将TRPG规则精确压缩为标准化查表格式。只输出表格。' },
            { role: 'user', content: prompt }
          ], { maxTokens: 3000, timeoutMs: 60000, reasoningEffort: effort, signal: ctx.signal });
          return String(compressResult.content || '').trim();
        };
        try {
          table = await compressAttempt('low');
          if (!table) table = await compressAttempt('none');
        } catch (e) {
          results.push(`压缩调用失败（${rel}）：${e.message}`);
          continue;
        }
        if (!table) { results.push(`压缩失败（${rel}）：AI返回空内容`); continue; }
        const tablesPath = path.join(ctx.systemDir, 'compressed', 'rule_tables.md');
        fs.mkdirSync(path.dirname(tablesPath), { recursive: true });
        fs.appendFileSync(tablesPath, `\n\n## ${file.title}（源：${rel}）\n\n${table}\n`, 'utf8');
        ctx.compressedTables.add(rel);
        results.push(`已生成表格（${rel}，${table.length}字符）`);
      }
      return `批量压缩结果（${relList.length}页）：\n${results.join('\n')}`;
    }
    case 'rename_system': {
      const targetName = normalizeCanonicalSystemName(args.targetName, safeSystem);
      if (targetName === safeSystem) return `系统名保持为「${safeSystem}」`;
      const renameResult = renameRuleSystemDir(safeSystem, targetName);
      if (renameResult.renamed) {
        ctx.safeSystem = renameResult.system;
        ctx.systemDir = path.join(RULER_DIR, ctx.safeSystem);
        appendRulebookTaskLog(ctx.safeSystem, 'system_renamed', 'AI通过工具改名', { from: renameResult.from, to: renameResult.to, reason: args.reason || '' });
        return `规则系统名已从「${renameResult.from}」更新为「${renameResult.to}」`;
      }
      return renameResult.skipped ? `改名已跳过：目标「${targetName}」已存在` : `改名未执行（${targetName}无效或未变化）`;
    }
    default:
      return `未知工具：${tool}`;
  }
}

// 原生function calling工具定义（opencode模式）
const agentToolDefinitions = [
  // ── opencode通用工具（完全对标，直接照搬） ──
  { type: 'function', function: { name: 'glob', description: '按glob模式找文件（**/*.html、**/法术*），索引无匹配时自动搜文件系统', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'glob模式' }, limit: { type: 'number', description: '最大返回数，默认50' } } } } },
  { type: 'function', function: { name: 'grep', description: '按正则搜文件内容返回匹配行', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '正则' }, path: { type: 'string', description: '限定路径子串' }, include: { type: 'string', description: '限定文件glob' }, limit: { type: 'number', description: '最大匹配数，默认20' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'list_files', description: '列一层目录', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，空=根' } } } } },
  { type: 'function', function: { name: 'list_tree', description: '递归目录树（[D]目录 [F]文件），建结构概览用', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，空=根' } }, depth: { type: 'number', description: '深度，默认2最大4' }, limit: { type: 'number', description: '条目上限，默认150最大300' } } } },
  { type: 'function', function: { name: 'read_file', description: '读取文件（HTML自动转文本；也支持compressed等非HTML产物），rel可带或不带source/；支持滚动阅读：offset起始位置，返回末尾提示继续的offset', parameters: { type: 'object', properties: { rel: { type: 'string', description: '相对路径' }, maxChars: { type: 'number', description: '最大字符数，默认1500' }, offset: { type: 'number', description: '起始字符位置，默认0' } }, required: ['rel'] } } },
  { type: 'function', function: { name: 'write_file', description: '写文件（插件/笔记/数据/脚本），允许写入Ruler/_shared_tools/', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'bash', description: '执行命令（Windows cmd：无ls/rm/cat/curl；python先write_file写脚本再执行，禁止python -c），超时30秒', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'todowrite', description: '维护任务清单', parameters: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string' } } } } }, required: ['todos'] } } },
  { type: 'function', function: { name: 'get_status', description: '查看解析状态（总页/已排除/已压缩/设置），勿写脚本读文件', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'skill', description: '加载技能文档：plugin-authoring（插件规范）', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'webfetch', description: '抓取网页内容', parameters: { type: 'object', properties: { url: { type: 'string' }, maxChars: { type: 'number' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'websearch', description: '联网搜索', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'edit', description: '替换文件中文本', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'question', description: '向用户提问等回答', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'task', description: '派发子任务给子Agent', parameters: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] } } },
  // ── 规则书领域专用工具（opencode无法代替的才保留） ──
  { type: 'function', function: { name: 'exclude_file', description: '从检索索引排除非正文页（不删文件）', parameters: { type: 'object', properties: { rel: { type: 'string' }, reason: { type: 'string' } }, required: ['rel'] } } },
  { type: 'function', function: { name: 'rename_system', description: '修改规则系统目录名', parameters: { type: 'object', properties: { targetName: { type: 'string' }, reason: { type: 'string' } }, required: ['targetName'] } } },
  { type: 'function', function: { name: 'write_settings', description: '写入规则设置rule_settings.json（topLevelSources分组、actions）', parameters: { type: 'object', properties: { settings: { type: 'object' } }, required: ['settings'] } } },
  { type: 'function', function: { name: 'compress_to_table', description: '把核心数据页压缩为查表表格追加到compressed/rule_tables.md；rels可一次传多页', parameters: { type: 'object', properties: { rel: { type: 'string', description: '单页相对路径' }, rels: { type: 'array', items: { type: 'string' }, description: '批量页相对路径（与rel二选一）' } } } } }
];

// 插件编写规范（skill文档，对标opencode skill机制）
const PLUGIN_AUTHORING_SKILL = `# 插件编写规范（Plugin Authoring Skill）

插件是AI为规则书动态编写的追加功能模块，前端加载该规则书时热加载生效，无需重启。

## 设计审核（一切修改前必做，2026-08-04 确立）
任何修改（含低级 bug 修复）必须先过两层审核，通过后才能事实检查与动手：
- **第一层 设计目的审核（游戏策划视角）**：这个行为在游戏中的设计目的是什么？谁在执行（玩家/GM/AI/系统）？意图是什么（命中/结算/成长/速查/扮演）？期望的游戏结果是什么？当前问题与设计目的的偏差在哪？禁止直接跳"程序上怎么修"，必须先回答"游戏上应该是什么样"。只从程序层找修复点而忽略游戏意图的修改视为违规。
- **第二层 游戏合理性与用户体验审核（玩家视角）**：玩家看到什么？是否符合直觉？是否直观方便操作？在带团流程（创建→升级→战斗→速查）中是否自然可达？是否符合该规则书规则原文？
两层通过后才能继续。本工具定位：动态解析任意TRPG规则书→自动生成配套角色卡与工具→AI作为GM带团；功能必须从当前规则书解析产物（compressed/）驱动，禁止套用其他规则结构。

## 最高验收标准（强制，唯一验收标准）
- **唯一验收标准 = 最佳玩家用户体验**：真实玩家能否按规则书走完真实流程（属性生成→角色构成→装备→掷骰→升级→速查→战斗），并顺畅完成每一步。程序"写完/能跑/控件齐全"永远不算完成。
- **禁止把任务想简单**：任何功能都按完整真实体验实现，禁止只做表面控件（只渲染输入框、只列标题、点击无反应、查不到已知条目、没有自动计算、没有规则数据支撑）。
- **不把任务理解清楚、规划清楚，不能开工**：任务开始必须先做三件事——(1) 读全相关文件（插件、宿主、规则数据 compressed/、相关接口定义）把现状与差距搞清楚；(2) 用 todowrite 写出完整实施规划（要做哪些功能、改哪些文件、如何验证）；(3) 按规划逐个实施并实际验证（正例+空例）。未完成规划直接动手修改视为违规。
- **验证必须真实发生**：每个功能完成后，用真实数据（规则书实际条目）验证正例命中、空例为空、点击可展开、计算正确，并把验证结果写入最终总结。声称"已实现"但没有验证证据的视为未完成。

## 带团数据化与标记渲染标准（本平台核心，2026-08-05 从SillyTavern大型DND世界书提炼通用化）
平台追求：TRPG的自由 + 电脑游戏的精准。带团时GM AI以结构化标记输出判定与状态，系统渲染成精美界面；角色血量等一切游戏数据以变量精确管理、前端实时联动。插件是这套机制的落地载体：
- **数据管理**：涉及角色/世界数据的插件（角色卡、战斗、状态）必须支持精确数据读写——定义该规则书的数据模型（角色：属性/生命值/护甲/先攻/状态/资源/物品/施法/熟练等），提供查看与修改入口，派生值（熟练加值/AC/DC/负重等）按规则书公式自动计算并实时联动，禁止只给"建议值"。数据变更可落盘（localStorage/后端）。
- **标记渲染分离**：判定/状态类输出遵循"AI写标记、前端渲染"——检定 <dice>（6行：发动技能/目标/情境/检定细节/判定结果/结果描述）、战斗 <battlecheck>（7行：发动者/目标/行动/检定类型/检定细节/判定结果/战果描述）、角色档案 <char_info>、数据更新 <UpdateVariable>+JSONPatch。插件可提供这些标记的渲染函数（把AI输出的标记转成精美HTML卡片），禁止要求AI写完整HTML。
- **判定铁律（渲染与校验都要体现）**：大成功仅当裸骰=极值上限（如20）、大失败仅当裸骰=极值下限（如1）；加值严格按规则；优势取高劣势取低。插件渲染判定结果时应突出显示裸骰与最终值的计算过程。
- **NPC角色生成**：重要角色登场即时生成档案（思考四维：生态位/驱动力/锚点/数值 + YAML档案），数值严格按规则书，禁止开场批量堆砌。
- **完整流程支撑**：插件必须支撑该规则书的完整玩家流程——属性生成（全部标准模式：购点/骰点/标准数组/手动）、升级流程（成长骰/派生值联动/能力选择）、战斗结算（先攻/命中/伤害/状态/濒死）。参考：SillyTavern DND世界书的开局分步流程、战斗面板、变量自动更新机制。
- 涉及带团体验设计时先用 skill {"name":"gm-protocol"} 加载完整GM带团协议（判定标记/变量数据管理/开局流程/NPC生成/战斗平衡/美化规范）。

## 电子游戏级体验标准（2026-08-05 确立，最高规格；半电子游戏定位）
> 本平台不是演示工具，而是**基于TRPG原本规则的半电子游戏**：功能齐全、体验完好、自动注意并思考各种细节。标杆参考：SillyTavern 大型 DND 世界书角色卡（Ruler/_shared_tools/reference/DND2024角色卡标杆/，可只读参考）。
- 每个规则系统=完整可玩的电子游戏模块：玩家按规则书走完整流程（创建→升级→战斗→速查→休息）每一步顺畅、数据精准、界面精美。
- 角色卡等大型模块必含（参数来自规则书）：①多角色管理（持久化+恢复+切换+删除+头像）②分页/标签导航 ③查看/编辑双模式 ④数据化字段（物品/法术结构化）⑤派生值自动计算链 ⑥效果系统（effectTags/effects，@pb/@strmod表达式）⑦玩家驱动掷骰（可点击掷骰+日志高亮）⑧休息与资源（短休/长休/法术位格点）⑨状态管理（HP/状态/死亡豁免/灵感）⑩AI接口（当前状态摘要供带团AI读取）。
- 视觉强制标准（解决"看不清"）：主题与宿主一致（深色高对比，背景#1a1a2e系/文字#e0e0f0系），禁止浅色卡片嵌深色页面割裂；文字对比度≥4.5:1，禁止#999/#aaa浅灰小字做正文；语义色彩（红=危险/绿=成功/金=资源/蓝=信息）；标题衬线奇幻字体+正文现代无衬线；悬停反馈/tooltip/保存通知/展开收起动画。
- 验收唯一标准：真实玩家走完真实流程每一步顺畅；"看不清/点不动/改不了/算不对/数据不落盘"五类缺陷为零。

## 界面定律（必须遵守）
- 规则书相关功能必须放在**规则书详情面板**内：详情区先显示一个**入口按钮**（标题+一句话说明），点击按钮后展开/切换功能面板。
- 禁止常驻堆叠大块面板；禁止使用独立弹窗。
- render 中：先渲染按钮行，点击后再渲染面板主体（可再次点击收起）。
- 规则书详情页是**一个容器**：插件入口应填充/替换这个容器里的通用占位说明，而不是追加第二个独立模块把“上传规则书后启动解析流程……”等旧说明顶到下面。存在规则书专用插件入口时，通用占位说明必须隐藏或降级为可选元数据。
- 插件内部可以有自己的展开区域，但不要让宿主详情页和插件区形成两个各自滚动的大模块。
- 规则书详情插件必须占满详情区可用宽度。宿主样式中的 #plugin-panels、.plugin-panel、.plugin-panel-headless 不得把主要规则工具做成半宽自动 flex 卡片；不得给宿主插件容器设置 max-height 或独立 overflow-y，避免出现详情页一半空白、两个滚动区互相嵌套。

## 查询/速查质量（必须验证）
- 搜索插件必须查询完整规则资料：优先调用带 q 参数的后端检索（例如 /api/rules/index?system=<system>&q=<keyword>&limit=<n>）或读取压缩表数据；禁止只取默认前150条索引再本地过滤。
- 搜索输入必须支持常见译名/别名/英文名，例如 圣武士 / 帕拉丁 / Paladin。
- 查询结果必须可操作：不能只输出标题和路径。每个结果应可点击/可键盘触发，点击后用 /api/rules/source?system=<system>&file=<sourceFile>&offset=0&length=<n> 或等效接口展开原文摘要/正文预览，再次点击可收起。
- 职业/升级类插件必须覆盖职业核心页与相关职业表：对 圣武士 / 帕拉丁 / Paladin 等别名，除名称外还要搜索精确标题/路径关键词（例如 角色职业/圣武士、圣武士.htm、圣武士法术列表）。只返回少数偶然命中的法术条目视为失败。
- 结果排序只是最佳努力的体验优化，不是完成阻塞项，除非用户明确要求固定排序。只要查询覆盖足够、结果可点击、源文可读、正例/空例验证通过，就不要为了某个条目第几名反复迭代；优先修覆盖、可读性、交互和标准沉淀。
- 完成前必须实际验证：至少一个应命中的正例（例如圣武士或帕拉丁）和一个应为空的反例，并在总结中报告结果。只渲染输入框但查不到已知条目的插件是不完整插件。
- 这些规范是后续所有目标AI插件生成/修复任务的标准；发现同类缺陷时，先补标准和系统频道提示词，再让目标AI按标准自迭代修复。

## 规则树整理归纳规范（Rule Tree）
- 规则内容必须整理为树状结构供速查导航（目录式、可折叠），写入 Ruler/<系统>/compressed/rule_tree.json：{ system, tree: [ { name, source?, children: [...] } ] }，叶子节点带 source 路径。
- 树按规则书实际结构构建：书→章节→小节→页面，语义归类合并（职业→子职业→页面；法术→环位→条目；怪物→类型→条目）。总节点≤600（核心书完整、扩展书到章节/代表条目级）。
- 解析阶段必做；已解析系统通过系统频道对话补完（不重跑解析、不移动 source/）。
- 速查/导航插件必须用 rule_tree.json 渲染树状导航（可折叠、点击叶子节点用 api.openRuleFile 新窗口打开 source），搜索作为补充；禁止零散平铺输出。

## 选项内容自动化标准（Option-list Automation）
- 角色卡/工具中的选项类内容（法术/装备/专长/能力等）必须自动来自规则书数据，禁止只有手动空输入框：优先读取 compressed/ 预整理数据（示例 DND：rule_spell_lists.json 职业→环位→法术名），缺失时从源文/索引运行时解析。
- 表格化结构化展示：选项按规则自然分组（示例 DND：法术按环位分组表格，可勾选加入已选项）；自动列表可勾选/添加，同时保留手动输入/自定义条目入口（自动与手动并存）。
- 组织参考 SillyTavern 大型 DND 世界书（按环位/类别分组、名称识别），用规则数据列表实现（比纯正则可靠）。
- 通用原则：任何规则的"可选内容"都按此自动化，不只法术。

## 角色卡游戏体验完整标准（Game-experience，通用）
> 通用 TRPG 平台原则：AI 自动解析任意规则书并制作工具。标准只定义"必须从规则书提取并完整实现"，禁止把任何具体规则（DND 购点/生命骰/职业等）写死为标准；具体参数一律来自该规则书解析产物（compressed/rule_settings.json、rule_tree.json、压缩表、源文）。
- 完成标准 = 完整玩家游戏体验，而非执行完毕任务：验收 = 真实玩家能否按该规则书走完真实流程（属性生成→角色构成→装备→掷骰→升级）；任何环节只做表面控件即未完成。
- 规则书驱动：字段/选项列表/公式/流程都从该规则书解析产物提取；不得套用其他规则结构。
- 属性生成默认全做：提供该规则书定义的全部标准生成模式（示例 DND：购点/骰点/标准数组/手动），缺任一=未完成；骰点自动出结果不展示过程、可重复掷；手动保留。
- 内容范围 = 官方内容：选项列表覆盖核心+官方扩展（示例 DND 含奇械师）；默认不收录第三方但留手动/自定义入口；范围由该规则书实际决定。
- 掷骰由玩家驱动：规则中由玩家掷骰的值（示例 DND HP/属性）提供掷骰按钮可重复掷、可手动输入；禁止默认填最大/均值。
- 编辑模式不做完整创建流程：简单回填即可。
- 角色升级流程（Level-up）：按该规则书升级规则提供完整流程（玩家驱动：成长骰、等级派生值自动更新、能力/专长选择提示、法术类更新），数据落盘；规则书定义了升级就必做，缺失=未完成。
- 自动计算链完整：按规则书公式推导并实时联动（示例 DND：AC 护甲公式/先攻=敏修/DC=8+熟练+施法属性修正）；禁止只给建议值。
- 玩家视角验收：模拟真实玩家完整创建+升级一次并核对派生值。
- 全方面技术核查：滚动/自适应属类别问题，交付前检查所有独立窗口页面可滚动、缩放正常。

## 角色卡与开卡流程分离（2026-08-05 确立，通用）
> 创建角色必须先选模式：**开卡流程** 或 **已有角色卡（编辑）**。开卡是一次性引导，完成后进入常驻角色卡；开卡控件不常驻在角色卡页面。
- 模式二选一：进入创建先呈现"开卡流程 / 编辑已有角色"入口。开卡=分步引导（属性生成→构成→装备→技能/豁免/专长→法术→完成）；编辑=简单回填已有 data。
- 开卡流程是独立阶段：骰点/购点/起始装备选择只在开卡中出现；角色卡页面展示开卡结果（最终属性、装备清单、技能/豁免/专长列表），不再重复摆放生成控件。
- 自动更新链：熟练/豁免/起始装备/专长/技能数量/额外加值随创建与升级自动匹配更新（按规则书公式计算派生值，不手动维护）。
- 角色卡多页布局：按功能分页（示例：背景/信息、属性、道具、法术），玩家可在页间切换速查。
- 选择精简化：法术选择先给"可选环位+可用数量"，玩家选环位后以列表选择法术，法术效果动态小窗展示；V/S/M 等标签显示实际意义、标签化排列、悬浮小窗显示定义与效果。
- 规划层级：整体结构先规划（模式选择→开卡→多页角色卡→各页组件），保证有效且美观。

## 大型功能独立窗口标准（Large-feature Window）
- 大型功能或明显需要空间的功能（规则树导航、角色卡创建/查看、源文阅读、长表单、批量工具）必须实现为独立窗口页面：app/ 下独立 html + window.open（宿主 WebView2 接管为原生窗口），禁止塞进主窗口小容器、弹层或内嵌滚动区。
- 判定（满足其一）：需超过半屏空间；长内容阅读；专注表单填写；与主界面并列使用；批量操作。
- 独立页约定：URL 参数化（?system=&id=&file=）；同源 localStorage + storage 事件与主窗口通信；需要插件能力时页面内加载插件代码（轻量 PluginAPI）；通用机制（词条悬停/打开式速查）照常使用。
- 主窗口只保留入口按钮与紧凑列表。

## 打开式速查规范（Quick-open Reference）
- 查询/速查结果必须能在**新窗口打开对应源文件**（HTML或Markdown原文），而不是把长原文内嵌进详情容器。
- 结果行显示源文件路径；点击行在新窗口/新标签打开：原HTML用 /Ruler/<系统>/source/<文件>，或经 /api/rules/source?system=<系统>&file=<文件> 的可读文本视图。
- 内嵌展开只允许短摘要（几行）；完整文档一律新窗口打开。详情容器保持紧凑结果列表。

## 独立窗口展示标准（Independent Window）
- 查看型内容（角色卡详情、速查/词条原文）必须显示在**操作系统级独立窗口**：统一 window.open(url,'_blank')，宿主 WebView2 将其接管为原生窗口（带边框、可拖动、与主窗口分离），禁止网页内弹层或内嵌长滚动区。
- 主窗口只保留紧凑入口与结果列表；完整文档/角色卡长内容禁止内嵌进主窗口滚动容器。
- 速查条目点击 → api.openRuleFile(file)；角色卡详情由宿主 /sheet.html 独立页通用渲染（data 字段按标准命名：name/race/class/background/level/hitDice/HP:{current,max}/AC/proficiency/attackBonus/abilityScores/abilityMods/skills/spells/equipment）。

## 速查统一列表化规范（Unified Result List）
- 查询结果必须是统一结构列表，禁止零碎输出：每行 = 名称 | 分类/来源路径 | 短摘要，全宽行样式，点击整行新窗口打开源文件（api.openRuleFile）。
- 列表头显示命中数；空结果给统一提示（含别名建议）。所有速查/搜索插件输出一致格式。

## 词条悬停预览规范（Term Hover Preview）
- 词条类内容（法术/物品/专长/状态等）必须支持鼠标悬停显示效果摘要。
- 渲染词条时挂 hover 悬浮层（绝对定位，不改变布局），数据来自规则压缩表或 /api/rules/index 查询；可复用宿主 .term-tip 样式或插件自带悬浮层。

## 规则专属角色卡编辑器规范（Character Builder）
- 每个规则系统应提供**该规则专属的角色卡创建界面**：AI 理解规则书后设计字段、校验与自动计算（参考 SillyTavern D&D 2024 卡：可视化、规划化、自动编辑）。
- 实现为插件 Ruler/<系统>/plugins/character-builder/，manifest.json 的 type 用 character-sheet。
- 要求：字段来自规则书实际章节（属性/种族/职业/背景/技能/装备/法术/特性等）；派生值自动计算（属性修正/AC/熟练加值/HP/DC/攻击加值等）；输入校验；支持多角色保存/加载；用真实规则数值创建样例角色验证。

## 扩展整理归纳规范（Rulebook Consolidation）
- 解析阶段（以及已解析系统的后续小规模迭代）必须识别**扩展/更新内容**（扩展书、补丁、新增职业/子职业、旧版章节、新增法术/物品/专长等）并归类归纳。
- DND类按 职业-子职业 / 扩展职业 / 旧版 / 法术 / 物品 / 专长 等归类；其他规则按该书实际结构决定分类名，禁止硬编码固定分类。
- 产物：Ruler/<系统>/compressed/rule_categories.json（分类→条目及source路径）+ 追加归纳表到 compressed/rule_tables.md；source/ 原文件绝不移动或改写。
- 已解析系统禁止重新解析，只做小规模迭代：读索引/概览→识别扩展内容→写入归纳→抽查正例/空例验证；每个分类必须至少抽查1条 source 路径在 rule_index.json/source 中真实存在，不存在的必须修正后再交付。

## 目录结构
Ruler/<系统>/plugins/<插件id>/
  manifest.json   { id, name, version, description, type }
  index.js        入口代码

## 编写步骤
1. 用write_file写入 manifest.json（id用英文/数字/短横线）
2. 用write_file写入 index.js

## index.js 代码规范
module.exports = {
  register(api) {
    api.addPanel({
      title: '面板标题',
      render(body, api) {
        body.innerHTML = '<button id="btn">动作</button>';
        body.querySelector('#btn').onclick = function() { ... };
      }
    });
  }
};

## PluginAPI 可用能力
- api.addPanel({title, render(body, api)}) 添加功能面板到规则书页
- api.fetch(url, opts) 访问后端接口（自动拼接服务器地址，如 api.fetch('/api/rules/index?system=' + encodeURIComponent(api.system))）
- api.log(...args) 输出日志
- api.onLoad / api.onUnload 生命周期回调
- api.system 当前规则系统名
- api.manifest 插件元信息

## 示例：法术查询面板
module.exports = {
  register(api) {
    api.addPanel({ title: '法术查询', render(body, api) {
      body.innerHTML = '<input id="spell-q" placeholder="输入法术名" style="width:60%;"><button id="spell-btn">查询</button><div id="spell-out"></div>';
      body.querySelector('#spell-btn').onclick = function() {
        var q = body.querySelector('#spell-q').value;
        body.querySelector('#spell-out').textContent = '正在查询：' + q;
      };
    } });
  }
};`;

// 保存规则索引（排除列表随工具调用更新）
function saveRuleIndex(ctx) {
  try {
    const indexPath = path.join(ctx.systemDir, 'compressed', 'rule_index.json');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({
      system: ctx.safeSystem,
      total: ctx.indexFiles.length,
      excluded: ctx.excluded,
      files: ctx.indexFiles,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

// 规范化规则源文件：解包HTML复制到source/保持相对路径（工具层自动，不耗AI token）
function normalizeRuleSource(extractDir, systemDir, files) {
  const sourceDir = path.join(systemDir, 'source');
  let copied = 0;
  for (const f of files) {
    const src = path.join(extractDir, f.rel);
    const dst = path.join(sourceDir, f.rel);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied++;
    } catch (e) { /* 单个文件复制失败跳过 */ }
  }
  return copied;
}

// 一级目录聚合统计（给AI的初始视图，避免一次性注入6817行）
function summarizeRuleDirs(files, limit = 80) {
  const dirMap = {};
  for (const f of files) {
    const idx = f.rel.indexOf('/');
    const dir = idx === -1 ? '（根目录）' : f.rel.substring(0, idx);
    if (!dirMap[dir]) dirMap[dir] = { count: 0, subs: new Set() };
    dirMap[dir].count++;
    if (idx !== -1) {
      const rest = f.rel.substring(idx + 1);
      const subIdx = rest.indexOf('/');
      if (subIdx !== -1) dirMap[dir].subs.add(rest.substring(0, subIdx));
    }
  }
  const dirs = Object.keys(dirMap).sort((a, b) => dirMap[b].count - dirMap[a].count).slice(0, limit);
  return dirs.map(d => `- ${d}/（${dirMap[d].count}个文件，${dirMap[d].subs.size}个子目录）`).join('\n');
}

function parseAiJson(text, fallback) {
  const str = String(text || '');
  const blocks = [];
  const re = /```(?:json)?\s*([\s\S]*?)```|({[\s\S]*})/g;
  let m;
  while ((m = re.exec(str))) blocks.push(m[1] || m[2]);
  if (!blocks.length && str.trim()) blocks.push(str.trim());
  let best = null;
  let bestScore = -1;
  for (const block of blocks) {
    try {
      const obj = JSON.parse(block.trim());
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const score = AI_PLAN_FIELDS.reduce((n, f) => n + (f in obj ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; best = obj; }
      }
    } catch (e) { /* 跳过坏块 */ }
  }
  return best || fallback;
}

// 占位/无效规则系统名黑名单：出现即拒绝改名，保留上传时目录名
const INVALID_SYSTEM_NAME_RE = /未命名|无名|未知|unknown|unnamed|rulebook|规则书|规则系统|占位|placeholder|待定|n\/a|na$/i;
function normalizeCanonicalSystemName(value, fallback) {
  const cleaned = cleanRuleName(String(value || '').trim());
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return fallback;
  if (INVALID_SYSTEM_NAME_RE.test(cleaned)) return fallback;
  return cleaned;
}

function renameRuleSystemDir(currentSystem, targetSystem) {
  const fromName = cleanRuleName(currentSystem);
  const toName = cleanRuleName(targetSystem);
  if (!toName || fromName === toName) return { system: fromName, renamed: false };
  const fromDir = path.join(RULER_DIR, fromName);
  const toDir = path.join(RULER_DIR, toName);
  if (!path.resolve(fromDir).startsWith(path.resolve(RULER_DIR))) throw new Error('规则系统源路径越界');
  if (!path.resolve(toDir).startsWith(path.resolve(RULER_DIR))) throw new Error('规则系统目标路径越界');
  if (!fs.existsSync(fromDir)) throw new Error('规则系统源目录不存在');
  if (fs.existsSync(toDir)) return { system: fromName, renamed: false, skipped: 'target_exists', target: toName };
  fs.renameSync(fromDir, toDir);
  return { system: toName, renamed: true, from: fromName, to: toName };
}

// 重新解析前清空旧拆解产物：只删 source/ 与 compressed/，保留 original/、assets/、tasks/（母本、图片、日志）
function cleanRuleSystemDirForReparse(system) {
  const safeSystem = cleanRuleName(system);
  const systemDir = path.join(RULER_DIR, safeSystem);
  if (!path.resolve(systemDir).startsWith(path.resolve(RULER_DIR))) throw new Error('规则系统路径越界');
  const cleared = [];
  for (const sub of ['source', 'compressed']) {
    const dir = path.join(systemDir, sub);
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); cleared.push(sub); }
  }
  return cleared;
}

// ── 规则书解析Agent主循环（对标opencode：skill + 指定文件 + AI自主执行） ──────

async function runRulebookIngestAgent(system, provider, options = {}) {
  let safeSystem = cleanRuleName(system);
  const initialSystem = safeSystem;
  let systemDir = path.join(RULER_DIR, safeSystem);
  const originalDir = path.join(systemDir, 'original');
  const originals = fs.existsSync(originalDir)
    ? fs.readdirSync(originalDir).filter(name => /\.chm$/i.test(name))
    : [];
  if (!originals.length) throw new Error('未找到CHM母本');
  const originalName = originals[0];
  const originalPath = path.join(originalDir, originalName);
  const extractDir = path.join(uploadDir, 'agent_chm_' + Date.now());
  fs.mkdirSync(extractDir, { recursive: true });

  const emit = options.onEvent || function() {};
  const ctx = {
    extractDir, systemDir, safeSystem, originalName, indexFiles: [], excluded: [],
    todos: [],
    signal: options.signal,
    emit,
    compressedTables: new Set(),
    callAI: (messages, opts) => callAI(provider.endpoint, provider.apiKey, provider.model, messages, opts)
  };

  appendRulebookTaskLog(safeSystem, 'agent_started', '规则书接管Agent启动', { originalPath: `Ruler/${safeSystem}/original/${originalName}` });
  try {
    // 1. 解包CHM（异步，不阻塞事件循环，保证进度实时可推送）
    emit({ type: 'phase', message: '解包CHM母本' });
    appendRulebookTaskLog(safeSystem, 'tool_decompile_chm', '工具解包CHM母本');
    await execFileAsync('hh.exe', ['-decompile', extractDir, originalPath], { timeout: 60000 });
    if (options.signal?.aborted) throw new Error('规则书接管Agent已中止');

    // 2. 规范化：HTML按原相对路径整理到source/ + 生成文件索引（工具层自动，不耗AI token）
    ctx.indexFiles = listExtractedRuleFiles(extractDir);
    emit({ type: 'phase', message: `规范整理HTML层级 ${ctx.indexFiles.length} 个` });
    appendRulebookTaskLog(safeSystem, 'tool_normalize', '工具规范化规则书文件层级', { htmlCount: ctx.indexFiles.length });
    const copied = normalizeRuleSource(extractDir, systemDir, ctx.indexFiles);
    // resume续接：先恢复会话进度（排除页不丢、已压缩页不重复追加），再写索引避免被空列表覆盖
    if (options.resume) {
      try {
        const idxPath = path.join(systemDir, 'compressed', 'rule_index.json');
        if (fs.existsSync(idxPath)) {
          const prev = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
          if (Array.isArray(prev.excluded)) ctx.excluded = prev.excluded.filter(rel => ctx.indexFiles.some(f => f.rel === rel));
        }
        const tablesPath = path.join(systemDir, 'compressed', 'rule_tables.md');
        if (fs.existsSync(tablesPath)) {
          const content = fs.readFileSync(tablesPath, 'utf8');
          const re = /（源：([^）]+)）/g;
          let m;
          while ((m = re.exec(content))) {
            const rel = m[1].replace(/\\/g, '/');
            if (ctx.indexFiles.some(f => f.rel === rel)) ctx.compressedTables.add(rel);
          }
        }
        if (ctx.excluded.length || ctx.compressedTables.size) {
          appendRulebookTaskLog(safeSystem, 'tool_resume_state', '续接恢复会话进度', { excluded: ctx.excluded.length, compressed: ctx.compressedTables.size });
          emit({ type: 'phase', message: `续接恢复：已排除${ctx.excluded.length}页、已压缩${ctx.compressedTables.size}表` });
        }
      } catch (e) { /* 恢复失败则从头开始 */ }
    }
    saveRuleIndex(ctx);
    emit({ type: 'phase', message: `source/ 规范层级 ${copied} 个HTML` });

    const assetManifestPath = path.join(systemDir, 'assets', 'rules', 'manifest.json');
    let assets = [];
    if (fs.existsSync(assetManifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(assetManifestPath, 'utf8'));
        assets = Array.isArray(manifest.images) ? manifest.images : [];
        appendRulebookTaskLog(safeSystem, 'tool_extract_images_skipped', '图片资产清单已存在，跳过重复拆解', { imageCount: assets.length });
      } catch (e) {
        assets = extractChmImageAssets(extractDir, safeSystem, originalName);
        appendRulebookTaskLog(safeSystem, 'tool_extract_images', '工具提取图片资产', { imageCount: assets.length });
      }
    } else {
      assets = extractChmImageAssets(extractDir, safeSystem, originalName);
      appendRulebookTaskLog(safeSystem, 'tool_extract_images', '工具提取图片资产', { imageCount: assets.length });
    }
    emit({ type: 'phase', message: `图片资产 ${assets.length} 个` });

    // 3. Agent循环（opencode模式）：原生function calling，模型不再调用工具（纯文本回复）即任务完成，无轮数上限
    const tokenStats = { prompt: 0, completion: 0, reasoning: 0, total: 0, rounds: 0, roundsDetail: [] };
    const tocCandidates = detectTocCandidates(ctx.indexFiles);
    const garbageCandidates = detectGarbageCandidates(ctx.indexFiles);
    // 一级目录概览（让AI一眼看到全书结构，无需逐页翻索引）
    const dirSummary = summarizeRuleDirs(ctx.indexFiles, 40);
    const messages = [
      { role: 'system', content: AGENT_TOOL_PROMPT },
      { role: 'user', content: `规则系统：${safeSystem}\nHTML共${ctx.indexFiles.length}个，图片${assets.length}个。\n\n一级目录概览（按文件数排序）：\n${dirSummary}\n\n疑似目录/索引页：\n${tocCandidates.join('\n') || '（未检测到，用glob/list_files查看）'}\n\n疑似垃圾页候选（文件名模式匹配，可直接exclude_file排除或忽略）：\n${garbageCandidates.join('\n') || '（无）'}\n\n共享工具库（Ruler/_shared_tools/，可直接复用，bash执行「python Ruler\\_shared_tools\\xxx.py」）：\n${listSharedTools() || '（空，可沉淀通用脚本到 Ruler/_shared_tools/ 供以后复用）'}\n\n请解析这本规则书：先看概览与目录页建立结构，抽样read_file确认，用exclude_file排除垃圾页，compress_to_table压缩核心数据表，write_settings写配置，需要追加功能时加载skill plugin-authoring后用write_file编写插件，最后纯文本总结完成。不要逐页翻看整个索引。
扩展整理归纳（解析阶段必做）：识别本规则书的扩展/更新类内容（扩展章节、新增职业/子职业/法术/物品/专长、旧版章节等），按实际结构归类（DND类如 职业-子职业/扩展职业/旧版/法术/物品/专长），写入 compressed/rule_categories.json（分类→条目及source路径），并追加归纳表到 compressed/rule_tables.md；source/ 原文件绝不移动或改写。` }
    ];
    let progressNote = '';
  let rounds = 0;
    let finalText = '';
    while (true) {
      if (options.signal?.aborted) throw new Error('规则书接管Agent已中止');
      rounds++;

      const analysis = await callAI(provider.endpoint, provider.apiKey, provider.model, messages, { tools: agentToolDefinitions, reasoningEffort: appConfig.ai.reasoningEffort || 'high', timeoutMs: 120000, signal: options.signal });
      const raw = String(analysis.content || '').trim();
      // 每轮token消耗记录（只写日志，不刷屏推送）
      const usage = analysis.usage || {};
      const uPrompt = usage.prompt_tokens || usage.input_tokens || 0;
      const uCompletion = usage.completion_tokens || usage.output_tokens || 0;
      const uTotal = usage.total_tokens || (uPrompt + uCompletion);
      const uReasoning = usage.reasoning_tokens || (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) || 0;
      tokenStats.prompt += uPrompt;
      tokenStats.completion += uCompletion;
      tokenStats.reasoning += uReasoning;
      tokenStats.total += uTotal;
      tokenStats.rounds++;
      tokenStats.roundsDetail.push({ round: rounds, prompt: uPrompt, completion: uCompletion, reasoning: uReasoning, total: uTotal });
      appendRulebookTaskLog(safeSystem, 'agent_tokens', `第${rounds}轮 token: 输入${uPrompt}/输出${uCompletion}/思考${uReasoning}/合计${uTotal}`, { input: uPrompt, output: uCompletion, reasoning: uReasoning, total: uTotal });
      // 审计：追加保存每轮AI原始输出
      try {
        const taskDir = path.join(systemDir, 'tasks');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.appendFileSync(path.join(taskDir, 'analysis-agent-rounds.txt'), `\n===== 第${rounds}轮（in ${uPrompt} / out ${uCompletion} / total ${uTotal}）=====\n${raw}\n`, 'utf8');
      } catch (e) { /* ignore */ }

      // AI思考摘要实时推送
      if (analysis.reasoningContent) {
        const summary = reasoningSummaryOf(analysis.reasoningContent);
        if (summary) emit({ type: 'reasoning', text: summary });
      }

      const toolCalls = analysis.toolCalls || [];
      if (!toolCalls.length) {
        // 纯文本回复 = 任务完成（opencode模式）
        finalText = raw || '';
        if (raw) emit({ type: 'ai_text', text: raw });
        break;
      }

      // 原生工具调用：assistant消息携带tool_calls，工具结果以role:'tool'回传
      const assistantMsg = {
        role: 'assistant',
        content: raw || '',
        tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } }))
      };
      if (analysis.reasoningContent) assistantMsg.reasoning_content = analysis.reasoningContent;
      messages.push(assistantMsg);

      for (const tc of toolCalls) {
        const tool = tc.name;
        let args = {};
        try { args = JSON.parse(tc.arguments || '{}') || {}; } catch (e) { args = {}; }
        emit({ type: 'tool', tool, args });
        appendRulebookTaskLog(safeSystem, 'agent_tool', `AI调用工具 ${tool}`, { args: summarizeArgs(tool, args), round: rounds });

        const result = await runAgentTool(tool, args, ctx);
        // 改名后路径变化：更新systemDir引用
        systemDir = ctx.systemDir;
        safeSystem = ctx.safeSystem;
        emit({ type: 'tool_result', tool, result: String(result) });
        // 工具结果完整入历史，不做外部截断（2026-08-05）：AI自行预估上下文长度与读取量
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
        // 进度摘要（轻量compaction用）
        if (tool === 'exclude_file') progressNote += `已排除${ctx.excluded.length}页；`;
        else if (tool === 'write_settings') progressNote += '已写设置；';
        else if (tool === 'compress_to_table') progressNote += '已压缩表格；';
        else if (tool === 'rename_system') progressNote += '已改名；';
      }

      // 轻量compaction（对标opencode compactIfNeeded）：历史超10条即压缩，保留最近4条
      // 注意：截断起点必须对齐到带tool_calls的assistant消息，否则tool结果消息会失去前置而报400
      if (messages.length > 10) {
        const head = messages.slice(0, 2);
        let cut = messages.length - 4;
        if (cut < 2) cut = 2;
        for (let i = cut; i >= 2; i--) {
          const m = messages[i];
          if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) { cut = i; break; }
        }
        const tail = messages.slice(cut);
        messages.length = 0;
        messages.push(head[0], head[1]);
        if (progressNote) messages.push({ role: 'system', content: `进度摘要：${progressNote}` });
        messages.push(...tail);
      }
    }
    appendRulebookTaskLog(safeSystem, 'agent_finished', 'Agent以自然语言结束（工具调用完毕）', { rounds, finalText: finalText.substring(0, 100) });

    // 4. 收尾：AI未写设置时自动补写；生成解析索引；写token消耗汇总
    const compressedDir = path.join(systemDir, 'compressed');
    fs.mkdirSync(compressedDir, { recursive: true });
    const finalCount = ctx.indexFiles.length - ctx.excluded.length;
    let settings = {};
    const settingsPath = path.join(compressedDir, 'rule_settings.json');
    if (fs.existsSync(settingsPath)) {
      try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath, 'utf8'))); } catch (e) { /* ignore */ }
    } else {
      settings = {
        system: safeSystem,
        audience: '上传规则书后启动AI解析，会自动根据AI分析生成配置选项。',
        fileCount: finalCount,
        originalFiles: [originalName],
        topLevelSources: [],
        actions: []
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    }
    // token消耗汇总（写入可读日志，便于调试调整）
    try {
      const taskDir = path.join(systemDir, 'tasks');
      fs.mkdirSync(taskDir, { recursive: true });
      const lines = [`=== 规则书解析 token 消耗汇总 ${new Date().toISOString()} ===`, ''];
      for (const d of tokenStats.roundsDetail) {
        lines.push(`第${d.round}轮  输入 ${d.prompt} | 输出 ${d.completion} | 思考 ${d.reasoning} | 合计 ${d.total}`);
      }
      lines.push('');
      lines.push(`总计  输入 ${tokenStats.prompt} | 输出 ${tokenStats.completion} | 思考 ${tokenStats.reasoning} | 合计 ${tokenStats.total}（${tokenStats.rounds}轮）`);
      fs.appendFileSync(path.join(taskDir, 'token-log.txt'), lines.join('\n') + '\n\n', 'utf8');
    } catch (e) { /* ignore */ }
    if (tokenStats.rounds > 0) {
      appendRulebookTaskLog(safeSystem, 'agent_tokens_total', `解析会话token总计: 输入${tokenStats.prompt}/输出${tokenStats.completion}/思考${tokenStats.reasoning}/合计${tokenStats.total}（${tokenStats.rounds}轮）`, { input: tokenStats.prompt, output: tokenStats.completion, reasoning: tokenStats.reasoning, total: tokenStats.total, rounds: tokenStats.rounds });
      emit({ type: 'tokens', round: 0, input: tokenStats.prompt, output: tokenStats.completion, reasoning: tokenStats.reasoning, total: tokenStats.total, summary: true });
    }
    const indexLines = [
      `# ${safeSystem} - AI解析索引`, '',
      `- 母本：Ruler/${safeSystem}/original/${originalName}`,
      `- HTML层级：${ctx.indexFiles.length} 个（已排除 ${ctx.excluded.length} 个非正文页）`,
      `- 图片资产：${assets.length}`,
      `- Agent轮数：${rounds}`,
      '', '## 已排除的非正文页', ''
    ];
    ctx.excluded.slice(0, 100).forEach(rel => indexLines.push(`- ${rel}`));
    if (ctx.excluded.length > 100) indexLines.push(`- …等共${ctx.excluded.length}个`);
    fs.writeFileSync(path.join(compressedDir, 'ai_gm_index.md'), indexLines.join('\n'), 'utf8');

    appendRulebookTaskLog(safeSystem, 'agent_done', '规则书接管Agent阶段完成', { settingsPath: `Ruler/${safeSystem}/compressed/rule_settings.json`, rounds, htmlCount: ctx.indexFiles.length, excluded: ctx.excluded.length });
    emit({ type: 'done', result: { system: safeSystem, htmlCount: ctx.indexFiles.length, sourceCount: finalCount, imageCount: assets.length, rounds, note: finalText } });
    return { success: true, system: safeSystem, previousSystem: initialSystem, renamed: initialSystem !== safeSystem, htmlCount: ctx.indexFiles.length, sourceCount: finalCount, imageCount: assets.length, rounds, note: finalText, settings };
  } finally {
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    // 清理AI临时脚本目录（_tools/），共享工具库_Ruler/_shared_tools/保留
    try { fs.rmSync(path.join(systemDir, '_tools'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

// 思考摘要（对标opencode reasoningSummary）
function reasoningSummaryOf(text) {
  const content = String(text || '').trim();
  if (!content) return '';
  const m = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
  if (m) return m[1].trim();
  return content.length > 80 ? content.substring(0, 80) + '…' : content;
}

// 工具参数摘要（日志用，避免把大参数写进日志）
function summarizeArgs(tool, args) {
  try {
    const copy = Object.assign({}, args);
    if (copy.content && String(copy.content).length > 120) copy.content = String(copy.content).substring(0, 120) + '…(' + String(copy.content).length + '字)';
    if (copy.settings && typeof copy.settings === 'object') copy.settings = 'object:' + Object.keys(copy.settings).join(',');
    return copy;
  } catch (e) { return args; }
}

function cleanRelativePath(value) {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean).map(cleanRuleName);
  return parts.length ? path.join(...parts) : 'index.md';
}

function saveRuleSourceDocuments(system, documents) {
  const safeSystem = cleanRuleName(system);
  const sourceDir = path.join(RULER_DIR, safeSystem, 'source');
  const compressedDir = path.join(RULER_DIR, safeSystem, 'compressed');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(compressedDir, { recursive: true });

  const saved = [];
  for (const doc of documents) {
    const relativeFile = cleanRelativePath(doc.fileName || 'index.md').replace(/\.[^.]+$/, '.md');
    const targetPath = path.join(sourceDir, relativeFile);
    if (!targetPath.startsWith(sourceDir)) throw new Error('规则书拆分路径越界');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, doc.content || '', 'utf8');
    saved.push({ system: safeSystem, fileName: `source/${relativeFile.replace(/\\/g, '/')}`, path: targetPath, title: doc.title || '' });
  }
  return saved;
}

function cleanAssetFileName(value) {
  return cleanRuleName(value).replace(/\s+/g, '_');
}

function getRuleAssetDir(system, sourceFileName, category = 'images') {
  const safeSystem = cleanRuleName(system);
  const sourceBase = cleanAssetFileName(path.basename(sourceFileName || 'source', path.extname(sourceFileName || '')));
  const dir = path.join(RULER_DIR, safeSystem, 'assets', 'rules', category);
  fs.mkdirSync(dir, { recursive: true });
  return { safeSystem, sourceBase, dir };
}

function makeRulerUrl(parts) {
  return '/Ruler/' + parts.map(p => encodeURIComponent(p)).join('/');
}

function saveRuleBinaryAsset(system, sourceFileName, category, fileName, buffer, meta = {}) {
  const asset = getRuleAssetDir(system, sourceFileName, category);
  const safeName = cleanAssetFileName(fileName);
  const fullPath = path.join(asset.dir, safeName);
  fs.writeFileSync(fullPath, buffer);
  return {
    fileName: safeName,
    path: fullPath,
    url: makeRulerUrl([asset.safeSystem, 'assets', 'rules', category, safeName]),
    ...meta
  };
}

function writeRuleAssetManifest(system, sourceFileName, assets, kind) {
  const asset = getRuleAssetDir(system, sourceFileName, 'images');
  const manifestPath = path.join(RULER_DIR, asset.safeSystem, 'assets', 'rules', 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    system: asset.safeSystem,
    sourceFileName,
    kind,
    imageCount: assets.length,
    images: assets,
    updatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  return manifestPath;
}

function writeRuleAiAssets(system, sourceFileName, savedDocuments, parsed) {
  const safeSystem = cleanRuleName(system);
  const compressedDir = path.join(RULER_DIR, safeSystem, 'compressed');
  fs.mkdirSync(compressedDir, { recursive: true });
  const files = savedDocuments
    .map(item => String(item.fileName || '').replace(/\\/g, '/'))
    .filter(Boolean)
    .map(fileName => fileName.startsWith('source/') ? fileName : `source/${fileName}`);
  const settings = loadRuleSystemSettings(path.join(RULER_DIR, safeSystem), safeSystem, files);
  const indexContent = [
    `# ${safeSystem} - AI GM检索索引`,
    '',
    `- 原始规则书：${sourceFileName}`,
    `- 用途：低token检索、选择规则组件、定位源文件。`,
    `- 源文件数量：${settings.fileCount}`,
    `- 图片资产：${parsed.imageCount || 0}`,
    '',
    '## AI应执行的规则设置',
    '',
    ...settings.actions.flatMap(action => [
      `### ${action.title}`,
      `- 动作ID：${action.type}`,
      `- 说明：${action.detail}`,
      action.examples && action.examples.length ? `- 示例来源：${action.examples.join('；')}` : '- 示例来源：无',
      ''
    ]),
    '## 顶层资料分组',
    '',
    ...settings.topLevelSources.map(name => `- ${name}`)
  ].join('\n');
  fs.writeFileSync(path.join(compressedDir, 'ai_gm_index.md'), indexContent, 'utf8');
  fs.writeFileSync(path.join(compressedDir, 'rule_settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([len, typeBuffer, data, crc]);
}

function encodePng(width, height, channels, raw) {
  const colorType = channels === 1 ? 0 : 2;
  const rowBytes = width * channels;
  if (raw.length < rowBytes * height) throw new Error('图片像素数据长度不足');
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (rowBytes + 1)] = 0;
    raw.copy(scanlines, y * (rowBytes + 1) + 1, y * rowBytes, y * rowBytes + rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function parsePdfNumber(dict, key) {
  const match = String(dict || '').match(new RegExp('\\/' + key + '\\s+(\\d+)', 'i'));
  return match ? Number(match[1]) : 0;
}

function extractPdfImageAssets(buffer, system, sourceFileName) {
  const text = buffer.toString('latin1');
  const assets = [];
  const objRe = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let match;
  let index = 0;

  while ((match = objRe.exec(text))) {
    const objText = match[0];
    if (!/\/Subtype\s*\/Image/i.test(objText)) continue;

    const streamIdx = objText.indexOf('stream');
    const endStreamIdx = objText.indexOf('endstream');
    if (streamIdx === -1 || endStreamIdx === -1 || endStreamIdx <= streamIdx) continue;

    let start = match.index + streamIdx + 'stream'.length;
    if (buffer[start] === 0x0D && buffer[start + 1] === 0x0A) start += 2;
    else if (buffer[start] === 0x0A || buffer[start] === 0x0D) start += 1;
    let end = match.index + endStreamIdx;
    while (end > start && (buffer[end - 1] === 0x0A || buffer[end - 1] === 0x0D)) end -= 1;
    const stream = buffer.slice(start, end);

    const dict = objText.slice(0, streamIdx);
    const width = parsePdfNumber(dict, 'Width');
    const height = parsePdfNumber(dict, 'Height');
    const bits = parsePdfNumber(dict, 'BitsPerComponent') || 8;
    const isGray = /\/ColorSpace\s*\/DeviceGray/i.test(dict);
    const isRgb = /\/ColorSpace\s*\/DeviceRGB/i.test(dict) || !/\/ColorSpace/i.test(dict);
    const baseName = `pdf-image-${String(++index).padStart(3, '0')}`;

    try {
      if (/\/DCTDecode/i.test(dict)) {
        assets.push(saveRuleBinaryAsset(system, sourceFileName, 'images', `${baseName}.jpg`, stream, { source: 'pdf', width, height, filter: 'DCTDecode' }));
      } else if (/\/JPXDecode/i.test(dict)) {
        assets.push(saveRuleBinaryAsset(system, sourceFileName, 'images', `${baseName}.jp2`, stream, { source: 'pdf', width, height, filter: 'JPXDecode' }));
      } else if (/\/FlateDecode/i.test(dict) && width && height && bits === 8 && (isGray || isRgb) && !/\/Predictor\s+(?!1\b)\d+/i.test(dict)) {
        const raw = zlib.inflateSync(stream);
        const channels = isGray ? 1 : 3;
        const png = encodePng(width, height, channels, raw);
        assets.push(saveRuleBinaryAsset(system, sourceFileName, 'images', `${baseName}.png`, png, { source: 'pdf', width, height, filter: 'FlateDecode' }));
      }
    } catch (e) {
      console.warn(`[规则书] PDF图片跳过 ${sourceFileName} obj ${match[1]}: ${e.message}`);
    }
  }

  writeRuleAssetManifest(system, sourceFileName, assets, 'pdf');
  return assets;
}

function extractChmImageAssets(extractDir, system, sourceFileName) {
  const imageFiles = [];
  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(fullPath);
      else if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(entry.name)) imageFiles.push(fullPath);
    }
  }
  scan(extractDir);

  const assets = [];
  for (const fullPath of imageFiles) {
    try {
      const relativeName = path.relative(extractDir, fullPath).split(path.sep).map(cleanAssetFileName).join('__');
      assets.push(saveRuleBinaryAsset(system, sourceFileName, 'images', relativeName, fs.readFileSync(fullPath), {
        source: 'chm',
        originalPath: path.relative(extractDir, fullPath)
      }));
    } catch (e) {
      console.warn(`[规则书] CHM图片跳过 ${fullPath}: ${e.message}`);
    }
  }

  writeRuleAssetManifest(system, sourceFileName, assets, 'chm');
  return assets;
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeTextBuffer(buffer) {
  if (!buffer || buffer.length === 0) return '';
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) return buffer.slice(2).toString('utf16le');
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return buffer.slice(3).toString('utf8');

  const utf8 = buffer.toString('utf8');
  const badUtf8 = (utf8.match(/�/g) || []).length;
  if (badUtf8 <= Math.max(2, utf8.length * 0.01)) return utf8;

  for (const enc of ['gb18030', 'gbk', 'big5']) {
    try {
      return new TextDecoder(enc).decode(buffer);
    } catch (e) { /* try next */ }
  }
  return utf8;
}

function readTextFileSmart(filePath) {
  return decodeTextBuffer(fs.readFileSync(filePath));
}

function htmlTitle(html, fallback) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtmlToText(match ? match[1] : '') || fallback || '';
}

function htmlToMarkdownDocument(html, title) {
  let text = stripHtmlToText(html);
  if (title && text && !text.startsWith(title)) text = `# ${title}\n\n${text}`;
  else if (title && !text) text = `# ${title}`;
  return text;
}

function sourceMdPathFromExtracted(extractDir, htmlFile, used) {
  const rel = path.relative(extractDir, htmlFile);
  const parsed = path.parse(rel);
  const dir = parsed.dir ? parsed.dir.split(/[\\/]+/).map(cleanRuleName).join('/') : '';
  let base = cleanRuleName(parsed.name || 'page');
  let candidate = (dir ? `${dir}/` : '') + `${base}.md`;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = (dir ? `${dir}/` : '') + `${base}-${index++}.md`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function decodeDataImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) throw new Error('图片数据格式无效');
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  return { ext, buffer: Buffer.from(match[2], 'base64') };
}

function saveCharacterImageAsset(system, characterName, fileName, dataUrl) {
  const safeSystem = cleanRuleName(system || 'Common');
  const safeCharacterName = cleanRuleName(characterName || '未命名角色');
  const image = decodeDataImage(dataUrl);
  const dir = path.join(RULER_DIR, safeSystem, 'assets', 'characters', safeCharacterName);
  fs.mkdirSync(dir, { recursive: true });
  const fullName = `${fileName}.${image.ext}`;
  const fullPath = path.join(dir, fullName);
  fs.writeFileSync(fullPath, image.buffer);
  return {
    path: fullPath,
    url: `/Ruler/${encodeURIComponent(safeSystem)}/assets/characters/${encodeURIComponent(safeCharacterName)}/${encodeURIComponent(fullName)}`
  };
}

async function parseUploadedRuleFile(file, system) {
  const originalName = fixUploadOriginalName(file.originalname || '未命名规则书');
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    let pdfParse;
    try {
      pdfParse = require('pdf-parse');
    } catch (e) {
      throw new Error('PDF解析库未安装，请在 server 目录运行: npm install');
    }

    const dataBuffer = fs.readFileSync(file.path);
    const data = await pdfParse(dataBuffer);
    const assets = extractPdfImageAssets(dataBuffer, system, originalName);
    const assetSummary = assets.length > 0
      ? `\n\n=== 拆分图片资产 ===\n${assets.map(a => `- ${a.fileName}: ${a.url}`).join('\n')}\n`
      : '';
    return {
      text: (data.text || '') + assetSummary,
      pages: data.numpages || 0,
      sections: data.numpages || 0,
      kind: 'pdf',
      assets,
      imageCount: assets.length
    };
  }

  if (ext === '.chm') {
    if (process.platform !== 'win32') throw new Error('CHM解析仅在Windows系统支持');

    const extractDir = path.join(uploadDir, 'chm_extract_' + Date.now());
    const chmPath = path.join(uploadDir, `chm_source_${Date.now()}.chm`);
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      fs.copyFileSync(file.path, chmPath);
      execFileSync('hh.exe', ['-decompile', extractDir, chmPath], {
        timeout: 30000,
        windowsHide: true
      });

      const htmlFiles = [];
      function scanDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (/\.(htm|html)$/i.test(entry.name)) {
            htmlFiles.push(fullPath);
          }
        }
      }
      scanDir(extractDir);
      const extractedFiles = [];
      function scanAll(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) scanAll(fullPath);
          else extractedFiles.push(fullPath);
        }
      }
      scanAll(extractDir);

      if (extractedFiles.length === 0) {
        throw new Error('CHM解包结果为空；可能是CHM文件不兼容、被系统阻止或hh.exe未能正确解包');
      }

      const assets = extractChmImageAssets(extractDir, system, originalName);
      const documents = [];
      const usedDocPaths = new Set();
      const toc = [];
      for (const htmlFile of htmlFiles.slice(0, 500)) {
        try {
          const relativeName = path.relative(extractDir, htmlFile);
          const html = readTextFileSmart(htmlFile);
          const title = htmlTitle(html, path.basename(relativeName, path.extname(relativeName)));
          const text = htmlToMarkdownDocument(html, title);
          if (text.trim()) {
            const docPath = sourceMdPathFromExtracted(extractDir, htmlFile, usedDocPaths);
            documents.push({ fileName: docPath, title, content: text });
            toc.push({ title, source: relativeName.replace(/\\/g, '/'), file: `source/${docPath}` });
          }
        } catch (e) { /* skip unreadable file */ }
      }

      if (documents.length === 0 && assets.length === 0) {
        throw new Error(`CHM已解包${extractedFiles.length}个文件，但未提取到HTML正文或图片`);
      }

      const assetSummary = assets.length > 0
        ? `\n\n=== 拆分图片资产 ===\n${assets.map(a => `- ${a.originalPath || a.fileName}: ${a.url}`).join('\n')}\n`
        : '';
      const indexContent = `# ${originalName}\n\n` +
        `- 类型：CHM\n- 解包文件：${extractedFiles.length}\n- 页面：${documents.length}\n- 图片：${assets.length}\n\n` +
        `## 目录\n\n${toc.map(item => `- [${item.title || item.file}](${item.file.replace(/^source\//, '')})`).join('\n')}\n` +
        assetSummary;
      documents.unshift({ fileName: 'index.md', title: originalName, content: indexContent });
      return {
        text: indexContent,
        documents,
        toc,
        chapters: htmlFiles.length,
        sections: documents.length,
        extractedFiles: extractedFiles.length,
        kind: 'chm',
        assets,
        imageCount: assets.length
      };
    } finally {
      removeTempFile(chmPath);
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  }

  if (ext === '.txt' || ext === '.md') {
    return {
      text: readTextFileSmart(file.path),
      sections: 1,
      kind: ext.slice(1),
      assets: [],
      imageCount: 0
    };
  }

  throw new Error('不支持的规则书格式，请上传 PDF、CHM、TXT 或 MD 文件');
}

app.post('/api/files/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });

  try {
    const originalName = fixUploadOriginalName(req.file.originalname);
    const system = cleanRuleName(req.body.system || originalName.replace(/\.[^.]+$/, ''));
    const ext = path.extname(originalName).toLowerCase();

    if (ext === '.chm') {
      const savedOriginal = saveRuleOriginalFile(system, originalName, req.file.path);
      const task = writeRulebookIngestTask(savedOriginal, 'chm');
      console.log(`[规则书] 已保存CHM母本 ${originalName} -> ${savedOriginal.path}`);
      return res.json({
        success: true,
        mode: 'ai_ingest_required',
        kind: 'chm',
        system: savedOriginal.system,
        originalFileName: savedOriginal.fileName,
        originalPath: savedOriginal.relativePath,
        promptPath: task.promptPath,
        aiPrompt: task.prompt,
        total_md: 0,
        imageCount: 0,
        extractedFiles: 0,
        files: []
      });
    }

    const parsed = await parseUploadedRuleFile(req.file, system);
    const savedDocuments = parsed.documents && parsed.documents.length
      ? saveRuleSourceDocuments(system, parsed.documents)
      : [saveRuleSourceFile(system, originalName, parsed.text)];
    const saved = savedDocuments[0];
    writeRuleAiAssets(saved.system, originalName, savedDocuments, parsed);

    if (parsed.toc && parsed.toc.length) {
      const tocPath = path.join(RULER_DIR, saved.system, 'source', 'toc.json');
      fs.writeFileSync(tocPath, JSON.stringify({ system: saved.system, sourceFileName: originalName, entries: parsed.toc, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    }

    console.log(`[规则书] 已拆解 ${originalName} -> ${saved.path} (${savedDocuments.length} 个MD)`);
    res.json({
      success: true,
      system: saved.system,
      fileName: saved.fileName,
      path: saved.path,
      total_md: savedDocuments.length,
      files: savedDocuments.map(item => ({ fileName: item.fileName, title: item.title || '', path: item.path })),
      pages: parsed.pages || 0,
      chapters: parsed.chapters || 0,
      sections: parsed.sections || 1,
      extractedFiles: parsed.extractedFiles || 0,
      kind: parsed.kind,
      imageCount: parsed.imageCount || 0,
      assets: parsed.assets || []
    });
  } catch (err) {
    console.error('[规则书] 拆解失败:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    removeTempFile(req.file.path);
  }
});

app.post('/api/assets/character-image', (req, res) => {
  const { system, characterName, images } = req.body || {};
  if (!images || !images.portrait || !images.avatar || !images.avatarFramed) {
    return res.status(400).json({ error: '缺少角色图片数据' });
  }

  try {
    const saved = {
      original: images.original ? saveCharacterImageAsset(system, characterName, 'original', images.original) : null,
      portrait: saveCharacterImageAsset(system, characterName, 'portrait-4x3', images.portrait),
      avatar: saveCharacterImageAsset(system, characterName, 'avatar-1x1', images.avatar),
      avatarFramed: saveCharacterImageAsset(system, characterName, 'avatar-1x1-framed', images.avatarFramed)
    };

    const manifestPath = path.join(RULER_DIR, cleanRuleName(system || 'Common'), 'assets', 'characters', cleanRuleName(characterName || '未命名角色'), 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      system: cleanRuleName(system || 'Common'),
      characterName: cleanRuleName(characterName || '未命名角色'),
      images: saved,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');

    console.log(`[角色图片] 已保存 ${characterName} -> ${manifestPath}`);
    res.json({ success: true, system: cleanRuleName(system || 'Common'), characterName: cleanRuleName(characterName || '未命名角色'), images: saved });
  } catch (err) {
    console.error('[角色图片] 保存失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
    const originalName = fixUploadOriginalName(req.file.originalname);
    const system = cleanRuleName(req.body.system || originalName.replace(/\.[^.]+$/, ''));
    const assets = extractPdfImageAssets(dataBuffer, system, originalName);

    // 清理上传文件
    fs.unlinkSync(req.file.path);

    res.json({
      text: data.text,
      pages: data.numpages,
      fileName: originalName,
      system,
      imageCount: assets.length,
      assets
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
    const originalName = fixUploadOriginalName(req.file.originalname);
    const extractDir = path.join(uploadDir, 'chm_extract_' + Date.now());
    const chmPath = path.join(uploadDir, `chm_source_${Date.now()}.chm`);
    fs.mkdirSync(extractDir, { recursive: true });

    // 使用Windows hh.exe解压CHM
    fs.copyFileSync(req.file.path, chmPath);
    execFileSync('hh.exe', ['-decompile', extractDir, chmPath], {
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

    const extractedFiles = [];
    function scanAll(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) scanAll(fullPath);
        else extractedFiles.push(fullPath);
      }
    }
    scanAll(extractDir);
    if (extractedFiles.length === 0) {
      throw new Error('CHM解包结果为空；可能是CHM文件不兼容、被系统阻止或hh.exe未能正确解包');
    }

    const system = cleanRuleName(req.body.system || originalName.replace(/\.[^.]+$/, ''));
    const assets = extractChmImageAssets(extractDir, system, originalName);

    // 提取所有HTML文本（去除标签）
    let allText = '';
    for (const htmlFile of htmlFiles.slice(0, 200)) { // 限制文件数
      try {
        let html = readTextFileSmart(htmlFile);
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
    removeTempFile(chmPath);
    fs.unlinkSync(req.file.path);

    res.json({
      text: allText.substring(0, 1000000), // 限制1MB
      fileName: originalName,
      filesProcessed: htmlFiles.length,
      extractedFiles: extractedFiles.length,
      system,
      imageCount: assets.length,
      assets
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
  const { system, q } = req.query;
  if (!system) return res.status(400).json({ error: '请指定系统名称' });

  const systemDir = path.join(RULER_DIR, system);
  if (!fs.existsSync(systemDir)) return res.status(404).json({ error: '系统目录不存在' });

  // 优先读取 _index.json
  const indexFile = path.join(systemDir, '_index.json');
  if (fs.existsSync(indexFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      // 带 q 时查询完整索引，不受默认前150条展示限制。
      // 同时合并 compressed/rule_index.json 的 HTML 层级索引；否则职业页等真实 sourceFile 路径
      // 只存在于 rule_index.json 时，插件用“玩家手册2024/角色职业/圣武士/圣武士.htm”等精确路径会查不到。
      if (String(q || '').trim() && Array.isArray(data.entries)) {
        const terms = String(q).toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 80));
        const matchEntry = entry => {
          const text = [entry.title, entry.content, entry.sourceFile, entry.category]
            .map(value => String(value || '').toLocaleLowerCase()).join(' ');
          return terms.some(term => text.includes(term));
        };
        const htmlItems = [];
        const ruleIndexPath = path.join(systemDir, 'compressed', 'rule_index.json');
        if (fs.existsSync(ruleIndexPath)) {
          try {
            const ruleIndex = JSON.parse(fs.readFileSync(ruleIndexPath, 'utf8'));
            const excludedSet = new Set(Array.isArray(ruleIndex.excluded) ? ruleIndex.excluded : []);
            for (const file of (Array.isArray(ruleIndex.files) ? ruleIndex.files : [])) {
              if (!file || excludedSet.has(file.rel)) continue;
              const entry = {
                id: 'source-' + htmlItems.length,
                title: file.title || file.rel,
                category: String(file.rel || '').includes('/') ? String(file.rel).split('/')[0] : '规则正文',
                content: '',
                sourceFile: file.rel
              };
              if (matchEntry(entry)) htmlItems.push(entry);
            }
          } catch (e) { /* rule_index.json 损坏时只使用 _index.json */ }
        }
        const seen = new Set();
        const items = [];
        for (const entry of [...htmlItems, ...data.entries.filter(matchEntry)]) {
          const key = [entry.title, entry.sourceFile, entry.category].map(v => String(v || '')).join('\u0001');
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(entry);
          if (items.length >= limit) break;
        }
        return res.json({ system: data.system || system, items, total: items.length, query: String(q) });
      }
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: '索引文件损坏' });
    }
  }

  // 回退：扫描compressed/目录下的所有md文件，提取结构
  const compressedDir = path.join(systemDir, 'compressed');
  const entries = [];
  const sourceDir = path.join(systemDir, 'source');

  // 优先使用Agent生成的HTML层级索引（规范整理后的规则书资产）
  const ruleIndexPath = path.join(compressedDir, 'rule_index.json');
  if (fs.existsSync(ruleIndexPath)) {
    try {
      const ruleIndex = JSON.parse(fs.readFileSync(ruleIndexPath, 'utf8'));
      const excludedSet = new Set(Array.isArray(ruleIndex.excluded) ? ruleIndex.excluded : []);
      const files = (Array.isArray(ruleIndex.files) ? ruleIndex.files : []).filter(f => !excludedSet.has(f.rel));
      // 最多取前150个正文页生成搜索条目（HTML本地转文本，不耗AI token）
      const limited = files.slice(0, 150);
      for (const file of limited) {
        try {
          const fullPath = path.join(sourceDir, file.rel);
          if (!fs.existsSync(fullPath)) continue;
          const text = htmlToMarkdownDocument(readTextFileSmart(fullPath), file.title || '')
            .replace(/\s{3,}/g, ' ')
            .slice(0, 3000);
          entries.push({
            id: 'html-' + entries.length,
            title: file.title || file.rel,
            category: file.rel.includes('/') ? file.rel.split('/')[0] : '规则正文',
            content: text,
            sourceFile: file.rel
          });
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* 索引损坏则走md回退 */ }
  }

  // 从compressed MD文件中提取条目（兼容旧拆解产物）
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

  // 同时扫描source目录的原始文本（兼容旧txt/md拆解产物）
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
// 读取规则系统 compressed/ 下的 JSON 数据文件（如 rule_spell_lists.json），原样返回
app.get('/api/rules/json', (req, res) => {
  const { system, file } = req.query;
  if (!system || !file) return res.status(400).json({ error: '参数不足' });

  const safeFile = path.normalize(String(file)).replace(/^([/\\])+/, '');
  if (!safeFile.toLowerCase().startsWith('compressed' + path.sep) || !/\.json$/i.test(safeFile)) {
    return res.status(400).json({ error: '仅允许读取 compressed/ 下的 .json 数据文件' });
  }

  const filePath = path.join(RULER_DIR, system, safeFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '数据文件不存在' });

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'JSON 解析失败: ' + e.message });
  }
});

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
    const off = parseInt(offset) || 0;
    const len = Math.min(parseInt(length) || 2000, 10000); // 最多10000字符
    let text = readTextFileSmart(foundPath);
    if (/\.(html?|xhtml)$/i.test(foundPath)) {
      text = htmlToMarkdownDocument(text, htmlTitle(text, path.basename(file)));
    }
    const totalSize = text.length;
    const slice = text.slice(off, off + len);

    res.json({
      text: slice,
      offset: off,
      length: len,
      totalSize,
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

// ── API: 关闭服务（仅本机，GUI 无控制台时的退出途径） ──

app.post('/api/shutdown', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('::ffff:127.0.0.1');
  if (!isLocal) return res.status(403).json({ error: '仅允许本机关闭服务' });
  res.json({ success: true, message: '服务正在关闭' });
  console.log('[启动] 收到本机关闭请求，退出中...');
  setTimeout(() => { process.exit(0); }, 200);
});

// ── 会话持久化（D+方案 2026-08-05）：规则书-冒险-频道 三级会话，JSONL 存储 ──────────
// 文件：Ruler/<系统>/存档/<冒险>/sessions/<频道ID>.jsonl（每行一条消息，永不删除）
// 删除频道只删前端入口，jsonl 保留可后续查阅；重新创建同名频道自动恢复历史

function sessionFilePath(system, adventure, channel) {
  const sys = cleanRuleName(String(system || ''));
  const adv = String(adventure || '默认');
  const ch = String(channel || 'story').replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(RULER_DIR, sys, '存档', adv, 'sessions', ch + '.jsonl');
}

function loadSession(system, adventure, channel) {
  const file = sessionFilePath(system, adventure, channel);
  try {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
    const msgs = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    return repairSessionTools(msgs); // 自愈旧数据缺 tool_call_id
  } catch (e) { return []; }
}

function appendSession(system, adventure, channel, messages) {
  try {
    const file = sessionFilePath(system, adventure, channel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = (Array.isArray(messages) ? messages : [messages])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'))
      .map(m => {
        // 持久化轻量化：保留必要字段；tool 消息必须带 tool_call_id（DeepSeek API 校验必需）
        const slim = { role: m.role, content: m.content };
        if (m.tool_calls) slim.tool_calls = m.tool_calls;
        if (m.reasoning_content) slim.reasoning_content = m.reasoning_content;
        if (m.role === 'tool') slim.tool_call_id = m.tool_call_id || '';
        return JSON.stringify(slim);
      });
    fs.appendFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    return true;
  } catch (e) { console.error('[会话] 追加失败:', e.message); return false; }
}

// 会话历史自愈（2026-08-05）：旧 jsonl 的 tool 消息可能缺 tool_call_id（早期持久化 bug），
// 加载时按顺序从后续 assistant 的 tool_calls 中补齐，避免 DeepSeek API 400 拒绝
function repairSessionTools(msgs) {
  const pending = []; // 待匹配的 assistant tool_calls id 队列
  const result = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      m.tool_calls.forEach(tc => { if (tc.id) pending.push(tc.id); });
    } else if (m.role === 'tool' && !m.tool_call_id) {
      // 旧数据缺 tool_call_id：从队列取一个补上（顺序匹配）
      m.tool_call_id = pending.shift() || ('call_' + Math.random().toString(36).slice(2, 10));
    }
    result.push(m);
  }
  return result;
}

// ── 冒险管理（2026-08-05）：归档与删除分离 ──────────────
// 归档 = 标记 archived，保留文件可检索；删除 = 彻底删除（含文件）
// meta 文件：Ruler/<系统>/存档/<冒险>/meta.json

function adventureMetaFile(system, adventure) {
  return path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档', String(adventure || '默认'), 'meta.json');
}

function loadAdventureMeta(system, adventure) {
  try {
    const f = adventureMetaFile(system, adventure);
    if (!fs.existsSync(f)) return {};
    return JSON.parse(fs.readFileSync(f, 'utf8')) || {};
  } catch (e) { return {}; }
}

function saveAdventureMeta(system, adventure, meta) {
  try {
    const f = adventureMetaFile(system, adventure);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(meta, null, 2), 'utf8');
    return true;
  } catch (e) { console.error('[冒险] meta写入失败:', e.message); return false; }
}

// 冒险统计：频道数、总消息数、最后活跃（jsonl 文件 mtime）
function adventureStats(system, adventure) {
  const advDir = path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档', String(adventure || '默认'));
  const sessionsDir = path.join(advDir, 'sessions');
  const stats = { channels: 0, messages: 0, lastActiveAt: null, size: 0 };
  try {
    if (fs.existsSync(sessionsDir)) {
      fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')).forEach(f => {
        const fp = path.join(sessionsDir, f);
        stats.channels++;
        try { stats.messages += fs.readFileSync(fp, 'utf8').split('\n').filter(l => l.trim()).length; } catch (e) {}
        const st = fs.statSync(fp);
        stats.size += st.size;
        if (!stats.lastActiveAt || st.mtimeMs > new Date(stats.lastActiveAt).getTime()) stats.lastActiveAt = st.mtime.toISOString();
      });
    }
  } catch (e) { /* ignore */ }
  return stats;
}

function listAdventures(system) {
  const base = path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    const meta = loadAdventureMeta(system, d.name);
    const stats = adventureStats(system, d.name);
    return {
      name: d.name,
      archived: !!meta.archived,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      createdAt: meta.createdAt || null,
      lastActiveAt: stats.lastActiveAt,
      channels: stats.channels,
      messages: stats.messages,
      size: stats.size
    };
  }).sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1; // 未归档在前
    return (b.lastActiveAt || '').localeCompare(a.lastActiveAt || '');
  });
}

// ── API: 冒险管理 ──────────────────────────────────

// 冒险列表（含元信息与统计）
app.get('/api/adventures/list', (req, res) => {
  const system = req.query.system || '';
  res.json(listAdventures(system));
});

// 新建冒险
app.post('/api/adventures/create', (req, res) => {
  const { system, name } = req.body || {};
  const adv = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (!adv) return res.status(400).json({ error: '冒险名不能为空' });
  const sys = cleanRuleName(String(system || ''));
  const advDir = path.join(RULER_DIR, sys, '存档', adv);
  if (fs.existsSync(advDir)) return res.status(400).json({ error: '冒险已存在' });
  try {
    fs.mkdirSync(path.join(advDir, 'sessions'), { recursive: true });
    saveAdventureMeta(system, adv, { archived: false, tags: [], createdAt: new Date().toISOString() });
    res.json({ success: true, adventure: adv });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 重命名冒险（改目录名 + meta）
app.post('/api/adventures/rename', (req, res) => {
  const { system, name, newName } = req.body || {};
  const adv = String(name || ''); const adv2 = String(newName || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  if (!adv2 || adv2 === adv) return res.status(400).json({ error: '新名称无效' });
  const sys = cleanRuleName(String(system || ''));
  const oldDir = path.join(RULER_DIR, sys, '存档', adv);
  const newDir = path.join(RULER_DIR, sys, '存档', adv2);
  if (!fs.existsSync(oldDir)) return res.status(404).json({ error: '冒险不存在' });
  if (fs.existsSync(newDir)) return res.status(400).json({ error: '目标冒险已存在' });
  try {
    fs.renameSync(oldDir, newDir);
    res.json({ success: true, adventure: adv2 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 归档/取消归档冒险（保留文件，可检索）
app.post('/api/adventures/archive', (req, res) => {
  const { system, name, archived } = req.body || {};
  const adv = String(name || '');
  const meta = loadAdventureMeta(system, adv);
  meta.archived = !!archived;
  saveAdventureMeta(system, adv, meta);
  res.json({ success: true, archived: !!archived });
});

// 编辑冒险标签
app.post('/api/adventures/tag', (req, res) => {
  const { system, name, tags } = req.body || {};
  const meta = loadAdventureMeta(system, String(name || ''));
  meta.tags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20) : [];
  saveAdventureMeta(system, String(name || ''), meta);
  res.json({ success: true, tags: meta.tags });
});

// 彻底删除冒险（含全部文件）
app.post('/api/adventures/delete', (req, res) => {
  const { system, name } = req.body || {};
  const sys = cleanRuleName(String(system || ''));
  const advDir = path.join(RULER_DIR, sys, '存档', String(name || ''));
  if (!fs.existsSync(advDir)) return res.status(404).json({ error: '冒险不存在' });
  try {
    fs.rmSync(advDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 频道彻底删除（删除对应 jsonl）
app.post('/api/sessions/delete', (req, res) => {
  const { system, adventure, channel } = req.body || {};
  const file = sessionFilePath(system, adventure, channel);
  if (!fs.existsSync(file)) return res.json({ success: true, existed: false });
  try {
    fs.rmSync(file, { force: true });
    res.json({ success: true, existed: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: 自动存档 ──────────────────────────────────

app.post('/api/archive/log', (req, res) => {
  const { user, ai, time, system, adventure } = req.body;
  const sys = system || 'DND'; const adv = adventure || '默认';
  const advDir = path.join(RULER_DIR, sys, '存档', adv);
  if (!fs.existsSync(advDir)) fs.mkdirSync(advDir, { recursive: true });
  const logFile = path.join(advDir, 'conversation.txt');
  const entry = `[${time || new Date().toISOString()}]\n玩家: ${user}\nGM: ${ai}\n\n`;
  try { fs.appendFileSync(logFile, entry, 'utf8'); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/archive/list', (req, res) => {
  const system = req.query.system || '';
  const base = system ? path.join(RULER_DIR, system, '存档') : RULER_DIR;
  if (!fs.existsSync(base)) return res.json([]);
  const results = [];
  if (system) {
    fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => {
      const files = fs.readdirSync(path.join(base, d.name)).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
      results.push({ system, name: d.name, files });
    });
  } else {
    fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(sysDir => {
      const adir = path.join(base, sysDir.name, '存档');
      if (fs.existsSync(adir)) {
        fs.readdirSync(adir, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => {
          results.push({ system: sysDir.name, name: d.name, files: [] });
        });
      }
    });
  }
  res.json(results);
});

app.get('/api/archive/read', (req, res) => {
  const { system, adventure, file } = req.query;
  const filePath = path.join(RULER_DIR, system || 'DND', '存档', adventure || '默认', file || 'conversation.txt');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '存档不存在' });
  try { const text = fs.readFileSync(filePath, 'utf8'); res.json({ content: text, file }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: 模组搜索 ──────────────────────────────────

app.get('/api/module/search', (req, res) => {
  const { q, system } = req.query;
  if (!q) return res.json({ results: [] });
  const results = [];
  function scan(base) {
    if (!fs.existsSync(base)) return;
    fs.readdirSync(base, { withFileTypes: true }).forEach(entry => {
      const full = path.join(base, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        try {
          const text = fs.readFileSync(full, 'utf8');
          if (text.toLowerCase().includes(q.toLowerCase())) {
            results.push({ title: entry.name.substring(0, 60), type: '剧本', summary: text.substring(0, 200), file: entry.name });
            if (results.length >= 10) return;
          }
        } catch(e) {}
      }
    });
  }
  const searchBase = system ? path.join(RULER_DIR, system, '模组') : RULER_DIR;
  scan(searchBase);
  res.json({ results: results.slice(0, 10), query: q });
});

app.get('/api/module/list', (req, res) => {
  const system = req.query.system || '';
  const base = system ? path.join(RULER_DIR, system, '模组') : RULER_DIR;
  if (!fs.existsSync(base)) return res.json([]);
  function list(dir, depth = 0) {
    const result = [];
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      if (depth === 0 && (e.name === 'compressed' || e.name === 'source' || e.name === '存档')) return;
      const full = path.join(dir, e.name);
      result.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size: e.isFile() ? fs.statSync(full).size : 0 });
    });
    return result;
  }
  res.json(list(base));
});

// ── API: 会话查阅（D+ 2026-08-05）─────────────────────

// 列出某规则系统下的全部冒险（含各冒险的会话文件）
app.get('/api/sessions/list', (req, res) => {
  const system = req.query.system || '';
  const sys = cleanRuleName(String(system));
  const base = path.join(RULER_DIR, sys, '存档');
  if (!fs.existsSync(base)) return res.json([]);
  const result = [];
  try {
    fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(adv => {
      const sessionsDir = path.join(base, adv.name, 'sessions');
      const sessions = [];
      if (fs.existsSync(sessionsDir)) {
        fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')).forEach(f => {
          sessions.push({ channel: f.replace(/\.jsonl$/, ''), size: fs.statSync(path.join(sessionsDir, f)).size });
        });
      }
      result.push({ adventure: adv.name, sessions });
    });
  } catch (e) { /* ignore */ }
  res.json(result);
});

// 读取某会话历史（只读查阅，格式：消息数组）
app.get('/api/sessions/read', (req, res) => {
  const { system, adventure, channel } = req.query;
  const file = sessionFilePath(system, adventure, channel);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '会话不存在' });
  try {
    const msgs = loadSession(system, adventure, channel);
    res.json({ system, adventure, channel, total: msgs.length, messages: msgs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: 模型发现与连接测试 ──────────────────────────

app.post('/api/ai/models', async (req, res) => {
  const { provider: reqProvider = 'custom', endpoint: reqEndpoint, apiKey: reqApiKey } = req.body || {};
  const saved = appConfig.ai.providers[reqProvider] || {};
  const endpoint = cleanApiUrl(reqEndpoint || saved.endpoint || DEFAULT_PROVIDER_ENDPOINTS[reqProvider]);
  const apiKey = resolveApiKey(reqApiKey, saved.apiKey);

  if (!endpoint) {
    return res.status(400).json({ error: '请先填写API地址' });
  }
  if (reqProvider === 'gpt' && !apiKey) {
    return res.status(400).json({ error: '请先填写API Key' });
  }

  try {
    const result = await discoverModels(endpoint, apiKey);
    res.json({
      provider: reqProvider,
      models: result.models,
      endpoint: result.endpoint,
      modelsUrl: result.modelsUrl,
      manual: result.models.length === 0
    });
  } catch (err) {
    // 并非所有兼容服务都实现/models。明确返回原因，同时保留手动输入入口。
    res.status(502).json({
      provider: reqProvider,
      models: [],
      manual: true,
      error: `无法读取模型列表：${err.message}`
    });
  }
});

app.post('/api/ai/test', async (req, res) => {
  const {
    provider: reqProvider = 'custom',
    endpoint: reqEndpoint,
    apiKey: reqApiKey,
    model: reqModel
  } = req.body || {};

  const saved = appConfig.ai.providers[reqProvider] || {};
  const endpoint = cleanApiUrl(reqEndpoint || saved.endpoint || DEFAULT_PROVIDER_ENDPOINTS[reqProvider]);
  const apiKey = resolveApiKey(reqApiKey, saved.apiKey);
  let model = String(reqModel || saved.model || '').trim();

  if (!endpoint) return res.status(400).json({ error: '请先填写API地址' });
  if (reqProvider === 'gpt' && !apiKey) return res.status(400).json({ error: '请先填写API Key' });

  try {
    if (!model) {
      const discovered = await discoverModels(endpoint, apiKey);
      model = discovered.models[0] || '';
    }
    if (!model) return res.status(400).json({ error: '没有可用于测试的模型，请先选择或输入模型' });

    const result = await callAI(endpoint, apiKey, model, [
      { role: 'user', content: '只回复 OK' }
    ]);
    res.json({ success: true, model: result.model || model, content: result.content });
  } catch (err) {
    res.status(502).json({ error: `连接失败：${err.message}` });
  }
});

// ── WebSocket / 房间系统 ─────────────────────────────

const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 房间管理
const rooms = {}; // { roomCode: { tokens:[], players:{}, hostId:null, createdAt:Date } }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的 0O1I
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms[code] ? generateRoomCode() : code; // 防重复
}

function getOrCreateRoom(code) {
  if (!rooms[code]) {
    rooms[code] = {
      code,
      tokens: [],
      players: {},
      hostId: null,
      createdAt: Date.now()
    };
  }
  return rooms[code];
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = '';

  // ── 创建房间 ──
  socket.on('create_room', () => {
    const code = generateRoomCode();
    const room = getOrCreateRoom(code);
    room.hostId = socket.id;

    playerName = '房主';
    room.players[socket.id] = { name: playerName, isHost: true };

    socket.join(code);
    currentRoom = code;

    socket.emit('room_created', { code, players: room.players, tokens: room.tokens });
    io.to(code).emit('players_update', room.players);
    console.log(`[房间] ${code} 创建`);
  });

  // ── 加入房间 ──
  socket.on('join_room', (data) => {
    const code = (data.code || '').toUpperCase();
    if (!rooms[code]) {
      socket.emit('room_error', '房间不存在');
      return;
    }
    const room = rooms[code];
    playerName = data.name || `访客${Object.keys(room.players).length + 1}`;
    room.players[socket.id] = { name: playerName, isHost: false };

    socket.join(code);
    currentRoom = code;

    socket.emit('room_joined', { code, players: room.players, tokens: room.tokens, isHost: false });
    socket.broadcast.to(code).emit('players_update', room.players);
    io.to(code).emit('chat', { sender: '系统', text: `${playerName} 加入了房间`, time: new Date().toLocaleTimeString('zh-CN') });
    console.log(`[房间] ${code} ← ${playerName} 加入 (${Object.keys(room.players).length}人)`);
  });

  // ── 游戏事件（仅转发到同房间其他人） ──

  const relay = (event, data) => {
    if (currentRoom) socket.broadcast.to(currentRoom).emit(event, data);
  };

  const relayAll = (event, data) => {
    if (currentRoom) io.to(currentRoom).emit(event, data);
  };

  socket.on('token_add', (data) => {
    if (currentRoom && rooms[currentRoom]) rooms[currentRoom].tokens.push(data);
    relay('token_add', data);
  });

  socket.on('token_move', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      const t = rooms[currentRoom].tokens.find(tk => tk.id === data.id);
      if (t) { t.gridX = data.gridX; t.gridY = data.gridY; }
    }
    relay('token_move', data);
  });

  socket.on('token_update', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      const t = rooms[currentRoom].tokens.find(tk => tk.id === data.id);
      if (t) Object.assign(t, data);
    }
    relay('token_update', data);
  });

  socket.on('token_remove', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].tokens = rooms[currentRoom].tokens.filter(tk => tk.id !== data.id);
    }
    relay('token_remove', data);
  });

  socket.on('token_sync_all', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].tokens = data.tokens || [];
    }
    relay('token_sync_all', data);
  });

  socket.on('dice_roll', (data) => {
    relay('dice_roll', { ...data, player: playerName });
  });

  socket.on('chat_msg', (data) => {
    relayAll('chat', { ...data, sender: `${playerName}: ${data.text}` });
  });

  socket.on('ai_chat', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    // AI输出只能由房主/GM广播；普通玩家不能伪造AI消息。
    if (socket.id !== room.hostId) return;
    socket.broadcast.to(currentRoom).emit('ai_chat', {
      text: String(data.text || ''),
      channelId: data.channelId || 'story',
      sender: 'AI',
      time: new Date().toLocaleTimeString('zh-CN')
    });
  });

  socket.on('set_name', (name) => {
    playerName = name;
    if (currentRoom && rooms[currentRoom] && rooms[currentRoom].players[socket.id]) {
      rooms[currentRoom].players[socket.id].name = name;
      relayAll('players_update', rooms[currentRoom].players);
    }
  });

  // ── 断开 ──
  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[socket.id];
    delete room.players[socket.id];

    if (Object.keys(room.players).length === 0) {
      // 空房间清理（延迟10分钟）
      setTimeout(() => {
        if (rooms[currentRoom] && Object.keys(rooms[currentRoom].players).length === 0) {
          delete rooms[currentRoom];
          console.log(`[房间] ${currentRoom} 已清理`);
        }
      }, 600000);
    } else {
      // 房主/GM断线后不自动转移给普通玩家，避免非GM变成房主。
      if (socket.id === room.hostId) {
        room.hostId = null;
      }
      io.to(currentRoom).emit('players_update', room.players);
    }

    io.to(currentRoom).emit('chat', {
      sender: '系统',
      text: `${p?.name || '某人'} 离开了房间`,
      time: new Date().toLocaleTimeString('zh-CN')
    });
    console.log(`[房间] ${currentRoom} ← ${p?.name || '?'} 离开`);
  });
});

// ── 启动服务器 ────────────────────────────────────────

function openGamePage() {
  if (process.argv.includes('--no-open') || process.env.SOLOTRPG_NO_OPEN === '1') return;

  const { spawn } = require('child_process');
  const url = `http://127.0.0.1:${PORT}`;

  let command;
  let args;
  if (process.platform === 'win32') {
    // explorer.exe 能直接把 URL 交给系统默认浏览器，不依赖 PowerShell 执行策略。
    command = 'explorer.exe';
    args = [url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const opener = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    opener.once('error', error => {
      console.error(`[启动] 自动打开浏览器失败，请手动访问 ${url}: ${error.message}`);
    });
    opener.once('spawn', () => {
      console.log(`[启动] 已请求系统默认浏览器打开 ${url}`);
    });
    opener.unref();
  } catch (error) {
    console.error(`[启动] 自动打开浏览器失败，请手动访问 ${url}: ${error.message}`);
  }
}

// ── 单实例与端口自动管理：start.bat 与 SoloTrpg.exe 共用 ───────────────

function getPortOwnerPid(port) {
  if (process.platform !== 'win32') return 0;
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
    const lines = out.split(/\r?\n/);
    for (const line of lines) {
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const local = parts[1] || '';
      const pid = Number(parts[4]);
      if (pid && (local.endsWith(`:${port}`) || local.endsWith(`]:${port}`))) return pid;
    }
  } catch (e) {
    console.warn(`[启动] 检查端口 ${port} 占用失败: ${e.message}`);
  }
  return 0;
}

function getProcessInfo(pid) {
  if (!pid || process.platform !== 'win32') return { pid };
  try {
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"`,
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    if (!out) return { pid };
    const info = JSON.parse(out);
    return {
      pid: Number(info.ProcessId || pid),
      name: info.Name || '',
      executablePath: info.ExecutablePath || '',
      commandLine: info.CommandLine || ''
    };
  } catch (e) {
    return { pid, error: e.message };
  }
}

function normalizeFsPath(value) {
  return path.resolve(String(value || '')).toLowerCase();
}

function readServerLock() {
  try {
    if (!fs.existsSync(SERVER_LOCK_PATH)) return null;
    return JSON.parse(fs.readFileSync(SERVER_LOCK_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function lockMatchesOwner(lock, ownerPid) {
  if (!lock || Number(lock.pid) !== Number(ownerPid)) return false;
  return normalizeFsPath(lock.runtimeRoot) === normalizeFsPath(RUNTIME_ROOT);
}

function probeSoloTrpgHealth(port) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1200 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          resolve(res.statusCode === 200 && data.status === 'ok' && Object.prototype.hasOwnProperty.call(data, 'aiConfigured'));
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function isLikelySameProjectNode(info) {
  const name = String(info.name || '').toLowerCase();
  const cmd = String(info.commandLine || '').toLowerCase();
  if (name === 'node.exe' && cmd.includes('server.js')) return true;
  if (name === 'solotrpg.exe') return true;
  return false;
}

function waitPortFree(port, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = getPortOwnerPid(port);
    if (!pid || pid === process.pid) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  return false;
}

function terminateProcessTree(pid) {
  if (!pid || pid === process.pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) { /* ignore */ }
  if (!waitPortFree(PORT, 2500) && process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
    } catch (e) { /* ignore */ }
  }
}

async function prepareSingleInstance() {
  const ownerPid = getPortOwnerPid(PORT);
  if (!ownerPid || ownerPid === process.pid) return;

  const info = getProcessInfo(ownerPid);
  const lock = readServerLock();
  const isLockedOldInstance = lockMatchesOwner(lock, ownerPid);
  const isSoloTrpg = isLockedOldInstance || await probeSoloTrpgHealth(PORT);
  const isLikelyProjectProcess = isLikelySameProjectNode(info);

  if (isSoloTrpg || isLikelyProjectProcess) {
    console.log(`[启动] 端口 ${PORT} 被旧 SoloTrpg 后端占用，正在自动关闭旧进程 PID=${ownerPid}。`);
    terminateProcessTree(ownerPid);
    if (!waitPortFree(PORT, 5000)) {
      throw new Error(`旧后端 PID=${ownerPid} 未释放端口 ${PORT}`);
    }
    console.log(`[启动] 端口 ${PORT} 已释放，将启动当前版本。`);
    return;
  }

  const detail = `PID=${ownerPid} Name=${info.name || '?'} Path=${info.executablePath || '?'}`;
  throw new Error(`端口 ${PORT} 被非 SoloTrpg 进程占用：${detail}`);
}

function writeServerLock() {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(SERVER_LOCK_PATH, JSON.stringify({
      pid: process.pid,
      port: PORT,
      runtimeRoot: RUNTIME_ROOT,
      sourceRoot: SOURCE_ROOT,
      entry: isPkg ? process.execPath : path.join(__dirname, 'server.js'),
      isPkg,
      startedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[启动] 写入运行锁失败: ${e.message}`);
  }
}

function cleanupServerLock() {
  try {
    const lock = readServerLock();
    if (lock && Number(lock.pid) === process.pid && fs.existsSync(SERVER_LOCK_PATH)) {
      fs.unlinkSync(SERVER_LOCK_PATH);
    }
  } catch (e) { /* ignore */ }
}

process.once('exit', cleanupServerLock);
process.once('SIGINT', () => { cleanupServerLock(); process.exit(0); });
process.once('SIGTERM', () => { cleanupServerLock(); process.exit(0); });

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[启动] 端口 ${PORT} 仍被占用，当前版本无法启动。`);
    process.exit(1);
  }

  console.error('[启动] 后端启动失败:', err);
  process.exit(1);
});

async function startServer() {
  try {
    await prepareSingleInstance();
  } catch (err) {
    console.error('[启动] 单实例准备失败:', err.message);
    process.exit(1);
  }

  server.listen(PORT, '0.0.0.0', () => {
    writeServerLock();
    console.log('═══════════════════════════════════════════');
    console.log('  SoloTrpg 已启动');
    console.log(`  游戏地址: http://127.0.0.1:${PORT}`);
    console.log(`  运行目录: ${RUNTIME_ROOT}`);
    console.log(`  后端入口: ${isPkg ? 'SoloTrpg.exe（Node 打包）' : 'server/server.js'}`);
    console.log(`  运行锁: ${SERVER_LOCK_PATH}`);
    if (DEBUG_MODE) {
      console.log(`  调试日志: ${LATEST_LOG_PATH}`);
    }
    console.log('═══════════════════════════════════════════');

    openGamePage();
    autoScanRulesOnStartup();

    const aiReady = Object.entries(appConfig.ai.providers || {}).some(([key, provider]) => {
      if (!provider?.enabled || !provider.endpoint || !provider.model) return false;
      return key !== 'gpt' || Boolean(provider.apiKey);
    });
    if (!aiReady) {
      console.log('  ⚠  AI未配置，请在界面设置中填写提供商、地址与模型');
      console.log(`  ⚠  配置文件: ${CONFIG_PATH}`);
    }
  });
}

startServer();
