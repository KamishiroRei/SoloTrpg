// ── 工具：todowrite（任务清单） ──
module.exports = {
  name: 'todowrite',
  definition: { type: 'function', function: { name: 'todowrite', description: '维护任务清单（跨轮次跟踪）。复杂任务开工先拆解为todo列表。', parameters: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, status: { type: 'string' } } } } }, required: ['todos'] } } },
  async execute(args, ctx) {
    const { fs, path } = ctx.shared;
    const todos = Array.isArray(args.todos) ? args.todos : [];
    try {
      fs.mkdirSync(path.join(ctx.root, 'data'), { recursive: true });
      fs.writeFileSync(path.join(ctx.root, 'data', 'todo.json'), JSON.stringify({ updatedAt: new Date().toISOString(), todos }, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
    const summary = todos.map(t => `[${t.status || 'pending'}] ${t.content || t}`).join('；');
    return `任务清单已更新（${todos.length}项）：${summary}`;
  }
};
