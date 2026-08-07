// ── 规则书解析管线（文件读取/上传/解析 Agent 工具；从 server.js 整区原样搬迁） ──
// 依赖注入 deps = { fs, path, RULER_DIR, SHARED_TOOLS_DIR, appConfig, uploadDir, http, zlib, fetch, execFile, execFileSync, spawn }；app 用于挂载上传/读取路由
module.exports = function createRulebookPipeline(deps, app) {
  const { fs, path, RULER_DIR, SHARED_TOOLS_DIR, appConfig, uploadDir, http, zlib, fetch, execFile, execFileSync, spawn, characterDir } = deps;
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
6. 角色卡类功能（创卡/升级/装备/法术）必须遵守 plugin-authoring 中的 2026-08-06 标准：角色卡一体化（创建/查看/修改一个模块、数据驱动TABS）、背包系统（条目化+装备限制为背包内已有+套组归类+动态价格）、立绘/头像三段流程（独立窗口截取+抠背景色+坐标换算）、职业规则预览、背景加值动态显示+骰子拖动分配、法术按法表+等级动态计算并可视化、标签携带完整法术/物品信息禁止截断。功能深度参考：米蕾薇尔.xlsx 所体现的自动计算链（属性→修正→豁免/技能/AC/攻击汇总“3D6+5/DC”）；**只学习自动化结构与信息完整度，不复制其布局或视觉**。平台自动化程度必须更高，不得退化为手动填表。
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
      const rel = cleanRelativePath(String(args.path || ''));
      const targetPath = path.join(ctx.systemDir, rel);
      const inShared = path.resolve(targetPath).startsWith(path.resolve(SHARED_TOOLS_DIR));
      if (!inShared && !path.resolve(targetPath).startsWith(path.resolve(ctx.systemDir))) return '路径越界，写入拒绝';
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, String(args.content || ''), 'utf8');
      return `已写入 ${rel}（${String(args.content || '').length}字符）`;
    }
    case 'list_files': {
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
      const cmd = String(args.command || '');
      return await execBashTool(cmd, ctx.systemDir, args.timeout);
    }
    case 'todowrite': {
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
      const name = String(args.name || '');
      const text = skillTextByName(name);
      if (text) return text;
      return `未知skill：${name}。可用：agent-guide、rulebook-development、character-system、gameplay-ux、plugin-authoring、gm-protocol、gm-standard`;
    }
    case 'webfetch': {
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
  { type: 'function', function: { name: 'glob', description: '按glob模式找文件（**/*.html、**/法术*），索引无匹配时自动搜文件系统', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'glob模式' }, limit: { type: 'number', description: '最大返回数，默认50' } } } } },
  { type: 'function', function: { name: 'grep', description: '按正则搜文件内容返回匹配行', parameters: { type: 'object', properties: { pattern: { type: 'string', description: '正则' }, path: { type: 'string', description: '限定路径子串' }, include: { type: 'string', description: '限定文件glob' }, limit: { type: 'number', description: '最大匹配数，默认20' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'list_files', description: '列一层目录', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，空=根' } } } } },
  { type: 'function', function: { name: 'list_tree', description: '递归目录树（[D]目录 [F]文件），建结构概览用', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径，空=根' } }, depth: { type: 'number', description: '深度，默认2最大4' }, limit: { type: 'number', description: '条目上限，默认150最大300' } } } },
  { type: 'function', function: { name: 'read_file', description: '读取文件（HTML自动转文本；也支持compressed等非HTML产物），rel可带或不带source/；支持滚动阅读：offset起始位置，返回末尾提示继续的offset', parameters: { type: 'object', properties: { rel: { type: 'string', description: '相对路径' }, maxChars: { type: 'number', description: '最大字符数，默认1500' }, offset: { type: 'number', description: '起始字符位置，默认0' } }, required: ['rel'] } } },
  { type: 'function', function: { name: 'write_file', description: '写文件（插件/笔记/数据/脚本），允许写入Ruler/_shared_tools/', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'bash', description: '执行命令（Windows cmd：无ls/rm/cat/curl；python先write_file写脚本再执行，禁止python -c），超时30秒', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'todowrite', description: '维护任务清单', parameters: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string' } } } } }, required: ['todos'] } } },
  { type: 'function', function: { name: 'get_status', description: '查看解析状态（总页/已排除/已压缩/设置），勿写脚本读文件', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'skill', description: '加载技能文档：agent-guide、rulebook-development、character-system、gameplay-ux、plugin-authoring、gm-protocol、gm-standard。解析任务已预注入默认技能；本工具用于按需重读某项规范。', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
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
      { role: 'system', content: buildAiPromptProfile({ profile: 'rulebook_ingest', system: safeSystem, text: '规则书解析与规则模块自动开发' }) },
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
        messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result) });
        // 进度摘要（轻量compaction用）
        if (tool === 'exclude_file') progressNote += `已排除${ctx.excluded.length}页；`;
        else if (tool === 'write_settings') progressNote += '已写设置；';
        else if (tool === 'compress_to_table') progressNote += '已压缩表格；';
        else if (tool === 'rename_system') progressNote += '已改名；';
      }

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

// 角色立绘资产落盘：Ruler/<系统>/存档/<冒险>/characters/<id>/icon/<文件名>（portrait-4x3 + avatar-1x1-framed）
function saveCharacterIconAsset(system, adventure, id, fileName, dataUrl) {
  const safeSystem = cleanRuleName(system || 'Common');
  const safeAdv = String(adventure || '默认');
  const safeId = String(id || '').replace(/[^a-zA-Z0-9_\-]/g, '_') || 'char';
  const image = decodeDataImage(dataUrl);
  const dir = path.join(characterDir(safeSystem, safeAdv, safeId), 'icon');
  fs.mkdirSync(dir, { recursive: true });
  const fullName = `${fileName}.${image.ext}`;
  const fullPath = path.join(dir, fullName);
  fs.writeFileSync(fullPath, image.buffer);
  return {
    path: fullPath,
    url: `/Ruler/${encodeURIComponent(safeSystem)}/存档/${encodeURIComponent(safeAdv)}/characters/${encodeURIComponent(safeId)}/icon/${encodeURIComponent(fullName)}`
  };
}

// 角色卡立绘资产文件化：data.assets 与 avatarUrl 中的 base64 dataURL → 落盘 PNG → 替换为 /Ruler/... URL；
// 旧路径（assets/characters/...）URL 搬迁到 icon/ 目录；avatar 无框键删除。幂等。
const CHARACTER_ASSET_FILE_NAMES = { portrait: 'portrait-4x3', avatarFramed: 'avatar-1x1-framed' };
function legacyAssetSourcePath(url) {
  try {
    const m = String(url || '').match(/^\/Ruler\/([^/]+)\/assets\/characters\/([^/]+)\/([^/]+)$/);
    if (!m) return null;
    return path.join(RULER_DIR, decodeURIComponent(m[1]), 'assets', 'characters', decodeURIComponent(m[2]), decodeURIComponent(m[3]));
  } catch (e) { return null; }
}
function migrateCharacterAssets(system, adventure, id, character) {
  if (!character || typeof character !== 'object') return false;
  let changed = false;
  const targetDir = path.join(characterDir(system, adventure, id), 'icon');
  const convert = (val, key) => {
    if (typeof val !== 'string' || !val) return val;
    if (/^data:image\//.test(val)) {
      try {
        const saved = saveCharacterIconAsset(system, adventure, id, CHARACTER_ASSET_FILE_NAMES[key] || key, val);
        changed = true;
        console.log(`[角色资产] ${id}/${key}: base64 → ${saved.path}`);
        return saved.url;
      } catch (e) {
        console.error(`[角色资产] ${id}/${key} 迁移失败: ${e.message}`);
        return val;
      }
    }
    const src = legacyAssetSourcePath(val);
    if (!src) return val;
    try {
      const fileName = CHARACTER_ASSET_FILE_NAMES[key] || key;
      const ext = path.extname(src) || '.png';
      const dest = path.join(targetDir, fileName + ext);
      if (fs.existsSync(src)) {
        fs.mkdirSync(targetDir, { recursive: true });
        if (!fs.existsSync(dest)) fs.renameSync(src, dest);
        else if (path.resolve(src) !== path.resolve(dest)) fs.unlinkSync(src);
        changed = true;
        return `/Ruler/${encodeURIComponent(cleanRuleName(system || 'Common'))}/存档/${encodeURIComponent(String(adventure || '默认'))}/characters/${encodeURIComponent(String(id || '').replace(/[^a-zA-Z0-9_\-]/g, '_') || 'char')}/icon/${encodeURIComponent(fileName + ext)}`;
      }
      if (fs.existsSync(dest)) {
        // 源已被本次同角色其他引用搬迁过：直接指向目标
        changed = true;
        return `/Ruler/${encodeURIComponent(cleanRuleName(system || 'Common'))}/存档/${encodeURIComponent(String(adventure || '默认'))}/characters/${encodeURIComponent(String(id || '').replace(/[^a-zA-Z0-9_\-]/g, '_') || 'char')}/icon/${encodeURIComponent(fileName + ext)}`;
      }
    } catch (e) { console.error(`[角色资产] ${id}/${key} 搬迁失败: ${e.message}`); }
    return val;
  };
  if (character.data && character.data.assets && typeof character.data.assets === 'object') {
    for (const key of Object.keys(CHARACTER_ASSET_FILE_NAMES)) {
      if (typeof character.data.assets[key] === 'string') character.data.assets[key] = convert(character.data.assets[key], key);
    }
    if (character.data.assets.avatar !== undefined) {
      delete character.data.assets.avatar;
      changed = true;
    }
    if (Object.keys(character.data.assets).length === 0) character.data.assets = null;
  }
  if (typeof character.avatarUrl === 'string') {
    const old = character.avatarUrl;
    character.avatarUrl = convert(old, 'avatarFramed');
  }
  return changed;
}

// 启动自愈：扫描所有角色存档，把遗留 base64 立绘转文件、旧路径搬迁 icon/（覆盖 AI 直接写文件等非 archive 写入路径）
function migrateAllCharacterAssets() {
  if (!fs.existsSync(RULER_DIR)) return;
  let migrated = 0;
  for (const sysName of fs.readdirSync(RULER_DIR, { withFileTypes: true })) {
    if (!sysName.isDirectory()) continue;
    const advBase = path.join(RULER_DIR, sysName.name, '存档');
    if (!fs.existsSync(advBase)) continue;
    for (const adv of fs.readdirSync(advBase, { withFileTypes: true })) {
      if (!adv.isDirectory()) continue;
      const charsDir = path.join(advBase, adv.name, 'characters');
      if (!fs.existsSync(charsDir)) continue;
      for (const cdir of fs.readdirSync(charsDir, { withFileTypes: true })) {
        if (!cdir.isDirectory()) continue;
        const curFile = path.join(charsDir, cdir.name, 'current.json');
        if (!fs.existsSync(curFile)) continue;
        try {
          const obj = JSON.parse(fs.readFileSync(curFile, 'utf8'));
          if (obj && obj.character && migrateCharacterAssets(sysName.name, adv.name, cdir.name, obj.character)) {
            fs.writeFileSync(curFile, JSON.stringify(obj, null, 2), 'utf8');
            migrated++;
            console.log(`[角色资产] 已迁移存档: ${sysName.name}/${adv.name}/${cdir.name}`);
          }
        } catch (e) { console.error(`[角色资产] 迁移扫描失败 ${cdir.name}: ${e.message}`); }
      }
    }
  }
  if (migrated) console.log(`[角色资产] 本次启动迁移 ${migrated} 个角色卡`);
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
  const { system, adventure, id, images } = req.body || {};
  if (!images || !images.portrait || !images.avatarFramed) {
    return res.status(400).json({ error: '缺少角色图片数据（需要 portrait 与 avatarFramed）' });
  }
  if (!id) {
    return res.status(400).json({ error: '缺少角色 id：新建角色请先创建，再补立绘' });
  }

  try {
    const saved = {
      portrait: saveCharacterIconAsset(system, adventure, id, 'portrait-4x3', images.portrait),
      avatarFramed: saveCharacterIconAsset(system, adventure, id, 'avatar-1x1-framed', images.avatarFramed)
    };

    console.log(`[角色图片] 已保存 ${id} 立绘资产 -> ${path.dirname(saved.portrait.path)}`);
    res.json({ success: true, system: cleanRuleName(system || 'Common'), adventure: String(adventure || '默认'), id, images: saved });
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

  return {
    cleanRuleName, appendRulebookTaskLog, readRulebookTaskStatus, listFilesRecursive, loadRuleSystemSettings, cleanRuleSystemDirForReparse,
    readTextFileSmart, htmlTitle, htmlToMarkdownDocument, stripHtmlToText, globToRegex, execFileAsync, removeTempFile,
    migrateCharacterAssets, migrateAllCharacterAssets, runRulebookIngestAgent, runAgentTool, AGENT_TOOL_PROMPT,
    fixUploadOriginalName, saveRuleSourceFile, saveRuleOriginalFile, buildRulebookIngestPrompt, writeRulebookIngestTask,
    rulebookTaskDir, listExtractedRuleFiles, compactRuleSample, listSharedTools, detectTocCandidates, detectGarbageCandidates
  };
};