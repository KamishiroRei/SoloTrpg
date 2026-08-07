// ── 系统工具注册器（每个工具独立文件 server/tools/<name>.js，可单独迭代/重建） ──
// 依赖注入 deps = { fs, path, RULER_DIR, SOURCE_ROOT, RUNTIME_ROOT, HOST_PLUGINS_DIR,
//   cleanRuleName, readTextFileSmart, stripHtmlToText, globToRegex, spawn, io,
//   pendingQuestions, appConfig, callAI, skillTextByName, decodeWinOutput }
module.exports = function createSystemTools(deps) {
  const createToolShared = require('../tools/shared');
  const shared = createToolShared(deps);

  const toolModules = [
    require('../tools/glob'),
    require('../tools/list-files'),
    require('../tools/grep'),
    require('../tools/read-file'),
    require('../tools/write-file'),
    require('../tools/edit'),
    require('../tools/bash'),
    require('../tools/todowrite'),
    require('../tools/skill'),
    require('../tools/webfetch'),
    require('../tools/websearch'),
    require('../tools/question'),
    require('../tools/task')
  ];

  const PLUGIN_TOOLS = toolModules.map(t => t.definition);
  const byName = {};
  toolModules.forEach(t => { byName[t.name] = t; });

  async function runPluginTool(tool, args, defaultSystem, ctx) {
    const impl = byName[tool];
    if (!impl) return '未知工具：' + tool;
    const resolved = shared.resolveTarget(tool, args, defaultSystem);
    if (typeof resolved === 'string') return resolved; // 错误消息
    const execCtx = Object.assign({}, ctx, resolved, {
      shared,
      root: resolved.root,
      appConfig: deps.appConfig,
      spawn: deps.spawn,
      decodeWinOutput: deps.decodeWinOutput,
      skillTextByName: deps.skillTextByName,
      stripHtmlToText: deps.stripHtmlToText,
      globToRegex: deps.globToRegex,
      pendingQuestions: deps.pendingQuestions,
      callAI: deps.callAI
    });
    try {
      return await impl.execute(args, execCtx);
    } catch (e) {
      return '工具执行失败: ' + String(e.message || e).substring(0, 300);
    }
  }

  const APP_WHITELIST = ['app/js/plugins.js', 'app/js/ui.js', 'app/index.html', 'app/css/style.css'];

  return { PLUGIN_TOOLS, runPluginTool, APP_WHITELIST };
};
