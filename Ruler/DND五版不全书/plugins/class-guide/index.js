module.exports = {
  register(api) {
    api.addPanel({
      title: '职业升级速查',
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

        // 详情面板内只渲染入口按钮，点击后展开搜索面板（再次点击收起），不常驻、不弹窗
        body.innerHTML =
          '<div style="font-family:sans-serif;line-height:1.6;">' +
          '<style>' +
          '.cl-qk-head{padding:6px 10px;font-size:12px;color:#8b2f23;border-bottom:1px solid #f0e0d8;background:#fdf6f2;font-weight:700}' +
          '.cl-item{display:grid;grid-template-columns:minmax(120px,26%) minmax(150px,32%) 1fr auto;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid #f0e0d8;cursor:pointer;transition:background .15s}' +
          '.cl-item:hover{background:#fdf6f2}' +
          '.cl-item:focus-visible{outline:2px solid #c97b5a;outline-offset:-2px}' +
          '.cl-name{font-weight:700;color:#3a2b25;word-break:break-all;cursor:help;border-bottom:1px dotted #c97b5a}' +
          '.cl-path{font-size:12px;color:#8a7a70;word-break:break-all}' +
          '.cl-sum{font-size:12px;color:#666;word-break:break-all;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
          '.cl-exp{background:#fff;border:1px solid #c97b5a;color:#8b2f23;border-radius:5px;padding:2px 8px;font-size:12px;cursor:pointer}' +
          '.cl-exp:hover{background:#f7ece6}' +
          '.cl-detail{padding:8px 12px;border-top:1px dashed #e2cbb8;background:#fbf7f3;font-size:13px;color:#444;line-height:1.65;word-break:break-word;grid-column:1/-1}' +
          '.cl-detail-label{font-weight:700;color:#8b2f23;margin-bottom:2px}' +
          '.cl-src{margin-top:8px;padding-top:8px;border-top:1px solid #eee;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#666}' +
          '</style>' +
          '<button id="cl-toggle" type="button" aria-expanded="false" style="display:block;width:100%;text-align:left;padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:#f8f9fa;cursor:pointer;font-size:14px;color:#333;">' +
          '<span style="display:inline-block;width:18px;color:#888;">▸</span>职业升级速查' +
          '</button>' +
          '<div id="cl-panel" style="display:none;margin-top:8px;padding:10px;border:1px solid #e2e2e2;border-radius:6px;background:#fff;">' +
          '<div style="margin:0 0 8px;">' +
          '<input id="cl-q" placeholder="输入职业名，如：法师、战士、牧师、游侠" style="width:62%;padding:6px;border:1px solid #ccc;border-radius:4px;"> ' +
          '<button id="cl-btn" type="button" style="padding:6px 14px;border:1px solid #aaa;border-radius:4px;background:#f5f5f5;cursor:pointer;">查询</button>' +
          '</div>' +
          '<div id="cl-status" style="color:#888;font-size:12px;margin:4px 0;"></div>' +
          '<div id="cl-out" style="max-height:300px;overflow:auto;border:1px solid #ddd;border-radius:6px;background:#fff;"></div>' +
          '</div>' +
          '</div>';

        var toggle = body.querySelector('#cl-toggle');
        var panel = body.querySelector('#cl-panel');
        var input = body.querySelector('#cl-q');
        var out = body.querySelector('#cl-out');
        var status = body.querySelector('#cl-status');
        var expanded = false;

        toggle.onclick = function() {
          expanded = !expanded;
          panel.style.display = expanded ? '' : 'none';
          toggle.setAttribute('aria-expanded', String(expanded));
          var arrow = toggle.querySelector('span');
          if (arrow) arrow.textContent = expanded ? '▾' : '▸';
          if (expanded) input.focus();
        };

        function render(hits, q, keywords) {
          if (!hits.length) {
            out.innerHTML = '<div style="padding:10px;color:#999;">未找到与「' + esc(q) + '」相关的职业条目。可尝试输入职业简称（如：圣武士→帕拉丁）。</div>';
            return;
          }
          var maxShow = 100;
          var shown = hits.slice(0, maxShow);
          var kwText = (keywords && keywords.length ? keywords : [q]).join('、');
          // 统一列表：名称 | 来源路径 | 短摘要（全宽行）；点击行新窗口打开源文，📄 展开内联摘要
          var html = '<div class="cl-qk-head">命中 ' + hits.length + ' 条（关键词：' + esc(kwText) + '）</div>';
          html += shown.map(function(it, idx) {
            var t = String(it.title || it.name || '');
            var src = String(it.sourceFile || it.file || it.rel || it.path || it.url || '');
            var snip = String(it.summary || it.content || '');
            if (snip.length > 110) snip = snip.slice(0, 110) + '…';
            return '<div class="cl-item" data-i="' + idx + '" tabindex="0">' +
              '<span class="cl-name" data-term="' + esc(t) + '">' + esc(t) + '</span>' +
              '<span class="cl-path">' + esc(src) + '</span>' +
              '<span class="cl-sum">' + esc(snip) + '</span>' +
              '<button class="cl-exp" data-i="' + idx + '" title="展开/收起源文摘要">📄</button>' +
              '</div>';
          }).join('');
          if (hits.length > maxShow) {
            html += '<div style="padding:6px 10px;color:#999;font-size:12px;">…共 ' + hits.length + ' 条，仅显示前 ' + maxShow + ' 条</div>';
          }
          out.innerHTML = html;

          function toggleExp(el, idx) {
            var det = el.querySelector('.cl-detail');
            if (det) { det.remove(); return; }
            var it = shown[idx];
            det = document.createElement('div');
            det.className = 'cl-detail';
            var sum = String(it.summary || it.content || '');
            det.innerHTML = '<div class="cl-detail-label">条目摘要</div><div>' + esc(sum || '（该条目无摘要文本）') + '</div>';
            el.appendChild(det);
            var src = String(it.sourceFile || it.rel || it.path || it.url || '');
            if (src) {
              api.fetch('/api/rules/source?system=' + encodeURIComponent(api.system) +
                '&file=' + encodeURIComponent(src) + '&offset=0&length=500')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                  if (d && d.text && String(d.text).trim()) {
                    var block = document.createElement('div');
                    block.className = 'cl-src';
                    block.textContent = '── 源文预览（' + src + '）──\n' + String(d.text);
                    det.appendChild(block);
                  }
                })
                .catch(function() { /* 源文件不可读时仅展示索引摘要 */ });
            }
          }

          out.querySelectorAll('.cl-item').forEach(function(el, idx) {
            var it = shown[idx];
            var src = String(it.sourceFile || it.rel || it.path || it.url || '');
            function openItem() {
              if (src && src !== 'rule_tables.md') { api.openRuleFile(src); }
              else { toggleExp(el, idx); }
            }
            el.onclick = function(e) {
              if (e.target && e.target.classList && e.target.classList.contains('cl-exp')) { e.stopPropagation(); toggleExp(el, idx); return; }
              openItem();
            };
            el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(); } };
            var exp = el.querySelector('.cl-exp');
            if (exp) exp.onclick = function(e) { e.stopPropagation(); toggleExp(el, idx); };
          });
          // 词条悬停预览（宿主级 data-term 机制）
          if (api && typeof api.bindTermTips === 'function') api.bindTermTips(out);
        }

        // 别名展开：圣武士 / 帕拉丁 / Paladin 互相映射，并补充精确路径/标题关键词，其余关键词原样返回
        function getAliases(q) {
          var kw = [q];
          var low = q.toLowerCase();
          if (low.indexOf('圣武士') >= 0 || low.indexOf('帕拉丁') >= 0 || low.indexOf('paladin') >= 0) {
            ['圣武士', '帕拉丁', 'Paladin', '角色职业/圣武士', '圣武士.htm', '圣武士法术列表'].forEach(function(a) {
              if (kw.indexOf(a) < 0) kw.push(a);
            });
          }
          return kw;
        }

        // 按 title+rel 合并去重
        function mergeUnique(lists) {
          var seen = {}, out = [];
          lists.forEach(function(list) {
            (list || []).forEach(function(it) {
              var key = String(it.title || it.name || '') + '\u0001' + String(it.sourceFile || '') + '\u0001' + String(it.rel || it.path || it.url || '');
              if (!seen[key]) { seen[key] = 1; out.push(it); }
            });
          });
          return out;
        }

        // 排序：职业核心主页 > 法术列表 > 誓言/子职 > 泛用宗教/地区/背景命中
        function rankItems(items, keywords) {
          var K = keywords || [];
          function all(it) {
            return String(it.title || it.name || '') + '\u0001' +
                   String(it.rel || it.path || it.url || '') + '\u0001' +
                   String(it.sourceFile || '');
          }
          function isProfHome(it) {
            var src = String(it.sourceFile || '');
            var scope = all(it);
            // 1) 核心职业主页：sourceFile 完全等于或包含 玩家手册2024/角色职业/圣武士/圣武士.htm
            if (src.indexOf('玩家手册2024/角色职业/圣武士/圣武士.htm') >= 0) return true;
            // 2) sourceFile 包含 /职业/圣武士 或 角色职业/圣武士/圣武士
            var hasProf = src.indexOf('/职业/圣武士') >= 0 ||
                          src.indexOf('角色职业/圣武士/圣武士') >= 0 ||
                          scope.indexOf('角色职业/圣武士/圣武士') >= 0;
            if (!hasProf) return false;
            // 且不包含 法术列表/魔法/子职/之誓 才算职业主页
            if (scope.indexOf('法术列表') >= 0 || scope.indexOf('魔法') >= 0 ||
                scope.indexOf('子职') >= 0 || scope.indexOf('之誓') >= 0) return false;
            return true;
          }
          function isSpellList(it) {
            return all(it).indexOf('法术列表') >= 0 || all(it).indexOf('魔法') >= 0;
          }
          function isOath(it) {
            return all(it).indexOf('子职') >= 0 || all(it).indexOf('之誓') >= 0;
          }
          function cat(it) {
            var src = String(it.sourceFile || '');
            // 0) 2024核心职业主页最优先：玩家手册2024/角色职业/圣武士/圣武士.htm
            if (src.indexOf('玩家手册2024/角色职业/圣武士/圣武士.htm') >= 0) return -1;
            if (isProfHome(it)) return 0;
            if (isSpellList(it)) return 1;
            if (isOath(it)) return 2;
            return 3; // 泛用宗教/地区/背景命中最后
          }
          return items.slice().sort(function(a, b) {
            var ca = cat(a), cb = cat(b);
            if (ca !== cb) return ca - cb;
            return 0;
          });
        }

        function search() {
          var q = input.value.trim();
          if (!q) { status.textContent = '请输入职业名'; return; }
          var keywords = getAliases(q);
          status.textContent = '正在检索全书索引（' + keywords.length + ' 个关键词）…';
          Promise.all(keywords.map(function(kw) {
            return api.fetch('/api/rules/index?system=' + encodeURIComponent(api.system) +
              '&q=' + encodeURIComponent(kw) + '&limit=120')
              .then(function(r) { return r.json(); })
              .then(function(data) { return extractItems(data); });
          }))
            .then(function(results) {
              var items = mergeUnique(results);
              var hits = items.filter(function(it) {
                var t = String(it.title || it.name || '');
                var src = String(it.sourceFile || '');
                var rel = String(it.rel || it.path || it.url || '');
                var content = String(it.content || it.summary || '');
                var scope = t + ' ' + src + ' ' + rel + ' ' + content;
                var lowScope = scope.toLowerCase();
                var kwHit = keywords.some(function(kw) {
                  return lowScope.indexOf(String(kw).toLowerCase()) >= 0;
                });
                if (!kwHit) return false;
                var titleHit = keywords.some(function(kw) { return t.indexOf(kw) >= 0; });
                return scope.indexOf('职业') >= 0 || scope.indexOf('等级') >= 0 ||
                       scope.indexOf('特性') >= 0 || scope.indexOf('法术') >= 0 ||
                       scope.indexOf('表') >= 0 || titleHit;
              });
              hits = rankItems(hits, keywords);
              status.textContent = '命中 ' + hits.length + ' 条（关键词：' + keywords.join('、') + '）';
              render(hits, q, keywords);
            })
            .catch(function(e) { status.textContent = '加载索引失败：' + e.message; });
        }

        body.querySelector('#cl-btn').onclick = search;
        input.onkeydown = function(e) { if (e.key === 'Enter') search(); };
      }
    });
  }
};
