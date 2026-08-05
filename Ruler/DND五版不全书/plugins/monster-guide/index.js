module.exports = {
  register(api) {
    api.addPanel({
      title: '怪物速查',
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
          '.mo-qk-head{padding:6px 10px;font-size:12px;color:#8b2f23;border-bottom:1px solid #f0e0d8;background:#fdf6f2;font-weight:700}' +
          '.mo-item{display:grid;grid-template-columns:minmax(120px,26%) minmax(150px,32%) 1fr auto;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid #f0e0d8;cursor:pointer;transition:background .15s}' +
          '.mo-item:hover{background:#fdf6f2}' +
          '.mo-item:focus-visible{outline:2px solid #c97b5a;outline-offset:-2px}' +
          '.mo-name{font-weight:700;color:#3a2b25;word-break:break-all;cursor:help;border-bottom:1px dotted #c97b5a}' +
          '.mo-path{font-size:12px;color:#8a7a70;word-break:break-all}' +
          '.mo-sum{font-size:12px;color:#666;word-break:break-all;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
          '.mo-exp{background:#fff;border:1px solid #c97b5a;color:#8b2f23;border-radius:5px;padding:2px 8px;font-size:12px;cursor:pointer}' +
          '.mo-exp:hover{background:#f7ece6}' +
          '.mo-detail{padding:8px 12px;border-top:1px dashed #e2cbb8;background:#fbf7f3;font-size:13px;color:#444;line-height:1.65;word-break:break-word;grid-column:1/-1}' +
          '.mo-detail-label{font-weight:700;color:#8b2f23;margin-bottom:2px}' +
          '.mo-src{margin-top:8px;padding-top:8px;border-top:1px solid #eee;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#666}' +
          '</style>' +
          '<button id="mo-toggle" type="button" aria-expanded="false" style="display:block;width:100%;text-align:left;padding:8px 10px;border:1px solid #ddd;border-radius:6px;background:#f8f9fa;cursor:pointer;font-size:14px;color:#333;">' +
          '<span style="display:inline-block;width:18px;color:#888;">▸</span>怪物速查' +
          '</button>' +
          '<div id="mo-panel" style="display:none;margin-top:8px;padding:10px;border:1px solid #e2e2e2;border-radius:6px;background:#fff;">' +
          '<div style="margin:0 0 8px;">' +
          '<input id="mo-q" placeholder="输入怪物名或类型，如：龙、僵尸、眼魔、骷髅（支持英文 Dragon/Zombie/Beholder/Skeleton）" style="width:62%;padding:6px;border:1px solid #ccc;border-radius:4px;"> ' +
          '<button id="mo-btn" type="button" style="padding:6px 14px;border:1px solid #aaa;border-radius:4px;background:#f5f5f5;cursor:pointer;">搜索</button>' +
          '</div>' +
          '<div id="mo-status" style="color:#888;font-size:12px;margin:4px 0;"></div>' +
          '<div id="mo-out" style="max-height:430px;overflow:auto;border:1px solid #ddd;border-radius:6px;background:#fff;"></div>' +
          '</div>' +
          '</div>';

        var toggle = body.querySelector('#mo-toggle');
        var panel = body.querySelector('#mo-panel');
        var input = body.querySelector('#mo-q');
        var out = body.querySelector('#mo-out');
        var status = body.querySelector('#mo-status');
        var expanded = false;

        toggle.onclick = function() {
          expanded = !expanded;
          panel.style.display = expanded ? '' : 'none';
          toggle.setAttribute('aria-expanded', String(expanded));
          var arrow = toggle.querySelector('span');
          if (arrow) arrow.textContent = expanded ? '▾' : '▸';
          if (expanded) input.focus();
        };

        // ── 别名组：常见译名/英文名/简称互相映射（主查询命中少或无结果时自动补查合并去重）──
        var ALIAS_GROUPS = [
          { keys: ['龙', 'dragon', '幼龙'], kws: ['龙', '龙类', '巨龙', 'Dragon', '幼龙'] },
          { keys: ['僵尸', 'zombie', '丧尸'], kws: ['僵尸', '丧尸', 'Zombie'] },
          { keys: ['眼魔', 'beholder', '夺心魔', 'mind flayer'], kws: ['眼魔', '夺心魔', 'Beholder', 'Mind Flayer'] },
          { keys: ['骷髅', 'skeleton', '骸骨'], kws: ['骷髅', '骸骨', 'Skeleton'] }
        ];
        function getAliases(q) {
          var low = String(q).toLowerCase().trim();
          for (var i = 0; i < ALIAS_GROUPS.length; i++) {
            var g = ALIAS_GROUPS[i];
            for (var j = 0; j < g.keys.length; j++) {
              if (low === g.keys[j].toLowerCase()) {
                var out = [q];
                g.kws.forEach(function(k) { if (out.indexOf(k) < 0) out.push(k); });
                return out;
              }
            }
          }
          return [q];
        }

        // 带 q 关键词的后端检索（limit=50，命中由服务端完整索引完成，不本地过滤全量）
        function queryIndex(kw) {
          return api.fetch('/api/rules/index?system=' + encodeURIComponent(SYSTEM) +
            '&q=' + encodeURIComponent(kw) + '&limit=50')
            .then(function(r) { return r.json(); })
            .then(function(data) { return extractItems(data); })
            .catch(function() { return []; });
        }

        // 怪物域判定：来源路径/类别属于怪物书或怪物类目录
        var MONSTER_MARK = ['怪物', '生物', '图鉴', '亡灵', '不死', '丧尸', '怪兽', '盟友与敌人', '第九章', '鸦阁'];
        function isMonster(it) {
          var src = String(it.sourceFile || it.rel || it.path || it.url || '');
          var cat = String(it.category || '');
          var scope = src + ' ' + cat;
          for (var i = 0; i < MONSTER_MARK.length; i++) {
            if (scope.indexOf(MONSTER_MARK[i]) >= 0) return true;
          }
          return false;
        }

        // 关键词相关性：名称/类别/来源路径/短摘要命中关键词才算（排除正文里偶然出现的无关页面）
        function isHit(it, kw) {
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

        // 怪物书权重：核心怪物书加分更高，让"怪物图鉴"等权威来源排前。
        // 按书名（category 或路径首段）精确判断，避免子串误伤（如"费资本的巨龙宝库/怪物图鉴/"）。
        function monsterBonus(it) {
          var src = String(it.sourceFile || it.rel || it.path || it.url || '');
          var cat = String(it.category || '');
          var top = cat || String(src.split('/')[0] || '');
          if (top === '怪物图鉴' || top === '怪物图鉴2025') return 40;
          if (top === '多元宇宙的怪物' || top === '瓦罗怪物指南') return 30;
          if (top === '费资本的巨龙宝库' || top === '魔邓肯的众敌卷册' ||
              top === '荒洲探险家指南' || top === '范·里希腾的鸦阁魔域指南') return 20;
          return 8; // 已通过 isMonster 过滤，均为怪物页
        }

        // 相关性排序：精确名称 > 名称包含 > 类别 > 来源路径 > 摘要，另加怪物书权重。
        // 主词（用户输入）匹配全权重，别名匹配减半，避免别名书名词（如"巨龙宝库"）系统性霸榜。
        function rankItems(items, kws) {
          var primaryLow = String(kws[0] || '').toLowerCase();
          function score(it) {
            var s = 0;
            var t = String(it.title || it.name || '').toLowerCase();
            var cat = String(it.category || '').toLowerCase();
            var src = String(it.sourceFile || it.rel || it.path || it.url || '').toLowerCase();
            var sum = String(it.summary || '').toLowerCase();
            kws.forEach(function(k, ki) {
              k = String(k).toLowerCase();
              if (!k) return;
              var w = (ki === 0 && k === primaryLow) ? 1 : 0.5;
              if (t === k) s += 120 * w;
              if (t.indexOf(k) >= 0) s += 80 * w;
              if (cat.indexOf(k) >= 0) s += 20 * w;
              if (src.indexOf(k) >= 0) s += 30 * w;
              if (sum.indexOf(k) >= 0) s += 15 * w;
            });
            s += monsterBonus(it);
            return s;
          }
          return items.slice().sort(function(a, b) { return score(b) - score(a); });
        }

        // 列表行显示名与路径
        function displayName(it) {
          return String(it.title || it.name || it.category || '');
        }
        function displayPath(it) {
          return String(it.sourceFile || it.rel || it.path || it.url || '');
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
              '未找到与「' + esc(q) + '」相关的怪物条目。<br>' +
              (kws && kws.length > 1 ? '已尝试别名/英文名：' + esc(kws.join('、')) + '。<br>' : '') +
              '可尝试常见译名或英文名：龙/Dragon、僵尸/Zombie、眼魔/Beholder（夺心魔）、骷髅/Skeleton；' +
              '或使用更短关键词（如：龙、尸、魔、骨）。</div>';
            return;
          }
          var maxShow = 100;
          var shown = hits.slice(0, maxShow);
          // 统一列表：名称 | 来源路径 | 短摘要（全宽行）；点击行新窗口打开源文，📄 展开内联摘要
          var html = '<div class="mo-qk-head">命中 ' + hits.length + ' 条' +
            (kws && kws.length > 1 ? '（关键词：' + esc(kws.join('、')) + '）' : '') + '</div>';
          html += shown.map(function(it, idx) {
            var t = displayName(it);
            var src = displayPath(it);
            var snip = shortSummary(it);
            if (snip.length > 110) snip = snip.slice(0, 110) + '…';
            return '<div class="mo-item" data-i="' + idx + '" tabindex="0">' +
              '<span class="mo-name" data-term="' + esc(t) + '">' + esc(t) + '</span>' +
              '<span class="mo-path">' + esc(src) + '</span>' +
              '<span class="mo-sum">' + esc(snip) + '</span>' +
              '<button class="mo-exp" data-i="' + idx + '" title="展开/收起源文摘要">📄</button>' +
              '</div>';
          }).join('');
          if (hits.length > maxShow) {
            html += '<div style="padding:6px 10px;color:#999;font-size:12px;">…共 ' + hits.length + ' 条，仅显示前 ' + maxShow + ' 条</div>';
          }
          out.innerHTML = html;

          function toggleExp(el, idx) {
            var det = el.querySelector('.mo-detail');
            if (det) { det.remove(); return; }
            var it = shown[idx];
            det = document.createElement('div');
            det.className = 'mo-detail';
            var sum = shortSummary(it);
            det.innerHTML = '<div class="mo-detail-label">怪物摘要</div><div>' + esc(sum || '（该条目无摘要文本）') + '</div>';
            el.appendChild(det);
            var src = String(it.sourceFile || it.rel || it.path || it.url || '');
            if (src) {
              api.fetch('/api/rules/source?system=' + encodeURIComponent(SYSTEM) +
                '&file=' + encodeURIComponent(src) + '&offset=0&length=500')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                  if (d && d.text && String(d.text).trim()) {
                    var block = document.createElement('div');
                    block.className = 'mo-src';
                    block.textContent = '── 源文预览（' + src + '）──\n' + String(d.text);
                    det.appendChild(block);
                  }
                })
                .catch(function() { /* 源文件不可读时仅展示索引摘要 */ });
            }
          }

          out.querySelectorAll('.mo-item').forEach(function(el, idx) {
            var it = shown[idx];
            var src = String(it.sourceFile || it.rel || it.path || it.url || '');
            function openItem() {
              if (src && src !== 'rule_tables.md') { api.openRuleFile(src); }
              else { toggleExp(el, idx); }
            }
            el.onclick = function(e) {
              if (e.target && e.target.classList && e.target.classList.contains('mo-exp')) { e.stopPropagation(); toggleExp(el, idx); return; }
              openItem();
            };
            el.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(); } };
            var exp = el.querySelector('.mo-exp');
            if (exp) exp.onclick = function(e) { e.stopPropagation(); toggleExp(el, idx); };
          });
          // 词条悬停预览（宿主级 data-term 机制）
          if (api && typeof api.bindTermTips === 'function') api.bindTermTips(out);
        }

        function search() {
          var q = input.value.trim();
          if (!q) { status.textContent = '请输入怪物名关键词（如：龙、僵尸、眼魔、骷髅，支持英文 Dragon/Zombie/Beholder/Skeleton）'; return; }
          var kws = getAliases(q);
          status.textContent = '正在检索全书怪物索引…';
          // 1) 主查询
          queryIndex(kws[0]).then(function(primary) {
            var strong = primary.filter(function(it) { return isMonster(it) && isHit(it, kws[0]); });
            // 2) 域内命中足够且无别名可补查 → 直接渲染
            if (strong.length >= 3 && kws.length === 1) {
              render(strong, q, kws);
              return;
            }
            // 3) 命中少或无结果（或存在别名组）：并行补查别名并合并去重
            if (kws.length > 1) {
              status.textContent = '正在用别名检索（' + kws.slice(1).join('、') + '）…';
            }
            Promise.all(kws.slice(1).map(queryIndex)).then(function(lists) {
              var all = [primary].concat(lists);
              var hits = mergeUnique(all).filter(function(it) {
                if (!isMonster(it)) return false;
                return kws.some(function(k) { return isHit(it, k); });
              });
              hits = rankItems(hits, kws);
              render(hits, q, kws);
            });
          });
        }

        body.querySelector('#mo-btn').onclick = search;
        input.onkeydown = function(e) { if (e.key === 'Enter') search(); };
      }
    });
  }
};
