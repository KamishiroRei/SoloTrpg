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
const http = require('http');
const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const zlib = require('zlib');
const fetch = require('node-fetch');
const { execFileSync, execSync, execFile, spawn } = require('child_process');

// ── 共享工具库（utils）解构：配置管理/挂载区/AI 路由共用 ──
const utils = require('./lib/utils');
const {
  cleanRuleName,
  DEFAULT_PROVIDER_ENDPOINTS, cleanApiUrl, stripApiAction, resolveApiUrls, resolveApiKey,
  authHeaders, parseModelList, readErrorResponse, discoverModels,
  PROMPT_PROFILE_VERSION, readPromptTemplate, loadSkillFile, skillTextByName, buildSkillBundle,
  renderPromptTemplate, detectAiPromptProfile, buildAiPromptProfile, lastUserContent, decodeWinOutput
} = utils;

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

// AI文件操作授权：软件根目录全部内容（含自身源码）+ 项目外绝对路径读写执行全放行
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

// 宿主静态文件：no-cache（每次重新验证，文件修改后浏览器必拿新版本，避免 WebView2 持久化缓存旧 JS/HTML/CSS）
app.use(express.static(APP_DIR, { setHeaders: function (res) { res.setHeader('Cache-Control', 'no-cache'); } }));
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

// ── 模块化挂载：AI 核心 + GM 带团工具（原 GM 工具区与 AI 调用区拆出） ──
// ── 核心模块创建（规则书解析管线 / 共享存储 / 房间系统） ──
const createStore = require('./lib/store');
const store = createStore({ fs, path, RULER_DIR, cleanRuleName });
const { sessionFilePath, privateSessionFilePath, loadSession, appendSession, appendPrivateSession, loadPrivateSession, listPrivateSessions, characterDir, loadAdventureMeta, saveAdventureMeta, listAdventures, repairSessionTools } = store;
const createRulebookPipeline = require('./modules/rulebook-pipeline');
const pipeline = createRulebookPipeline({ fs, path, RULER_DIR, SHARED_TOOLS_DIR, appConfig, uploadDir, http, zlib, fetch, execFile, execFileSync, spawn, characterDir, cleanRuleName }, app);
const { appendRulebookTaskLog, readRulebookTaskStatus, listFilesRecursive, loadRuleSystemSettings,
  readTextFileSmart, htmlTitle, htmlToMarkdownDocument, stripHtmlToText, globToRegex, execFileAsync, removeTempFile,
  migrateCharacterAssets, migrateAllCharacterAssets, runRulebookIngestAgent, runAgentTool, AGENT_TOOL_PROMPT, cleanRuleSystemDirForReparse } = pipeline;
const createRooms = require('./modules/rooms');
const roomsMod = createRooms(app, { fs, path, RUNTIME_ROOT, cleanRuleName, appendPrivateSession });
const { server, io, rooms, onlineNames, isNameTaken } = roomsMod;

const createAiCore = require('./lib/ai-core');
const createGmTools = require('./modules/gm-tools');
const aiCore = createAiCore;
const { callAI, callAIOnce, callAIStream } = aiCore;
const gmTools = createGmTools({ fs, path, RULER_DIR, cleanRuleName, loadAdventureMeta, listFilesRecursive, callAI });
const { GM_TOOLS, executeGmTool, runGmToolLoop } = gmTools;

// ── 系统工具执行器 + 插件路由（upload/pendingQuestions 为共享运行态） ──
const multer = require('multer');
const upload = multer({ dest: uploadDir, limits: { fileSize: 100 * 1024 * 1024 } });
const pendingQuestions = new Map();
const createSystemTools = require('./modules/system-tools');
const systemTools = createSystemTools({ fs, path, RULER_DIR, SOURCE_ROOT, RUNTIME_ROOT, HOST_PLUGINS_DIR, cleanRuleName, readTextFileSmart, stripHtmlToText, globToRegex, spawn, io, pendingQuestions, appConfig, callAI, skillTextByName, decodeWinOutput });
const { PLUGIN_TOOLS, runPluginTool, APP_WHITELIST } = systemTools;
const registerPluginRoutes = require('./routes/plugins');
registerPluginRoutes(app, { fs, path, RULER_DIR, HOST_PLUGINS_DIR, cleanRuleName, crypto, pendingQuestions });

// ── AI 对话路由（模块化挂载：routes/ai.js） ──
const registerAiRoutes = require('./routes/ai');
registerAiRoutes(app, { fs, path, appConfig, callAI, callAIStream, runGmToolLoop, runPluginTool, PLUGIN_TOOLS, buildAiPromptProfile, cleanRuleName, lastUserContent, PROMPT_PROFILE_VERSION, loadSession, appendSession, sessionFilePath, repairSessionTools, appendPrivateSession });

// ── 规则书路由（模块化挂载：routes/rules.js） ──
const registerRulesRoutes = require('./routes/rules');
registerRulesRoutes(app, { fs, path, RULER_DIR, isPathAllowed, appConfig, callAI, cleanRuleName, listFilesRecursive, loadRuleSystemSettings, readRulebookTaskStatus, appendRulebookTaskLog, cleanRuleSystemDirForReparse, runRulebookIngestAgent });

// ── 冒险管理（模块化挂载：routes/adventures.js） ──
const registerAdventureRoutes = require('./routes/adventures');
registerAdventureRoutes(app, { fs, path, RULER_DIR, cleanRuleName, listAdventures, loadAdventureMeta, saveAdventureMeta });

// ── 战斗引擎模块（编程 AI/回合判定/反应系统；规则书定制见 docs/skills/gm-protocol.md 十四节） ──
const createCombatEngine = require('./modules/combat-engine');
const registerCombatRoutes = require('./routes/combat');
const combatEngine = createCombatEngine({ fs, path, RULER_DIR, cleanRuleName });
registerCombatRoutes(app, { engine: combatEngine });

// ── 模组/UI框架/会话路由（模块化挂载：routes/modules.js） ──

// ── 游戏状态/压缩/健康/关闭/立绘/模型发现 路由（模块化挂载：routes/misc.js） ──
const registerMiscRoutes = require('./routes/misc');
const miscRoutes = registerMiscRoutes(app, { fs, path, RULER_DIR, RUNTIME_ROOT, cleanRuleName, readTextFileSmart, htmlToMarkdownDocument, htmlTitle, migrateAllCharacterAssets, migrateCharacterAssets, characterDir, appConfig, isNameTaken, loadAdventureMeta, cleanApiUrl, DEFAULT_PROVIDER_ENDPOINTS, resolveApiKey });
const { autoScanRulesOnStartup } = miscRoutes;

const registerModuleRoutes = require('./routes/modules');
registerModuleRoutes(app, { fs, path, RULER_DIR, SOURCE_ROOT, RUNTIME_ROOT, cleanRuleName, crypto, renderPromptTemplate, PROMPT_PROFILE_VERSION, readTextFileSmart, stripHtmlToText, upload, uploadDir, removeTempFile, sessionFilePath, loadSession, privateSessionFilePath, appendPrivateSession, loadPrivateSession, listPrivateSessions });

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

// ── 启动服务器 ────────────────────────────────────────

function openGamePage() {
  if (process.argv.includes('--no-open') || process.env.SOLOTRPG_NO_OPEN === '1') return;

  const { spawn } = require('child_process');
  const url = `http://127.0.0.1:${PORT}`;

  // Windows 用 cmd /c start（最可靠的打开默认浏览器方式；explorer.exe 传 URL 在某些配置下不可靠）
  let command;
  let args;
  if (process.platform === 'win32') {
    command = process.env.ComSpec || 'cmd.exe';
    args = ['/c', 'start', '', url];
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
      // 降级：cmd start 失败时退回 explorer.exe（旧方式）
      if (process.platform === 'win32') {
        try {
          const fallback = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
          fallback.once('error', ferr => console.error(`[启动] 自动打开浏览器失败，请手动访问 ${url}: ${ferr.message}`));
          fallback.unref();
        } catch (ferr) { console.error(`[启动] 自动打开浏览器失败，请手动访问 ${url}: ${ferr.message}`); }
      } else {
        console.error(`[启动] 自动打开浏览器失败，请手动访问 ${url}: ${error.message}`);
      }
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
