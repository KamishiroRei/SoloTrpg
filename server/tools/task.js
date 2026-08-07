// ── 工具：task（派发子任务给独立子 Agent） ──
module.exports = {
  name: 'task',
  definition: { type: 'function', function: { name: 'task', description: '派发子任务给独立子Agent执行并返回结果', parameters: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] } } },
  async execute(args, ctx) {
    const description = String(args.description || '');
    if (!description) return '请提供子任务描述';
    if (!ctx.provider || !ctx.model) return '（当前环境无法派发子任务）';
    try {
      const subResult = await ctx.callAI(ctx.provider.endpoint, ctx.provider.apiKey, ctx.model, [
        { role: 'system', content: '你是TrpgRecode的子任务Agent。独立完成描述的任务并返回结果，简洁直接，不要多余寒暄。' },
        { role: 'user', content: description }
      ], { reasoningEffort: ctx.appConfig.ai.reasoningEffort || 'high', timeoutMs: 90000, signal: ctx.signal });
      return '子任务结果：\n' + String(subResult.content || '');
    } catch (e) {
      return '子任务失败: ' + String(e.message || '').substring(0, 300);
    }
  }
};
