const path = require('path');
const base = path.resolve(__dirname, '..');
const d = require(path.join(base, 'Ruler', 'DND五版不全书', '_index.json'));
const all = d.entries.filter(e => {
  const s = (e.title + ' ' + (e.category || '') + ' ' + (e.summary || '') + ' ' + (e.content || '') + ' ' + (e.sourceFile || ''));
  return s.includes('火球');
});
console.log('火球 全部命中:', all.length);
all.slice(0, 8).forEach(e => console.log(' -', e.title, '|', e.category, '|', e.sourceFile, '|', String(e.summary || '').slice(0, 50)));
// 检查 玩家手册2024 里的法术文件
const ri = require(path.join(base, 'Ruler', 'DND五版不全书', 'compressed', 'rule_index.json'));
const files = ri.files.filter(f => /法术/.test(f.rel) && /火|Fireball/i.test(f.rel + f.title));
console.log('rule_index 法术页含火:', files.length);
files.slice(0, 5).forEach(f => console.log(' -', f.rel));
