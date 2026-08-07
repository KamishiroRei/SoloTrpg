// ── 工具：grep（正则搜索） ──
module.exports = {
  name: 'grep',
  definition: { type: 'function', function: { name: 'grep', description: '正则搜索文本返回行号/片段。定位大文件目标函数用（先grep拿行号再read_file精确读），优先于反复read_file。path 可为项目外绝对路径。', parameters: { type: 'object', properties: { system: { type: 'string' }, pattern: { type: 'string', description: 'JavaScript正则' }, path: { type: 'string', description: '可选：限定文件或目录，或项目外绝对路径' } }, required: ['system', 'pattern'] } } },
  async execute(args, ctx) {
    const { fs, path, readTextFileSmart, SKIP_ROOT_DIRS } = ctx.shared;
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
    if (ctx.isAbsScope) {
      const walkAny = (dir, prefix) => {
        if (!fs.existsSync(dir)) return;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          const label = prefix ? prefix + '/' + ent.name : ent.name;
          if (ent.isDirectory()) walkAny(full, label);
          else if (/\.(js|json|md|css|html|txt|bat|ps1|cmd|yml|yaml|png|jpg|jpeg|gif|webp)$/i.test(ent.name)) roots.push({ file: full, label });
        }
      };
      if (fs.existsSync(ctx.target) && fs.statSync(ctx.target).isFile()) pushFile(ctx.target, ctx.rel);
      else walkAny(ctx.target, ctx.rel || '');
    } else if (ctx.isRootScope) {
      const root = path.resolve(ctx.sharedRoot);
      const start = path.resolve(path.join(root, (ctx.rel || '').replace(/^root\//, '')));
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
      if (fs.existsSync(start) && fs.statSync(start).isFile()) pushFile(start, (ctx.rel || '').replace(/^root\//, '') || '.');
      else walkRoot(start, (ctx.rel || '').replace(/^root\//, '') || '');
    } else {
      if (fs.existsSync(ctx.target) && fs.statSync(ctx.target).isFile()) pushFile(ctx.target, ctx.scope);
      else walk(ctx.target, ctx.scope);
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
};
