// ── 工具：webfetch（抓取网页） ──
module.exports = {
  name: 'webfetch',
  definition: { type: 'function', function: { name: 'webfetch', description: '抓取网页内容（转文本）', parameters: { type: 'object', properties: { url: { type: 'string' }, maxChars: { type: 'number', description: '缺省=完整返回' } }, required: ['url'] } } },
  async execute(args, ctx) {
    const url = String(args.url || '');
    if (!/^https?:\/\//i.test(url)) return '请提供有效URL（http/https）';
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TrpgRecode/1.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!resp.ok) return `抓取失败 HTTP ${resp.status}`;
      const ct = String(resp.headers.get('content-type') || '');
      let text = '';
      if (/html|xml/i.test(ct)) text = ctx.stripHtmlToText(await resp.text());
      else text = await resp.text();
      const maxChars = parseInt(args.maxChars) || 0;
      return `URL: ${url}\n内容:\n${text.replace(/\s{3,}/g, ' ').substring(0, maxChars)}`;
    } catch (e) {
      return '抓取失败: ' + String(e.message || e).substring(0, 300);
    }
  }
};
