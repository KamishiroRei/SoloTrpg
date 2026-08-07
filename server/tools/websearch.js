// ── 工具：websearch（DuckDuckGo 搜索） ──
module.exports = {
  name: 'websearch',
  definition: { type: 'function', function: { name: 'websearch', description: '联网搜索（DuckDuckGo，无需key）', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  async execute(args, ctx) {
    const query = String(args.query || '');
    if (!query) return '请提供搜索词';
    try {
      const resp = await fetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(15000)
      });
      const html = await resp.text();
      const results = [];
      const linkRe = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const snipRe = /<td class="result-snippet">([\s\S]*?)<\/td>/g;
      const snippets = [];
      let m;
      while ((m = snipRe.exec(html)) && snippets.length < 10) snippets.push(ctx.stripHtmlToText(m[1]).trim());
      let i = 0;
      while ((m = linkRe.exec(html)) && i < 8) {
        const title = ctx.stripHtmlToText(m[2]).trim();
        if (!title) continue;
        results.push(`${i + 1}. ${title}\n   ${m[1]}\n   ${snippets[i] || ''}`.substring(0, 400));
        i++;
      }
      return results.length ? `搜索结果（DuckDuckGo）：\n${results.join('\n\n')}` : '无搜索结果';
    } catch (e) {
      return '搜索失败: ' + String(e.message || e).substring(0, 300);
    }
  }
};
