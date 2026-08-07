// ── 工具：skill（加载技能文档） ──
module.exports = {
  name: 'skill',
  definition: { type: 'function', function: { name: 'skill', description: '加载技能文档：agent-guide、rulebook-development、character-system、gameplay-ux、plugin-authoring、gm-protocol、gm-standard。自动任务会预注入默认技能；本工具用于按需重读某项完整规范。', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  async execute(args, ctx) {
    const text = ctx.skillTextByName(String(args.name || ''));
    if (text) return text;
    return `未知skill：${args.name}。可用：agent-guide、rulebook-development、character-system、gameplay-ux、plugin-authoring、gm-protocol、gm-standard`;
  }
};
