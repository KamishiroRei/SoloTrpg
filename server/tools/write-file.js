// ── 工具：write_file（写入/覆盖文件） ──
module.exports = {
  name: 'write_file',
  definition: { type: 'function', function: { name: 'write_file', description: '写入/覆盖文件（可新建）。路径相对对应scope根（system=__root__时=项目根）；path 为绝对路径时可写项目外任意位置。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, required: ['system', 'path', 'content'] } } },
  async execute(args, ctx) {
    const { fs, path } = ctx.shared;
    fs.mkdirSync(path.dirname(ctx.target), { recursive: true });
    fs.writeFileSync(ctx.target, String(args.content || ''), 'utf8');
    return '已写入 ' + ctx.scope + '（' + String(args.content || '').length + '字符）';
  }
};
