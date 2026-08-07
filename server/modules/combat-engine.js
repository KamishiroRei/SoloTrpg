// ── 战斗引擎模块（最大化自由度框架） ──
// 宿主只提供通用原语，不预置任何规则书功能：
//   1. 事件总线：任何时点可产生事件（回合节点/状态变化/外部 [[event:hook|source|target]]）
//   2. 规则引擎：单位 data.behavior.rules 一条规则 = 触发（trigger 回合节点 | hook 事件）+ 条件/概率/权重/冷却 + 动作序列
//   3. 动作原语：speak / move / delta / set / handoff（接管大模型）/ ask（弹窗询问）/ emit（链式发事件）
//   4. 回合状态机：行动者推进（acted/[[turn:end]]）/ 回合轮转 / 胜负判定（规则书可关）
// DND 的"反应/借机攻击/护盾术"等 = AI 用上述原语为 DND 动态建立的功能（见该规则书 compressed/rule_combat.json），
// 宿主不内置"反应"这一 DND 概念；其他规则书可以完全不用 ask，或建立自己的功能。
// 依赖注入 deps = { fs, path, RULER_DIR, cleanRuleName }，由 server.js 创建并挂载路由

module.exports = function createCombatEngine(deps) {
  const { fs, path, RULER_DIR, cleanRuleName } = deps;

  function combatFile(sys, adv) { return path.join(RULER_DIR, cleanRuleName(String(sys || '')), '存档', String(adv || '默认'), 'combat.json'); }
  function handoffFile(sys, adv) { return path.join(RULER_DIR, cleanRuleName(String(sys || '')), '存档', String(adv || '默认'), 'pending-handoffs.json'); }
  function loadCombatState(sys, adv) {
    try {
      const f = combatFile(sys, adv);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { active: false };
    } catch (e) { return { active: false }; }
  }
  function saveCombatState(sys, adv, st) {
    fs.mkdirSync(path.dirname(combatFile(sys, adv)), { recursive: true });
    fs.writeFileSync(combatFile(sys, adv), JSON.stringify(st, null, 2), 'utf8');
  }
  function loadHandoffs(sys, adv) {
    try {
      const f = handoffFile(sys, adv);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
    } catch (e) { return []; }
  }
  function saveHandoffs(sys, adv, list) {
    fs.mkdirSync(path.dirname(handoffFile(sys, adv)), { recursive: true });
    fs.writeFileSync(handoffFile(sys, adv), JSON.stringify(list, null, 2), 'utf8');
  }
  function loadCharacterByName(sys, adv, name) {
    const charsDir = path.join(RULER_DIR, cleanRuleName(String(sys || '')), '存档', String(adv || '默认'), 'characters');
    if (!fs.existsSync(charsDir)) return null;
    for (const cdir of fs.readdirSync(charsDir, { withFileTypes: true })) {
      if (!cdir.isDirectory()) continue;
      const curFile = path.join(charsDir, cdir.name, 'current.json');
      if (!fs.existsSync(curFile)) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(curFile, 'utf8'));
        const c = obj.character || {};
        if (String(c.displayName || c.name || '') === name) return c;
      } catch (e) {}
    }
    return null;
  }

  // 规则书战斗配置：Ruler/<系统>/compressed/rule_combat.json（缺省中性通用默认，不套任何规则书结构）
  function loadCombatConfig(sys) {
    const defaults = { reactionPool: { defaultMax: 1 }, battleEnd: { enabled: true } };
    try {
      const f = path.join(RULER_DIR, cleanRuleName(String(sys || '')), 'compressed', 'rule_combat.json');
      if (fs.existsSync(f)) {
        const c = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (c && typeof c === 'object') {
          return {
            reactionPool: Object.assign({ defaultMax: 1 }, c.reactionPool || {}),
            battleEnd: Object.assign({ enabled: true }, c.battleEnd || {}),
            hooks: Array.isArray(c.hooks) ? c.hooks : null,
            templates: c.reactionTemplates || c.templates || null
          };
        }
      }
    } catch (e) {}
    return defaults;
  }

  // 值求值：普通值 / {"dice":"1d6+2"} / {"random":[a,b]} / {"expr":"hp.max*0.5"}（引用 ctx）
  function battleEvalValue(v, ctx) {
    if (v && typeof v === 'object') {
      if (typeof v.dice === 'string') {
        const m = v.dice.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
        if (m) {
          const n = parseInt(m[1] || '1', 10) || 1;
          const sides = parseInt(m[2], 10) || 6;
          let total = 0;
          for (let i = 0; i < n; i++) total += 1 + Math.floor(Math.random() * sides);
          if (m[3]) total += parseInt(m[3], 10) || 0;
          return total;
        }
        return 0;
      }
      if (Array.isArray(v.random) && v.random.length) return v.random[Math.floor(Math.random() * v.random.length)];
      if (typeof v.expr === 'string') {
        try {
          const fn = new Function('ctx', 'return (' + v.expr + ')');
          return fn(ctx || {});
        } catch (e) { return v.expr; }
      }
      if (v.value !== undefined) return v.value;
      return v;
    }
    if (typeof v === 'string' && v.indexOf('$') === 0 && ctx) return ctx[v.substring(1)] !== undefined ? ctx[v.substring(1)] : v;
    return v;
  }

  // 条件求值：{ path, op, value } / { and } / { or } / { not }；ctx 含单位属性与事件 source/target/detail
  function battleEvalCondition(cond, ctx) {
    if (!cond) return true;
    if (Array.isArray(cond.and)) return cond.and.every(c => battleEvalCondition(c, ctx));
    if (Array.isArray(cond.or)) return cond.or.some(c => battleEvalCondition(c, ctx));
    if (cond.not) return !battleEvalCondition(cond.not, ctx);
    if (cond.path) {
      let cur = ctx;
      for (const seg of String(cond.path).split('.')) {
        if (cur === undefined || cur === null) return false;
        cur = cur[seg];
      }
      const expect = battleEvalValue(cond.value, ctx);
      switch (cond.op) {
        case '==': case '=': return String(cur) === String(expect);
        case '!=': return String(cur) !== String(expect);
        case '<': return Number(cur) < Number(expect);
        case '<=': return Number(cur) <= Number(expect);
        case '>': return Number(cur) > Number(expect);
        case '>=': return Number(cur) >= Number(expect);
        case 'in': return Array.isArray(expect) && expect.some(x => String(x) === String(cur));
        case '!in': return Array.isArray(expect) && !expect.some(x => String(x) === String(cur));
        default: return false;
      }
    }
    return true;
  }

  function unitCtx(u, st, ev) {
    const hp = (u.hp && typeof u.hp.current === 'number') ? u.hp.current : 0;
    const maxHp = (u.hp && typeof u.hp.max === 'number') ? u.hp.max : 1;
    const ctx = {
      hp: { current: hp, max: maxHp },
      ratio: maxHp > 0 ? hp / maxHp : 0,
      status: u.status || {},
      round: (st && st.round) || 1,
      faction: u.faction || '',
      name: u.name || ''
    };
    if (ev) { ctx.source = ev.source || ''; ctx.target = ev.target || ''; ctx.detail = ev.detail || ''; }
    return ctx;
  }

  function pickWeighted(items) {
    const total = items.reduce((s, r) => s + Math.max(1, Number(r.weight) || 1), 0);
    let roll = Math.random() * total;
    for (const r of items) {
      roll -= Math.max(1, Number(r.weight) || 1);
      if (roll <= 0) return r;
    }
    return items[items.length - 1];
  }

  // 单位是否失去行动能力（倒下/逃离/昏迷——状态词为通用约定，规则书可自定义 status 键）
  function isIncapable(u) {
    if (!u) return true;
    const hp = u.hp && typeof u.hp.current === 'number' ? u.hp.current : null;
    if (hp !== null && hp <= 0) return true;
    if (u.status && (u.status.fleeing || u.status.downed || u.status.unconscious)) return true;
    return false;
  }

  // 战斗结束自动判定：一方全灭/全部逃离即结束（规则书可用 rule_combat.json 关闭）
  function checkCombatEnd(st) {
    const units = (st && st.units) || [];
    if (!units.length) return { type: 'draw', text: '没有参战单位，战斗结束。' };
    const enemies = units.filter(u => u.faction === 'enemy');
    const friendlies = units.filter(u => u.faction === 'player' || u.faction === 'ally');
    const enemyDown = enemies.length > 0 && enemies.every(isIncapable);
    const friendDown = friendlies.length > 0 && friendlies.every(isIncapable);
    if (enemyDown && friendDown) return { type: 'draw', text: '双方均失去战斗能力，战斗结束。' };
    if (enemyDown) return { type: 'victory', text: '所有敌人已倒下或逃离，战斗胜利！' };
    if (friendDown) return { type: 'defeat', text: '我方全员失去战斗能力，战斗失败。' };
    return null;
  }

  // 规则列表统一读取：rules（trigger 节点规则）+ reactions（hook 事件规则，兼容旧结构）合并
  function rulesList(behavior) {
    if (!behavior || typeof behavior !== 'object') return [];
    const out = [];
    if (Array.isArray(behavior.rules)) out.push(...behavior.rules);
    if (Array.isArray(behavior.reactions)) out.push(...behavior.reactions);
    return out;
  }

  // 单条规则命中后的处理：handoff → ask → 普通动作。返回 { asks, handoffs, speaks, changes, emitted }
  function runRule(rule, ctx, u, st, sys, adv, out) {
    if (!rule) return;
    if (rule.handoff) {
      const msg = String(rule.handoff.message || rule.handoff.text || '特殊情况，请求大模型接管该单位行为决策。');
      out.handoffs.push({ unit: u.name, message: msg + `（当前 HP ${ctx.hp.current}/${ctx.hp.max}，状态：${JSON.stringify(u.status || {})}）` });
      return;
    }
    if (rule.chance !== undefined && rule.chance < 1 && Math.random() > rule.chance) return;
    if (rule.cooldown && ctx.round - ((st.cooldowns || {})[u.name + ':' + rule.id] || 0) < rule.cooldown) return;
    for (const a of (rule.actions || [])) {
      if (!a || !a.op) continue;
      try {
        if (a.op === 'speak') {
          const pool = Array.isArray(a.text) ? a.text : [a.text || ''];
          const t = pool[Math.floor(Math.random() * pool.length)];
          if (t) out.speaks.push({ unit: u.name, text: t });
        } else if (a.op === 'ask') {
          // 弹窗询问原语（规则书功能如 DND 反应 = 由 AI 用本原语建立）
          out.asks.push({
            id: u.name + ':' + (rule.id || 'ask') + ':' + String(ctx.hook || ctx.trigger || 'any') + ':' + out.asks.length,
            unit: u.name,
            hook: ctx.hook || '',
            trigger: ctx.trigger || '',
            title: a.title || '行动选择',
            desc: a.desc || '',
            options: Array.isArray(a.options) && a.options.length ? a.options : [{ label: '执行', desc: '', actions: [] }]
          });
        } else if (a.op === 'emit') {
          out.emitted.push({ type: String(a.event || ''), source: String(a.source || u.name), target: String(a.target || ''), detail: String(a.detail || '') });
        } else if (a.op === 'delta' || a.op === 'set') {
          const delta = a.op === 'delta';
          let val = battleEvalValue(a.value, ctx);
          const segs = String(a.path || '').split('.');
          let cur = u;
          let ok = true;
          for (let i = 0; i < segs.length - 1; i++) {
            if (cur[segs[i]] === undefined || cur[segs[i]] === null || typeof cur[segs[i]] !== 'object') { ok = false; break; }
            cur = cur[segs[i]];
          }
          if (!ok || !segs.length) continue;
          const key = segs[segs.length - 1];
          const oldVal = cur[key];
          if (delta) {
            const nv = Number(oldVal) + Number(val);
            if (a.path === 'hp.current') {
              cur[key] = Math.max(0, Math.min(nv, u.hp && u.hp.max || nv));
              out.changes.push(`${u.name} HP ${oldVal}→${cur[key]}`);
            } else {
              cur[key] = nv;
              out.changes.push(`${u.name} ${a.path} ${oldVal}→${cur[key]}`);
            }
          } else {
            cur[key] = val;
            out.changes.push(`${u.name} ${a.path} → ${JSON.stringify(val)}`);
          }
        } else if (a.op === 'move') {
          out.changes.push(`${u.name} 移动（${a.to || ''} ${a.dist !== undefined ? a.dist + '格' : ''}）`);
        }
      } catch (e) {}
    }
    if (rule.cooldown) {
      st.cooldowns = st.cooldowns || {};
      st.cooldowns[u.name + ':' + rule.id] = ctx.round;
    }
  }

  // 回合节点执行：评估 trigger 规则（roundStart/roundEnd/状态事件/any）
  function runBattleEngine(sys, adv) {
    const st = loadCombatState(sys, adv);
    if (!st || !st.active) return { error: '当前不在战斗中' };
    const out = { speaks: [], changes: [], handoffs: [], asks: [], emitted: [] };
    const st2 = JSON.parse(JSON.stringify(st));
    for (const u of st2.units || []) {
      if (!u || !u.name) continue;
      const char = loadCharacterByName(sys, adv, u.name);
      const rules = rulesList(char && char.data && char.data.behavior);
      if (!rules.length) continue;
      const hp = (u.hp && typeof u.hp.current === 'number') ? u.hp.current : 0;
      const maxHp = (u.hp && typeof u.hp.max === 'number') ? u.hp.max : 1;
      const ctx = unitCtx(u, st);
      ctx.events = [];
      const snap = u.snapshot;
      if (snap && typeof snap.hp === 'number' && hp < snap.hp) ctx.events.push('damaged');
      if (snap && typeof snap.hp === 'number' && snap.hp <= 0 && hp > 0) ctx.events.push('revived');
      if (hp <= 0) ctx.events.push('downed');
      ctx.events.push('any');
      ctx.trigger = '';
      const candidates = rules.filter(r => {
        if (!r) return false;
        const trig = String(r.trigger || 'any');
        if (r.hook) return false; // hook 规则由事件触发，回合节点不评估
        if (trig !== 'any' && !ctx.events.includes(trig) && !(trig === 'roundEnd' || trig === 'roundStart')) return false;
        return battleEvalCondition(r.condition, ctx);
      });
      if (!candidates.length) continue;
      const sorted = candidates.slice().sort((a, b) => ((b.priority || 0) - (a.priority || 0)));
      const topPriority = sorted[0].priority || 0;
      const topGroup = sorted.filter(r => (r.priority || 0) === topPriority);
      const rule = topGroup.length > 1 ? pickWeighted(topGroup) : topGroup[0];
      if (!rule) continue;
      ctx.trigger = rule.trigger || 'any';
      runRule(rule, ctx, u, st2, sys, adv, out);
    }
    for (const u of st2.units || []) {
      u.snapshot = { hp: u.hp && typeof u.hp.current === 'number' ? u.hp.current : 0 };
      if (u.hp && typeof u.hp.current === 'number' && u.hp.current > (u.hp.max || u.hp.current)) u.hp.current = u.hp.max || u.hp.current;
      if (u.reaction) u.reaction.used = false; // 新回合重置（规则书功能池：DND 反应池/其他书自定义池）
    }
    st2.round = (st.round || 1) + 1;
    st2.pendingAsks = []; // 回合轮转清除过期询问
    saveCombatState(sys, adv, st2);
    if (out.handoffs.length) {
      const list = loadHandoffs(sys, adv);
      list.push(...out.handoffs);
      saveHandoffs(sys, adv, list);
    }
    // 链式事件（emit 动作）在同一节点处理一轮
    if (out.emitted.length) {
      for (const ev of out.emitted) emitEventInto(sys, adv, ev, st2, out, 1);
    }
    return { round: st2.round, speaks: out.speaks, changes: out.changes, handoffs: out.handoffs, asks: out.asks };
  }

  // 事件总线：外部 [[event:hook|source|target|detail]] 或引擎 emit → 匹配 hook 规则 → 生成询问/执行
  function emitEventInto(sys, adv, ev, st, out, depth) {
    if (!st || !st.active) return;
    if (!ev || !ev.type) return;
    if (depth > 4) return; // 防链式循环
    for (const u of st.units || []) {
      if (!u || !u.name) continue;
      const char = loadCharacterByName(sys, adv, u.name);
      const rules = rulesList(char && char.data && char.data.behavior);
      if (!rules.length) continue;
      const ctx = unitCtx(u, st, ev);
      ctx.hook = ev.type;
      const candidates = rules.filter(r => {
        if (!r || !r.hook) return false;
        if (String(r.hook) !== ev.type) return false;
        // 规则书功能池（DND 反应池）：ask 类规则消耗一次，用尽不再询问
        if (r.consumePool && u.reaction && u.reaction.used) return false;
        return battleEvalCondition(r.condition, ctx);
      });
      for (const rule of candidates) {
        const before = (out.asks || []).length + (out.handoffs || []).length;
        runRule(rule, ctx, u, st, sys, adv, out);
        const grew = (out.asks || []).length + (out.handoffs || []).length > before;
        if (grew && rule.consumePool) {
          for (const uu of st.units || []) if (uu.name === u.name) uu.reaction = { used: true, max: (uu.reaction && uu.reaction.max) || 1 };
        }
      }
    }
    const chain = (out.emitted || []).splice(0);
    for (const ev2 of chain) emitEventInto(sys, adv, ev2, st, out, depth + 1);
  }

  function emitEvent(sys, adv, ev) {
    const st = loadCombatState(sys, adv);
    if (!st || !st.active) return { error: '当前不在战斗中' };
    if (!ev || !ev.type) return { error: '缺少事件类型' };
    const out = { asks: [], handoffs: [], speaks: [], changes: [], emitted: [] };
    emitEventInto(sys, adv, ev, st, out, 1);
    if (out.asks.length || out.handoffs.length) {
      st.pendingAsks = st.pendingAsks || [];
      const exist = new Set((st.pendingAsks || []).map(p => p.id));
      for (const p of out.asks) if (!exist.has(p.id)) { st.pendingAsks.push(p); exist.add(p.id); }
      saveCombatState(sys, adv, st);
    }
    if (out.handoffs.length) {
      const list = loadHandoffs(sys, adv);
      list.push(...out.handoffs);
      saveHandoffs(sys, adv, list);
    }
    return { success: true, asks: out.asks, handoffs: out.handoffs };
  }

  function getPendingAsks(sys, adv) {
    const st = loadCombatState(sys, adv);
    return { success: true, pending: (st && st.pendingAsks) || [] };
  }

  // 询问选择/跳过：skip 仅移除（不消耗）；选择 → 选项带 actions 由引擎执行（resolve=engine），否则返回给 AI 结算（resolve=ai）
  function askSelect(sys, adv, unitName, askId, optionIndex, skip) {
    const st = loadCombatState(sys, adv);
    if (!st || !st.active) return { error: '当前不在战斗中' };
    const list = (st.pendingAsks || []).slice();
    const idx = list.findIndex(p => p.id === askId && (!unitName || p.unit === unitName));
    if (idx < 0) return { error: '该询问已失效' };
    const item = list[idx];
    list.splice(idx, 1);
    st.pendingAsks = list;
    if (skip) {
      saveCombatState(sys, adv, st);
      return { success: true, skipped: true, unit: item.unit };
    }
    const option = item.options[Math.max(0, Number(optionIndex) || 0)] || { label: '' };
    const executed = [];
    if (Array.isArray(option.actions) && option.actions.length) {
      const u = (st.units || []).find(x => x.name === item.unit);
      const char = loadCharacterByName(sys, adv, item.unit);
      const ctx = unitCtx(u, st);
      ctx.hook = item.hook;
      ctx.trigger = item.trigger;
      const out = { speaks: [], changes: [], handoffs: [], asks: [], emitted: [] };
      for (const a of option.actions) {
        runRule({ actions: [a] }, ctx, u, st, sys, adv, out);
      }
      for (const s of out.speaks) executed.push(s.unit + '说「' + s.text + '」');
      executed.push(...out.changes);
      if (out.asks.length) { st.pendingAsks = st.pendingAsks || []; st.pendingAsks.push(...out.asks); }
      saveCombatState(sys, adv, st);
    }
    saveCombatState(sys, adv, st);
    return { success: true, unit: item.unit, title: item.title, option, hook: item.hook, executed };
  }

  // 开始战斗：扫描冒险全部角色为参战单位（分类→阵营），回合=1；功能池上限取自规则书配置
  function startCombat(sys, adv) {
    const cfg = loadCombatConfig(sys);
    const maxPool = (cfg.reactionPool && typeof cfg.reactionPool.defaultMax === 'number') ? cfg.reactionPool.defaultMax : 1;
    const charsDir = path.join(RULER_DIR, cleanRuleName(String(sys || '')), '存档', String(adv || '默认'), 'characters');
    const units = [];
    if (fs.existsSync(charsDir)) {
      for (const cdir of fs.readdirSync(charsDir, { withFileTypes: true })) {
        if (!cdir.isDirectory()) continue;
        const curFile = path.join(charsDir, cdir.name, 'current.json');
        if (!fs.existsSync(curFile)) continue;
        try {
          const obj = JSON.parse(fs.readFileSync(curFile, 'utf8'));
          const c = obj.character || {};
          const d = c.data || {};
          const hp = d.HP || {};
          const cat = String(c.category || '玩家');
          const faction = cat === '敌人' || cat === '敌' ? 'enemy' : cat === '友方' || cat === '友' ? 'ally' : cat === 'NPC' || cat === 'npc' ? 'npc' : 'player';
          units.push({
            name: c.displayName || c.name || cdir.name,
            faction,
            category: cat,
            hp: { current: hp.current !== undefined ? hp.current : (hp.max || 1), max: hp.max !== undefined ? hp.max : (hp.current || 1) },
            status: (Array.isArray(d.conditions) ? d.conditions : []).reduce((o, s) => { o[s] = true; return o; }, {}),
            init: Number(c.init || d.initiative || 0) || 0,
            reaction: { used: false, max: maxPool },
            snapshot: { hp: hp.current !== undefined ? hp.current : (hp.max || 1) }
          });
        } catch (e) {}
      }
    }
    if (!units.length) return { success: false, error: '当前冒险没有角色可参战。请先创建角色，或在角色卡分类中标记敌人/友方/NPC。' };
    units.sort((a, b) => b.init - a.init);
    const st = { active: true, round: 1, activeUnit: units[0] ? units[0].name : '', units, cooldowns: {}, pendingAsks: [], startedAt: new Date().toISOString() };
    saveCombatState(sys, adv, st);
    return { success: true, combat: st };
  }

  // 行动结束推进：当前单位已行动 → 下一行动者；无剩余 → 回合轮转+引擎反应+结束判定
  function advance(sys, adv) {
    let st = loadCombatState(sys, adv);
    if (!st || !st.active) return { success: false, error: '当前不在战斗中。' };
    const units = st.units || [];
    if (st.turnIndex !== undefined && units[st.turnIndex]) units[st.turnIndex].acted = true;
    const n = units.length;
    let nextIdx = -1;
    if (n) {
      const base = typeof st.turnIndex === 'number' ? st.turnIndex : 0;
      for (let i = 1; i <= n; i++) {
        const idx = (base + i) % n;
        if (units[idx] && !units[idx].acted && !isIncapable(units[idx])) { nextIdx = idx; break; }
      }
    }
    if (nextIdx >= 0) {
      st.turnIndex = nextIdx;
      saveCombatState(sys, adv, st);
      return { success: true, advance: 'turn', next: units[nextIdx].name, round: st.round || 1 };
    }
    const out = runBattleEngine(sys, adv);
    if (out && out.error) return { success: false, error: out.error };
    st = loadCombatState(sys, adv);
    const newUnits = st.units || [];
    newUnits.forEach(u => { u.acted = false; });
    const firstIdx = newUnits.findIndex(u => !isIncapable(u));
    st.turnIndex = firstIdx >= 0 ? firstIdx : 0;
    saveCombatState(sys, adv, st);
    const cfg = loadCombatConfig(sys);
    const endResult = (cfg.battleEnd && cfg.battleEnd.enabled === false) ? null : checkCombatEnd(st);
    if (endResult) {
      st.active = false;
      st.result = endResult;
      st.endedAt = new Date().toISOString();
      saveCombatState(sys, adv, st);
      return {
        success: true, advance: 'round', roundEnd: true, battleEnd: endResult,
        round: st.round || 1, next: st.units && st.units[st.turnIndex] ? st.units[st.turnIndex].name : '',
        speaks: (out && out.speaks) || [], changes: (out && out.changes) || [], handoffs: (out && out.handoffs) || [], asks: (out && out.asks) || []
      };
    }
    return {
      success: true, advance: 'round', roundEnd: true,
      round: st.round || 1, next: st.units && st.units[st.turnIndex] ? st.units[st.turnIndex].name : '',
      speaks: (out && out.speaks) || [], changes: (out && out.changes) || [], handoffs: (out && out.handoffs) || [], asks: (out && out.asks) || []
    };
  }

  function endRound(sys, adv) {
    const out = runBattleEngine(sys, adv);
    if (out.error) return { success: false, error: out.error };
    const st = loadCombatState(sys, adv);
    return { success: true, round: out.round, speaks: out.speaks, changes: out.changes, handoffs: out.handoffs, asks: out.asks, combat: st };
  }

  function endCombat(sys, adv) {
    saveCombatState(sys, adv, { active: false, endedAt: new Date().toISOString() });
    return { success: true };
  }

  return {
    loadCombatState, saveCombatState, loadHandoffs, saveHandoffs, loadCharacterByName, loadCombatConfig,
    battleEvalValue, battleEvalCondition, runBattleEngine, pickWeighted, isIncapable, checkCombatEnd,
    emitEvent, getPendingAsks, askSelect,
    startCombat, advance, endRound, endCombat
  };
};
