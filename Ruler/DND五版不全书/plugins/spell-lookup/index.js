module.exports = {
  register(api) {
    api.addPanel({
      title: '法术查询',
      render(body, api) {
        var esc = function(s) {
          return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        };
        var extractItems = function(data) {
          if (!data) return [];
          if (Array.isArray(data)) return data;
          if (Array.isArray(data.items)) return data.items;
          if (Array.isArray(data.data)) return data.data;
          if (Array.isArray(data.list)) return data.list;
          return [];
        };
        var SYSTEM = api.system;

        // 详情面板内只渲染入口按钮，点击后展开搜索面板（再次点击收起），不常驻、不弹窗
        body.innerHTML =
          '<div style="font-family:sans-serif;line-height:1.6;">' +
          '<style>' +
          '.sp-qk-head{padding:6px 10px;font-size:12px;color:#8b2f23;border-bottom:1px solid #f0e0d8;background:#fdf6f2;font-weight:700}' +
          '.sp-item{display:grid;grid-template-columns:minmax(120px,26%) minmax(150px,32%) 1fr auto;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid #f0e0d8;cursor:pointer;transition:background .15s}' +
          '.sp-item:hover{background:#fdf6f2}' +
          '.sp-item:focus-visible{outline:2px solid #c97b5a;outline-offset:-2px}' +
          '.sp-name{font-weight:700;color:#3a2b25;word-break:break-all;cursor:help;border-bottom:1px dotted #c97b5a}' +
          '.sp-path{font-size:12px;color:#8a7a70;word-break:break-all}' +
          '.sp-sum{font-size:12px;color:#666;word-break:break-all;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
          '.sp-exp{background:#fff;border:1px solid #c97b5a;color:#8b2f23;border-radius:5px;padding:2px 8px;font-size:12px;cursor:pointer}' +
          '.sp-exp:hover{background:#f7ece6}' +
          '.sp-detail{padding:8px 12px;border-top:1px dashed #e2cbb8;background:#fbf7f3;font-size:13px;color:#444;line-height:1.65;word-break:break-word;grid-column:1/-1}' +
          '.sp-detail-label{font-weight:700;color:#8b2f23;margin-bottom:2px}' +
          '.sp-src{margin-top:8px;padding-top:8px;border-top:1px solid #eee;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#666}' +
          '</style>' +
          '<button id="sp-toggle" type="button" aria-expanded="false" style="display:block;width:100%;text-align:left;padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:#f8f9fa;cursor:pointer;font-size:14px;color:#333;">' +
          '<span style="display:inline-block;width:18px;color:#888;">▸</span>法术查询' +
          '</button>' +
          '<div id="sp-panel" style="display:none;margin-top:8px;padding:10px;border:1px solid #e2e2e2;border-radius:6px;background:#fff;">' +
          '<div style="margin:0 0 8px;">' +
          '<input id="sp-q" placeholder="输入法术名关键词，如：火球、护盾、魔法飞弹、Fireball" style="width:62%;padding:6px;border:1px solid #ccc;border-radius:4px;"> ' +
          '<button id="sp-btn" type="button" style="padding:6px 14px;border:1px solid #aaa;border-radius:4px;background:#f5f5f5;cursor:pointer;">搜索</button>' +
          '</div>' +
          '<div id="sp-status" style="color:#888;font-size:12px;margin:4px 0;"></div>' +
          '<div id="sp-out" style="max-height:430px;overflow:auto;border:1px solid #ddd;border-radius:6px;padding:4px 8px;background:#fafafa;"></div>' +
          '</div>' +
          '</div>';
        var toggle = body.querySelector('#sp-toggle');
        var panel = body.querySelector('#sp-panel');
        var input = body.querySelector('#sp-q');
        var out = body.querySelector('#sp-out');
        var status = body.querySelector('#sp-status');
        var expanded = false;

        toggle.onclick = function() {
          expanded = !expanded;
          panel.style.display = expanded ? '' : 'none';
          toggle.setAttribute('aria-expanded', String(expanded));
          var arrow = toggle.querySelector('span');
          if (arrow) arrow.textContent = expanded ? '▾' : '▸';
          if (expanded) input.focus();
        };

        // ── 别名：常见译名/英文名/简称互相映射（主查询命中少或无结果时自动补查）──
        var ALIAS = {
          '火球术': ['火球', 'Fireball'],
          '火球': ['火球术', 'Fireball'],
          'fireball': ['火球术', '火球'],
          '护盾术': ['护盾', 'Shield'],
          '护盾': ['护盾术', 'Shield'],
          'shield': ['护盾术', '护盾'],
          '魔法飞弹': ['飞弹', 'Magic Missile'],
          '飞弹': ['魔法飞弹', 'Magic Missile'],
          'magic missile': ['魔法飞弹', '飞弹']
        };
        function getAliases(q) {
          var low = String(q).toLowerCase();
          var list = ALIAS[low] || ALIAS[q] || [];
          var out = [q];
          // 通用规则：以“术”结尾的译名自动补查去“术”的简称（如 火球术→火球）
          if (/术$/.test(q) && out.indexOf(q.slice(0, -1)) < 0) list.push(q.slice(0, -1));
          list.forEach(function(a) { if (out.indexOf(a) < 0) out.push(a); });
          return out;
        }

        // 带 q 关键词的后端检索（limit=50，命中由服务端完整索引完成，不本地过滤全量）
        function queryIndex(kw) {
          return api.fetch('/api/rules/index?system=' + encodeURIComponent(SYSTEM) +
            '&q=' + encodeURIComponent(kw) + '&limit=50')
            .then(function(r) { return r.json(); })
            .then(function(data) { return extractItems(data); })
            .catch(function() { return []; });
        }

        // 法术相关性：名称/类别/来源路径/短摘要命中关键词才算（排除正文里偶然出现的无关页面）
        function isSpellHit(it, kw) {
          var t = String(it.title || it.name || '');
          var cat = String(it.category || '');
          var src = String(it.sourceFile || it.rel || it.path || it.url || '');
          var sum = String(it.summary || '');
          var low = String(kw).toLowerCase();
          return t.toLowerCase().indexOf(low) >= 0 ||
            cat.toLowerCase().indexOf(low) >= 0 ||
            src.toLowerCase().indexOf(low) >= 0 ||
            sum.toLowerCase().indexOf(low) >= 0;
        }

        function itemKey(it) {
          return String(it.title || it.name || '') + '\u0001' +
            String(it.category || '') + '\u0001' +
            String(it.sourceFile || it.rel || it.path || it.url || '');
        }
        function mergeUnique(lists) {
          var seen = {}, out = [];
          lists.forEach(function(list) {
            (list || []).forEach(function(it) {
              var key = itemKey(it);
              if (!seen[key]) { seen[key] = 1; out.push(it); }
            });
          });
          return out;
        }

        // 排序：精确名称 > 名称包含 > 类别包含 > 来源路径包含 > 摘要包含
        function rankItems(items, kws) {
          function score(it) {
            var s = 0;
            var t = String(it.title || it.name || '').toLowerCase();
            var cat = String(it.category || '').toLowerCase();
            var src = String(it.sourceFile || it.rel || it.path || it.url || '').toLowerCase();
            var sum = String(it.summary || '').toLowerCase();
            kws.forEach(function(k) {
              k = String(k).toLowerCase();
              if (t === k) s += 100;
              if (t.indexOf(k) >= 0) s += 60;
              if (cat.indexOf(k) >= 0) s += 50;
              if (src.indexOf(k) >= 0) s += 30;
              if (sum.indexOf(k) >= 0) s += 15;
            });
            return s;
          }
          return items.slice().sort(function(a, b) { return score(b) - score(a); });
        }

        // 列表行显示名：压缩表条目用“类别”（即法术名）+ 列表上下文；HTML页用标题
        function displayName(it) {
          var t = String(it.title || it.name || '');
          var cat = String(it.category || '');
          if (String(it.sourceFile || '') === 'rule_tables.md' && cat) return cat;
          return t || cat;
        }
        function displayPath(it) {
          var src = String(it.sourceFile || it.rel || it.path || it.url || '');
          if (String(it.sourceFile || '') === 'rule_tables.md') {
            var ctx = String(it.title || '');
            return ctx ? src + '（' + ctx + '）' : src;
          }
          return src;
        }
        function shortSummary(it) {
          var kws = it.keywords;
          var head = Array.isArray(kws) && kws.length ? kws.join('、') : '';
          var sum = String(it.summary || it.content || '');
          return (head ? head + ' | ' : '') + sum;
        }

        function render(hits, q, kws) {
          var note = (kws && kws.length > 1) ? '（关键词：' + kws.join('、') + '）' : '';
          status.textContent = '命中 ' + hits.length + ' 条' + note;
          if (!hits.length) {
            out.innerHTML = '<div style="padding:12px;color:#999;font-size:13px;">' +
              '未找到与「' + esc(q) + '」相关的法术条目。<br>' +
              '可尝试别名/英文名，如：火球术/Fireball、护盾术/Shield、魔法飞弹/Magic Missile；' +
              '或使用更短关键词（火球、护盾、飞弹、祈唤术等）。</div>';
            return;
          }
          var maxShow = 100;
          var shown = hits.slice(0, maxShow);
          // 统一列表：名称 | 来源路径 | 短摘要（全宽行）；点击行新窗口打开源文，📄 展开内联摘要
          var html = '<div class="sp-qk-head">命中 ' + hits.length + ' 条' + note + '</div>';
          html += shown.map(function(it, idx) {
            var t = displayName(it);
            var src = displayPath(it);
            var snip = shortSummary(it);
            if (snip.length > 110) snip = snip.slice(0, 110) + '…';
            return '<div class="sp-item" data-i="' + idx + '" tabindex="0">' +
              '<span class="sp-name" data-term="' + esc(t) + '">' + esc(t) + '</span>' +
              '<span class="sp-path">' + esc(src) + '</span>' +
              '<span class="sp-sum">' + esc(snip) + '</span>' +
              '<button class="sp-exp" data-i="' + idx + '" title="展开/收起源文摘要">📄</button>' +
              '</div>';
          }).join('');
          if (hits.length > maxShow) {
            html += '<div style="padding:6px 10px;color:#999;font-size:12px;">…共 ' + hits.length + ' 条，仅显示前 ' + maxShow + ' 条</div>';
          }
          out.innerHTML = html;

          function toggleExp(el, idx) {
            var det = el.querySelector('.sp-detail');
            if (det) { det.remove(); return; }
            var it = shown[idx];
            det = document.createElement('div');
            det.className = 'sp-detail';
            var sum = shortSummary(it);
            det.innerHTML = '<div class="sp-detail-label">法术摘要</div><div>' + esc(sum || '（该条目无摘要文本）') + '</div>';
            el.appendChild(det);
            var src = String(it.sourceFile || it.rel || it.path || it.url || '');
            if (src) {
              api.fetch('/api/rules/source?system=' + encodeURIComponent(SYSTEM) +
                '&file=' + encodeURIComponent(src) + '&offset=0&length=500')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                  if (d && d.text && String(d.text).trim()) {
                    var block = document.createElement('div');
                    block.className = 'sp-src';
                    block.textContent = '── 源文预览（' + src + '）──\n' + String(d.text);
                    det.appendChild(block);
                  }
                })
                .catch(function() { /* 源文件不可读时仅展示索引摘要 */ });
            }
          }

          out.querySelectorAll('.sp-item').forEach(function(el, idx) {
            var it = shown[idx];
            var src = String(it.sourceFile || it.rel || it.path || it.url || '');
            function openItem() {
              if (src && src !== 'rule_tables.md') { api.openRuleFile(src); }
              else { toggleExp(el, idx); }
            }
            el.onclick = function(e) {
              if (e.target && e.target.classList && e.target.classList.contains('sp-exp')) { e.stopPropagation(); toggleExp(el, idx); return; }
              openItem();
            };
            el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(); } };
            var exp = el.querySelector('.sp-exp');
            if (exp) exp.onclick = function(e) { e.stopPropagation(); toggleExp(el, idx); };
          });
          // 词条悬停预览（宿主级 data-term 机制）
          if (api && typeof api.bindTermTips === 'function') api.bindTermTips(out);
        }

        function search() {
          var q = input.value.trim();
          if (!q) { status.textContent = '请输入法术名关键词（如：火球术、护盾、魔法飞弹、Fireball）'; return; }
          var kws = getAliases(q);
          status.textContent = '正在检索全书索引…';
          queryIndex(kws[0]).then(function(primary) {
            var strong = primary.filter(function(it) { return isSpellHit(it, kws[0]); });
            if (strong.length >= 3 || kws.length === 1) {
              render(rankItems(strong, kws), q, kws);
              return;
            }
            // 主查询无结果/命中少：自动用别名再查并合并
            status.textContent = '命中较少，正在尝试别名检索（' + kws.slice(1).join('、') + '）…';
            Promise.all(kws.slice(1).map(queryIndex)).then(function(lists) {
              var all = [primary].concat(lists);
              var hits = mergeUnique(all).filter(function(it) {
                return kws.some(function(k) { return isSpellHit(it, k); });
              });
              render(rankItems(hits, kws), q, kws);
            });
          });
        }

        body.querySelector('#sp-btn').onclick = search;
        input.onkeydown = function(e) { if (e.key === 'Enter') search(); };
      }
    });
  }
};
