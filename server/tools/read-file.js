// ── 工具：read_file（读取文件） ──
module.exports = {
  name: 'read_file',
  definition: { type: 'function', function: { name: 'read_file', description: '读取文件。参数自判：full=true全量（≤60K文件首选）；line=<行号>+lines=<行数>按行读；offset+limit按字符；不传参数中小文件直接返回完整内容、大文件返回规模提示。大文件(>60K)禁止顺序扫读：先grep定位行号再读±50行。path 可为项目外绝对路径。', parameters: { type: 'object', properties: { system: { type: 'string' }, path: { type: 'string' }, full: { type: 'boolean', description: 'true=全量' }, line: { type: 'number', description: '起始行号' }, lines: { type: 'number', description: '行数，缺省读到尾' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['system', 'path'] } } },
  async execute(args, ctx) {
    const { fs, readTextFileSmart } = ctx.shared;
    if (!fs.existsSync(ctx.target)) return '文件不存在：' + ctx.scope;
    if (fs.statSync(ctx.target).isDirectory()) return '这是目录，请用 list_files 查看：' + ctx.scope;
    const full = readTextFileSmart(ctx.target);
    const allLines = full.split(/\r?\n/);
    const total = full.length;
    const wantFull = args.full === true || String(args.full) === 'true';
    const hasLine = args.line != null;
    const hasOffset = args.offset != null;
    if (wantFull || (!hasLine && !hasOffset && full.length <= 30000)) {
      return `${ctx.scope}（全量：${allLines.length}行 / ${total}字符）：\n${full}`;
    }
    if (!hasLine && !hasOffset) {
      return `${ctx.scope} 是大文件（${allLines.length}行 / ${total}字符）。读取方式：full=true 全量读取；line=<起始行> [lines=<行数>，不传则读到文件尾]；或 offset=<字符位置> [limit=<字符数>，不传则读到文件尾]。请自行判断读取量。`;
    }
    if (hasLine) {
      const startLine = Math.max(1, parseInt(args.line) || 1);
      const count = args.lines != null ? Math.max(1, parseInt(args.lines) || 1) : (allLines.length - startLine + 1);
      const endLine = Math.min(allLines.length, startLine + count - 1);
      const out = [];
      for (let i = startLine; i <= endLine; i++) out.push(`${i}: ${allLines[i - 1]}`);
      return `${ctx.scope}（共${allLines.length}行，本次显示 ${startLine}-${endLine}）：\n${out.join('\n')}${endLine < allLines.length ? `\n……（继续读取请用 line=${endLine + 1}）` : ''}`;
    }
    const offset = Math.max(0, parseInt(args.offset) || 0);
    const limit = args.limit != null ? Math.max(1, parseInt(args.limit) || 1) : (total - offset);
    const part = full.substring(offset, offset + limit);
    const end = Math.min(offset + limit, total);
    const more = end < total;
    return `${ctx.scope}（共${allLines.length}行 / ${total}字符，本次显示 ${offset}-${end}）：\n${part}${more ? `\n……（已显示 ${offset}-${end}/${total}，继续读取请用 offset=${end}）` : ''}`;
  }
};
