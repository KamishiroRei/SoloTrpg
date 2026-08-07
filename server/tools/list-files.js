// ── 工具：list_files（列目录） ──
module.exports = {
  name: 'list_files',
  definition: { type: 'function', function: { name: 'list_files', description: '列出目录内容（显示文件数，比bash省token）。path空=根目录。path 可为项目外绝对路径。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string', description: '相对目录，空=根；或项目外绝对路径' } }, required: ['system'] } } },
  async execute(args, ctx) {
    const { fs, path, SKIP_ROOT_DIRS } = ctx.shared;
    if (ctx.isAbsScope) {
      if (!fs.existsSync(ctx.target)) return '目录不存在：' + ctx.rel;
      return fs.readdirSync(ctx.target, { withFileTypes: true })
        .map(e => (e.isDirectory() ? e.name + '/' : e.name)).join('\n') || '（空目录）';
    }
    if (ctx.isRootScope) {
      const root = path.resolve(ctx.sharedRoot);
      const dir = path.resolve(path.join(root, (ctx.rel || '').replace(/^root\//, '')));
      if (!dir.startsWith(root)) return '路径越界';
      if (!fs.existsSync(dir)) return '目录不存在：' + (ctx.rel || '.');
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !(e.isDirectory() && SKIP_ROOT_DIRS.includes(e.name)))
        .map(e => (e.isDirectory() ? e.name + '/' : `${e.name} (${fs.statSync(path.join(dir, e.name)).size}B)`))
        .join('\n') || '（空目录）';
    }
    if (!fs.existsSync(ctx.target)) return '目录不存在：' + (ctx.rel || '.');
    if (fs.statSync(ctx.target).isFile()) return '这是文件：' + ctx.scope;
    return fs.readdirSync(ctx.target, { withFileTypes: true })
      .map(e => (e.isDirectory() ? e.name + '/' : `${e.name} (${fs.statSync(path.join(ctx.target, e.name)).size}B)`))
      .join('\n') || '（空目录）';
  }
};
