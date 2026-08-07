// ── 工具：question（向用户提问） ──
module.exports = {
  name: 'question',
  definition: { type: 'function', function: { name: 'question', description: '向用户提问并等待回答（需求矛盾/无法执行时用，禁止盲目执行）', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  async execute(args, ctx) {
    const text = String(args.text || '');
    if (!text) return '请提供问题内容';
    if (!ctx.emit) return '（当前环境无法推送问题）';
    const id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const answer = await new Promise((resolve) => {
      const timer = setTimeout(() => { ctx.pendingQuestions.delete(id); resolve('（用户未在120秒内回答）'); }, 120000);
      ctx.pendingQuestions.set(id, { resolve, timer });
      ctx.emit({ type: 'question', id, text });
    });
    return `用户回答：${answer}`;
  }
};
