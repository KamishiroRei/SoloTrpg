// ── 通用工具库（纯函数，无 app 依赖；从 server.js 拆分，供 AI 核心/路由/GM 工具共用） ──
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const SOURCE_ROOT = path.resolve(__dirname, '..', '..');

// ── 时间/日志 ──

function cleanRuleName(value) {
  const name = String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return name || '未命名规则书';
}

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

// ── AI 提供商地址与模型发现 ──

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

function resolveApiUrls(endpoint) {
  const raw = cleanApiUrl(endpoint);
  if (!raw) return { baseUrl: '', chatUrl: '', modelsUrl: '' };
  const baseUrl = stripApiAction(raw);
  const lower = raw.toLowerCase();
  const chatUrl = lower.endsWith('/chat/completions')
    ? raw
    : `${baseUrl}/chat/completions`;
  return { baseUrl, chatUrl, modelsUrl: `${baseUrl}/models` };
}

function resolveApiKey(inputKey, savedKey) {
  if (inputKey === undefined || inputKey === null || inputKey === '***已设置***') {
    return savedKey || '';
  }
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
      const resp = await fetch(url, { method: 'GET', headers: authHeaders(apiKey), timeout: 30000 });
      if (!resp.ok) {
        errors.push(`${url}: ${await readErrorResponse(resp)}`);
        continue;
      }
      const payload = await resp.json();
      const models = parseModelList(payload);
      const resolvedBase = url.replace(/\/models\/?$/i, '');
      return { models, modelsUrl: url, endpoint: `${resolvedBase}/chat/completions` };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(errors.join('；') || '模型接口不可用');
}

// ── 提示词/SKILL 加载（docs/prompts 与 docs/skills 的模块化读取） ──

const PROMPT_PROFILE_VERSION = '2026-08-06-high-standard-v1';

function readPromptTemplate(name) {
  const safeName = String(name || '').replace(/[^a-zA-Z0-9_\-.]/g, '');
  if (!safeName) return '';
  const file = path.join(SOURCE_ROOT, 'docs', 'prompts', safeName);
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.error('[提示词] 读取失败:', safeName, error.message);
  }
  return '';
}

const SKILL_CACHE = {};
function loadSkillFile(name) {
  if (SKILL_CACHE[name] !== undefined) return SKILL_CACHE[name];
  const safeName = String(name || '').replace(/[^a-zA-Z0-9_\-.]/g, '');
  if (!safeName) { SKILL_CACHE[name] = ''; return ''; }
  const file = path.join(SOURCE_ROOT, 'docs', 'skills', safeName + '.md');
  try {
    if (fs.existsSync(file)) {
      SKILL_CACHE[name] = fs.readFileSync(file, 'utf8').trim();
      return SKILL_CACHE[name];
    }
  } catch (error) {
    console.error('[SKILL] 读取失败:', safeName, error.message);
  }
  SKILL_CACHE[name] = '';
  return '';
}

function skillTextByName(name) {
  switch (String(name || '')) {
    case 'agent-guide': return loadSkillFile('agent-guide');
    case 'rulebook-development': return loadSkillFile('rulebook-development');
    case 'character-system': return loadSkillFile('character-system');
    case 'gameplay-ux': return loadSkillFile('gameplay-ux');
    case 'plugin-authoring': return loadSkillFile('plugin-authoring');
    case 'gm-protocol': return loadSkillFile('gm-protocol');
    case 'gm-standard': return loadSkillFile('gm-standard');
    default: return '';
  }
}

function buildSkillBundle(names) {
  const seen = new Set();
  const parts = [];
  for (const name of names || []) {
    const key = String(name || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const text = skillTextByName(key);
    if (text) parts.push(`\n\n===== 自动注入 SKILL：${key} =====\n${text.trim()}`);
  }
  return parts.join('\n');
}

function renderPromptTemplate(template, values) {
  const vars = values || {};
  return String(template || '').replace(/{{([a-zA-Z0-9_]+)}}/g, function(_, key) {
    return vars[key] === undefined || vars[key] === null ? '' : String(vars[key]);
  });
}

function detectAiPromptProfile(input) {
  const explicit = String(input && input.profile || '').trim();
  if (explicit) return explicit;
  const channel = String(input && input.channel || '').toLowerCase();
  const text = String(input && input.text || '');
  if (/module[_-]?ingest|模组导入/.test(channel)) return 'module_ingest';
  if (/rulebook[_-]?ingest|规则书解析/.test(channel)) return 'rulebook_ingest';
  if (/导入.{0,12}模组|模组.{0,12}导入|public-index|module-manifest|modules\//i.test(text)) return 'module_ingest';
  if (/解析.{0,12}(规则书|世界书)|(?:规则书|世界书).{0,12}解析|规则模块|规则系统开发|rulebook|worldbook|source\/|compressed\//i.test(text)) return 'rulebook_development';
  if (/角色卡|开卡|创角|背包|装备|职业|种族|法术|专长|等级|升级|character/i.test(text)) return 'character_system';
  if (/地图|Token|范围|测量|界面|交互|浮动|分页|拖动|UI|UX/i.test(text)) return 'gameplay_ux';
  return channel === 'system' ? 'system_development' : 'gm_play';
}

function buildAiPromptProfile(input) {
  const profile = detectAiPromptProfile(input || {});
  const values = Object.assign({
    system: '',
    modulePath: '',
    moduleName: '',
    taskPath: '',
    promptProfileVersion: PROMPT_PROFILE_VERSION
  }, input || {});
  const profileFiles = {
    system_development: 'system-development.md',
    rulebook_development: 'rulebook-development.md',
    rulebook_ingest: 'rulebook-ingest.md',
    module_ingest: 'module-ingest.md',
    character_system: 'character-system-development.md',
    gameplay_ux: 'gameplay-ux-development.md',
    gm_play: 'gm-runtime.md'
  };
  const skillMap = {
    system_development: ['agent-guide', 'rulebook-development', 'gameplay-ux', 'character-system', 'plugin-authoring'],
    rulebook_development: ['agent-guide', 'rulebook-development', 'gameplay-ux', 'character-system', 'plugin-authoring'],
    rulebook_ingest: ['agent-guide', 'rulebook-development', 'gameplay-ux', 'character-system', 'plugin-authoring'],
    module_ingest: ['agent-guide', 'rulebook-development', 'gameplay-ux', 'gm-protocol', 'plugin-authoring'],
    character_system: ['agent-guide', 'rulebook-development', 'character-system', 'gameplay-ux', 'plugin-authoring'],
    gameplay_ux: ['agent-guide', 'gameplay-ux', 'character-system', 'plugin-authoring'],
    gm_play: ['gm-protocol', 'gm-standard']
  };
  const fallback = `# TrpgRecode 自动任务提示词\n\n任务类型：${profile}\n当前规则系统：{{system}}\n\n以真实跑团体验为唯一完成标准。先理解玩家流程，再读取、整理、修改、验证和总结。`;
  const template = readPromptTemplate(profileFiles[profile]) || fallback;
  const body = renderPromptTemplate(template, values).trim();
  const skills = buildSkillBundle(skillMap[profile] || ['agent-guide']);
  return [
    `【TrpgRecode 自动提示词注入 / ${PROMPT_PROFILE_VERSION} / ${profile}】`,
    body,
    skills,
    '\n===== 注入完成后的执行要求 =====\n- 上述 SKILL 已自动注入，不需要再等用户要求或另行调用才遵守。\n- 可以按需继续用 skill 工具重读某一项，但不得因为未调用 skill 就降低标准。\n- DND 只能作为完成度与体验标准参照，不得复制 DND 原始代码、字段、数据、美术或规则专属判断到其他规则系统。\n- 交付前必须留下能被后续 AI 读取的整理文件、任务记录、验证记录与日志。'
  ].join('\n\n').trim();
}

function lastUserContent(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].role === 'user') return String(list[i].content || '');
  }
  return '';
}

// ── bash 输出解码 ──

function decodeWinOutput(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) {
    try { return new TextDecoder('gbk').decode(buf); }
    catch (e2) { return buf.toString('utf8'); }
  }
}

module.exports = {
  SOURCE_ROOT,
  cleanRuleName,
  formatLocalTimestamp, formatLogFilename,
  DEFAULT_PROVIDER_ENDPOINTS, cleanApiUrl, stripApiAction, resolveApiUrls, resolveApiKey,
  authHeaders, parseModelList, readErrorResponse, discoverModels,
  PROMPT_PROFILE_VERSION, readPromptTemplate, loadSkillFile, skillTextByName, buildSkillBundle,
  renderPromptTemplate, detectAiPromptProfile, buildAiPromptProfile, lastUserContent,
  decodeWinOutput
};
