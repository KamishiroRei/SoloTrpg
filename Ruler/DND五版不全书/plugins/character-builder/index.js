// DND五版不全书 —— 规则专属角色卡插件（character-builder）v2.0
// 依据：玩家手册2024（DND 5e 2024）规则；职业表来自 compressed/rule_tables.md
// 重构要点：电子游戏级深色主题（与宿主 #1a1a2e 系统一）、结构化数据模型、
//          效果系统（effectTags/effects 表达式累计派生值）、玩家驱动掷骰日志、
//          短休/长休、法术位格点、死亡豁免、灵感、多角色切换、AI状态摘要。
'use strict';

var ABILITIES = [
  { key: 'str', name: '力量', short: 'STR' },
  { key: 'dex', name: '敏捷', short: 'DEX' },
  { key: 'con', name: '体质', short: 'CON' },
  { key: 'int', name: '智力', short: 'INT' },
  { key: 'wis', name: '感知', short: 'WIS' },
  { key: 'cha', name: '魅力', short: 'CHA' }
];

var ABILITY_KEY = { 力量: 'str', 敏捷: 'dex', 体质: 'con', 智力: 'int', 感知: 'wis', 魅力: 'cha' };

// 18 项技能 → 关联属性（2024 技能表）
var SKILLS = [
  { name: '运动', ability: '力量' },
  { name: '特技', ability: '敏捷' },
  { name: '巧手', ability: '敏捷' },
  { name: '隐匿', ability: '敏捷' },
  { name: '奥秘', ability: '智力' },
  { name: '历史', ability: '智力' },
  { name: '调查', ability: '智力' },
  { name: '自然', ability: '智力' },
  { name: '宗教', ability: '智力' },
  { name: '驯兽', ability: '感知' },
  { name: '洞悉', ability: '感知' },
  { name: '医药', ability: '感知' },
  { name: '察觉', ability: '感知' },
  { name: '求生', ability: '感知' },
  { name: '欺瞒', ability: '魅力' },
  { name: '威吓', ability: '魅力' },
  { name: '表演', ability: '魅力' },
  { name: '游说', ability: '魅力' }
];

// 职业 → 生命骰（rule_tables.md 职业表确认）
var CLASS_HD = {
  '野蛮人': 'd12', '吟游诗人': 'd8', '牧师': 'd8', '德鲁伊': 'd8',
  '战士': 'd10', '武僧': 'd8', '圣武士': 'd10', '游侠': 'd10',
  '魔契师': 'd8', '法师': 'd6', '游荡者': 'd8', '术士': 'd6',
  '奇械师': 'd8'
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 属性修正 = floor((值-10)/2)
function abilityMod(score) {
  return Math.floor((Number(score) - 10) / 2);
}

// 熟练加值等级表：1-4:+2 5-8:+3 9-12:+4 13-16:+5 17-20:+6
function proficiencyBonus(level) {
  level = Number(level) || 1;
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

// 每级平均生命 = ceil(骰面/2) + 1
function avgHpPerLevel(die) {
  var face = parseInt(String(die || 'd8').replace('d', ''), 10) || 8;
  return Math.ceil(face / 2) + 1;
}

// ── 升级（Level-up）规则支持 ─────────────────────────
var ASI_LEVELS = { 4: 1, 8: 1, 12: 1, 16: 1, 19: 1 };
var PROF_BUMP_LEVELS = { 5: 1, 9: 1, 13: 1, 17: 1 };
var CASTING_STAT = {
  '吟游诗人': 'cha', '牧师': 'wis', '德鲁伊': 'wis', '圣武士': 'cha',
  '游侠': 'wis', '魔契师': 'cha', '术士': 'cha', '法师': 'int', '奇械师': 'int'
};

// ── 护甲 AC（玩家手册2024 护甲表） ──
var ARMOR_LIST = ['无甲', '布甲', '皮甲', '镶钉皮甲', '兽皮甲', '链甲衫', '鳞甲', '胸甲', '半身板甲', '环甲', '链甲', '板条甲', '板甲'];
var ARMOR_INFO = {
  '无甲': { type: '无', baseAC: 10, maxDex: 99, strReq: 0 },
  '布甲': { type: '轻甲', baseAC: 11, maxDex: 99, strReq: 0 },
  '皮甲': { type: '轻甲', baseAC: 11, maxDex: 99, strReq: 0 },
  '镶钉皮甲': { type: '轻甲', baseAC: 12, maxDex: 99, strReq: 0 },
  '兽皮甲': { type: '中甲', baseAC: 12, maxDex: 2, strReq: 0 },
  '链甲衫': { type: '中甲', baseAC: 13, maxDex: 2, strReq: 0 },
  '鳞甲': { type: '中甲', baseAC: 14, maxDex: 2, strReq: 0 },
  '胸甲': { type: '中甲', baseAC: 14, maxDex: 2, strReq: 0 },
  '半身板甲': { type: '中甲', baseAC: 15, maxDex: 2, strReq: 0 },
  '环甲': { type: '重甲', baseAC: 14, maxDex: 0, strReq: 0 },
  '链甲': { type: '重甲', baseAC: 16, maxDex: 0, strReq: 13 },
  '板条甲': { type: '重甲', baseAC: 17, maxDex: 0, strReq: 15 },
  '板甲': { type: '重甲', baseAC: 18, maxDex: 0, strReq: 15 }
};
function armorAC(armor, dexMod, shield) {
  var info = ARMOR_INFO[armor] || ARMOR_INFO['无甲'];
  var AC = info.baseAC + Math.min(info.maxDex, Number(dexMod) || 0);
  if (shield) AC += 2;
  return AC;
}

// ── 负重（5e：上限=力量×15 磅，拖/推/举=力量×30 磅；超上限速度-10尺） ──
function carryCapacity(strScore) {
  return Math.max(0, (Number(strScore) || 0)) * 15;
}
function carryCapacityHeavy(strScore) {
  return Math.max(0, (Number(strScore) || 0)) * 30;
}
function carryStatus(load, cap, capHeavy) {
  load = Number(load) || 0; cap = Number(cap) || 0; capHeavy = Number(capHeavy) || 0;
  if (load <= cap) return { name: '未负重', speedPenalty: 0 };
  if (load <= capHeavy) return { name: '负重', speedPenalty: 10 };
  return { name: '超载', speedPenalty: -1 };
}

// ── 默认速度（尺）：矮人/半身人 25，其余 30 ──
function defaultSpeed(race) {
  var r = String(race || '');
  if (r.indexOf('歌利亚') >= 0) return 35; // 2024 PHB 歌利亚 35尺
  return 30; // 2024 PHB：矮人/半身人 30尺，其余均为 30尺
}

// ── 法术位（玩家手册 标准施法者表） ──
var FULL_CASTER = { '法师': 1, '牧师': 1, '德鲁伊': 1, '术士': 1, '吟游诗人': 1 };
var HALF_CASTER = { '圣武士': 1, '游侠': 1, '奇械师': 1 };
var PACT_CASTER = { '魔契师': 1 };
var FULL_SLOTS = [
  null,
  [2,0,0,0,0,0,0,0,0], [3,0,0,0,0,0,0,0,0], [4,2,0,0,0,0,0,0,0], [4,3,0,0,0,0,0,0,0],
  [4,3,2,0,0,0,0,0,0], [4,3,3,0,0,0,0,0,0], [4,3,3,1,0,0,0,0,0], [4,3,3,2,0,0,0,0,0],
  [4,3,3,3,1,0,0,0,0], [4,3,3,3,2,0,0,0,0], [4,3,3,3,2,1,0,0,0], [4,3,3,3,2,1,0,0,0],
  [4,3,3,3,2,1,1,0,0], [4,3,3,3,2,1,1,0,0], [4,3,3,3,2,1,1,0,0], [4,3,3,3,2,1,1,1,0],
  [4,3,3,3,2,1,1,1,0], [4,3,3,3,2,1,1,1,1], [4,3,3,3,3,1,1,1,1], [4,3,3,3,3,2,1,1,1],
  [4,3,3,3,3,2,2,1,1]
];
var PACT_SLOTS = [
  null,
  [1,1],[2,1],[2,2],[2,2],[2,3],[2,3],[2,4],[2,4],[2,5],[2,5],
  [3,5],[3,5],[3,5],[3,5],[3,5],[3,5],[4,5],[4,5],[4,5],[4,5]
];
function casterType(cls) {
  if (FULL_CASTER[cls]) return 'full';
  if (HALF_CASTER[cls]) return 'half';
  if (PACT_CASTER[cls]) return 'pact';
  return null;
}
function spellSlotsFor(cls, level) {
  var lv = Math.max(1, Math.min(20, Number(level) || 1));
  var type = casterType(cls);
  var slots = {};
  if (type === 'full') {
    var row = FULL_SLOTS[lv];
    for (var i = 0; i < 9; i++) slots[i + 1] = row[i];
  } else if (type === 'half') {
    var eff = Math.ceil(lv / 2);
    var row2 = FULL_SLOTS[eff];
    for (var j = 0; j < 9; j++) slots[j + 1] = row2[j];
  } else if (type === 'pact') {
    var p = PACT_SLOTS[lv];
    for (var k = 1; k <= 9; k++) slots[k] = 0;
    slots[p[1]] = p[0];
  } else {
    for (var m = 1; m <= 9; m++) slots[m] = 0;
  }
  return slots;
}
function spellSlotsText(slots) {
  slots = slots || {};
  var parts = [];
  for (var ring = 1; ring <= 9; ring++) {
    var n = Number(slots[ring]) || 0;
    if (n > 0) parts.push(ring + '环×' + n);
  }
  return parts.length ? parts.join('、') : '无';
}

// ── 效果系统（标杆 effectTags + effects 结构） ───────────
// effectTags：规则化效果键，如 ac_plus_1/save_plus_1/spell_dc_plus_1
// effects：结构化 [{ target, mode, value }]，value 支持 @pb/@level/@strmod 等表达式
var EFFECT_TAG_PRESETS = {
  ac_plus_1: { target: 'ac', mode: 'add', value: 1, label: 'AC +1' },
  save_plus_1: { target: 'save.all', mode: 'add', value: 1, label: '豁免 +1' },
  skill_plus_1: { target: 'skill.all', mode: 'add', value: 1, label: '技能 +1' },
  hp_plus_5: { target: 'hp.max', mode: 'add', value: 5, label: '最大HP +5' },
  spell_dc_plus_1: { target: 'spell.dc', mode: 'add', value: 1, label: '法术DC +1' },
  spell_attack_plus_1: { target: 'spell.attack', mode: 'add', value: 1, label: '法术攻击 +1' },
  weapon_attack_plus_1: { target: 'attack.all', mode: 'add', value: 1, label: '攻击 +1' },
  weapon_damage_plus_1: { target: 'damage.all', mode: 'add', value: 1, label: '伤害 +1' },
  initiative_plus_1: { target: 'initiative', mode: 'add', value: 1, label: '先攻 +1' },
  speed_plus_10: { target: 'speed', mode: 'add', value: 10, label: '速度 +10尺' }
};

// 解析 effectTags（支持中英文别名）→ 效果列表
function resolveEffectTagKey(tag) {
  var t = String(tag || '').trim().toLowerCase();
  if (!t) return null;
  if (EFFECT_TAG_PRESETS[t]) return t;
  var alias = {
    'ac+1': 'ac_plus_1', '护甲+1': 'ac_plus_1', '护甲等级+1': 'ac_plus_1',
    'save+1': 'save_plus_1', '豁免+1': 'save_plus_1',
    'skill+1': 'skill_plus_1', '技能+1': 'skill_plus_1',
    'hp+5': 'hp_plus_5', 'maxhp+5': 'hp_plus_5', '最大生命+5': 'hp_plus_5',
    'spelldc+1': 'spell_dc_plus_1', 'dc+1': 'spell_dc_plus_1', '法术dc+1': 'spell_dc_plus_1',
    'spellattack+1': 'spell_attack_plus_1', '法术攻击+1': 'spell_attack_plus_1',
    'attack+1': 'weapon_attack_plus_1', '攻击+1': 'weapon_attack_plus_1',
    'damage+1': 'weapon_damage_plus_1', '伤害+1': 'weapon_damage_plus_1',
    'init+1': 'initiative_plus_1', '先攻+1': 'initiative_plus_1',
    'speed+10': 'speed_plus_10', '速度+10': 'speed_plus_10'
  };
  return alias[t] || null;
}

// 效果表达式求值：value 可为数字或 @pb/@level/@strmod 等
function evalEffectValue(value, data, mods) {
  var v = String(value == null ? 0 : value).trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(v)) return Number(v);
  var map = {
    '@pb': Number(data.proficiency) || 0,
    '@level': Number(data.level) || 1,
    '@strmod': mods.str || 0, '@dexmod': mods.dex || 0, '@conmod': mods.con || 0,
    '@intmod': mods.int || 0, '@wismod': mods.wis || 0, '@chamod': mods.cha || 0,
    '@prof': Number(data.proficiency) || 0
  };
  if (map[v] !== undefined) return map[v];
  var m = v.match(/^@([a-z]+)\s*([+-])\s*(\d+)$/);
  if (m) {
    var base = map['@' + m[1]];
    if (base === undefined) return 0;
    return m[2] === '+' ? base + Number(m[3]) : base - Number(m[3]);
  }
  return 0;
}

// 收集某 target 的效果累计值：targets 为候选取值列表（如 ['ac','ac.bonus']）
function effectSum(data, mods, targets) {
  var sum = 0;
  var tags = Array.isArray(data.effectTags) ? data.effectTags : [];
  tags.forEach(function (tag) {
    var key = resolveEffectTagKey(tag);
    if (!key) return;
    var p = EFFECT_TAG_PRESETS[key];
    if (targets.indexOf(p.target) >= 0) sum += evalEffectValue(p.value, data, mods);
  });
  var effects = Array.isArray(data.effects) ? data.effects : [];
  effects.forEach(function (fx) {
    if (!fx || fx.enabled === false) return;
    var t = String(fx.target || '').trim();
    if (targets.indexOf(t) >= 0 && fx.mode === 'add') {
      sum += evalEffectValue(fx.value, data, mods);
    }
  });
  return sum;
}

// ── 派生值自动计算（前端 schema transform，AI 不手改） ──
// 输入 data（含 abilityScores/class/level/armor/shield/speed/currentLoad/effectTags/effects）
// 输出完整派生对象：abilityMods/proficiency/AC/initiative/speed/attackBonus/spellDC/spellAttack/
//                   carryCapacity/carryCapacityHeavy/carryStatus/skills（含加值）
function computeDerived(data) {
  data = data || {};
  var scores = data.abilityScores || {};
  var mods = {};
  ABILITIES.forEach(function (a) {
    mods[a.key] = abilityMod(scores[a.key] != null ? scores[a.key] : 10);
  });
  var level = Number(data.level) || 1;
  var prof = Number(data.proficiency) != null ? Number(data.proficiency) : proficiencyBonus(level);
  if (data.proficiency == null) prof = proficiencyBonus(level);
  var dexMod = mods.dex || 0;
  var baseSpeed = data.speed != null ? Number(data.speed) : defaultSpeed(data.race);
  // 负重状态 → 速度惩罚
  var strScore = Number(scores.str) || 0;
  var cap = carryCapacity(strScore);
  var capHeavy = carryCapacityHeavy(strScore);
  var load = Number(data.currentLoad) || 0;
  var cst = carryStatus(load, cap, capHeavy);
  var speed = baseSpeed - (cst.speedPenalty > 0 ? cst.speedPenalty : 0);
  // 效果累计
  speed += effectSum(data, mods, ['speed']);
  var AC = armorAC(data.armor || '无甲', dexMod, !!data.shield) + effectSum(data, mods, ['ac', 'ac.bonus']);
  var initiative = dexMod + effectSum(data, mods, ['initiative']);
  var attackBonus = Math.max(mods.str || 0, dexMod) + prof + effectSum(data, mods, ['attack.all', 'weapon.attack']);
  var spellDC = null;
  var spellAttack = null;
  var castingStat = CASTING_STAT[data.class];
  if (castingStat) {
    var cm = mods[castingStat] || 0;
    spellDC = 8 + prof + cm + effectSum(data, mods, ['spell.dc']);
    spellAttack = prof + cm + effectSum(data, mods, ['spell.attack']);
  }
  // 技能加值：熟练 +1、专精 +2
  var skills = {};
  var skillSrcMap = data.skillSources || {};
  SKILLS.forEach(function (s) {
    var st = (data.skills || {})[s.name] || { ability: s.ability, trained: '未熟练' };
    var abMod = mods[ABILITY_KEY[s.ability]] || 0;
    var bonus = abMod;
    if (st.trained === '专精') bonus += prof * 2;
    else if (st.trained === '熟练') bonus += prof;
    bonus += effectSum(data, mods, ['skill.all', 'skill.' + s.name]);
    skills[s.name] = { ability: s.ability, trained: st.trained, bonus: bonus, sources: skillSrcMap[s.name] || [] };
  });
  // 豁免加值
  var saves = {};
  var saveProf = data.savingThrows || {};
  ABILITIES.forEach(function (a) {
    var trained = !!saveProf[a.key];
    var bonus = mods[a.key] || 0;
    if (trained) bonus += prof;
    bonus += effectSum(data, mods, ['save.all', 'save.' + a.key]);
    saves[a.key] = { trained: trained, bonus: bonus };
  });
  // 最大HP派生：1级=骰面满值+体质修正；之后每级=平均成长(骰面一半+1)+体质修正（规则书标准模式）。
  // 升级动作不再手动累加 HP，maxHp 完全由 等级×生命骰×体质修正 实时计算 → 升级后自动跟等级走。
  var dieFace = parseInt(String(data.hitDice || 'd8').replace('d', ''), 10) || 8;
  var conHp = mods.con || 0;
  var maxHp = dieFace + conHp + Math.max(0, level - 1) * (Math.ceil(dieFace / 2) + 1 + conHp);
  maxHp += effectSum(data, mods, ['hp.max']);
  return {
    abilityMods: mods,
    maxHp: maxHp,
    proficiency: prof,
    AC: AC,
    initiative: initiative,
    speed: speed,
    baseSpeed: baseSpeed,
    attackBonus: attackBonus,
    spellDC: spellDC,
    spellAttack: spellAttack,
    carryCapacity: cap,
    carryCapacityHeavy: capHeavy,
    carryStatus: cst.name,
    carrySpeedPenalty: cst.speedPenalty,
    skills: skills,
    saves: saves
  };
}

function signed(n) {
  n = Number(n) || 0;
  return (n >= 0 ? '+' : '') + n;
}

function skillBonus(skill, data) {
  var derived = computeDerived(data);
  return (derived.skills[skill.name] || {}).bonus || 0;
}

// ── 结构化数据归一化（兼容旧纯文本 spells/equipment） ──
// 旧格式：data.spells = "法术名\n法术名"；新格式：data.spellList = [{name,level,...}]
// 旧格式：data.equipment = "物品名\n物品名"；新格式：data.items = [{name,category,quantity,...}]
function normalizeItems(data) {
  var items = Array.isArray(data.items) ? data.items : [];
  if (!items.length && data.equipment) {
    String(data.equipment).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (line) {
      items.push({ name: line, category: '杂物', quantity: 1, price: '', equipped: false, effect: '' });
    });
  }
  return items;
}
function normalizeSpells(data) {
  var spells = Array.isArray(data.spellList) ? data.spellList : [];
  if (!spells.length && data.spells) {
    String(data.spells).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (line) {
      spells.push({ name: line, level: 0, school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, prepared: false });
    });
  }
  return spells;
}
function normalizeStatuses(data) {
  if (Array.isArray(data.statuses)) return data.statuses;
  var out = [];
  var cur = data.conditions || data.currentStatus || {};
  if (cur && typeof cur === 'object') {
    Object.keys(cur).forEach(function (k) {
      var v = cur[k];
      out.push({ name: k, source: (v && v.source) || '', remaining: (v && (v.remaining || v['剩余持续时间'])) || '', desc: (v && (v.desc || v['效果'])) || '' });
    });
  }
  return out;
}

// ── AI 接口：角色当前状态摘要（紧凑文本，供带团AI读取） ──
function buildAiSummary(data) {
  data = data || {};
  var d = computeDerived(data);
  var hp = data.HP || { current: 0, max: 0, temp: 0 };
  var maxHp = d.maxHp != null ? d.maxHp : (hp.max || 0);
  var parts = [];
  parts.push('【' + (data.name || '未命名') + '】' + [data.race, data.class, data.level ? 'Lv' + data.level : ''].filter(Boolean).join(' '));
  parts.push('HP ' + hp.current + '/' + maxHp + (hp.temp ? ' 临时' + hp.temp : '') + ' | AC ' + d.AC + ' | 先攻 ' + signed(d.initiative) + ' | 速度 ' + d.speed + '尺');
  parts.push('熟练加值 ' + signed(d.proficiency) + ' | 攻击 ' + signed(d.attackBonus) + (d.spellDC != null ? ' | 法术DC ' + d.spellDC + ' | 法术攻击 ' + signed(d.spellAttack) : ''));
  // 属性
  parts.push('属性: ' + ABILITIES.map(function (a) { return a.name + a.key.toUpperCase() + ' ' + (data.abilityScores || {})[a.key] + '(' + signed(d.abilityMods[a.key]) + ')'; }).join(' '));
  // 状态
  var statuses = normalizeStatuses(data);
  if (statuses.length) parts.push('状态: ' + statuses.map(function (s) { return s.name + (s.remaining ? '(' + s.remaining + ')' : ''); }).join('、'));
  else parts.push('状态: 无');
  // 资源
  var res = [];
  var spellSlots = data.spellSlots || {};
  var used = data.spellSlotsUsed || {};
  var hasSlot = Object.keys(spellSlots).some(function (r) { return Number(spellSlots[r]) > 0; });
  if (hasSlot) res.push('法术位 ' + [1,2,3,4,5,6,7,8,9].map(function (r) {
    var t = Number(spellSlots[r]) || 0, u = Number(used[r]) || 0;
    return t > 0 ? r + '环' + (t - u) + '/' + t : '';
  }).filter(Boolean).join(' '));
  if (data.resources && typeof data.resources === 'object') {
    Object.keys(data.resources).forEach(function (k) {
      var r = data.resources[k];
      if (r) res.push(k + ' ' + (r.current != null ? r.current : 0) + '/' + (r.max != null ? r.max : 0));
    });
  }
  if (data.deathSaves) res.push('死亡豁免 ' + (data.deathSaves.success || 0) + '成/' + (data.deathSaves.failure || 0) + '败');
  if (data.inspiration) res.push('灵感✓');
  if (res.length) parts.push('资源: ' + res.join(' | '));
  // 效果
  var fx = [];
  (Array.isArray(data.effectTags) ? data.effectTags : []).forEach(function (t) {
    var k = resolveEffectTagKey(t); if (k) fx.push(EFFECT_TAG_PRESETS[k].label);
  });
  (Array.isArray(data.effects) ? data.effects : []).forEach(function (e) {
    if (e && e.name) fx.push(e.name);
  });
  if (fx.length) parts.push('生效效果: ' + fx.join('、'));
  // 生命骰
  if (data.hitDice) parts.push('生命骰 ' + (data.hitDiceRemaining != null ? data.hitDiceRemaining : data.level || 1) + '/' + (data.level || 1) + ' (' + data.hitDice + ')');
  return parts.join('\n');
}

// ── 本地持久化辅助（与宿主 persistCharacters 同构：token 写入 trpg_characters） ──
function persistTokens() {
  try {
    if (!window.MapEngine || typeof window.MapEngine.getAllTokens !== 'function') return;
    var tokens = window.MapEngine.getAllTokens();
    var arr = (tokens || []).map(function (t) {
      return {
        id: t.id, name: t.name, displayName: t.displayName, color: t.color,
        gridX: t.gridX, gridY: t.gridY,
        hp: t.hp, maxHp: t.maxHp, ac: t.ac,
        avatarUrl: t.avatarUrl, data: t.data || null
      };
    });
    localStorage.setItem('trpg_characters', JSON.stringify(arr));
  } catch (e) { /* 静默 */ }
}

// 保存角色数据：更新 token.data + 同步 HP/AC 到 token 顶层 + 落盘
function saveCharacterData(tokenId, data, opts) {
  opts = opts || {};
  try {
    var tok = window.MapEngine && window.MapEngine.getTokenById ? window.MapEngine.getTokenById(tokenId) : null;
    if (!tok) return false;
    var nd = Object.assign({}, tok.data || {}, data || {});
    var patch = { data: nd };
    var hp = nd.HP || {};
    if (hp.current != null) patch.hp = Number(hp.current) || 0;
    var derived = computeDerived(nd);
    if (derived.maxHp != null) patch.maxHp = derived.maxHp;
    if (derived.AC != null) patch.ac = derived.AC;
    window.MapEngine.updateToken(tokenId, patch);
    persistTokens();
    if (opts.toast) showToast(opts.toast);
    return true;
  } catch (e) { return false; }
}

// ── 全局通知浮条 ──
var _toastTimer = null;
function showToast(msg, type) {
  try {
    var el = document.getElementById('cb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cb-toast';
      el.className = 'cb-toast';
      document.body.appendChild(el);
    }
    el.className = 'cb-toast show' + (type === 'error' ? ' err' : type === 'gold' ? ' gold' : '');
    el.textContent = msg;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.className = 'cb-toast'; }, 2400);
  } catch (e) {}
}

// ── 掷骰引擎（优先宿主 DiceSystem，失败则内置） ──
function rollD20() {
  try {
    if (window.DiceSystem && typeof window.DiceSystem.rollOne === 'function') return window.DiceSystem.rollOne(20);
  } catch (e) {}
  return 1 + Math.floor(Math.random() * 20);
}
function rollDie(face) {
  try {
    if (window.DiceSystem && typeof window.DiceSystem.rollOne === 'function') return window.DiceSystem.rollOne(face);
  } catch (e) {}
  return 1 + Math.floor(Math.random() * face);
}

// ── 掷骰日志（右下角浮动，大成功绿脉冲/大失败红闪烁） ──
var _rollLogList = null;
function ensureRollLog() {
  try {
    if (_rollLogList && document.body.contains(_rollLogList)) return _rollLogList;
    var wrap = document.createElement('div');
    wrap.className = 'cb-rolllog';
    wrap.innerHTML = '<div class="cb-rolllog-head"><span>🎲 掷骰日志</span><button type="button" class="cb-rolllog-clear">清空</button></div>' +
      '<div class="cb-rolllog-list"></div>';
    document.body.appendChild(wrap);
    _rollLogList = wrap.querySelector('.cb-rolllog-list');
    var clearBtn = wrap.querySelector('.cb-rolllog-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { _rollLogList.innerHTML = ''; });
    // 小窗收起
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.classList.contains('cb-rolllog-head')) {
        wrap.classList.toggle('collapsed');
      }
    });
    return _rollLogList;
  } catch (e) { return null; }
}
function addRollLog(entry) {
  var list = ensureRollLog();
  if (!list) return;
  var div = document.createElement('div');
  var critCls = '';
  if (entry.raw === 20) critCls = ' crit-success';
  else if (entry.raw === 1) critCls = ' crit-fail';
  div.className = 'cb-rolllog-item' + critCls;
  div.innerHTML = '<span class="cb-rl-title">' + esc(entry.title) + '</span>' +
    '<span class="cb-rl-detail">' + esc(entry.detail || '') + '</span>' +
    '<span class="cb-rl-result">' + esc(entry.result || '') + '</span>';
  list.insertBefore(div, list.firstChild);
  while (list.children.length > 30) list.removeChild(list.lastChild);
}

// ── 通用掷骰入口：title/expr 展示、add=加值、dc=难度 ──
function playerRoll(title, add, dc, onResult) {
  var raw = rollD20();
  var total = raw + (Number(add) || 0);
  var verdict = '';
  if (raw === 20) verdict = '大成功！';
  else if (raw === 1) verdict = '大失败！';
  else if (dc != null) verdict = total >= dc ? '成功' : '失败';
  var detail = 'd20(' + raw + ')' + (add ? ' ' + signed(add) : '') + ' = ' + total + (dc != null ? ' vs DC' + dc : '');
  addRollLog({ title: title, detail: detail, result: verdict || String(total), raw: raw });
  if (onResult) onResult({ raw: raw, total: total, verdict: verdict });
  return { raw: raw, total: total, verdict: verdict };
}

// ── 升级：获得能力提示（旧逻辑保留） ──
function levelUpFeatures(oldLevel, newLevel, cls) {
  var feats = [];
  var oldProf = proficiencyBonus(oldLevel);
  var newProf = proficiencyBonus(newLevel);
  if (newProf > oldProf) {
    feats.push({ type: 'prof', text: '熟练加值提升：+' + oldProf + ' → +' + newProf + '（已自动更新）' });
  }
  if (ASI_LEVELS[newLevel]) {
    var t = '属性提升：本次升级获得「属性提升」——可将一项属性 +2 或两项各 +1，或改选一个专长（属性上限 20）';
    if (newLevel === 19) t += '；19 级同时获得一个「史诗恩惠」专长';
    feats.push({ type: 'asi', text: t });
  }
  if (ASI_LEVELS[oldLevel]) {
    feats.push({ type: 'asi-pending', text: '属性提升：上一级（' + oldLevel + ' 级）应已获得属性提升，若尚未分配请现在补选（+2 一项 / +1 两项 / 选专长）' });
  }
  if (casterType(cls)) {
    var sl = spellSlotsFor(cls, newLevel);
    feats.push({ type: 'slots', text: '施法者：达到 ' + newLevel + ' 级，法术位更新为「' + spellSlotsText(sl) + '」（已自动写入角色卡）' });
  }
  if (newLevel === 20) {
    feats.push({ type: 'max', text: '达到 20 级（最高等级），角色升级流程完成' });
  }
  feats.push({ type: 'class', text: '职业能力：请点击「查看原文」打开职业页，确认 ' + newLevel + ' 级获得的新职业能力，并在下方手动记录' });
  return feats;
}

// 应用升级：返回更新后的 data
// 注意：升级不再自动增加 HP（current/max 均不动）。maxHp 为派生值，
// 由 computeDerived 按 等级×生命骰×体质修正 实时计算 → 升级后自动跟等级走。
function applyLevelUp(data, hpGain, note) {
  data = data || {};
  var oldLevel = Number(data.level) || 1;
  var newLevel = oldLevel + 1;
  if (newLevel > 20) return null;
  var gain = Math.max(1, Math.round(Number(hpGain) || 1));
  var prof = proficiencyBonus(newLevel);
  var mods = Object.assign({}, data.abilityMods || {});
  var scores = Object.assign({}, data.abilityScores || {});
  // 法术位随等级同步（施法职业）
  var slots = spellSlotsFor(data.class || '', newLevel);
  var nd = Object.assign({}, data, {
    level: newLevel,
    proficiency: prof,
    attackBonus: Math.max(mods.str || 0, mods.dex || 0) + prof,
    initiative: mods.dex || 0,
    spellSlots: slots
  });
  // 若旧法术位不足，保留已消耗量（不超新上限）；新获得环位未消耗
  if (slots && data.spellSlotsUsed) {
    var used2 = {};
    Object.keys(slots).forEach(function (r) {
      var total = Number(slots[r]) || 0;
      var usedN = Math.min(total, Number((data.spellSlotsUsed || {})[r]) || 0);
      if (usedN > 0) used2[r] = usedN;
    });
    nd.spellSlotsUsed = used2;
  }
  // 生命骰上限 +1
  if (nd.hitDiceRemaining != null) nd.hitDiceRemaining = Math.min(newLevel, (Number(nd.hitDiceRemaining) || 0) + 1);
  else nd.hitDiceRemaining = newLevel;

  var log = Array.isArray(data.levelLog) ? data.levelLog.slice() : [];
  // hpGain 记录本次等级带来的派生最大生命增量（不再累加到 HP 字段）
  var oldMaxHp = (computeDerived(data).maxHp != null ? computeDerived(data).maxHp : Number((data.HP || {}).max) || 0);
  var newMaxHp = (computeDerived(nd).maxHp != null ? computeDerived(nd).maxHp : oldMaxHp);
  var hpGainLog = Math.max(0, newMaxHp - oldMaxHp);
  log.push({ level: newLevel, hpGain: hpGainLog, date: new Date().toISOString().slice(0, 10), note: note || '' });
  nd.levelLog = log;
  var f = String(note || '').trim();
  if (f) {
    var feats = Array.isArray(data.features) ? data.features.slice() : [];
    if (feats.indexOf(f) < 0) feats.push(f);
    nd.features = feats;
  } else if (Array.isArray(data.features)) {
    nd.features = data.features.slice();
  }
  return nd;
}

// ════════════════════════════════════════════════════════════════
// 视觉层：深色主题样式（与宿主 #1a1a2e 系统一；字体 CDN 引入）
// ════════════════════════════════════════════════════════════════
var DARK_STYLE = '' +
  '@import url("https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Noto+Serif+SC:wght@500;700&family=Noto+Sans+SC:wght@400;500;700&display=swap");' +
  '.cb2{--bg-deep:#0f0f1a;--bg-main:#1a1a2e;--bg-panel:#16213e;--bg-surface:#1e2a4a;--bg-hover:#253358;--bg-active:#2a3f6e;' +
  '--border:#2a2a4a;--border-light:#3a3a5c;--text:#e0e0f0;--text-2:#a0a0c0;--text-3:#9090a0;--text-mute:#6a6a8a;' +
  '--gold:#c9a84c;--gold-l:#e0c870;--gold-d:#a08030;--red:#e5484d;--red-l:#ff6b6b;--green:#2ecc71;--green-l:#58e39a;' +
  '--blue:#5b8def;--amber:#f0b429;' +
  'font-family:"Noto Sans SC",system-ui,-apple-system,sans-serif;color:var(--text);line-height:1.5;font-size:13px;' +
  'background:linear-gradient(160deg,#14142a 0%,#1a1a2e 50%,#10101e 100%);border:1px solid var(--border);border-radius:14px;' +
  'padding:16px;position:relative;box-shadow:0 8px 30px rgba(0,0,0,.45);' +
  'scrollbar-width:thin;scrollbar-color:var(--border-light) transparent}' +
  '.cb2 *{box-sizing:border-box}' +
  '.cb2 ::-webkit-scrollbar{width:8px;height:8px}' +
  '.cb2 ::-webkit-scrollbar-thumb{background:var(--border-light);border-radius:4px}' +
  '.cb2 ::-webkit-scrollbar-thumb:hover{background:var(--gold-d)}' +
  '.cb2 ::-webkit-scrollbar-track{background:transparent}' +
  // ── 头部 ──
  '.cb2-head{display:flex;align-items:center;gap:14px;padding:8px 6px 14px;border-bottom:1px solid var(--border);margin-bottom:12px;flex-wrap:wrap}' +
  '.cb2-avatar{width:64px;height:64px;border-radius:12px;object-fit:cover;border:2px solid var(--gold-d);background:var(--bg-surface);flex-shrink:0;box-shadow:0 2px 10px rgba(0,0,0,.4);transition:transform .25s}' +
  '.cb2-avatar:hover{transform:scale(1.06);border-color:var(--gold)}' +
  '.cb2-avatar-ph{width:64px;height:64px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:26px;background:linear-gradient(135deg,var(--bg-active),var(--bg-panel));border:2px dashed var(--border-light);color:var(--text-3);flex-shrink:0}' +
  '.cb2-title{flex:1;min-width:200px}' +
  '.cb2-name{font-family:"Cinzel","Noto Serif SC",serif;font-size:22px;font-weight:700;letter-spacing:.04em;color:var(--text);margin:0;text-shadow:0 2px 8px rgba(0,0,0,.5)}' +
  '.cb2-sub{font-family:"Noto Serif SC",serif;font-size:12.5px;color:var(--gold-l);margin-top:2px;letter-spacing:.02em}' +
  '.cb2-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
  // ── 角色切换器 ──
  '.cb2-switch{display:flex;gap:6px;align-items:center;background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:6px 8px;flex-wrap:wrap;max-width:340px}' +
  '.cb2-switch .cb2-sw-avatar{width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid var(--border-light);cursor:pointer;transition:all .2s;flex-shrink:0;background:var(--bg-surface)' +
  ';display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-2)}' +
  '.cb2-switch .cb2-sw-avatar:hover{transform:scale(1.15);border-color:var(--gold)}' +
  '.cb2-switch .cb2-sw-avatar.cur{border-color:var(--gold);box-shadow:0 0 8px rgba(201,168,76,.5)}' +
  '.cb2-sw-add{width:30px;height:30px;border-radius:50%;border:1.5px dashed var(--border-light);background:transparent;color:var(--text-3);cursor:pointer;font-size:16px;line-height:1;transition:all .2s;flex-shrink:0}' +
  '.cb2-sw-add:hover{border-color:var(--green);color:var(--green-l);transform:scale(1.12)}' +
  '.cb2-sw-del{width:30px;height:30px;border-radius:50%;border:1.5px solid var(--border-light);background:transparent;color:var(--text-3);cursor:pointer;font-size:14px;line-height:1;transition:all .2s;flex-shrink:0}' +
  '.cb2-sw-del:hover{border-color:var(--red);color:var(--red-l);transform:scale(1.12)}' +
  // ── 按钮 ──
  '.cb2-btn{border:1px solid var(--border-light);background:var(--bg-surface);color:var(--text-2);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;transition:all .2s;font-family:inherit}' +
  '.cb2-btn:hover{background:var(--bg-hover);color:var(--text);border-color:var(--gold-d);transform:translateY(-1px)}' +
  '.cb2-btn.gold{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;border:none;font-weight:700}' +
  '.cb2-btn.gold:hover{filter:brightness(1.12)}' +
  '.cb2-btn.green{background:var(--bg-surface);border-color:var(--green);color:var(--green-l)}' +
  '.cb2-btn.green:hover{background:rgba(46,204,113,.15)}' +
  '.cb2-btn.blue{background:var(--bg-surface);border-color:var(--blue);color:#9dbdf7}' +
  '.cb2-btn.blue:hover{background:rgba(91,141,239,.15)}' +
  '.cb2-btn.red{background:var(--bg-surface);border-color:var(--red);color:var(--red-l)}' +
  '.cb2-btn.red:hover{background:rgba(229,72,77,.15)}' +
  '.cb2-btn.sm{padding:4px 9px;font-size:11.5px;border-radius:6px}' +
  '.cb2-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}' +
  // ── 标签导航 ──
  '.cb2-tabs{display:flex;gap:4px;background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:4px;margin-bottom:14px;flex-wrap:wrap}' +
  '.cb2-tab{border:none;background:transparent;color:var(--text-3);padding:7px 12px;border-radius:7px;cursor:pointer;font-size:12px;font-family:inherit;display:flex;align-items:center;gap:6px;transition:all .2s}' +
  '.cb2-tab:hover{color:var(--text);background:var(--bg-hover)}' +
  '.cb2-tab.active{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;font-weight:700;box-shadow:0 2px 8px rgba(201,168,76,.35)}' +
  '.cb2-tab .cb2-ic{font-size:13px}' +
  // ── 区块 ──
  '.cb2-sec{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px;transition:border-color .2s}' +
  '.cb2-sec:hover{border-color:var(--border-light)}' +
  '.cb2-sec-h{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-family:"Noto Serif SC",serif;font-size:13px;font-weight:700;color:var(--gold-l);letter-spacing:.05em;padding-bottom:6px;border-bottom:1px solid var(--border);text-transform:uppercase}' +
  '.cb2-sec-h .cb2-sec-note{margin-left:auto;font-family:"Noto Sans SC",sans-serif;font-size:10.5px;font-weight:400;color:var(--text-3);text-transform:none}' +
  '.cb2-grid{display:grid;gap:10px}' +
  '.cb2-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}' +
  '.cb2-hint{font-size:11px;color:var(--text-3)}' +
  '.cb2-empty{color:var(--text-mute);font-size:12px;padding:14px;text-align:center;border:1px dashed var(--border);border-radius:8px;background:rgba(26,26,46,.4)}' +
  // ── 状态总览（AC/HP/先攻等圆形徽标） ──
  '.cb2-overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px;margin-bottom:14px}' +
  '.cb2-ov{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:8px 6px;text-align:center;cursor:pointer;transition:all .25s;position:relative}' +
  '.cb2-ov:hover{transform:translateY(-2px);border-color:var(--gold-d);box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
  '.cb2-ov .cb2-ov-l{font-size:10px;color:var(--text-3);letter-spacing:.06em;margin-bottom:2px}' +
  '.cb2-ov .cb2-ov-v{font-family:"Cinzel","Noto Serif SC",serif;font-size:20px;font-weight:700;line-height:1.15}' +
  '.cb2-ov .cb2-ov-s{font-size:9.5px;color:var(--text-mute);margin-top:2px}' +
  '.cb2-ov.ac .cb2-ov-v{color:var(--gold-l)}' +
  '.cb2-ov.hp .cb2-ov-v{color:var(--green-l)}' +
  '.cb2-ov.hp.low .cb2-ov-v{color:var(--red-l)}' +
  '.cb2-ov.init .cb2-ov-v{color:var(--blue)}' +
  '.cb2-ov.speed .cb2-ov-v{color:var(--text)}' +
  '.cb2-ov.prof .cb2-ov-v{color:var(--amber)}' +
  '.cb2-ov.atk .cb2-ov-v{color:var(--red-l)}' +
  '.cb2-ov.dc .cb2-ov-v{color:var(--blue)}' +
  '.cb2-hpbar{height:5px;border-radius:3px;background:var(--bg-deep);overflow:hidden;margin-top:4px}' +
  '.cb2-hpbar>i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--green-l));border-radius:3px;transition:width .4s}' +
  // ── 属性块 ──
  '.cb2-abilities{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px}' +
  '.cb2-ability{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:8px 6px;text-align:center;cursor:pointer;transition:all .25s}' +
  '.cb2-ability:hover{transform:translateY(-2px);border-color:var(--gold-d);box-shadow:0 4px 12px rgba(0,0,0,.3)}' +
  '.cb2-ability .cb2-ab-name{font-size:11px;color:var(--text-3);letter-spacing:.05em}' +
  '.cb2-ability .cb2-ab-short{font-size:9px;color:var(--text-mute);display:block}' +
  '.cb2-ability .cb2-ab-score{font-family:"Cinzel",serif;font-size:22px;font-weight:700;color:var(--text);margin:2px 0}' +
  '.cb2-ability .cb2-ab-mod{font-size:14px;font-weight:700;color:var(--gold-l)}' +
  '.cb2-ability .cb2-ab-mod.neg{color:var(--red-l)}' +
  '.cb2-ability .cb2-ab-save{margin-top:5px;border-top:1px solid var(--border);padding-top:5px;font-size:10px;color:var(--text-2)}' +
  '.cb2-ability .cb2-ab-save b{color:var(--blue);font-weight:700}' +
  '.cb2-ability .cb2-ab-save.prof::after{content:"●";color:var(--gold);font-size:8px;margin-left:3px;vertical-align:2px}' +
  // ── 技能 ──
  '.cb2-skills{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px}' +
  '.cb2-skill{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;transition:background .15s;border:1px solid transparent}' +
  '.cb2-skill:hover{background:var(--bg-hover);border-color:var(--border-light)}' +
  '.cb2-skill .cb2-sk-name{flex:1;font-size:12px;color:var(--text)}' +
  '.cb2-skill .cb2-sk-ab{font-size:9.5px;color:var(--text-mute);width:22px}' +
  '.cb2-skill .cb2-sk-bonus{font-family:"Cinzel",serif;font-weight:700;font-size:13px;color:var(--gold-l);min-width:30px;text-align:right}' +
  '.cb2-skill.trained .cb2-sk-name::after{content:"●";color:var(--gold);font-size:7px;margin-left:4px;vertical-align:2px}' +
  '.cb2-skill.expert .cb2-sk-name::after{content:"◆";color:var(--gold-l);font-size:8px;margin-left:4px;vertical-align:1px}' +
  // ── 武器/护甲/物品 ──
  '.cb2-items{display:flex;flex-direction:column;gap:8px}' +
  '.cb2-item{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:8px 10px;transition:all .2s}' +
  '.cb2-item:hover{border-color:var(--border-light);background:var(--bg-hover)}' +
  '.cb2-item.equipped{border-color:var(--gold-d);background:linear-gradient(135deg,rgba(201,168,76,.08),transparent)}' +
  '.cb2-item-top{display:flex;align-items:center;gap:8px}' +
  '.cb2-item .cb2-it-name{font-family:"Noto Serif SC",serif;font-weight:700;font-size:12.5px;color:var(--text);flex:1}' +
  '.cb2-item .cb2-it-tag{font-size:9.5px;padding:1px 7px;border-radius:10px;background:var(--bg-active);color:var(--text-2);white-space:nowrap}' +
  '.cb2-item .cb2-it-tag.weapon{background:rgba(229,72,77,.15);color:var(--red-l)}' +
  '.cb2-item .cb2-it-tag.armor{background:rgba(91,141,239,.15);color:#9dbdf7}' +
  '.cb2-item .cb2-it-tag.equip{background:rgba(46,204,113,.15);color:var(--green-l)}' +
  '.cb2-item .cb2-it-tag.wondrous{background:rgba(201,168,76,.15);color:var(--gold-l)}' +
  '.cb2-item .cb2-it-qty{font-size:11px;color:var(--text-3)}' +
  '.cb2-item .cb2-it-eff{font-size:11px;color:var(--gold-l);margin-top:4px}' +
  '.cb2-item .cb2-it-desc{font-size:11px;color:var(--text-3);margin-top:3px;line-height:1.5}' +
  '.cb2-item .cb2-it-dice{font-size:11px;color:var(--red-l);margin-top:4px;font-weight:500}' +
  '.cb2-item-actions{display:flex;gap:6px;margin-left:auto}' +
  '.cb2-micon{width:22px;height:22px;border-radius:5px;border:1px solid var(--border-light);background:transparent;color:var(--text-3);cursor:pointer;font-size:11px;line-height:1;transition:all .15s}' +
  '.cb2-micon:hover{border-color:var(--gold-d);color:var(--gold-l);transform:scale(1.1)}' +
  '.cb2-micon.eq{color:var(--green-l);border-color:var(--green)}' +
  '.cb2-micon.del:hover{border-color:var(--red);color:var(--red-l)}' +
  // ── 法术位格点 ──
  '.cb2-slotgrid{display:flex;flex-direction:column;gap:6px}' +
  '.cb2-slotrow{display:flex;align-items:center;gap:10px}' +
  '.cb2-slotrow .cb2-sl-l{font-size:11px;color:var(--text-2);min-width:42px;font-family:"Noto Serif SC",serif;font-weight:700}' +
  '.cb2-slotrow .cb2-sl-dots{display:flex;gap:6px;flex-wrap:wrap}' +
  '.cb2-slot{width:22px;height:22px;border-radius:50%;border:2px solid var(--gold-d);background:rgba(201,168,76,.18);cursor:pointer;transition:all .18s;flex-shrink:0}' +
  '.cb2-slot:hover{transform:scale(1.18);box-shadow:0 0 8px rgba(201,168,76,.55)}' +
  '.cb2-slot.used{background:var(--bg-deep);border-color:var(--border);box-shadow:inset 0 0 6px rgba(0,0,0,.6);cursor:pointer}' +
  '.cb2-slot.used:hover{border-color:var(--gold);transform:scale(1.18);box-shadow:0 0 8px rgba(201,168,76,.35)}' +
  '.cb2-slotrow .cb2-sl-n{font-size:11px;color:var(--text-3);min-width:52px}' +
  // ── 法术列表 ──
  '.cb2-spells{display:flex;flex-direction:column;gap:6px}' +
  '.cb2-spell{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:8px 10px;cursor:pointer;transition:all .2s}' +
  '.cb2-spell:hover{border-color:var(--blue);background:var(--bg-hover)}' +
  '.cb2-spell .cb2-sp-name{font-weight:600;font-size:12.5px;color:var(--text)}' +
  '.cb2-spell .cb2-sp-name .cb2-sp-ring{font-size:9px;color:var(--gold-l);border:1px solid var(--gold-d);border-radius:8px;padding:0 6px;margin-right:6px;font-family:"Noto Serif SC",serif}' +
  '.cb2-spell .cb2-sp-meta{font-size:10.5px;color:var(--text-3);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}' +
  '.cb2-spell .cb2-sp-meta b{color:var(--text-2);font-weight:500}' +
  '.cb2-spell.prepared{border-left:3px solid var(--gold)}' +
  '.cb2-spell .cb2-sp-toggle{float:right;font-size:10px;color:var(--text-3)}' +
  '.cb2-spell.prepared .cb2-sp-toggle{color:var(--gold-l)}' +
  '.cb2-spell-roll{float:right;margin-left:8px}' +
  // ── 状态效果 ──
  '.cb2-status{display:flex;gap:8px;flex-wrap:wrap}' +
  '.cb2-status-chip{display:flex;align-items:center;gap:6px;background:rgba(229,72,77,.12);border:1px solid rgba(229,72,77,.4);color:var(--red-l);border-radius:16px;padding:3px 10px;font-size:11px;cursor:pointer;transition:all .2s}' +
  '.cb2-status-chip:hover{background:rgba(229,72,77,.2);transform:scale(1.05)}' +
  '.cb2-status-chip .cb2-st-src{color:var(--text-3);font-size:9.5px}' +
  '.cb2-status-chip .cb2-st-x{opacity:.6;font-size:10px}' +
  '.cb2-status-chip.blue{background:rgba(91,141,239,.12);border-color:rgba(91,141,239,.4);color:#9dbdf7}' +
  // ── 死亡豁免 / 灵感 ──
  '.cb2-death{display:flex;gap:20px;align-items:center;flex-wrap:wrap}' +
  '.cb2-death .cb2-dh{font-size:11px;color:var(--text-2);margin-bottom:4px}' +
  '.cb2-dot{width:20px;height:20px;border-radius:50%;border:2px solid var(--border-light);cursor:pointer;transition:all .2s;background:transparent}' +
  '.cb2-dot:hover{transform:scale(1.2)}' +
  '.cb2-dot.success{background:var(--green);border-color:var(--green);box-shadow:0 0 8px rgba(46,204,113,.5)}' +
  '.cb2-dot.failure{background:var(--red);border-color:var(--red);box-shadow:0 0 8px rgba(229,72,77,.5)}' +
  '.cb2-insp{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--text-2)}' +
  '.cb2-insp-sw{width:44px;height:22px;border-radius:11px;background:var(--bg-deep);border:1px solid var(--border-light);position:relative;cursor:pointer;transition:all .25s}' +
  '.cb2-insp-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--text-mute);transition:all .25s}' +
  '.cb2-insp-sw.on{background:linear-gradient(135deg,var(--gold-d),var(--gold));border-color:var(--gold)}' +
  '.cb2-insp-sw.on::after{left:24px;background:#141414;box-shadow:0 0 8px rgba(201,168,76,.6)}' +
  // ── 资源 ──
  '.cb2-res{display:flex;gap:10px;flex-wrap:wrap}' +
  '.cb2-res-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;text-align:center;min-width:90px}' +
  '.cb2-res-card .cb2-r-name{font-size:10.5px;color:var(--text-3)}' +
  '.cb2-res-card .cb2-r-val{font-family:"Cinzel",serif;font-size:18px;font-weight:700;color:var(--amber);margin:2px 0}' +
  '.cb2-res-card .cb2-r-rec{font-size:9px;color:var(--text-mute)}' +
  // ── 升级记录 / 特性 ──
  '.cb2-feat{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:12px;color:var(--text);cursor:pointer;transition:all .2s}' +
  '.cb2-feat:hover{border-color:var(--gold-d);background:var(--bg-hover)}' +
  '.cb2-log{font-size:11px;color:var(--text-2);background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:6px 9px;margin-bottom:5px}' +
  // ── 掷骰日志 ──
  '.cb-rolllog{position:fixed;right:18px;bottom:18px;width:300px;max-height:260px;background:rgba(15,15,26,.96);border:1px solid var(--border-light);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.6);z-index:9999;overflow:hidden;backdrop-filter:blur(6px);font-family:"Noto Sans SC",system-ui,sans-serif}' +
  '.cb-rolllog.collapsed{max-height:34px}' +
  '.cb-rolllog.collapsed .cb-rolllog-list{display:none}' +
  '.cb-rolllog-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:11px;font-weight:700;color:var(--gold-l);border-bottom:1px solid var(--border);cursor:pointer;letter-spacing:.05em;text-transform:uppercase}' +
  '.cb-rolllog-clear{background:none;border:none;color:var(--text-mute);font-size:10px;cursor:pointer}' +
  '.cb-rolllog-clear:hover{color:var(--red-l)}' +
  '.cb-rolllog-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;padding:8px}' +
  '.cb-rolllog-item{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:6px 9px;display:grid;gap:2px;animation:cb2-slide .3s ease-out}' +
  '.cb-rolllog-item .cb-rl-title{font-size:11.5px;font-weight:600;color:var(--text);display:flex;justify-content:space-between}' +
  '.cb-rolllog-item .cb-rl-detail{font-size:10.5px;color:var(--text-3)}' +
  '.cb-rolllog-item .cb-rl-result{font-size:11px;font-weight:700;color:var(--gold-l)}' +
  '.cb-rolllog-item.crit-success{border:1px solid rgba(46,204,113,.7);box-shadow:0 0 12px rgba(46,204,113,.4);animation:cb2-critPulse 1.2s ease-out}' +
  '.cb-rolllog-item.crit-fail{border:1px solid rgba(229,72,77,.7);box-shadow:0 0 12px rgba(229,72,77,.4);animation:cb2-fumble .8s ease-out}' +
  '@keyframes cb2-slide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}' +
  '@keyframes cb2-critPulse{0%{transform:scale(1)}35%{transform:scale(1.05)}100%{transform:scale(1)}}' +
  '@keyframes cb2-fumble{0%{transform:translateX(0)}20%{transform:translateX(-3px)}40%{transform:translateX(3px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}100%{transform:translateX(0)}}' +
  // ── 通知浮条 ──
  '.cb2-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);background:linear-gradient(135deg,var(--green),#27ae60);color:#fff;padding:10px 22px;border-radius:10px;font-size:13px;font-weight:600;opacity:0;pointer-events:none;transition:all .35s;z-index:10000;box-shadow:0 6px 20px rgba(0,0,0,.4);font-family:"Noto Sans SC",sans-serif}' +
  '.cb2-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}' +
  '.cb2-toast.err{background:linear-gradient(135deg,var(--red),#c0392b)}' +
  '.cb2-toast.gold{background:linear-gradient(135deg,var(--gold),var(--gold-d));color:#141414}' +
  // ── 弹窗（短休/长休确认等） ──
  '.cb2-modal-mask{position:fixed;inset:0;background:rgba(5,5,12,.7);z-index:9998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);animation:cb2-fade .2s}' +
  '.cb2-modal{background:var(--bg-main);border:1px solid var(--border-light);border-radius:14px;padding:20px;width:min(420px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.6);animation:cb2-pop .25s ease-out;max-height:80vh;overflow-y:auto}' +
  '.cb2-modal h3{font-family:"Noto Serif SC",serif;color:var(--gold-l);margin:0 0 12px;font-size:15px}' +
  '.cb2-modal .cb2-m-hint{font-size:12px;color:var(--text-2);margin-bottom:12px;line-height:1.6}' +
  '.cb2-modal .cb2-m-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}' +
  '@keyframes cb2-fade{from{opacity:0}to{opacity:1}}' +
  '@keyframes cb2-pop{from{opacity:0;transform:scale(.92) translateY(10px)}to{opacity:1;transform:none}}' +
  // ── 编辑模式输入 ──
  '.cb2-in{background:var(--bg-deep);border:1px solid var(--border-light);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;font-family:inherit;width:100%;transition:border-color .2s}' +
  '.cb2-in:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 2px rgba(201,168,76,.2)}' +
  'select.cb2-in{appearance:auto}' +
  '.cb2-in-sm{width:64px}' +
  '.cb2-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-2)}' +
  '.cb2-field label{font-size:10.5px;color:var(--text-3)}' +
  '.cb2-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
  '.cb2-edit-grid .full{grid-column:1/-1}' +
  // ── tooltip 词条 ──
  '.cb2 [data-term]{cursor:help;border-bottom:1px dotted var(--text-mute)}' +
  '.cb2 [data-term]:hover{color:var(--gold-l);border-bottom-color:var(--gold)}' +
  // ── 空状态 ──
  '.cb2 .cb2-ic{display:inline-block;width:1em;text-align:center}' +
  '' +
  // 兼容旧样式名（旧插件页面快速迁移）
  '.cb-card,.cb-sheet{font-family:"Noto Sans SC",system-ui,sans-serif;color:var(--text);background:transparent}' +
  '';

// 隐藏宿主冲突样式：宿主默认 .tab-content 等，这里用独立类名避免冲突
function injectStyle() {
  try {
    var id = 'cb2-style';
    if (document.getElementById(id)) return;
    var st = document.createElement('style');
    st.id = id;
    st.textContent = DARK_STYLE.replace(/\.cb2-toast/g, '#cb-toast') + STYLE_EXTRA;
    document.head.appendChild(st);
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════════
// renderDetail：电子游戏级角色卡详情面板
// ════════════════════════════════════════════════════════════════
function getTokenAvatar(token) {
  try {
    var a = token.avatarUrl || (token.data && token.data.assets && (token.data.assets.avatarFramed || token.data.assets.avatar));
    return a || '';
  } catch (e) { return ''; }
}
function avatarHtml(token, cls, name) {
  var a = getTokenAvatar(token);
  if (a) return '<img class="' + cls + '" src="' + esc(a) + '" alt="' + esc(name || '') + '" onerror="this.style.display=\'none\'">';
  return '<div class="' + cls + '">' + esc(String((name || '?').charAt(0) || '?')) + '</div>';
}

// 角色切换器（宿主角色列表持久化由宿主实现，此处读 MapEngine）
function renderCharacterSwitcher(container, currentId, ctx) {
  var tokens = [];
  try {
    if (window.MapEngine && typeof window.MapEngine.getAllTokens === 'function') {
      tokens = window.MapEngine.getAllTokens() || [];
    }
  } catch (e) {}
  if (!tokens.length) return '';
  var items = tokens.map(function (t) {
    var cur = String(t.id) === String(currentId) ? ' cur' : '';
    var nm = (t.displayName || t.name || '角色');
    return '<span class="cb2-sw-avatar' + cur + '" data-switch="' + esc(t.id) + '" title="' + esc(nm) + '">' +
      (avatarHtml(t, 'cb2-sw-avatar-img', nm).indexOf('<img') >= 0 ? avatarHtml(t, 'cb2-sw-avatar-img', nm) : esc(nm.charAt(0))) + '</span>';
  }).join('');
  return '<div class="cb2-switch">' + items +
    '<button type="button" class="cb2-sw-add" data-act="switch-add" title="新建角色">＋</button>' +
    '<button type="button" class="cb2-sw-del" data-act="switch-del" title="删除当前角色">✕</button>' +
    '</div>';
}

// 渲染状态总览（AC/HP/先攻/速度/熟练/攻击/DC 可点击掷骰）
function renderOverview(data, derived) {
  var hp = data.HP || { current: 0, max: 0, temp: 0 };
  var maxHp = derived.maxHp != null ? derived.maxHp : (hp.max || 0);
  var pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round(hp.current / maxHp * 100))) : 0;
  var hpCls = pct <= 25 ? ' low' : '';
  var dcBlock = derived.spellDC != null ?
    '<div class="cb2-ov dc" data-act="roll-dc" title="点击掷法术攻击"><div class="cb2-ov-l">法术DC</div><div class="cb2-ov-v">' + derived.spellDC + '</div><div class="cb2-ov-s">' + signed(derived.spellAttack) + ' 攻</div></div>' : '';
  return '<div class="cb2-overview">' +
    '<div class="cb2-ov ac" data-act="roll-ac" title="护甲等级"><div class="cb2-ov-l">AC</div><div class="cb2-ov-v">' + derived.AC + '</div><div class="cb2-ov-s">' + esc(data.armor || '无甲') + (data.shield ? '+盾' : '') + '</div></div>' +
    '<div class="cb2-ov hp' + hpCls + '" data-act="hp-edit" title="点击调整生命值"><div class="cb2-ov-l">HP</div><div class="cb2-ov-v">' + hp.current + '<span style="font-size:12px;color:var(--text-3)">/' + maxHp + '</span></div>' +
    (hp.temp ? '<div class="cb2-ov-s" style="color:var(--blue)">临时+' + hp.temp + '</div>' : '<div class="cb2-ov-s">' + (maxHp - hp.current) + ' 损</div>') +
    '<div class="cb2-hpbar"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="cb2-ov init" data-act="roll-init" title="点击掷先攻"><div class="cb2-ov-l">先攻</div><div class="cb2-ov-v">' + signed(derived.initiative) + '</div><div class="cb2-ov-s">点击掷骰</div></div>' +
    '<div class="cb2-ov speed"><div class="cb2-ov-l">速度</div><div class="cb2-ov-v">' + derived.speed + '</div><div class="cb2-ov-s">尺' + (derived.carrySpeedPenalty > 0 ? ' 负重-' + derived.carrySpeedPenalty : '') + '</div></div>' +
    '<div class="cb2-ov prof"><div class="cb2-ov-l">熟练</div><div class="cb2-ov-v">' + signed(derived.proficiency) + '</div><div class="cb2-ov-s">负重' + (data.currentLoad || 0) + '/' + derived.carryCapacity + '</div></div>' +
    '<div class="cb2-ov atk" data-act="roll-atk" title="点击掷攻击"><div class="cb2-ov-l">攻击</div><div class="cb2-ov-v">' + signed(derived.attackBonus) + '</div><div class="cb2-ov-s">点击掷骰</div></div>' +
    dcBlock +
    '</div>';
}

// 渲染属性标签页（属性/豁免/技能/死亡豁免/灵感/负重）
function renderAttributesTab(data, derived, token) {
  var hp = data.HP || { current: 0, max: 0, temp: 0 };
  var scores = data.abilityScores || {};
  var abBlocks = ABILITIES.map(function (a) {
    var sc = scores[a.key] != null ? scores[a.key] : 10;
    var mod = derived.abilityMods[a.key] || 0;
    var sv = derived.saves[a.key] || { trained: false, bonus: 0 };
    return '<div class="cb2-ability" data-act="roll-ab" data-ab="' + a.key + '" title="点击掷属性检定">' +
      '<span class="cb2-ab-name" data-term="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
      '<span class="cb2-ab-short">' + a.short + '</span>' +
      '<div class="cb2-ab-score">' + sc + '</div>' +
      '<div class="cb2-ab-mod' + (mod < 0 ? ' neg' : '') + '">' + signed(mod) + '</div>' +
      '<div class="cb2-ab-save' + (sv.trained ? ' prof' : '') + '" data-act="roll-save" data-ab="' + a.key + '" title="点击掷豁免">豁免 <b>' + signed(sv.bonus) + '</b></div>' +
      '</div>';
  }).join('');
  var skillItems = SKILLS.map(function (s) {
    var sk = derived.skills[s.name] || { ability: s.ability, trained: '未熟练', bonus: 0, sources: [] };
    var cls = sk.trained === '专精' ? ' expert' : (sk.trained === '熟练' ? ' trained' : '');
    var srcTip = sk.sources && sk.sources.length ? '来源：' + sk.sources.join('、') : '';
    return '<div class="cb2-skill' + cls + '" data-act="roll-skill" data-skill="' + esc(s.name) + '" title="' + (srcTip ? esc(srcTip) + '\n' : '') + '点击掷技能检定">' +
      '<span class="cb2-sk-ab">' + esc(s.ability.charAt(0)) + '</span>' +
      '<span class="cb2-sk-name" data-term="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
      '<span class="cb2-sk-bonus">' + signed(sk.bonus) + '</span></div>';
  }).join('');
  // 死亡豁免
  var ds = data.deathSaves || { success: 0, failure: 0 };
  var deathDots = [0, 1, 2].map(function (i) {
    return '<span class="cb2-dot' + (i < ds.success ? ' success' : '') + '" data-act="death-save" data-kind="success" data-i="' + i + '" title="成功豁免"></span>';
  }).join('');
  var failDots = [0, 1, 2].map(function (i) {
    return '<span class="cb2-dot' + (i < ds.failure ? ' failure' : '') + '" data-act="death-save" data-kind="failure" data-i="' + i + '" title="失败豁免"></span>';
  }).join('');
  // 资源
  var resCards = '';
  if (data.resources && typeof data.resources === 'object') {
    resCards = Object.keys(data.resources).map(function (k) {
      var r = data.resources[k] || {};
      return '<div class="cb2-res-card"><div class="cb2-r-name">' + esc(k) + '</div>' +
        '<div class="cb2-r-val">' + (r.current != null ? r.current : 0) + '/' + (r.max != null ? r.max : 0) + '</div>' +
        '<div class="cb2-r-rec">' + esc(r.recovery || '') + '</div></div>';
    }).join('');
  }
  return '' +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">属性 <span class="cb2-sec-note">点击掷属性检定 / 豁免</span></h4><div class="cb2-abilities">' + abBlocks + '</div></div>' +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">技能 <span class="cb2-sec-note">●熟练 ◆专精 · 点击掷骰</span></h4><div class="cb2-skills">' + skillItems + '</div></div>' +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">状态</h4><div class="cb2-row" style="justify-content:space-between;flex-wrap:wrap;gap:14px">' +
    '<div class="cb2-death"><div><div class="cb2-dh">死亡豁免 · 成功</div><div style="display:flex;gap:6px">' + deathDots + '</div></div>' +
    '<div><div class="cb2-dh">死亡豁免 · 失败</div><div style="display:flex;gap:6px">' + failDots + '</div></div>' +
    '<div class="cb2-insp">灵感 <span class="cb2-insp-sw' + (data.inspiration ? ' on' : '') + '" data-act="inspiration" title="灵感（优势掷骰）"></span></div></div>' +
    '</div></div>' +
    (resCards ? '<div class="cb2-sec"><h4 class="cb2-sec-h">资源</h4><div class="cb2-res">' + resCards + '</div></div>' : '') +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">负重与生命骰</h4>' +
    '<div class="cb2-hint">负重 <b style="color:var(--gold-l)">' + (data.currentLoad || 0) + '</b> / ' + derived.carryCapacity + ' 磅（力量×15），拖/推/举 ' + derived.carryCapacityHeavy + ' 磅；状态：<b style="color:var(--gold-l)">' + derived.carryStatus + '</b>' +
    (derived.carrySpeedPenalty > 0 ? '（速度-' + derived.carrySpeedPenalty + '尺）' : '') + '</div>' +
    '<div class="cb2-hint" style="margin-top:6px">生命骰 <b style="color:var(--text)">' + esc(data.hitDice || '-') + '</b> × ' +
    '<span data-act="hd-edit" style="cursor:pointer;color:var(--gold-l)" title="点击调整剩余生命骰">' + (data.hitDiceRemaining != null ? data.hitDiceRemaining : data.level || 1) + '/' + (data.level || 1) + '</span>' +
    ' · 1级生命 = 最大骰面 + 体质修正</div></div>' +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">状态效果</h4><div class="cb2-status" id="cb2-status-list">' +
    renderStatusChips(data) + '</div></div>';
}

function renderStatusChips(data) {
  var statuses = normalizeStatuses(data);
  if (!statuses.length) return '<div class="cb2-empty">无状态效果 — 战斗中点击此处可添加「中毒/倒地/束缚」等状态</div>';
  return statuses.map(function (s, i) {
    return '<span class="cb2-status-chip" data-act="status-del" data-i="' + i + '" title="点击移除">' +
      esc(s.name) + (s.remaining ? ' <span class="cb2-st-src">' + esc(s.remaining) + '</span>' : '') +
      (s.source ? ' <span class="cb2-st-src">' + esc(s.source) + '</span>' : '') +
      ' <span class="cb2-st-x">✕</span></span>';
  }).join('');
}

// 渲染背包标签页（物品结构化：武器/护甲/奇物/杂物 + 效果系统）
function renderInventoryTab(data, derived) {
  var items = normalizeItems(data);
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">背包与装备 <span class="cb2-sec-note">' + items.length + ' 件物品 · 点击「装」装备/卸下</span></h4>' +
    '<div class="cb2-items">';
  if (!items.length) html += '<div class="cb2-empty">背包空空如也 — 点击「＋ 添加物品」录入你的装备</div>';
  items.forEach(function (it, i) {
    var cat = it.category || '杂物';
    var catCls = cat === '武器' ? 'weapon' : (cat === '护甲' ? 'armor' : (cat === '奇物' ? 'wondrous' : ''));
    var tag = catCls || '';
    var eff = it.effect || (it.magicBonus ? '魔法加值 +' + it.magicBonus : '');
    var dice = (it.damageFormula ? '伤害 ' + esc(it.damageFormula) + ' ' + esc(it.damageType || '') +
      (it.attackAbility ? ' · ' + esc(it.attackAbility) : '') : '');
    var armor = (it.baseAC ? 'AC ' + it.baseAC + (it.maxDex != null && it.maxDex < 99 ? '（敏捷上限+' + it.maxDex + '）' : '') + (it.strReq ? ' 需力量' + it.strReq : '') : '');
    html += '<div class="cb2-item' + (it.equipped ? ' equipped' : '') + '">' +
      '<div class="cb2-item-top">' +
      '<span class="cb2-it-name">' + esc(it.name) + '</span>' +
      '<span class="cb2-it-tag ' + tag + '">' + esc(cat) + '</span>' +
      (it.quantity > 1 ? '<span class="cb2-it-qty">×' + it.quantity + '</span>' : '') +
      (it.price ? '<span class="cb2-it-qty">' + esc(it.price) + '</span>' : '') +
      '<span class="cb2-item-actions">' +
      '<button type="button" class="cb2-micon eq' + (it.equipped ? '' : '') + '" data-act="item-equip" data-i="' + i + '" title="' + (it.equipped ? '卸下' : '装备') + '">' + (it.equipped ? '✓' : '装') + '</button>' +
      '<button type="button" class="cb2-micon del" data-act="item-del" data-i="' + i + '" title="删除">✕</button>' +
      '</span></div>' +
      (dice ? '<div class="cb2-it-dice">' + dice + '</div>' : '') +
      (armor ? '<div class="cb2-it-desc">' + armor + '</div>' : '') +
      (eff ? '<div class="cb2-it-eff">✨ ' + esc(eff) + '</div>' : '') +
      (it.desc ? '<div class="cb2-it-desc">' + esc(it.desc) + '</div>' : '') +
      '</div>';
  });
  html += '</div>' +
    '<div class="cb2-row" style="margin-top:10px"><button type="button" class="cb2-btn gold sm" data-act="item-add">＋ 添加物品</button></div></div>';
  // 效果系统区
  html += '<div class="cb2-sec"><h4 class="cb2-sec-h">效果系统 <span class="cb2-sec-note">effectTags + 自定义效果 → 自动累计派生值</span></h4>' +
    '<div class="cb2-hint" style="margin-bottom:8px">当前生效：' +
    (effectList(data).length ? effectList(data).map(function (e) {
      return '<span class="cb2-it-tag wondrous" style="margin-right:4px">' + esc(e.label) + '</span>';
    }).join('') : '<span style="color:var(--text-mute)">无</span>') + '</div>' +
    '<div class="cb2-row"><button type="button" class="cb2-btn blue sm" data-act="fx-add">＋ 添加效果</button>' +
    '<button type="button" class="cb2-btn sm" data-act="fx-preset">⚡ 常用效果（AC+1 / 豁免+1 / DC+1）</button></div>' +
    '<div class="cb2-hint" style="margin-top:8px">装备 +1 长剑、守护护符等魔法物品时，添加对应效果即可真实影响 AC/DC/攻击。</div></div>';
  return html;
}

function effectList(data) {
  var out = [];
  (Array.isArray(data.effectTags) ? data.effectTags : []).forEach(function (t) {
    var k = resolveEffectTagKey(t); if (k) out.push({ key: k, label: EFFECT_TAG_PRESETS[k].label, tag: true });
  });
  (Array.isArray(data.effects) ? data.effects : []).forEach(function (e) {
    if (e && e.name) out.push({ key: e.target || '', label: e.name, fx: e });
  });
  return out;
}

// 渲染特性标签页
function renderFeaturesTab(data, token, ctx) {
  var html = '';
  var feats = Array.isArray(data.features) ? data.features : [];
  html += '<div class="cb2-sec"><h4 class="cb2-sec-h">已获能力 <span class="cb2-sec-note">' + feats.length + ' 项</span></h4>';
  if (!feats.length) html += '<div class="cb2-empty">暂无记录 — 升级时在「升级弹窗」中手动记录职业能力</div>';
  feats.forEach(function (f, i) {
    html += '<div class="cb2-feat" data-term="' + esc(f) + '">' + esc(f) +
      '<button type="button" class="cb2-micon del" style="float:right" data-act="feat-del" data-i="' + i + '">✕</button></div>';
  });
  html += '</div>';
  var log = Array.isArray(data.levelLog) ? data.levelLog : [];
  if (log.length) {
    html += '<div class="cb2-sec"><h4 class="cb2-sec-h">升级记录</h4>' +
      log.map(function (lg) {
        return '<div class="cb2-log">Lv' + esc(lg.level) + ' · HP +' + esc(lg.hpGain) + (lg.date ? ' · ' + esc(lg.date) : '') + (lg.note ? ' · ' + esc(lg.note) : '') + '</div>';
      }).join('') + '</div>';
  }
  // 世界/冒险者队伍信息提示
  var world = data.world;
  if (world) {
    html += '<div class="cb2-sec"><h4 class="cb2-sec-h">世界状态</h4>' +
      '<div class="cb2-hint">' + esc(world.time || '') + (world.place ? ' · ' + esc(world.place) : '') + (world.chapter ? ' · ' + esc(world.chapter) : '') + '</div></div>';
  }
  return html;
}

// 渲染法术标签页（法术位格点 + 法术列表）
function renderSpellsTab(data, derived) {
  var spells = normalizeSpells(data);
  var slots = data.spellSlots || {};
  var used = data.spellSlotsUsed || {};
  var hasSlots = Object.keys(slots).some(function (r) { return Number(slots[r]) > 0; });
  var slotHtml = '';
  if (hasSlots) {
    slotHtml = '<div class="cb2-sec"><h4 class="cb2-sec-h">法术位 <span class="cb2-sec-note">点击格点消耗 / 恢复</span></h4><div class="cb2-slotgrid">';
    for (var ring = 1; ring <= 9; ring++) {
      var total = Number(slots[ring]) || 0;
      if (!total) continue;
      var dots = '';
      for (var d = 0; d < total; d++) {
        var isUsed = d < (Number(used[ring]) || 0);
        dots += '<span class="cb2-slot' + (isUsed ? ' used' : '') + '" data-act="slot-toggle" data-ring="' + ring + '" data-d="' + d + '" title="' + ring + '环法术位' + (isUsed ? '（已消耗，点击恢复）' : '（点击消耗）') + '"></span>';
      }
      var n = total - (Number(used[ring]) || 0);
      slotHtml += '<div class="cb2-slotrow"><span class="cb2-sl-l">' + ring + '环</span><span class="cb2-sl-dots">' + dots + '</span><span class="cb2-sl-n">' + n + '/' + total + '</span></div>';
    }
    slotHtml += '</div></div>';
  }
  // 法术分组
  var groups = {};
  spells.forEach(function (s) {
    var lv = Number(s.level) || 0;
    if (!groups[lv]) groups[lv] = [];
    groups[lv].push(s);
  });
  var spellHtml = '<div class="cb2-sec"><h4 class="cb2-sec-h">法术 <span class="cb2-sec-note">' + spells.length + ' 个 · 点击掷攻击/施法</span></h4><div class="cb2-spells">';
  if (!spells.length) spellHtml += '<div class="cb2-empty">未准备法术 — 在「编辑」中勾选职业法术，或点击「＋ 手动添加」</div>';
  [0,1,2,3,4,5,6,7,8,9].forEach(function (lv) {
    var list = groups[lv] || [];
    if (!list.length) return;
    var lvlName = lv === 0 ? '戏法' : lv + '环';
    list.forEach(function (s, i) {
      var idx = spells.indexOf(s);
      var meta = [];
      if (s.castingTime) meta.push('<b>施法</b> ' + esc(s.castingTime));
      if (s.range) meta.push('<b>距离</b> ' + esc(s.range));
      if (s.components) { var compTags = componentsTags(s.components); if (compTags) meta.push('<b>成分</b> ' + compTags); }
      if (s.duration) meta.push('<b>持续</b> ' + esc(s.duration));
      if (s.concentration) meta.push('<b style="color:var(--amber)">专注</b>');
      if (s.ritual) meta.push('<b style="color:var(--text-3)">仪式</b>');
      spellHtml += '<div class="cb2-spell' + (s.prepared ? ' prepared' : '') + '" data-act="spell-detail" data-i="' + idx + '" data-spell-desc="' + esc(s.name) + '">' +
        '<span class="cb2-sp-name"><span class="cb2-sp-ring">' + lvlName + '</span>' + esc(s.name) + '</span>' +
        (derived.spellDC != null && lv > 0 ? '<button type="button" class="cb2-btn sm cb2-spell-roll" data-act="spell-roll" data-i="' + idx + '">🎲 施法</button>' : '') +
        '<div class="cb2-sp-meta">' + (s.school ? '<b>' + esc(s.school) + '</b>' : '') + meta.join('') + '</div>' +
        (s.desc ? '<div class="cb2-it-desc" style="margin-top:4px">' + esc(String(s.desc).slice(0, 120)) + (String(s.desc).length > 120 ? '…' : '') + '</div>' : '') +
        '<div class="cb2-sp-toggle">' + (s.prepared ? '已准备' : '未准备') + '</div>' +
        '</div>';
    });
  });
  spellHtml += '</div><div class="cb2-row" style="margin-top:10px"><button type="button" class="cb2-btn gold sm" data-act="spell-add">＋ 手动添加法术</button></div></div>';
  return slotHtml + spellHtml;
}

// 渲染笔记/背景标签页
function renderNotesTab(data) {
  var notes = data.notes || {};
  var content = notes.content || '';
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">冒险笔记</h4>' +
    '<div class="cb2-hint" style="white-space:pre-wrap;line-height:1.7">' + esc(content || '（暂无笔记 — 战斗中记录的关键情报会显示在这里）') + '</div></div>';
  return html;
}
function renderBioTab(data) {
  var b = data.bio || {};
  var rows = [
    ['种族', data.race], ['职业', data.class], ['背景', data.background], ['阵营', data.alignment],
    ['体型', data.size], ['语言', data.languages], ['外貌', b.appearance], ['性格', b.personality],
    ['理想', b.ideals], ['牵绊', b.bonds], ['缺陷', b.flaws]
  ];
  // 2024 背景数据（优先取存档 bgData，兼容旧存档回查规则数据）
  var bg = data.background;
  var bgInfo = (data.bgData && data.bgData.abilities) ? data.bgData : (BACKGROUNDS[bg] || null);
  var bgHtml = '';
  if (bgInfo) {
    // 工具熟练：显示实际选择（存档 toolProfs 优先，否则回退背景文本）
    var toolShow = (data.toolProfs && data.toolProfs.length) ? data.toolProfs.join('、') : bgInfo.tool;
    // 属性加值：显示应用状态
    var attrShow = bgInfo.abilities.join('、');
    if (data.bgApplied) {
      attrShow += '（' + (data.bgApplied.mode === '21'
        ? bgInfo.abilities[0] + ' +2、' + bgInfo.abilities[1] + ' +1'
        : bgInfo.abilities.join('、') + ' 各 +1') + '）';
    }
    // 装备：显示选择（A 套装 / B 金币）
    var eqShow = bgInfo.equip;
    if (data.bgEquip === 'A' && data.bgEquipData) {
      var eqA = data.bgEquipData.A;
      var eqAText = eqA && eqA.items ? eqA.items.map(function (it) {
        return it.name + (it.quantity > 1 ? ' ×' + it.quantity : '');
      }).join('、') : '';
      eqShow = 'A 套装：' + eqAText + (eqA && eqA.gold ? '、' + eqA.gold + 'GP' : '');
    } else if (data.bgEquip === 'B') {
      eqShow = 'B：' + (data.bgGold || 50) + 'GP';
    }
    bgHtml = '<div class="cb2-bg-card" style="margin-bottom:12px">' +
      '<div class="cb2-bg-card-t">📜 ' + esc(bg) + ' <span class="cb2-bg-card-tag">2024 背景</span></div>' +
      '<div class="cb2-bg-card-grid">' +
      '<div class="cb2-bg-cell"><label>属性提升</label><div>' + esc(attrShow) + '</div></div>' +
      '<div class="cb2-bg-cell"><label>起源专长</label><div>' + esc(bgInfo.feat) + '</div></div>' +
      '<div class="cb2-bg-cell"><label>技能熟练</label><div>' + esc(bgInfo.skills.join('、')) + '</div></div>' +
      '<div class="cb2-bg-cell"><label>工具熟练</label><div>' + esc(toolShow) + '</div></div>' +
      '<div class="cb2-bg-cell full"><label>装备选择</label><div>' + esc(eqShow) + '</div></div>' +
      '</div></div>';
  }
  var html = bgHtml + '<div class="cb2-sec"><h4 class="cb2-sec-h">角色背景</h4><div class="cb2-edit-grid">' +
    rows.map(function (r) {
      return '<div class="cb2-field"><label>' + esc(r[0]) + '</label><div class="cb2-hint" style="color:var(--text);font-size:12px">' + esc(r[1] || '—') + '</div></div>';
    }).join('') + '</div></div>';
  return html;
}

// ── HP 调整弹窗 ──
function openHpModal(tokenId, data, derived) {
  var hp = data.HP || { current: 0, max: 0, temp: 0 };
  var maxHp = derived.maxHp != null ? derived.maxHp : (hp.max || 0);
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  mask.innerHTML = '<div class="cb2-modal"><h3>调整生命值</h3>' +
    '<div class="cb2-m-hint">当前 <b style="color:var(--green-l)">' + hp.current + '</b> / ' + maxHp + (hp.temp ? '（临时 +' + hp.temp + '）' : '') + '</div>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field"><label>伤害（扣减）</label><input type="number" class="cb2-in" id="cb2-hp-dmg" min="0" value="0" placeholder="0"></div>' +
    '<div class="cb2-field"><label>治疗（增加）</label><input type="number" class="cb2-in" id="cb2-hp-heal" min="0" value="0" placeholder="0"></div>' +
    '<div class="cb2-field full"><label>临时生命（覆盖）</label><input type="number" class="cb2-in" id="cb2-hp-temp" min="0" value="' + (hp.temp || 0) + '"></div>' +
    '</div>' +
    '<div class="cb2-m-actions"><button type="button" class="cb2-btn" data-cancel>取消</button>' +
    '<button type="button" class="cb2-btn green" data-ok>应用</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.getAttribute('data-cancel') != null) mask.remove();
    if (e.target.getAttribute('data-ok') != null) {
      var dmg = Math.abs(Number(mask.querySelector('#cb2-hp-dmg').value) || 0);
      var heal = Math.abs(Number(mask.querySelector('#cb2-hp-heal').value) || 0);
      var temp = Math.abs(Number(mask.querySelector('#cb2-hp-temp').value) || 0);
      var nd = Object.assign({}, data);
      var nhp = Object.assign({}, hp);
      // 先扣临时生命再扣本体（5e规则）
      if (dmg > 0) {
        var remain = dmg;
        if (nhp.temp) {
          var absorbed = Math.min(nhp.temp, remain);
          nhp.temp -= absorbed; remain -= absorbed;
        }
        nhp.current = Math.max(0, (nhp.current || 0) - remain);
      }
      nhp.current = Math.min(maxHp, (nhp.current || 0) + heal);
      if (temp > 0) nhp.temp = temp;
      nd.HP = nhp;
      saveCharacterData(tokenId, { HP: nhp }, { toast: dmg ? '已造成 ' + dmg + ' 点伤害' : (heal ? '已治疗 ' + heal + ' 点' : '临时生命已更新') });
      mask.remove();
      refreshDetail(tokenId);
    }
  });
}

// ── 短休弹窗：选择消耗生命骰数量，自动投掷+体质修正恢复 ──
function openShortRestModal(tokenId, data) {
  var level = Number(data.level) || 1;
  var remaining = data.hitDiceRemaining != null ? Number(data.hitDiceRemaining) : level;
  var die = String(data.hitDice || 'd8').replace('d', '');
  var conMod = abilityMod((data.abilityScores || {}).con);
  var hp = data.HP || {};
  var maxHp = computeDerived(data).maxHp != null ? computeDerived(data).maxHp : (hp.max || 0);
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  mask.innerHTML = '<div class="cb2-modal"><h3>⏳ 短休</h3>' +
    '<div class="cb2-m-hint">短休至少 1 小时。你可以消耗生命骰恢复生命：<br>' +
    '每颗 <b style="color:var(--gold-l)">' + esc(data.hitDice) + '</b> + 体质修正 ' + signed(conMod) + ' 点。<br>' +
    '剩余生命骰：<b style="color:var(--gold-l)">' + remaining + '/' + level + '</b> · 当前 HP ' + hp.current + '/' + maxHp + '</div>' +
    '<div class="cb2-field"><label>消耗生命骰数量</label><input type="number" class="cb2-in" id="cb2-sr-count" min="0" max="' + remaining + '" value="' + Math.min(remaining, 1) + '"></div>' +
    '<div class="cb2-m-actions"><button type="button" class="cb2-btn" data-cancel>取消</button>' +
    '<button type="button" class="cb2-btn green" data-ok>掷生命骰恢复</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.getAttribute('data-cancel') != null) mask.remove();
    if (e.target.getAttribute('data-ok') != null) {
      var count = Math.max(0, Math.min(remaining, Number(mask.querySelector('#cb2-sr-count').value) || 0));
      if (!count) { showToast('未消耗生命骰', 'error'); return; }
      var total = 0;
      for (var i = 0; i < count; i++) total += rollDie(Number(die)) + conMod;
      total = Math.max(count, total); // 每颗最低 1
      var nd = Object.assign({}, data);
      var nhp = Object.assign({}, hp);
      nhp.current = Math.min(maxHp, (nhp.current || 0) + total);
      nd.HP = nhp;
      nd.hitDiceRemaining = Math.max(0, remaining - count);
      addRollLog({ title: '短休 · 生命骰 ×' + count, detail: count + 'd' + die + ' + 体质' + signed(conMod) + '×' + count + ' = ' + total, result: '恢复 HP +' + total, raw: 0 });
      saveCharacterData(tokenId, { HP: nhp, hitDiceRemaining: nd.hitDiceRemaining }, { toast: '短休完成：HP +' + total + '，消耗 ' + count + ' 颗生命骰' });
      mask.remove();
      refreshDetail(tokenId);
    }
  });
}

// ── 长休：恢复 HP/法术位/资源/生命骰（上限一半） ──
function doLongRest(tokenId, data) {
  var level = Number(data.level) || 1;
  var nd = Object.assign({}, data);
  var hp = Object.assign({}, nd.HP || { current: 0, max: 0 });
  var maxHp = computeDerived(nd).maxHp != null ? computeDerived(nd).maxHp : (hp.max || 0);
  hp.current = maxHp;
  hp.temp = 0;
  nd.HP = hp;
  // 法术位全恢复
  if (nd.spellSlots && typeof nd.spellSlots === 'object') {
    var used = {};
    Object.keys(nd.spellSlots).forEach(function (r) { used[r] = 0; });
    nd.spellSlotsUsed = used;
  }
  // 资源恢复（按恢复规则：短休/长休/每日）
  if (nd.resources && typeof nd.resources === 'object') {
    Object.keys(nd.resources).forEach(function (k) {
      var r = nd.resources[k];
      if (!r) return;
      var rec = String(r.recovery || '').indexOf('短休') >= 0 ? true : false;
      if (rec || String(r.recovery || '').indexOf('长休') >= 0 || String(r.recovery || '').indexOf('每日') >= 0) {
        r.current = r.max;
      }
    });
  }
  // 生命骰恢复一半（向上取整）
  nd.hitDiceRemaining = Math.min(level, Math.ceil(level / 2) + (nd.hitDiceRemaining != null ? Math.max(0, Number(nd.hitDiceRemaining)) : 0));
  if (nd.hitDiceRemaining > level) nd.hitDiceRemaining = level;
  addRollLog({ title: '长休完成', detail: '恢复全部 HP / 法术位 / 资源', result: 'HP ' + hp.current + '/' + hp.max + ' · 生命骰 ' + nd.hitDiceRemaining + '/' + level, raw: 0 });
  saveCharacterData(tokenId, {
    HP: hp,
    spellSlotsUsed: nd.spellSlotsUsed,
    resources: nd.resources,
    hitDiceRemaining: nd.hitDiceRemaining
  }, { toast: '长休完成：HP、法术位、资源已恢复' });
  refreshDetail(tokenId);
}

// ── 升级弹窗（详情页内） ──
function openLevelUpModal(tokenId, data, derived) {
  var cur = Number(data.level) || 1;
  if (cur >= 20) { showToast('已达 20 级（最高等级）', 'error'); return; }
  var next = cur + 1;
  var cls = data.class || '';
  var die = String(data.hitDice || 'd8').replace('d', '');
  var conMod = derived.abilityMods.con || 0;
  var feats = levelUpFeatures(cur, next, cls);
  var oldProf = proficiencyBonus(cur), newProf = proficiencyBonus(next);
  var profTxt = oldProf !== newProf ? oldProf + ' → <b style="color:var(--gold-l)">' + newProf + '</b>（+1）' : oldProf + ' → ' + newProf + '（不变）';
  var oldSlots = spellSlotsFor(cls, cur), newSlots = spellSlotsFor(cls, next);
  var slotDiff = [];
  for (var sr = 1; sr <= 9; sr++) {
    var so = Number(oldSlots[sr]) || 0, sn = Number(newSlots[sr]) || 0;
    if (sn > so) slotDiff.push(sr + '环 +' + (sn - so));
  }
  var asiNote = ASI_LEVELS[next] && !feats.some(function (f) { return String(f.text || '').indexOf('属性提升') >= 0; })
    ? '🎖 本等级获得「属性提升」：可将一项属性 +2 或两项各 +1，或改选一个专长（属性上限 20）。<br>' : '';
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  mask.innerHTML = '<div class="cb2-modal"><h3>⬆ 升级：Lv' + cur + ' → Lv' + next + '（' + esc(cls || '自定义') + ' · ' + esc(data.hitDice) + '）</h3>' +
    '<div class="cb2-m-hint">生命骰 <b style="color:var(--gold-l)">' + esc(data.hitDice) + '</b> + 体质修正 ' + signed(conMod) + '<br>' +
    '熟练加值：' + profTxt + '<br>' +
    (slotDiff.length ? '法术位变化：<b style="color:var(--gold-l)">' + slotDiff.join('、') + '</b><br>' : '') +
    (asiNote ? '<span style="font-size:11.5px;color:var(--amber)">' + asiNote + '</span>' : '') +
    '升级将自动更新：最大生命值 / 攻击加值 / 法术位 / 先攻 / DC（派生值实时计算）<br>' +
    '<span style="font-size:11px;color:var(--text-3)">最大生命值由「等级 × 生命骰 × 体质修正」自动计算，升级不额外累加血量</span></div>' +
    '<div class="cb2-field" style="margin-top:8px"><label>本等级能力记录（可选）</label><input type="text" class="cb2-in" id="cb2-lv-note" placeholder="如：获得「旋风斩」职业能力"></div>' +
    (feats.length ? '<div class="cb2-m-hint" style="margin-top:8px;font-size:11px;color:var(--gold-l)">' +
      feats.map(function (f) { return '• ' + esc(f.text); }).join('<br>') + '</div>' : '') +
    '<div class="cb2-m-actions"><button type="button" class="cb2-btn" data-cancel>取消</button>' +
    '<button type="button" class="cb2-btn green" data-ok>确认升级</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.getAttribute('data-cancel') != null) mask.remove();
    if (e.target.getAttribute('data-ok') != null) {
      var oldMax = derived.maxHp != null ? derived.maxHp : (Number((data.HP || {}).max) || 0);
      var nd = applyLevelUp(data, 0, mask.querySelector('#cb2-lv-note').value);
      if (!nd) { showToast('已达 20 级', 'error'); return; }
      var newMax = computeDerived(nd).maxHp != null ? computeDerived(nd).maxHp : oldMax;
      var gain = Math.max(0, newMax - oldMax);
      saveCharacterData(tokenId, nd, { toast: '升级成功：Lv' + next + '，最大生命 ' + oldMax + ' → ' + newMax + (gain > 0 ? '（+' + gain + '）' : '') });
      mask.remove();
      refreshDetail(tokenId);
    }
  });
}

// ── 添加物品弹窗 ──
function openItemModal(tokenId, data, editIndex) {
  var items = normalizeItems(data);
  var it = editIndex != null ? items[editIndex] : { name: '', category: '武器', quantity: 1, price: '', equipped: false, effect: '', desc: '', damageFormula: '', damageType: '挥砍', attackAbility: '力量', magicBonus: 0, baseAC: 10, maxDex: 99, strReq: 0 };
  var cats = ['武器', '护甲', '奇物', '杂物', '药水', '卷轴', '工具', '货币'];
  var catOpts = cats.map(function (c) { return '<option value="' + c + '"' + (it.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  mask.innerHTML = '<div class="cb2-modal"><h3>' + (editIndex != null ? '编辑物品' : '＋ 添加物品') + '</h3>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field full"><label>名称</label><input type="text" class="cb2-in" id="cb2-it-name" value="' + esc(it.name) + '" placeholder="如：+1 长剑"></div>' +
    '<div class="cb2-field"><label>类别</label><select class="cb2-in" id="cb2-it-cat">' + catOpts + '</select></div>' +
    '<div class="cb2-field"><label>数量</label><input type="number" class="cb2-in" id="cb2-it-qty" min="1" value="' + (it.quantity || 1) + '"></div>' +
    '<div class="cb2-field"><label>价格</label><input type="text" class="cb2-in" id="cb2-it-price" value="' + esc(it.price || '') + '" placeholder="如：15 金币"></div>' +
    '<div class="cb2-field"><label>效果（如：AC+1 / 豁免+1）</label><input type="text" class="cb2-in" id="cb2-it-eff" value="' + esc(it.effect || '') + '" placeholder="魔法效果描述"></div>' +
    '<div class="cb2-field"><label>魔法加值</label><input type="number" class="cb2-in" id="cb2-it-magic" min="0" value="' + (it.magicBonus || 0) + '"></div>' +
    '<div class="cb2-field full" id="cb2-weapon-row" style="display:' + (it.category === '武器' ? 'grid' : 'none') + ';grid-template-columns:1fr 1fr;gap:8px">' +
    '<div class="cb2-field"><label>伤害公式</label><input type="text" class="cb2-in" id="cb2-it-dmg" value="' + esc(it.damageFormula || '') + '" placeholder="1d8"></div>' +
    '<div class="cb2-field"><label>伤害类型</label><input type="text" class="cb2-in" id="cb2-it-dtype" value="' + esc(it.damageType || '') + '" placeholder="挥砍"></div>' +
    '<div class="cb2-field"><label>攻击属性</label><select class="cb2-in" id="cb2-it-attr"><option>力量</option><option>敏捷</option><option>智力</option><option>感知</option><option>魅力</option></select></div>' +
    '</div>' +
    '<div class="cb2-field full"><label>描述</label><input type="text" class="cb2-in" id="cb2-it-desc" value="' + esc(it.desc || '') + '"></div>' +
    '</div>' +
    '<div class="cb2-m-actions"><button type="button" class="cb2-btn" data-cancel>取消</button>' +
    '<button type="button" class="cb2-btn gold" data-ok>保存</button></div></div>';
  document.body.appendChild(mask);
  var catSel = mask.querySelector('#cb2-it-cat');
  catSel.addEventListener('change', function () {
    mask.querySelector('#cb2-weapon-row').style.display = catSel.value === '武器' ? 'grid' : 'none';
  });
  var attrSel = mask.querySelector('#cb2-it-attr');
  if (it.attackAbility) {
    Array.prototype.forEach.call(attrSel.options, function (o) { if (o.value === it.attackAbility) o.selected = true; });
  }
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.getAttribute('data-cancel') != null) mask.remove();
    if (e.target.getAttribute('data-ok') != null) {
      var items2 = normalizeItems(data).slice();
      var ni = {
        name: mask.querySelector('#cb2-it-name').value.trim(),
        category: catSel.value,
        quantity: Math.max(1, Number(mask.querySelector('#cb2-it-qty').value) || 1),
        price: mask.querySelector('#cb2-it-price').value.trim(),
        equipped: it.equipped,
        effect: mask.querySelector('#cb2-it-eff').value.trim(),
        desc: mask.querySelector('#cb2-it-desc').value.trim(),
        magicBonus: Number(mask.querySelector('#cb2-it-magic').value) || 0
      };
      if (catSel.value === '武器') {
        ni.damageFormula = mask.querySelector('#cb2-it-dmg').value.trim() || '1d6';
        ni.damageType = mask.querySelector('#cb2-it-dtype').value.trim() || '挥砍';
        ni.attackAbility = attrSel.value;
      }
      if (catSel.value === '护甲') {
        ni.baseAC = it.baseAC || 10;
        ni.maxDex = it.maxDex != null ? it.maxDex : 99;
        ni.strReq = it.strReq || 0;
      }
      if (!ni.name) { showToast('物品名称不能为空', 'error'); return; }
      if (editIndex != null) items2[editIndex] = ni; else items2.push(ni);
      // 同步装备状态到 data.armor（护甲装备时自动更新 AC 公式）
      var nd = Object.assign({}, data, { items: items2 });
      saveCharacterData(tokenId, nd, { toast: editIndex != null ? '物品已更新' : '已添加：' + ni.name });
      mask.remove();
      refreshDetail(tokenId);
    }
  });
}

// ── 添加效果弹窗 ──
function openFxModal(tokenId, data) {
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  var targets = ['ac', 'save.all', 'skill.all', 'spell.dc', 'spell.attack', 'attack.all', 'damage.all', 'initiative', 'speed', 'hp.max'];
  var targetOpts = targets.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
  mask.innerHTML = '<div class="cb2-modal"><h3>⚡ 添加自定义效果</h3>' +
    '<div class="cb2-m-hint">效果自动累计到派生值。value 支持数字或表达式：<b style="color:var(--gold-l)">@pb / @level / @strmod / @dexmod / @conmod</b></div>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field full"><label>效果名称</label><input type="text" class="cb2-in" id="cb2-fx-name" placeholder="如：+1 长剑加成"></div>' +
    '<div class="cb2-field"><label>目标（target）</label><select class="cb2-in" id="cb2-fx-target">' + targetOpts + '</select></div>' +
    '<div class="cb2-field"><label>数值（value）</label><input type="text" class="cb2-in" id="cb2-fx-value" value="1" placeholder="1 或 @pb"></div>' +
    '</div>' +
    '<div class="cb2-m-actions"><button type="button" class="cb2-btn" data-cancel>取消</button>' +
    '<button type="button" class="cb2-btn gold" data-ok>添加</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.getAttribute('data-cancel') != null) mask.remove();
    if (e.target.getAttribute('data-ok') != null) {
      var name = mask.querySelector('#cb2-fx-name').value.trim();
      var target = mask.querySelector('#cb2-fx-target').value;
      var value = mask.querySelector('#cb2-fx-value').value.trim();
      if (!name) { showToast('效果名称不能为空', 'error'); return; }
      var effects = Array.isArray(data.effects) ? data.effects.slice() : [];
      effects.push({ name: name, target: target, mode: 'add', value: value, enabled: true });
      saveCharacterData(tokenId, { effects: effects }, { toast: '已添加效果：' + name });
      mask.remove();
      refreshDetail(tokenId);
    }
  });
}

// ── 常用效果预设一键添加 ──
function addFxPreset(tokenId, data, key) {
  var p = EFFECT_TAG_PRESETS[key];
  if (!p) return;
  var tags = Array.isArray(data.effectTags) ? data.effectTags.slice() : [];
  if (tags.indexOf(key) >= 0) { showToast('该效果已存在', 'error'); return; }
  tags.push(key);
  saveCharacterData(tokenId, { effectTags: tags }, { toast: '已启用：' + p.label });
  refreshDetail(tokenId);
}

// ── 添加状态弹窗 ──
function openStatusModal(tokenId, data) {
  var presets = ['中毒', '倒地', '束缚', '麻痹', '恐惧', '失明', '耳聋', '石化', '魅惑', '力竭', '隐身', '受惊'];
  var opts = presets.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join('');
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  mask.innerHTML = '<div class="cb2-modal"><h3>添加状态效果</h3>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field"><label>状态</label><select class="cb2-in" id="cb2-st-name">' + opts + '</select></div>' +
    '<div class="cb2-field"><label>剩余时间</label><input type="text" class="cb2-in" id="cb2-st-rem" placeholder="如：1分钟 / 10轮"></div>' +
    '<div class="cb2-field full"><label>来源</label><input type="text" class="cb2-in" id="cb2-st-src" placeholder="如：蜘蛛毒液"></div>' +
    '</div>' +
    '<div class="cb2-m-actions"><button type="button" class="cb2-btn" data-cancel>取消</button>' +
    '<button type="button" class="cb2-btn gold" data-ok>添加</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.getAttribute('data-cancel') != null) mask.remove();
    if (e.target.getAttribute('data-ok') != null) {
      var statuses = normalizeStatuses(data).slice();
      statuses.push({
        name: mask.querySelector('#cb2-st-name').value,
        remaining: mask.querySelector('#cb2-st-rem').value.trim(),
        source: mask.querySelector('#cb2-st-src').value.trim(),
        desc: ''
      });
      saveCharacterData(tokenId, { statuses: statuses }, { toast: '已添加状态' });
      mask.remove();
      refreshDetail(tokenId);
    }
  });
}

// ── 添加法术弹窗 ──
function openSpellModal(tokenId, data, editIndex) {
  var spells = normalizeSpells(data);
  var s = editIndex != null ? spells[editIndex] : { name: '', level: 1, school: '', castingTime: '1 动作', range: '60 尺', components: 'V, S', duration: '瞬间', concentration: false, prepared: true, ritual: false, desc: '' };
  var ringOpts = '';
  for (var r = 0; r <= 9; r++) {
    var label = r === 0 ? '戏法' : r + '环';
    ringOpts += '<option value="' + r + '"' + (Number(s.level) === r ? ' selected' : '') + '>' + label + '</option>';
  }
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  mask.innerHTML = '<div class="cb2-modal"><h3>' + (editIndex != null ? '编辑法术' : '＋ 手动添加法术') + '</h3>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field full"><label>法术名称</label><input type="text" class="cb2-in" id="cb2-sp-name" value="' + esc(s.name) + '" placeholder="如：火球术"></div>' +
    '<div class="cb2-field"><label>环阶</label><select class="cb2-in" id="cb2-sp-ring">' + ringOpts + '</select></div>' +
    '<div class="cb2-field"><label>学派</label><input type="text" class="cb2-in" id="cb2-sp-school" value="' + esc(s.school || '') + '" placeholder="塑能"></div>' +
    '<div class="cb2-field"><label>施法时间</label><input type="text" class="cb2-in" id="cb2-sp-time" value="' + esc(s.castingTime || '') + '"></div>' +
    '<div class="cb2-field"><label>距离</label><input type="text" class="cb2-in" id="cb2-sp-range" value="' + esc(s.range || '') + '"></div>' +
    '<div class="cb2-field"><label>成分</label><input type="text" class="cb2-in" id="cb2-sp-comp" value="' + esc(s.components || '') + '"></div>' +
    '<div class="cb2-field"><label>持续时间</label><input type="text" class="cb2-in" id="cb2-sp-dur" value="' + esc(s.duration || '') + '"></div>' +
    '<div class="cb2-field"><label>准备状态</label><select class="cb2-in" id="cb2-sp-prep"><option value="1"' + (s.prepared ? ' selected' : '') + '>已准备</option><option value="0"' + (!s.prepared ? ' selected' : '') + '>未准备</option></select></div>' +
    '<div class="cb2-field"><label>专注</label><select class="cb2-in" id="cb2-sp-conc"><option value="1"' + (s.concentration ? ' selected' : '') + '>是</option><option value="0"' + (!s.concentration ? ' selected' : '') + '>否</option></select></div>' +
    '<div class="cb2-field full"><label>描述</label><textarea class="cb2-in" id="cb2-sp-desc" rows="3">' + esc(s.desc || '') + '</textarea></div>' +
    '</div>' +
    '<div class="cb2-m-actions"><button type="button" class="cb2-btn" data-cancel>取消</button>' +
    '<button type="button" class="cb2-btn gold" data-ok>保存</button></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.getAttribute('data-cancel') != null) mask.remove();
    if (e.target.getAttribute('data-ok') != null) {
      var name = mask.querySelector('#cb2-sp-name').value.trim();
      if (!name) { showToast('法术名称不能为空', 'error'); return; }
      var ns = {
        name: name,
        level: Number(mask.querySelector('#cb2-sp-ring').value),
        school: mask.querySelector('#cb2-sp-school').value.trim(),
        castingTime: mask.querySelector('#cb2-sp-time').value.trim(),
        range: mask.querySelector('#cb2-sp-range').value.trim(),
        components: mask.querySelector('#cb2-sp-comp').value.trim(),
        duration: mask.querySelector('#cb2-sp-dur').value.trim(),
        prepared: mask.querySelector('#cb2-sp-prep').value === '1',
        concentration: mask.querySelector('#cb2-sp-conc').value === '1',
        ritual: false,
        desc: mask.querySelector('#cb2-sp-desc').value.trim()
      };
      var spells2 = normalizeSpells(data).slice();
      if (editIndex != null) spells2[editIndex] = ns; else spells2.push(ns);
      saveCharacterData(tokenId, { spellList: spells2 }, { toast: editIndex != null ? '法术已更新' : '已添加法术：' + name });
      mask.remove();
      refreshDetail(tokenId);
    }
  });
}

// 刷新详情（宿主重新渲染）
function refreshDetail(tokenId) {
  try {
    if (window.UIManager && typeof window.UIManager.showCharacterDetail === 'function') {
      window.UIManager.showCharacterDetail(tokenId);
    }
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════════
// renderDetail 主函数
// ════════════════════════════════════════════════════════════════
function renderDetail(container, token, ctx) {
  injectStyle();
  var d = (token && token.data) || {};
  var derived = computeDerived(d);
  var tokenId = token.id;
  var tab = (ctx && ctx._cbTab) || 'bio';

  // 组装头部
  var head = '<div class="cb2-head">' +
    avatarHtml(token, 'cb2-avatar', d.name || token.name) +
    '<div class="cb2-title">' +
    '<div class="cb2-name">' + esc(d.name || token.name || '未命名角色') + '</div>' +
    '<div class="cb2-sub">' + [d.race, d.class, d.background, d.level ? 'Lv' + d.level : ''].filter(Boolean).join(' · ') + '</div>' +
    '</div>' +
    '<div class="cb2-actions">' +
    '<button type="button" class="cb2-btn" data-act="roll-d20" title="掷 d20">🎲 d20</button>' +
    '<button type="button" class="cb2-btn gold" data-act="levelup" title="升级到下一级">⬆ 升级</button>' +
    '<button type="button" class="cb2-btn blue" data-act="ai-summary" title="复制AI状态摘要">🤖 AI摘要</button>' +
    (ctx && ctx.openRuleFile && d.class ? '<button type="button" class="cb2-btn" data-act="open-src">📖 原文</button>' : '') +
    (window.UIManager && window.UIManager.openCharacterModalForEdit ? '<button type="button" class="cb2-btn green" data-act="edit-sheet">✏️ 编辑</button>' : '') +
    '</div></div>';

  // 标签导航（多页区分：首页背景 → 属性 → 道具 → 法术 → 特性 → 笔记）
  var tabs = [
    ['bio', '👤', '背景'], ['attr', '⚔️', '属性'], ['inv', '🎒', '道具'],
    ['spell', '🔮', '法术'], ['feat', '⭐', '特性'], ['note', '📝', '笔记']
  ];
  var tabHtml = '<div class="cb2-tabs">' + tabs.map(function (t) {
    return '<button type="button" class="cb2-tab' + (tab === t[0] ? ' active' : '') + '" data-act="tab" data-tab="' + t[0] + '">' +
      '<span class="cb2-ic">' + t[1] + '</span>' + t[2] + '</button>';
  }).join('') + '</div>';

  // 休息区
  var restBar = '<div class="cb2-row" style="margin-top:4px;gap:8px">' +
    '<button type="button" class="cb2-btn green" data-act="short-rest">⏳ 短休</button>' +
    '<button type="button" class="cb2-btn blue" data-act="long-rest">🌙 长休</button>' +
    '<span class="cb2-hint">短休：消耗生命骰恢复 · 长休：恢复HP/法术位/资源</span></div>';

  var tabContent = {
    attr: renderAttributesTab(d, derived, token),
    inv: renderInventoryTab(d, derived),
    feat: renderFeaturesTab(d, token, ctx),
    spell: renderSpellsTab(d, derived),
    note: renderNotesTab(d),
    bio: renderBioTab(d)
  }[tab] || renderAttributesTab(d, derived, token);

  var sw = renderCharacterSwitcher(container, tokenId, ctx);
  container.innerHTML = '<div class="cb2" data-token="' + esc(tokenId) + '">' +
    (sw ? '<div class="cb2-row" style="margin-bottom:10px">' + sw + '</div>' : '') +
    head + renderOverview(d, derived) + tabHtml +
    '<div class="cb2-grid">' + tabContent + '</div>' + restBar +
    '</div>';

  // 法术悬浮效果小窗（mouseover 委托：data-spell-desc）
  container.addEventListener('mouseover', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    var el = t && t.getAttribute ? t : null;
    while (el && el !== container && !el.getAttribute('data-spell-desc')) el = el.parentNode;
    if (el && el !== container && el.getAttribute('data-spell-desc')) {
      showSpellTip(el, el.getAttribute('data-spell-desc'), ctx);
    }
  });
  container.addEventListener('mouseout', function () { hideSpellTip(); });

  // ═══ 事件绑定（事件委托） ═══
  container.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    var actEl = t;
    while (actEl && actEl !== container && !actEl.getAttribute('data-act')) actEl = actEl.parentNode;
    if (!actEl || actEl === container) return;
    var act = actEl.getAttribute('data-act');
    var data2 = (token && token.data) || {};
    var derived2 = computeDerived(data2);

    // 标签切换
    if (act === 'tab') {
      ctx._cbTab = actEl.getAttribute('data-tab');
      refreshDetail(tokenId);
      return;
    }
    // 角色切换
    if (act === 'switch-add') {
      if (window.UIManager && window.UIManager.openCharacterModal) window.UIManager.openCharacterModal();
      return;
    }
    if (act === 'switch-del') {
      if (window.confirm('确认删除角色「' + (token.displayName || token.name) + '」？此操作不可撤销。')) {
        if (window.UIManager && window.UIManager.deleteCharacter) window.UIManager.deleteCharacter(tokenId);
      }
      return;
    }
    var switchId = actEl.getAttribute('data-switch');
    if (switchId && switchId !== tokenId) {
      if (window.UIManager && window.UIManager.showCharacterDetail) window.UIManager.showCharacterDetail(switchId);
      return;
    }
    // 掷骰
    if (act === 'roll-d20') { playerRoll('d20 检定', 0, null); return; }
    if (act === 'roll-ac') { playerRoll('AC 展示', 0, null); addRollLog({ title: '护甲等级', detail: '当前 AC', result: String(derived2.AC), raw: 0 }); return; }
    if (act === 'roll-init') { playerRoll('先攻检定', derived2.initiative, null); return; }
    if (act === 'roll-atk') { playerRoll('攻击检定', derived2.attackBonus, null); return; }
    if (act === 'roll-dc') { playerRoll('法术攻击', derived2.spellAttack != null ? derived2.spellAttack : 0, null); return; }
    if (act === 'roll-ab') {
      var ab = actEl.getAttribute('data-ab');
      var mod = derived2.abilityMods[ab] || 0;
      playerRoll(ABILITIES.filter(function (a) { return a.key === ab; })[0].name + '检定', mod, null);
      return;
    }
    if (act === 'roll-save') {
      var ab2 = actEl.getAttribute('data-ab');
      var sv = derived2.saves[ab2] || { bonus: 0 };
      playerRoll(ABILITIES.filter(function (a) { return a.key === ab2; })[0].name + '豁免', sv.bonus, null);
      return;
    }
    if (act === 'roll-skill') {
      var sk = actEl.getAttribute('data-skill');
      var sb = derived2.skills[sk] || { bonus: 0 };
      playerRoll(sk + '检定', sb.bonus, null);
      return;
    }
    if (act === 'spell-roll') {
      var si = Number(actEl.getAttribute('data-i'));
      var sp = normalizeSpells(data2)[si];
      if (sp) playerRoll('施放 ' + sp.name, derived2.spellAttack != null ? derived2.spellAttack : 0, derived2.spellDC, function (r) {
        addRollLog({ title: '法术命中判定', detail: sp.name + ' 攻击 vs DC' + derived2.spellDC, result: r.verdict || String(r.total), raw: r.raw });
      });
      return;
    }
    // 生命值
    if (act === 'hp-edit') { openHpModal(tokenId, data2, derived2); return; }
    // 休息
    if (act === 'short-rest') { openShortRestModal(tokenId, data2); return; }
    if (act === 'long-rest') {
      if (window.confirm('进行长休？将恢复全部 HP、法术位、资源，并恢复一半生命骰。')) doLongRest(tokenId, data2);
      return;
    }
    // 升级
    if (act === 'levelup') { openLevelUpModal(tokenId, data2, derived2); return; }
    // 死亡豁免
    if (act === 'death-save') {
      var kind = actEl.getAttribute('data-kind');
      var i = Number(actEl.getAttribute('data-i'));
      var ds = Object.assign({}, data2.deathSaves || { success: 0, failure: 0 });
      var cur = Number(ds[kind]) || 0;
      if (i < cur) { ds[kind] = i; }
      else if (i === cur) { ds[kind] = cur + 1; }
      else { ds[kind] = i + 1; }
      if (ds[kind] > 3) ds[kind] = 3;
      saveCharacterData(tokenId, { deathSaves: ds }, { toast: '死亡豁免已更新' });
      refreshDetail(tokenId);
      return;
    }
    // 灵感
    if (act === 'inspiration') {
      saveCharacterData(tokenId, { inspiration: !data2.inspiration }, { toast: data2.inspiration ? '灵感已消耗' : '灵感已获得！', type: 'gold' });
      refreshDetail(tokenId);
      return;
    }
    // 生命骰剩余
    if (act === 'hd-edit') {
      var nv = window.prompt('剩余生命骰数量（0-' + (data2.level || 1) + '）：', data2.hitDiceRemaining != null ? data2.hitDiceRemaining : data2.level || 1);
      if (nv != null && nv !== '') {
        var nn = Math.max(0, Math.min(data2.level || 1, Number(nv) || 0));
        saveCharacterData(tokenId, { hitDiceRemaining: nn }, { toast: '生命骰剩余 ' + nn });
        refreshDetail(tokenId);
      }
      return;
    }
    // 物品
    if (act === 'item-add') { openItemModal(tokenId, data2, null); return; }
    if (act === 'item-equip') {
      var ii = Number(actEl.getAttribute('data-i'));
      var items3 = normalizeItems(data2).slice();
      if (items3[ii]) {
        items3[ii].equipped = !items3[ii].equipped;
        // 护甲装备时联动 data.armor（取最近装备的护甲）
        var armorNow = data2.armor || '无甲';
        var equippedArmor = items3.filter(function (x) { return x.equipped && x.category === '护甲'; });
        var nd2 = Object.assign({}, data2, { items: items3 });
        if (items3[ii].category === '护甲' && items3[ii].equipped) {
          nd2.armor = items3[ii].name;
        } else if (items3[ii].category === '护甲' && !items3[ii].equipped) {
          nd2.armor = equippedArmor.length ? equippedArmor[equippedArmor.length - 1].name : '无甲';
        }
        saveCharacterData(tokenId, nd2, { toast: items3[ii].equipped ? '已装备：' + items3[ii].name : '已卸下：' + items3[ii].name });
        refreshDetail(tokenId);
      }
      return;
    }
    if (act === 'item-del') {
      var di = Number(actEl.getAttribute('data-i'));
      var items4 = normalizeItems(data2).slice();
      if (items4[di]) {
        var removed = items4.splice(di, 1)[0];
        if (removed.category === '护甲' && data2.armor === removed.name) {
          var nd3 = Object.assign({}, data2, { items: items4, armor: '无甲' });
          saveCharacterData(tokenId, nd3, { toast: '已删除：' + removed.name });
        } else {
          saveCharacterData(tokenId, { items: items4 }, { toast: '已删除：' + removed.name });
        }
        refreshDetail(tokenId);
      }
      return;
    }
    // 效果
    if (act === 'fx-add') { openFxModal(tokenId, data2); return; }
    if (act === 'fx-preset') {
      // 一键添加常用三件套
      addFxPreset(tokenId, data2, 'ac_plus_1');
      setTimeout(function () { addFxPreset(tokenId, data2, 'save_plus_1'); }, 120);
      setTimeout(function () { addFxPreset(tokenId, data2, 'spell_dc_plus_1'); }, 240);
      return;
    }
    // 状态
    if (act === 'status-add') { openStatusModal(tokenId, data2); return; }
    if (act === 'status-del') {
      var sdi = Number(actEl.getAttribute('data-i'));
      var sts = normalizeStatuses(data2).slice();
      if (sts[sdi]) {
        sts.splice(sdi, 1);
        saveCharacterData(tokenId, { statuses: sts }, { toast: '已移除状态' });
        refreshDetail(tokenId);
      }
      return;
    }
    // 法术位格点
    if (act === 'slot-toggle') {
      var ring = actEl.getAttribute('data-ring');
      var dpos = Number(actEl.getAttribute('data-d'));
      var used2 = Object.assign({}, data2.spellSlotsUsed || {});
      var curUsed = Number(used2[ring]) || 0;
      var isUsed = dpos < curUsed;
      used2[ring] = isUsed ? dpos : dpos + 1;
      saveCharacterData(tokenId, { spellSlotsUsed: used2 }, { toast: isUsed ? ring + '环法术位已恢复' : ring + '环法术位已消耗' });
      refreshDetail(tokenId);
      return;
    }
    // 法术
    if (act === 'spell-add') { openSpellModal(tokenId, data2, null); return; }
    if (act === 'spell-detail') {
      var spi = Number(actEl.getAttribute('data-i'));
      openSpellModal(tokenId, data2, spi);
      return;
    }
    // 特性
    if (act === 'feat-del') {
      var fi = Number(actEl.getAttribute('data-i'));
      var feats = (Array.isArray(data2.features) ? data2.features : []).slice();
      if (feats[fi]) {
        feats.splice(fi, 1);
        saveCharacterData(tokenId, { features: feats }, { toast: '已删除能力记录' });
        refreshDetail(tokenId);
      }
      return;
    }
    // AI 摘要
    if (act === 'ai-summary') {
      var summary = buildAiSummary(data2);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(summary).then(function () {
            showToast('AI状态摘要已复制到剪贴板');
          }, function () { showToast(summary.slice(0, 40) + '…（请手动复制）'); });
        } else { showToast(summary.slice(0, 40) + '…（请手动复制）'); }
      } catch (err) { showToast(summary.slice(0, 40) + '…（请手动复制）'); }
      return;
    }
    // 打开原文 / 编辑
    if (act === 'open-src' && ctx && ctx.openRuleFile) {
      ctx.openRuleFile('玩家手册2024/角色职业/' + d.class + '/' + d.class + '.htm');
      return;
    }
    if (act === 'edit-sheet' && window.UIManager && window.UIManager.openCharacterModalForEdit) {
      window.UIManager.openCharacterModalForEdit(tokenId);
      return;
    }
  });

  // 状态区"添加状态"占位按钮：在状态列表为空时提供入口
  var statusList = container.querySelector('#cb2-status-list');
  if (statusList) {
    var addBtn = document.createElement('div');
    addBtn.style.cssText = 'margin-top:8px';
    addBtn.innerHTML = '<button type="button" class="cb2-btn sm" data-act="status-add">＋ 添加状态</button>';
    statusList.parentNode.insertBefore(addBtn, statusList.nextSibling);
    addBtn.querySelector('[data-act="status-add"]').addEventListener('click', function () { openStatusModal(tokenId, (token && token.data) || {}); });
  }

  // 词条悬停
  if (window.TrpgTermTip && typeof window.TrpgTermTip.bind === 'function') {
    try { window.TrpgTermTip.bind(container, (ctx && ctx.system) || ''); } catch (e) {}
  }
}

// ════════════════════════════════════════════════════════════════
// renderCreate：电子游戏级创建流程（属性四模式/技能/法术/装备/背景）
// ════════════════════════════════════════════════════════════════

// 种族（2024 PHB 玩家可选种族：阿斯莫/龙裔/矮人/精灵/侏儒/歌利亚/半身人/人类/兽人/提夫林；无半精灵/半兽人）
var CREATE_RACES = ['阿斯莫', '龙裔', '矮人', '精灵', '侏儒', '歌利亚', '半身人', '人类', '兽人', '提夫林'];
// 种族 → 体型（2024 PHB 种族详述；选种族时自动联动）
var RACE_SIZE = {
  '阿斯莫': '中型', '龙裔': '中型', '矮人': '中型', '精灵': '中型', '侏儒': '小型',
  '歌利亚': '中型', '半身人': '小型', '人类': '中型', '兽人': '中型', '提夫林': '中型'
};
// 种族 → 语言（2024 PHB；选种族时若语言为空自动填入）
var RACE_LANGS = {
  '阿斯莫': '通用语、天界语', '龙裔': '通用语、龙语', '矮人': '通用语、矮人语', '精灵': '通用语、精灵语',
  '侏儒': '通用语、侏儒语', '歌利亚': '通用语、巨人语', '半身人': '通用语、半身人语', '人类': '通用语',
  '兽人': '通用语、兽人语', '提夫林': '通用语、炼狱语'
};
// 阵营
var ALIGNMENTS = ['守序善良', '守序中立', '守序邪恶', '中立善良', '绝对中立', '中立邪恶', '混乱善良', '混乱中立', '混乱邪恶'];
// 购点成本（5e 27 点购点：8→0,9→1,10→2,11→3,12→4,13→5,14→7,15→9）
var POINTBUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
var POINTBUY_POINTS = 27;
// 标准数组（2024）
var STD_ARRAY = [15, 14, 13, 12, 10, 8];
// 职业主题色（角色卡/地图标记）
var CLASS_COLORS = {
  '野蛮人': '#e07a3f', '吟游诗人': '#c66bc4', '牧师': '#e8d44d', '德鲁伊': '#58a05a',
  '战士': '#b0453a', '武僧': '#6fb3c8', '圣武士': '#c9a84c', '游侠': '#4f8f5e',
  '魔契师': '#7d5bb8', '法师': '#5b8def', '游荡者': '#5a5a6e', '术士': '#d34f6f',
  '奇械师': '#3f9d8a'
};
// 职业推荐豁免熟练（2024 表：2 项）
var SAVE_RECS = {
  '野蛮人': ['str', 'con'], '吟游诗人': ['dex', 'cha'], '牧师': ['wis', 'cha'],
  '德鲁伊': ['int', 'wis'], '战士': ['str', 'con'], '武僧': ['str', 'dex'],
  '圣武士': ['wis', 'cha'], '游侠': ['str', 'dex'], '魔契师': ['wis', 'cha'],
  '法师': ['int', 'wis'], '游荡者': ['dex', 'int'], '术士': ['con', 'cha'],
  '奇械师': ['con', 'int']
};
// 职业推荐技能熟练（2024 表）
var SKILL_RECS = {
  '野蛮人': ['运动', '驯兽', '威吓', '求生'], '吟游诗人': ['表演', '游说', '巧手', '欺瞒'],
  '牧师': ['洞悉', '医药', '历史', '宗教'], '德鲁伊': ['自然', '驯兽', '求生', '医药'],
  '战士': ['运动', '特技', '历史', '威吓'], '武僧': ['特技', '运动', '洞悉', '隐匿'],
  '圣武士': ['宗教', '游说', '洞悉', '威吓'], '游侠': ['求生', '隐匿', '察觉', '自然'],
  '魔契师': ['奥秘', '历史', '欺瞒', '调查'], '法师': ['奥秘', '历史', '调查', '宗教'],
  '游荡者': ['特技', '巧手', '隐匿', '察觉'], '术士': ['欺瞒', '表演', '威吓', '游说'],
  '奇械师': ['调查', '奥秘', '巧手', '宗教']
};
// 戏法基础数量（2024 职业表；每 4 级 +1，简化近似）
var CANTRIP_BASE = {
  '吟游诗人': 2, '牧师': 3, '德鲁伊': 2, '魔契师': 2, '术士': 4, '法师': 3, '奇械师': 2
};

// ── 职业起始装备（玩家手册2024 职业表「起始装备」行：选 A/B/C 套装；数据取自各职业源文）──
// options[].items 为套装物品；gold 为套装附带金币或纯金币选项
var CLASS_STARTING_EQUIP = {
  '野蛮人': { options: [
    { label: 'A', items: ['巨斧', '手斧', '手斧', '手斧', '手斧', '探索套组'], gold: 15 },
    { label: 'B', gold: 75 }
  ] },
  '吟游诗人': { options: [
    { label: 'A', items: ['皮甲', '匕首', '匕首', '你选择的乐器', '艺人套组'], gold: 19 },
    { label: 'B', gold: 90 }
  ] },
  '牧师': { options: [
    { label: 'A', items: ['链甲衫', '盾牌', '硬头锤', '圣徽', '祭司套组'], gold: 7 },
    { label: 'B', gold: 110 }
  ] },
  '德鲁伊': { options: [
    { label: 'A', items: ['皮甲', '盾牌', '镰刀', '德鲁伊法器（长棍）', '探索套组', '草药工具'], gold: 9 },
    { label: 'B', gold: 50 }
  ] },
  '战士': { options: [
    { label: 'A', items: ['链甲', '巨剑', '链枷', '标枪', '标枪', '标枪', '标枪', '标枪', '标枪', '标枪', '标枪', '地城套组'], gold: 4 },
    { label: 'B', items: ['镶钉皮甲', '弯刀', '短剑', '长弓', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭袋', '地城套组'], gold: 11 },
    { label: 'C', gold: 155 }
  ] },
  '武僧': { options: [
    { label: 'A', items: ['矛', '匕首', '匕首', '匕首', '匕首', '匕首', '所选的工匠工具或乐器', '探索套组'], gold: 11 },
    { label: 'B', gold: 50 }
  ] },
  '圣武士': { options: [
    { label: 'A', items: ['链甲', '盾牌', '长剑', '标枪', '标枪', '标枪', '标枪', '标枪', '标枪', '圣徽', '祭司套组'], gold: 9 },
    { label: 'B', gold: 150 }
  ] },
  '游侠': { options: [
    { label: 'A', items: ['镶钉皮甲', '弯刀', '短剑', '长弓', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭袋', '德鲁伊法器（槲寄生枝条）', '探索套组'], gold: 7 },
    { label: 'B', gold: 150 }
  ] },
  '魔契师': { options: [
    { label: 'A', items: ['皮甲', '镰刀', '匕首', '匕首', '奥术法器（法球）', '书（隐秘学识）', '学者套组'], gold: 15 },
    { label: 'B', gold: 100 }
  ] },
  '法师': { options: [
    { label: 'A', items: ['匕首', '匕首', '奥术法器（长棍）', '长袍', '法术书', '学者套组'], gold: 5 },
    { label: 'B', gold: 55 }
  ] },
  '游荡者': { options: [
    { label: 'A', items: ['皮甲', '匕首', '匕首', '短剑', '短弓', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭矢', '箭袋', '盗贼工具', '窃贼套组'], gold: 8 },
    { label: 'B', gold: 100 }
  ] },
  '术士': { options: [
    { label: 'A', items: ['矛', '匕首', '匕首', '奥术法器（水晶）', '地城套组'], gold: 28 },
    { label: 'B', gold: 50 }
  ] },
  // 奇械师为 TCE 扩展（无 2024 PHB 官方套装；保留代表性组合 + 金币替代）
  '奇械师': { options: [
    { label: 'A', items: ['皮甲', '轻弩', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '盗贼工具', '学者套组'], gold: 0 },
    { label: 'B', gold: 50 }
  ] }
};
// 职业熟练提示（规则书表：武器/护甲/工具，展示用）
var CLASS_PROF_HINT = {
  '野蛮人': '护甲：轻甲/中甲/盾 · 武器：简易/军用',
  '吟游诗人': '护甲：轻甲 · 武器：简易 + 3 乐器 + 任选 3 技能',
  '牧师': '护甲：轻甲/中甲/盾 · 武器：简易',
  '德鲁伊': '护甲：轻甲/中甲/盾（非金属） · 武器：简易 + 草药工具',
  '战士': '护甲：轻甲/中甲/重甲/盾 · 武器：简易/军用',
  '武僧': '护甲：无 · 武器：简易 + 轻型军用 + 选 1 工具',
  '圣武士': '护甲：轻甲/中甲/重甲/盾 · 武器：简易/军用',
  '游侠': '护甲：轻甲/中甲/盾 · 武器：简易/军用',
  '魔契师': '护甲：轻甲 · 武器：简易',
  '法师': '护甲：无 · 武器：简易',
  '游荡者': '护甲：轻甲 · 武器：简易 + 灵巧/轻型军用',
  '术士': '护甲：无 · 武器：简易',
  '奇械师': '护甲：轻甲/中甲/盾 · 武器：简易'
};

// ── 职业工具熟练选择（2024 PHB 职业表：武僧「选择1种工匠工具或乐器」等）──
var CLASS_TOOL_CHOICE = {
  '武僧': ['工匠工具', '乐器']
};
// 占位符：起始装备 A 套装中的「所选的工匠工具或乐器」→ 用已选工具名替换
function replaceToolPlaceholder(items, toolProfs) {
  var t = (toolProfs || [])[0];
  return items.map(function (n) {
    if (/所选的工匠工具或乐器/.test(String(n))) return t || '所选的工匠工具或乐器';
    return n;
  });
}

// ── 2024 背景（玩家手册2024/角色起源/背景/ 16个；含属性/专长/技能/工具/装备A/B）──
var BACKGROUNDS = {
  '侍僧': { abilities: ['智力', '感知', '魅力'], feat: '魔法学徒（牧师）', skills: ['洞悉', '宗教'], tool: '书法工具', equip: 'A：书法工具、书籍（祈祷文）、圣徽、羊皮纸×10、长袍、8GP；或 B：50GP' },
  '工匠': { abilities: ['力量', '敏捷', '智力'], feat: '巧匠', skills: ['调查', '游说'], tool: '选择一种工匠工具', equip: 'A：工匠工具、2小包、旅行服装、32GP；或 B：50GP' },
  '骗子': { abilities: ['敏捷', '体质', '魅力'], feat: '熟习', skills: ['欺瞒', '巧手'], tool: '文书伪造工具', equip: 'A：文书伪造工具、戏服、高档服装、15GP；或 B：50GP' },
  '罪犯': { abilities: ['敏捷', '体质', '智力'], feat: '警戒', skills: ['巧手', '隐匿'], tool: '盗贼工具', equip: 'A：2匕首、盗贼工具、撬棍、2小包、旅行服装、16GP；或 B：50GP' },
  '艺人': { abilities: ['力量', '敏捷', '魅力'], feat: '音乐家', skills: ['特技', '表演'], tool: '选择一种乐器', equip: 'A：乐器、2件表演服装、镜子、香水、旅行服装、11GP；或 B：50GP' },
  '农民': { abilities: ['力量', '体质', '感知'], feat: '健壮', skills: ['驯兽', '自然'], tool: '木匠工具', equip: 'A：镰刀、木匠工具、医疗包、铁锅、铲子、旅行服装、30GP；或 B：50GP' },
  '警卫': { abilities: ['力量', '智力', '感知'], feat: '警戒', skills: ['运动', '察觉'], tool: '选择一种赌具', equip: 'A：矛、轻弩、20弩矢、赌具、附盖提灯、镣铐、箭袋、旅行服装、12GP；或 B：50GP' },
  '向导': { abilities: ['敏捷', '体质', '感知'], feat: '魔法学徒（德鲁伊）', skills: ['隐匿', '求生'], tool: '制图工具', equip: 'A：短弓、20支箭、制图工具、铺盖、箭袋、帐篷、旅行服装、3GP；或 B：50GP' },
  '隐士': { abilities: ['体质', '感知', '魅力'], feat: '医疗师', skills: ['医药', '宗教'], tool: '草药工具', equip: 'A：长棍、草药工具、铺盖、书籍（哲学）、油灯、燃油×3、旅行服装、16GP；或 B：50GP' },
  '商人': { abilities: ['体质', '智力', '魅力'], feat: '幸运', skills: ['驯兽', '游说'], tool: '领航工具', equip: 'A：领航工具、2小包、旅行服装、22GP；或 B：50GP' },
  '贵族': { abilities: ['力量', '智力', '魅力'], feat: '熟习', skills: ['历史', '游说'], tool: '选择一种赌具', equip: 'A：赌具、高档服装、香水、29GP；或 B：50GP' },
  '智者': { abilities: ['体质', '智力', '感知'], feat: '魔法学徒（法师）', skills: ['奥秘', '历史'], tool: '书法工具', equip: 'A：长棍、书法工具、书籍（历史）、羊皮纸×8、长袍、8GP；或 B：50GP' },
  '水手': { abilities: ['力量', '敏捷', '感知'], feat: '酒馆斗殴者', skills: ['特技', '察觉'], tool: '领航工具', equip: 'A：匕首、领航工具、绳索、旅行服装、20GP；或 B：50GP' },
  '抄写员': { abilities: ['敏捷', '智力', '感知'], feat: '熟习', skills: ['调查', '察觉'], tool: '书法工具', equip: 'A：书法工具、高档服装、油灯、燃油×3、羊皮纸×12、23GP；或 B：50GP' },
  '士兵': { abilities: ['力量', '敏捷', '体质'], feat: '凶蛮打手', skills: ['运动', '威吓'], tool: '选择一种赌具', equip: 'A：矛、短弓、20支箭、赌具、医疗包、箭袋、旅行服装、14GP；或 B：50GP' },
  '流浪者': { abilities: ['敏捷', '感知', '魅力'], feat: '幸运', skills: ['洞悉', '隐匿'], tool: '盗贼工具', equip: 'A：2匕首、盗贼工具、赌具、铺盖、2小包、旅行服装、16GP；或 B：50GP' }
};
// 背景 → 属性名（用于一键应用属性提升时联动中文名）
var BG_ABILITY_KEY = { '力量': 'str', '敏捷': 'dex', '体质': 'con', '智力': 'int', '感知': 'wis', '魅力': 'cha' };

// ── 起源专长效果（源：玩家手册2024/专长/起源专长.htm；背景卡悬浮显示用）──
var ORIGIN_FEATS = {
  '警戒': '你获得以下增益：<br>• <b>先攻熟练</b>：投先攻时可将熟练加值加入结果。<br>• <b>先攻互换</b>：掷完先攻后，可立即与同一场战斗中一名自愿的盟友交换先攻（若任一方失能则不可）。',
  '巧匠': '你获得以下增益：<br>• <b>工具熟练</b>：自选三项不同的工匠工具并获得其熟练。<br>• <b>折扣</b>：购买非魔法物品时获得 20% 折扣。<br>• <b>快速制作</b>：完成长休时，可制作一件快速制作栏中的装备（须拥有对应工匠工具与熟练）；造物持续到下次长休结束。',
  '医疗师': '你获得以下增益：<br>• <b>战地医师</b>：持医疗包以操作动作救治 5 尺内生物，消耗医疗包一次使用，该生物消耗一枚生命骰由你投掷，恢复 所掷点数+熟练加值。<br>• <b>治疗重掷</b>：为恢复生命掷骰时，可重掷掷出 1 的骰子（须用新结果）。',
  '幸运': '你获得以下增益：<br>• <b>幸运点</b>：拥有等同熟练加值的幸运点，长休恢复。<br>• <b>优势</b>：花费 1 幸运点为一次 D20 检定施加优势。<br>• <b>劣势</b>：花费 1 幸运点为针对你的攻击检定施加劣势。',
  '魔法学徒': '你获得以下增益：<br>• <b>两道戏法</b>：自选一个法术列表（牧师/德鲁伊/法师），习得其中两道戏法，并自选智力/感知/魅力之一作施法属性。<br>• <b>一环法术</b>：再选一道一环法术始终准备，可无耗材位施展一次（长休恢复），也可用任意法术位施展。<br>• <b>改变法术</b>：每次升级可将本专长习得的一道法术替换为同列表同环阶法术。<br><i>可复选：每次须选不同法术列表。</i>',
  '音乐家': '你获得以下增益：<br>• <b>乐器训练</b>：获得三种自选乐器的熟练。<br>• <b>鼓舞之歌</b>：完成短休或长休时，可用熟练乐器演奏，令听到的盟友获得英雄激励（最多等于熟练加值个）。',
  '凶蛮打手': '你专门训练过如何做出更具破坏性的进攻：每回合一次，使用武器命中目标时，可掷两次武器伤害骰并自选其中一次应用。',
  '熟习': '你获得共计三项自选的技能和工具熟练。<br><i>可复选：可多次选择本专长。</i>',
  '酒馆斗殴者': '你获得以下增益：<br>• <b>强化徒手打击</b>：徒手打击命中造成伤害时，可造成 1d4+力量调整值 的钝击伤害。<br>• <b>伤害重掷</b>：徒手打击伤害骰掷出 1 时可重掷（须用新结果）。<br>• <b>临时武器专家</b>：拥有临时武器的熟练。<br>• <b>推离</b>：回合内用攻击动作的徒手打击命中时，可将目标推离 5 尺（每回合一次）。',
  '健壮': '获得该专长时，生命值上限提升 当前角色等级×2；随后每次升级，生命值上限额外 +2。'
};

// ── 可选工具/乐器/赌具（源：玩家手册2024/装备/工匠工具.htm 等；背景「选择一种…」下拉选项）──
var TOOL_LISTS = {
  '工匠工具': ['炼金工具', '酿酒工具', '书法工具', '木匠工具', '制图工具', '鞋匠工具', '厨师工具', '玻璃匠工具', '珠宝匠工具', '皮匠工具', '石匠工具', '画家工具', '陶匠工具', '铁匠工具', '修补工具', '织布工具', '木雕工具'],
  '乐器': ['风笛', '鼓', '扬琴', '长笛', '鲁特琴', '竖琴', '号角', '排箫', '肖姆管', '提琴'],
  '赌具': ['骰子套组', '龙棋套组', '卡牌套组', '三龙赌局套组']
};
// 背景 → 工具熟练可选类别（「选择一种工匠工具/乐器/赌具」时解析；固定工具直接显示）
function bgToolCategory(toolStr) {
  var s = String(toolStr || '');
  if (s.indexOf('工匠工具') >= 0) return '工匠工具';
  if (s.indexOf('乐器') >= 0) return '乐器';
  if (s.indexOf('赌具') >= 0) return '赌具';
  return '';
}

// ── 各职业 1 级特性（玩家手册2024 角色职业特性表；奇械师为 TCE 版本）──
var CLASS_LV1_FEATURES = {
  '野蛮人': ['狂暴', '无甲防御', '武器精通'],
  '吟游诗人': ['吟游诗人激励', '施法'],
  '牧师': ['施法', '圣职'],
  '德鲁伊': ['德鲁伊语', '原初职能', '施法'],
  '战士': ['战斗风格', '回气', '武器精通'],
  '武僧': ['武艺', '无甲防御'],
  '圣武士': ['圣疗', '施法', '武器精通'],
  '游侠': ['施法', '宿敌', '武器精通'],
  '魔契师': ['魔能祈唤', '契约魔法'],
  '法师': ['施法', '仪式学家', '奥术回想'],
  '游荡者': ['专精', '偷袭', '盗贼黑话', '武器精通'],
  '术士': ['施法', '先天术法'],
  '奇械师': ['魔法玩意', '施法', '工具熟练']
};

// ── 法术成分（V/S/M）解析与标签：标签化排列 + 悬浮显示实际定义 ──
var COMPONENT_DEF = {
  V: { label: '言语', desc: '必须念出特定咒语或短语。无法说话（沉默术、溺水等）时不能施法。' },
  S: { label: '姿势', desc: '必须以特定方式比划手势。双手被束缚（被擒抱、被缚绑）时不能施法。' },
  M: { label: '材料', desc: '必须手持规则规定的小物件，或用施法法器代替（材料有明确价值/被消耗时不可代替）。' }
};
function parseComponents(c) {
  var out = [], seen = {};
  var s = String(c || '');
  // 英文缩写 V/S/M（可能含 VSM、V、S、M 组合与分隔符）
  String(s).replace(/成分/g, '').replace(/[VSM]/g, function (ch) {
    var k = ch.toUpperCase();
    if ((k === 'V' || k === 'S' || k === 'M') && !seen[k]) {
      seen[k] = 1;
      out.push({ key: k, label: COMPONENT_DEF[k].label, desc: COMPONENT_DEF[k].desc, material: '' });
    }
    return ch;
  });
  // 中文写法：言语/姿势/材料（含简写 言/姿/材）
  if (!out.length) {
    var cnMap = { '言语': 'V', '姿势': 'S', '材料': 'M', '言': 'V', '姿': 'S', '材': 'M' };
    Object.keys(cnMap).forEach(function (cn) {
      if (s.indexOf(cn) >= 0 && !seen[cnMap[cn]]) {
        seen[cnMap[cn]] = 1;
        out.push({ key: cnMap[cn], label: COMPONENT_DEF[cnMap[cn]].label, desc: COMPONENT_DEF[cnMap[cn]].desc, material: '' });
      }
    });
  }
  var mdesc = s.match(/[（(]([^）)]+)[）)]/);
  if (mdesc) {
    for (var i = 0; i < out.length; i++) if (out[i].key === 'M') { out[i].material = mdesc[1]; break; }
  }
  return out;
}
function componentsTags(c) {
  var list = parseComponents(c);
  if (!list.length) return '';
  return list.map(function (x) {
    var tip = x.key + ' ' + x.label + '：' + x.desc + (x.material ? '（材料：' + x.material + '）' : '');
    return '<span class="cb2-comp-tag cb2-comp-' + x.key.toLowerCase() + '" title="' + esc(tip) + '">' + x.key + '<i>' + x.label + '</i></span>';
  }).join('');
}

// ── 法术效果查询（规则索引 → 摘要，缓存）──
var _spellDescCache = {};
function querySpellDesc(ctx, name, cb) {
  name = String(name || '').trim();
  if (!name) { cb(''); return; }
  if (_spellDescCache[name]) { cb(_spellDescCache[name]); return; }
  try {
    if (!ctx || typeof ctx.fetch !== 'function') { cb(''); return; }
    ctx.fetch('/api/rules/index?system=' + encodeURIComponent(ctx.system || '') + '&q=' + encodeURIComponent(name) + '&limit=8')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = (data && data.items) || (Array.isArray(data) ? data : []);
        var hit = null;
        for (var i = 0; i < items.length; i++) {
          var t = String(items[i].title || items[i].name || '');
          var cat = String(items[i].category || '');
          if (t === name || cat === name) { hit = items[i]; break; }
        }
        if (!hit && items.length) hit = items[0];
        var sum = hit ? String(hit.summary || hit.content || '') : '';
        _spellDescCache[name] = sum;
        cb(sum);
      })
      .catch(function () { _spellDescCache[name] = ''; cb(''); });
  } catch (e) { cb(''); }
}
// 法术悬浮小窗（动态加载效果摘要，绝对定位不改变布局）
function showSpellTip(el, name, ctx) {
  var old = document.getElementById('cb2-spell-tip');
  if (old) old.remove();
  var tip = document.createElement('div');
  tip.id = 'cb2-spell-tip';
  tip.className = 'cb2-spell-tip';
  tip.innerHTML = '<div class="cb2-spell-tip-n">🔮 ' + esc(name) + '</div><div class="cb2-spell-tip-b">⏳ 加载效果…</div>';
  document.body.appendChild(tip);
  var rect = el.getBoundingClientRect();
  var left = Math.max(8, Math.min(window.innerWidth - 290, rect.left));
  var top = rect.bottom + 8;
  if (top + 160 > window.innerHeight) top = rect.top - 170;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  querySpellDesc(ctx, name, function (desc) {
    var b = tip.querySelector('.cb2-spell-tip-b');
    if (b) b.textContent = desc || '（规则索引暂无该法术摘要 — 悬停法术后可点击「📖 原文」查看源文）';
  });
}
function hideSpellTip() {
  var old = document.getElementById('cb2-spell-tip');
  if (old) old.remove();
}

// 追加样式（详情/创建共用：VSM 标签、法术悬浮小窗、创建方式选择、环位选择）
var STYLE_EXTRA =
  '.cb2-comp-tag{display:inline-flex;align-items:center;gap:3px;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:800;cursor:help;line-height:1.6;border:1px solid var(--border-light)}' +
  '.cb2-comp-tag i{font-style:normal;font-weight:600;font-size:9.5px;opacity:.85}' +
  '.cb2-comp-v{color:#7fd4ff;background:rgba(63,142,239,.14);border-color:rgba(63,142,239,.4)}' +
  '.cb2-comp-s{color:#9fe8a8;background:rgba(88,160,90,.14);border-color:rgba(88,160,90,.4)}' +
  '.cb2-comp-m{color:#f2d38a;background:rgba(201,168,76,.13);border-color:rgba(201,168,76,.42)}' +
  '.cb2-spell-tip{position:fixed;z-index:99999;max-width:280px;background:var(--bg-surface);border:1px solid var(--gold-d);border-radius:10px;padding:9px 11px;box-shadow:0 10px 34px rgba(0,0,0,.55);font-size:12px;color:var(--text);line-height:1.65;animation:cb2-slide .18s ease-out;pointer-events:none}' +
  '.cb2-spell-tip-n{font-weight:700;color:var(--gold-l);margin-bottom:4px;font-size:12.5px}' +
  '.cb2-spell-tip-b{font-size:11.5px;color:var(--text-2)}' +
  '.cb2-flow-bar{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}' +
  '@media(max-width:640px){.cb2-flow-bar{grid-template-columns:1fr}}' +
  '.cb2-flow-card{border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;background:var(--bg-panel);transition:all .18s;text-align:left;font-family:inherit;color:var(--text)}' +
  '.cb2-flow-card:hover{border-color:var(--gold-d);transform:translateY(-2px);background:var(--bg-hover)}' +
  '.cb2-flow-card .t{font-size:14px;font-weight:800;margin-bottom:3px}' +
  '.cb2-flow-card .d{font-size:11px;color:var(--text-3);line-height:1.6}' +
  '.cb2-flow-card.on{border-color:var(--gold);background:linear-gradient(135deg,rgba(201,168,76,.14),transparent);box-shadow:0 0 0 1px var(--gold-d)}' +
  '.cb2-flow-card .ic{font-size:20px;margin-bottom:5px}' +
  '.cb2-flow-badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--gold-l);border:1px solid var(--gold-d);border-radius:12px;padding:2px 9px;margin-bottom:10px}' +
  '.cb2-ringtabs{display:flex;gap:4px;flex-wrap:wrap;margin:8px 0}' +
  '.cb2-ringtab{border:1px solid var(--border-light);background:var(--bg-deep);color:var(--text-2);border-radius:9px;padding:5px 10px;cursor:pointer;font-size:11.5px;font-family:inherit;transition:all .15s}' +
  '.cb2-ringtab:hover{border-color:var(--gold-d);color:var(--text)}' +
  '.cb2-ringtab.active{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;font-weight:700;border-color:var(--gold)}' +
  '.cb2-ringtab .n{opacity:.7;font-weight:600;margin-left:3px;font-size:10px}' +
  '.cb2-selected-box{border:1px dashed var(--border-light);border-radius:8px;padding:7px 9px;margin-top:8px;background:var(--bg-deep)}' +
  '.cb2-selected-box .lb{font-size:10px;color:var(--text-3);margin-bottom:5px}' +
  '.cb2-prof-hint{font-size:10.5px;color:var(--text-3);border-left:3px solid var(--gold-d);padding:4px 8px;background:var(--bg-panel);border-radius:4px;margin-top:6px;line-height:1.6}' +
  '.cb2-prof-hint b{color:var(--gold-l)}' +
  '.cb2-flow-steps{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px}' +
  '.cb2-flow-step{border:1px solid var(--border-light);background:var(--bg-deep);color:var(--text-3);border-radius:8px;padding:4px 9px;font-size:10.5px;cursor:pointer;transition:all .15s;font-family:inherit}' +
  '.cb2-flow-step:hover{color:var(--text);border-color:var(--gold-d)}' +
  '.cb2-flow-step.cur{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;font-weight:700;border-color:var(--gold)}' +
  '.cb2-start-row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}' +
  '.cb2-start-row .info{font-size:11px;color:var(--text-3);flex:1;min-width:140px;line-height:1.6}' +
  '.cb2-start-row .info b{color:var(--gold-l)}' +
  '.cb2-start-items{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
  '.cb2-start-item{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-light);background:var(--bg-deep);color:var(--text-2);border-radius:12px;padding:2px 9px;font-size:11px}' +
  '.cb2-start-item .rm{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:11px;padding:0 0 0 2px;line-height:1}' +
  '.cb2-start-item .rm:hover{color:var(--red-l)}' +
  '.cb2-start-item.armor{color:#9fd0ff;border-color:rgba(63,142,239,.5);background:rgba(63,142,239,.12)}' +
  '.cb2-start-item.shield{color:#c9a84c;border-color:rgba(201,168,76,.5);background:rgba(201,168,76,.1)}' +
  // 2024 背景卡（创建页 + 详情页共用）
  '.cb2-bg-card{background:var(--bg-panel);border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;margin-top:2px}' +
  '.cb2-bg-card-t{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:8px}' +
  '.cb2-bg-card-tag{font-size:9.5px;font-weight:600;color:#141414;background:linear-gradient(135deg,var(--gold-d),var(--gold));border-radius:10px;padding:1px 8px}' +
  '.cb2-bg-card-t .cb2-btn{margin-left:auto}' +
  '.cb2-bg-card-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 10px}' +
  '@media(max-width:880px){.cb2-bg-card-grid{grid-template-columns:repeat(2,1fr)}}' +
  // 属性提升方案卡（2024 背景）
  '.cb2-attr-plan-row{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;margin-bottom:10px}' +
  '.cb2-attr-plan{flex:1;min-width:130px;border:1.5px solid var(--border-light);border-radius:10px;padding:8px 12px;cursor:pointer;transition:all .18s;background:var(--bg-deep);text-align:center}' +
  '.cb2-attr-plan:hover{border-color:var(--gold-d);background:var(--bg-hover);transform:translateY(-1px)}' +
  '.cb2-attr-plan.on{border-color:var(--gold);background:linear-gradient(135deg,rgba(201,168,76,.16),transparent);box-shadow:0 0 0 1px var(--gold-d)}' +
  '.cb2-attr-plan-t{font-size:9.5px;color:var(--text-3);letter-spacing:1px;margin-bottom:3px}' +
  '.cb2-attr-plan-v{font-size:13px;font-weight:800;color:var(--gold-l);line-height:1.5}' +
  '.cb2-attr-plan.on .cb2-attr-plan-v{color:var(--gold)}' +
  '.cb2-attr-undo{align-self:center}' +
  '.cb2-attr-plan-row .cb2-btn{align-self:center}' +
  // 技能来源标签
  '.cb2-skill-src{display:block;font-size:9px;color:var(--gold-d);margin-top:2px;font-weight:600}' +
  // 规则版本切换条
  '.cb2-rulever{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800}' +
  '.cb2-rulever-ic{font-size:15px}' +
  '.cb2-rulever-sw{display:flex;gap:4px;background:var(--bg-panel);border:1px solid var(--border);border-radius:9px;padding:3px}' +
  '.cb2-rulever-btn{border:none;background:transparent;color:var(--text-3);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11.5px;font-family:inherit;transition:all .18s}' +
  '.cb2-rulever-btn:hover{color:var(--text);background:var(--bg-hover)}' +
  '.cb2-rulever-btn.on{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;font-weight:700}' +
  '.cb2-rulever-tip{font-size:10.5px;color:var(--text-3);flex:1;min-width:200px}' +
  '.cb2-bg-cell{background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;color:var(--text-2);line-height:1.55}' +
  '.cb2-bg-cell.full{grid-column:1/-1}' +
  '.cb2-bg-cell label{display:block;font-size:9.5px;color:var(--text-3);margin-bottom:1px;letter-spacing:.5px}' +
  // 起源专长 chip（悬浮显示效果）
  '.cb2-feat-chip{display:inline-block;border:1px solid var(--gold-d);background:rgba(201,168,76,.1);color:var(--gold-l);border-radius:12px;padding:2px 10px;font-size:11px;cursor:help}' +
  '.cb2-feat-chip:hover{border-color:var(--gold);box-shadow:0 0 8px rgba(201,168,76,.35)}' +
  // 背景装备选项
  '.cb2-bg-equip{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
  '.cb2-bg-equip-d{font-size:10.5px;color:var(--text-3)}' +
  // 属性「来源加值」汇总条
  '.cb2-bonus-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:rgba(201,168,76,.08);border:1px dashed var(--gold-d);border-radius:8px;padding:5px 10px;font-size:11.5px;color:var(--text-2);margin-bottom:8px}' +
  '.cb2-bonus-bar b{color:var(--gold-l)}' +
  '.cb2-bonus-ic{font-size:12px}' +
  '.cb2-bonus-tip{color:var(--text-3);font-size:10px;margin-left:auto}' +
  // 职业起始装备选项按钮组
  '.cb2-start-opt{display:flex;gap:6px;flex-wrap:wrap}' +
  '.cb2-start-opt .cb2-btn{padding:4px 10px;font-size:11px}' +
  '.cb2-start-opt .cb2-btn.gold{border-color:var(--gold)}';


// 创建页专属样式（在 DARK_STYLE 之上追加）
var CREATE_STYLE = '' +
  '.cb2-create-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}' +
  '@media(max-width:880px){.cb2-create-grid{grid-template-columns:1fr}}' +
  // 属性模式
  '.cb2-mode-tabs{display:flex;gap:4px;background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:3px;margin-bottom:8px;flex-wrap:wrap}' +
  '.cb2-mode-tab{border:none;background:transparent;color:var(--text-3);padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11.5px;font-family:inherit;transition:all .18s}' +
  '.cb2-mode-tab:hover{color:var(--text);background:var(--bg-hover)}' +
  '.cb2-mode-tab.active{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;font-weight:700}' +
  '.cb2-mode-hint{font-size:11px;color:var(--text-3);margin-bottom:8px;line-height:1.6}' +
  '.cb2-mode-hint b{color:var(--gold-l)}' +
  '.cb2-ability-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
  '@media(max-width:640px){.cb2-ability-grid{grid-template-columns:repeat(2,1fr)}}' +
  '.cb2-ab-item{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:8px 6px;text-align:center;position:relative;transition:border-color .2s}' +
  '.cb2-ab-item:hover{border-color:var(--border-light)}' +
  '.cb2-ab-item .nm{font-size:11px;color:var(--text-2)}' +
  '.cb2-ab-item .nm .sc-ab{color:var(--text-3);font-size:9px;margin-left:2px}' +
  '.cb2-ab-item .cb2-ab-input{width:58px;margin:5px auto 2px;text-align:center;font-size:15px;font-weight:700;display:block;padding:3px}' +
  '.cb2-ab-item .cb2-ab-slot{width:62px;margin:5px auto 2px;text-align:center;font-size:15px;font-weight:700;display:block;padding:5px 2px;border:1px dashed var(--border-light);border-radius:8px;background:var(--bg-deep);color:var(--text-3);cursor:pointer;transition:all .18s;font-family:inherit}' +
  '.cb2-ab-item .cb2-ab-slot:hover{border-color:var(--gold-d);color:var(--gold-l);background:var(--bg-hover)}' +
  '.cb2-ab-item .cb2-ab-slot.filled{border-style:solid;border-color:var(--gold-d);color:var(--gold-l);background:linear-gradient(135deg,rgba(201,168,76,.12),transparent)}' +
  '.cb2-ab-item.filled{border-color:rgba(201,168,76,.45);box-shadow:inset 0 0 0 1px rgba(201,168,76,.12)}' +
  // 骰池
  '.cb2-pool{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}' +
  '.cb2-pool-chip{width:46px;height:46px;border-radius:10px;border:1px solid var(--border-light);background:var(--bg-deep);color:var(--text);font-family:"Cinzel",serif;font-size:17px;font-weight:700;cursor:pointer;transition:all .18s;box-shadow:0 2px 6px rgba(0,0,0,.35)}' +
  '.cb2-pool-chip:hover{transform:translateY(-2px);border-color:var(--gold-d);color:var(--gold-l)}' +
  '.cb2-pool-chip.sel{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;border-color:var(--gold);transform:translateY(-2px) scale(1.06);box-shadow:0 4px 14px rgba(201,168,76,.45)}' +
  '.cb2-pool-msg{font-size:11px;color:var(--text-3);margin-bottom:8px;line-height:1.6}' +
  '.cb2-pool-msg b{color:var(--gold-l)}' +
  // 骰点双层：层级1 选组卡片 / 层级2 返回条
  '.cb2-rollset-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-bottom:8px}' +
  '.cb2-rollset-card{border:1px solid var(--border-light);background:var(--bg-deep);border-radius:10px;padding:9px 8px;cursor:pointer;text-align:center;transition:all .15s;font-family:inherit;color:var(--text)}' +
  '.cb2-rollset-card:hover{transform:translateY(-2px);border-color:var(--gold-d);background:var(--bg-hover)}' +
  '.cb2-rollset-t{font-size:11px;color:var(--text-3);display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;gap:6px}' +
  '.cb2-rollset-sum{color:var(--gold-l);font-weight:700;font-size:13px;font-variant-numeric:tabular-nums}' +
  '.cb2-rollset-chips{display:flex;justify-content:center;gap:4px;flex-wrap:wrap}' +
  '.cb2-rollset-chips span{min-width:28px;height:28px;padding:0 4px;border-radius:7px;background:var(--bg-panel);border:1px solid var(--border-light);color:var(--text-2);font-family:"Cinzel",serif;font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}' +
  '.cb2-rollset-back{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}' +
  '.cb2-rollset-cur{font-size:11.5px;color:var(--text-3)}' +
  '.cb2-rollset-cur b{color:var(--gold-l);font-size:13px}' +
  '.cb2-ab-item .md{font-size:13px;font-weight:700;color:var(--gold-l)}' +
  '.cb2-ab-item .md.neg{color:var(--red-l)}' +
  '.cb2-ab-item .save-t{position:absolute;top:6px;right:6px}' +
  '.cb2-save{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text-3);cursor:pointer;user-select:none}' +
  '.cb2-save input{accent-color:var(--gold)}' +
  '.cb2-save-grid{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)}' +
  // 派生面板
  '.cb2-derived{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}' +
  '@media(max-width:640px){.cb2-derived{grid-template-columns:repeat(2,1fr)}}' +
  '.cb2-dv{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:7px 6px;text-align:center}' +
  '.cb2-dv .l{font-size:10px;color:var(--text-3);letter-spacing:.03em}' +
  '.cb2-dv .v{font-size:16px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums}' +
  '.cb2-dv .v.warn{color:var(--amber)}' +
  '.cb2-dv .v.ok{color:var(--green-l)}' +
  '.cb2-dv .v.over{color:var(--red-l)}' +
  '.cb2-dv .s{font-size:9.5px;color:var(--text-3)}' +
  // 技能
  '.cb2-skill-row{display:grid;grid-template-columns:1fr 44px 92px;gap:6px;align-items:center;margin-bottom:5px;padding:3px 6px;border-radius:6px;transition:background .15s}' +
  '.cb2-skill-row:hover{background:var(--bg-hover)}' +
  '.cb2-skill-row .nm{font-size:12px;color:var(--text);display:flex;align-items:baseline;gap:6px}' +
  '.cb2-skill-row .nm em{font-style:normal;font-size:9.5px;color:var(--text-3)}' +
  '.cb2-skill-row .bn{font-size:12px;font-weight:700;color:var(--gold-l);text-align:right;font-variant-numeric:tabular-nums}' +
  '.cb2-skill-row select{width:100%}' +
  // chips（法术/装备）
  '.cb2-chiprow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}' +
  '.cb2-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-light);background:var(--bg-deep);color:var(--text-2);border-radius:14px;padding:3px 10px;font-size:11.5px;cursor:pointer;transition:all .15s;user-select:none;line-height:1.5}' +
  '.cb2-chip:hover{border-color:var(--gold-d);color:var(--text);transform:translateY(-1px)}' +
  '.cb2-chip.on{background:linear-gradient(135deg,var(--gold-d),var(--gold));border-color:var(--gold);color:#141414;font-weight:700}' +
  '.cb2-chip.armor-on{background:linear-gradient(135deg,#3a6ea5,#5b8def);border-color:var(--blue);color:#fff;font-weight:700}' +
  '.cb2-chip.dim{opacity:.4;pointer-events:none}' +
  '.cb2-grp{margin-bottom:8px}' +
  '.cb2-grp-t{font-size:11px;color:var(--text-3);margin:6px 0 2px;display:flex;align-items:center;gap:6px}' +
  '.cb2-grp-t b{color:var(--gold-l);font-size:11px}' +
  '.cb2-grp-t .cnt{margin-left:auto;color:var(--text-mute);font-size:10px}' +
  // 已选
  '.cb2-selected{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
  '.cb2-sel-chip{display:inline-flex;align-items:center;gap:5px;background:var(--bg-active);border:1px solid var(--gold-d);color:var(--gold-l);border-radius:14px;padding:3px 8px;font-size:11px}' +
  '.cb2-sel-chip .rm{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:12px;line-height:1;padding:0 0 0 2px}' +
  '.cb2-sel-chip .rm:hover{color:var(--red-l)}' +
  '.cb2-sel-chip .lv{color:var(--text-3);font-size:9.5px}' +
  '.cb2-mini-label{font-size:10.5px;color:var(--text-3);margin-top:8px}' +
  '.cb2-edit-grid .full{grid-column:1/-1}' +
  // 加载占位
  '.cb2-loading{color:var(--text-3);font-size:11.5px;padding:6px 0;animation:cb2-fade .4s}' +
  '.cb2-create .cb2-sec:hover{border-color:var(--border-light)}';

// 标准 4d6 取最高 3 之和
function roll4d6DropLowest() {
  var arr = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort(function (a, b) { return a - b; });
  return arr[1] + arr[2] + arr[3];
}
// 掷出一组 6 个骰值（骰池），供玩家手动分配到六项属性
function rollScorePool() {
  var pool = [];
  for (var i = 0; i < 6; i++) pool.push(roll4d6DropLowest());
  return pool;
}
// 一次性掷出 count 组属性（每组 6 值），供玩家选一组分配；骰点不可重掷
function rollScoreSets(count) {
  var sets = [];
  for (var i = 0; i < count; i++) sets.push({ pool: rollScorePool(), scores: null });
  return sets;
}
// 一组属性的合计值
function rollSetSum(rs) {
  return rs.pool.reduce(function (a, b) { return a + b; }, 0);
}
function defaultScores() { return { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }; }
function clampScore(v) { v = Math.round(Number(v) || 8); return Math.max(3, Math.min(20, v)); }
// 购点成本合计
function pointbuyCost(scores) {
  var sum = 0;
  ABILITIES.forEach(function (a) {
    var v = clampScore(scores[a.key]);
    if (POINTBUY_COST[v] != null) sum += POINTBUY_COST[v];
  });
  return sum;
}
function inArray(arr, x) { return arr.indexOf(x) >= 0; }

// ── 创建页主渲染 ──
function renderCreate(container, ctx, done) {
  injectStyle();
  try {
    if (!document.getElementById('cb2-create-style')) {
      var stEl = document.createElement('style');
      stEl.id = 'cb2-create-style';
      stEl.textContent = CREATE_STYLE;
      document.head.appendChild(stEl);
    }
  } catch (e) {}

  var editData = (ctx && ctx.token && ctx.token.data) || null;

  // ── 表单状态 ──
  var st = {
    name: editData ? editData.name || '' : '',
    race: editData && editData.race ? editData.race : '人类',
    cls: editData && editData.class && CLASS_HD[editData.class] ? editData.class : '法师',
    customClass: editData ? editData.customClass || '' : '',
    level: editData ? Math.max(1, Math.min(20, Number(editData.level) || 1)) : 1,
    background: editData ? editData.background || '' : '',
    bgApplied: (editData && editData.bgApplied) ? editData.bgApplied : null, // 背景属性加值 {mode:'21'|'111', before:{...}}
    bgEquip: (editData && editData.bgEquip) ? editData.bgEquip : '',          // 背景装备选项 'A'|'B'|''
    bgGold: (editData && editData.bgGold) ? Number(editData.bgGold) || 0 : 0, // 背景 B 选项金币
    bgEquipData: (editData && editData.bgEquipData) ? { A: editData.bgEquipData.A, B: editData.bgEquipData.B } : null, // 解析后的背景装备选项
    bgAppliedItems: (editData && editData.bgEquip === 'A' && editData.bgEquipData && editData.bgEquipData.A && editData.bgEquipData.A.items)
      ? editData.bgEquipData.A.items.map(function (it) { return it.name; }) : [], // 背景 A 套装加入的物品名（切换时移除）
    toolProfs: (editData && Array.isArray(editData.toolProfs)) ? editData.toolProfs.slice() : [], // 工具熟练
    // 熟练来源管理：{ 技能名/工具名: ['职业·战士','背景·工匠'] } —— 自动联动并区分来源
    skillSources: (editData && editData.skillSources) ? JSON.parse(JSON.stringify(editData.skillSources)) : {},
    toolSources: (editData && editData.toolSources) ? JSON.parse(JSON.stringify(editData.toolSources)) : {},
    customBg: (editData && editData.customBg) ? JSON.parse(JSON.stringify(editData.customBg)) : null, // 自定义背景配置
    // 规则版本：'2024'（玩家手册2024，背景提供属性/专长）｜'2014'（玩家手册2014，背景仅提供技能/工具/装备）
    ruleVersion: (editData && editData.ruleVersion) ? editData.ruleVersion : '2024',
    equipChoice: (editData && editData.equipChoice) ? editData.equipChoice : '', // 职业起始装备选项 A/B/C
    equipGold: (editData && editData.equipGold) ? Number(editData.equipGold) || 0 : 0, // 选项附带金币
    equipAppliedItems: [],                                                         // 最近一次选项加入的物品名
    alignment: editData && editData.alignment ? editData.alignment : '绝对中立',
    size: editData && editData.size ? editData.size : '中型',
    languages: editData ? editData.languages || '' : '',
    mode: editData ? 'manual' : 'rolled',
    rolledPool: [],      // 当前选中组的骰池（分配中）
    pickedIdx: -1,       // 当前池中选中的骰值下标
    rollSets: [],        // 一次性掷出的 5 组属性（不可重掷），每组 {pool:[6值], scores:null|{str..}}
    rollPick: -1,        // -1=层级1（选择组）；>=0=层级2（第几组分配中）
    scores: defaultScores(),
    saves: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    trained: {},
    armor: editData && editData.armor ? editData.armor : '无甲',
    shield: !!(editData && editData.shield),
    spellList: [],
    items: [],
    features: editData && Array.isArray(editData.features) ? editData.features.slice() : [],
    bio: Object.assign({ appearance: '', personality: '', ideals: '', bonds: '', flaws: '' }, (editData && editData.bio) || {}),
    spellData: null,
    equipData: null,
    // 创建方式：guide=开卡流程（分步引导）；quick=快速创建（填核心字段即存）
    flowType: editData ? 'quick' : 'guide',
    flowStep: 0
  };
  // 快速创建：跳过骰点强制流程，默认手动属性
  if (!editData && st.flowType === 'quick') st.mode = 'manual';
  if (editData && editData.abilityScores) {
    ABILITIES.forEach(function (a) { if (editData.abilityScores[a.key] != null) st.scores[a.key] = clampScore(editData.abilityScores[a.key]); });
  }
  if (editData && editData.savingThrows) {
    ABILITIES.forEach(function (a) { st.saves[a.key] = !!editData.savingThrows[a.key]; });
  }
  if (editData && editData.skills) {
    SKILLS.forEach(function (s) {
      // 旧版译名「生存」→ 2024 统一「求生」数据迁移
      var v = editData.skills[s.name] || editData.skills[s.name === '求生' ? '生存' : s.name];
      if (v && v.trained) st.trained[s.name] = v.trained;
    });
  }
  if (editData && Array.isArray(editData.spellList)) {
    st.spellList = editData.spellList.map(function (s) { return { name: s.name, level: Number(s.level) || 0 }; });
  }
  if (editData) {
    st.items = normalizeItems(editData).map(function (it) {
      return { name: it.name, category: it.category || '杂物', quantity: Number(it.quantity) || 1, equipped: !!it.equipped };
    });
  }
  // 新建时按职业预填推荐（豁免 + 技能）
  if (!editData) {
    (SAVE_RECS[st.cls] || []).forEach(function (k) { st.saves[k] = true; });
    (SKILL_RECS[st.cls] || []).forEach(function (n) { st.trained[n] = '熟练'; });
    // 新建：预填初始职业 1 级特性（2024 PHB 特性表）
    (CLASS_LV1_FEATURES[st.cls] || []).forEach(function (f) { if (st.features.indexOf(f) < 0) st.features.push(f); });
    // 新建：种族 → 体型/语言自动联动（默认人类 → 通用语）
    if (RACE_SIZE[st.race]) st.size = RACE_SIZE[st.race];
    if (RACE_LANGS[st.race] && !st.languages) st.languages = RACE_LANGS[st.race];
  }
  // 新建 + 骰点模式：一次性掷出 5 组（每组 6 值），玩家先选组再分配；骰点不可重掷
  if (!editData && st.mode === 'rolled') {
    st.rollSets = rollScoreSets(5);
    st.rollPick = -1; // 层级1：先选组
    st.rolledPool = [];
    st.pickedIdx = -1;
    ABILITIES.forEach(function (a) { st.scores[a.key] = null; });
  }

  // ── 构建 HTML ──
  var clsOptions = Object.keys(CLASS_HD).map(function (c) {
    return '<option value="' + esc(c) + '"' + (st.cls === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('') + '<option value="自定义"' + (st.cls === '自定义' ? ' selected' : '') + '>自定义</option>';
  var raceOptions = CREATE_RACES.map(function (r) {
    return '<option value="' + esc(r) + '"' + (st.race === r ? ' selected' : '') + '>' + esc(r) + '</option>';
  }).join('') + '<option value="自定义种族"' + (st.race === '自定义种族' ? ' selected' : '') + '>自定义种族</option>';
  var alignOptions = ALIGNMENTS.map(function (x) {
    return '<option value="' + esc(x) + '"' + (st.alignment === x ? ' selected' : '') + '>' + esc(x) + '</option>';
  }).join('');
  var armorOptions = ARMOR_LIST.map(function (m) {
    return '<option value="' + esc(m) + '"' + (st.armor === m ? ' selected' : '') + '>' + esc(m) + (m === '无甲' ? '' : ' (AC ' + ARMOR_INFO[m].baseAC + (ARMOR_INFO[m].maxDex < 10 ? ' 敏限+' + ARMOR_INFO[m].maxDex : '') + ')') + '</option>';
  }).join('');
  // 背景下拉（2024 PHB 16 背景 + 自定义；旧存档自由文本背景保留显示）
  var bgOptions = '<option value=""' + (!st.background ? ' selected' : '') + '>— 未选择背景 —</option>' +
    Object.keys(BACKGROUNDS).map(function (b) {
      return '<option value="' + esc(b) + '"' + (st.background === b ? ' selected' : '') + '>' + esc(b) + '</option>';
    }).join('') +
    (st.background && !BACKGROUNDS[st.background] && st.background !== '自定义背景'
      ? '<option value="' + esc(st.background) + '" selected>' + esc(st.background) + '（旧）</option>' : '') +
    '<option value="自定义背景"' + (st.background === '自定义背景' ? ' selected' : '') + '>自定义背景…</option>';

  // 属性网格渲染（骰点模式 → 分配槽；其他模式 → 数字输入框）
  function renderAbilityGrid() {
    var grid = $id('cb2c-ability-grid');
    if (!grid) return;
    var isRoll = st.mode === 'rolled';
    // 骰点层级1：未选组时不显示分配槽，提示先选组
    if (isRoll && st.rollPick < 0) {
      grid.innerHTML = '<div class="cb2-hint">👆 请先在上方 <b>5 组骰点</b> 中选择一组，再分配六项属性</div>';
      return;
    }
    grid.innerHTML = ABILITIES.map(function (a) {
      var v = st.scores[a.key];
      var has = v != null;
      var md = abilityMod(has ? v : 8);
      var slotHtml = isRoll
        ? '<button type="button" class="cb2-ab-slot' + (has ? ' filled' : '') + '" data-act="assign-ab" data-ab="' + a.key + '" title="' + (has ? '点击回收该值到骰池' : '点击从骰池分配数值') + '">' + (has ? v : '待分配') + '</button>'
        : '<input type="number" class="cb2-in cb2-ab-input" id="cb2c-ab-' + a.key + '" min="3" max="20" value="' + (has ? v : 8) + '">';
      return '<div class="cb2-ab-item' + (has ? ' filled' : '') + '">' +
        '<div class="save-t"><label class="cb2-save" title="该属性豁免是否熟练"><input type="checkbox" data-save="' + a.key + '"' + (st.saves[a.key] ? ' checked' : '') + '>豁免</label></div>' +
        '<div class="nm">' + esc(a.name) + '<span class="sc-ab">' + a.short + '</span></div>' +
        slotHtml +
        '<div class="md' + (md < 0 ? ' neg' : '') + '" id="cb2c-ab-md-' + a.key + '">' + signed(md) + '</div>' +
        '</div>';
    }).join('');
  }

  // 把当前组分配状态同步回 rollSets（返回重选时可恢复）
  function saveCurrentRollSet() {
    if (st.rollPick >= 0 && st.rollSets[st.rollPick]) {
      st.rollSets[st.rollPick].scores = Object.assign({}, st.scores);
      st.rollSets[st.rollPick].pool = st.rolledPool.slice();
    }
  }
  // 进入某一组（层级1→2）：恢复该组已保存的分配，或重置为未分配
  function enterRollSet(i) {
    saveCurrentRollSet();
    st.rollPick = i;
    var rs = st.rollSets[i];
    st.rolledPool = rs.pool.slice();
    if (rs.scores) {
      st.scores = Object.assign({}, rs.scores);
    } else {
      ABILITIES.forEach(function (a) { st.scores[a.key] = null; });
    }
    st.pickedIdx = -1;
    renderAbilityGrid();
    updateDerived();
  }

  var skillRows = SKILLS.map(function (s) {
    var t = st.trained[s.name] || '未熟练';
    // 来源标签：背景/职业/自定义 区分显示
    var srcs = st.skillSources && st.skillSources[s.name] ? st.skillSources[s.name] : [];
    var srcHtml = srcs.length ? '<span class="cb2-skill-src">' + srcs.map(function (x) { return esc(x); }).join(' · ') + '</span>' : '';
    return '<div class="cb2-skill-row">' +
      '<span class="nm">' + esc(s.name) + '<em>' + esc(s.ability) + '</em>' + srcHtml + '</span>' +
      '<span class="bn" id="cb2c-sk-' + esc(s.name) + '">+0</span>' +
      '<select class="cb2-in" data-sk-sel="' + esc(s.name) + '">' +
      '<option value="未熟练"' + (t === '未熟练' ? ' selected' : '') + '>未熟练</option>' +
      '<option value="熟练"' + (t === '熟练' ? ' selected' : '') + '>熟练</option>' +
      '<option value="专精"' + (t === '专精' ? ' selected' : '') + '>专精</option>' +
      '</select></div>';
  }).join('');

  function featListHtml() {
    return '<div id="cb2c-feat-list">' + (st.features.length ? st.features.map(function (f, i) {
      return '<div class="cb2-sel-chip">' + esc(f) + '<button type="button" class="rm" data-act="feat-del" data-i="' + i + '">✕</button></div>';
    }).join('') : '<div class="cb2-hint">暂无 — 创建后可在详情页「升级」时记录职业能力</div>') + '</div>';
  }
  var featHtml = featListHtml();

  var flowHtml = '';
  var STEPS = [
    ['基础信息', '姓名 / 种族 / 职业 / 等级 / 背景 / 阵营 / 外貌性格'],
    ['属性生成', '骰点 / 购点 / 标准数组 / 手动'],
    ['技能熟练', '职业与背景自动联动'],
    ['法术', '按环位选法术（施法职业）'],
    ['起始装备', '按职业套装一键预填'],
    ['特性', '初始能力记录']
  ];
  if (!editData) {
    var stepBar = '<div class="cb2-flow-steps" id="cb2c-flow-steps" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
      STEPS.map(function (s, i) {
        return '<span class="cb2-flow-step' + (i === 0 ? ' cur' : '') + '" data-act="flow-step" data-i="' + i + '" title="' + esc(s[1]) + '">' + (i + 1) + '. ' + esc(s[0]) + '</span>';
      }).join('') +
      '<span style="margin-left:auto;display:flex;gap:4px;align-items:center">' +
      '<button type="button" class="cb2-btn sm" data-act="flow-prev" id="cb2c-flow-prev" style="visibility:hidden">← 上一步</button>' +
      '<button type="button" class="cb2-btn gold sm" data-act="flow-next" id="cb2c-flow-next">下一步 →</button>' +
      '</span>' +
      '</div>';
    flowHtml =
      '<div class="cb2-flow-bar">' +
      '<button type="button" class="cb2-flow-card' + (st.flowType === 'guide' ? ' on' : '') + '" data-act="flow-card" data-flow="guide">' +
      '<div class="ic">🧭</div><div class="t">开卡流程</div><div class="d">按规则书标准流程分步创建：属性生成（骰点/购点/标准数组）→ 技能 → 法术 → 起始装备 → 背景，每步有引导与自动计算。</div></button>' +
      '<button type="button" class="cb2-flow-card' + (st.flowType === 'quick' ? ' on' : '') + '" data-act="flow-card" data-flow="quick">' +
      '<div class="ic">⚡</div><div class="t">快速创建</div><div class="d">直接填写核心字段（姓名/职业/属性/装备）即可保存，属性可用手动输入或标准数组，适合已有明确构想的快速建档。</div></button>' +
      '</div>' +
      (st.flowType === 'guide' ? stepBar : '');
  }

  container.innerHTML = '<div class="cb2 cb2-create">' +
    flowHtml +
    // 规则版本切换（2024 玩家手册 / 2014 玩家手册）
    '<div class="cb2-sec" data-step="0" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px">' +
    '<div class="cb2-rulever"><span class="cb2-rulever-ic">📚</span>规则版本</div>' +
    '<div class="cb2-rulever-sw">' +
    '<button type="button" class="cb2-rulever-btn' + (st.ruleVersion === '2024' ? ' on' : '') + '" data-act="rule-ver" data-v="2024" title="玩家手册2024：背景提供属性提升与起源专长，技能含专精">2024 玩家手册</button>' +
    '<button type="button" class="cb2-rulever-btn' + (st.ruleVersion === '2014' ? ' on' : '') + '" data-act="rule-ver" data-v="2014" title="玩家手册2014：背景不提供属性与专长，技能无专精">2014 玩家手册</button>' +
    '</div>' +
    '<div class="cb2-rulever-tip" id="cb2c-rulever-tip">' + (st.ruleVersion === '2024' ? '背景提供 3 项属性提升与 1 个起源专长，自动应用' : '背景不提供属性提升与专长（2014 规则），技能无专精') + '</div>' +
    '</div>' +
    // 基本信息
    '<div class="cb2-sec" data-step="0" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="cb2-field" style="flex:2;min-width:170px"><label>角色姓名 *</label>' +
    '<input type="text" class="cb2-in" id="cb2c-name" value="' + esc(st.name) + '" placeholder="如：阿拉贡·风行"></div>' +
    '<div class="cb2-field"><label>种族</label><select class="cb2-in" id="cb2c-race">' + raceOptions + '</select></div>' +
    '<div class="cb2-field"><label>职业</label><select class="cb2-in" id="cb2c-cls">' + clsOptions + '</select></div>' +
    '<div class="cb2-field" id="cb2c-custom-cls-wrap" style="display:' + (st.cls === '自定义' ? '' : 'none') + '"><label>自定义职业名</label>' +
    '<input type="text" class="cb2-in" id="cb2c-custom-cls" value="' + esc(st.customClass) + '" placeholder="如：魔剑士"></div>' +
    '<div class="cb2-field"><label>等级</label><input type="number" class="cb2-in cb2-in-sm" id="cb2c-level" min="1" max="20" value="' + st.level + '"></div>' +
    '<div class="cb2-field"><label>背景</label><select class="cb2-in" id="cb2c-bg">' + bgOptions + '</select></div>' +
    '<div class="cb2-bg-card" id="cb2c-bg-card" style="width:100%"></div>' +
    '<div class="cb2-field"><label>阵营</label><select class="cb2-in" id="cb2c-align">' + alignOptions + '</select></div>' +
    '</div>' +
    // 背景设定（2024 角色起源：外貌/性格/理想/牵绊/缺陷 与基础信息整合）
    '<div class="cb2-sec" data-step="0">' +
    '<h4 class="cb2-sec-h">🧬 背景设定 <span class="cb2-sec-note">外貌 / 性格 / 理想 / 牵绊 / 缺陷 · 可选</span></h4>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field"><label>外貌</label><input type="text" class="cb2-in" id="cb2c-bio-appearance" value="' + esc(st.bio.appearance || '') + '" placeholder="如：银发灰眸，左颊有一道旧伤"></div>' +
    '<div class="cb2-field"><label>性格</label><input type="text" class="cb2-in" id="cb2c-bio-personality" value="' + esc(st.bio.personality || '') + '" placeholder="如：沉着冷静，对弱者心怀怜悯"></div>' +
    '<div class="cb2-field"><label>理想</label><input type="text" class="cb2-in" id="cb2c-bio-ideals" value="' + esc(st.bio.ideals || '') + '" placeholder="如：荣耀高于一切"></div>' +
    '<div class="cb2-field"><label>牵绊</label><input type="text" class="cb2-in" id="cb2c-bio-bonds" value="' + esc(st.bio.bonds || '') + '" placeholder="如：誓死保护同行的旅伴"></div>' +
    '<div class="cb2-field full"><label>缺陷</label><input type="text" class="cb2-in" id="cb2c-bio-flaws" value="' + esc(st.bio.flaws || '') + '" placeholder="如：无法拒绝求助之人"></div>' +
    '</div></div>' +
    '<div class="cb2-create-grid">' +
    // ── 左列 ──
    '<div>' +
    // 属性
    '<div class="cb2-sec" data-step="1">' +
    '<h4 class="cb2-sec-h">⚡ 属性 <span class="cb2-sec-note" id="cb2c-mode-note"></span></h4>' +
    '<div class="cb2-bonus-bar" id="cb2c-bonus" style="display:none"></div>' +
    '<div class="cb2-mode-tabs">' +
    '<button type="button" class="cb2-mode-tab" data-mode="rolled">🎲 骰点</button>' +
    '<button type="button" class="cb2-mode-tab" data-mode="pointbuy">⚖️ 购点 27</button>' +
    '<button type="button" class="cb2-mode-tab" data-mode="array">📋 标准数组</button>' +
    '<button type="button" class="cb2-mode-tab" data-mode="manual">✍️ 手动</button>' +
    '</div>' +
    '<div class="cb2-mode-hint" id="cb2c-mode-hint"></div>' +
    '<div id="cb2c-pool-wrap"></div>' +
    '<div class="cb2-ability-grid" id="cb2c-ability-grid"></div>' +
    '<div class="cb2-row" style="margin-top:10px" id="cb2c-mode-extra"></div>' +
    '<div class="cb2-save-grid" id="cb2c-saves"></div>' +
    '</div>' +
    // 战斗与状态
    '<div class="cb2-sec" data-step="1">' +
    '<h4 class="cb2-sec-h">🛡️ 战斗与状态 <span class="cb2-sec-note">实时计算</span></h4>' +
    '<div class="cb2-row">' +
    '<div class="cb2-field"><label>护甲</label><select class="cb2-in" id="cb2c-armor">' + armorOptions + '</select></div>' +
    '<div class="cb2-field"><label>&nbsp;</label><label class="cb2-save" style="font-size:12px;padding-top:4px"><input type="checkbox" id="cb2c-shield"' + (st.shield ? ' checked' : '') + '> 🛡 持盾 (+2 AC)</label></div>' +
    '<div class="cb2-field"><label>体型</label><select class="cb2-in" id="cb2c-size">' +
    ['微型', '小型', '中型', '大型', '巨型'].map(function (z) { return '<option' + (st.size === z ? ' selected' : '') + '>' + z + '</option>'; }).join('') + '</select></div>' +
    '<div class="cb2-field" style="flex:1;min-width:120px"><label>语言</label><input type="text" class="cb2-in" id="cb2c-lang" value="' + esc(st.languages) + '" placeholder="如：通用语、精灵语"></div>' +
    '</div>' +
    '<div class="cb2-derived" id="cb2c-derived"></div>' +
    '</div>' +
    // 技能
    '<div class="cb2-sec" data-step="2">' +
    '<h4 class="cb2-sec-h">🎓 技能熟练 <span class="cb2-sec-note">' + SKILLS.length + ' 项 · 推荐已预选</span></h4>' +
    '<div class="cb2-hint">熟练 +' + 'PB' + '（熟练加值），专精 +PB×2。使用下拉切换。</div>' +
    '<div style="margin-top:8px">' + skillRows + '</div>' +
    '</div>' +
    '</div>' +
    // ── 右列 ──
    '<div>' +
    '<div class="cb2-sec" data-step="3" id="cb2c-spell-sec">' +
    '<h4 class="cb2-sec-h">🔮 法术 <span class="cb2-sec-note" id="cb2c-spell-count">读取中…</span></h4>' +
    '<div id="cb2c-spell-body"><div class="cb2-loading">⏳ 正在从规则书加载职业法术表…</div></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="4" id="cb2c-equip-sec">' +
    '<h4 class="cb2-sec-h">🎒 起始装备 <span class="cb2-sec-note" id="cb2c-item-count">读取中…</span></h4>' +
    '<div id="cb2c-equip-body"><div class="cb2-loading">⏳ 正在从规则书加载装备表…</div></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="5" id="cb2c-feat-sec">' +
    '<h4 class="cb2-sec-h">⭐ 特性记录 <span class="cb2-sec-note">可选 · 升级时自动累积</span></h4>' +
    featHtml +
    '<div class="cb2-row" style="margin-top:8px">' +
    '<input type="text" class="cb2-in" id="cb2c-feat-input" placeholder="如：精灵之优雅、初阶魔导" style="flex:1">' +
    '<button type="button" class="cb2-btn gold sm" data-act="feat-add">＋ 添加</button>' +
    '</div></div>' +
    '</div>' +
    '</div>' +
    '</div>';

  // ── 记录各区块原始 display（分页恢复用）── 必须在任何显隐操作之前
  container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
    sec.setAttribute('data-orig-display', sec.style.display || '');
  });

  // ── 工具 ──
  function $id(id) { return container.querySelector('#' + id); }
  function setText(id, txt) { var el = $id(id); if (el) el.textContent = txt; }

  // ── 背景信息卡（2024：属性提升/专长/技能/工具/装备 + 一键应用；可选内容均交互化）──
  // 解析背景装备文本 "A：xx、2小包、32GP；或 B：50GP" → {A:{items:[{name,quantity}],gold}, B:{gold}}
  function parseBgEquip(eqStr) {
    var s = String(eqStr || '');
    var out = { A: null, B: null };
    var mA = s.match(/A：([^；;]+)/);
    if (mA) {
      var parts = mA[1].split('、').map(function (x) { return x.trim(); }).filter(Boolean);
      var gold = 0;
      var gm = mA[1].match(/(\d+)\s*GP/i);
      if (gm) gold = Number(gm[1]);
      if (parts.length && gm) parts.pop(); // 去掉末尾金币项
      var items = parts.map(function (p) {
        var quantity = 1, name = p;
        var m = p.match(/^(\d+)(.+)$/);          // "2小包" → 数量2
        if (m) { quantity = Number(m[1]); name = m[2].replace(/^支/, ''); }
        else {
          var m2 = p.match(/^(.+?)[×xX](\d+)$/);  // "羊皮纸×10" → 数量10
          if (m2) { name = m2[1]; quantity = Number(m2[2]); }
        }
        return { name: name, quantity: quantity };
      }).filter(function (it) { return it.name; });
      out.A = { items: items, gold: gold };
    }
    var mB = s.match(/B：(\d+)\s*GP/i);
    if (mB) out.B = { gold: Number(mB[1]) };
    return out;
  }
  // 背景装备物品 → 展示文本（"小包 ×2"）
  function bgEquipItemsText(items) {
    if (!items || !items.length) return '';
    return items.map(function (it) {
      return it.name + (it.quantity > 1 ? ' ×' + it.quantity : '');
    }).join('、');
  }
  // 应用/切换背景属性加值模式：'21'=+2/+1；'111'=三项各+1；null=撤销
  function applyBgAttr(mode) {
    var info = BACKGROUNDS[st.background];
    if (!info) return;
    currentScores();
    // 先撤销旧背景加值（恢复应用前的原始值）
    if (st.bgApplied && st.bgApplied.before) {
      ABILITIES.forEach(function (a) { st.scores[a.key] = st.bgApplied.before[a.key]; });
    }
    if (!mode) {
      st.bgApplied = null;
    } else {
      // 记录未加背景时的原始值，再应用新模式
      var before = {};
      ABILITIES.forEach(function (a) { before[a.key] = st.scores[a.key]; });
      var list = info.abilities;
      if (mode === '21') {
        var pKey = BG_ABILITY_KEY[list[0]], sKey = BG_ABILITY_KEY[list[1]];
        if (pKey && st.scores[pKey] != null) st.scores[pKey] = clampScore(Number(st.scores[pKey]) + 2);
        if (sKey && st.scores[sKey] != null) st.scores[sKey] = clampScore(Number(st.scores[sKey]) + 1);
      } else {
        list.forEach(function (n) {
          var k = BG_ABILITY_KEY[n];
          if (k && st.scores[k] != null) st.scores[k] = clampScore(Number(st.scores[k]) + 1);
        });
      }
      st.bgApplied = { mode: mode, before: before };
    }
    ABILITIES.forEach(function (a) {
      var iEl = $id('cb2c-ab-' + a.key);
      if (iEl && st.scores[a.key] != null) iEl.value = st.scores[a.key];
    });
    renderAbilityGrid();
    updateDerived();
    renderBgCard();
  }
  // ── 熟练来源管理系统 ──
  // 技能来源：skillSources[技能名] = ['职业·战士','背景·工匠','自定义']
  // 工具来源：toolSources[工具名] = ['职业·武僧','背景·工匠']
  // 规则：来源自动添加/移除；某来源移除后若技能/工具无其他来源则自动取消熟练
  function skillSourceKey(kind, name) { return kind + '·' + name; }
  function addSkillSource(skill, src) {
    if (!skill || !src) return;
    st.skillSources = st.skillSources || {};
    st.skillSources[skill] = st.skillSources[skill] || [];
    if (st.skillSources[skill].indexOf(src) < 0) st.skillSources[skill].push(src);
    st.trained[skill] = '熟练';
  }
  function removeSkillSource(skill, src) {
    if (!skill || !st.skillSources || !st.skillSources[skill]) return;
    st.skillSources[skill] = st.skillSources[skill].filter(function (x) { return x !== src; });
    if (!st.skillSources[skill].length) {
      delete st.skillSources[skill];
      if (st.trained[skill] === '熟练') st.trained[skill] = '未熟练'; // 仅自动来源时降级；专精保留（用户手动提升）
    }
  }
  function addToolSource(tool, src) {
    if (!tool || !src) return;
    st.toolSources = st.toolSources || {};
    st.toolSources[tool] = st.toolSources[tool] || [];
    if (st.toolSources[tool].indexOf(src) < 0) st.toolSources[tool].push(src);
    if (st.toolProfs.indexOf(tool) < 0) st.toolProfs.push(tool);
  }
  function removeToolSource(tool, src) {
    if (!tool || !st.toolSources || !st.toolSources[tool]) return;
    st.toolSources[tool] = st.toolSources[tool].filter(function (x) { return x !== src; });
    if (!st.toolSources[tool].length) {
      delete st.toolSources[tool];
      st.toolProfs = st.toolProfs.filter(function (x) { return x !== tool; });
    }
  }
  // 职业联动：清除旧职业来源，添加新职业来源
  function applyClassProficiencies(cls) {
    var oldCls = st.cls || cls;
    // 移除旧职业的技能/工具来源
    if (oldCls && oldCls !== '自定义') {
      var oldSkills = SKILL_RECS[oldCls] || [];
      oldSkills.forEach(function (n) { removeSkillSource(n, '职业·' + oldCls); });
      var oldTools = (CLASS_TOOL_CHOICE[oldCls] ? st.toolProfs.slice() : []);
      oldTools.forEach(function (t) {
        var isClsTool = (CLASS_TOOL_CHOICE[oldCls] || []).some(function (c) { return TOOL_LISTS[c].indexOf(t) >= 0; });
        if (isClsTool) removeToolSource(t, '职业·' + oldCls);
      });
    }
    st.cls = cls;
    if (cls !== '自定义') {
      // 新职业来源（背景同名的技能不覆盖，来源叠加）
      (SKILL_RECS[cls] || []).forEach(function (n) { addSkillSource(n, '职业·' + cls); });
      // 职业豁免（来源自动）
      st.saves = st.saves || {};
      (SAVE_RECS[cls] || []).forEach(function (k) { st.saves[k] = true; });
    }
  }
  // 背景联动：清除旧背景来源，添加新背景来源（含自定义背景）
  function applyBgProficiencies(bg, bgInfo) {
    var oldBg = st.background;
    // 移除旧背景的技能/工具来源
    if (oldBg && oldBg !== '自定义背景') {
      var oldInfo = BACKGROUNDS[oldBg];
      if (oldInfo) {
        (oldInfo.skills || []).forEach(function (n) { removeSkillSource(n, '背景·' + oldBg); });
        var oldTool = st.bgToolCache || oldInfo.tool;
        if (oldTool && oldTool !== '选择一种工匠工具' && oldTool !== '选择一种乐器' && oldTool !== '选择一种赌具') {
          removeToolSource(oldTool, '背景·' + oldBg);
        } else {
          // 可选工具：移除该类别下旧背景选中的工具
          var oldCat = bgToolCategory(oldTool);
          if (oldCat) {
            st.toolProfs.slice().forEach(function (t) {
              if (TOOL_LISTS[oldCat].indexOf(t) >= 0) removeToolSource(t, '背景·' + oldBg);
            });
          }
        }
      }
    } else if (oldBg === '自定义背景' && st.customBg) {
      // 旧自定义背景来源
      (st.customBg.skills || []).forEach(function (n) { removeSkillSource(n, '背景·自定义'); });
      if (st.customBg.tool) removeToolSource(st.customBg.tool, '背景·自定义');
    }
    st.background = bg;
    if (bgInfo) {
      (bgInfo.skills || []).forEach(function (n) { addSkillSource(n, '背景·' + bg); });
      var tool = bgInfo.tool;
      if (tool && tool !== '选择一种工匠工具' && tool !== '选择一种乐器' && tool !== '选择一种赌具') {
        addToolSource(tool, '背景·' + bg);
        st.bgToolCache = tool;
      }
    } else if (bg === '自定义背景' && st.customBg) {
      // 自定义背景：应用技能/工具来源（来源前缀「背景·自定义」）
      (st.customBg.skills || []).forEach(function (n) { addSkillSource(n, '背景·自定义'); });
      if (st.customBg.tool) addToolSource(st.customBg.tool, '背景·自定义');
    }
  }
  // 应用背景技能熟练（旧版按钮保留，但改为来源驱动）
  function applyBgSkills() {
    var info = BACKGROUNDS[st.background];
    if (!info) return;
    info.skills.forEach(function (n) {
      addSkillSource(n, '背景·' + st.background);
      var sel = container.querySelector('[data-sk-sel="' + n + '"]');
      if (sel) sel.value = '熟练';
    });
    updateDerived();
  }
  // 应用背景装备选项（A 套装 / B 金币）
  function applyBgEquip(opt) {
    var eqOpts = st.bgEquipData || {};
    var pick = opt === 'A' ? eqOpts.A : eqOpts.B;
    if (!pick) return;
    st.bgEquip = opt;
    // 先移除上一来源（A 套装）加入的物品
    var rmMap = {};
    (st.bgAppliedItems || []).forEach(function (n) { rmMap[n] = (rmMap[n] || 0) + 1; });
    if (Object.keys(rmMap).length) {
      st.items = st.items.map(function (x) {
        if (rmMap[x.name]) {
          var d = Math.min(rmMap[x.name], x.quantity);
          rmMap[x.name] -= d;
          x.quantity -= d;
        }
        return x;
      }).filter(function (x) { return x.quantity > 0; });
    }
    st.bgAppliedItems = [];
    if (opt === 'B') {
      st.bgGold = pick.gold || 0;
    } else {
      st.bgGold = 0;
      var names = {};
      st.items.forEach(function (x) { names[x.name] = (names[x.name] || 0) + x.quantity; });
      (pick.items || []).forEach(function (it) { if (it && it.name) names[it.name] = (names[it.name] || 0) + it.quantity; });
      var merged = [];
      Object.keys(names).forEach(function (n) {
        if (!n) return;
        var isArmor = ARMOR_LIST.indexOf(n) >= 0;
        merged.push({ name: n, category: isArmor ? '护甲' : '杂物', quantity: names[n], equipped: isArmor && n === st.armor });
      });
      st.items = merged;
      st.bgAppliedItems = (pick.items || []).map(function (it) { return it.name; });
      refreshSelection();
      updateDerived();
    }
    renderBgCard();
  }
  function renderBgCard() {
    var card = $id('cb2c-bg-card');
    if (!card) return;
    var bg = st.background;
    if (!bg) {
      card.innerHTML = '<div class="cb2-bg-card-t">📜 选择背景 <span class="cb2-bg-card-tag">' + (st.ruleVersion === '2024' ? '2024 角色起源' : '2014 背景') + '</span></div>' +
        '<div class="cb2-bg-card-grid"><div class="cb2-bg-cell full"><div style="color:var(--text-mute);font-size:12px">' +
        (st.ruleVersion === '2024'
          ? '2024 背景提供 <b>3 项属性提升</b>（+2/+1 或三项各 +1）、<b>1 个起源专长</b>、<b>2 项技能熟练</b>、<b>工具熟练</b>与<b>装备（或 50GP）</b>。选择背景后将自动应用属性提升与技能勾选。'
          : '2014 背景提供 <b>2 项技能熟练</b>、<b>工具熟练</b>与<b>装备（或金币）</b>，不提供属性提升与专长。') +
        '</div></div></div>';
      return;
    }
    var info = BACKGROUNDS[bg];
    if (!info) {
      // ── 自定义背景：选项化表单（技能2项 / 工具1项 / 装备A或B / 2024属性提升方案）──
      var cb = st.customBg || (st.customBg = { name: '', skills: [], tool: '', toolCat: '', equip: 'A', equipGold: 0, attr: '21' });
      // 技能多选 chips（每项技能可点选/取消，最多 2 项）
      var cbSkillHtml = SKILLS.map(function (s) {
        var on = cb.skills.indexOf(s.name) >= 0;
        var disabled = !on && cb.skills.length >= 2;
        return '<span class="cb2-chip' + (on ? ' on' : '') + (disabled ? ' dis' : '') + '" data-act="cbg-skill" data-name="' + esc(s.name) + '"' + (disabled ? ' style="opacity:.4;cursor:not-allowed"' : '') + '>' + esc(s.name) + '</span>';
      }).join('');
      // 工具类别 + 具体工具
      var cbToolCat = cb.toolCat || '工匠工具';
      var cbToolSel = '<select class="cb2-in cb2-in-sm" data-cbg-toolcat style="max-width:110px">' +
        Object.keys(TOOL_LISTS).map(function (c) { return '<option value="' + c + '"' + (cb.toolCat === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
        '<select class="cb2-in cb2-in-sm" data-cbg-tool style="max-width:150px">' +
        '<option value="">— 选择 —</option>' +
        TOOL_LISTS[cbToolCat].map(function (t) { return '<option value="' + esc(t) + '"' + (cb.tool === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>';
      // 装备：A 套装（可输入若干件）/ B 金币
      var cbEquipHtml = '<div class="cb2-bg-equip">' +
        '<button type="button" class="cb2-btn sm' + (cb.equip === 'A' ? ' gold' : '') + '" data-act="cbg-equip-a" title="选择装备套装">A 套装</button>' +
        '<span class="cb2-bg-equip-d">' + (cb.equip === 'A' ? '<input type="text" class="cb2-in" id="cb2c-cbg-items" value="' + esc((cb.items || []).join('、')) + '" placeholder="如：旅行者服装、小刀、火绒盒" style="max-width:240px">' : '') + '</span>' +
        '<button type="button" class="cb2-btn sm' + (cb.equip === 'B' ? ' gold' : '') + '" data-act="cbg-equip-b" title="不取装备，改拿金币">B 金币</button>' +
        (cb.equip === 'B' ? '<input type="number" class="cb2-in cb2-in-sm" id="cb2c-cbg-gold" value="' + (cb.gold || 50) + '" min="0" max="1000" style="width:70px"> GP' : '') +
        '</div>';
      card.innerHTML =
        '<div class="cb2-bg-card-t">📜 自定义背景 <span class="cb2-bg-card-tag">' + (st.ruleVersion === '2024' ? '2024 角色起源' : '2014 背景') + '</span></div>' +
        '<div class="cb2-bg-card-grid">' +
        '<div class="cb2-bg-cell full"><label>背景名称</label>' +
        '<input type="text" class="cb2-in" id="cb2c-bg-custom" value="' + esc(cb.name || '') + '" placeholder="如：宫廷弄臣" style="max-width:240px"></div>' +
        '<div class="cb2-bg-cell full"><label>技能熟练（选 2 项）</label><div class="cb2-chiprow">' + cbSkillHtml + '</div></div>' +
        '<div class="cb2-bg-cell full"><label>工具熟练</label><div class="cb2-row" style="gap:6px">' + cbToolSel + '</div></div>' +
        '<div class="cb2-bg-cell full"><label>装备（A 套装或 B 金币）</label><div>' + cbEquipHtml + '</div></div>' +
        (st.ruleVersion === '2024' ? '<div class="cb2-bg-cell full"><label>属性提升方案</label><div class="cb2-attr-plan-row" style="margin-bottom:0">' +
          '<div class="cb2-attr-plan' + (cb.attr === '21' ? ' on' : '') + '" data-act="cbg-attr-21"><div class="cb2-attr-plan-t">方案 A</div><div class="cb2-attr-plan-v">+2 / +1</div></div>' +
          '<div class="cb2-attr-plan' + (cb.attr === '111' ? ' on' : '') + '" data-act="cbg-attr-111"><div class="cb2-attr-plan-t">方案 B</div><div class="cb2-attr-plan-v">三项各 +1</div></div>' +
          '</div></div>' : '') +
        '</div>';
      return;
    }
    // 装备选项解析
    if (!st.bgEquipData) st.bgEquipData = parseBgEquip(info.equip);
    var eqOpts = st.bgEquipData || {};
    // 工具熟练：固定工具 or 可选项
    var toolCat = bgToolCategory(info.tool);
    var toolHtml = '';
    if (toolCat) {
      var cur = '';
      (st.toolProfs || []).forEach(function (t) {
        if (TOOL_LISTS[toolCat].indexOf(t) >= 0) cur = t;
      });
      toolHtml = '<select class="cb2-in" data-tool-sel="' + toolCat + '" style="max-width:180px">' +
        '<option value="">— 选择一种' + toolCat + ' —</option>' +
        TOOL_LISTS[toolCat].map(function (t) {
          return '<option value="' + esc(t) + '"' + (cur === t ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</select>' +
        '<div class="cb2-mini-label" style="margin-top:2px">选择后加入「工具熟练」列表</div>';
    } else {
      toolHtml = '<span style="color:var(--gold-l)">✔ ' + esc(info.tool) + '</span>';
      // 固定工具背景：追加到工具熟练列表（去重），不覆盖职业等其他来源的选择
      st.toolProfs = st.toolProfs || [];
      if (st.toolProfs.indexOf(info.tool) < 0) st.toolProfs.push(info.tool);
    }
    // 起源专长（悬浮显示效果）
    var feat = info.feat;
    var featDesc = '';
    Object.keys(ORIGIN_FEATS).forEach(function (k) {
      if (feat.indexOf(k) >= 0) featDesc = ORIGIN_FEATS[k];
    });
    // 属性加值当前状态
    var applied = st.bgApplied;
    var attrState = applied ? (applied.mode === '21'
      ? info.abilities[0] + ' +2、' + info.abilities[1] + ' +1'
      : info.abilities.join('、') + ' 各 +1') : '未应用';
    // 装备选项按钮
    var eqHtml = '<div class="cb2-bg-equip">';
    if (eqOpts.A) {
      var aTip = 'A 套装：' + bgEquipItemsText(eqOpts.A.items) + (eqOpts.A.gold ? '、' + eqOpts.A.gold + 'GP' : '');
      eqHtml += '<button type="button" class="cb2-btn sm' + (st.bgEquip === 'A' ? ' gold' : '') + '" data-act="bg-equip-a" title="' + esc(aTip) + '">A 套装</button>' +
        '<span class="cb2-bg-equip-d" title="' + esc(aTip) + '">' + esc(eqOpts.A.items.length + ' 件' + (eqOpts.A.gold ? ' + ' + eqOpts.A.gold + 'GP' : '')) + '</span>';
    }
    if (eqOpts.B) {
      eqHtml += '<button type="button" class="cb2-btn sm' + (st.bgEquip === 'B' ? ' gold' : '') + '" data-act="bg-equip-b" title="不取装备，改拿金币">B：' + eqOpts.B.gold + 'GP</button>';
    }
    eqHtml += '</div>';
    // 2024 与 2014 规则版本：背景卡内容差异（2014 无属性提升/起源专长，技能也无专精）
    var is2024 = st.ruleVersion === '2024';
    // 2024：属性提升方案卡（点击即应用，当前生效高亮）+ 撤销小按钮
    var attrPlanHtml = is2024
      ? '<div class="cb2-attr-plan' + (applied && applied.mode === '21' ? ' on' : '') + '" data-act="bg-apply-attr" title="' + esc(info.abilities[0] + ' +2、' + info.abilities[1] + ' +1') + '">' +
        '<div class="cb2-attr-plan-t">方案 A</div><div class="cb2-attr-plan-v">' + esc(info.abilities[0] + ' +2') + '<br>' + esc(info.abilities[1] + ' +1') + '</div></div>' +
        '<div class="cb2-attr-plan' + (applied && applied.mode === '111' ? ' on' : '') + '" data-act="bg-attr-111" title="三项属性各 +1">' +
        '<div class="cb2-attr-plan-t">方案 B</div><div class="cb2-attr-plan-v">' + esc(info.abilities.join('、')) + '<br>各 +1</div></div>' +
        '<button type="button" class="cb2-btn sm cb2-attr-undo" data-act="bg-attr-undo" title="撤销背景属性提升">↩ 撤销</button>' +
        '<button type="button" class="cb2-btn sm" data-act="bg-apply-skills" title="将背景的两项技能设为熟练">🎓 勾选技能</button>'
      : '<span class="cb2-bg-card-tag">2014 规则：仅技能/工具/装备</span>';
    var gridCells = '';
    if (is2024) {
      gridCells += '<div class="cb2-bg-cell"><label>属性（当前：' + esc(attrState) + '）</label><div>' + esc(info.abilities.join('、')) + '</div></div>';
      gridCells += '<div class="cb2-bg-cell"><label>起源专长</label><div><span class="cb2-feat-chip" data-feat-desc="' + encodeURIComponent(featDesc) + '">' + esc(feat) + ' ⓘ</span></div></div>';
    }
    gridCells += '<div class="cb2-bg-cell"><label>技能熟练</label><div>' + esc(info.skills.join('、')) + '</div></div>' +
      '<div class="cb2-bg-cell"><label>工具熟练</label><div>' + toolHtml + '</div></div>' +
      '<div class="cb2-bg-cell full"><label>装备（选择 A 套装或 B 金币）</label><div>' + eqHtml + '</div></div>';
    card.innerHTML =
      '<div class="cb2-bg-card-t">📜 ' + esc(bg) + ' <span class="cb2-bg-card-tag">' + (is2024 ? '2024 背景' : '2014 背景') + '</span>' +
      '</div>' +
      (is2024 ? '<div class="cb2-attr-plan-row">' + attrPlanHtml + '</div>' : '') +
      '<div class="cb2-bg-card-grid">' + gridCells + '</div>';
  }

  function currentScores() {
    if (st.mode === 'rolled') return st.scores; // 骰点模式：值由骰池分配维护，不读输入框
    ABILITIES.forEach(function (a) {
      var el = $id('cb2c-ab-' + a.key);
      if (el) st.scores[a.key] = clampScore(el.value);
    });
    return st.scores;
  }

  // 派生值实时刷新
  function updateDerived() {
    var scores = currentScores();
    var mods = {};
    ABILITIES.forEach(function (a) {
      var sc = scores[a.key] != null ? scores[a.key] : 8;
      mods[a.key] = abilityMod(sc);
      var mdEl = $id('cb2c-ab-md-' + a.key);
      if (mdEl) { mdEl.textContent = signed(mods[a.key]); mdEl.className = 'md' + (mods[a.key] < 0 ? ' neg' : ''); }
    });
    var level = Math.max(1, Math.min(20, Number(st.level) || 1));
    var cls = st.cls;
    var die = CLASS_HD[cls] || 'd8';
    var face = parseInt(String(die).replace('d', ''), 10) || 8;
    var prof = proficiencyBonus(level);
    var conMod = mods.con || 0;
    var maxHp = face + avgHpPerLevel(die) * (level - 1) + conMod * level;
    var AC = armorAC(st.armor, mods.dex, st.shield);
    var speed = defaultSpeed(st.race);
    var cap = carryCapacity(scores.str);
    var init = mods.dex;
    var atk = Math.max(mods.str || 0, mods.dex || 0) + prof;
    var cs = CASTING_STAT[cls];
    var dc = cs != null ? 8 + prof + (mods[cs] || 0) : null;
    var atkSpell = cs != null ? prof + (mods[cs] || 0) : null;

    // 派生面板
    var dHtml =
      '<div class="cb2-dv"><div class="l">HP 上限</div><div class="v">' + maxHp + '</div><div class="s">' + esc(die) + ' ×' + level + (conMod >= 0 ? ' +' + conMod + '×' + level : ' ' + conMod + '×' + level) + '</div></div>' +
      '<div class="cb2-dv"><div class="l">护甲 AC</div><div class="v">' + AC + '</div><div class="s">' + esc(st.armor) + (st.shield ? '+盾' : '') + '</div></div>' +
      '<div class="cb2-dv"><div class="l">速度</div><div class="v">' + speed + '</div><div class="s">尺</div></div>' +
      '<div class="cb2-dv"><div class="l">负重上限</div><div class="v">' + cap + '</div><div class="s">磅 (力×15)</div></div>' +
      '<div class="cb2-dv"><div class="l">熟练加值</div><div class="v ok">+' + prof + '</div><div class="s">PB</div></div>' +
      '<div class="cb2-dv"><div class="l">先攻</div><div class="v">' + signed(init) + '</div><div class="s">敏捷修正</div></div>' +
      '<div class="cb2-dv"><div class="l">攻击加值</div><div class="v">' + signed(atk) + '</div><div class="s">力/敏+PB</div></div>' +
      (dc != null ? '<div class="cb2-dv"><div class="l">法术 DC</div><div class="v warn">' + dc + '</div><div class="s">攻 ' + signed(atkSpell) + '</div></div>' : '<div class="cb2-dv"><div class="l">法术</div><div class="v" style="font-size:11px;color:var(--text-3)">—</div><div class="s">非施法职业</div></div>');
    var dEl = $id('cb2c-derived');
    if (dEl) dEl.innerHTML = dHtml;

    // 技能数值
    SKILLS.forEach(function (s) {
      var t = st.trained[s.name] || '未熟练';
      var b = (mods[ABILITY_KEY[s.ability]] || 0) + (t === '专精' ? prof * 2 : t === '熟练' ? prof : 0);
      setText('cb2c-sk-' + s.name, signed(b));
    });

    // 模式提示
    var hintEl = $id('cb2c-mode-hint');
    var extraEl = $id('cb2c-mode-extra');
    var noteEl = $id('cb2c-mode-note');
    if (hintEl) {
      if (st.mode === 'rolled') hintEl.innerHTML = st.rollPick < 0
        ? '一次性掷出 <b>5 组</b> 属性（每组 4d6 去最低 ×6）。<b>选中一组</b>后进入分配；骰点不可重掷，想重掷只能关闭角色卡重新创建。'
        : '第 <b>' + (st.rollPick + 1) + ' 组</b> 分配中（合计 ' + rollSetSum(st.rollSets[st.rollPick]) + '）：<b>点击骰值选中 → 点击属性槽分配</b>；已分配槽可回收重分；可返回重新选择属性组。';
      else if (st.mode === 'pointbuy') hintEl.innerHTML = '27 点购点（8→0、9→1、10→2、11→3、12→4、13→5、14→7、15→9）。<b>属性值限 8-15</b>，不可低于 3。';
      else if (st.mode === 'array') hintEl.innerHTML = '标准数组 <b>[15, 14, 13, 12, 10, 8]</b> 随机分配至六项属性，可切手动微调。';
      else hintEl.innerHTML = '自由输入 3-20 的属性值（默认 8）。';
    }
    var poolWrap = $id('cb2c-pool-wrap');
    if (st.mode === 'rolled') {
      if (poolWrap) {
        if (st.rollPick < 0) {
          // ── 层级1：5 组属性卡片，点击一组进入分配 ──
          poolWrap.innerHTML = '<div class="cb2-rollset-grid">' + st.rollSets.map(function (rs, i) {
            return '<button type="button" class="cb2-rollset-card" data-act="roll-pick-set" data-i="' + i + '" title="选择第 ' + (i + 1) + ' 组并分配属性">' +
              '<div class="cb2-rollset-t"><span>第 ' + (i + 1) + ' 组</span><span class="cb2-rollset-sum">合计 ' + rollSetSum(rs) + '</span></div>' +
              '<div class="cb2-rollset-chips">' + rs.pool.map(function (v) { return '<span>' + v + '</span>'; }).join('') + '</div>' +
              '</button>';
          }).join('') + '</div>' +
          '<div class="cb2-pool-msg">掷出 <b>5 组</b> 属性，点击一组进入分配。六项属性全部就位后才能保存；<b>骰点不可重掷</b>，想重掷请关闭当前角色卡重新创建。</div>';
        } else {
          // ── 层级2：当前组骰池 + 返回重选 ──
          poolWrap.innerHTML =
            '<div class="cb2-rollset-back"><button type="button" class="cb2-btn sm" data-act="roll-back">← 返回重新选择属性组</button>' +
            '<span class="cb2-rollset-cur">第 <b>' + (st.rollPick + 1) + ' 组</b> · 合计 ' + rollSetSum(st.rollSets[st.rollPick]) + '</span></div>' +
            '<div class="cb2-pool">' + st.rolledPool.map(function (v, i) {
              return '<button type="button" class="cb2-pool-chip' + (st.pickedIdx === i ? ' sel' : '') + '" data-act="pick-pool" data-i="' + i + '" title="选中该骰值，再点击属性槽分配">' + v + '</button>';
            }).join('') + '</div>' +
            '<div class="cb2-pool-msg">' + (st.pickedIdx >= 0 ? '已选中 <b>' + st.rolledPool[st.pickedIdx] + '</b>，点击上方属性槽分配；或再点骰值取消。' : '点击骰值选中，再点击属性槽分配。') + '</div>';
        }
      }
      if (extraEl) extraEl.innerHTML = ''; // 骰点不可重掷：不再提供重新骰点按钮
    } else {
      if (poolWrap) poolWrap.innerHTML = '';
      if (extraEl) {
        if (st.mode === 'array') extraEl.innerHTML = '<button type="button" class="cb2-btn gold sm" data-act="shuffle-array">🔀 随机分配标准数组</button>';
        else extraEl.innerHTML = '';
      }
    }
    if (noteEl) {
      if (st.mode === 'pointbuy') {
        var cost = pointbuyCost(scores);
        var remain = POINTBUY_POINTS - cost;
        noteEl.textContent = '已用 ' + cost + ' / 27 点' + (remain >= 0 ? ' · 剩余 ' + remain : ' · 超支 ' + Math.abs(remain) + '！');
        noteEl.style.color = remain >= 0 ? 'var(--green-l)' : 'var(--red-l)';
      } else {
        noteEl.textContent = '';
        noteEl.style.color = '';
      }
    }
    // 豁免区
    var savesEl = $id('cb2c-saves');
    if (savesEl) {
      savesEl.innerHTML = ABILITIES.map(function (a) {
        return '<label class="cb2-save"><input type="checkbox" data-save="' + a.key + '"' + (st.saves[a.key] ? ' checked' : '') + '>' + esc(a.name) + '豁免</label>';
      }).join('');
    }
    // 属性「来源加值」汇总条（背景等外部来源的总应用加值）
    var bonusEl = $id('cb2c-bonus');
    if (bonusEl) {
      var bgInfo = BACKGROUNDS[st.background];
      if (bgInfo && st.bgApplied) {
        var parts = st.bgApplied.mode === '21'
          ? [bgInfo.abilities[0] + ' +2', bgInfo.abilities[1] + ' +1']
          : bgInfo.abilities.map(function (n) { return n + ' +1'; });
        bonusEl.style.display = '';
        bonusEl.innerHTML = '<span class="cb2-bonus-ic">📜</span> 背景「' + esc(st.background) + '」来源加值：<b>' +
          parts.map(function (p) { return esc(p); }).join('、') +
          '</b><span class="cb2-bonus-tip">可在背景卡切换「三项各 +1」或撤销</span>';
      } else {
        bonusEl.style.display = 'none';
        bonusEl.innerHTML = '';
      }
    }
  }

  // ── 法术区渲染（精简化：先选环位 → 再以列表勾选该环位法术；chip 悬浮显示效果）──
  function renderSpellSection() {
    var body = $id('cb2c-spell-body');
    var count = $id('cb2c-spell-count');
    if (!body) return;
    var cls = st.cls;
    var isCaster = casterType(cls) != null;
    if (!isCaster) {
      body.innerHTML = '<div class="cb2-hint">「' + esc(cls) + '」为非施法职业：无职业法术表。仍可在详情页手动添加法术（如来自魔法物品）。</div>';
      if (count) count.textContent = '非施法职业';
      return;
    }
    if (!st.spellData || !st.spellData.spellLists) {
      body.innerHTML = '<div class="cb2-loading">⏳ 正在从规则书加载职业法术表…</div>';
      return;
    }
    var lists = st.spellData.spellLists[cls];
    if (!lists) {
      body.innerHTML = '<div class="cb2-hint">规则书中暂无「' + esc(cls) + '」的法术表（可手动添加）。</div>';
      return;
    }
    var cantripMax = (CANTRIP_BASE[cls] || 0) + Math.floor(st.level / 4);
    var castStat = CASTING_STAT[cls];
    var castMod = castStat ? abilityMod(st.scores[castStat]) : 0;
    var prepMax = Math.max(1, castMod + Math.max(1, st.level));

    // 该职业可用的环位（含已选环，即使该环表为空也保留已选法术的环）
    var availRings = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(function (lv) {
      var arr = lists[String(lv)] || lists[lv] || [];
      if (arr.length) return true;
      return st.spellList.some(function (s) { return Number(s.level) === lv; });
    });
    if (st.spellRing == null || availRings.indexOf(st.spellRing) < 0) st.spellRing = availRings.length ? availRings[0] : 0;
    var ringNames = { 0: '戏法', 1: '1环', 2: '2环', 3: '3环', 4: '4环', 5: '5环', 6: '6环', 7: '7环', 8: '8环', 9: '9环' };
    var ringTabs = '<div class="cb2-ringtabs">' + availRings.map(function (lv) {
      var cnt = st.spellList.filter(function (s) { return Number(s.level) === lv; }).length;
      var act = lv === st.spellRing ? ' active' : '';
      return '<button type="button" class="cb2-ringtab' + act + '" data-act="ring" data-ring="' + lv + '" title="点击切换到' + (lv === 0 ? '戏法' : lv + '环') + '列表">' +
        ringNames[lv] + '<span class="n">' + cnt + '</span></button>';
    }).join('') + '</div>';

    // 当前环位法术 chips（hover 显示效果摘要）
    var curRing = st.spellRing;
    var arr = lists[String(curRing)] || lists[curRing] || [];
    var chipHtml = '<div class="cb2-chiprow">' +
      (arr.length ? arr.map(function (sp) {
        var isOn = st.spellList.some(function (s) { return s.name === sp && Number(s.level) === curRing; });
        return '<span class="cb2-chip' + (isOn ? ' on' : '') + '" data-act="spell" data-name="' + esc(sp) + '" data-level="' + curRing + '" data-spell-desc="' + esc(sp) + '">' + esc(sp) + '</span>';
      }).join('') : '<span class="cb2-hint" style="color:var(--text-mute)">该环位暂无列表法术（可手动添加）</span>') +
      '</div>';

    // 已选法术汇总
    var selectedHtml = '<div class="cb2-selected-box"><div class="lb">已选法术（' + st.spellList.length + '）</div><div class="cb2-selected">' +
      (st.spellList.length ? st.spellList.map(function (s, i) {
        return '<span class="cb2-sel-chip">' + (Number(s.level) === 0 ? '戏法' : Number(s.level) + '环') + ' ' + esc(s.name) +
          '<button type="button" class="rm" data-act="spell-del" data-i="' + i + '">✕</button></span>';
      }).join('') : '<span style="color:var(--text-mute);font-size:11px">尚未选择任何法术</span>') + '</div></div>';

    // 上限提示
    var usedCount = st.spellList.length;
    var cantripCount = st.spellList.filter(function (s) { return Number(s.level) === 0; }).length;
    var nonCantrip = usedCount - cantripCount;
    var warn = (cantripCount > cantripMax || nonCantrip > prepMax) ? ' <span style="color:var(--red-l)">（超出推荐上限）</span>' : '';
    var limitHtml = '<div class="cb2-mini-label">戏法上限 ~' + cantripMax + '（' + esc(cls) + '基础' + (CANTRIP_BASE[cls] || 0) + '，每4级+1）· 已准备上限 ~' + prepMax + '（' +
      (castStat ? esc(castStat.toUpperCase()) : '') + '修正+' + Math.max(1, st.level) + '）。当前：戏法 ' + cantripCount + '，法术 ' + nonCantrip + warn + '</div>';

    var manualHtml = '<div class="cb2-row" style="margin-top:8px">' +
      '<input type="text" class="cb2-in" id="cb2c-spell-input" placeholder="自定义法术名（如：灼热射线）" style="flex:1">' +
      '<select class="cb2-in cb2-in-sm" id="cb2c-spell-level"><option value="0">戏法</option>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (r) { return '<option value="' + r + '">' + r + '环</option>'; }).join('') +
      '</select>' +
      '<button type="button" class="cb2-btn gold sm" data-act="spell-add">＋ 添加</button>' +
      '</div>';

    body.innerHTML = ringTabs + chipHtml + selectedHtml + limitHtml + manualHtml;
    if (count) count.textContent = '已选 ' + usedCount + ' 个' + warn;
  }

  // ── 装备区渲染（起始装备：2024 职业表「选 A/B/C」套装选项 + 类别浏览补充）──
  function applyStartingEquip(optLabel) {
    var eq = CLASS_STARTING_EQUIP[st.cls];
    if (!eq || !eq.options || !eq.options.length) {
      try { showToast('「' + st.cls + '」暂无起始装备预设，可手动添加', 'error'); } catch (e) {}
      return;
    }
    var opt = null;
    for (var i = 0; i < eq.options.length; i++) if (eq.options[i].label === optLabel) { opt = eq.options[i]; break; }
    if (!opt) {
      // 保留已有选择（若属于当前职业选项），否则默认第一个
      var keep = null;
      eq.options.forEach(function (o) { if (o.label === st.equipChoice) keep = o.label; });
      optLabel = keep || eq.options[0].label;
      eq.options.forEach(function (o) { if (o.label === optLabel) opt = o; });
    }
    st.equipChoice = opt.label;
    st.equipGold = opt.gold || 0;
    var optItems = replaceToolPlaceholder(opt.items || [], st.toolProfs);
    // 1) 移除上一次由选项按钮加入的物品（仅扣减数量，保留用户手动添加的）
    var rmMap = {};
    (st.equipAppliedItems || []).forEach(function (n) { rmMap[n] = (rmMap[n] || 0) + 1; });
    if (Object.keys(rmMap).length) {
      st.items = st.items.map(function (x) {
        if (rmMap[x.name]) {
          var d = Math.min(rmMap[x.name], x.quantity);
          rmMap[x.name] -= d;
          x.quantity -= d;
        }
        return x;
      }).filter(function (x) { return x.quantity > 0; });
    }
    // 2) 加入新选项物品
    var names = {};
    st.items.forEach(function (x) { names[x.name] = (names[x.name] || 0) + x.quantity; });
    var hasArmor = false;
    optItems.forEach(function (n) {
      if (!n) return;
      names[n] = (names[n] || 0) + 1;
      if (ARMOR_LIST.indexOf(n) >= 0) hasArmor = true;
    });
    var merged = [];
    Object.keys(names).forEach(function (n) {
      if (!n) return;
      var isArmor = ARMOR_LIST.indexOf(n) >= 0;
      merged.push({ name: n, category: isArmor ? '护甲' : '杂物', quantity: names[n], equipped: isArmor && n === st.armor });
    });
    st.items = merged;
    st.equipAppliedItems = optItems.slice();
    if (hasArmor && st.armor === '无甲') st.armor = optItems.filter(function (n) { return ARMOR_LIST.indexOf(n) >= 0; })[0];
    refreshSelection();
    updateDerived();
    var armorSel = $id('cb2c-armor');
    if (armorSel) armorSel.value = st.armor;
    try {
      showToast('已应用「' + st.cls + '」起始装备（选项 ' + opt.label + '：' +
        (optItems.length ? optItems.length + ' 件' : '') +
        (opt.gold ? (optItems.length ? ' + ' : '') + opt.gold + 'GP' : '') + '）', 'ok');
    } catch (e) {}
  }
  function renderEquipSection() {
    var body = $id('cb2c-equip-body');
    var count = $id('cb2c-item-count');
    if (!body) return;
    var startEq = CLASS_STARTING_EQUIP[st.cls];
    var profHint = CLASS_PROF_HINT[st.cls] || '';
    // 选项按钮组 A/B/C（数据来自规则书职业表「起始装备」行）
    var optHtml = '';
    if (startEq && startEq.options && startEq.options.length) {
      optHtml = '<div class="cb2-start-opt">' + startEq.options.map(function (o) {
        var items = replaceToolPlaceholder(o.items || [], st.toolProfs);
        var tip = '选项 ' + o.label + '：' + items.join('、') +
          (o.gold ? (items.length ? '、' : '') + o.gold + 'GP' : '');
        var on = st.equipChoice === o.label;
        return '<button type="button" class="cb2-btn sm' + (on ? ' gold' : '') + '" data-act="start-equip" data-opt="' + esc(o.label) + '" title="' + esc(tip) + '">' +
          esc(o.label) + (items.length ? '：' + items.length + ' 件' : '') + (o.gold ? ' + ' + o.gold + 'GP' : '') + '</button>';
      }).join('') + '</div>';
    }
    // 职业工具熟练选择（武僧等：选择1种工匠工具或乐器）
    var clsToolHtml = '';
    if (CLASS_TOOL_CHOICE[st.cls]) {
      var cats = CLASS_TOOL_CHOICE[st.cls];
      var curTool = '';
      (st.toolProfs || []).forEach(function (t) {
        cats.forEach(function (c) { if (TOOL_LISTS[c].indexOf(t) >= 0) curTool = t; });
      });
      var opts = '<option value="">— 选择 1 种工具/乐器 —</option>';
      cats.forEach(function (c) {
        opts += '<optgroup label="' + esc(c) + '">' + TOOL_LISTS[c].map(function (t) {
          return '<option value="' + esc(t) + '"' + (curTool === t ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</optgroup>';
      });
      clsToolHtml = '<div class="cb2-mini-label" style="margin-top:4px">职业工具熟练（' + esc(st.cls) + '）：' +
        '<select class="cb2-in" data-cls-tool style="max-width:190px">' + opts + '</select>' +
        ' <span style="color:var(--text-3)">选择后加入「工具熟练」并替换 A 套装占位项</span></div>';
    }
    var startRow = '<div class="cb2-start-row">' +
      '<div class="info">职业熟练：<b>' + esc(profHint || '（自定义职业，手动选择）') + '</b></div>' +
      (optHtml ? optHtml : '') +
      '</div>' + clsToolHtml;
    // 已选物品（含自动预填）
    var goldHtml = st.equipGold > 0 ? '<div class="cb2-mini-label" style="color:var(--gold-l)">💰 起始金币：<b>' + st.equipGold + ' GP</b>（选项 ' + esc(st.equipChoice || '') + '）</div>' : '';
    var selHtml = '<div class="cb2-selected-box"><div class="lb">当前装备（' + st.items.length + '）</div><div class="cb2-start-items">' +
      (st.items.length ? st.items.map(function (it, i) {
        var isArmor = ARMOR_LIST.indexOf(it.name) >= 0;
        var cls2 = 'cb2-start-item' + (isArmor ? ' armor' : '') + (it.equipped ? ' shield' : '');
        return '<span class="' + cls2 + '">' + esc(it.name) + (it.quantity > 1 ? ' ×' + it.quantity : '') +
          '<button type="button" class="rm" data-act="equip-del" data-i="' + i + '">✕</button></span>';
      }).join('') : '<span style="color:var(--text-mute);font-size:11px">暂无物品 — 点击上方起始装备选项（A/B/C）或从下方类别中选择</span>') +
      '</div>' + goldHtml + '</div>';
    // 类别浏览补充（来自规则装备表）
    var html = startRow + selHtml;
    if (st.equipData && st.equipData.equipment) {
      var eq = st.equipData.equipment;
      var keys = Object.keys(eq);
      var catHtml = '';
      keys.forEach(function (cat) {
        var arr = eq[cat];
        if (!Array.isArray(arr) || !arr.length) return;
        var selN = st.items.filter(function (it) { return it.category === cat; }).length;
        catHtml += '<div class="cb2-grp"><div class="cb2-grp-t">' + esc(cat) + ' <b>' + arr.length + '</b><span class="cnt">已选 ' + selN + '</span></div><div class="cb2-chiprow">' +
          arr.map(function (it) {
            var isOn = st.items.some(function (x) { return x.name === it; });
            var isArmor = cat === '轻甲' || cat === '中甲' || cat === '重甲';
            var cls2 = 'cb2-chip' + (isOn ? (isArmor ? ' armor-on' : ' on') : '');
            return '<span class="' + cls2 + '" data-act="item" data-name="' + esc(it) + '" data-cat="' + esc(cat) + '">' + esc(it) + (isArmor && st.armor === it ? ' ◈' : '') + '</span>';
          }).join('') + '</div></div>';
      });
      if (catHtml) {
        html += '<div class="cb2-grp-t" style="margin-top:6px">装备表补充（点击勾选）</div>' + catHtml;
      }
    }
    html += '<div class="cb2-row" style="margin-top:8px">' +
      '<input type="text" class="cb2-in" id="cb2c-item-input" placeholder="自定义物品（如：10尺长杆、火把）" style="flex:1">' +
      '<select class="cb2-in cb2-in-sm" id="cb2c-item-cat"><option>冒险装备</option><option>杂物</option><option>简易近战武器</option><option>简易远程武器</option></select>' +
      '<button type="button" class="cb2-btn gold sm" data-act="item-add">＋ 添加</button>' +
      '</div>' +
      '<div class="cb2-mini-label">护甲自动更新 AC 公式；「◈」标记表示已装备；起始装备按规则书职业表「选 A/B/C」提供。</div>';
    body.innerHTML = html;
    if (count) count.textContent = st.items.length + ' 件';
  }

  // 已选法术/装备变化 → 刷新两个区
  function refreshSelection() {
    renderSpellSection();
    renderEquipSection();
  }

  // ── 规则数据加载 ──
  function loadSpellData() {
    try {
      if (!ctx || typeof ctx.fetch !== 'function') { renderSpellSection(); return; }
      var url = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spell_lists.json';
      ctx.fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        st.spellData = j || null;
        renderSpellSection();
      }).catch(function () { renderSpellSection(); });
    } catch (e) { renderSpellSection(); }
  }
  function loadEquipData() {
    try {
      if (!ctx || typeof ctx.fetch !== 'function') { renderEquipSection(); return; }
      var url = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_equipment.json';
      ctx.fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        st.equipData = j || null;
        renderEquipSection();
      }).catch(function () { renderEquipSection(); });
    } catch (e) { renderEquipSection(); }
  }

  // ── 模式切换 ──
  function setMode(mode) {
    st.mode = mode;
    container.querySelectorAll('.cb2-mode-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    // 骰点模式：一次性掷出 5 组（切回时若未生成则生成；骰点不可重掷）
    if (mode === 'rolled' && (!st.rollSets || !st.rollSets.length)) {
      st.rollSets = rollScoreSets(5);
      st.rollPick = -1;
      st.rolledPool = [];
      st.pickedIdx = -1;
      ABILITIES.forEach(function (a) { st.scores[a.key] = null; });
    }
    // 渲染属性网格（骰点 → 分配槽；其他 → 输入框）
    renderAbilityGrid();
    updateDerived();
  }

  // ── 收集器（宿主保存时调用） ──
  function collect() {
    var nameEl = $id('cb2c-name');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      try { showToast('请先填写角色姓名', 'error'); } catch (e) {}
      return null;
    }
    currentScores();
    if (st.mode === 'rolled') {
      if (st.rollPick < 0) {
        try { showToast('请先在 5 组骰点中选择一组并完成属性分配', 'error'); } catch (e) {}
        return null;
      }
      saveCurrentRollSet();
      var missing = ABILITIES.filter(function (a) { return st.scores[a.key] == null; });
      if (missing.length) {
        try { showToast('骰点分配未完成：还有 ' + missing.length + ' 项属性未分配（' + missing.map(function (a) { return a.name; }).join('、') + '）', 'error'); } catch (e) {}
        return null;
      }
    }
    if (st.mode === 'pointbuy') {
      var cost = pointbuyCost(st.scores);
      if (cost > POINTBUY_POINTS) {
        try { showToast('购点超支：已用 ' + cost + '/27 点', 'error'); } catch (e) {}
        return null;
      }
    }
    var cls = st.cls === '自定义' ? (st.customClass || '自定义') : st.cls;
    var die = CLASS_HD[st.cls] || 'd8';
    var mods = {};
    ABILITIES.forEach(function (a) { mods[a.key] = abilityMod(st.scores[a.key]); });
    var level = Math.max(1, Math.min(20, Number(st.level) || 1));
    var prof = proficiencyBonus(level);
    var conMod = mods.con || 0;
    var face = parseInt(String(die).replace('d', ''), 10) || 8;
    var maxHp = face + avgHpPerLevel(die) * (level - 1) + conMod * level;
    var AC = armorAC(st.armor, mods.dex, st.shield);
    var speed = defaultSpeed(st.race);
    var init = mods.dex;
    var atk = Math.max(mods.str || 0, mods.dex || 0) + prof;
    var cs = CASTING_STAT[st.cls];
    var dc = cs != null ? 8 + prof + (mods[cs] || 0) : null;
    var atkSpell = cs != null ? prof + (mods[cs] || 0) : null;

    var skills = {};
    SKILLS.forEach(function (s) {
      skills[s.name] = { ability: s.ability, trained: st.trained[s.name] || '未熟练' };
    });

    // 编辑模式保留战斗/剧情状态（HP当前值、法术位消耗、状态、日志等）
    var curHp = maxHp;
    var tempHp = 0;
    if (editData && editData.HP) {
      tempHp = Number(editData.HP.temp) || 0;
      curHp = Math.min(Number(editData.HP.current) != null ? Number(editData.HP.current) : maxHp, maxHp);
    }

    var bgSel = $id('cb2c-bg');
    var bgName = bgSel ? bgSel.value.trim() : st.background;
    var isCustomBg = bgName === '自定义背景';
    if (isCustomBg) {
      var bgCus = $id('cb2c-bg-custom');
      bgName = bgCus ? bgCus.value.trim() : '';
      // 自定义背景：同步名称到配置
      if (st.customBg) st.customBg.name = bgName;
    }
    if (!bgName && st.background) bgName = st.background;

    var data = {
      name: name,
      ruleVersion: st.ruleVersion || '2024',
      race: st.race,
      class: cls,
      customClass: st.customClass,
      background: bgName,
      // 背景完整数据（2024 PHB：属性/专长/技能/工具/装备；详情页展示用）
      bgData: BACKGROUNDS[bgName] ? Object.assign({}, BACKGROUNDS[bgName]) : null,
      // 2024 角色起源：工具熟练、背景属性加值/装备选择、起源专长
      toolProfs: st.toolProfs.slice(),
      bgApplied: st.bgApplied ? { mode: st.bgApplied.mode, before: st.bgApplied.before } : null,
      bgEquip: st.bgEquip || '',
      bgGold: st.bgGold || 0,
      bgEquipData: st.bgEquipData ? { A: st.bgEquipData.A, B: st.bgEquipData.B } : null,
      equipChoice: st.equipChoice || '',
      equipGold: st.equipGold || 0,
      alignment: st.alignment,
      size: st.size,
      languages: $id('cb2c-lang') ? $id('cb2c-lang').value.trim() : st.languages,
      level: level,
      speed: speed,
      abilityScores: Object.assign({}, st.scores),
      abilityMods: mods,
      HP: { current: curHp, max: maxHp, temp: tempHp },
      proficiency: prof,
      AC: AC,
      initiative: init,
      attackBonus: atk,
      spellDC: dc,
      spellAttack: atkSpell,
      hitDice: die,
      hitDiceRemaining: editData && editData.hitDiceRemaining != null ? Math.min(level, Number(editData.hitDiceRemaining)) : level,
      armor: st.armor,
      shield: !!st.shield,
      currentLoad: editData && editData.currentLoad != null ? Number(editData.currentLoad) : 0,
      savingThrows: Object.assign({}, st.saves),
      skills: skills,
      skillSources: JSON.parse(JSON.stringify(st.skillSources || {})),
      toolSources: JSON.parse(JSON.stringify(st.toolSources || {})),
      customBg: st.customBg ? JSON.parse(JSON.stringify(st.customBg)) : null,
      spellSlots: spellSlotsFor(st.cls, level),
      spellSlotsUsed: editData && editData.spellSlotsUsed ? Object.assign({}, editData.spellSlotsUsed) : {},
      spellList: st.spellList.map(function (s) {
        return { name: s.name, level: Number(s.level) || 0, school: '', castingTime: '', range: '', components: '', duration: '', concentration: false, prepared: true, desc: '' };
      }),
      items: st.items.map(function (it) {
        return { name: it.name, category: it.category || '杂物', quantity: Number(it.quantity) || 1, price: '', equipped: !!it.equipped, effect: '' };
      }),
      features: st.features.slice(),
      bio: Object.assign({ appearance: '', personality: '', ideals: '', bonds: '', flaws: '' }, st.bio),
      deathSaves: editData && editData.deathSaves ? Object.assign({ success: 0, failure: 0 }, editData.deathSaves) : { success: 0, failure: 0 },
      inspiration: !!(editData && editData.inspiration),
      statuses: editData && Array.isArray(editData.statuses) ? editData.statuses.slice() : [],
      effects: editData && Array.isArray(editData.effects) ? editData.effects.slice() : [],
      rollLog: editData && Array.isArray(editData.rollLog) ? editData.rollLog.slice() : [],
      levelLog: editData && Array.isArray(editData.levelLog) ? editData.levelLog.slice() : []
    };
    return { name: name, displayName: name, color: CLASS_COLORS[st.cls] || '#4ecdc4', data: data };
  }

  // ── 事件委托 ──
  // 通用本地悬浮小窗（起源专长效果等；绝对定位不改变布局）
  function showTipAt(el, title, bodyHtml) {
    var old = document.getElementById('cb2-spell-tip');
    if (old) old.remove();
    var tip = document.createElement('div');
    tip.id = 'cb2-spell-tip';
    tip.className = 'cb2-spell-tip';
    tip.innerHTML = '<div class="cb2-spell-tip-n">✨ ' + esc(title) + '</div><div class="cb2-spell-tip-b">' + bodyHtml + '</div>';
    document.body.appendChild(tip);
    var rect = el.getBoundingClientRect();
    var left = Math.max(8, Math.min(window.innerWidth - 300, rect.left));
    var top = rect.bottom + 8;
    if (top + 180 > window.innerHeight) top = rect.top - 190;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  // 法术 chip 悬浮效果（创建页）
  container.addEventListener('mouseover', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    var el = t && t.getAttribute ? t : null;
    while (el && el !== container && !el.getAttribute('data-feat-desc') && !el.getAttribute('data-spell-desc')) el = el.parentNode;
    if (el && el !== container) {
      var fd = el.getAttribute('data-feat-desc');
      if (fd) {
        var desc = '';
        try { desc = decodeURIComponent(fd); } catch (e) { desc = fd; }
        showTipAt(el, String(el.textContent || '').replace(/ⓘ\s*$/, '').trim(), desc);
        return;
      }
      var sd = el.getAttribute('data-spell-desc');
      if (sd) showSpellTip(el, sd, ctx);
    }
  });
  container.addEventListener('mouseout', function () { hideSpellTip(); });
  container.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    // 属性生成模式切换（data-mode 按钮：骰点/购点/标准数组/手动）
    var m = t;
    while (m && m !== container && !m.getAttribute('data-mode')) m = m.parentNode;
    if (m && m !== container && m.getAttribute('data-mode')) {
      setMode(m.getAttribute('data-mode'));
      return;
    }
    var el = t;
    while (el && el !== container && !el.getAttribute('data-act')) el = el.parentNode;
    if (!el || el === container) return;
    var act = el.getAttribute('data-act');

    // ── 规则版本切换（2024 / 2014 玩家手册）──
    if (act === 'rule-ver') {
      var rv = el.getAttribute('data-v');
      if (rv === st.ruleVersion) return;
      // 切换前撤销当前背景来源（属性加值/专长/技能来源按旧版本）
      var oldBg = st.background;
      if (BACKGROUNDS[oldBg]) {
        if (st.bgApplied) applyBgAttr(null);
        applyBgProficiencies(null, null); // 清空旧背景来源
        if (st.ruleVersion === '2024') {
          // 移除 2024 起源专长
          var bf = BACKGROUNDS[oldBg];
          if (bf && bf.feat) {
            st.features = st.features.filter(function (f) { return f !== bf.feat; });
            var flEl2 = $id('cb2c-feat-list');
            if (flEl2) flEl2.outerHTML = featListHtml();
          }
        }
      }
      st.ruleVersion = rv;
      var tipEl = $id('cb2c-rulever-tip');
      if (tipEl) tipEl.textContent = rv === '2024' ? '背景提供 3 项属性提升与 1 个起源专长，自动应用' : '背景不提供属性提升与专长（2014 规则），技能无专精';
      container.querySelectorAll('.cb2-rulever-btn').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-v') === rv);
      });
      // 按新版本重新应用背景
      if (BACKGROUNDS[oldBg]) {
        if (rv === '2024') {
          applyBgProficiencies(oldBg, BACKGROUNDS[oldBg]);
          applyBgAttr('21');
          var bInfo = BACKGROUNDS[oldBg];
          if (bInfo && bInfo.feat && st.features.indexOf(bInfo.feat) < 0) {
            st.features.push(bInfo.feat);
            var flEl3 = $id('cb2c-feat-list');
            if (flEl3) flEl3.outerHTML = featListHtml();
          }
        } else {
          // 2014：仅技能/工具（来源驱动仍保留来源记录，便于切回）
          applyBgProficiencies(oldBg, BACKGROUNDS[oldBg]);
        }
      }
      renderBgCard();
      renderAbilityGrid();
      updateDerived();
      return;
    }

    // ── 创建方式：开卡流程 / 快速创建 ──
    if (act === 'flow-card') {
      var fw = el.getAttribute('data-flow');
      if (fw === st.flowType) return;
      st.flowType = fw;
      container.querySelectorAll('.cb2-flow-card').forEach(function (c) {
        c.classList.toggle('on', c.getAttribute('data-flow') === fw);
      });
      var stepsEl = $id('cb2c-flow-steps');
      if (stepsEl) stepsEl.style.display = fw === 'guide' ? 'flex' : 'none';
      // 快速创建默认走手动属性（跳过骰点强制流程）
      if (fw === 'quick' && st.mode === 'rolled') setMode('manual');
      // 分页显隐：guide 只显示当前步骤区块；quick 显示全部
      var curStep = 0;
      container.querySelectorAll('.cb2-flow-step').forEach(function (c) {
        if (c.classList.contains('cur')) curStep = Number(c.getAttribute('data-i')) || 0;
      });
      container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
        sec.style.display = (fw === 'quick' || Number(sec.getAttribute('data-step')) === curStep) ? (sec.getAttribute('data-orig-display') || '') : 'none';
      });
      return;
    }
    if (act === 'flow-step') {
      var si = Number(el.getAttribute('data-i')) || 0;
      container.querySelectorAll('.cb2-flow-step').forEach(function (c) {
        c.classList.toggle('cur', Number(c.getAttribute('data-i')) === si);
      });
      // 开卡流程：真正的分页——每步只显示对应区块
      if (st.flowType === 'guide') {
        st.flowStep = si;
        container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
          sec.style.display = (Number(sec.getAttribute('data-step')) === si) ? (sec.getAttribute('data-orig-display') || '') : 'none';
        });
        var prevBtn = $id('cb2c-flow-prev');
        var nextBtn = $id('cb2c-flow-next');
        if (prevBtn) prevBtn.style.visibility = si === 0 ? 'hidden' : 'visible';
        if (nextBtn) nextBtn.textContent = si >= STEPS.length - 1 ? '✓ 完成' : '下一步 →';
        var topEl = $id('cb2c-flow-steps');
        if (topEl) topEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (si === 0) { container.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      var keywords = ['基础信息', '属性', '技能熟练', '法术', '起始装备', '背景设定', '特性记录'];
      var heads = container.querySelectorAll('.cb2-sec-h');
      for (var hi = 0; hi < heads.length; hi++) {
        if (String(heads[hi].textContent || '').indexOf(keywords[si] || '') >= 0) {
          heads[hi].scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        }
      }
      return;
    }
    if (act === 'flow-prev') {
      var curP = 0;
      container.querySelectorAll('.cb2-flow-step').forEach(function (c) {
        if (c.classList.contains('cur')) curP = Number(c.getAttribute('data-i')) || 0;
      });
      var prv = (curP - 1 + STEPS.length) % STEPS.length;
      var tgtP = container.querySelector('.cb2-flow-step[data-i="' + prv + '"]');
      if (tgtP) tgtP.click();
      return;
    }
    if (act === 'flow-next') {
      var cur = 0;
      container.querySelectorAll('.cb2-flow-step').forEach(function (c) {
        if (c.classList.contains('cur')) cur = Number(c.getAttribute('data-i')) || 0;
      });
      // 开卡流程：分页模式，下一步到最后一页即完成（保存由宿主按钮触发）
      if (st.flowType === 'guide') {
        if (cur >= STEPS.length - 1) {
          try { showToast('所有步骤已完成，请点击页面底部的「保存角色」完成创建', 'ok'); } catch (e) {}
          return;
        }
        var nxt2 = cur + 1;
        var tgt2 = container.querySelector('.cb2-flow-step[data-i="' + nxt2 + '"]');
        if (tgt2) tgt2.click();
        return;
      }
      var nxt = (cur + 1) % 7;
      var tgt = container.querySelector('.cb2-flow-step[data-i="' + nxt + '"]');
      if (tgt) tgt.click();
      return;
    }
    // 环位切换（法术精简化：先选环位）
    if (act === 'ring') {
      st.spellRing = Number(el.getAttribute('data-ring')) || 0;
      renderSpellSection();
      return;
    }
    if (act === 'spell-del') {
      var sdi = Number(el.getAttribute('data-i'));
      if (st.spellList[sdi]) {
        st.spellList.splice(sdi, 1);
        refreshSelection();
      }
      return;
    }
    // 起始装备：一键应用 / 删除
    if (act === 'start-equip') {
      var optBtn = e.target.closest ? e.target.closest('[data-opt]') : null;
      applyStartingEquip(optBtn ? optBtn.getAttribute('data-opt') : undefined);
      return;
    }
    if (act === 'equip-del') {
      var edi = Number(el.getAttribute('data-i'));
      if (st.items[edi]) {
        var rm = st.items[edi];
        st.items.splice(edi, 1);
        if (ARMOR_LIST.indexOf(rm.name) >= 0 && st.armor === rm.name) {
          var others = st.items.filter(function (x) { return ARMOR_LIST.indexOf(x.name) >= 0; });
          st.armor = others.length ? others[0].name : '无甲';
          var armorSel = $id('cb2c-armor');
          if (armorSel) armorSel.value = st.armor;
        }
        refreshSelection();
        updateDerived();
      }
      return;
    }

    if (act === 'roll-pick-set') {
      // 层级1 → 层级2：进入某组开始分配
      enterRollSet(Number(el.getAttribute('data-i')));
      return;
    }
    if (act === 'roll-back') {
      // 层级2 → 层级1：保存当前组分配状态，返回重选
      saveCurrentRollSet();
      st.rollPick = -1;
      st.pickedIdx = -1;
      renderAbilityGrid();
      updateDerived();
      return;
    }
    if (act === 'pick-pool') {
      var pi = Number(el.getAttribute('data-i'));
      st.pickedIdx = (st.pickedIdx === pi) ? -1 : pi; // 再点一次取消选中
      updateDerived();
      return;
    }
    if (act === 'assign-ab') {
      var abKey = el.getAttribute('data-ab');
      if (st.scores[abKey] != null) {
        // 已分配 → 回收该值回骰池
        st.rolledPool.push(st.scores[abKey]);
        st.scores[abKey] = null;
        st.rolledPool.sort(function (a, b) { return a - b; });
      } else if (st.pickedIdx >= 0 && st.rolledPool[st.pickedIdx] != null) {
        // 未分配 + 已选中骰值 → 分配
        st.scores[abKey] = st.rolledPool[st.pickedIdx];
        st.rolledPool.splice(st.pickedIdx, 1);
        st.pickedIdx = -1;
      } else {
        try { showToast('请先在骰池中点击选择一个骰值，再点属性槽分配', 'error'); } catch (e) {}
        return;
      }
      saveCurrentRollSet(); // 同步当前组分配状态，返回重选时可恢复
      renderAbilityGrid();
      updateDerived();
      return;
    }
    if (act === 'shuffle-array') {
      var arr = STD_ARRAY.slice();
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      ABILITIES.forEach(function (a, idx) {
        st.scores[a.key] = arr[idx];
        var iEl = $id('cb2c-ab-' + a.key);
        if (iEl) iEl.value = arr[idx];
      });
      updateDerived();
      return;
    }
    if (act === 'spell') {
      var nm = el.getAttribute('data-name');
      var lv = Number(el.getAttribute('data-level')) || 0;
      var found = -1;
      st.spellList.forEach(function (s, idx) { if (s.name === nm && Number(s.level) === lv) found = idx; });
      if (found >= 0) st.spellList.splice(found, 1);
      else st.spellList.push({ name: nm, level: lv });
      refreshSelection();
      return;
    }
    if (act === 'spell-add') {
      var inEl = $id('cb2c-spell-input');
      var lvEl = $id('cb2c-spell-level');
      var v = inEl ? inEl.value.trim() : '';
      if (!v) return;
      var lv2 = Number(lvEl ? lvEl.value : 0) || 0;
      if (!st.spellList.some(function (s) { return s.name === v && Number(s.level) === lv2; })) {
        st.spellList.push({ name: v, level: lv2 });
      }
      if (inEl) inEl.value = '';
      refreshSelection();
      return;
    }
    if (act === 'item') {
      var itN = el.getAttribute('data-name');
      var itC = el.getAttribute('data-cat') || '杂物';
      var fi = -1;
      st.items.forEach(function (x, idx) { if (x.name === itN) fi = idx; });
      var isArmorCat = itC === '轻甲' || itC === '中甲' || itC === '重甲';
      if (fi >= 0) {
        st.items.splice(fi, 1);
        // 若卸下的是当前护甲，回退到无甲（保留其他已装备护甲优先）
        if (isArmorCat && st.armor === itN) {
          var others = st.items.filter(function (x) { return (x.category === '轻甲' || x.category === '中甲' || x.category === '重甲'); });
          st.armor = others.length ? others[0].name : '无甲';
        }
      } else {
        st.items.push({ name: itN, category: itC, quantity: 1, equipped: isArmorCat });
        if (isArmorCat && (st.armor === '无甲' || !st.items.some(function (x) { return x.category !== itC && (x.category === '轻甲' || x.category === '中甲' || x.category === '重甲') && x.equipped; }))) {
          st.armor = itN;
        }
      }
      var armorSel = $id('cb2c-armor');
      if (armorSel) armorSel.value = st.armor;
      refreshSelection();
      updateDerived();
      return;
    }
    if (act === 'item-add') {
      var iIn = $id('cb2c-item-input');
      var iCat = $id('cb2c-item-cat');
      var v2 = iIn ? iIn.value.trim() : '';
      if (!v2) return;
      var cat2 = iCat ? iCat.value : '杂物';
      st.items.push({ name: v2, category: cat2, quantity: 1, equipped: false });
      if (iIn) iIn.value = '';
      refreshSelection();
      return;
    }
    if (act === 'bg-apply-attr') { applyBgAttr('21'); return; }
    if (act === 'bg-attr-111') { applyBgAttr('111'); return; }
    if (act === 'bg-attr-undo') { applyBgAttr(null); return; }
    if (act === 'bg-equip-a') { applyBgEquip('A'); return; }
    if (act === 'bg-equip-b') { applyBgEquip('B'); return; }
    if (act === 'bg-apply-skills') {
      applyBgSkills();
      try { showToast('已勾选背景技能熟练：' + BACKGROUNDS[st.background].skills.join('、'), 'ok'); } catch (e) {}
      return;
    }
    // ── 自定义背景交互 ──
    if (act === 'cbg-skill') {
      var cbg = st.customBg || (st.customBg = { name: '', skills: [], tool: '', toolCat: '', equip: 'A', equipGold: 0, attr: '21' });
      var skN = el.getAttribute('data-name');
      var idx = cbg.skills.indexOf(skN);
      if (idx >= 0) cbg.skills.splice(idx, 1);
      else {
        if (cbg.skills.length >= 2) { try { showToast('自定义背景最多选 2 项技能熟练', 'error'); } catch (e) {} return; }
        cbg.skills.push(skN);
      }
      renderBgCard();
      return;
    }
    if (act === 'cbg-equip-a') { st.customBg = st.customBg || {}; st.customBg.equip = 'A'; renderBgCard(); return; }
    if (act === 'cbg-equip-b') { st.customBg = st.customBg || {}; st.customBg.equip = 'B'; renderBgCard(); return; }
    if (act === 'cbg-attr-21') { st.customBg = st.customBg || {}; st.customBg.attr = '21'; renderBgCard(); return; }
    if (act === 'cbg-attr-111') { st.customBg = st.customBg || {}; st.customBg.attr = '111'; renderBgCard(); return; }
    if (act === 'cbg-toolcat') {
      st.customBg = st.customBg || {};
      st.customBg.toolCat = el.value;
      st.customBg.tool = '';
      renderBgCard();
      return;
    }
    if (act === 'cbg-tool') { st.customBg = st.customBg || {}; st.customBg.tool = el.value; return; }
    if (act === 'cbg-items') { st.customBg = st.customBg || {}; st.customBg.items = el.value.split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean); return; }
    if (act === 'cbg-gold') { st.customBg = st.customBg || {}; st.customBg.gold = Number(el.value) || 0; return; }
    if (act === 'feat-add') {
      var fIn = $id('cb2c-feat-input');
      var fv = fIn ? fIn.value.trim() : '';
      if (fv && st.features.indexOf(fv) < 0) {
        st.features.push(fv);
        if (fIn) fIn.value = '';
        var fl = $id('cb2c-feat-list');
        if (fl) {
          fl.innerHTML = st.features.map(function (f, i) {
            return '<div class="cb2-sel-chip">' + esc(f) + '<button type="button" class="rm" data-act="feat-del" data-i="' + i + '">✕</button></div>';
          }).join('');
        }
      }
      return;
    }
    if (act === 'feat-del') {
      var di = Number(el.getAttribute('data-i'));
      if (st.features[di]) {
        st.features.splice(di, 1);
        var fl2 = $id('cb2c-feat-list');
        if (fl2) {
          fl2.innerHTML = st.features.length ? st.features.map(function (f, i) {
            return '<div class="cb2-sel-chip">' + esc(f) + '<button type="button" class="rm" data-act="feat-del" data-i="' + i + '">✕</button></div>';
          }).join('') : '<div class="cb2-hint">暂无 — 创建后可在详情页「升级」时记录职业能力</div>';
        }
      }
      return;
    }
  });

  container.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    var id = t.id;
    if (id === 'cb2c-name') { st.name = t.value; return; }
    if (id === 'cb2c-race') {
      st.race = t.value;
      // 种族联动（2024 PHB）：体型随种族、语言仅在未填写时自动填入
      var sz = RACE_SIZE[st.race];
      if (sz) {
        st.size = sz;
        var sizeEl = $id('cb2c-size');
        if (sizeEl) sizeEl.value = sz;
      }
      var langEl = $id('cb2c-lang');
      var lg = RACE_LANGS[st.race];
      if (lg && langEl && !langEl.value.trim()) {
        st.languages = lg;
        langEl.value = lg;
      }
      updateDerived();
      return;
    }
    if (id === 'cb2c-bg') {
      var newBg = t.value;
      // 来源驱动：先撤旧背景来源（属性/技能/工具），再按规则版本自动应用新背景
      if (BACKGROUNDS[newBg]) {
        if (st.bgApplied) applyBgAttr(null);
        applyBgProficiencies(newBg, BACKGROUNDS[newBg]);
        if (st.ruleVersion === '2024') {
          applyBgAttr('21');
          var bInfo = BACKGROUNDS[newBg];
          if (bInfo && bInfo.feat && st.features.indexOf(bInfo.feat) < 0) {
            st.features.push(bInfo.feat);
            var flEl = $id('cb2c-feat-list');
            if (flEl) flEl.outerHTML = featListHtml();
          }
        }
        // 工具熟练：可选类背景保留（由用户下拉选择），固定工具已由 applyBgProficiencies 添加
      } else {
        st.background = newBg;
      }
      // 切换背景：重置背景装备选择缓存
      st.bgEquipData = null;
      st.bgEquip = '';
      st.bgGold = 0;
      st.bgAppliedItems = [];
      renderBgCard();
      updateDerived();
      return;
    }
    if (id === 'cb2c-bg-custom') {
      // 自定义背景名只更新配置，不覆盖 st.background（保持 '自定义背景' 标识）
      st.customBg = st.customBg || {};
      st.customBg.name = t.value;
      return;
    }
    if (id === 'cb2c-cls') {
      // 职业熟练/豁免/起始装备自动联动（来源驱动：切换职业自动更新技能/工具来源）
      if (st.cls !== t.value && st.cls) {
        // 记录当前职业下已应用的起始装备与技能来源，交给 applyClassProficiencies 处理
      }
      applyClassProficiencies(t.value);
      st.cls = t.value;
      var wrap = $id('cb2c-custom-cls-wrap');
      if (wrap) wrap.style.display = st.cls === '自定义' ? '' : 'none';
      if (st.cls !== '自定义') {
        if (!st.items.length) applyStartingEquip();
      }
      // 职业 1 级特性自动预填（去重合并，保留用户已添加内容）
      (CLASS_LV1_FEATURES[st.cls] || []).forEach(function (f) {
        if (st.features.indexOf(f) < 0) st.features.push(f);
      });
      var flEl = $id('cb2c-feat-list');
      if (flEl) flEl.outerHTML = featListHtml();
      updateDerived();
      renderSpellSection();
      renderEquipSection();
      return;
    }
    if (id === 'cb2c-custom-cls') { st.customClass = t.value; return; }
    if (id === 'cb2c-level') {
      st.level = Math.max(1, Math.min(20, Number(t.value) || 1));
      t.value = st.level;
      updateDerived();
      if (casterType(st.cls) != null) renderSpellSection();
      return;
    }
    if (id === 'cb2c-align') { st.alignment = t.value; return; }
    if (id === 'cb2c-size') { st.size = t.value; return; }
    if (id === 'cb2c-lang') { st.languages = t.value; return; }
    if (id === 'cb2c-armor') { st.armor = t.value; updateDerived(); renderEquipSection(); return; }
    if (id === 'cb2c-shield') { st.shield = t.checked; updateDerived(); return; }
    if (id.indexOf('cb2c-ab-') === 0) {
      currentScores();
      updateDerived();
      return;
    }
  });

  // checkbox（豁免）与 select（技能）走全局监听
  container.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    var save = t.getAttribute && t.getAttribute('data-save');
    if (save) { st.saves[save] = t.checked; return; }
    var sk = t.getAttribute && t.getAttribute('data-sk-sel');
    if (sk) {
      // 用户手动改技能：改为未熟练时清除所有来源；改熟练/专精时保留来源并提升
      if (t.value === '未熟练') {
        if (st.skillSources && st.skillSources[sk]) {
          st.skillSources[sk].slice().forEach(function (src) { removeSkillSource(sk, src); });
        }
        st.trained[sk] = '未熟练';
      } else {
        st.trained[sk] = t.value;
        // 手动选择也视为来源（标记用户主动操作，避免被来源移除逻辑误删）
        if (!st.skillSources || !st.skillSources[sk] || !st.skillSources[sk].length) {
          st.skillSources = st.skillSources || {};
          st.skillSources[sk] = ['自定义'];
        }
      }
      updateDerived();
      return;
    }
    var tl = t.getAttribute && t.getAttribute('data-tool-sel');
    if (tl) {
      st.toolProfs = st.toolProfs || [];
      st.toolSources = st.toolSources || {};
      // 替换该类别下的旧值（职业/背景等来源可各选一种，互不覆盖）
      var catArr = TOOL_LISTS[tl] || [];
      // 移除旧选择（含来源记录）
      st.toolProfs.slice().forEach(function (x) {
        if (catArr.indexOf(x) >= 0) {
          var srcs = st.toolSources[x] || [];
          srcs.slice().forEach(function (src) { removeToolSource(x, src); });
          if (!srcs.length) removeToolSource(x, '自定义');
        }
      });
      if (t.value) {
        st.toolProfs.push(t.value);
        // 背景可选工具：记入背景来源
        var bgInfo2 = BACKGROUNDS[st.background];
        if (bgInfo2 && bgToolCategory(bgInfo2.tool) === tl) {
          st.toolSources[t.value] = ['背景·' + st.background];
        } else {
          st.toolSources[t.value] = ['自定义'];
        }
      }
      return;
    }
    var ct = t.getAttribute && t.getAttribute('data-cls-tool');
    if (ct) {
      // 职业工具熟练（武僧：工匠工具/乐器任选其一）
      st.toolProfs = st.toolProfs || [];
      st.toolSources = st.toolSources || {};
      var cats = CLASS_TOOL_CHOICE[st.cls] || [];
      var remove = [];
      cats.forEach(function (c) { TOOL_LISTS[c].forEach(function (x) { remove.push(x); }); });
      // 移除旧职业工具（保留其他来源）
      st.toolProfs.slice().forEach(function (x) {
        if (remove.indexOf(x) >= 0) {
          var srcs = st.toolSources[x] || [];
          srcs.slice().forEach(function (src) {
            if (src === '职业·' + st.cls) removeToolSource(x, src);
          });
        }
      });
      if (t.value) {
        st.toolProfs.push(t.value);
        st.toolSources[t.value] = st.toolSources[t.value] || [];
        if (st.toolSources[t.value].indexOf('职业·' + st.cls) < 0) st.toolSources[t.value].push('职业·' + st.cls);
      }
      // 若已应用职业起始装备，用新工具替换套装占位符
      if (st.equipAppliedItems && st.equipAppliedItems.some(function (n) { return /所选的工匠工具或乐器/.test(String(n)); })) {
        applyStartingEquip(st.equipChoice);
      } else {
        renderEquipSection();
        updateDerived();
      }
      return;
    }
  });

  // ── 初始渲染 ──
  // 新建：应用默认职业（法师）的熟练来源；编辑：保留已保存来源
  if (!editData) {
    applyClassProficiencies(st.cls);
    if (st.background && BACKGROUNDS[st.background]) applyBgProficiencies(st.background, BACKGROUNDS[st.background]);
  }
  renderBgCard();
  setMode(st.mode);
  // 开卡流程：分页显隐（默认第 1 步：基础信息）；快速创建显示全部区块
  if (!editData && st.flowType === 'guide') {
    container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
      sec.style.display = (Number(sec.getAttribute('data-step')) === 0) ? (sec.getAttribute('data-orig-display') || '') : 'none';
    });
    var prevBtn0 = $id('cb2c-flow-prev');
    if (prevBtn0) prevBtn0.style.visibility = 'hidden';
    var nextBtn0 = $id('cb2c-flow-next');
    if (nextBtn0) nextBtn0.textContent = '下一步 →';
  } else {
    container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
      sec.style.display = sec.getAttribute('data-orig-display') || '';
    });
  }
  // 开卡流程：新建时自动应用当前职业起始装备（职业切换时也会联动）
  if (!editData && st.flowType === 'guide' && CLASS_STARTING_EQUIP[st.cls] && !st.items.length) applyStartingEquip();
  loadSpellData();
  loadEquipData();

  // 提供给宿主的收集器
  done(collect);
}

// ════════════════════════════════════════════════════════════════
// 插件注册（兼容 plugins.js 与 character-create.html 两种加载方式）
// ════════════════════════════════════════════════════════════════
function register(api) {
  if (api && typeof api.registerCharacterSheet === 'function') {
    api.registerCharacterSheet({ renderCreate: renderCreate, renderDetail: renderDetail });
  }
}
var module = module || { exports: {} };
module.exports = { register: register };

/*__NEXT__*/



