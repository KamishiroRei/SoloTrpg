// ── GM 带团工具（玩家频道 AI 工具集 + 轮次协议；从 server.js 拆分） ──
// 依赖注入 deps = { fs, path, RULER_DIR, cleanRuleName, loadAdventureMeta, listFilesRecursive, callAI }
// 通用框架原则：gm_search/gm_get_state/gm_update/gm_media 是宿主通用原语；
// 具体规则书功能（反应/借机等）由 AI 用行为数据（data.behavior）建立，本模块不感知规则书概念。
const { pdfToTxt } = require('./pdf-extract');
module.exports = function createGmTools(deps) {
  const { fs, path, RULER_DIR, cleanRuleName, loadAdventureMeta, listFilesRecursive, callAI } = deps;

  const GM_TOOLS = [
    { type: 'function', function: { name: 'gm_search', description: '搜索当前规则系统与活动模组的资料（模组拆解资料/索引、规则压缩数据），返回相关片段。带团需要查剧本细节、NPC、怪物、遭遇、地点、物品、线索或规则条目时调用；不要凭记忆编造，也不要为此中断剧情去问玩家。', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词（中英文/别名均可）' }, scope: { type: 'string', enum: ['module', 'rule', 'all'], description: 'module=模组资料，rule=规则书，all=全部（默认）' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'gm_get_state', description: '读取当前世界与角色的真实游戏状态（角色名/HP/AC/状态/数据键/活动模组等）。需要精确数值、修改前或修改后核对时调用，不要凭注入摘要猜测。', parameters: { type: 'object', properties: { character: { type: 'string', description: '可选：只读取该角色；缺省返回全部角色摘要' } } } } },
    { type: 'function', function: { name: 'gm_update', description: '批量事务更新世界状态：一次调用可包含多条修改（updates 数组），全部应用后统一返回每条结果。修改前先 gm_get_state 读取当前值；所有修改一次性并行发出（同一轮内），不要分多次调用。updates 条目：{object, ...}，object 三类：①character（角色卡）：character/path/op（replace|delta|insert|remove）/value；②token（地图标记，按 name 匹配）：op=add（name/gridX/gridY/kind/hp/maxHp/ac/color/icon/avatarUrl/conditions/owner/data）、move（gridX,gridY 绝对 或 dx,dy 相对）、remove、update（hp/maxHp/ac/displayName/color/icon/avatarUrl/owner/conditions/data）；③map（地图）：op=switch（value=地图名，切换活动地图）、bg（value=背景图路径或 module:前缀）。兼容旧单条格式（character/path/op/value 视为一条 character 更新）。角色卡 data.bio 是结构化对象（键：appearance 外貌/personality 性格/ideals 理想/bonds 牵绊/flaws 缺陷/backstory 背景故事），写入设定时整体 replace 为该结构对象，不要写纯字符串。', parameters: { type: 'object', properties: { updates: { type: 'array', description: '批量修改列表，每条 {object, op, ...}；一次全部发完' }, character: { type: 'string', description: '旧格式：角色名' }, path: { type: 'string', description: '旧格式：数据路径（data.xxx / hp / conditions 等）' }, op: { type: 'string', description: '旧格式：replace|delta|insert|remove' }, value: { description: '旧格式：op 需要的值' } } } } },
    { type: 'function', function: { name: 'gm_media', description: '查询模组场景图/立绘/插图路径与角色立绘资产，用于过场 CG（<illustration>）、地图背景（[[map:bg:]]）与 AVG 立绘。', parameters: { type: 'object', properties: { scene: { type: 'string', description: '场景/地点名或图片关键词（可留空返回全部可用媒体）' } }, required: ['scene'] } } },
    { type: 'function', function: { name: 'gm_list_files', description: '列出目录内容（文件带大小，目录标[目录]；recursive=1 时最多递归 4 层）。定位外部资料/设定集/剧情文档的结构后，再用 gm_read_file 读取。', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录绝对路径' }, recursive: { type: 'number', description: '1=递归列出，缺省只列当前层' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'gm_read_file', description: '读取本地文件（绝对路径，含项目外资料/设定集/剧情文档）。token 策略（自动执行，按此最优）：能一次读完就一次读完（5 万字符预算内，后续轮次命中缓存最省）；内容超预算时，尽量在同一轮内并行调用多段读取（start 按偏移递增），避免跨轮分段（跨轮会额外消耗轮次）。path 为目录时返回条目清单；目录 + all=1 时一次读取目录内全部文本文件（递归，预算 5 万字符，超出部分跳过并在末尾列出路径，可再按路径逐个补读）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件或目录的绝对路径' }, all: { type: 'number', description: '仅目录时有效：1=一次性读取目录内全部文本文件' }, keyword: { type: 'string', description: '可选：只取部分时用，在文件内定位该关键词返回命中行（第 N 行 + 行内容前 300 字符）' }, start: { type: 'number', description: '可选：只取部分/分段时用，字符偏移起点（默认 0）' }, length: { type: 'number', description: '可选：只取部分/分段时用，读取字符数（默认 5 万一段）' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'gm_note', description: '管理冒险笔记（纯文本记忆，AI 与 GM 共用，落盘长期有效）：list 列出全部笔记；read 读取一篇（name；长笔记用 start/length 分段）；save 新建/覆盖（name, content）；delete 删除。带团中需要记录剧情进展、关键决策、无法规则化的设定文本、NPC 记忆时调用。', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'read', 'save', 'delete'], description: '操作：list/read/save/delete' }, name: { type: 'string', description: '笔记名（read/save/delete 用）' }, content: { type: 'string', description: '笔记正文（save 用）' }, start: { type: 'number', description: 'read 分段起点（可选）' }, length: { type: 'number', description: 'read 分段长度（可选）' } }, required: ['action'] } } },
    { type: 'function', function: { name: 'gm_write_file', description: '写入本地文件（写权限仅限 Ruler/<系统>/ 内；母本 original/ 与解析源 source/ 禁止覆盖；项目外文件只读，用 gm_read_file）。把产物落盘为文件时使用（如压缩表写入 compressed/、界面写入 ui/、文本写入存档）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径（Ruler/<系统>/ 内绝对路径或相对路径）' }, content: { type: 'string', description: '文件内容' } }, required: ['path', 'content'] } } }
  ];

  function safeRead(file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
  }

  function gmFormatHits(hits, query) {
    if (!hits.length) return `未找到「${query}」相关资料。可换关键词、别名或缩小范围（scope=module 只搜模组，scope=rule 只搜规则）。`;
    return hits.map(h => `【${h.type === 'module' ? '模组' : h.type === 'rule' ? '规则' : '索引'}】${h.file}\n` + h.lines.join('\n')).join('\n\n');
  }

  function gmSearch(ctx, query, scope) {
    const kw = String(query || '').trim().toLowerCase();
    if (!kw) return '请提供搜索关键词';
    const sysDir = path.join(RULER_DIR, cleanRuleName(String(ctx.system || '')));
    const hits = [];
    const limit = 6;
    const scopeAll = !scope || scope === 'all';
    if ((scope === 'module' || scopeAll) && fs.existsSync(path.join(sysDir, 'modules'))) {
      for (const mod of fs.readdirSync(path.join(sysDir, 'modules'))) {
        const dataDir = path.join(sysDir, 'modules', mod, '资料');
        if (fs.existsSync(dataDir)) {
          for (const f of listFilesRecursive(dataDir).filter(f => /\.(md|json|txt)$/i.test(f))) {
            const lines = String(safeRead(path.join(dataDir, f))).split('\n');
            const hitLines = lines.filter(l => l.toLowerCase().includes(kw)).slice(0, 3);
            if (hitLines.length) {
              hits.push({ type: 'module', file: `modules/${mod}/资料/${f.replace(/\\/g, '/')}`, lines: hitLines.map(l => l.trim().substring(0, 200)) });
              if (hits.length >= limit) return gmFormatHits(hits, query);
            }
          }
        }
        const idxFile = path.join(sysDir, 'modules', mod, '.trpg', 'index.json');
        if (fs.existsSync(idxFile)) {
          const raw = safeRead(idxFile);
          const i = raw.toLowerCase().indexOf(kw);
          if (i >= 0) {
            hits.push({ type: 'module', file: `modules/${mod}/.trpg/index.json`, lines: [raw.substring(Math.max(0, i - 100), Math.min(raw.length, i + 250)).replace(/\s+/g, ' ').trim()] });
            if (hits.length >= limit) return gmFormatHits(hits, query);
          }
        }
      }
    }
    if ((scope === 'rule' || scopeAll) && fs.existsSync(path.join(sysDir, 'compressed'))) {
      for (const f of ['rule_index.json', 'rule_tables.md', 'rule_settings.json']) {
        const fp = path.join(sysDir, 'compressed', f);
        if (!fs.existsSync(fp)) continue;
        const text = safeRead(fp);
        const i = text.toLowerCase().indexOf(kw);
        if (i >= 0) {
          hits.push({ type: 'rule', file: `compressed/${f}`, lines: [text.substring(Math.max(0, i - 100), Math.min(text.length, i + 250)).replace(/\s+/g, ' ').trim()] });
          if (hits.length >= limit) return gmFormatHits(hits, query);
        }
      }
    }
    return gmFormatHits(hits, query);
  }

  function gmGetState(ctx, character) {
    const sys = cleanRuleName(String(ctx.system || ''));
    const adv = String(ctx.adventure || '默认');
    const meta = loadAdventureMeta(sys, adv);
    const lines = [`冒险: ${adv}`, `活动模组: ${Array.isArray(meta.activeModules) && meta.activeModules.length ? meta.activeModules.join('、') : '无'}`];
    const charsDir = path.join(RULER_DIR, sys, '存档', adv, 'characters');
    if (fs.existsSync(charsDir)) {
      for (const cdir of fs.readdirSync(charsDir, { withFileTypes: true })) {
        if (!cdir.isDirectory()) continue;
        const curFile = path.join(charsDir, cdir.name, 'current.json');
        if (!fs.existsSync(curFile)) continue;
        try {
          const obj = JSON.parse(safeRead(curFile));
          const c = obj.character || {};
          const nm = c.displayName || c.name || cdir.name;
          if (character && nm !== character && String(c.name) !== character) continue;
          const d = c.data || {};
          const hp = d.HP || {};
          lines.push(`${nm}: HP ${hp.current !== undefined ? hp.current + '/' + hp.max : '?'} | AC ${d.AC !== undefined ? d.AC : '?'} | 状态 ${(Array.isArray(d.conditions) ? d.conditions : []).join(',') || '无'} | 分类 ${c.category || '未分类'} | 数据键 ${Object.keys(d).join(',')}`);
        } catch (e) {}
      }
    }
    if (character) {
      const hit = lines.find(l => l.startsWith(character + ':') || (lines.indexOf(l) > 0 && l.includes(character)));
      if (!hit) lines.push(`未找到角色「${character}」。可用角色：` + lines.slice(2).map(l => l.split(':')[0]).join('、'));
    }
    // 世界状态：地图/token/位置/背景
    const world = loadWorldState(ctx);
    if (world && Array.isArray(world.maps)) {
      const activeId = world.activeMapId;
      lines.push('── 地图 ──');
      world.maps.forEach(m => {
        const active = m.id === activeId ? ' [当前]' : '';
        const bg = (m.settings && m.settings.backgroundSrc) || '无';
        lines.push(`地图「${m.name || m.id}」${active} 背景:${bg}`);
        (Array.isArray(m.tokens) ? m.tokens : []).forEach(t => {
          const hpTxt = t.maxHp ? `HP ${t.hp}/${t.maxHp}` : 'HP ?';
          lines.push(`  token「${t.displayName || t.name}」(${t.gridX},${t.gridY}) ${hpTxt}${t.ac !== undefined ? ' AC ' + t.ac : ''} 状态:${(t.conditions || []).join(',') || '无'}${t.owner ? ' 归属:' + t.owner : ''}`);
        });
      });
    }
    return lines.join('\n');
  }

  // ── 世界状态（world-state.json：地图/token/位置/背景）──
  function worldStatePath(ctx) {
    return path.join(RULER_DIR, cleanRuleName(String(ctx.system || '')), '存档', String(ctx.adventure || '默认'), 'world-state.json');
  }
  function loadWorldState(ctx) {
    const f = worldStatePath(ctx);
    try {
      if (!fs.existsSync(f)) return null;
      const raw = JSON.parse(safeRead(f));
      return (raw && raw.state) || null;
    } catch (e) { return null; }
  }
  function saveWorldState(ctx, state) {
    try {
      const f = worldStatePath(ctx);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ _rev: Date.now(), savedAt: new Date().toISOString(), state }, null, 1), 'utf8');
      return true;
    } catch (e) { return false; }
  }

  // 单条角色卡更新（原 gm_update 逻辑）
  function applyCharacterUpdate(ctx, args) {
    const sys = cleanRuleName(String(ctx.system || ''));
    const adv = String(ctx.adventure || '默认');
    const character = String(args.character || '').trim();
    const pathKey = String(args.path || '').trim();
    const op = String(args.op || '').trim();
    if (!character || !pathKey || !['replace', 'delta', 'insert', 'remove'].includes(op)) return '参数错误：需要 character/path/op（replace|delta|insert|remove），value 按 op 需要';
    const charsDir = path.join(RULER_DIR, sys, '存档', adv, 'characters');
    if (!fs.existsSync(charsDir)) return '没有可操作的角色存档';
    let targetDir = null, targetObj = null, targetFile = null;
    for (const cdir of fs.readdirSync(charsDir, { withFileTypes: true })) {
      if (!cdir.isDirectory()) continue;
      const curFile = path.join(charsDir, cdir.name, 'current.json');
      if (!fs.existsSync(curFile)) continue;
      try {
        const obj = JSON.parse(safeRead(curFile));
        const c = obj.character || {};
        if (String(c.displayName || c.name || '') === character) { targetDir = path.join(charsDir, cdir.name); targetObj = obj; targetFile = curFile; break; }
      } catch (e) {}
    }
    if (!targetObj) return `未找到角色「${character}」。先用 gm_get_state 查看准确角色名。`;
    const c = targetObj.character;
    const d = c.data || {};
    const segs = pathKey.split('.');
    let root = d;
    if (segs[0] === 'data') segs.shift();
    else if (['hp', 'maxHp', 'ac', 'category', 'conditions'].includes(segs[0])) root = c;
    if (!segs.length || !segs[0]) return `path 无效：${pathKey}`;
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      if (cur[segs[i]] === undefined || cur[segs[i]] === null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
      cur = cur[segs[i]];
    }
    const key = segs[segs.length - 1];
    const oldVal = cur[key];
    if (op === 'remove') delete cur[key];
    else if (op === 'replace') cur[key] = args.value;
    else if (op === 'delta') {
      const v = Number(args.value);
      if (!Number.isFinite(v)) return `delta 需要数值 value，收到: ${JSON.stringify(args.value)}`;
      if (typeof oldVal === 'number') cur[key] = oldVal + v;
      else if (oldVal === undefined || oldVal === null) cur[key] = v;
      else return `无法对非数值字段做 delta（当前值: ${JSON.stringify(oldVal)}），可用 replace`;
    }
    else if (op === 'insert') {
      if (!Array.isArray(cur[key])) {
        if (cur[key] === undefined) cur[key] = [];
        else return `字段不是数组（当前值: ${JSON.stringify(oldVal)}），可用 replace`;
      }
      cur[key].push(args.value);
    }
    if (d.HP && typeof d.HP.current === 'number' && typeof d.HP.max === 'number') { c.hp = d.HP.current; c.maxHp = d.HP.max; }
    if (d.AC !== undefined) c.ac = d.AC;
    if (Array.isArray(d.conditions)) c.conditions = d.conditions;
    try {
      const vDir = path.join(targetDir, 'versions');
      fs.mkdirSync(vDir, { recursive: true });
      fs.writeFileSync(path.join(vDir, Date.now() + '.json'), JSON.stringify(targetObj, null, 2));
      fs.writeFileSync(targetFile, JSON.stringify(targetObj, null, 2));
    } catch (e) { return `数据已修改但保存失败: ${e.message}`; }
    return `已更新 ${character}.${pathKey}（${op}）: ${JSON.stringify(oldVal)} → ${JSON.stringify(cur[key])}；已保存并保留 GM 版本备份。`;
  }

  // 世界对象（token/map）更新：作用于 world-state.json，前端 2s 轮询自动同步
  function applyWorldUpdate(ctx, u, world) {
    const object = String(u.object || '');
    const op = String(u.op || '');
    if (object === 'token') {
      if (!world || !Array.isArray(world.maps)) return '世界状态不可用（尚无地图存档）。请让前端先保存一次地图状态。';
      const name = String(u.name || u.character || '').trim();
      if (!name && op !== 'add') return 'token 操作需要 name（按角色名/标记名或 id 匹配）';
      const findToken = () => {
        for (const m of world.maps) {
          const list = Array.isArray(m.tokens) ? m.tokens : (m.tokens = []);
          const hit = list.find(t => (t.displayName || t.name) === name || t.id === name || (name && ((t.name || '').indexOf(name) >= 0 || (t.displayName || '').indexOf(name) >= 0)));
          if (hit) return { map: m, token: hit };
        }
        return null;
      };
      if (op === 'add') {
        if (!name) return 'add 需要 name';
        const map = world.maps.find(m => m.id === world.activeMapId) || world.maps[0];
        if (!map) return '没有地图可添加 token';
        const token = {
          id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          kind: u.kind || 'character', name, displayName: name,
          color: u.color || '#4ecdc4', icon: u.icon || '●',
          gridX: Number(u.gridX) || 0, gridY: Number(u.gridY) || 0,
          size: Number(u.size) || 1, shape: u.shape || 'circle', avatarUrl: u.avatarUrl || '',
          hp: u.hp, maxHp: u.maxHp, ac: u.ac,
          conditions: Array.isArray(u.conditions) ? u.conditions : [],
          owner: u.owner || null, data: u.data || {}
        };
        map.tokens = map.tokens || [];
        map.tokens.push(token);
        world._changed = true;
        return `已添加 token「${name}」到地图「${map.name || map.id}」(${token.gridX},${token.gridY})`;
      }
      const hit = findToken();
      if (!hit) return `未找到 token「${name}」。先用 gm_get_state 查看地图上的实际 token 名。`;
      if (op === 'move') {
        const nx = u.gridX !== undefined ? Number(u.gridX) : (hit.token.gridX + (Number(u.dx) || 0));
        const ny = u.gridY !== undefined ? Number(u.gridY) : (hit.token.gridY + (Number(u.dy) || 0));
        hit.token.gridX = nx; hit.token.gridY = ny;
        world._changed = true;
        return `已移动「${name}」→ (${nx},${ny})`;
      }
      if (op === 'remove') {
        hit.map.tokens = (hit.map.tokens || []).filter(t => t !== hit.token);
        world._changed = true;
        return `已移除 token「${name}」`;
      }
      if (op === 'update') {
        ['hp', 'maxHp', 'ac', 'displayName', 'color', 'icon', 'size', 'shape', 'avatarUrl', 'owner'].forEach(k => { if (u[k] !== undefined) hit.token[k] = u[k]; });
        if (u.conditions !== undefined) hit.token.conditions = Array.isArray(u.conditions) ? u.conditions : [];
        if (u.data !== undefined) hit.token.data = u.data;
        world._changed = true;
        return `已更新 token「${name}」`;
      }
      return 'token 操作支持：add / move(gridX,gridY 绝对 或 dx,dy 相对) / remove / update';
    }
    if (object === 'map') {
      if (!world || !Array.isArray(world.maps)) return '世界状态不可用（尚无地图存档）。';
      if (op === 'switch') {
        const map = world.maps.find(m => m.id === String(u.value || '') || m.name === String(u.value || ''));
        if (!map) return `未找到地图「${u.value}」。可用地图：` + world.maps.map(m => m.name).join('、');
        world.activeMapId = map.id;
        world._changed = true;
        return `已切换活动地图：${map.name}`;
      }
      if (op === 'bg') {
        const map = world.maps.find(m => m.id === world.activeMapId) || world.maps[0];
        map.settings = map.settings || {};
        map.settings.backgroundSrc = String(u.value || '');
        world._changed = true;
        return `已设置地图「${map.name || map.id}」背景：${u.value}`;
      }
      return 'map 操作支持：switch(切换活动地图，value=地图名/id) / bg(设置背景图，value=路径或 module:前缀)';
    }
    return `未知 object：${object}（支持 character/token/map）`;
  }

  // 批量事务更新：AI 一次性传出全部修改（角色卡/地图/token 位置/背景），全部应用后统一返回每条结果
  function gmUpdate(ctx, args) {
    const updates = Array.isArray(args.updates) && args.updates.length ? args.updates : null;
    const items = updates || [{ object: 'character', character: args.character, path: args.path, op: args.op, value: args.value }];
    const results = [];
    let world = null;
    for (const u of items) {
      const object = String(u.object || 'character');
      try {
        if (object === 'character') results.push(applyCharacterUpdate(ctx, u));
        else if (object === 'token' || object === 'map') {
          if (!world) world = loadWorldState(ctx);
          results.push(applyWorldUpdate(ctx, u, world));
        } else results.push(`未知 object：${object}`);
      } catch (e) { results.push(`更新失败: ${e.message}`); }
    }
    if (world && world._changed) {
      delete world._changed;
      saveWorldState(ctx, world);
    }
    return '批量更新结果（' + items.length + ' 条）：\n' + results.join('\n');
  }

  function gmMedia(ctx, scene) {
    const sys = cleanRuleName(String(ctx.system || ''));
    const kw = String(scene || '').trim().toLowerCase();
    const hits = [];
    const modulesDir = path.join(RULER_DIR, sys, 'modules');
    if (fs.existsSync(modulesDir)) {
      for (const mod of fs.readdirSync(modulesDir)) {
        const idxFile = path.join(modulesDir, mod, '.trpg', 'index.json');
        if (fs.existsSync(idxFile)) {
          try {
            const idx = JSON.parse(safeRead(idxFile));
            const media = idx.media || (idx.index && idx.index.media) || [];
            const list = Array.isArray(media) ? media : (Array.isArray(media.items) ? media.items : []);
            for (const m of list) {
              const p = m.path || m.src || m.file || '';
              const label = `${m.name || m.title || ''} ${p} ${m.用途 || m.purpose || ''} ${m.适用场景 || ''}`;
              if (!kw || label.toLowerCase().includes(kw)) hits.push(`module:${mod}/assets/${String(p).replace(/^assets\//, '')}（${label.trim().substring(0, 120)}）`);
            }
          } catch (e) {}
        }
        if (hits.length < 10) {
          const assetsDir = path.join(modulesDir, mod, 'assets');
          if (fs.existsSync(assetsDir)) {
            for (const f of listFilesRecursive(assetsDir).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f))) {
              const fn = path.basename(f).toLowerCase();
              if (!kw || fn.includes(kw)) hits.push(`module:${mod}/assets/${f.replace(/\\/g, '/')}`);
            }
          }
        }
      }
    }
    return hits.length
      ? '可用媒体（module: 前缀可直接用于 <illustration src="module:..."> 或 [[map:bg:module:...]]）：\n' + hits.slice(0, 12).join('\n')
      : (kw ? `未找到与「${scene}」相关的媒体，可查模组 .trpg/index.json 的 media 索引。` : '当前没有可用媒体。');
  }

  // 路径不存在时给出相近候选（用户路径常差一字/一层，直接帮 AI 定位）
  function nearestDirHint(requested) {
    try {
      const target = path.basename(String(requested || '')).trim();
      const parent = path.dirname(String(requested || ''));
      if (!target || !fs.existsSync(parent)) return '';
      const dirs = fs.readdirSync(parent, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
      if (!dirs.length) return '';
      const similar = dirs.filter(d => d.includes(target) || target.includes(d) || (target.length > 1 && d.length > 1 && (d.indexOf(target.slice(0, 2)) >= 0 || target.indexOf(d.slice(0, 2)) >= 0)));
      if (similar.length) return '。相近目录：' + similar.slice(0, 6).join('、');
      return '。该父目录下可用目录：' + dirs.slice(0, 8).join('、');
    } catch (e) { return ''; }
  }

  // 自然语言路径拆解：'XX里的设定集' → ['XX', '设定集']（里/中/下/内/的 是介词与修饰连接，不是目录名成分）
  function splitNaturalSeg(seg) {
    return String(seg).split(/[的里中下内]/).filter(s => s.trim().length > 0);
  }

  // 智能路径解析：原路径存在直接用；不存在时逐级回退到最近存在的父目录，
  // 再把缺失片段按介词拆解后逐级下探匹配（目录/文件条目），返回候选绝对路径
  function smartResolve(requested) {
    const abs = path.resolve(String(requested || '').trim());
    if (!abs) return null;
    if (fs.existsSync(abs)) return { found: abs };
    const missing = [];
    let cur = abs;
    let ok = false;
    while (true) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      missing.unshift(path.basename(cur));
      cur = parent;
      if (fs.existsSync(cur)) { ok = true; break; }
    }
    if (!ok) return null;
    const result = { parent: cur, candidates: [], reason: '' };
    const segs = [];
    missing.forEach(seg => { const subs = splitNaturalSeg(seg); (subs.length ? subs : [seg]).forEach(s => segs.push(s)); });
    let pool = [cur];
    let hitAny = false;
    for (const sub of segs) {
      if (sub.length > 30) continue;
      const nextPool = [];
      for (const dir of pool) {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
        for (const e of entries) {
          if (e.name.includes(sub) || sub.includes(e.name) || (sub.length >= 2 && e.name.includes(sub.substring(0, 2)))) {
            hitAny = true;
            const full = path.join(dir, e.name);
            if (e.isDirectory() && nextPool.length < 6) nextPool.push(full);
            else if (result.candidates.length < 6) result.candidates.push(full);
          }
        }
      }
      if (nextPool.length) pool = nextPool;
      else break;
    }
    if (hitAny) pool.forEach(p => { if (result.candidates.length < 6) result.candidates.push(p); });
    result.candidates = [...new Set(result.candidates)];
    if (!result.candidates.length) result.reason = nearestDirHint(requested);
    return result;
  }

  // 工具统一入口：返回 { abs, smart }；abs 为原始解析路径，smart 非空表示原路径不存在
  function resolvePath(p) {
    const abs = path.resolve(String(p || '').trim());
    if (!abs) return { abs: '', smart: null };
    if (fs.existsSync(abs)) return { abs, smart: null };
    return { abs, smart: smartResolve(abs) };
  }

  // 智能解析命中候选时：自动用首个候选继续，并附解析说明（不打断 AI 流程）
  function smartFallback(smart) {
    if (!smart || !smart.candidates || !smart.candidates.length) return null;
    const hit = smart.candidates[0];
    return {
      abs: hit,
      note: '（原路径不存在，已按自然语言拆解解析为相近路径：' + hit + (smart.candidates.length > 1 ? '；其他候选：' + smart.candidates.slice(1).join('、') : '') + '）'
    };
  }

  function gmListFiles(ctx, dirPath, recursive) {
    const p = String(dirPath || '').trim();
    if (!p) return '参数错误：需要 path（目录绝对路径）';
    const r = resolvePath(p);
    if (r.smart) {
      const fb = smartFallback(r.smart);
      if (fb) {
        const list = listDir(fb.abs, recursive === 1);
        return list.err
          ? '读取失败: ' + list.err
          : list.text + '\n' + fb.note;
      }
      return '路径不存在: ' + p + (r.smart.reason || '。可先用 gm_list_files 查看父目录「' + r.smart.parent + '」' + (r.smart.candidates.length ? '，相近候选：' + r.smart.candidates.join('、') : ''));
    }
    const list = listDir(r.abs, recursive === 1);
    if (list.err) return '读取失败: ' + list.err + nearestDirHint(p);
    return list.text;
  }

  // 目录清单核心（供 gm_list_files 与路径容错复用）
  function listDir(abs, recursive) {
    try {
      const stat = fs.statSync(abs);
      if (!stat.isDirectory()) return { err: '该路径不是目录，请改用 gm_read_file 读取文件' };
      const max = 120;
      const items = [];
      const walk = (dir, depth) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            items.push('[目录] ' + full);
            if (recursive && depth < 4) walk(full, depth + 1);
          } else {
            let size = '';
            try { size = fs.statSync(full).size + 'B'; } catch (e2) {}
            items.push('       ' + full + '  (' + size + ')');
          }
        }
      };
      walk(abs, 0);
      const shown = items.slice(0, max);
      return { text: '目录清单（共 ' + items.length + ' 项，显示前 ' + max + '）：\n' + shown.join('\n') + (items.length > max ? '\n…（可加 recursive=1 递归列出子目录）' : '') };
    } catch (e) { return { err: e.message }; }
  }

  const TEXT_EXTS = ['.md', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts', '.xml', '.csv', '.ini', '.log'];
  function gmReadDirAll(ctx, dirPath) {
    const r = resolvePath(dirPath);
    if (r.smart) {
      const fb = smartFallback(r.smart);
      if (fb) {
        const out = readDirAllText(fb.abs);
        return out.err ? '读取失败: ' + out.err : out.text + '\n' + fb.note;
      }
      return '路径不存在: ' + dirPath + (r.smart.reason || '。相近候选：' + r.smart.candidates.join('、'));
    }
    const out = readDirAllText(r.abs);
    return out.err ? '读取失败: ' + out.err : out.text;
  }

  function readDirAllText(abs) {
    try {
      const MAX_TOTAL = 50000; // 单次目录全读预算 5 万字符（约4万 token），超出列出路径由 AI 决定补读
      const files = [];
      const walk = (dir, depth) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { if (depth < 6) walk(full, depth + 1); }
          else if (TEXT_EXTS.some(x => e.name.toLowerCase().endsWith(x))) files.push(full);
        }
      };
      walk(abs, 0);
      files.sort();
      const parts = [];
      let used = 0, skipped = [];
      for (const f of files) {
        let text = '';
        try {
          const st = fs.statSync(f);
          if (st.size > 1024 * 1024) { skipped.push(f); continue; }
          text = fs.readFileSync(f, 'utf8');
        } catch (e) { skipped.push(f); continue; }
        const head = `\n===== 文件: ${path.relative(abs, f)} =====\n`;
        if (used + head.length + text.length > MAX_TOTAL) { skipped.push(f); continue; }
        parts.push(head + text);
        used += head.length + text.length;
      }
      if (!parts.length) return { text: '目录内没有可读文本文件。' };
      let tail = '';
      if (skipped.length) {
        const rel = skipped.map(f => path.relative(abs, f));
        tail = `\n…[${skipped.length} 个文件未包含（预算 ${MAX_TOTAL} 字符已满或单文件过大）：\n` + rel.join('\n') +
          `\n如确实需要这些内容，请按路径逐个 gm_read_file 补读（每次 5 万字符预算）]`;
      }
      return { text: `目录内全部文本文件（共 ${files.length} 个，已读 ${parts.length} 个，总计 ${used} 字符）：\n` + parts.join('\n') + tail };
    } catch (e) { return { err: e.message }; }
  }

  // PDF 读取：提取文本 + 导出同名 txt，按 keyword/start/length 作用于提取文本
  function readPdfFile(abs, args) {
    let r;
    try { r = pdfToTxt(abs); } catch (e) { return 'PDF 读取失败: ' + e.message; }
    const text = r.text;
    const total = text.length;
    const CHUNK = 50000;
    const kw = String(args.keyword || '').trim();
    const note = `[PDF 文本已提取并导出：${r.txtPath}${r.cached ? '（复用已有导出）' : ''}，后续请直接读该 txt 分段/keyword 最省]`;
    if (kw) {
      const lines = text.split('\n');
      const hits = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(kw.toLowerCase())) {
          hits.push(`第${i + 1}行: ` + lines[i].trim().substring(0, 300));
          if (hits.length >= 20) break;
        }
      }
      return hits.length
        ? `「${kw}」命中 ${hits.length} 处（PDF 提取文本共 ${total} 字符，${lines.length} 行）：\n` + hits.join('\n') + `\n[可再用 start/length 精读命中行附近片段] ` + note
        : `PDF 文本内未找到「${kw}」。[共 ${total} 字符，可换关键词，或 start/length 分段浏览] ` + note;
    }
    const start = Math.max(0, parseInt(args.start) || 0);
    const length = parseInt(args.length) || 0;
    if (length > 0) {
      const content = text.substring(start, start + length);
      const end = start + length;
      return (start > 0 ? `[已从第 ${start} 字符读取] ` : '') + content + (end < total ? `\n…[共 ${total} 字符，已读到 ${end}。继续请用 start=${end}&length=${length}]` : '\n[已读完]') + ' ' + note;
    }
    if (total <= CHUNK) return text + '\n' + note;
    const content = text.substring(start, start + CHUNK);
    return (start > 0 ? `[已从第 ${start} 字符读取] ` : '') + content +
      `\n…[共 ${total} 字符，已显示 ${CHUNK}。全量请 start=${CHUNK} 起连续读取；或直接用导出的 txt 读取] ` + note;
  }

  function gmReadFile(ctx, args) {
    const p = String(args.path || '').trim();
    if (!p) return '参数错误：需要 path（文件或目录的绝对路径）';
    const r = resolvePath(p);
    if (r.smart) {
      const fb = smartFallback(r.smart);
      if (fb) {
        const out = readFileAbs(fb.abs, args);
        if (out.err) return '读取失败: ' + out.err + nearestDirHint(p);
        return out.text + '\n' + fb.note;
      }
      return '路径不存在: ' + p + (r.smart.reason || '。相近候选：' + r.smart.candidates.join('、'));
    }
    const out = readFileAbs(r.abs, args);
    if (out.err) return '读取失败: ' + out.err + nearestDirHint(p);
    return out.text;
  }

  // 文件读取核心（含 PDF 分支；供 gm_read_file 与路径容错复用）
  function readFileAbs(abs, args) {
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        if (args.all === 1) return { text: gmReadDirAll(null, abs) };
        return { text: gmListFiles(null, abs, args.recursive) };
      }
      if (/\.pdf$/i.test(abs)) return { text: readPdfFile(abs, args) };
      if (stat.size > 5 * 1024 * 1024) return { err: `文件过大（${stat.size} 字节），请先 gm_list_files 定位子文件，或用 keyword 定位片段。` };
      const text = fs.readFileSync(abs, 'utf8');
      const total = text.length;
      const CHUNK = 50000; // 单次读取/工具结果上限 5 万字符（≈4 万 token）：128k 窗口内安全，且覆盖绝大多数设定文件；更大文件用 keyword/分段
      const kw = String(args.keyword || '').trim();
      if (kw) {
        const lines = text.split('\n');
        const hits = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(kw.toLowerCase())) {
            hits.push(`第${i + 1}行: ` + lines[i].trim().substring(0, 300));
            if (hits.length >= 20) break;
          }
        }
        return { text: hits.length
          ? `「${kw}」命中 ${hits.length} 处（文件共 ${total} 字符，${lines.length} 行）：\n` + hits.join('\n') + `\n[可再用 start/length 精读命中行附近片段]`
          : `文件内未找到「${kw}」。[文件共 ${total} 字符，可换关键词，或 start/length 分段浏览]` };
      }
      const start = Math.max(0, parseInt(args.start) || 0);
      const length = parseInt(args.length) || 0;
      if (length > 0) {
        const content = text.substring(start, start + length);
        const end = start + length;
        return { text: (start > 0 ? `[已从第 ${start} 字符读取] ` : '') + content + (end < total ? `\n…[共 ${total} 字符，已读到 ${end}。继续请用 start=${end}&length=${length}]` : '\n[已读完]') };
      }
      if (total <= CHUNK) return { text };
      const content = text.substring(start, start + CHUNK);
      return { text: (start > 0 ? `[已从第 ${start} 字符读取] ` : '') + content +
        `\n…[文件共 ${total} 字符，已显示 ${CHUNK}。全量请 start=${CHUNK} 起连续读取；只取部分请用 keyword 定位或 start/length 指定]` };
    } catch (e) { return { err: e.message }; }
  }

  // 冒险笔记：list/read/save/delete（存 Ruler/<系统>/存档/<冒险>/notes/，纯文本记忆）
  function gmNote(ctx, args) {
    const sys = cleanRuleName(String(ctx.system || ''));
    const adv = String(ctx.adventure || '默认');
    const dir = path.join(RULER_DIR, sys, '存档', adv, 'notes');
    const action = String(args.action || 'list');
    const name = String(args.name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\.{2,}/g, '.').slice(0, 80);
    try {
      if (action === 'list') {
        if (!fs.existsSync(dir)) return '当前冒险还没有笔记。';
        const notes = fs.readdirSync(dir).filter(f => /\.(md|txt)$/i.test(f)).sort();
        return notes.length ? '冒险笔记（' + notes.length + ' 篇）：\n' + notes.map((f, i) => (i + 1) + '. ' + f.replace(/\.(md|txt)$/i, '')).join('\n') : '当前冒险还没有笔记。';
      }
      if (!name) return '参数错误：需要 name（笔记名）';
      let fname = name;
      if (!/\.(md|txt)$/i.test(fname)) fname = fname + '.md';
      const fp = path.join(dir, fname);
      if (action === 'read') {
        if (!fs.existsSync(fp)) {
          const alt = path.join(dir, name);
          if (fs.existsSync(alt)) return fs.readFileSync(alt, 'utf8');
          return '笔记「' + name + '」不存在。先 gm_note list 看已有笔记。';
        }
        const text = fs.readFileSync(fp, 'utf8');
        const total = text.length;
        const CHUNK = 50000;
        const start = Math.max(0, parseInt(args.start) || 0);
        const length = parseInt(args.length) || 0;
        if (length > 0) return (start > 0 ? '[第 ' + start + ' 字符起] ' : '') + text.substring(start, start + length) + (start + length < total ? '\n…[共 ' + total + ' 字符，继续 start=' + (start + length) + '&length=' + length + ']' : '\n[已读完]');
        if (total <= CHUNK) return text;
        return text.substring(start, start + CHUNK) + '\n…[共 ' + total + ' 字符，已显示 ' + CHUNK + '。继续请 start=' + CHUNK + ']';
      }
      if (action === 'save') {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fp, String(args.content || ''), 'utf8');
        return '笔记「' + name.replace(/\.(md|txt)$/i, '') + '」已保存：' + fp;
      }
      if (action === 'delete') {
        if (!fs.existsSync(fp) && !fs.existsSync(path.join(dir, name))) return '笔记「' + name + '」不存在。';
        fs.rmSync(fp, { force: true });
        fs.rmSync(path.join(dir, name), { force: true });
        return '笔记「' + name.replace(/\.(md|txt)$/i, '') + '」已删除。';
      }
      return 'gm_note 支持：list / read(name) / save(name,content) / delete(name)';
    } catch (e) { return '笔记操作失败: ' + e.message; }
  }

  // 写本地相关文件：限定 Ruler/<系统>/ 内（母本 original/ 与解析源 source/ 禁止覆盖；项目外保持只读）
  function gmWriteFile(ctx, args) {
    const sys = cleanRuleName(String(ctx.system || ''));
    const p = String(args.path || '').trim();
    if (!p) return '参数错误：需要 path（Ruler/' + sys + '/ 内文件绝对路径或相对路径）';
    const base = path.resolve(path.join(RULER_DIR, sys));
    const basePrefix = base + path.sep;
    let abs = path.resolve(p);
    if (!abs.startsWith(basePrefix) && abs !== base) abs = path.resolve(base, p);
    if (!abs.startsWith(basePrefix)) return '写权限仅限 Ruler/' + sys + '/ 内（项目外文件只读，用 gm_read_file）。';
    const first = abs.substring(basePrefix.length).split(path.sep)[0];
    if (first === 'original' || first === 'source') return '「' + first + '」是规则书母本/解析源目录，禁止覆盖。';
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(args.content || ''), 'utf8');
      return '已写入：' + abs + '（' + String(args.content || '').length + ' 字符）。';
    } catch (e) { return '写入失败: ' + e.message; }
  }

  function executeGmTool(name, args, ctx) {
    try {
      switch (name) {
        case 'gm_search': return gmSearch(ctx, args.query, args.scope);
        case 'gm_get_state': return gmGetState(ctx, args.character);
        case 'gm_update': return gmUpdate(ctx, args);
        case 'gm_media': return gmMedia(ctx, args.scene);
        case 'gm_list_files': return gmListFiles(ctx, args.path, args.recursive);
        case 'gm_read_file': return gmReadFile(ctx, args);
        case 'gm_note': return gmNote(ctx, args);
        case 'gm_write_file': return gmWriteFile(ctx, args);
        default: return `未知工具: ${name}`;
      }
    } catch (e) { return `工具执行失败: ${e.message}`; }
  }

  function safeParseArgs(json) {
    try {
      const v = JSON.parse(String(json || '{}'));
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }

  // 玩家频道 GM 工具循环（opencode 式逐步执行，3 轮协议 + 上下文最小化）：
  // T1 规划（完整上下文）→ 需要工具则并行调用，否则直接正文完结（实际1轮）
  // T2 编写（最小上下文：精简系统+上轮摘要+工具结果）→ 回检缺失再补检索，无误则完结（实际2轮）
  // T3 收尾（最小上下文）→ 一次性并行 gm_update 修正状态；若 T3 只调工具无正文，追加完结轮输出正文
  async function runGmToolLoop(req, res, endpoint, apiKey, model, messages, options = {}) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const maxRounds = 7; // T1/T2/T3 + 读取轮余量 + 完结轮（最多 2 次：完结轮调工具时兜底再给一次）
    const ctx = { system: req.body.system || '', adventure: req.body.adventure || '默认', channel: req.body.channel || '' };
    const sysMini = '你是本桌GM，正在带团。严格按【轮次协议】执行当前轮目标。铁律：1)事实优先——一切内容以工具实际返回为准，禁止编造；2)路径认知——用户指令中的路径是自然语言描述：如「XX里的设定集」= 目录「XX」下的「设定集」，「里/中/下/内」是介词、「的」是修饰连接，不是目录名的一部分，禁止把整句当作文件夹名原样重试；路径不存在时，工具会自动按自然语言拆解返回相近候选路径或父目录清单，直接按候选继续，不要重复原路径；3)失败问责——任一必需工具无有效返回（路径不存在/读取失败/内容为空）时，无条件承认任务失败：如实说明失败原因与已尝试内容，请求用户提供正确路径或信息，然后立即以承认失败的正文结束本轮；禁止任何形式的继续推进、编造"已读取/已核对/资料就绪"、或输出与任务无关的内容；4)直接执行——任务成功完成时，把结果落地为游戏持久状态并告知结果即可，无需询问用户：凡用户要求"作为角色设定/记录在案"的内容（设定、背景、进度、记忆等），自行判断落点（角色卡对应字段或冒险笔记）并写入，落地完成才算任务完成；纯查询/展示类任务按查询意图直接回答，不强制落地；询问只发生在真正无法决策的歧义（如失败场景需用户提供正确路径）；5)输出即结果——正文直接呈现任务结果本身（如角色背景就是纯粹的背景内容），不是工作报告；不附带"以上提炼自/资料出自/来源："等元说明；需要视觉排版时可直接输出 HTML/CSS，聊天界面会直接渲染效果；6)文本禁令（最高级）——面向玩家的任何文本只基于正面原本路径编写，禁止"没有X——原本是Y"式否定对比、禁止"（设定：...）"式自证元说明、禁止任何修正痕迹。';
    const T1 = '【轮次协议 T1·判断与规划】1)先判断：现有信息（频道提示词、上下文、本指令自带内容）是否已足以完成任务？足以→直接输出最终正文完结，禁止调用任何工具；2)确实缺少关键信息→一次性并行调用全部所需工具（gm_search/gm_get_state/gm_media/gm_read_file 可同发多条，尽量少、只调必需的），正文只写规划要点（内部参考，不显示给玩家）；3)规划轮不输出面向玩家的最终正文，正文在 T2 输出。';
    const T2 = '【轮次协议 T2·编写正文】任务类型感知：先判断用户指令的意图与预期规模，再决定输出篇幅——指令含"提炼/精简/简要/摘要/概括"→输出精炼条目（内容要全但篇幅克制，不铺陈、不过度排版）；指令含"详细/完整/展开/全文/设定集"→才输出完整内容；常规带团按剧情自然推进。输出篇幅与任务要求匹配，绝不刻意拉长。正文即任务结果本身（如角色背景就是纯粹的背景内容），不是工作报告，不附带"以上提炼自/来源："等元说明；需要视觉排版时可直接输出 HTML/CSS（聊天界面直接渲染效果）。落地原则：用户要求"作为角色设定/记录在案"的内容（设定、背景、进度、记忆等）＝应持久化的游戏状态，自行判断落点——角色卡对应字段（描述/背景→data.bio，数值→对应 data 键）或冒险笔记 gm_note，用工具写入，落地完成才算任务完成；纯查询/展示按查询意图直接回答。若仍缺关键数据，最多再并行调用一次工具补齐。正文输出后任务完结，不再进入后续轮次。';
    const T3 = '【轮次协议 T3·收尾】落地未完成时（用户要求记录在案的内容尚未写入角色卡/笔记），本轮一次性并行补写（多条一起发），写完才算完成；其余仅当确有游戏状态需要修正时用 gm_update。T2 已输出正文时本轮简短衔接即可，不重复正文。';
    const FINAL = '【完结轮】输出最终正文（面向玩家，可直接显示）。此轮禁止再调用任何工具，直接把正文写完。';
    // 增量累积（对齐 opencode：每轮请求 = 上一轮的完整超集 → 前缀缓存全部命中，全价只付新增部分；
    // 此前"重建最小上下文"导致每轮前缀断裂，全部全价计费——严重浪费）
    let msgs = [{ role: 'system', content: sysMini }].concat(messages || []);
    // 上下文软上限（字符）：超限时降级压缩（保命路径，断缓存但防超窗 400）
    const HARD_CAP = 110000;
    for (let round = 0; round < maxRounds; round++) {
      const instruction = round === 0 ? T1 : (round === 1 ? T2 : (round === 2 ? T3 : FINAL));
      // 超限降级：固定前缀（sysMini）+ 用户原始指令 + 最近 6 条
      const totalChars = msgs.reduce((s, m) => s + String(m.content || '').length, 0);
      if (totalChars > HARD_CAP) {
        const sysFirst = msgs[0];
        const origUser = msgs.slice().reverse().find(m => m.role === 'user' && String(m.content || '').indexOf('【轮次协议') < 0);
        const tail = msgs.slice(-6);
        msgs = [sysFirst];
        if (origUser) msgs.push(origUser);
        msgs.push(...tail);
        console.log(`[GM工具] 上下文超限压缩（${totalChars}字符 → 保留前缀+指令+最近6条）`);
      }
      msgs.push({ role: 'user', content: instruction });
      let result;
      try {
        result = await callAI(endpoint, apiKey, model, msgs, { tools: GM_TOOLS, reasoningEffort: options.reasoningEffort || 'high', timeoutMs: 120000 });
      } catch (err) {
        if (!res.writableEnded) {
          try { res.write(`data: ${JSON.stringify({ type: 'error', error: String(err.message || '调用失败').substring(0, 300) })}\n\n`); res.end(); } catch (e) {}
        }
        return;
      }
      const toolCalls = result.toolCalls || [];
      if (toolCalls.length) {
        const toolMsg = { role: 'assistant', content: result.content || '', tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } })) };
        if (result.reasoningContent) toolMsg.reasoning_content = result.reasoningContent;
        msgs.push(toolMsg);
        for (const tc of toolCalls) {
          try { res.write(`data: ${JSON.stringify({ type: 'tool', name: tc.name })}\n\n`); } catch (e) {}
          const t0 = Date.now();
          const args = safeParseArgs(tc.arguments);
          const out = executeGmTool(tc.name, args, ctx);
          console.log(`[GM工具] 轮${round + 1} ${tc.name} ${JSON.stringify(args).substring(0, 160)} (${Date.now() - t0}ms)`);
          const ok = !/^参数错误|^未找到|^无法对|^工具执行失败|^没有可操作/.test(out);
          try { res.write(`data: ${JSON.stringify({ type: 'tool_result', name: tc.name, ok })}\n\n`); } catch (e) {}
          msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(out).substring(0, 50000) });
        }
        continue;
      }
      const content = result.content || '';
      const reasoning = result.reasoningContent || '';
      if (reasoning) { try { res.write(`data: ${JSON.stringify({ type: 'reasoning', delta: reasoning })}\n\n`); } catch (e) {} }
      if (content) { try { res.write(`data: ${JSON.stringify({ type: 'content', delta: content })}\n\n`); } catch (e) {} }
      try { res.write(`data: ${JSON.stringify({ type: 'done', content, reasoningContent: reasoning })}\n\n`); res.end(); } catch (e) {}
      res.locals = res.locals || {}; res.locals.gmFinalContent = content;
      return;
    }
    if (!res.writableEnded) {
      try { res.write(`data: ${JSON.stringify({ type: 'error', error: '轮次协议超过 ' + maxRounds + ' 轮，已中止' })}\n\n`); res.end(); } catch (e) {}
    }
  }

  return { GM_TOOLS, executeGmTool, runGmToolLoop };
};
