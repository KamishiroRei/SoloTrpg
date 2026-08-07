// ── 工具：glob（按模式找文件） ──
module.exports = {
  name: 'glob',
  definition: { type: 'function', function: { name: 'glob', description: '按glob模式找文件（如 **/*.js、plugins/**）。用于定位文件路径；想知道目录结构用 list_files。path 可为项目外绝对路径（全工具放行）。', parameters: { type: 'object', properties: { system: { type: 'string', description: '规则系统名/__host__/__app__/__root__' }, pattern: { type: 'string' }, limit: { type: 'number', description: '最大返回数，默认50' } }, required: ['system', 'pattern'] } } },
  async execute(args, ctx) {
    const { fs, path, globToRegex, SKIP_ROOT_DIRS } = ctx.shared;
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
        if (ctx.isRootScope && ent.isDirectory() && SKIP_ROOT_DIRS.includes(ent.name)) continue;
        if (ent.isDirectory()) walk(path.join(dir, ent.name), label);
        else if (re.test(label)) hits.push(label);
      }
    };
    if (fs.existsSync(ctx.target)) {
      if (fs.statSync(ctx.target).isFile()) { if (re.test(ctx.rel)) hits.push(ctx.rel); }
      else walk(ctx.target, ctx.rel || '');
    }
    return hits.length ? `匹配${hits.length}个：\n${hits.slice(0, limit).join('\n')}` : '（无匹配）';
  }
};
