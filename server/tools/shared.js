// ── 系统工具共享层（路径解析/公共常量） ──
// 依赖注入 deps = { fs, path, RULER_DIR, SOURCE_ROOT, RUNTIME_ROOT, HOST_PLUGINS_DIR, cleanRuleName, readTextFileSmart }
module.exports = function createToolShared(deps) {
  const { fs, path, RULER_DIR, SOURCE_ROOT, RUNTIME_ROOT, HOST_PLUGINS_DIR, cleanRuleName, readTextFileSmart } = deps;

  const READONLY_TOOLS = ['read_file', 'grep', 'glob', 'list_files', 'list_tree', 'get_status', 'webfetch', 'websearch', 'skill'];
  const SKIP_ROOT_DIRS = ['node_modules', '.git', 'data', 'Logs', 'AI任务'];

  // 解析工具目标路径：返回 { target, scope, isRootScope, isAbsScope } 或错误字符串
  function resolveTarget(tool, args, defaultSystem) {
    const sys = cleanRuleName(String(args.system || defaultSystem || ''));
    let rel = String(args.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if ((tool === 'read_file' || tool === 'edit' || tool === 'grep') && /current\.js$/i.test(rel)) {
      return '角色卡存档文件是 current.json（不是 current.js）。请改用 current.json 读取。';
    }
    let target, scope;
    let isRootScope = false;
    let isAbsScope = false;
    const absPathMatch = rel.match(/^([A-Za-z]:\/|\\\\)/);
    if (absPathMatch) {
      target = path.resolve(rel);
      scope = rel;
      isAbsScope = true;
    } else if (rel.startsWith('_host_plugins/') || sys === '__host__') {
      const hostRoot = path.resolve(HOST_PLUGINS_DIR);
      target = path.resolve(path.join(hostRoot, rel.replace(/^_host_plugins\//, '')));
      if (!target.startsWith(hostRoot)) return '路径越界：仅允许操作 _host_plugins/ 目录内文件';
      scope = '_host_plugins/' + rel.replace(/^_host_plugins\//, '');
    } else if (rel.startsWith('app/') || sys === '__app__') {
      const appRoot = path.resolve(path.join(SOURCE_ROOT, 'app'));
      target = path.resolve(path.join(appRoot, rel.replace(/^app\//, '')));
      if (!target.startsWith(appRoot)) return '路径越界：仅允许操作 app/ 目录内文件';
      scope = rel;
    } else if (rel.startsWith('root/') || sys === '__root__') {
      const root = path.resolve(RUNTIME_ROOT);
      target = path.resolve(path.join(root, rel.replace(/^root\//, '')));
      if (!target.startsWith(root)) return '路径越界：仅允许操作软件根目录内文件';
      scope = rel.replace(/^root\//, '') || '.';
      isRootScope = true;
    } else {
      if (!sys) return '未指定规则系统（system 参数为空）';
      let effectiveSys = sys;
      let systemRoot = path.resolve(path.join(RULER_DIR, effectiveSys));
      const fallbackSys = cleanRuleName(String(defaultSystem || ''));
      if (!fs.existsSync(systemRoot) && fallbackSys && fallbackSys !== effectiveSys) {
        effectiveSys = fallbackSys;
        systemRoot = path.resolve(path.join(RULER_DIR, effectiveSys));
      }
      target = path.resolve(path.join(systemRoot, rel));
      if (!target.startsWith(systemRoot)) return '路径越界：仅允许操作当前规则系统目录内文件';
      const relForWrite = path.relative(systemRoot, target).replace(/\\/g, '/');
      if (!READONLY_TOOLS.includes(tool) && /^(source|original)(\/|$)/i.test(relForWrite)) {
        return '写入拒绝：source/ 与 original/ 是原始资料目录，请把整理结果写入 compressed/、plugins/、modules/、tasks/ 或 ui/。';
      }
      scope = `${effectiveSys}/${relForWrite || '.'}`;
    }
    return { target, scope, isRootScope, isAbsScope, rel, root: RUNTIME_ROOT };
  }

  return { fs, path, READONLY_TOOLS, SKIP_ROOT_DIRS, resolveTarget, readTextFileSmart };
};
