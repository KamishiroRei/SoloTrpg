// ── 工具：edit（增量替换） ──
module.exports = {
  name: 'edit',
  definition: { type: 'function', function: { name: 'edit', description: '在文件中替换文本（增量编辑）。oldText必须精确匹配文件内容；找不到时用grep重新定位。path 可为项目外绝对路径。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['system', 'path', 'oldText', 'newText'] } } },
  async execute(args, ctx) {
    const { fs } = ctx.shared;
    if (!fs.existsSync(ctx.target)) return '文件不存在：' + ctx.scope;
    const content = fs.readFileSync(ctx.target, 'utf8');
    const oldText = String(args.oldText || '');
    if (!oldText) return '请提供oldText';
    if (!content.includes(oldText)) return '未找到要替换的文本：' + oldText.substring(0, 50) + '…';
    const count = content.split(oldText).length - 1;
    fs.writeFileSync(ctx.target, content.split(oldText).join(String(args.newText || '')), 'utf8');
    return '已编辑 ' + ctx.scope + '（替换' + count + '处）';
  }
};
