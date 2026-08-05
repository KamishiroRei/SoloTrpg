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
var ABILITIES_MAP = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };

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
// 护甲 → 类别（轻甲/中甲/重甲）
function armorCat(name) {
  if (['布甲', '皮甲', '镶钉皮甲'].indexOf(name) >= 0) return '轻甲';
  if (['兽皮甲', '链甲衫', '鳞甲', '胸甲', '半身板甲'].indexOf(name) >= 0) return '中甲';
  if (['环甲', '链甲', '板条甲', '板甲'].indexOf(name) >= 0) return '重甲';
  return null;
}
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
      // Token 是宿主与规则模块共享的存档对象。保存时保留未知顶层字段，
      // 这样分类、归属、条件以及其他规则模块扩展不会被角色卡内的快捷操作抹掉。
      var saved = Object.assign({}, t);
      saved.conditions = Array.isArray(t.conditions) ? t.conditions.slice() : [];
      saved.data = t.data || null;
      return saved;
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
// 2026-08-05：解析并掷出伤害表达式（"2d6+3" / "1d8"），返回总和
function rollDiceSum(expr) {
  var s = String(expr || '');
  var sum = 0;
  s.replace(/(\d+)d(\d+)/gi, function (m, cnt, face) {
    var c = Math.max(1, Number(cnt) || 1);
    for (var i = 0; i < c; i++) sum += rollDie(Number(face) || 6);
    return m;
  });
  var flat = s.replace(/(\d+)d(\d+)/gi, '');
  flat.replace(/([+-]?\d+(?:\.\d+)?)/g, function (m2) { sum += Number(m2); return m2; });
  return sum;
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
  // 副职解锁：达到副职等级提示选择（编辑页「职业」步骤可选）
  var sc = SUBCLASSES[cls];
  if (sc && newLevel >= sc.level && oldLevel < sc.level) {
    feats.push({ type: 'subclass', text: '副职解锁：达到 ' + newLevel + ' 级，请在编辑页「职业」步骤选择副职（' + Object.keys(sc.list).join(' / ') + '）' });
  }
  // 本等级自动加入的职业特性（全等级表联动）
  var lvFeats = classFeaturesAt(cls, newLevel);
  if (lvFeats.length) {
    feats.push({ type: 'auto-feat', text: '已自动加入职业特性：' + lvFeats.join('、') + '（写入角色卡「特性」列表）' });
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
  // 自动加入新等级职业特性（全等级表联动；含已选副职对应等级特性）
  var feats = Array.isArray(data.features) ? data.features.slice() : [];
  var clsName = data.class || '';
  var newFeatNames = classFeaturesAt(clsName, newLevel);
  var subSel = data.subclass || '';
  if (subSel && SUBCLASSES[clsName] && SUBCLASSES[clsName].list[subSel]) {
    var subF = SUBCLASSES[clsName].list[subSel].feats || {};
    Object.keys(subF).forEach(function (fl) {
      if (Number(fl) <= newLevel) subF[fl].forEach(function (nm) { newFeatNames.push(subclassFeatName(subSel, nm)); });
    });
  }
  newFeatNames.forEach(function (nm) { if (nm && feats.indexOf(nm) < 0) feats.push(nm); });
  if (f && feats.indexOf(f) < 0) feats.push(f);
  nd.features = feats;
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
  '.cb2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;align-items:start}' +
  '.cb2{width:100%;box-sizing:border-box}' +
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
  // 2026-08-06：属性直接可改（input）+ 详情页属性框放大
  '.cb2-ability .cb2-ab-input{width:74px;margin:3px auto;display:block;text-align:center;font-family:"Cinzel",serif;font-size:20px;font-weight:700;color:var(--text);background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;padding:3px 2px;outline:none;cursor:text}' +
  '.cb2-ability .cb2-ab-input:hover,.cb2-ability .cb2-ab-input:focus{border-color:var(--gold-d);color:var(--gold-l)}' +
  '.cb2-abilities.cb2-ab-big{grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px}' +
  '.cb2-abilities.cb2-ab-big .cb2-ability{padding:12px 8px}' +
  '.cb2-skill-groups-detail{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}' +
  '.cb2-skill-grp{border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--bg-panel)}' +
  '.cb2-skill-grp-t{font-size:11px;color:var(--text-2);margin-bottom:6px}' +
  '.cb2-skill-grp .cb2-skills{grid-template-columns:1fr}' +
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
  '.cb2-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}' +
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
  '.cb2-spells{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:6px}' +
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
  '.cb2-feat .cb2-feat-desc{font-size:11px;color:var(--text-2);line-height:1.65;margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);white-space:pre-wrap}' +
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
  'textarea.cb2-in,textarea.cb2-ta{resize:vertical;min-height:44px;line-height:1.6;white-space:pre-wrap;overflow-wrap:break-word}' +
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

// 渲染属性标签页（2026-08-06 重构：属性=可直接修改的数字；技能移入「技能」页；状态移入「状态」页）
function renderAttributesTab(data, derived, token) {
  var scores = data.abilityScores || {};
  var saveSrcs = data.saveSources || {}; // 豁免来源（职业·X / 自定义）
  // 2026-08-06：属性是可直接修改的数字（无投点/手动区分）；修改后实时重算派生值
  var abBlocks = ABILITIES.map(function (a) {
    var sc = scores[a.key] != null ? scores[a.key] : 10;
    var mod = derived.abilityMods[a.key] || 0;
    var sv = derived.saves[a.key] || { trained: false, bonus: 0 };
    var srcs = saveSrcs[a.key] || [];
    var srcTip = sv.trained && srcs.length ? '（来源：' + srcs.join('、') + '）' : (sv.trained ? '（手动勾选）' : '');
    return '<div class="cb2-ability" title="属性值可直接修改（回车/失焦生效，派生值自动重算）">' +
      '<span class="cb2-ab-name" data-term="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
      '<span class="cb2-ab-short">' + a.short + '</span>' +
      '<input type="number" class="cb2-ab-input" data-ab-input="' + a.key + '" min="1" max="30" value="' + sc + '" title="直接修改属性值">' +
      '<div class="cb2-ab-mod' + (mod < 0 ? ' neg' : '') + '">' + signed(mod) + '</div>' +
      '<div class="cb2-ab-save' + (sv.trained ? ' prof' : '') + '" data-act="roll-save" data-ab="' + a.key + '" title="点击掷豁免' + esc(srcTip) + '">豁免 <b>' + signed(sv.bonus) + '</b></div>' +
      '</div>';
  }).join('');
  return '' +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">属性 <span class="cb2-sec-note">数字可直接修改，派生值实时联动；点豁免掷骰</span></h4><div class="cb2-abilities cb2-ab-big">' + abBlocks + '</div></div>' +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">豁免与战斗派生 <span class="cb2-sec-note">熟练/AC/DC/先攻/攻击/负重自动计算</span></h4>' +
    '<div class="cb2-hint">熟练加值 <b style="color:var(--gold-l)">' + signed(derived.proficiency) + '</b> · AC <b style="color:var(--gold-l)">' + (derived.AC != null ? derived.AC : (data.AC != null ? data.AC : '—')) + '</b> · 先攻 <b style="color:var(--gold-l)">' + signed(derived.initiative) + '</b> · 攻击 <b style="color:var(--gold-l)">' + signed(derived.attackBonus) + '</b>' +
    (derived.spellDC != null ? ' · 法术DC <b style="color:var(--gold-l)">' + derived.spellDC + '</b>' : '') + '</div>' +
    '<div class="cb2-hint" style="margin-top:6px">负重 <b style="color:var(--gold-l)">' + (data.currentLoad || 0) + '</b> / ' + derived.carryCapacity + ' 磅 · 状态：<b style="color:var(--gold-l)">' + derived.carryStatus + '</b>' +
    (derived.carrySpeedPenalty > 0 ? '（速度-' + derived.carrySpeedPenalty + '尺）' : '') + '</div>' +
    '<div class="cb2-hint" style="margin-top:6px">生命骰 <b style="color:var(--text)">' + esc(data.hitDice || '-') + '</b> × ' +
    '<span data-act="hd-edit" style="cursor:pointer;color:var(--gold-l)" title="点击调整剩余生命骰">' + (data.hitDiceRemaining != null ? data.hitDiceRemaining : data.level || 1) + '/' + (data.level || 1) + '</span>' +
    '</div></div>';
}

function renderStatusChips(data) {
  var statuses = normalizeStatuses(data);
  if (!statuses.length) return '<div class="cb2-empty">无状态效果 — 战斗中点击此处可添加「中毒/倒地/束缚」等状态</div>';
  return statuses.map(function (s, i) {
    if (window.TrpgTag && window.TrpgTag.chip) {
      return window.TrpgTag.chip({
        name: s.name, type: 'status',
        extra: s.remaining || '', source: s.source || '',
        desc: s.desc || s.name,
        title: (s.name + (s.remaining ? '（' + s.remaining + '）' : '') + (s.source ? ' · 来源' + s.source : '') + ' · 点击移除'),
        dataAct: 'status-del', dataI: i, removable: true
      });
    }
    return '<span class="cb2-status-chip" data-act="status-del" data-i="' + i + '" title="点击移除">' +
      esc(s.name) + (s.remaining ? ' <span class="cb2-st-src">' + esc(s.remaining) + '</span>' : '') +
      (s.source ? ' <span class="cb2-st-src">' + esc(s.source) + '</span>' : '') +
      ' <span class="cb2-st-x">✕</span></span>';
  }).join('');
}

// ── 2026-08-06：统一 TABS 新增页（与创建流程分页一一对应）──

// 种族页：种族+亚种+种族特性（标签化）
function renderRaceTab(data, derived) {
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">🧝 种族 <span class="cb2-sec-note">种族特性自动生效</span></h4>';
  html += '<div class="cb2-hint">种族 <b style="color:var(--gold-l)">' + esc(data.race || '—') + '</b>' +
    (data.subrace ? ' · 亚种 <b style="color:var(--gold-l)">' + esc(data.subrace) + '</b>' : '') +
    (data.size ? ' · 体型 ' + esc(data.size) : '') +
    (data.speed != null ? ' · 速度 ' + esc(data.speed) + ' 尺' : '') + '</div>';
  var traits = (data.raceFeatures && data.raceFeatures.traits) || [];
  if (traits.length) {
    html += '<div class="cb2-feat-chiprow" style="margin-top:8px">' + traits.map(function (t, i) {
      var desc = (data.raceFeatures.details && data.raceFeatures.details[t]) || '';
      if (window.TrpgTag && window.TrpgTag.chip) {
        return window.TrpgTag.chip({ name: t, type: 'race', source: '种族·' + (data.race || ''), desc: desc || t, title: desc ? t + '：' + desc : t });
      }
      return '<span class="cb2-feat-chip" title="' + esc(desc || t) + '">' + esc(t) + '<span class="src auto">种族</span></span>';
    }).join('') + '</div>';
  } else {
    html += '<div class="cb2-empty">无种族特性记录（可在「特性」页查看）</div>';
  }
  html += '</div>';
  return html;
}

// 职业页：职业+副职+等级+职业特性（来源标记，悬浮看描述）
function renderClassTab(data, derived) {
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">⚔️ 职业 <span class="cb2-sec-note">等级与特性一览</span></h4>';
  html += '<div class="cb2-hint">职业 <b style="color:var(--gold-l)">' + esc(data.class || '—') + '</b>' +
    (data.subclass ? ' · 副职 <b style="color:var(--gold-l)">' + esc(data.subclass) + '</b>' : '') +
    ' · 等级 <b style="color:var(--gold-l)">Lv' + (data.level || 1) + '</b>' +
    ' · 熟练加值 <b style="color:var(--gold-l)">' + signed(derived.proficiency) + '</b>' +
    (data.hitDice ? ' · 生命骰 ' + esc(data.hitDice) : '') + '</div>';
  var feats = Array.isArray(data.features) ? data.features : [];
  var clsFeats = feats.filter(function (f) { return featDetailSrc(f, data).auto && featDetailSrc(f, data).tag.indexOf('种族') !== 0 && featDetailSrc(f, data).tag.indexOf('背景') !== 0; });
  if (clsFeats.length) {
    html += '<div class="cb2-feat-chiprow" style="margin-top:8px">' + clsFeats.map(function (f) {
      var dsc = lookupFeatDesc(f, data.class);
      var src = featDetailSrc(f, data);
      var type = src.tag.indexOf('副职') === 0 ? 'subclass' : 'cls';
      if (window.TrpgTag && window.TrpgTag.chip) {
        return window.TrpgTag.chip({ name: f, type: type, source: src.tag, desc: dsc || f, title: dsc ? f + '：' + dsc : f });
      }
      return '<span class="cb2-feat-chip" title="' + esc(dsc || f) + '">' + esc(f) + '<span class="src auto">' + esc(src.tag) + '</span></span>';
    }).join('') + '</div>';
  } else {
    html += '<div class="cb2-empty">无职业特性记录（升级/编辑时自动写入；可在「特性」页查看全部）</div>';
  }
  html += '</div>';
  return html;
}

// 背景页：背景+属性提升方案+起源专长+技能/工具来源+装备选择
function renderBackgroundTab(data, derived) {
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">📜 背景 <span class="cb2-sec-note">来源加值与选择记录</span></h4>';
  html += '<div class="cb2-hint">背景 <b style="color:var(--gold-l)">' + esc(data.background || '—') + '</b></div>';
  if (data.bgApplied && data.bgApplied.mode) {
    var before = data.bgApplied.before || {};
    html += '<div class="cb2-hint" style="margin-top:6px">属性提升：' + ABILITIES.map(function (a) {
      var delta = (data.abilityScores ? (data.abilityScores[a.key] || 0) : 0) - (before[a.key] != null ? before[a.key] : 0);
      return delta ? '<span style="color:var(--green-l)">' + esc(a.name) + ' +' + delta + '</span>' : '';
    }).filter(Boolean).join(' · ') || '无记录' + '</div>';
  }
  var bd = data.bgData || {};
  if (bd.feat) {
    html += '<div class="cb2-feat-chiprow" style="margin-top:8px">' +
      (window.TrpgTag && window.TrpgTag.chip ? window.TrpgTag.chip({ name: bd.feat, type: 'bg', source: '起源专长·' + (data.background || ''), desc: bd.feat }) : '<span class="cb2-feat-chip">' + esc(bd.feat) + '<span class="src auto">起源专长</span></span>') +
      '</div>';
  }
  var sk = skillSrcLine(data, bd.skills);
  if (sk) html += '<div class="cb2-hint" style="margin-top:6px">技能：' + sk + '</div>';
  var tl = toolSrcLine(data, bd.tools);
  if (tl) html += '<div class="cb2-hint" style="margin-top:4px">工具：' + tl + '</div>';
  if (data.bgEquipData) {
    html += '<div class="cb2-hint" style="margin-top:6px">背景装备选择：<b style="color:var(--gold-l)">' + esc(data.bgEquipData.A || 'A') + '</b>' +
      (data.bgEquipData.B ? ' 或 <b style="color:var(--gold-l)">' + esc(data.bgEquipData.B) + '</b>' : '') +
      (data.bgGold ? ' · 金币 ' + fmtGPInline(data.bgGold) : '') + '</div>';
  }
  html += '</div>';
  return html;
}

// 技能页：按属性分组（2026-08-06 从属性页移出，避免技能抢 C 位）
function renderSkillTab(data, derived) {
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">🎓 技能熟练 <span class="cb2-sec-note">●熟练 ◆专精 · 点击掷骰 · 来源自动标注</span></h4><div class="cb2-skill-groups cb2-skill-groups-detail">';
  ABILITIES.forEach(function (a) {
    var list = SKILLS.filter(function (s) { return s.ability === a.name; });
    var items = list.map(function (s) {
      var sk = derived.skills[s.name] || { ability: s.ability, trained: '未熟练', bonus: 0, sources: [] };
      var cls = sk.trained === '专精' ? ' expert' : (sk.trained === '熟练' ? ' trained' : '');
      var srcTip = sk.sources && sk.sources.length ? '来源：' + sk.sources.join('、') : '';
      return '<div class="cb2-skill' + cls + '" data-act="roll-skill" data-skill="' + esc(s.name) + '" title="' + (srcTip ? esc(srcTip) + '\n' : '') + '点击掷技能检定">' +
        '<span class="cb2-sk-ab">' + esc(a.short) + '</span>' +
        '<span class="cb2-sk-name" data-term="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
        '<span class="cb2-sk-bonus">' + signed(sk.bonus) + '</span></div>';
    }).join('');
    if (items) {
      html += '<div class="cb2-skill-grp"><div class="cb2-skill-grp-t">' + esc(a.name) + ' <span class="cnt">' + esc(a.short) + '</span></div><div class="cb2-skills">' + items + '</div></div>';
    }
  });
  html += '</div></div>';
  return html;
}

// 状态页：状态效果+死亡豁免+灵感+资源（2026-08-06 从属性页移出）
function renderStatusTab(data, derived, token) {
  var ds = data.deathSaves || { success: 0, failure: 0 };
  var deathDots = [0, 1, 2].map(function (i) {
    return '<span class="cb2-dot' + (i < ds.success ? ' success' : '') + '" data-act="death-save" data-kind="success" data-i="' + i + '" title="成功豁免"></span>';
  }).join('');
  var failDots = [0, 1, 2].map(function (i) {
    return '<span class="cb2-dot' + (i < ds.failure ? ' failure' : '') + '" data-act="death-save" data-kind="failure" data-i="' + i + '" title="失败豁免"></span>';
  }).join('');
  var resCards = '';
  if (data.resources && typeof data.resources === 'object') {
    resCards = Object.keys(data.resources).map(function (k) {
      var r = data.resources[k] || {};
      return '<div class="cb2-res-card"><div class="cb2-r-name">' + esc(k) + '</div>' +
        '<div class="cb2-r-val">' + (r.current != null ? r.current : 0) + '/' + (r.max != null ? r.max : 0) + '</div>' +
        '<div class="cb2-r-rec">' + esc(r.recovery || '') + '</div></div>';
    }).join('');
  }
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">状态效果 <span class="cb2-sec-note">点击可移除</span></h4><div class="cb2-status" id="cb2-status-list">' + renderStatusChips(data) + '</div></div>';
  html += '<div class="cb2-sec"><h4 class="cb2-sec-h">濒死与灵感</h4><div class="cb2-row" style="justify-content:space-between;flex-wrap:wrap;gap:14px">' +
    '<div class="cb2-death"><div><div class="cb2-dh">死亡豁免 · 成功</div><div style="display:flex;gap:6px">' + deathDots + '</div></div>' +
    '<div><div class="cb2-dh">死亡豁免 · 失败</div><div style="display:flex;gap:6px">' + failDots + '</div></div>' +
    '<div class="cb2-insp">灵感 <span class="cb2-insp-sw' + (data.inspiration ? ' on' : '') + '" data-act="inspiration" title="灵感（优势掷骰）"></span></div></div>' +
    '</div></div>';
  if (resCards) html += '<div class="cb2-sec"><h4 class="cb2-sec-h">资源</h4><div class="cb2-res">' + resCards + '</div></div>';
  return html;
}
// 金币格式化（背景页内联）
function fmtGPInline(gp) {
  gp = Number(gp) || 0;
  if (gp >= 1) return (gp % 1 === 0 ? gp : gp.toFixed(2)) + ' GP';
  var sp = gp * 10;
  if (sp >= 1) return (sp % 1 === 0 ? sp : sp.toFixed(2)) + ' SP';
  return Math.round(gp * 100) + ' CP';
}

// 渲染背包标签页（物品结构化：武器/护甲/奇物/杂物 + 效果系统）
// 2026-08-05 全站重构：装备以"横向列表条目 + 标签化"管理（类型色系/来源/浮动详情），
// 武器单独提供"武器攻击卡"：每把武器显示攻击修正（属性+熟练+魔法加值+效果）与伤害公式，可点击掷骰。
function renderInventoryTab(data, derived) {
  var items = normalizeItems(data);
  // 金币账本：起始总额 / 已购买 / 剩余（创建器保存 goldStart/goldSpent/goldRemain）
  function fmtGP(gp) {
    gp = Number(gp) || 0;
    if (gp >= 1) return (gp % 1 === 0 ? gp : gp.toFixed(2)) + ' GP';
    var sp = gp * 10;
    if (sp >= 1) return (sp % 1 === 0 ? sp : sp.toFixed(2)) + ' SP';
    return Math.round(gp * 100) + ' CP';
  }
  var goldBar = '';
  if (data.goldStart != null || data.goldSpent != null) {
    var gs = Number(data.goldStart) || 0, gsp = Number(data.goldSpent) || 0, gr = Number(data.goldRemain) || 0;
    var over = gsp > gs;
    goldBar = '<div class="cb2-gold-ledger" style="margin-bottom:10px">' +
      '<span class="cb2-gl-cell">💰 钱包总额 <b>' + fmtGP(gs) + '</b></span>' +
      '<span class="cb2-gl-cell">本次采购 <b style="color:' + (over ? 'var(--red-l)' : 'var(--gold-l)') + '">' + fmtGP(gsp) + '</b></span>' +
      '<span class="cb2-gl-cell">可用余额 <b style="color:' + (over ? 'var(--red-l)' : 'var(--green-l)') + '">' + fmtGP(gr) + '</b>' + (over ? ' ⚠超支' : '') + '</span>' +
      '</div>';
  }
  // ── 武器攻击卡（装备中的武器：攻击修正/伤害公式，动态联动属性与熟练） ──
  var wpnItems = items.filter(function (it) { return it.category === '武器' || it.damageFormula; });
  var wpnHtml = '';
  if (wpnItems.length) {
    var mods = derived.abilityMods || {};
    var profV = Number(derived.proficiency) || 0;
    wpnHtml = '<div class="cb2-sec"><h4 class="cb2-sec-h">⚔ 武器攻击 <span class="cb2-sec-note">点击🎲掷攻击与伤害</span></h4><div class="cb2-wpnlist">' +
      wpnItems.map(function (w, wi) {
        var attrK = w.attackAbility === '敏捷' ? 'dex' : (w.attackAbility === '智力' ? 'int' : (w.attackAbility === '感知' ? 'wis' : (w.attackAbility === '魅力' ? 'cha' : 'str')));
        var attr = Number(mods[attrK]) || 0;
        var magic = Number(w.magicBonus) || 0;
        // 效果累计（weapon.attack / attack.all / damage.all）
        var atkFx = effectSum(data, mods, ['weapon.attack', 'attack.all']);
        var dmgFx = effectSum(data, mods, ['damage.all']);
        var atk = attr + profV + magic + atkFx;
        var dmgFormula = w.damageFormula || '1d4';
        var dmgMod = (w.addAbilityToDamage === false ? 0 : attr) + magic + dmgFx;
        var dmg = dmgFormula + (dmgMod ? (dmgMod > 0 ? ' +' : ' ') + dmgMod : '') + (w.damageType ? ' ' + w.damageType : '');
        var propTip = [w.damageType, w.attackAbility, w.properties && w.properties.length ? w.properties.join('/') : ''].filter(Boolean).join(' · ');
        return '<div class="cb2-wpn' + (w.equipped ? '' : ' unequipped') + '" data-act="wpn-roll" data-i="' + wi + '" title="点击掷 ' + esc(w.name) + ' 攻击">' +
          '<span class="cb2-wpn-n">' + esc(w.name) + (w.quantity > 1 ? ' ×' + w.quantity : '') + '</span>' +
          '<span class="cb2-wpn-atk">攻击 ' + signed(atk) + '</span>' +
          '<span class="cb2-wpn-dmg">伤害 ' + esc(dmg) + '</span>' +
          (propTip ? '<span class="cb2-wpn-props">' + esc(propTip) + '</span>' : '') +
          '<span class="cb2-wpn-roll">🎲</span>' +
          '</div>';
      }).join('') + '</div></div>';
  }
  // ── 装备横向列表条目（标签化） ──
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">背包与装备 <span class="cb2-sec-note">' + items.length + ' 件物品 · 标签化条目</span></h4>' + goldBar +
    '<div class="cb2-itemrows">';
  if (!items.length) html += '<div class="cb2-empty">背包空空如也 — 点击「＋ 添加物品」录入你的装备</div>';
  items.forEach(function (it, i) {
    var cat = it.category || '杂物';
    var isWeapon = !!it.damageFormula || String(cat).indexOf('武器') >= 0;
    var isArmor = it.baseAC != null || /护甲|轻甲|中甲|重甲/.test(String(cat));
    var type = isWeapon ? 'weapon' : (isArmor ? 'armor' : (cat === '奇物' || cat === '冒险套组' ? 'wondrous' : (cat === '盾' ? 'shield' : (cat === '卷轴' ? 'spell' : 'item'))));
    var descParts = [];
    if (it.damageFormula) descParts.push('伤害 ' + it.damageFormula + (it.magicBonus ? '+' + it.magicBonus : '') + ' ' + (it.damageType || '') + (it.attackAbility ? '（' + it.attackAbility + '）' : ''));
    if (it.baseAC) descParts.push('AC ' + it.baseAC + (it.maxDex != null && it.maxDex < 99 ? '（敏捷上限+' + it.maxDex + '）' : '') + (it.strReq ? ' 需力量' + it.strReq : ''));
    if (it.effect) descParts.push('效果：' + it.effect);
    if (it.desc) descParts.push(it.desc);
    var tagOpts = {
      name: it.name,
      type: type,
      source: it.equipped ? '已装备' : '',
      extra: (it.quantity > 1 ? '×' + it.quantity : '') + (it.price != null && it.price !== '' ? ' ' + fmtGP(it.price) : ''),
      meta: {
        '类别': cat,
        '数量': Number(it.quantity) || 1,
        '价格': it.price != null && it.price !== '' ? fmtGP(it.price) : '—',
        '伤害': it.damageFormula || '',
        '伤害类型': it.damageType || '',
        '武器属性': Array.isArray(it.properties) ? it.properties.join('、') : (it.properties || ''),
        '精通': it.mastery || '',
        '基础 AC': it.baseAC != null ? it.baseAC : '',
        '套组内容': Array.isArray(it.contents) ? it.contents.join('、') : ''
      },
      desc: descParts.join('\n') || (Array.isArray(it.contents) && it.contents.length ? '包含：' + it.contents.join('、') : it.name),
      title: it.name + (it.equipped ? '（已装备）' : '') + '（点击编辑，✕删除）',
      rmAct: 'item-del',
      dataI: i,
      removable: true
    };
    var chipHtml = (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip(tagOpts) : '<span class="cb2-it-tag ' + type + '">' + esc(it.name) + '</span>';
    html += '<div class="cb2-itemrow' + (it.equipped ? ' equipped' : '') + '" data-act="item-edit" data-i="' + i + '" title="点击编辑物品">' +
      chipHtml +
      '<span class="cb2-itemrow-acts">' +
      '<button type="button" class="cb2-micon eq' + (it.equipped ? ' eq' : '') + '" data-act="item-equip" data-i="' + i + '" title="' + (it.equipped ? '卸下' : '装备') + '">' + (it.equipped ? '✓' : '装') + '</button>' +
      '</span></div>';
  });
  html += '</div>' +
    '<div class="cb2-row" style="margin-top:10px"><button type="button" class="cb2-btn gold sm" data-act="item-add">＋ 添加物品</button></div></div>';
  // 效果系统区
  html += '<div class="cb2-sec"><h4 class="cb2-sec-h">效果系统 <span class="cb2-sec-note">effectTags + 自定义效果 → 自动累计派生值</span></h4>' +
    '<div class="cb2-hint" style="margin-bottom:8px">当前生效：' +
    (effectList(data).length ? effectList(data).map(function (e) {
      var fx = e.fx || {};
      return (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({
        name: e.label, type: 'effect', source: e.tag ? '预设效果' : '自定义效果',
        meta: { '目标': fx.target || e.key || '', '数值': fx.value != null ? fx.value : '', '持续': fx.duration || '' },
        desc: fx.desc || fx.description || e.label,
        title: e.label
      }) : '<span class="cb2-it-tag wondrous" style="margin-right:4px">' + esc(e.label) + '</span>';
    }).join('') : '<span style="color:var(--text-mute)">无</span>') + '</div>' +
    '<div class="cb2-row"><button type="button" class="cb2-btn blue sm" data-act="fx-add">＋ 添加效果</button>' +
    '<button type="button" class="cb2-btn sm" data-act="fx-preset">⚡ 常用效果（AC+1 / 豁免+1 / DC+1）</button></div>' +
    '<div class="cb2-hint" style="margin-top:8px">装备 +1 长剑、守护护符等魔法物品时，添加对应效果即可真实影响 AC/DC/攻击。</div></div>';
  return wpnHtml + html;
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

// 特性/专长描述查找（顶层，创建器与详情页共用）：起源专长 → 种族特性 → 种族血系/选择项
// 返回纯文本（剥离富文本标签，供 esc() 内联展示；悬浮窗如需富文本直接读 ORIGIN_FEATS）
function stripHtmlTags(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function lookupFeatDesc(f, clsName) {

  var name = String(f || '');
  // 职业 1 级特性（精确到职业优先，回退通用键）
  if (clsName && CLASS_FEATURE_DESC[clsName + '·' + name]) return stripHtmlTags(CLASS_FEATURE_DESC[clsName + '·' + name]);
  if (CLASS_FEATURE_DESC[name]) return stripHtmlTags(CLASS_FEATURE_DESC[name]);
  if (ORIGIN_FEATS[name]) return stripHtmlTags(ORIGIN_FEATS[name]);
  var hit = '';
  Object.keys(RACE_FEATURES).forEach(function (r) {
    if (hit) return;
    (RACE_FEATURES[r].traits || []).forEach(function (t) { if (t.n === name && t.d) hit = t.d; });
  });
  if (hit) return hit;
  Object.keys(RACE_FEATURES).forEach(function (r) {
    if (hit) return;
    (RACE_FEATURES[r].choices || []).forEach(function (ch) {
      if (hit) return;
      (ch.options || []).forEach(function (o) {
        if (hit) return;
        if (typeof o === 'object' && o.v === name && o.d) hit = o.d;
      });
    });
  });
  return hit;
}
// 特性来源判定（详情页用，基于存档数据）：种族/职业/背景/自定义
function featDetailSrc(f, data) {
  var name = String(f || '');
  var raceHit = null;
  Object.keys(RACE_FEATURES).forEach(function (r) {
    if (raceHit) return;
    (RACE_FEATURES[r].traits || []).forEach(function (t) { if (t.n === name) raceHit = r; });
  });
  if (raceHit) return { tag: '种族·' + raceHit, auto: true };
  if (data && data.class && (CLASS_LV1_FEATURES[data.class] || []).indexOf(name) >= 0) return { tag: '职业·' + data.class, auto: true };
  if (data && data.background && BACKGROUNDS[data.background] && BACKGROUNDS[data.background].feat === name) return { tag: '背景·' + data.background, auto: true };
  if (data && data.race && data.raceChoices) {
    var rf = RACE_FEATURES[data.race];
    if (rf && rf.choices) {
      for (var ci = 0; ci < rf.choices.length; ci++) {
        var ch = rf.choices[ci];
        if (ch.kind === 'feat' && data.raceChoices[ch.key] === name) return { tag: '种族·' + data.race, auto: true };
      }
    }
  }
  return { tag: '自定义', auto: false };
}
// 渲染特性标签页
function renderFeaturesTab(data, token, ctx) {
  var html = '';
  var feats = Array.isArray(data.features) ? data.features : [];
  html += '<div class="cb2-sec"><h4 class="cb2-sec-h">已获能力 <span class="cb2-sec-note">' + feats.length + ' 项 · 标签化，悬停查看效果</span></h4>';
  if (!feats.length) html += '<div class="cb2-empty">暂无记录 — 升级时在「升级弹窗」中手动记录职业能力</div>';
  html += '<div class="cb2-feat-chiprow">';
  feats.forEach(function (f, i) {
    var dsc = lookupFeatDesc(f, data.class);
    var src = featDetailSrc(f, data);
    var type = src.auto ? (src.tag.indexOf('种族') === 0 ? 'race' : (src.tag.indexOf('副职') === 0 ? 'subclass' : (src.tag.indexOf('背景') === 0 ? 'bg' : 'cls'))) : 'custom';
    if (window.TrpgTag && window.TrpgTag.chip) {
      html += window.TrpgTag.chip({
        name: f, type: type, source: src.tag,
        desc: dsc || f,
        title: dsc ? f + '：' + dsc.slice(0, 140) + (dsc.length > 140 ? '…' : '') : f,
        dataAct: 'feat-del', dataI: i, removable: true
      });
    } else {
      html += '<span class="cb2-feat-chip" data-feat-name="' + esc(f) + '" data-feat-desc="' + encodeURIComponent(dsc || f) + '" title="' + esc(dsc ? f + '：' + dsc.slice(0, 140) + (dsc.length > 140 ? '…' : '') : f) + '">' + esc(f) +
        '<span class="src' + (src.auto ? ' auto' : ' custom') + '">' + esc(src.tag) + '</span>' +
        '<button type="button" class="rm" data-act="feat-del" data-i="' + i + '">✕</button></span>';
    }
  });
  html += '</div></div>';
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
      // 学派标签（存档 school 优先；缺省从规则书速查数据补）
      var schoolName = s.school || '';
      if (!schoolName && window.__cbSchoolByName && window.__cbSchoolByName[s.name]) schoolName = window.__cbSchoolByName[s.name].school || '';
      if (schoolName) meta.push('<b>' + esc(schoolName) + '</b>');
      if (s.castingTime) meta.push('<b>施法</b> ' + esc(s.castingTime));
      if (s.range) meta.push('<b>距离</b> ' + esc(s.range));
      if (s.components) { var compTags = componentsTags(s.components); if (compTags) meta.push('<b>成分</b> ' + compTags); }
      if (s.duration) meta.push('<b>持续</b> ' + esc(s.duration));
      if (s.concentration) meta.push('<b style="color:var(--amber)">专注</b>');
      if (s.ritual) meta.push('<b style="color:var(--text-3)">仪式</b>');
      var spellMeta = { '环位': lvlName, '学派': schoolName || s.school || '', '施法时间': s.castingTime || '', '距离': s.range || '', '成分': s.components || '', '持续时间': s.duration || '' };
      var spellTag = (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({ name: s.name, type: 'spell', extra: lvlName, source: schoolName || s.school || '', meta: spellMeta, desc: s.desc || '规则数据中尚无完整描述', title: s.name }) : '<span class="cb2-sp-name"><span class="cb2-sp-ring">' + lvlName + '</span>' + esc(s.name) + '</span>';
      spellHtml += '<div class="cb2-spell' + (s.prepared ? ' prepared' : '') + '" data-act="spell-detail" data-i="' + idx + '">' +
        spellTag +
        (derived.spellDC != null && lv > 0 ? '<button type="button" class="cb2-btn sm cb2-spell-roll" data-act="spell-roll" data-i="' + idx + '">🎲 施法</button>' : '') +
        '<div class="cb2-sp-meta">' + (s.school ? '<b>' + esc(s.school) + '</b>' : '') + meta.join('') + '</div>' +
        // 2026-08-06：标签/条目携带完整法术信息，禁止简报式截断（完整描述直接展示）
        (s.desc ? '<div class="cb2-it-desc" style="margin-top:4px;white-space:pre-wrap">' + esc(String(s.desc).trim()) + '</div>' : '') +
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
// 技能来源行（详情页背景卡：为指定技能名列出其来源，无则空）
function skillSrcLine(data, skillNames) {
  var map = (data && data.skillSources) || {};
  var parts = (skillNames || []).filter(Boolean).map(function (n) {
    var srcs = map[n] || [];
    return srcs.length ? n + '←' + srcs.join('+') : null;
  }).filter(Boolean);
  return parts.length ? '<div class="cb2-bg-src">' + esc(parts.join('；')) + '</div>' : '';
}
// 工具来源行（详情页背景卡）
function toolSrcLine(data, toolNames) {
  var map = (data && data.toolSources) || {};
  var names = String(toolNames || '').split(/[、,，]/).filter(Boolean);
  var parts = names.map(function (n) {
    var srcs = map[n] || [];
    return srcs.length ? n + '←' + srcs.join('+') : null;
  }).filter(Boolean);
  return parts.length ? '<div class="cb2-bg-src">' + esc(parts.join('；')) + '</div>' : '';
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
      '<div class="cb2-bg-cell"><label>技能熟练</label><div>' + esc(bgInfo.skills.join('、')) + skillSrcLine(data, bgInfo.skills) + '</div></div>' +
      '<div class="cb2-bg-cell"><label>工具熟练</label><div>' + esc(toolShow) + toolSrcLine(data, toolShow) + '</div></div>' +
      '<div class="cb2-bg-cell full"><label>装备选择</label><div>' + esc(eqShow) + '</div></div>' +
      '</div></div>';
  } else if (bg === '自定义背景' && data.customBg) {
    // 自定义背景：按 customBg 配置展示（技能/工具/装备/属性方案）
    var cbg = data.customBg || {};
    var cAttrShow = cbg.attr === '111' ? '三项各 +1' : '+2 / +1';
    if (cbg.attrKeys && cbg.attrKeys.length) cAttrShow += '（' + cbg.attrKeys.filter(Boolean).join('、') + '）';
    var cEqShow = cbg.equip === 'B' ? 'B：' + (cbg.gold || 50) + 'GP'
      : 'A 套装：' + ((cbg.items || []).join('、') || '—');
    var cToolShow = cbg.tool || '—';
    bgHtml = '<div class="cb2-bg-card" style="margin-bottom:12px">' +
      '<div class="cb2-bg-card-t">📜 ' + esc(cbg.name || '自定义背景') + ' <span class="cb2-bg-card-tag">自定义背景</span></div>' +
      '<div class="cb2-bg-card-grid">' +
      (data.ruleVersion === '2024' ? '<div class="cb2-bg-cell"><label>属性提升方案</label><div>' + esc(cAttrShow) + '</div></div>' : '') +
      '<div class="cb2-bg-cell"><label>技能熟练</label><div>' + esc((cbg.skills || []).join('、') || '—') + skillSrcLine(data, cbg.skills || []) + '</div></div>' +
      '<div class="cb2-bg-cell"><label>工具熟练</label><div>' + esc(cToolShow) + toolSrcLine(data, cToolShow) + '</div></div>' +
      '<div class="cb2-bg-cell full"><label>装备选择</label><div>' + esc(cEqShow) + '</div></div>' +
      '</div></div>';
  }
  // 种族特性（存档 raceFeatures 优先，旧存档回退规则数据）
  var raceInfo = (data.raceFeatures && data.raceFeatures.traits) ? data.raceFeatures : (RACE_FEATURES[data.race] || null);
  var raceHtml = '';
  if (raceInfo) {
    raceHtml = '<div class="cb2-sec" style="margin-bottom:12px"><h4 class="cb2-sec-h">🧝 ' + esc(data.race || '') + ' 种族特性</h4>' +
      '<div class="cb2-race-meta">' +
      '<span class="cb2-tag">生物类型：' + esc(raceInfo.type || '类人') + '</span>' +
      '<span class="cb2-tag">体型：' + esc(raceInfo.size || '—') + '</span>' +
      '<span class="cb2-tag">速度：' + esc(raceInfo.speed || '—') + '</span>' +
      '<span class="cb2-tag">语言：' + esc(data.languages || RACE_LANGS[data.race] || '通用语') + '</span>' +
      '</div><div class="cb2-race-traits">' +
      (raceInfo.traits || []).map(function (t) {
        var dyn = '';
        if (data.race === '龙裔' && t.n === '伤害抗性' && (data.raceChoices || {}).dragon) {
          var dOpt = null;
          (raceInfo.choices || []).forEach(function (ch) {
            if (ch.key === 'dragon') (ch.options || []).forEach(function (o) { if (o.v === data.raceChoices.dragon) dOpt = o.d; });
          });
          var dm = String(dOpt || '').match(/获得(.+?)抗性/);
          dyn = '<b style="color:var(--green-l)"> → 已选' + esc(data.raceChoices.dragon) + (dm ? '：获得' + esc(dm[1]) + '抗性' : '') + '</b>';
        }
        return '<div class="cb2-race-trait"><b>' + esc(t.n) + '。</b>' + esc(t.d) + dyn + '</div>';
      }).join('') +
      '</div>' +
      ((raceInfo.choices || []).map(function (ch) {
        var cur = (data.raceChoices || {})[ch.key];
        var opts = ch.options || [];
        var curDesc = '';
        if (cur) {
          opts.forEach(function (o) {
            if (typeof o === 'string') { if (String(o).indexOf(cur) === 0) curDesc = o; }
            else if (o.v === cur) curDesc = o.d || cur;
          });
          if (!curDesc) curDesc = cur;
        }
        return '<div class="cb2-race-choice"><div class="t">☑ ' + esc(ch.n) +
          (cur ? '：<b style="color:var(--gold-l)">' + esc(cur) + '</b>' : '：未选择') + '</div>' +
          (curDesc ? '<div class="cb2-race-trait">' + esc(curDesc) + '</div>' : '') +
          '</div>';
      }).join('')) +
      '</div>';
  }
  var html = raceHtml + bgHtml + '<div class="cb2-sec"><h4 class="cb2-sec-h">角色背景</h4><div class="cb2-edit-grid">' +
    rows.map(function (r) {
      var isLong = r[0] === '外貌' || r[0] === '性格' || r[0] === '理想' || r[0] === '牵绊' || r[0] === '缺陷';
      var style = isLong ? 'color:var(--text);font-size:12px;white-space:pre-wrap;line-height:1.7' : 'color:var(--text);font-size:12px';
      return '<div class="cb2-field"><label>' + esc(r[0]) + '</label><div class="cb2-hint" style="' + style + '">' + esc(r[1] || '—') + '</div></div>';
    }).join('') +
    (b.backstory ? '<div class="cb2-field full"><label>📖 背景故事</label><div class="cb2-hint" style="color:var(--text);font-size:12px;white-space:pre-wrap;line-height:1.8">' + esc(b.backstory) + '</div></div>' : '') +
    '</div></div>';
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
    '<div class="cb2-sub">' + [d.race, d.subclass ? d.subclass + '（' + d.class + '）' : d.class, d.background, d.level ? 'Lv' + d.level : ''].filter(Boolean).join(' · ') + '</div>' +
    '</div>' +
    '<div class="cb2-actions">' +
    '<button type="button" class="cb2-btn" data-act="roll-d20" title="掷 d20">🎲 d20</button>' +
    '<button type="button" class="cb2-btn gold" data-act="levelup" title="升级到下一级">⬆ 升级</button>' +
    '<button type="button" class="cb2-btn blue" data-act="ai-summary" title="复制AI状态摘要">🤖 AI摘要</button>' +
    (ctx && ctx.openRuleFile && d.class ? '<button type="button" class="cb2-btn" data-act="open-src">📖 原文</button>' : '') +
    // 2026-08-06：编辑按钮按权限显示（创建者或 GM；宿主 canEditCharacter 提供判定，缺省=可编辑）
    ((window.UIManager && window.UIManager.canEditCharacter ? window.UIManager.canEditCharacter(tokenId) : true) && window.UIManager && window.UIManager.openCharacterModalForEdit ? '<button type="button" class="cb2-btn green" data-act="edit-sheet">✏️ 编辑</button>' : '') +
    '</div></div>';

  // 标签导航（2026-08-06：与创建流程分页统一——数据驱动单一 TABS：概览/种族/职业/背景/属性/技能/法术/背包/特性/状态/笔记）
  var tabs = [
    ['bio', '👤', '概览'], ['race', '🧝', '种族'], ['cls', '⚔️', '职业'], ['bg', '📜', '背景'],
    ['attr', '💪', '属性'], ['skill', '🎓', '技能'], ['spell', '🔮', '法术'],
    ['inv', '🎒', '背包'], ['feat', '⭐', '特性'], ['status', '🩹', '状态'], ['note', '📝', '笔记']
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
      race: renderRaceTab(d, derived),
      cls: renderClassTab(d, derived),
      bg: renderBackgroundTab(d, derived),
      skill: renderSkillTab(d, derived),
      status: renderStatusTab(d, derived, token),
      inv: renderInventoryTab(d, derived),
      feat: renderFeaturesTab(d, token, ctx),
      spell: renderSpellsTab(d, derived),
      note: renderNotesTab(d),
      bio: renderBioTab(d)
    }[tab] || renderAttributesTab(d, derived, token);

  // 2026-08-05：加载法术学派数据（详情页法术标签化显示；加载后重渲染一次）
  if (!window.__cbSpellSchools && ctx && typeof ctx.fetch === 'function') {
    try {
      ctx.fetch('/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spell_schools.json')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.spells) {
            window.__cbSpellSchools = j.spells;
            window.__cbSchoolByName = {};
            Object.keys(j.spells).forEach(function (k) {
              var v = j.spells[k];
              if (v && v.name) window.__cbSchoolByName[v.name] = v;
            });
            if (tab === 'spell') refreshDetail(tokenId);
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  var sw = renderCharacterSwitcher(container, tokenId, ctx);
  container.innerHTML = '<div class="cb2" data-token="' + esc(tokenId) + '">' +
    (sw ? '<div class="cb2-row" style="margin-bottom:10px">' + sw + '</div>' : '') +
    head + renderOverview(d, derived) + tabHtml +
    '<div class="cb2-grid">' + tabContent + '</div>' + restBar +
    '</div>';
  if (window.TrpgTag && window.TrpgTag.bindTips) window.TrpgTag.bindTips(container);

  // 旧特性节点的悬浮兼容；法术、物品、特性统一由 TrpgTag 负责
  container.addEventListener('mouseover', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    var el = t && t.getAttribute ? t : null;
    // 特性/能力悬浮（名称+来源，同步显示效果）
    while (el && el !== container && !el.getAttribute('data-feat-desc')) el = el.parentNode;
    if (el && el !== container && el.getAttribute('data-feat-desc')) {
      var fd = el.getAttribute('data-feat-desc');
      var fname = el.getAttribute('data-feat-name') || '';
      var descTxt = '';
      try { descTxt = decodeURIComponent(fd); } catch (err) { descTxt = fd; }
      var old = document.getElementById('cb2-spell-tip');
      if (old) old.remove();
      var tip = document.createElement('div');
      tip.id = 'cb2-spell-tip';
      tip.className = 'cb2-spell-tip';
      tip.innerHTML = '<div class="cb2-spell-tip-n">✨ ' + esc(fname || '特性') + '</div><div class="cb2-spell-tip-b" style="white-space:pre-wrap">' + esc(descTxt) + '</div>';
      document.body.appendChild(tip);
      var rect = el.getBoundingClientRect();
      var left = Math.max(8, Math.min(window.innerWidth - 290, rect.left));
      var top = rect.bottom + 8;
      if (top + 160 > window.innerHeight) top = rect.top - 170;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      return;
    }
  });
  container.addEventListener('mouseout', function () { hideSpellTip(); });

  // 2026-08-06：属性=可直接修改的数字（失焦/回车保存，派生值实时重算）
  container.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var abKey = t.getAttribute('data-ab-input');
    if (abKey) {
      var nv = Math.max(1, Math.min(30, Number(t.value) || 10));
      t.value = nv;
      var d2 = (token && token.data) || {};
      d2.abilityScores = Object.assign({}, d2.abilityScores || {});
      d2.abilityScores[abKey] = nv;
      saveCharacterData(tokenId, { abilityScores: d2.abilityScores }, { toast: ABILITIES_MAP[abKey] + '已修改为 ' + nv + '（派生值已重算）' });
      refreshDetail(tokenId);
    }
  });

  // ═══ 事件绑定（事件委托） ═══
  container.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    // 2026-08-05 标签系统：点击标签的移除按钮（✕）→ 触发其宿主条目行为（删除/卸下等）
    var rmBtn = null;
    var probe = e.target;
    while (probe && probe !== container) {
      if (probe.getAttribute && probe.getAttribute('data-tg-rm') != null) { rmBtn = probe; break; }
      probe = probe.parentNode;
    }
    if (rmBtn) {
      var host = rmBtn.parentNode;
      while (host && host !== container && !host.getAttribute('data-act') && !host.getAttribute('data-tg-rm-act')) host = host.parentNode;
      if (host && host !== container) {
        // rmAct 指定移除行为的执行行为（如 item-del），临时替换 data-act 触发委托后还原
        var rmAct2 = host.getAttribute('data-tg-rm-act');
        if (rmAct2) {
          var savedAct = host.getAttribute('data-act');
          host.setAttribute('data-act', rmAct2);
          host.click();
          if (savedAct) host.setAttribute('data-act', savedAct); else host.removeAttribute('data-act');
        } else {
          host.click();
        }
      }
      return;
    }
    var actEl = t;
    // 查找条件含 data-switch：角色切换条目（cb2-sw-avatar）只有 data-switch 没有 data-act，
    // 若不纳入查找，点击条目在下方 return 处被丢弃，切换角色永远无效
    while (actEl && actEl !== container && !actEl.getAttribute('data-act') && !actEl.getAttribute('data-switch')) actEl = actEl.parentNode;
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
      // 直接删除（与宿主角色列表 ✕ 一致，不再依赖 window.confirm——部分宿主环境脚本对话框不可靠）
      if (window.UIManager && window.UIManager.deleteCharacter) {
        window.UIManager.deleteCharacter(tokenId);
        return;
      }
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
    if (act === 'item-edit') {
      var eii = Number(actEl.getAttribute('data-i'));
      openItemModal(tokenId, data2, eii);
      return;
    }
    // 2026-08-05 武器攻击卡：点击掷该武器攻击（攻击=d20+属性+熟练+魔法+效果；伤害自动掷出）
    if (act === 'wpn-roll') {
      var wii = Number(actEl.getAttribute('data-i'));
      var wpns = normalizeItems(data2).filter(function (x) { return x.category === '武器' || x.damageFormula; });
      var wd = wpns[wii];
      if (wd) {
        var m2 = derived2.abilityMods || {};
        var attrK2 = wd.attackAbility === '敏捷' ? 'dex' : (wd.attackAbility === '智力' ? 'int' : (wd.attackAbility === '感知' ? 'wis' : (wd.attackAbility === '魅力' ? 'cha' : 'str')));
        var atk2 = (Number(m2[attrK2]) || 0) + Number(derived2.proficiency) + (Number(wd.magicBonus) || 0) + effectSum(data2, m2, ['weapon.attack', 'attack.all']);
        var rollRes = playerRoll(wd.name + ' 攻击', atk2, null);
        if (rollRes.verdict && rollRes.verdict.indexOf('大成功') >= 0) {
          // 暴击：伤害骰翻倍
          var dm = String(wd.damageFormula || '1d4').match(/(\d+)d(\d+)/);
          var crit = dm ? (Number(dm[1]) * 2) + 'd' + dm[2] : wd.damageFormula;
          var dmgAbility = wd.addAbilityToDamage === false ? 0 : (Number(m2[attrK2]) || 0);
          var dmgN = rollDiceSum(crit) + dmgAbility + (Number(wd.magicBonus) || 0) + effectSum(data2, m2, ['damage.all']);
          addRollLog({ title: wd.name + ' 暴击伤害', detail: crit + '（暴击翻倍）+' + (dmgAbility + (Number(wd.magicBonus) || 0) + effectSum(data2, m2, ['damage.all'])) + ' = ' + dmgN, result: dmgN + ' ' + (wd.damageType || ''), raw: 20 });
        } else {
          var dmgAbility2 = wd.addAbilityToDamage === false ? 0 : (Number(m2[attrK2]) || 0);
          var dmgN2 = rollDiceSum(wd.damageFormula || '1d4') + dmgAbility2 + (Number(wd.magicBonus) || 0) + effectSum(data2, m2, ['damage.all']);
          addRollLog({ title: wd.name + ' 伤害', detail: (wd.damageFormula || '1d4') + ' +' + (dmgAbility2 + (Number(wd.magicBonus) || 0) + effectSum(data2, m2, ['damage.all'])) + ' = ' + dmgN2, result: dmgN2 + ' ' + (wd.damageType || ''), raw: 0 });
        }
      }
      return;
    }
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
  // 2026-08-05 标签系统：统一浮动详情绑定
  if (window.TrpgTag && typeof window.TrpgTag.bindTips === 'function') {
    try { window.TrpgTag.bindTips(container); } catch (e) {}
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
// 种族 → 特性（2024 PHB 角色起源·种族 各源文整理；traits 为种族默认特质，choices 为可选子项）
// 字段：type 生物类型 / size 体型 / speed 速度 / traits [{n 名称, d 效果}] / choices [{n 可选组名, options [字符串]}]
var RACE_FEATURES = {
  '人类': { type: '类人', size: '中型（约4-7尺）或小型（约2-4尺），选取时自选', speed: '30尺', traits: [
    { n: '适应力', d: '每当你完成长休时，你都会获得英雄激励。' }
  ], choices: [
    { n: '技能熟练', key: 'skillful', kind: 'skill', options: [
      { v: '运动' }, { v: '特技' }, { v: '巧手' }, { v: '隐匿' }, { v: '奥秘' }, { v: '历史' },
      { v: '调查' }, { v: '自然' }, { v: '宗教' }, { v: '驯兽' }, { v: '洞悉' }, { v: '医药' },
      { v: '察觉' }, { v: '求生' }, { v: '欺瞒' }, { v: '威吓' }, { v: '表演' }, { v: '游说' }
    ] },
    { n: '起源专长（多才多艺）', key: 'versatile', kind: 'feat', options: [
      { v: '警戒' }, { v: '巧匠' }, { v: '医疗师' }, { v: '幸运' }, { v: '魔法学徒' },
      { v: '音乐家' }, { v: '凶蛮打手' }, { v: '熟习' }, { v: '酒馆斗殴者' }, { v: '健壮' }
    ] }
  ] },
  '矮人': { type: '类人', size: '中型（约4-5尺）', speed: '30尺', traits: [
    { n: '黑暗视觉', d: '你拥有120尺黑暗视觉。' },
    { n: '矮人体魄', d: '你具有毒素伤害的抗性。此外，你为避免/结束中毒状态所做的豁免检定具有优势。' },
    { n: '矮人刚毅', d: '你的生命值上限加1，且此后每次升级时再加1。' },
    { n: '石中精妙', d: '以一个附赠动作，你获得60尺震颤感知，持续10分钟（须位于/触碰岩石表面）。可使用次数等于你的熟练加值，完成长休后重获。' }
  ] },
  '精灵': { type: '类人', size: '中型（约5-6尺）', speed: '30尺', traits: [
    { n: '黑暗视觉', d: '你拥有60尺黑暗视觉。' },
    { n: '妖精血统', d: '你在进行避免或结束魅惑状态的豁免时具有优势。' },
    { n: '出神', d: '你无需睡眠，魔法也无法使你陷入睡眠。利用出神冥想，你仅用4小时完成长休，且期间保持清醒。' }
  ], choices: [
    { n: '精灵血系', key: 'lineage', kind: 'bloodline', options: [
      { v: '卓尔', d: '黑暗视觉提升至120尺，习得舞光术；3级妖火；5级黑暗术' },
      { v: '高等精灵', d: '知晓魔法伎俩，可每长休替换为法师戏法；3级侦测魔法；5级迷踪步' },
      { v: '木精灵', d: '速度提升至35尺，知晓德鲁伊伎俩；3级大步奔行；5级行动无踪' }
    ] },
    { n: '敏锐感官（技能熟练）', key: 'keen', kind: 'skill', options: [
      { v: '洞悉' }, { v: '察觉' }, { v: '求生' }
    ] }
  ] },
  '龙裔': { type: '类人', size: '中型（约5-7尺）', speed: '30尺', traits: [
    { n: '吐息武器', d: '攻击动作时将一次攻击替换为释放能量，覆盖15尺锥状或30尺线状区域。区域内生物须通过敏捷豁免（DC=8+体质调整+熟练加值），失败受1d10伤害（5级2d10/11级3d10/17级4d10）。次数=熟练加值，长休后重获。' },
    { n: '伤害抗性', d: '根据所选龙种获得对应伤害类型的抗性（见下方选择）。' },
    { n: '黑暗视觉', d: '你拥有60尺黑暗视觉。' },
    { n: '龙族飞翼', d: '5级后可以附赠动作长出灵体飞翼，持续10分钟，获得等于你速度的飞行速度。长休前不可再次使用。' }
  ], choices: [
    { n: '龙族血统', key: 'dragon', kind: 'dragon', options: [
      { v: '白龙', d: '伤害类型：寒冷；获得寒冷抗性' },
      { v: '黑龙', d: '伤害类型：强酸；获得强酸抗性' },
      { v: '绿龙', d: '伤害类型：毒素；获得毒素抗性' },
      { v: '蓝龙', d: '伤害类型：闪电；获得闪电抗性' },
      { v: '红龙', d: '伤害类型：火焰；获得火焰抗性' },
      { v: '黄铜龙', d: '伤害类型：火焰；获得火焰抗性' },
      { v: '赤铜龙', d: '伤害类型：强酸；获得强酸抗性' },
      { v: '青铜龙', d: '伤害类型：闪电；获得闪电抗性' },
      { v: '银龙', d: '伤害类型：寒冷；获得寒冷抗性' },
      { v: '金龙', d: '伤害类型：火焰；获得火焰抗性' }
    ] }
  ] },
  '侏儒': { type: '类人', size: '小型（约3-4尺）', speed: '30尺', traits: [
    { n: '黑暗视觉', d: '你拥有60尺黑暗视觉。' },
    { n: '侏儒狡黠', d: '你进行的智力、感知、魅力豁免检定均具有优势。' }
  ], choices: [
    { n: '侏儒血系', key: 'lineage', kind: 'bloodline', options: [
      { v: '森林侏儒', d: '知晓次级幻象戏法；始终准备动物交谈，可不消耗法术位施展（次数=熟练加值，长休后重获）' },
      { v: '岩石侏儒', d: '知晓修复术与魔法伎俩；可花费10分钟用魔法伎俩创造微型发条装置（AC5/HP1，同时最多3台，8小时后解体）' }
    ] }
  ] },
  '歌利亚': { type: '类人', size: '中型（约7-8尺）', speed: '35尺', traits: [
    { n: '大型形态', d: '5级后可用附赠动作变为大型（持续10分钟），期间力量检定具有优势，速度+10尺。长休前不可再次使用。' },
    { n: '身强力壮', d: '你为结束受擒状态所进行的属性检定具有优势。计算载重时视为大一级的体型。' }
  ], choices: [
    { n: '巨人恩惠', key: 'giant', kind: 'giant', options: [
      { v: '云之远迹', d: '（云巨人）附赠动作传送到30尺内可见未占据空间' },
      { v: '火之燃烧', d: '（火巨人）攻击命中造成伤害时额外1d10火焰伤害' },
      { v: '霜之刺骨', d: '（霜巨人）攻击命中时额外1d6寒冷伤害并减速10尺至下回合开始' },
      { v: '山之翻撞', d: '（山丘巨人）攻击命中大型及以下生物时可令其倒地' },
      { v: '石之坚韧', d: '（石巨人）受伤害时用反应掷d12，减少掷骰结果+体质调整值点伤害' },
      { v: '岚之暴鸣', d: '（风暴巨人）被60尺内生物造成伤害时，反应对该生物造成1d8雷鸣伤害' }
    ] }
  ] },
  '半身人': { type: '类人', size: '小型（约2-3尺）', speed: '30尺', traits: [
    { n: '勇气', d: '你在避免或结束恐慌状态进行的豁免时具有优势。' },
    { n: '半身人灵巧', d: '你可以移动穿越任何体型比你大的生物所在的空间，但不能在其内停下。' },
    { n: '幸运', d: '当你在D20检定中的d20掷出1时，你可以重新掷骰，但必须使用重骰的结果。' },
    { n: '天生善匿', d: '在有体型至少比你大1级的生物遮蔽你时，你也可以执行躲藏动作。' }
  ] },
  '兽人': { type: '类人', size: '中型（约6-7尺）', speed: '30尺', traits: [
    { n: '激昂冲锋', d: '用附赠动作执行疾走动作，并获得等同于熟练加值的临时生命值。次数=熟练加值，完成短休或长休时重获。' },
    { n: '黑暗视觉', d: '你拥有120尺黑暗视觉。' },
    { n: '坚韧不屈', d: '当你生命值降至0而没有立即死亡时，可改为使生命值降至1。此特质一经使用，直至完成长休都无法再次使用。' }
  ] },
  '提夫林': { type: '类人', size: '中型（约4-7尺）或小型（约3-4尺），选取时自选', speed: '30尺', traits: [
    { n: '黑暗视觉', d: '你拥有60尺黑暗视觉。' },
    { n: '异界存在', d: '你习得奇术戏法，用此特质施展时使用与邪魔遗赠相同的施法属性。' }
  ], choices: [
    { n: '邪魔遗赠', key: 'legacy', kind: 'bloodline', options: [
      { v: '深渊', d: '毒素伤害抗性，习得毒气喷涌；3级致病射线；5级定身类人' },
      { v: '幽冥', d: '暗蚀伤害抗性，习得颤栗之触；3级虚假生命；5级衰弱射线' },
      { v: '炼狱', d: '火焰伤害抗性，习得火焰箭；3级炼狱叱喝；5级黑暗术' }
    ] }
  ] },
  '阿斯莫': { type: '类人', size: '中型（约4-7尺）或小型（约2-4尺），选取时自选', speed: '30尺', traits: [
    { n: '天界抗性', d: '你具有光耀伤害与暗蚀伤害的抗性。' },
    { n: '黑暗视觉', d: '你拥有60尺黑暗视觉。' },
    { n: '治愈之手', d: '以一个魔法动作触碰一个生物，掷数量等于熟练加值的d4，该生物恢复掷骰结果之和的生命值。长休前不可再次使用。' },
    { n: '光辉掌者', d: '你习得光亮术戏法，其施法属性为魅力。' },
    { n: '天启', d: '3级后获得用附赠动作变身的能力（持续1分钟，长休前不可再次使用）。变身期间每回合一次，攻击或法术造成伤害时可额外造成等于熟练加值的伤害（天堂飞翼/内耀辉光=光耀，死灵环绕=暗蚀）。' }
  ] }
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
// 职业可熟练技能数（2024 玩家手册职业表「熟练」行：从职业技能列表中选 N 项）
var CLASS_SKILL_COUNT = {
  '野蛮人': 2, '吟游诗人': 3, '牧师': 2, '德鲁伊': 2, '战士': 2, '武僧': 2,
  '圣武士': 2, '游侠': 3, '游荡者': 4, '术士': 2, '魔契师': 2, '法师': 2, '奇械师': 3
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

// ── 职业全等级特性表（玩家手册2024 各职业特性表；奇械师为 TCE 版本）──
// 每级列出该等级获得/改进的特性；'副职' 占位符在渲染时替换为该职业的副职选择；
// '属性提升'/'专长' 为规则书通用等级项（4/8/12/16/19 等）。
var CLASS_FEATURES_BY_LEVEL = {
  '野蛮人': {
    1: ['狂暴', '无甲防御', '武器精通'], 2: ['危险感知', '鲁莽攻击'],
    3: ['副职'], 4: ['属性提升'], 5: ['额外攻击', '快速移动'], 6: ['副职特性'],
    7: ['野蛮人闪避'], 8: ['属性提升'], 9: ['蛮横暴击'], 10: ['副职特性'],
    11: ['无情狂暴'], 12: ['属性提升'], 13: ['蛮横暴击（改进）'], 14: ['副职特性'],
    15: ['持久狂暴'], 16: ['属性提升'], 17: ['蛮横暴击（改进）'], 18: ['残暴打击'],
    19: ['属性提升'], 20: ['原始冠军']
  },
  '吟游诗人': {
    1: ['吟游诗人激励', '施法', '乐器熟练'], 2: ['戏法精通', '万事通', '歌曲恢复'],
    3: ['副职'], 4: ['属性提升'], 5: ['吟游诗人激励（骰d8）', '戏法精通（改进）', '歌曲恢复（改进）'],
    6: ['副职特性', '反制魅力'], 7: ['专长'], 8: ['属性提升'],
    9: ['歌曲恢复（改进）'], 10: ['副职特性', '魔法秘密', '吟游诗人激励（骰d10）'],
    11: ['专长'], 12: ['属性提升'], 13: ['歌曲恢复（改进）'], 14: ['副职特性', '魔法秘密（改进）'],
    15: ['专长', '吟游诗人激励（骰d12）'], 16: ['属性提升'], 17: ['歌曲恢复（改进）'],
    18: ['魔法秘密（改进）'], 19: ['属性提升'], 20: ['超凡灵感']
  },
  '牧师': {
    1: ['施法', '圣职'], 2: ['引导神力', '神圣职能'], 3: ['专长', '副职'],
    4: ['属性提升'], 5: ['毁灭灵光', '引导神力（封印）'], 6: ['副职特性'],
    7: ['专长'], 8: ['属性提升'], 9: ['引导神力（至圣）'], 10: ['神圣干预'],
    11: ['专长'], 12: ['属性提升'], 13: ['引导神力（改进）'], 14: ['副职特性'],
    15: ['专长'], 16: ['属性提升'], 17: ['引导神力（改进）'], 18: ['神圣干预（改进）'],
    19: ['属性提升'], 20: ['大祭司']
  },
  '德鲁伊': {
    1: ['德鲁伊语', '原初职能', '施法'], 2: ['自然变身', '野性伙伴', '副职'],
    3: ['专长'], 4: ['属性提升', '自然变身（改进）'], 5: ['自然形态（改进）'],
    6: ['副职特性'], 7: ['专长'], 8: ['属性提升'], 9: ['自然形态（改进）'],
    10: ['副职特性'], 11: ['专长'], 12: ['属性提升'], 13: ['自然形态（改进）'],
    14: ['副职特性'], 15: ['专长'], 16: ['属性提升'], 17: ['自然形态（改进）'],
    18: ['永恒野性'], 19: ['属性提升'], 20: ['大德鲁伊']
  },
  '战士': {
    1: ['战斗风格', '回气', '武器精通'], 2: ['战术头脑', '战术思维'],
    3: ['副职'], 4: ['属性提升'], 5: ['额外攻击', '战术头脑（二次使用）'],
    6: ['副职特性'], 7: ['专长'], 8: ['属性提升'], 9: ['不屈'],
    10: ['副职特性'], 11: ['额外攻击（三次）'], 12: ['属性提升'], 13: ['不屈（二次使用）'],
    14: ['副职特性'], 15: ['专长'], 16: ['属性提升'], 17: ['战术头脑（三次使用）', '不屈（三次使用）'],
    18: ['副职特性'], 19: ['属性提升'], 20: ['武器大师']
  },
  '武僧': {
    1: ['武艺', '无甲防御'], 2: ['气', '无甲移动', '武僧武器精通'],
    3: ['副职', '气之力（偏折飞弹）'], 4: ['属性提升', '减速打击'],
    5: ['额外攻击', '气之力（疾风连击强化）'], 6: ['副职特性', '武僧武器精通（改进）'],
    7: ['气之力（仍然站立）', '专长'], 8: ['属性提升'], 9: ['气之力（健步如飞）', '无甲移动（改进）'],
    10: ['副职特性'], 11: ['气之力（心灵之躯）'], 12: ['属性提升'], 13: ['专长'],
    14: ['副职特性', '无甲移动（飞行）'], 15: ['气之力（完美自身）'], 16: ['属性提升'],
    17: ['专长'], 18: ['气之力（超凡）'], 19: ['属性提升'], 20: ['完美武僧']
  },
  '圣武士': {
    1: ['圣疗', '施法', '武器精通'], 2: ['战斗风格', '引导神力', '圣武士法术'],
    3: ['副职', '引导神力（神圣感知）'], 4: ['属性提升'], 5: ['额外攻击', '引导神力（改进）'],
    6: ['光环（保护）'], 7: ['专长'], 8: ['属性提升'], 9: ['光环（勇气）'],
    10: ['副职特性', '光环（慷慨）'], 11: ['强力打击'], 12: ['属性提升'], 13: ['专长'],
    14: ['光环（改进）'], 15: ['副职特性'], 16: ['属性提升'], 17: ['专长'],
    18: ['光环（改进）'], 19: ['属性提升'], 20: ['圣武士化身']
  },
  '游侠': {
    1: ['宿敌', '施法', '武器精通'], 2: ['战斗风格', '施法（法术位）'],
    3: ['副职'], 4: ['属性提升'], 5: ['额外攻击', '宿敌（改进）'], 6: ['副职特性'],
    7: ['专长'], 8: ['属性提升'], 9: ['林地步履（改进）'], 10: ['副职特性', '无踪步'],
    11: ['专长'], 12: ['属性提升'], 13: ['专长'], 14: ['副职特性'], 15: ['专长'],
    16: ['属性提升'], 17: ['专长'], 18: ['本能施法'], 19: ['属性提升'], 20: ['致命猎手']
  },
  '魔契师': {
    1: ['魔能祈唤', '契约魔法'], 2: ['魔契', '魔能祈唤（改进）'],
    3: ['副职', '魔能祈唤（改进）'], 4: ['属性提升'], 5: ['魔能祈唤（改进）', '契约术法（改进）'],
    6: ['副职特性'], 7: ['魔能祈唤（改进）'], 8: ['属性提升'], 9: ['魔能祈唤（改进）'],
    10: ['副职特性'], 11: ['契约术法（大师）'], 12: ['属性提升'], 13: ['魔能祈唤（改进）'],
    14: ['副职特性'], 15: ['契约术法（改进）'], 16: ['属性提升'], 17: ['魔能祈唤（改进）'],
    18: ['副职特性'], 19: ['属性提升'], 20: ['魔契师化身']
  },
  '法师': {
    1: ['施法', '仪式学家', '奥术回想'], 2: ['学者之智'], 3: ['副职', '专长'],
    4: ['属性提升'], 5: ['奥术回想（改进）'], 6: ['副职特性'], 7: ['专长'],
    8: ['属性提升'], 9: ['奥术回想（改进）'], 10: ['副职特性'], 11: ['专长'],
    12: ['属性提升'], 13: ['奥术回想（改进）'], 14: ['副职特性'], 15: ['专长'],
    16: ['属性提升'], 17: ['奥术回想（改进）'], 18: ['副职特性'], 19: ['属性提升'],
    20: ['传奇法师']
  },
  '游荡者': {
    1: ['专精', '偷袭', '盗贼黑话', '武器精通'], 2: ['诡计行动'],
    3: ['副职', '专长'], 4: ['属性提升'], 5: ['诡诈之握', '警觉感官'], 6: ['副职特性', '专精（额外）'],
    7: ['专长'], 8: ['属性提升'], 9: ['诡诈之握（改进）'], 10: ['副职特性'],
    11: ['可靠天赋'], 12: ['属性提升'], 13: ['诡诈之握（改进）'], 14: ['副职特性'],
    15: ['敏锐思维'], 16: ['属性提升'], 17: ['诡诈之握（改进）', '完美诡计'], 18: ['副职特性'],
    19: ['属性提升'], 20: ['致命一击']
  },
  '术士': {
    1: ['施法', '先天术法'], 2: ['超魔法', '魔法觉醒'], 3: ['副职', '专长'],
    4: ['属性提升'], 5: ['术法点（改进）'], 6: ['副职特性'], 7: ['专长'], 8: ['属性提升'],
    9: ['术法点（改进）'], 10: ['副职特性', '超魔法（改进）'], 11: ['专长'], 12: ['属性提升'],
    13: ['术法点（改进）'], 14: ['副职特性'], 15: ['专长'], 16: ['属性提升'],
    17: ['超魔法（改进）'], 18: ['副职特性'], 19: ['属性提升'], 20: ['术士化身']
  },
  '奇械师': {
    1: ['魔法玩意', '施法', '工具熟练'], 2: ['魔力灌注'], 3: ['副职', '专长'],
    4: ['属性提升'], 5: ['副职特性'], 6: ['副职特性'], 7: ['专长'], 8: ['属性提升'],
    9: ['魔力灌注（改进）'], 10: ['副职特性'], 11: ['专长'], 12: ['属性提升'],
    13: ['副职特性'], 14: ['魔力灌注（改进）'], 15: ['专长'], 16: ['属性提升'],
    17: ['副职特性'], 18: ['完美魔法玩意'], 19: ['属性提升'], 20: ['奇械师化身']
  }
};

// ── 副职（子职业）数据：职业 → 副职列表（名称/描述/各等级特性）──
// 数据来源：rule_tables.md 子职业表 + 玩家手册2024 副职。特性名加入角色 features，来源标记「副职·<名>」。
var SUBCLASSES = {
  '野蛮人': { level: 3, list: {
    '狂战士': { desc: '将狂暴化为纯粹的毁灭冲动。', feats: { 3: ['狂怒'], 6: ['无惧狂怒'], 10: ['凶蛮暴怒'], 14: ['狂暴之心'] } },
    '图腾战士': { desc: '以野兽之灵引导狂暴之力。', feats: { 3: ['图腾之灵'], 6: ['图腾方面'], 10: ['精神向导'], 14: ['图腾化身'] } },
    '世界树': { desc: '与连接万界的世界之树共鸣。', feats: { 3: ['世界树之缚'], 6: ['生机枝桠'], 10: ['巨树庇护'], 14: ['世界树化身'] } },
    '狂野魔法': { desc: '狂暴中涌动着不可控的原始魔法。', feats: { 3: ['狂野魔法激涌'], 6: ['狂野魔法护盾'], 10: ['狂暴魔法'], 14: ['狂野魔法化身'] } },
    '先祖守卫道途': { desc: '召引先祖精魂守护部落与盟友（珊娜萨的万事指南）。', feats: { 3: ['先祖护卫'], 6: ['精魂之盾（2d6）'], 10: ['问道精魂', '精魂之盾（3d6）'], 14: ['仇魂先祖', '精魂之盾（4d6）'] } },
    '风暴先驱道途': { desc: '将狂暴化为环绕自身的元素灵光（珊娜萨的万事指南）。', feats: { 3: ['风暴灵光'], 6: ['风暴之魂'], 10: ['风暴护体'], 14: ['狂如风暴'] } },
    '狂热者道途': { desc: '以神性狂热为信仰而战（珊娜萨的万事指南）。', feats: { 3: ['神性之怒', '神之勇者'], 6: ['专心炽志'], 10: ['狂热威仪'], 14: ['怒不畏死'] } },
    '野兽道途': { desc: '释放内心野兽之魂，狂暴中变形（塔莎的万事坩埚）。', feats: { 3: ['野兽之形'], 6: ['兽性之魂'], 10: ['狂怒之染'], 14: ['狩猎之唤'] } },
    '巨人道途': { desc: '从巨人与元素同族中汲取伟力（巨人之荣耀）。', feats: { 3: ['巨人之力', '巨人之灾'], 6: ['元素狂怒'], 10: ['伟力推动'], 14: ['创世巨像'] } },
    '战狂道途': { desc: '穿着钉刺甲横冲直撞的矮人战狂（剑湾冒险者指南，限定矮人）。', feats: { 3: ['战狂装甲'], 6: ['凶蛮无羁'], 10: ['战狂冲锋'], 14: ['钉刺反冲'] } }
  } },
  '吟游诗人': { level: 3, list: {
    '学识学院': { desc: '以博闻强识与秘传知识为武器。', feats: { 3: ['额外熟练', '博学'], 6: ['额外法术'], 14: ['窃取秘术'] } },
    '勇气学院': { desc: '以武勇与战歌激励同伴。', feats: { 3: ['军用武器熟练', '战斗激励'], 6: ['额外攻击'], 14: ['战斗怒号'] } },
    '剑舞学院': { desc: '将剑舞化作致命与优雅的艺术。', feats: { 3: ['剑刃华丽'], 6: ['额外攻击', '剑刃防御'], 14: ['大师剑舞'] } },
    '魅惑学院': { desc: '以迷幻之音魅惑人心。', feats: { 3: ['迷惑表演'], 6: ['惑控法术强化'], 14: ['支配演出'] } },
    '低语学院': { desc: '以秘密与心灵之刃从事阴谋（珊娜萨的万事指南）。', feats: { 3: ['心灵之刃', '惊骇之语'], 6: ['低语光环'], 14: ['阴暗学识'] } },
    '创造学院': { desc: '以造物之歌创造艺术与实体（塔莎的万事坩埚）。', feats: { 3: ['潜能微尘'], 6: ['表演'], 14: ['造物之歌'] } },
    '雄辩学院': { desc: '以雄辩与逻辑说服众生（塔莎的万事坩埚）。', feats: { 3: ['巧舌如簧', '扰神之词'], 6: ['不竭鼓舞', '统一言说'], 14: ['传染性激励'] } },
    '皓月学院': { desc: '从月井原初伟力中汲取灵感（被遗忘的国度：费伦英雄）。', feats: { 3: ['明月激励', '原初学识'], 6: ['月光祝福'], 14: ['暮色辉光'] } },
    '精魂学院': { desc: '召唤传说精魂通灵现世（范·里希腾的鸦阁魔域指南）。', feats: { 3: ['通灵师', '彼岸之魂'], 6: ['超能通灵'], 14: ['非凡联结'] } },
    '舞蹈学院': { desc: '以舞步谐频宇宙律动（玩家手册2024）。', feats: { 3: ['炫目舞步'], 6: ['鼓舞之移', '协同舞步'], 14: ['引导闪避'] } }
  } },
  '牧师': { level: 1, list: {
    '生命领域': { desc: '司掌治愈与生命之力。', feats: { 1: ['生命领域法术', '重甲熟练'], 2: ['引导神力：生命守护'], 6: ['祝福治愈'], 8: ['神圣打击'], 17: ['至善治愈'] } },
    '光领域': { desc: '以圣光灼烧黑暗。', feats: { 1: ['光领域法术', '闪光守护'], 2: ['引导神力：闪耀辉光'], 6: ['光之护盾'], 8: ['灼热辉光'], 17: ['光之化身'] } },
    '诡术领域': { desc: '以诡计与幻象侍奉神祇。', feats: { 1: ['诡术领域法术', '祝福诡计'], 2: ['引导神力：欺骗幻影'], 6: ['诡术护盾'], 8: ['神圣打击'], 17: ['诡术化身'] } },
    '战争领域': { desc: '以战争之神的名义征战。', feats: { 1: ['战争领域法术', '军用武器熟练'], 2: ['引导神力：战争之神'], 6: ['战争神恩'], 8: ['神圣打击'], 17: ['战争化身'] } },
    '锻造领域': { desc: '以火与锤锻造圣物与护甲（珊娜萨的万事指南）。', feats: { 1: ['领域法术', '额外熟练项', '锻造祝福'], 2: ['引导神力：铁匠祝福'], 6: ['锻造之魂'], 8: ['神圣打击（1d8）'], 14: ['神圣打击（2d8）'], 17: ['火与钢的圣徒'] } },
    '坟墓领域': { desc: '守护生死界限、引渡亡魂（珊娜萨的万事指南）。', feats: { 1: ['领域法术', '生死轮回', '坟墓之眼'], 2: ['引导神力：往墓之途'], 6: ['死之门的哨卫'], 8: ['强力施法'], 17: ['引魂明灯'] } },
    '和平领域': { desc: '以和平联结凝聚人心（塔莎的万事坩埚）。', feats: { 1: ['领域法术', '和平执行', '勇气联结'], 2: ['引导神力：和平抚慰'], 6: ['保护联结'], 8: ['强力施法'], 17: ['增强联结'] } },
    '暮光领域': { desc: '守护夜晚与安眠，驱散夜之恐怖（塔莎的万事坩埚）。', feats: { 1: ['领域法术', '附赠熟练项', '黑夜明目', '暮光祝福'], 2: ['引导神力：暮光圣域'], 6: ['暗影之步'], 8: ['神圣打击'], 17: ['暮光守护'] } },
    '秩序领域': { desc: '以律法与秩序号令众生（塔莎的万事坩埚）。', feats: { 1: ['领域法术', '附赠熟练项', '权威之音'], 2: ['引导神力：秩序敕令'], 6: ['秩序之怒'], 8: ['神圣打击'], 17: ['秩序狂潮'] } },
    '死亡领域': { desc: '司掌死亡与腐朽之力的反派领域（城主指南）。', feats: { 1: ['领域法术', '死神镰刀'], 2: ['引导神力：死亡之触'], 6: ['无尽毁灭'], 8: ['神圣打击'], 17: ['强化死神镰刀'] } },
    '奥秘领域': { desc: '以奥术知识侍奉神祇（剑湾冒险者指南）。', feats: { 1: ['领域法术', '奥术入门'], 2: ['引导神力：奥术弃绝'], 6: ['奥术引导'], 8: ['神圣打击'], 14: ['神圣打击（2d8）'], 17: ['奥秘掌控'] } }
  } },
  '德鲁伊': { level: 2, list: {
    '月亮结社': { desc: '与月亮之力共鸣，化身猛兽。', feats: { 2: ['战斗变身'], 6: ['月之形态'], 10: ['元素化身'], 14: ['月亮之力'] } },
    '大地结社': { desc: '与大地沃土相连的施法者。', feats: { 2: ['自然恢复', '结社法术'], 6: ['大地之力'], 10: ['大地卫士'], 14: ['自然之怒'] } },
    '海洋结社': { desc: '驾驭海洋的潮汐之力。', feats: { 2: ['潮汐之力'], 6: ['海洋形态'], 10: ['洋流掌控'], 14: ['海洋化身'] } },
    '星辰结社': { desc: '从星辰之辉中汲取预言之力。', feats: { 2: ['星图形态'], 6: ['星辰预兆'], 10: ['天体形态'], 14: ['星辰化身'] } },
    '梦境结社': { desc: '以梦境与精类之力守护旅者（珊娜萨的万事指南）。', feats: { 2: ['夏之王庭的芬馥'], 6: ['月光阴影的炉心'], 10: ['隐匿通途'], 14: ['梦境行者'] } },
    '牧人结社': { desc: '与自然精魂结盟守护兽群（珊娜萨的万事指南）。', feats: { 2: ['林地之语', '精魂图腾'], 6: ['全能牧者'], 10: ['精魂守卫'], 14: ['忠诚牧畜'] } },
    '野火结社': { desc: '与野火灵魄共生，焚旧育新（塔莎的万事坩埚）。', feats: { 2: ['结社法术', '召唤野火精魂'], 6: ['野火之步'], 10: ['灼烧之焰'], 14: ['炽烈回生'] } }
  } },
  '战士': { level: 3, list: {
    '冠军': { desc: '以纯粹的武技追求极限。', feats: { 3: ['精通重击'], 7: ['技巧加值'], 10: ['额外战斗风格'], 15: ['超人重击'], 18: ['生存本能'] } },
    '战斗大师': { desc: '精通战术与战技的战场大师。', feats: { 3: ['战技', '战技骰'], 7: ['战术知性'], 10: ['额外战技'], 15: ['战技骰强化'], 18: ['战技大师'] } },
    '魔法骑士': { desc: '以魔法强化武艺的战士。', feats: { 3: ['施法', '武器羁绊'], 7: ['战争魔法'], 10: ['额外施法'], 15: ['奥术打击'], 18: ['高等施法'] } },
    '灵能武士': { desc: '以念动力为武器的灵能战士。', feats: { 3: ['灵能打击', '灵能护盾'], 7: ['灵能冲刺'], 10: ['念力掌握'], 15: ['灵能子弹'], 18: ['念动力大师'] } },
    '魔射手': { desc: '以奥术箭矢射穿敌人的秘射大师（珊娜萨的万事指南）。', feats: { 3: ['魔箭学识', '奥术射击（2种）'], 7: ['注魔箭矢', '曲线射击', '奥术射击（3种）'], 10: ['奥术射击（4种）'], 15: ['有箭无患', '奥术射击（5种）'], 18: ['奥术射击（6种）', '强化射击'] } },
    '骑兵': { desc: '驰骋沙场守护战友的骑士（珊娜萨的万事指南）。', feats: { 3: ['附赠熟练项', '生而为骑', '坚定之印'], 7: ['守护战技'], 10: ['坚守战线'], 15: ['冲锋陷阵'], 18: ['警戒守卫'] } },
    '武士': { desc: '秉持武士道的东方剑豪（珊娜萨的万事指南）。', feats: { 3: ['附赠熟练项', '战意'], 7: ['雅臣'], 10: ['不懈'], 15: ['燕返'], 18: ['生死流转'] } },
    '回音骑士': { desc: '召引平行时空的自身回音协同作战（荒洲探险家指南）。', feats: { 3: ['回音显现', '释放化身'], 7: ['回音现身'], 10: ['影之殉难'], 15: ['回收潜能'], 18: ['一人成军'] } },
    '紫龙骑士/旗将': { desc: '以表率激励盟友的科米尔骑士（剑湾冒险者指南）。', feats: { 3: ['重整姿态'], 7: ['皇家特使'], 10: ['激励冲锋'], 15: ['壁垒'] } },
    '符文骑士': { desc: '铭刻巨人符文强化己身（塔莎的万事坩埚）。', feats: { 3: ['额外熟练项', '符文雕刻者', '巨人之力'], 7: ['符文之盾'], 10: ['奇伟身躯'], 15: ['符文大师'], 18: ['符文主宰'] } }
  } },
  '武僧': { level: 3, list: {
    '暗影之道': { desc: '隐于暗影，以气施展影之技艺。', feats: { 3: ['暗影术'], 6: ['暗影步'], 11: ['暗影分身'], 17: ['暗影大师'] } },
    '四象之道': { desc: '以气引动元素之力。', feats: { 3: ['元素术', '元素调谐'], 6: ['元素吐息'], 11: ['元素爆裂'], 17: ['元素化身'] } },
    '剑圣之道': { desc: '以武僧武器为剑道核心。', feats: { 3: ['武器之道'], 6: ['剑圣专注'], 11: ['剑圣斩'], 17: ['剑圣大师'] } },
    '醉拳之道': { desc: '以出人意料的诡变身法战斗。', feats: { 3: ['醉拳技法'], 6: ['醉酒规避'], 11: ['醉拳反击'], 17: ['醉拳大师'] } },
    '剑圣宗': { desc: '以武僧武器为剑道核心（珊娜萨的万事指南）。', feats: { 3: ['剑圣之途（2把武器）'], 6: ['人剑合一', '剑圣之途（3把武器）'], 11: ['锋锐剑影', '剑圣之途（4把武器）'], 17: ['精妙剑法', '剑圣之途（5把武器）'] } },
    '日魂宗': { desc: '以太阳之力灼烧黑暗（珊娜萨的万事指南）。', feats: { 3: ['耀阳箭'], 6: ['热能袭'], 11: ['焰阳爆'], 17: ['太阳盾'] } },
    '醉拳宗': { desc: '以醉态乱拳克敌制胜（珊娜萨的万事指南）。', feats: { 3: ['附赠熟练项', '醉拳技巧'], 6: ['微醺摇摆'], 11: ['醉汉机运'], 17: ['酣醉若狂'] } },
    '命流宗': { desc: '操纵生命能量予生予死（塔莎的万事坩埚）。', feats: { 3: ['命流之器', '予命之手', '夺命之手'], 6: ['医者之道'], 11: ['治愈与伤害的疾风'], 17: ['命极之手'] } },
    '星我宗': { desc: '以星我形态展现真实自我（塔莎的万事坩埚）。', feats: { 3: ['星我之臂'], 6: ['星我之容'], 11: ['觉醒星我'], 17: ['完满星我'] } },
    '神龙宗': { desc: '模仿巨龙之姿，与龙之力共鸣（费资本的巨龙宝库）。', feats: { 3: ['龙之徒', '龙之息'], 6: ['龙翼翱翔'], 11: ['古龙姿'], 17: ['神龙身'] } },
    '永亡宗': { desc: '迷醉于死亡结构，以死亡技艺战斗（剑湾冒险者指南）。', feats: { 3: ['往生咒'], 6: ['索命镰'], 11: ['握生死'], 17: ['永亡触'] } }
  } },
  '圣武士': { level: 3, list: {
    '奉献之誓': { desc: '恪守圣洁信条的守护者。', feats: { 3: ['誓约法术', '引导神力：神圣武器'], 7: ['光环：奉献'], 15: ['圣洁化身'], 20: ['神圣化身'] } },
    '古贤之誓': { desc: '守护自然与光明的古老誓约。', feats: { 3: ['誓约法术', '引导神力：自然之怒'], 7: ['光环：守护'], 15: ['古贤化身'], 20: ['自然化身'] } },
    '复仇之誓': { desc: '以无情追猎惩戒邪恶。', feats: { 3: ['誓约法术', '引导神力：复仇誓言'], 7: ['光环：复仇'], 15: ['复仇化身'], 20: ['复仇之魂'] } },
    '征服之誓': { desc: '以铁腕威压震慑敌人。', feats: { 3: ['誓约法术', '引导神力：征服威慑'], 7: ['光环：征服'], 15: ['征服化身'], 20: ['征服之王'] } },
    '救赎之誓': { desc: '以和平与宽恕引导邪恶走向救赎（珊娜萨的万事指南）。', feats: { 3: ['誓约法术', '引导神力：和平使节/斥喝暴力'], 7: ['光环：护卫'], 15: ['守护之魂'], 20: ['救赎使节'] } },
    '王冠之誓': { desc: '效忠文明律法与君王的守护骑士（剑湾冒险者指南）。', feats: { 3: ['誓约法术', '引导神力：捍卫挑战/扭转局势'], 7: ['神圣誓忠'], 15: ['顽强精神'], 20: ['崇高卫士'] } },
    '守望之誓': { desc: '守护凡人国度免受异界威胁（塔莎的万事坩埚）。', feats: { 3: ['誓约法术', '引导神力：守望之志/驱散异域'], 7: ['光环：哨卫'], 15: ['警戒呵斥'], 20: ['尘世壁垒'] } },
    '荣耀之誓': { desc: '以英勇功绩追求不朽传奇（塔莎的万事坩埚）。', feats: { 3: ['誓约法术', '引导神力：绝伦健将/鼓舞一击'], 7: ['光环：迅捷'], 15: ['辉煌防御'], 20: ['现世传说'] } },
    '破誓者': { desc: '背弃神圣誓言、投身黑暗的堕落圣武士（城主指南）。', feats: { 3: ['破誓者法术', '引导神力：控制亡灵/恐怖显现'], 7: ['光环：憎恨'], 15: ['超然抗性'], 20: ['恐惧之王'] } },
    '巨灵贵族之誓': { desc: '驾驭元素巨灵流光之力的圣武士（被遗忘的国度：费伦英雄）。', feats: { 3: ['元素斩', '巨灵法术', '巨灵流光'], 7: ['元素守御灵光'], 15: ['元素叱喝'], 20: ['巨灵贵胄'] } }
  } },
  '游侠': { level: 3, list: {
    '猎人': { desc: '精通猎杀技巧的追踪者。', feats: { 3: ['猎手祭仪'], 7: ['猎手防御'], 11: ['多重攻击'], 15: ['夺命猎手'] } },
    '野兽大师': { desc: '与野兽伙伴并肩作战。', feats: { 3: ['野兽伙伴'], 7: ['伙伴强化'], 11: ['心灵相通'], 15: ['伙伴化身'] } },
    '放逐者': { desc: '与精类荒野共鸣的神秘游侠。', feats: { 3: ['精类荒野术'], 7: ['精类神行'], 11: ['迷雾之步'], 15: ['精类化身'] } },
    '幽暗行者': { desc: '在黑暗中行动的潜行者。', feats: { 3: ['暗影法术'], 7: ['幽暗步伐'], 11: ['恐惧打击'], 15: ['暗影化身'] } },
    '怪物杀手': { desc: '专职猎杀怪物的游侠（珊娜萨的万事指南）。', feats: { 3: ['怪物杀手魔法', '猎手感知', '狩猎开始'], 7: ['卓越防守'], 11: ['魔法使的克星'], 15: ['杀手反制'] } },
    '集群牧者': { desc: '与无形精魂集群形影不离（塔莎的万事坩埚）。', feats: { 3: ['蜂聚集群', '集群牧者魔法'], 7: ['汹涌之潮'], 11: ['壮大集群'], 15: ['集群溃散'] } },
    '妖精漫游者': { desc: '受妖精荒原祝福的漫游者（塔莎的万事坩埚）。', feats: { 3: ['妖精漫游者魔法', '可怖打击'], 7: ['精宸所与'], 11: ['迷魅扭转'], 15: ['迷雾漫游者'] } },
    '凛冬行者': { desc: '在极北荒原磨砺的冷酷猎手（被遗忘的国度：费伦英雄）。', feats: { 3: ['冻原探索者', '冬猎霜寒', '凛冬行者法术'], 7: ['凝冻之魂'], 11: ['寒心复仇'], 15: ['冰结恶灵'] } },
    '龙兽守卫': { desc: '与龙族精魄化身的龙兽缔结联结（费资本的巨龙宝库）。', feats: { 3: ['龙族赠礼', '龙兽伙伴'], 7: ['龙鳞祝福'], 11: ['龙兽吐息'], 15: ['完美联结'] } },
    '幽邃戍卫': { desc: '敬奉古老恐怖、化身怪异护卫（鸦阁魔域：魔障深藏）。', feats: { 3: ['幽邃戍卫魔法', '荒野之怒'], 7: ['渴血予力'], 11: ['枯朽残虐'], 15: ['亘古凶威'] } },
    '边界行者': { desc: '守护位面边境、穿梭传送门的位面行者（珊娜萨的万事指南）。', feats: { 3: ['边界行者魔法', '侦测传送门', '位面战士（1d8）'], 7: ['以太漫步'], 11: ['闪现打击', '位面战士（2d8）'], 15: ['灵体防御'] } },
    '幽域追猎者': { desc: '在黑暗中伏击猎物的暗影猎手（珊娜萨的万事指南）。', feats: { 3: ['幽域追猎者魔法', '恐惧伏击', '阴影视野'], 7: ['钢铁意志'], 11: ['追猎如风'], 15: ['如影随行'] } }
  } },
  '魔契师': { level: 1, list: {
    '邪魔': { desc: '与深渊恶魔缔结契约。', feats: { 1: ['邪魔祝福'], 6: ['黑暗幸运'], 10: ['邪魔韧性'], 14: ['邪魔遁逃'] } },
    '旧日支配者': { desc: '与不可名状的古老存在相连。', feats: { 1: ['觉醒之智'], 6: ['留存防御'], 10: ['思绪防护'], 14: ['创造化身'] } },
    '魅惑魔宠': { desc: '与精类领主订立契约。', feats: { 1: ['精类存在'], 6: ['迷雾步'], 10: ['精类卫士'], 14: ['幽影精类'] } },
    '天界': { desc: '与天界存在缔结神圣契约。', feats: { 1: ['天界之光'], 6: ['光辉复原'], 10: ['天界坚韧'], 14: ['天界化身'] } },
    '咒剑': { desc: '与有意识兵刃缔结契约的剑士（珊娜萨的万事指南）。', feats: { 1: ['扩展法术列表', '咒剑诅咒', '巫咒战士'], 6: ['咒缚恶灵'], 10: ['巫咒盔甲'], 14: ['巫咒大师'] } },
    '巨灵': { desc: '与元素位面巨灵贵族缔约（塔莎的万事坩埚）。', feats: { 1: ['扩展法术列表', '巨灵器皿'], 6: ['元素赐福'], 10: ['器皿庇护所'], 14: ['有限祈愿'] } },
    '深海意志': { desc: '与深渊海域的存在缔约（塔莎的万事坩埚）。', feats: { 1: ['扩展法术列表', '深海触手', '海洋馈赠'], 6: ['海渊魂灵', '守卫缠绕'], 10: ['擒握触手'], 14: ['深海下潜'] } },
    '不朽者': { desc: '与窥破永生秘密的宗主缔约（剑湾冒险者指南）。', feats: { 1: ['历经死亡'], 6: ['反抗死亡'], 10: ['不朽之理'], 14: ['不朽生命'] } },
    '死灵宗主': { desc: '与蔑视生死轮回的不死存在缔约（鸦阁魔域：魔障深藏）。', feats: { 3: ['死灵法术', '战栗形态'], 6: ['坟冢之触'], 10: ['死疽躯壳'], 14: ['超凡战栗'] } }
  } },
  '法师': { level: 2, list: {
    '防护学派': { desc: '精研防护魔法的学派。', feats: { 2: ['奥术护盾'], 6: ['防护印记'], 10: ['法术护盾'], 14: ['防护掌控'] } },
    '咒法学派': { desc: '精研召唤与传送的学派。', feats: { 2: ['次元印记'], 6: ['咒法传送'], 10: ['召唤亲和'], 14: ['咒法掌控'] } },
    '预言学派': { desc: '精研洞悉未来的学派。', feats: { 2: ['洞悉预兆'], 6: ['先知视界'], 10: ['命运预知'], 14: ['预言掌控'] } },
    '附魔学派': { desc: '精研惑控心灵的学派。', feats: { 2: ['附魔低语'], 6: ['催眠凝视'], 10: ['分神凝视'], 14: ['附魔掌控'] } },
    '塑能学派': { desc: '精研元素能量的学派。', feats: { 2: ['塑能超魔'], 6: ['法术塑形'], 10: ['能量强化'], 14: ['塑能掌控'] } },
    '幻术学派': { desc: '精研创造幻象的学派。', feats: { 2: ['幻术造物'], 6: ['幻影闪现'], 10: ['幻象深化'], 14: ['幻术掌控'] } },
    '死灵学派': { desc: '精研生死之力的学派。', feats: { 2: ['死者低语'], 6: ['死亡守卫'], 10: ['亡灵亲和'], 14: ['死灵掌控'] } },
    '变化学派': { desc: '精研改变现实的学派。', feats: { 2: ['变化改造'], 6: ['变形大师'], 10: ['形状变化'], 14: ['变化掌控'] } },
    '战争魔法': { desc: '以奥术偏斜强化战斗的魔法（珊娜萨的万事指南）。', feats: { 2: ['奥术偏斜', '战术之智'], 6: ['魔力潮涌'], 10: ['耐久魔法'], 14: ['偏斜罩幕'] } },
    '剑咏': { desc: '剑舞与奥法结合的精灵传承（塔莎的万事坩埚）。', feats: { 2: ['战歌训练', '剑歌'], 6: ['额外攻击', '守御之歌'], 10: ['胜利之歌'], 14: ['剑咏大师'] } },
    '书士会': { desc: '唤醒法术书之灵的书之魔法（塔莎的万事坩埚）。', feats: { 2: ['法师之笔', '觉醒魔典'], 6: ['显现意识'], 10: ['抄录大师'], 14: ['与言合一'] } },
    '时间魔法': { desc: '操纵时间流动的秘迹传承（荒洲探险家指南）。', feats: { 2: ['时间变幻', '时序感知'], 6: ['瞬时静止'], 10: ['奥法暂滞'], 14: ['汇聚未来'] } },
    '重力魔法': { desc: '操纵重力扭曲的秘迹传承（荒洲探险家指南）。', feats: { 2: ['调节密度'], 6: ['重力井'], 10: ['狂暴牵引'], 14: ['事件视界'] } }
  } },
  '游荡者': { level: 3, list: {
    '刺客': { desc: '擅长潜行与致命一击的暗杀者。', feats: { 3: ['暗杀'], 9: ['伪装精通'], 13: ['渗透大师'], 17: ['死亡一击'] } },
    '诡术师': { desc: '以魔法强化偷窃技艺的施法游荡者。', feats: { 3: ['施法', '魔影之手'], 9: ['魔法隐匿'], 13: ['隐匿施法'], 17: ['法术大师'] } },
    '魂刃': { desc: '以心灵之刃战斗的灵能游荡者。', feats: { 3: ['心灵之刃'], 9: ['心灵诡计'], 13: ['心灵分离'], 17: ['心灵大师'] } },
    '侦探': { desc: '擅长洞察真相的调查者。', feats: { 3: ['敏锐观察'], 9: ['灵光探知'], 13: ['洞察弱点'], 17: ['真相洞察'] } },
    '策士': { desc: '以战术谋划运筹帷幄（珊娜萨的万事指南）。', feats: { 3: ['谋陷大师', '战术大师'], 9: ['帷幄之士'], 13: ['误导'], 17: ['瞒天之魂'] } },
    '斥候': { desc: '游击侦查的荒野专家（珊娜萨的万事指南）。', feats: { 3: ['散兵战术', '生存专家'], 9: ['优异灵活'], 13: ['伏击大师'], 17: ['瞬息打击'] } },
    '风流剑客': { desc: '以潇洒剑术与魅力周旋（珊娜萨的万事指南）。', feats: { 3: ['梦幻舞步', '潇洒无畏'], 9: ['潇洒气质'], 13: ['优雅战技'], 17: ['决斗大师'] } },
    '鬼魅': { desc: '与死亡结缘、窃取亡者知识的幽灵（塔莎的万事坩埚）。', feats: { 3: ['亡者余声', '墓穴惊嚎'], 9: ['逝者遗物'], 13: ['幽灵行走'], 17: ['死亡之友'] } },
    '三神门徒': { desc: '侍奉死亡三神的暗影信徒（被遗忘的国度：费伦英雄）。', feats: { 3: ['嗜血', '敬怖之忠'], 9: ['袭杀恐惧'], 13: ['恶毒灵光'], 17: ['恐怖化身'] } },
    '调查员': { desc: '精于揭穿谎言、侦破谜团的侦探型游荡者（珊娜萨的万事指南）。', feats: { 3: ['辨谎之耳', '鉴别之眼', '战术洞悉'], 9: ['目不转睛'], 13: ['明察秋毫'], 17: ['伺隙锐瞳'] } }
  } },
  '术士': { level: 1, list: {
    '龙族血脉': { desc: '体内流淌着巨龙血脉。', feats: { 1: ['龙族韧性', '龙族语言'], 6: ['龙族之翼'], 14: ['龙威'], 18: ['龙族化身'] } },
    '狂野术法': { desc: '源自混沌魔法的狂野之力。', feats: { 1: ['狂野魔法浪涌'], 6: ['击碎命运'], 14: ['失控魔法'], 18: ['狂野化身'] } },
    '神契术士': { desc: '与秩序之力的奇妙契约。', feats: { 1: ['秩序护盾'], 6: ['平静失调'], 14: ['紊乱护盾'], 18: ['机械化身'] } },
    '灵光术士': { desc: '来自异界灵光的奇异力量。', feats: { 1: ['心灵低语'], 6: ['灵光之力'], 14: ['心灵解放'], 18: ['灵光化身'] } },
    '风暴术法': { desc: '体内涌动着风暴之力的血脉（珊娜萨的万事指南）。', feats: { 1: ['风语者', '风暴魔法'], 6: ['风暴之心', '风暴导向'], 14: ['暴风狂怒'], 18: ['清风之灵'] } },
    '幽影魔法': { desc: '与暗影相融、从死亡边缘汲取力量（珊娜萨的万事指南）。', feats: { 1: ['幽暗之瞳', '终焉之力'], 3: ['幽暗之瞳（黑暗术）'], 6: ['凶兆猎犬'], 14: ['幽影漫步'], 18: ['幽暗之形'] } },
    '畸变心智': { desc: '与异界心灵相连的怪异血脉（塔莎的万事坩埚）。', feats: { 1: ['畸变心智法术', '心灵感应'], 6: ['心灵防御'], 14: ['血肉启示'], 18: ['扭曲坍缩'] } },
    '时械之魂': { desc: '与机械境秩序之力共鸣（塔莎的万事坩埚）。', feats: { 1: ['时械法术', '恢复平衡'], 6: ['律法壁垒'], 14: ['秩序出神'], 18: ['时械洪流'] } },
    '咒火术法': { desc: '掌控魔网本源咒火的稀世天赋（被遗忘的国度：费伦英雄）。', feats: { 3: ['咒火迸发', '咒火法术'], 6: ['汲纳法术'], 14: ['砥砺咒火'], 18: ['咒火冠冕'] } },
    '月之术法': { desc: '随月相盈亏变化的术法（龙枪：龙后之影）。', feats: { 1: ['月之化身', '月火'], 6: ['月之恩泽'], 14: ['月之赋能'], 18: ['月之异象'] } },
    '神圣之魂': { desc: '灵魂中闪耀神圣火花的天生施法者（珊娜萨的万事指南）。', feats: { 1: ['神圣魔法', '众神眷恩'], 6: ['强效治疗'], 14: ['异界光翼'], 18: ['神赐痊愈'] } }
  } },
  '奇械师': { level: 3, list: {
    '炼金师': { desc: '以炼金术调配灵药与魔法物质（塔莎的万事坩埚）。', feats: { 3: ['工具精通', '炼金师法术', '实验性灵药'], 5: ['炼金术掌握'], 9: ['复原药剂'], 15: ['化学专家'] } },
    '魔炮师': { desc: '制造魔法炮台与奥法枪械的炮术专家（塔莎的万事坩埚）。', feats: { 3: ['工具精通', '魔炮师法术', '魔能炮台'], 5: ['奥法枪械'], 9: ['高爆炮台'], 15: ['要塞阵地'] } },
    '战地匠师': { desc: '以钢铁守卫协同作战的工匠战士（塔莎的万事坩埚）。', feats: { 3: ['工具精通', '战地匠师法术', '战斗准备', '钢铁守卫'], 5: ['额外攻击'], 9: ['奥能震荡'], 15: ['改良守卫'] } },
    '装甲师': { desc: '以奥能装甲定制型号的装甲专家（塔莎的万事坩埚）。', feats: { 3: ['本职工具', '装甲师法术', '奥能装甲', '装甲型号'], 5: ['额外攻击'], 9: ['装甲改造'], 15: ['完美装甲'] } },
    '苏生师': { desc: '以骇人实验再造亡者的阴森奇械师（鸦阁魔域：魔障深藏）。', feats: { 3: ['苏生师法术', '苏生师技艺', '苏生伴兵'], 5: ['怪异改造'], 9: ['强化苏生', '骇惧改造'], 15: ['精纯苏生'] } }
  } }
};

// 获取职业某等级应获得的特性名列表（'副职'/'副职特性' 占位由调用方处理）
function classFeaturesAt(cls, level) {
  var lv = Number(level) || 1;
  var tbl = CLASS_FEATURES_BY_LEVEL[cls];
  if (!tbl || !tbl[lv]) return [];
  return tbl[lv].filter(function (n) { return n && n !== '属性提升' && n !== '专长' && n !== '副职' && n !== '副职特性'; });
}
// 该职业在指定等级是否应选副职（返回 { level, list } 或 null）
function subclassPickAt(cls, level) {
  var sc = SUBCLASSES[cls];
  if (!sc) return null;
  var lv = Number(level) || 1;
  // 副职等级：职业表该级含 '副职'
  var tbl = CLASS_FEATURES_BY_LEVEL[cls];
  if (tbl && tbl[lv] && tbl[lv].indexOf('副职') >= 0) return sc;
  return null;
}
// 副职特性来源标记
function subclassFeatName(subName, feat) { return subName + '·' + feat; }




var CLASS_FEATURE_DESC = { "野蛮人·狂暴": "你可以将名为狂暴的原初之力赋予己身，为你带来超越常规的伟力和韧性。未着装重甲时，你能够以一个附赠动作进入狂暴。 你可以进入狂暴的次数见野蛮人特性表中狂暴一栏。当你完成一次 短休 时，你重获一次已消耗的使用次数；当你完成一次 长休 时，你重获所有已消耗的使用次数。 狂暴激活期间，你将遵循以下这些规则： 伤害抗性Damage Resistance。 你具有钝击、穿刺、挥砍伤害的抗性。 狂暴伤害Rage Damage。 当你使用力量发动一次攻击（无论这是一次武器攻击还是一次徒手打击）并对目标造成伤害时，你的伤害掷骰获得额外加值，这个加值随着你的野蛮人等级提升，见野蛮人特性表中狂暴伤害一栏。 力量优势Strength Advantage。 你的力量检定和力量豁免检定具有 优势 。 无法专注或施法No Concentration or Spells。 你无法保持 专注 ，也不能施展法术。 持续时间Duration。 狂暴持续至你的下个回合结束，如果你穿戴重甲或陷入 失能 状态，狂暴提前结束。如果在你的下一回合狂暴仍处于激活状态，你可以通过以下的任一方式令狂暴延长一轮： 对一名敌人进行一次攻击检定。 迫使一名敌人进行一次豁免检定。 以一个附赠动作延长你的狂暴。 每当狂暴被延长，都会持续至你的下个回合结束。你至多可以维持狂暴10分钟。", "狂暴": "你可以将名为狂暴的原初之力赋予己身，为你带来超越常规的伟力和韧性。未着装重甲时，你能够以一个附赠动作进入狂暴。 你可以进入狂暴的次数见野蛮人特性表中狂暴一栏。当你完成一次 短休 时，你重获一次已消耗的使用次数；当你完成一次 长休 时，你重获所有已消耗的使用次数。 狂暴激活期间，你将遵循以下这些规则： 伤害抗性Damage Resistance。 你具有钝击、穿刺、挥砍伤害的抗性。 狂暴伤害Rage Damage。 当你使用力量发动一次攻击（无论这是一次武器攻击还是一次徒手打击）并对目标造成伤害时，你的伤害掷骰获得额外加值，这个加值随着你的野蛮人等级提升，见野蛮人特性表中狂暴伤害一栏。 力量优势Strength Advantage。 你的力量检定和力量豁免检定具有 优势 。 无法专注或施法No Concentration or Spells。 你无法保持 专注 ，也不能施展法术。 持续时间Duration。 狂暴持续至你的下个回合结束，如果你穿戴重甲或陷入 失能 状态，狂暴提前结束。如果在你的下一回合狂暴仍处于激活状态，你可以通过以下的任一方式令狂暴延长一轮： 对一名敌人进行一次攻击检定。 迫使一名敌人进行一次豁免检定。 以一个附赠动作延长你的狂暴。 每当狂暴被延长，都会持续至你的下个回合结束。你至多可以维持狂暴10分钟。", "野蛮人·无甲防御": "若你未着装任何护甲，你的基础 护甲等级 等于10+你的敏捷调整值+你的体质调整值。你可以使用盾牌并仍从此特性获益。", "野蛮人·武器精通": "你对武器的训练使你能够运用两种自选的简易或军用近战武器的精通词条，例如巨斧和手斧。每当你完成一次 长休 时，你可以重新演练武器技巧，来改变你所选择的其中一个武器类型。 当你到达特定的野蛮人等级时，你还可以使用更多种类武器的精通词条，详见野蛮人特性表中武器精通一栏。", "吟游诗人·吟游诗人激励": "你可以用语言，音乐或舞蹈的形式对他人进行超自然的激励。这种激励的表现形式为数颗D6骰，这些骰子被称为诗人激励骰。 使用诗人激励Using Bardic Inspriration。 以一个附赠动作，你可以激励位于你60尺内的另一名能听见或看见你的生物。那名生物获得一枚你的诗人激励骰。一个生物同一时间只能拥有一枚诗人激励骰。在接下来的1小时内，当那名生物在一次 D20检定 中失败时，那名生物可以投掷诗人激励骰并将掷骰结果附加到该次d20中，这可能将失败变为成功。诗人激励骰将在投掷时已消耗。 使用次数Number of Uses。 你可以授予诗人激励骰的次数等于你的魅力调整值（最少1次），当你完成 长休 时，你重获所有已消耗的使用次数。 更高等级At Higher Levels。 你的诗人激励骰会在你到达特定吟游诗人等级时改变，如吟游诗人特性表中的诗人骰所示。你的诗人骰会在5级时变为d8，在10级时变为d10，在15级时变为d12。 吟游诗人的曲目 A Bard's Repertoire 你扮演的吟游诗人在吟诵古代英雄壮举时敲鼓相伴吗？他是拨动鲁特琴伴着低唱浪漫的旋律？还是演绎激昂的咏叹调？是朗诵经典悲剧中最震撼人心的独白？还是说他会在战斗中以民俗舞蹈的节奏协调战友的移动？又或者他会创作俏皮的打油诗？ 当你扮演吟游诗人时，你需要考虑你钟意的艺术表演风格、你可能唤起的情绪以及能激发你创作灵感的主题。你的诗歌被大自然的美好瞬间启发，亦或是对伤感失去的不散回想？你更偏好恢弘盛大的赞美诗，还是闹腾喧嚣的酒馆小曲儿？你是被逝者的哀悼还是庆祝时的喜悦所吸引？你跳起的是欢快的快步舞曲又或者是你精心编排、充满深意的舞步？你是专注于其中之一，还是以掌握所有风格为目标努力？", "吟游诗人激励": "你可以用语言，音乐或舞蹈的形式对他人进行超自然的激励。这种激励的表现形式为数颗D6骰，这些骰子被称为诗人激励骰。 使用诗人激励Using Bardic Inspriration。 以一个附赠动作，你可以激励位于你60尺内的另一名能听见或看见你的生物。那名生物获得一枚你的诗人激励骰。一个生物同一时间只能拥有一枚诗人激励骰。在接下来的1小时内，当那名生物在一次 D20检定 中失败时，那名生物可以投掷诗人激励骰并将掷骰结果附加到该次d20中，这可能将失败变为成功。诗人激励骰将在投掷时已消耗。 使用次数Number of Uses。 你可以授予诗人激励骰的次数等于你的魅力调整值（最少1次），当你完成 长休 时，你重获所有已消耗的使用次数。 更高等级At Higher Levels。 你的诗人激励骰会在你到达特定吟游诗人等级时改变，如吟游诗人特性表中的诗人骰所示。你的诗人骰会在5级时变为d8，在10级时变为d10，在15级时变为d12。 吟游诗人的曲目 A Bard's Repertoire 你扮演的吟游诗人在吟诵古代英雄壮举时敲鼓相伴吗？他是拨动鲁特琴伴着低唱浪漫的旋律？还是演绎激昂的咏叹调？是朗诵经典悲剧中最震撼人心的独白？还是说他会在战斗中以民俗舞蹈的节奏协调战友的移动？又或者他会创作俏皮的打油诗？ 当你扮演吟游诗人时，你需要考虑你钟意的艺术表演风格、你可能唤起的情绪以及能激发你创作灵感的主题。你的诗歌被大自然的美好瞬间启发，亦或是对伤感失去的不散回想？你更偏好恢弘盛大的赞美诗，还是闹腾喧嚣的酒馆小曲儿？你是被逝者的哀悼还是庆祝时的喜悦所吸引？你跳起的是欢快的快步舞曲又或者是你精心编排、充满深意的舞步？你是专注于其中之一，还是以掌握所有风格为目标努力？", "吟游诗人·施法": "Spellcasting 你从吟游艺术中学会了如何施展法术。施法规则见第七章。下文将详述如何将这些规则应用于吟游诗人法术，吟游诗人法术详见本章后文职业描述中的吟游诗人法术列表。 戏法Cantrips。 你知晓两道你选择的吟游诗人戏法。推荐选择 舞光术Dancing Light 和 恶言相加Vicious Mockery 。 每当你获得一个吟游诗人等级时，你都能从你的戏法*中选择其一替换为另一道你所选择的吟游诗人戏法。 当你的吟游诗人等级到达4级和10级时，你都能另选一道吟游诗人戏法并习得，如吟游诗人特性表中戏法一列所示。 *译注：原文无关于法术来源的描述，是否可以替换其他方式学到的戏法有待设计师确认，考虑到法师写法，疑似可以替换其他来源的戏法 法术位Spell Slots。 吟游诗人特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成 长休 时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择四道吟游诗人法术。推荐选择 魅惑类人Charm person ， 七彩喷射Color Spray ， 不谐低语Dissonant Whispers 和 治愈真言Healing Word 。 已准备法术数量会随你吟游诗人等级的提升而增加，如吟游诗人特性表中的准备法术一列所示。每当这一列的数字增加时，从吟游诗人法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级吟游诗人，则你的准备法术列表能包括六道一环或二环的吟游诗人法术，随意组合。 如果吟游诗人的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为吟游诗人法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个吟游诗人等级时，你就可以将你准备列表上的一道法术替换为另一道吟游诗人法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你吟游诗人法术的施法属性是 魅力 。 施法法器 Spellcasting Focus。 你可以使用 乐器 作为你吟游诗人法术的 施法法器 。", "牧师·施法": "你通过祈祷，冥想与奉献习得如何施法。施法规则见第七章。下文将详述如何将这些规则应用于牧师法术，牧师法术详见本章后文职业描述中的牧师法术列表。 戏法Cantrips。 你知晓三道你选择的牧师戏法。推荐选择 神导术Guidance ， 圣火术Sacred Flame 和 奇术Thaumaturgy 。 每当你获得一个牧师等级时，你都能从你的戏法中选择其一替换为另一道你所选择的牧师戏法。 当你的牧师等级到达4级和10级时，你都能另选一道牧师戏法并习得，如牧师特性表中戏法一列所示。 法术位Spell Slots。 牧师特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择四道牧师法术。推荐选择 祝福术Bless ， 疗伤术Cure Wounds ， 光导箭Guiding Bolt 和 虔诚护盾Shield of Faith 。 已准备法术数量会随你牧师等级的提升而增加，如牧师特性表中的准备法术一列所示。每当这一列的数字增加时，从牧师法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级牧师，则你的准备法术列表能包括六道一环或二环的牧师法术，随意组合。 如果牧师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为牧师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道或更多法术替换为其他牧师法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你牧师法术的施法属性是感知。 施法法器 Spellcasting Focus。 你可以使用圣徽作为你牧师法术的施法法器 。", "牧师·圣职": "Divine Order 你让自己投身于以下一种由你自己选择的神圣职能： 保护者Protcetor。 为战斗做足训练，你获得军用武器熟练与重甲受训。 奇术使Thaumaturage。 你从牧师法术列表中额外学会一道戏法。此外，你与神性的神秘链接使你在智力（奥秘和宗教）检定中获得加值。加值等于你的感知调整值（至少加1）。", "圣职": "Divine Order 你让自己投身于以下一种由你自己选择的神圣职能： 保护者Protcetor。 为战斗做足训练，你获得军用武器熟练与重甲受训。 奇术使Thaumaturage。 你从牧师法术列表中额外学会一道戏法。此外，你与神性的神秘链接使你在智力（奥秘和宗教）检定中获得加值。加值等于你的感知调整值（至少加1）。", "德鲁伊·德鲁伊语": "你学会了德鲁伊语，一门德鲁伊之间的秘密语言。在学会这门古老语言的同时，你也解锁了和动物交谈的魔法：你始终准备着法术 动物交谈Speak With Animals 。 你可以使用德鲁伊语来传递隐藏的信息。你和其他知晓这门语言的对象能够自动辨认出信息。其他人需要通过DC15的智力（调查）检定才能意识到信息的存在，但不借助魔法则无法解读。", "德鲁伊语": "你学会了德鲁伊语，一门德鲁伊之间的秘密语言。在学会这门古老语言的同时，你也解锁了和动物交谈的魔法：你始终准备着法术 动物交谈Speak With Animals 。 你可以使用德鲁伊语来传递隐藏的信息。你和其他知晓这门语言的对象能够自动辨认出信息。其他人需要通过DC15的智力（调查）检定才能意识到信息的存在，但不借助魔法则无法解读。", "德鲁伊·原初职能": "你将自己投身于所选择的以下一项神圣的角色之中： 术师Magician。 你从德鲁伊法术列表中额外学会一道戏法。此外，你与自然的神秘连接让你在智力（奥秘和自然）检定上获得加值。加值等于你的感知调整值（最低+1）。 卫士Warden。 你为战斗做足训练，你获得军用武器熟练和中甲受训。", "原初职能": "你将自己投身于所选择的以下一项神圣的角色之中： 术师Magician。 你从德鲁伊法术列表中额外学会一道戏法。此外，你与自然的神秘连接让你在智力（奥秘和自然）检定上获得加值。加值等于你的感知调整值（最低+1）。 卫士Warden。 你为战斗做足训练，你获得军用武器熟练和中甲受训。", "德鲁伊·施法": "你通过研究自然的神秘伟力学会了如何施展法术。施法规则见第七章。下文将详述如何将这些规则应用于德鲁伊法术，德鲁伊法术详见本章后文职业描述中的德鲁伊法术列表。 戏法Cantrips 。 你知晓两道你选择的德鲁伊戏法。推荐选择 德鲁伊伎俩Druidcraft 和 燃火术Produce Flame 。 每当你获得一个德鲁伊等级时，你都能从你的戏法中选择其一替换为另一道你所选择的德鲁伊戏法。 当你的德鲁伊等级到达4级和10级时，你都能另选一道德鲁伊戏法并习得，如德鲁伊特性表中戏法一列所示。 法术位Spell Slots。德鲁伊特性 表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术 Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择四道德鲁伊法术。推荐选择 化兽为友Animal Friendship 、 疗伤术Cure Wounds 、 妖火Faerie Fire 和 雷鸣波Thunderwave 。 已准备法术数量会随你德鲁伊等级的提升而增加，如德鲁伊特性表中的准备法术一列所示。每当这一列的数字增加时，从德鲁伊法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级德鲁伊，则你的准备法术列表能包括六道一环或二环的德鲁伊法术，随意组合。 如果德鲁伊的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为德鲁伊法术。 改变你的准备法术Changing Your Prepared Spells。 当你完成一次长休时，你可以将你准备列表上的一道或更多法术替换为其他德鲁伊法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你德鲁伊法术的施法属性是感知。 施法法器Spellcasting Focus。 你可以使用德鲁伊法器作为你德鲁伊法术的施法法器。", "战士·战斗风格": "你不断磨练你的武艺。你获得一项你选择的战斗风格专长（见第五章）。推荐选择防御。 每当你获得战士等级时，你可以将其改为另一个战斗风格专长。", "战斗风格": "你不断磨练你的武艺。你获得一项你选择的战斗风格专长（见第五章）。推荐选择防御。 每当你获得战士等级时，你可以将其改为另一个战斗风格专长。", "战士·回气": "你可以利用有限的精力与体力来重整旗鼓。以一个附赠动作，你可以用此法恢复生命值，其总值为1d10＋你的战士职业等级。 你可以使用此特性两次，并且在完成短休后恢复一次已消耗的使用次数，完成长休后恢复所有已消耗的使用次数。 当你到达特定战士等级时，你获得这项特性的额外使用次数，已列在战士特性表的回气一列。", "回气": "你可以利用有限的精力与体力来重整旗鼓。以一个附赠动作，你可以用此法恢复生命值，其总值为1d10＋你的战士职业等级。 你可以使用此特性两次，并且在完成短休后恢复一次已消耗的使用次数，完成长休后恢复所有已消耗的使用次数。 当你到达特定战士等级时，你获得这项特性的额外使用次数，已列在战士特性表的回气一列。", "战士·武器精通": "你对武器的训练使你能够运用三种自选的简易或军用武器的精通词条。每当你完成一次长休时，你可以重新演练武器技巧，来改变你所选择的其中一个武器类型。 当你到达特定的战士等级时，你还可以使用更多种类武器的精通词条，详见战士特性表中武器精通一栏。", "武僧·武艺": "你的武艺修行让你将徒手打击与武僧武器的使用方式烂熟于心。武僧武器包括： 简易近战武器 拥有轻型词条的军用近战武器 只要你未着装任何护甲也没持用盾牌，且徒手或只持用武僧武器，则你获得下列增益： 附赠徒手打击Bonus Unarmed Strike。 你可以用附赠动作发动一次徒手打击。 武艺骰Martial Arts Die。 你使用徒手打击或武僧武器进行攻击时，可以选择用1d6骰代替原本的伤害。该骰子将随武僧职业等级的提升而增大，具体数据见武僧特性表中的武艺骰一列。 敏捷攻击Dexterous Attacks。 你使用徒手打击或武僧武器进行攻击时，可以用敏捷代替力量进行攻击检定和伤害掷骰。此外，当你使用徒手打击的擒抱或推撞选项时，你也可以使用你的敏捷代替力量决定豁免DC。", "武艺": "你的武艺修行让你将徒手打击与武僧武器的使用方式烂熟于心。武僧武器包括： 简易近战武器 拥有轻型词条的军用近战武器 只要你未着装任何护甲也没持用盾牌，且徒手或只持用武僧武器，则你获得下列增益： 附赠徒手打击Bonus Unarmed Strike。 你可以用附赠动作发动一次徒手打击。 武艺骰Martial Arts Die。 你使用徒手打击或武僧武器进行攻击时，可以选择用1d6骰代替原本的伤害。该骰子将随武僧职业等级的提升而增大，具体数据见武僧特性表中的武艺骰一列。 敏捷攻击Dexterous Attacks。 你使用徒手打击或武僧武器进行攻击时，可以用敏捷代替力量进行攻击检定和伤害掷骰。此外，当你使用徒手打击的擒抱或推撞选项时，你也可以使用你的敏捷代替力量决定豁免DC。", "武僧·无甲防御": "若你未着装任何护甲且未持用盾牌，你的基础护甲等级等于10＋你的敏捷调整值＋你的感知调整值。", "圣武士·圣疗": "你的触碰溢满祝福，可以医治伤口。你获得一个治疗能量池，其内的治疗能量在每次完成长休时自动补满。治疗能量池储备的可恢复生命值总值等于你的圣武士等级的五倍。 你能够以附赠动作触碰一名生物（可以是你自己），并抽取治疗能量池中的能量恢复该生物的生命值，其恢复量最多等于你治疗能量池中剩余的治疗量。 此外，你也可以使用5点治疗量来移除目标身上的中毒状态，这些点数不会同时恢复生物的生命值。", "圣疗": "你的触碰溢满祝福，可以医治伤口。你获得一个治疗能量池，其内的治疗能量在每次完成长休时自动补满。治疗能量池储备的可恢复生命值总值等于你的圣武士等级的五倍。 你能够以附赠动作触碰一名生物（可以是你自己），并抽取治疗能量池中的能量恢复该生物的生命值，其恢复量最多等于你治疗能量池中剩余的治疗量。 此外，你也可以使用5点治疗量来移除目标身上的中毒状态，这些点数不会同时恢复生物的生命值。", "圣武士·施法": "你已经学会了如何通过祈祷与冥想来施展法术。施法规则见第七章。下文将详述如何将这些规则应用于圣武士法术，圣武士法术详见本章后文职业描述中的圣武士法术列表。 法术位Spell Slots。 圣武士特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 准备一环或以上的法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道圣武士法术推荐选择 英雄气概Heroism 和 炽焰斩Searing Smite 。 已准备法术数量会随你圣武士等级的提升而增加，如圣武士特性表中的准备法术一列所示。每当这一列的数字增加时，法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名5级的圣武士，则你的准备法术列表能包括六道一环或二环的圣武士法术，随意组合。 如果圣武士的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为圣武士法术。 改变准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道法术替换为其他圣武士法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你圣武士法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用圣徽作为你圣武士法术的施法法器 。", "圣武士·武器精通": "你对武器的训练使你能够运用两种自选的你具有熟练的武器的精通词条，例如长剑和标枪。 每当你完成一次长休时，你可以改变你所选择的武器类型。比如你可以改为戟和链枷。", "游侠·施法": "你学会运用自然世界的魔法本源进行施法。施法规则见第七章。下文将详述如何将这些规则应用于游侠法术，游侠法术详见本章后文职业描述中的游侠法术表。 法术位 Spell Slots。 游侠特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of 1st+ Level。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道游侠法术。推荐选择 捕获打击Ensnaring Strike 和 疗伤术Cure Wounds 。 已准备法术数量会随你游侠等级的提升而增加，如游侠特性表中的准备法术一列所示。每当这一列的数字增加时，从游侠法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名5级游侠，则你的准备法术列表能包括六道一环或二环的游侠法术，随意组合。 如果游侠的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为游侠法术。 改变你的准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道法术替换为其他游侠法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你游侠法术的施法属性是感知。 施法法器Spellcasting Focus。 你可以使用德鲁伊法器作为你游侠法术的施法法器。", "游侠·宿敌": "你始终准备着法术 猎人印记Hunter's Mark 。你可以无需法术位地施展此法术共计两次，并在完成一次长休后恢复此能力的所有使用次数。 你能无需法术位施展该法术的次数会在你获得特定游侠等级时提升，见游侠特性表中的宿敌一栏。", "宿敌": "你始终准备着法术 猎人印记Hunter's Mark 。你可以无需法术位地施展此法术共计两次，并在完成一次长休后恢复此能力的所有使用次数。 你能无需法术位施展该法术的次数会在你获得特定游侠等级时提升，见游侠特性表中的宿敌一栏。", "游侠·武器精通": "你对武器的训练使你能够自选并使用2种已熟练武器的精通词条，例如长弓和短剑。 当你完成一次长休时，你可以改变你所选择的武器类型。比如你可以将其改为弯刀和长剑。", "魔契师·魔能祈唤": "你在神秘学识的研习过程中发掘出了使用魔能祈唤的方式，这些禁忌的知识残章让你获得了持久的魔法能力或其他锻炼成果。你获得一个自选的魔能祈唤，如书之魔契（详见后文“魔能祈唤选项”）。 先决Prerequisites。 如果一个魔能祈唤具有先决，那你必须满足它才能选取。例如，若一个魔能祈唤需要你魔契师等级5+，则只有你魔契师等级达到5级才可以选取该祈唤。 替换与获取魔能祈唤Replacing and Gaining Invocation。 每当你获得一级魔契师等级时，你都可以用新的祈唤替换一个已有的祈唤，但你必须满足其先决条件。如果一个祈唤是某个其他祈唤的先决条件，那你无法替换它。 当你到达特定的魔契师等级时，你还可以习得更多的魔能祈唤，具体数据见魔契师特性表中祈唤一列。 你不能多次重复选择同一个魔能祈唤，除非该祈唤的描述另有说明。", "魔能祈唤": "你在神秘学识的研习过程中发掘出了使用魔能祈唤的方式，这些禁忌的知识残章让你获得了持久的魔法能力或其他锻炼成果。你获得一个自选的魔能祈唤，如书之魔契（详见后文“魔能祈唤选项”）。 先决Prerequisites。 如果一个魔能祈唤具有先决，那你必须满足它才能选取。例如，若一个魔能祈唤需要你魔契师等级5+，则只有你魔契师等级达到5级才可以选取该祈唤。 替换与获取魔能祈唤Replacing and Gaining Invocation。 每当你获得一级魔契师等级时，你都可以用新的祈唤替换一个已有的祈唤，但你必须满足其先决条件。如果一个祈唤是某个其他祈唤的先决条件，那你无法替换它。 当你到达特定的魔契师等级时，你还可以习得更多的魔能祈唤，具体数据见魔契师特性表中祈唤一列。 你不能多次重复选择同一个魔能祈唤，除非该祈唤的描述另有说明。", "魔契师·契约魔法": "依靠玄秘的仪式，你与一位神秘存在缔结契约以获得魔法力量。这位存在隐于影中，仅闻其声，身份不明——但其恩泽是切实的。施法规则见第七章。下文将详述如何将这些规则应用于魔契师法术，魔契师法术详见本章后文职业描述中的魔契师法术列表。 戏法Cantrips。 你知晓两道你选择的魔契师戏法。推荐选择 魔能爆Eldritch Blast 和 魔法伎俩Prestidigitation 。每当你获得一个魔契师等级，你都能从此特性的戏法中选择其一替换为另一道你所选择的魔契师戏法。 当你的魔契师等级到达4级和10级时，你都能另选一道魔契师戏法并习得，如魔契师特性表中戏法一列所示。 法术位Spell Slots。 魔契师特性表中显示了你可用于施展一环到五环魔契师法术的法术位数量。表中还显示了法术位对应的法术环阶，你所有的法术位都属于同一环阶。当你完成短休或长休时，你重获所有已消耗的法术位。 例如，5级时，你总共具有两枚三环法术位。你施展一环法术 巫术箭Witch Bolt 时，必须消耗这些法术位其中之一，并把它作为一个三环法术施展。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道魔契师法术。推荐选择 魅惑类人Charm Person 和 脆弱诅咒Hex 。 已准备法术数量会随你魔契师等级的提升而增加，如魔契师特性表中的准备法术一列所示。每当这一列的数字增加时，从魔契师法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须不高于表中法术位环阶一栏中的环阶。例如，当你到达6级时，你可以新习得一道一环到三环的魔契师法术。 如果魔契师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为魔契师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个魔契师等级，你可以将你准备列表上的一道法术法术替换为另一道魔契师法术，新法术的环阶必须小于或等于你当前的法术位环阶。 施法属性Spellcasting Ability。 你魔契师法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用奥术法器作为你魔契师法术的施法法器。", "契约魔法": "依靠玄秘的仪式，你与一位神秘存在缔结契约以获得魔法力量。这位存在隐于影中，仅闻其声，身份不明——但其恩泽是切实的。施法规则见第七章。下文将详述如何将这些规则应用于魔契师法术，魔契师法术详见本章后文职业描述中的魔契师法术列表。 戏法Cantrips。 你知晓两道你选择的魔契师戏法。推荐选择 魔能爆Eldritch Blast 和 魔法伎俩Prestidigitation 。每当你获得一个魔契师等级，你都能从此特性的戏法中选择其一替换为另一道你所选择的魔契师戏法。 当你的魔契师等级到达4级和10级时，你都能另选一道魔契师戏法并习得，如魔契师特性表中戏法一列所示。 法术位Spell Slots。 魔契师特性表中显示了你可用于施展一环到五环魔契师法术的法术位数量。表中还显示了法术位对应的法术环阶，你所有的法术位都属于同一环阶。当你完成短休或长休时，你重获所有已消耗的法术位。 例如，5级时，你总共具有两枚三环法术位。你施展一环法术 巫术箭Witch Bolt 时，必须消耗这些法术位其中之一，并把它作为一个三环法术施展。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道魔契师法术。推荐选择 魅惑类人Charm Person 和 脆弱诅咒Hex 。 已准备法术数量会随你魔契师等级的提升而增加，如魔契师特性表中的准备法术一列所示。每当这一列的数字增加时，从魔契师法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须不高于表中法术位环阶一栏中的环阶。例如，当你到达6级时，你可以新习得一道一环到三环的魔契师法术。 如果魔契师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为魔契师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个魔契师等级，你可以将你准备列表上的一道法术法术替换为另一道魔契师法术，新法术的环阶必须小于或等于你当前的法术位环阶。 施法属性Spellcasting Ability。 你魔契师法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用奥术法器作为你魔契师法术的施法法器。", "法师·施法": "你已经入门了奥术魔法，学会了如何施展法术。施法规则见第七章。下文将详述如何将这些规则应用于法师法术，法师法术详见本章后文职业描述中的法师法术表。 戏法Cantrips。 你知晓三道你选择的法师戏法。推荐选择 光亮术Light 、 法师之手Mage Hand 和 冷冻射线Ray of Frost 。 每当你完成一次长休时，你都能从此特性的戏法中选择其一替换为另一道你所选择的法师戏法。 当你的法师等级到达4级和10级时，你都能另选一道法师戏法并习得，如法师特性表中戏法一列所示。 法术书Spellbook。 你在法师学徒阶段获取的所有成果汇集于一本独特的书：你的法术书。它是一个重3磅的微型物件，内有100页，并且只能被你自己或者施展了 鉴定术Identify 的人阅读。你来决定法术书的外貌和材料，比如一本镶金边的典籍或用麻绳装订的牛皮纸集。 这本书包含所有你已知的一环及以上的法术。最初，它记录着六道由你选择的一环法师法术。推荐选择 侦测魔法Detect Magic 、 羽落术Feather Fall 、 法师护甲Mage Armor 、 魔法飞弹Magic Missile 、 睡眠术Sleep 和 雷鸣波Thunderwave 。 1级之后每当你获得一个法师等级时，你就可以往法术书中添加两道你选择的法师法术。你所选择法术的环阶必须是你所拥有法术位对应的环阶，你所拥有的法术位如法师特性表中所示。这些法术是你定期进行奥术研究的成果。 法术位Spell Slots。 法师特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。为此，从法术书中选择四道法师法术。你所选择法术的环阶必须是你所拥有法术位对应的环阶。 已准备法术数量会随你法师等级的提升而增加，如法师特性表中的准备法术一列所示。每当该数字增加时，从你的法术书中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级法师，则你的准备法术列表能包括六道一环或二环的法师法术（从法术书中选取），随意组合。 如果法师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为法师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道或更多法术替换为你法术书上的其他法师法术。 施法属性Spellcasting Ability。 你法师法术的施法属性是智力。 施法法器Spellcasting Focus。 你可以使用奥术法器或你的法术书作为你法师法术的施法法器。 扩展与替换法术书 Expanding and Replacing a Spellbook 你获得职业等级时添加到法术书中的法术反映了你自己进行的魔法研究，但你可能会在冒险过程中发现其他可以添加至法术书中的法术。例如，你可能在一张 法术卷轴Spell Scroll 中发现一道法师法术，然后将该法术抄到你的法术书中。 将一道法术抄写到法术书中Copying a Spell into the Book。 当你发现一道一环或更高环阶的法师法术时，如果它是你能进行准备的法术位环阶且你能抽出时间来抄写它，则你可以将其抄写到你的法术书中。每个法术环阶的抄录过程都需要2小时并花费50GP。在此之后，你就可以像准备法术书中的其他法术一样准备该法术了。 替换法术书Replacing the Book。 你可以将法术从你自己的法术书复制到另一本书中。这就像将新法术复制到你的法术书中一样，但更快也更简单，因为你已经知道如何施展这些法术。复制过程只需每个法术环阶花费1小时和10GP。 如果你失去了你的法术书，则你可以使用相同的过程将你已准备的法师法术转录到新的法术书中。你仍需要找到新的法术来填满新书的剩余部分。出于这个原因，许多法师都会保留一本备用法术书。", "法师·仪式学家": "你能以仪式施展你法术书中任何带有仪式标签的法术。你不需要准备这些法术，但你以此法施展法术时必须阅读这本书。", "仪式学家": "你能以仪式施展你法术书中任何带有仪式标签的法术。你不需要准备这些法术，但你以此法施展法术时必须阅读这本书。", "法师·奥术回想": "你学会了通过研读法术书来恢复魔法能量的办法。你完成一次短休后，可以选择恢复已消耗的法术位。所恢复的法术位环阶总和不得大于你法师等级的一半（向上取整），且任何一个法术位的环阶都必须小于六环。例如，作为一名4级法师时，你可恢复环阶总数最多为二的法术位。你可以选择恢复一个二环法术位或两个一环法术位。 此特性一经使用，直至完成长休你都无法再次使用。", "奥术回想": "你学会了通过研读法术书来恢复魔法能量的办法。你完成一次短休后，可以选择恢复已消耗的法术位。所恢复的法术位环阶总和不得大于你法师等级的一半（向上取整），且任何一个法术位的环阶都必须小于六环。例如，作为一名4级法师时，你可恢复环阶总数最多为二的法术位。你可以选择恢复一个二环法术位或两个一环法术位。 此特性一经使用，直至完成长休你都无法再次使用。", "游荡者·专精": "你获得两项由你选择的你已熟练的技能的专精。 如果你有这两项技能的熟练的话，推荐选择巧手和隐匿。 当你的游荡者等级为6级时，你额外再获得两项由你选择的你已熟练的技能的专精。", "专精": "你获得两项由你选择的你已熟练的技能的专精。 如果你有这两项技能的熟练的话，推荐选择巧手和隐匿。 当你的游荡者等级为6级时，你额外再获得两项由你选择的你已熟练的技能的专精。", "游荡者·偷袭": "你知道如何利用敌人的分心并发动致命的精巧打击。每个回合一次，当你以攻击检定命中了一个生物时，你可以造成1d6的额外伤害。这次攻击必须使用一把灵巧或远程武器并具有优势。额外伤害的伤害类型与该武器的伤害类型一致。 除此之外，若你的目标周围5尺内有你的盟友，并且该盟友没有陷入失能状态，你的攻击检定也没有劣势的话，则你不需要优势也造成额外伤害。 你的额外伤害会随着你的游荡者等级提高而增长，具体如游荡者特性表中的偷袭一列所示。", "偷袭": "你知道如何利用敌人的分心并发动致命的精巧打击。每个回合一次，当你以攻击检定命中了一个生物时，你可以造成1d6的额外伤害。这次攻击必须使用一把灵巧或远程武器并具有优势。额外伤害的伤害类型与该武器的伤害类型一致。 除此之外，若你的目标周围5尺内有你的盟友，并且该盟友没有陷入失能状态，你的攻击检定也没有劣势的话，则你不需要优势也造成额外伤害。 你的额外伤害会随着你的游荡者等级提高而增长，具体如游荡者特性表中的偷袭一列所示。", "游荡者·盗贼黑话": "Thieves' Cant 你在施展自己游荡者才华的社区里学习了多样的语言。你习得盗贼黑话和第二章的语言表中的一项语言。", "盗贼黑话": "Thieves' Cant 你在施展自己游荡者才华的社区里学习了多样的语言。你习得盗贼黑话和第二章的语言表中的一项语言。", "游荡者·武器精通": "你对武器的训练使你能够运用两种自选的你具有熟练的武器的精通词条，例如匕首和短弓。 每当你完成一次长休时，你可以改变你所选择的武器类型。比如你可以改为弯刀和短剑。", "术士·施法": "你从你的天生魔法汲取魔力用于施展法术。参见第七章有关施法的规则。下述信息将详述如何将这些规则应用于术士法术，术士法术详见本章后文职业描述中的术士法表。 戏法Cantrips。 你知晓四道你选择的术士戏法。推荐选择 光亮术Light 、 魔法伎俩Prestidigitation 、 电爪Shocking Grasp 和 术法爆发Sorcerous Burst 。每当你获得一个术士等级时，你都能将通过此特性知晓的其中一个戏法替换为另一个你所选择的术士戏法。 当你的术士等级达到4级和10级时，你都能另选一道术士戏法并习得，如术士特性表中戏法一列所示。 法术位Spell Slots。 术士特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道术士法术。推荐选择 燃烧之手Burning Hands 和 侦测魔法Detect Magic 。 已准备法术数量会随你术士等级的提升而增加，如术士特性表中的准备法术一列所示。每当这一列的数字增加时，从术士法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一位3级术士，则你的准备法术列表能包括六道一环或二环的术士法术，随意组合。 如果术士的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为术士法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个术士等级时，你就可以将你准备列表上的一道法术替换为另一道术士法术，你必须拥有替换后法术对应环阶的法术位才可以替换。 施法属性Spellcasting Ability。 你术士法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用奥术法器作为你术士法术的施法法器。", "术士·先天术法": "你过去经历的某件事在你身上留下了不可磨灭的印记，为你注入了难以控制的涌动魔力。以一个附赠动作，你可以将魔力释放而出，持续1分钟。在这1分钟期间，你获得以下增益： 你的术士法术豁免DC+1。 你在你施展的术士法术的攻击检定中具有优势。 你可以使用此特性两次，你在完成一次长休时重获所有已消耗的使用次数。", "先天术法": "你过去经历的某件事在你身上留下了不可磨灭的印记，为你注入了难以控制的涌动魔力。以一个附赠动作，你可以将魔力释放而出，持续1分钟。在这1分钟期间，你获得以下增益： 你的术士法术豁免DC+1。 你在你施展的术士法术的攻击检定中具有优势。 你可以使用此特性两次，你在完成一次长休时重获所有已消耗的使用次数。" };

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
// 法术悬浮小窗（2026-08-06：优先完整法术信息 rule_spells_full.json，无则回退规则索引摘要）
var _fullSpellCache = null; // 完整法术信息缓存 { 中文名: entry }
function formatSpellFull(f) {
  if (!f) return '';
  var parts = [];
  if (f.level !== undefined) parts.push((f.level === 0 ? '戏法' : f.level + '环') + ' · ' + (f.school || '未知学派'));
  if (f.castingTime) parts.push('施法时间：' + f.castingTime);
  if (f.range) parts.push('距离：' + f.range);
  if (f.components) parts.push('成分：' + f.components);
  if (f.duration) parts.push('持续时间：' + f.duration);
  if (f.concentration) parts.push('【专注】');
  if (f.ritual) parts.push('【仪式】');
  var head = parts.join('\n');
  var desc = String(f.desc || '').trim();
  return head + (desc ? '\n\n' + desc : '');
}
function showSpellTipBody(tip, name, text) {
  var b = tip.querySelector('.cb2-spell-tip-b');
  if (!b) return;
  if (text) {
    b.textContent = text;
    b.style.whiteSpace = 'pre-wrap';
  } else {
    b.textContent = '（暂无该法术的完整资料 — 点击法术条目可手动编辑/查看）';
  }
}
function showSpellTip(el, name, ctx) {
  var old = document.getElementById('cb2-spell-tip');
  if (old) old.remove();
  var tip = document.createElement('div');
  tip.id = 'cb2-spell-tip';
  tip.className = 'cb2-spell-tip';
  tip.innerHTML = '<div class="cb2-spell-tip-n">🔮 ' + esc(name) + '</div><div class="cb2-spell-tip-b">⏳ 加载效果…</div>';
  document.body.appendChild(tip);
  var rect = el.getBoundingClientRect();
  var left = Math.max(8, Math.min(window.innerWidth - 320, rect.left));
  var top = rect.bottom + 8;
  if (top + 200 > window.innerHeight) top = rect.top - 210;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  var cached = _fullSpellCache ? _fullSpellCache[name] : null;
  if (cached) { showSpellTipBody(tip, name, formatSpellFull(cached)); return; }
  if (!_fullSpellCache && ctx && typeof ctx.fetch === 'function') {
    try {
      ctx.fetch('/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spells_full.json')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          _fullSpellCache = (j && j.spells) || {};
          var f2 = _fullSpellCache[name];
          if (f2) showSpellTipBody(tip, name, formatSpellFull(f2));
          else querySpellDesc(ctx, name, function (desc) { showSpellTipBody(tip, name, desc || ''); });
        })
        .catch(function () { querySpellDesc(ctx, name, function (desc) { showSpellTipBody(tip, name, desc || ''); }); });
    } catch (e) { querySpellDesc(ctx, name, function (desc) { showSpellTipBody(tip, name, desc || ''); }); }
  } else {
    querySpellDesc(ctx, name, function (desc) { showSpellTipBody(tip, name, desc || ''); });
  }
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
  // ── 2026-08-05：法术按学派分组 ──
  '.cb2-spell-groups{display:flex;flex-direction:column;gap:4px}' +
  '.cb2-spell-grp{border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--bg-deep)}' +
  '.cb2-spell-grp .cb2-grp-t{margin:0 0 4px}' +
  '.cb2-school-tag{display:inline-block;font-size:10px;font-weight:700;color:#141414;background:linear-gradient(135deg,var(--gold-d),var(--gold));border-radius:9px;padding:1px 9px;letter-spacing:1px}' +
  '.cb2-ringtab{border:1px solid var(--border-light);background:var(--bg-deep);color:var(--text-2);border-radius:9px;padding:5px 10px;cursor:pointer;font-size:11.5px;font-family:inherit;transition:all .15s}' +
  '.cb2-ringtab:hover{border-color:var(--gold-d);color:var(--text)}' +
  '.cb2-ringtab.active{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;font-weight:700;border-color:var(--gold)}' +
  '.cb2-ringtab .n{opacity:.7;font-weight:600;margin-left:3px;font-size:10px}' +
  '.cb2-selected-box{border:1px dashed var(--border-light);border-radius:8px;padding:7px 9px;margin-top:8px;background:var(--bg-deep)}' +
  '.cb2-selected-box .lb{font-size:10px;color:var(--text-3);margin-bottom:5px}' +
  // ── 金币账本（装备购买） ──
  '.cb2-gold-ledger{display:flex;gap:14px;flex-wrap:wrap;align-items:center;background:linear-gradient(135deg,rgba(201,168,76,.10),rgba(201,168,76,.03));border:1px solid rgba(201,168,76,.3);border-radius:8px;padding:6px 10px;margin-top:6px}' +
  '.cb2-gl-cell{font-size:11px;color:var(--text-2)}' +
  '.cb2-gl-cell b{font-family:"Cinzel",serif;font-size:13px;color:var(--gold-l)}' +
  '.cb2-gl-src{display:block;font-size:9px;color:var(--text-mute)}' +
  '.cb2-chip-price{display:inline-block;font-size:9px;color:var(--gold-l);background:rgba(201,168,76,.12);border-radius:7px;padding:0 5px;margin-left:5px;vertical-align:1px}' +
  // ── 2026-08-05：武器属性细分标签（单手/双手/多用/灵巧/重型…）──
  '.cb2-wp-prop{display:inline-block;font-size:8.5px;color:#ffa7a7;background:rgba(229,72,77,.12);border:1px solid rgba(229,72,77,.35);border-radius:7px;padding:0 5px;margin-left:5px;vertical-align:1px;font-style:normal}' +
  '.cb2-start-item .cb2-it-price{display:inline-block;font-size:9px;color:var(--green-l);background:rgba(46,204,113,.12);border-radius:7px;padding:0 5px;margin-left:5px;vertical-align:1px}' +
  '.cb2-start-item .cb2-it-price.free{color:var(--text-mute);background:rgba(255,255,255,.06)}' +
  '.cb2-prof-hint{font-size:10.5px;color:var(--text-3);border-left:3px solid var(--gold-d);padding:4px 8px;background:var(--bg-panel);border-radius:4px;margin-top:6px;line-height:1.6}' +
  // ── 2026-08-05 全站重构：标签化横向列表条目（背包/装备/已选物品）──
  '.cb2-itemrows{display:flex;flex-direction:column;gap:6px}' +
  '.cb2-itemrow{display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--border);border-radius:9px;background:var(--bg-panel);transition:all .15s}' +
  '.cb2-itemrow:hover{border-color:var(--gold-d);background:var(--bg-hover)}' +
  '.cb2-itemrow.equipped{border-color:rgba(201,168,76,.5);background:linear-gradient(135deg,rgba(201,168,76,.08),transparent)}' +
  '.cb2-itemrow .tg{flex:1;min-width:0;justify-content:flex-start}' +
  '.cb2-itemrow-acts{display:flex;gap:5px;margin-left:auto;flex-shrink:0}' +
  '.cb2-wpnlist{display:flex;flex-direction:column;gap:6px}' +
  '.cb2-wpn{display:flex;align-items:center;gap:10px;padding:7px 12px;border:1px solid rgba(229,72,77,.4);border-radius:9px;background:rgba(229,72,77,.08);cursor:pointer;transition:all .15s;flex-wrap:wrap}' +
  '.cb2-wpn:hover{border-color:var(--red-l);background:rgba(229,72,77,.14);transform:translateY(-1px)}' +
  '.cb2-wpn.unequipped{opacity:.55;filter:saturate(.6)}' +
  '.cb2-wpn .cb2-wpn-n{font-weight:700;color:var(--text);font-size:12.5px;min-width:110px}' +
  '.cb2-wpn .cb2-wpn-atk{color:var(--red-l);font-weight:700;font-family:"Cinzel",serif;font-size:13px}' +
  '.cb2-wpn .cb2-wpn-dmg{color:var(--gold-l);font-weight:600;font-size:12px}' +
  '.cb2-wpn .cb2-wpn-props{font-size:10px;color:var(--text-3);border:1px solid var(--border-light);border-radius:8px;padding:0 6px}' +
  '.cb2-wpn .cb2-wpn-roll{font-size:14px;margin-left:auto}' +
  // ── 2026-08-05：职业可选熟练 chips（创建页：候选内手动选 N 项，不自动强制）──
  '.cb2-cls-skill-pick{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}' +
  '.cb2-cls-skill-pick .cb2-chip{cursor:pointer}' +
  '.cb2-cls-skill-pick .cb2-chip.off{opacity:.45}' +
  // ── 2026-08-05：立绘上传与圆形头像裁剪（创建页基础信息）──
  '.cb2-portrait-box{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}' +
  '.cb2-portrait-preview{width:126px;height:168px;border-radius:10px;overflow:hidden;border:2px solid var(--gold-d);background:var(--bg-deep);flex-shrink:0;display:grid;place-items:center}' +
  '.cb2-portrait-preview img{width:100%;height:100%;object-fit:cover;display:block}' +
  '.cb2-portrait-canvas-wrap{position:relative;border:1px solid var(--border-light);border-radius:10px;overflow:hidden;background:var(--bg-deep)}' +
  '.cb2-portrait-canvas-wrap canvas{display:block;max-width:100%}' +
  '.cb2-portrait-ctrl{display:flex;flex-direction:column;gap:8px;min-width:200px}' +
  '.cb2-portrait-ctrl .cb2-mini-label{margin-top:0}' +
  '.cb2-avatar-frame{width:60px;height:60px;border-radius:50%;overflow:hidden;border:2px solid var(--gold);flex-shrink:0;background:var(--bg-deep)}' +
  '.cb2-avatar-frame img{width:100%;height:100%;object-fit:cover}' +
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
  // 2026-08-06：正规背包——条目化长条列表
  '.cb2-inv-list{display:flex;flex-direction:column;gap:4px;margin-top:6px}' +
  '.cb2-inv-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-deep);font-size:11.5px;transition:border-color .15s}' +
  '.cb2-inv-row:hover{border-color:var(--gold-d)}' +
  '.cb2-inv-row .cb2-inv-name{flex:1.4;min-width:120px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.cb2-inv-row .cb2-inv-name.eq{color:var(--gold-l)}' +
  '.cb2-inv-row .cb2-inv-cat{flex:.8;min-width:56px;font-size:10px;color:var(--text-3);white-space:nowrap}' +
  '.cb2-inv-row .cb2-inv-qty{display:flex;align-items:center;gap:5px;flex-shrink:0}' +
  '.cb2-inv-row .cb2-inv-qty b{min-width:18px;text-align:center;color:var(--text)}' +
  '.cb2-inv-row .cb2-inv-price{flex:.9;min-width:74px;font-size:10.5px;color:var(--gold-l);white-space:nowrap}' +
  '.cb2-scroll-maker{border:1px dashed var(--border-light);border-radius:8px;padding:6px 10px;margin-top:8px;background:var(--bg-deep)}' +
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
  '.cb2-bg-src{display:block;font-size:9px;color:var(--gold-d);margin-top:3px;font-weight:600;line-height:1.5}' +
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
  // 起源专长 chip（悬浮显示效果）—— 标签系统统一样式：金色带边框
  '.cb2-feat-chip{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;border:1px solid var(--gold-d);background:rgba(201,168,76,.1);color:var(--gold-l);border-radius:14px;padding:3px 9px;font-size:11px;line-height:1.5;cursor:help}' +
  '.cb2-feat-chip:hover{border-color:var(--gold);box-shadow:0 0 8px rgba(201,168,76,.35)}' +
  '.cb2-feat-chip .src{font-size:9px;color:var(--text-3);border:1px solid var(--border-light);border-radius:8px;padding:0 5px}' +
  '.cb2-feat-chip .src.auto{color:var(--gold-l);border-color:var(--gold-d)}' +
  '.cb2-feat-chip .src.custom{color:var(--blue-l,#9dbdf7);border-color:rgba(91,141,239,.4)}' +
  '.cb2-feat-chip .rm{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:12px;line-height:1;padding:0 0 0 2px}' +
  '.cb2-feat-chip .rm:hover{color:var(--red-l)}' +
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
  '.cb2-rollset-dice{display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin-top:5px}' +
  '.cb2-rollset-dice span{font-size:9px;color:var(--text-3);background:var(--bg-panel);border-radius:5px;padding:1px 4px}' +
  '.cb2-rollset-detail{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:8px}' +
  '@media(max-width:640px){.cb2-rollset-detail{grid-template-columns:repeat(2,1fr)}}' +
  '.cb2-rsd{font-size:10px;color:var(--text-2);background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;padding:3px 6px;text-align:center}' +
  '.cb2-rsd i{font-style:normal;color:var(--text-3)}' +
  '.cb2-rsd b{color:var(--gold-l);font-family:"Cinzel",serif}' +
  '.cb2-rollset-back{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}' +
  '.cb2-rollset-cur{font-size:11.5px;color:var(--text-3)}' +
  '.cb2-rollset-cur b{color:var(--gold-l);font-size:13px}' +
  '.cb2-ab-item .md{font-size:13px;font-weight:700;color:var(--gold-l)}' +
  '.cb2-ab-item .md.neg{color:var(--red-l)}' +
  '.cb2-ab-item .save-t{position:absolute;top:6px;right:6px}' +
  '.cb2-save{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text-3);cursor:pointer;user-select:none}' +
  '.cb2-save em{font-style:normal;font-size:9px;color:var(--gold-d);margin-left:3px;border:1px solid rgba(201,168,76,.4);border-radius:8px;padding:0 4px;opacity:.85}' +
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
  // 2026-08-06：法术上限可视化进度条
  '.cb2-limit-row{display:flex;align-items:center;gap:8px;margin-top:5px}' +
  '.cb2-limit-row .lb{width:64px;flex-shrink:0;color:var(--text-2)}' +
  '.cb2-bar{flex:1;height:7px;border-radius:4px;background:var(--bg-active);border:1px solid var(--border);overflow:hidden}' +
  '.cb2-bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#5b8def,#7fd4ff);transition:width .25s}' +
  '.cb2-bar-fill.over{background:linear-gradient(90deg,#e5484d,#ff8a8a)}' +
  '.cb2-limit-row .cnt{font-size:10.5px;color:var(--gold-l);flex-shrink:0}' +
  '.cb2-limit-row .cnt.over{color:var(--red-l);font-weight:700}' +
  '.cb2-edit-grid .full{grid-column:1/-1}' +
  // 加载占位
  '.cb2-loading{color:var(--text-3);font-size:11.5px;padding:6px 0;animation:cb2-fade .4s}' +
  '.cb2-create .cb2-sec:hover{border-color:var(--border-light)}' +
  // ── 创建页重构：横向属性、种族特性、技能分组、特性标签 ──
  '.cb2-ability-grid.cb2-horz{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}' +
  '.cb2-ab-item.cb2-ab-horz{padding:8px 4px}' +
  '.cb2-ab-item.cb2-ab-horz .nm{font-size:10.5px}' +
  '.cb2-ab-item.cb2-ab-horz .cb2-ab-input{width:52px;font-size:14px}' +
  '.cb2-ab-item.cb2-ab-horz .cb2-ab-slot{width:54px;font-size:14px}' +
  '.cb2-ab-item.cb2-ab-horz .save-t{top:4px;right:4px}' +
  // 种族特性卡
  '.cb2-race-card{background:var(--bg-panel);border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;margin-top:2px}' +
  '.cb2-race-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:8px}' +
  '.cb2-race-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
  '.cb2-race-meta .cb2-tag{font-size:10px;color:var(--text-2);border:1px solid var(--border-light);border-radius:10px;padding:2px 8px;background:var(--bg-deep)}' +
  '.cb2-race-traits{display:grid;gap:6px}' +
  '.cb2-race-trait{border-left:2px solid var(--gold-d);background:var(--bg-deep);border-radius:0 6px 6px 0;padding:5px 9px;font-size:11px;color:var(--text-2);line-height:1.55}' +
  '.cb2-race-trait b{color:var(--gold-l);font-weight:700}' +
  '.cb2-race-choice{margin-top:6px;border-top:1px dashed var(--border);padding-top:6px}' +
  '.cb2-race-choice .t{font-size:10px;color:var(--text-3);margin-bottom:4px}' +
  // 技能按属性分组
  '.cb2-skill-groups{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 14px;margin-top:8px}' +
  '@media(max-width:1100px){.cb2-skill-groups{grid-template-columns:1fr}}' +
  '.cb2-skill-grp{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:6px 8px}' +
  '.cb2-skill-grp-t{font-size:10px;font-weight:700;color:var(--gold-l);border-bottom:1px solid var(--border);padding-bottom:3px;margin-bottom:4px;display:flex;align-items:center;gap:5px}' +
  '.cb2-skill-grp-t .ab{color:var(--text-3);font-weight:600;font-size:9.5px}' +
  '.cb2-skill-grp .cb2-skill-row{grid-template-columns:1fr 38px 84px}' +
  '.cb2-skill-row.locked{background:rgba(63,142,239,.06);border:1px dashed rgba(63,142,239,.35)}' +
  '.cb2-skill-row.locked select{opacity:.75}' +
  '.cb2-quota{margin-bottom:8px;padding:7px 10px;border-radius:8px;background:var(--bg-panel);border:1px solid var(--border);font-size:11.5px;color:var(--text-2);line-height:1.7}' +
  '.cb2-quota .q{color:var(--gold-l);font-weight:800}' +
  '.cb2-quota.over{border-color:rgba(224,93,93,.6);background:rgba(224,93,93,.08)}' +
  '.cb2-quota .warn{color:#e05d5d;font-weight:700}' +
  '.cb2-quota .tip{margin-top:3px;font-size:10.5px;color:var(--text-3)}' +
  // 特性标签（主样式见 STYLE_EXTRA 的 .cb2-feat-chip 统一定义；此处仅补充子样式）
  '.cb2-feat-chiprow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}' +
  '.cb2-feat-chip .cb2-feat-desc{flex:1 1 100%;min-width:100%;max-width:460px;font-size:10px;color:var(--text-3);line-height:1.6;padding:3px 2px 1px;font-weight:400;white-space:pre-wrap;overflow-wrap:break-word}' +
  '.cb2-feat-chip .rm{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:12px;line-height:1;padding:0 0 0 2px}' +
  '.cb2-feat-chip .rm:hover{color:var(--red-l)}' +
  '.cb2-feat-add{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}' +
  // 页签区块内双列（属性页：左属性+右豁免/派生）
  '.cb2-step-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
  '@media(max-width:1000px){.cb2-step-row{grid-template-columns:1fr}}';

// 标准 4d6 取最高 3 之和
function roll4d6DropLowest() {
  var arr = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort(function (a, b) { return a - b; });
  return arr[1] + arr[2] + arr[3];
}
// 掷一次 4d6 去最低，返回 {dice:[4个骰值], kept:[保留3个], sum}
function roll4d6Detail() {
  var arr = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort(function (a, b) { return a - b; });
  return { dice: arr.slice(), kept: arr.slice(1), sum: arr[1] + arr[2] + arr[3] };
}
// 掷出一组 6 个属性（含每个属性的 4d6 过程），供玩家逐次手动掷骰
function rollScoreSetWithDetail() {
  var pool = [], detail = [];
  for (var i = 0; i < 6; i++) {
    var d = roll4d6Detail();
    detail.push(d);
    pool.push(d.sum);
  }
  return { pool: pool, scores: null, detail: detail };
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
  var isEditing = !!editData;

  // ── 表单状态 ──
  var st = {
    name: editData ? editData.name || '' : '',
    race: editData && editData.race ? editData.race : '人类',
    raceChoices: (editData && editData.raceChoices) ? JSON.parse(JSON.stringify(editData.raceChoices)) : {}, // 种族可选项：{choiceKey: 选中值}
    raceFeatures: (editData && editData.raceFeatures) ? JSON.parse(JSON.stringify(editData.raceFeatures)) : null,
    cls: editData && editData.class && CLASS_HD[editData.class] ? editData.class : '法师',
    customClass: editData ? editData.customClass || '' : '',
    level: editData ? Math.max(1, Math.min(20, Number(editData.level) || 1)) : 1,
    background: editData ? editData.background || '' : '',
    bgApplied: (editData && editData.bgApplied) ? editData.bgApplied : null, // 背景属性加值 {mode:'21'|'111', before:{...}}
    bgAttrPending: false, // 骰点未分配完时的背景加值待应用标记（分配完成后自动应用）
    manualSaves: (editData && editData.manualSaves) ? editData.manualSaves : {}, // 手动勾选的豁免（切职业时保留）
    saveSources: (editData && editData.saveSources) ? JSON.parse(JSON.stringify(editData.saveSources)) : {}, // 豁免来源（职业·X / 自定义）
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
    equipPrices: null,       // 规则价格表 {名称: GP}（由 loadEquipData 一并加载）
    goldSpent: (editData && editData.goldSpent) ? Number(editData.goldSpent) || 0 : 0, // 装备区购买已花费金币
    goldStart: editData ? Number(editData.goldRemain != null ? editData.goldRemain : (editData.goldStart || 0)) || 0 : 0, // 编辑模式为当前可支配金币；新建模式由起始选项计算
    goldRemain: 0,           // 剩余金币（渲染时计算）
    alignment: editData && editData.alignment ? editData.alignment : '绝对中立',
    size: editData && editData.size ? editData.size : '中型',
    languages: editData ? editData.languages || '' : '',
    mode: editData ? 'manual' : 'rolled',
    rolledPool: [],      // 当前选中组的骰池（分配中）
    pickedIdx: -1,       // 当前池中选中的骰值下标
    rollSets: [],        // 手动逐次掷出的属性组（最多5组），每组 {pool:[6值], scores:null|{str..}, detail:[{dice,kept,sum}×6]}
    rollTimes: 0,        // 已手动掷出的组数（上限 5）
    rollPick: -1,        // -1=层级1（掷骰/选组）；>=0=层级2（第几组分配中）
    scores: defaultScores(),
    saves: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    subclass: (editData && editData.subclass) || '', // 副职（详情页显示 + 特性来源）
    trained: {},
    armor: editData && editData.armor ? editData.armor : '无甲',
    shield: !!(editData && editData.shield),
    spellList: [],
    items: [],
    features: editData && Array.isArray(editData.features) ? editData.features.slice() : [],
    bio: Object.assign({ appearance: '', personality: '', ideals: '', bonds: '', flaws: '', backstory: '' }, (editData && editData.bio) || {}),
    assets: (editData && editData.assets) ? JSON.parse(JSON.stringify(editData.assets)) : null, // 立绘/头像（avatar圆形/avatarFramed带框/portrait 3:4垂直立绘）
    spellData: null,
    equipData: null,
    // 2026-08-05 全站重构：创建角色卡完全按标准流程（分步引导），不再区分"开卡流程/快速创建"
    flowType: 'guide',
    flowStep: 0
  };
  if (editData && editData.abilityScores) {
    ABILITIES.forEach(function (a) { if (editData.abilityScores[a.key] != null) st.scores[a.key] = clampScore(editData.abilityScores[a.key]); });
  }
  if (editData && editData.savingThrows) {
    ABILITIES.forEach(function (a) { st.saves[a.key] = !!editData.savingThrows[a.key]; });
  }
  if (editData && editData.subclass) st.subclass = editData.subclass;
  // 编辑模式：若已有副职但特性列表缺对应副职特性（旧版本数据），自动补齐
  if (editData && editData.subclass && SUBCLASSES[editData.class] && SUBCLASSES[editData.class].list[editData.subclass]) {
    var subInfo = SUBCLASSES[editData.class].list[editData.subclass];
    var subLv = Number(editData.level) || 1;
    if (subInfo.feats) {
      Object.keys(subInfo.feats).forEach(function (fl) {
        if (Number(fl) <= subLv) subInfo.feats[fl].forEach(function (f) {
          var fn = subclassFeatName(editData.subclass, f);
          if (st.features.indexOf(fn) < 0) st.features.push(fn);
        });
      });
    }
  }
  if (editData && editData.skills) {
    SKILLS.forEach(function (s) {
      // 旧版译名「生存」→ 2024 统一「求生」数据迁移
      var v = editData.skills[s.name] || editData.skills[s.name === '求生' ? '生存' : s.name];
      if (v && v.trained) st.trained[s.name] = v.trained;
    });
  }
  if (editData && Array.isArray(editData.spellList)) {
    st.spellList = editData.spellList.map(function (s) { var n = (st.ruleVersion === '2024' && s.name === '印记斩') ? '闪耀斩' : ((st.ruleVersion === '2014' && s.name === '闪耀斩') ? '印记斩' : s.name); return Object.assign({}, s, { name: n, level: Number(s.level) || 0 }); });
  }
  if (editData) {
    st.items = normalizeItems(editData).map(function (it) {
      var p = it.price == null || it.price === '' ? null : Number(String(it.price).replace(/[^\d.]/g, ''));
      var qty = Math.max(1, Number(it.quantity) || 1);
      return Object.assign({}, it, { name: it.name, category: it.category || '杂物', quantity: qty, equipped: !!it.equipped, free: true, freeQuantity: qty, price: p, acquired: true });
    });
  }
  // 新建时按职业预填推荐（豁免自动；技能改为"可选熟练"由玩家手动勾选，不自动预填）
  if (!editData) {
    (SAVE_RECS[st.cls] || []).forEach(function (k) { st.saves[k] = true; });
    // 新建：预填初始职业 1 级特性（2024 PHB 特性表）
    (CLASS_LV1_FEATURES[st.cls] || []).forEach(function (f) { if (st.features.indexOf(f) < 0) st.features.push(f); });
    // 新建：种族 → 体型/语言自动联动（默认人类 → 通用语）
    if (RACE_SIZE[st.race]) st.size = RACE_SIZE[st.race];
    if (RACE_LANGS[st.race] && !st.languages) st.languages = RACE_LANGS[st.race];
  }
  // 新建 + 骰点模式：不预生成，玩家手动逐次掷骰（最多 5 次，每次显示 4d6 过程）
  if (!editData && st.mode === 'rolled') {
    st.rollSets = [];
    st.rollTimes = 0;
    st.rollPick = -1; // 层级1：先掷骰/选组
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
        ? '<button type="button" class="cb2-ab-slot' + (has ? ' filled' : '') + '" data-act="assign-ab" data-ab="' + a.key + '" data-drop="ab" data-ab-val="' + (has ? v : '') + '" title="' + (has ? '点击回收该值到骰池（也可拖回骰池）' : '把骰值拖到这里分配，或先点骰值再点这里') + '">' + (has ? v : '待分配') + '</button>'
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

  // 技能按属性分组（每组标题 + 该属性技能行）
  var skillGroupsHtml = ABILITIES.map(function (ab) {
    var rows = SKILLS.filter(function (s) { return s.ability === ab.name; }).map(function (s) {
      var t = st.trained[s.name] || '未熟练';
      // 来源标签：背景/职业/自定义 区分显示
      var srcs = st.skillSources && st.skillSources[s.name] ? st.skillSources[s.name] : [];
      var srcHtml = srcs.length ? '<span class="cb2-skill-src">' + srcs.map(function (x) { return esc(x); }).join(' · ') + '</span>' : '';
      return '<div class="cb2-skill-row">' +
        '<span class="nm">' + esc(s.name) + srcHtml + '</span>' +
        '<span class="bn" id="cb2c-sk-' + esc(s.name) + '">+0</span>' +
        '<select class="cb2-in" data-sk-sel="' + esc(s.name) + '">' +
        '<option value="未熟练"' + (t === '未熟练' ? ' selected' : '') + '>未熟练</option>' +
        '<option value="熟练"' + (t === '熟练' ? ' selected' : '') + '>熟练</option>' +
        '<option value="专精"' + (t === '专精' ? ' selected' : '') + '>专精</option>' +
        '</select></div>';
    }).join('');
    return rows ? '<div class="cb2-skill-grp"><div class="cb2-skill-grp-t">' + esc(ab.name) + '<span class="ab">' + ab.short + '</span></div>' + rows + '</div>' : '';
  }).join('');
  var skillRows = skillGroupsHtml;

  // 特性标签判定：匹配种族/职业/背景自动来源
  // 特性描述查找（委托顶层 lookupFeatDesc：起源专长/种族特性/血系选择）
  function featDesc(f) { return lookupFeatDesc(f, st.cls); }
  function featSrcTag(f) {
    var name = String(f || '');
    // 种族特性（RACE_FEATURES traits 名）
    var raceHit = null;
    Object.keys(RACE_FEATURES).forEach(function (r) {
      if (raceHit) return;
      var rf = RACE_FEATURES[r];
      (rf.traits || []).forEach(function (t) { if (t.n === name) raceHit = r; });
    });
    if (raceHit) return { tag: '种族·' + raceHit, auto: true };
    // 职业 1 级特性
    if (name && (CLASS_LV1_FEATURES[st.cls] || []).indexOf(name) >= 0) return { tag: '职业·' + st.cls, auto: true };
    // 背景起源专长
    var bgInfo2 = BACKGROUNDS[st.background];
    if (bgInfo2 && bgInfo2.feat === name) return { tag: '背景·' + st.background, auto: true };
    // 种族血系/可选项（人类多才多艺选出的起源专长等）
    Object.keys(RACE_FEATURES).forEach(function (r) {
      if (raceHit) return;
      var rf = RACE_FEATURES[r];
      (rf.choices || []).forEach(function (ch) {
        if (raceHit) return;
        if (ch.kind === 'feat' && (st.raceChoices || {})[ch.key] === name) raceHit = r;
      });
    });
    if (raceHit) return { tag: '种族·' + raceHit, auto: true };
    return { tag: '自定义', auto: false };
  }
  function featListHtml() {
    return st.features.map(function (f, i) {
      var src = featSrcTag(f);
      var dsc = featDesc(f);
      if (window.TrpgTag && window.TrpgTag.chip) {
        var type = src.auto ? (src.tag.indexOf('种族') === 0 ? 'race' : (src.tag.indexOf('副职') === 0 ? 'subclass' : (src.tag.indexOf('背景') === 0 ? 'bg' : 'cls'))) : 'custom';
        return window.TrpgTag.chip({
          name: f, type: type, source: src.tag,
          desc: dsc || f,
          title: dsc ? f + '：' + dsc.slice(0, 140) + (dsc.length > 140 ? '…' : '') : f,
          dataAct: 'feat-del', dataI: i, removable: true
        });
      }
      return '<span class="cb2-feat-chip" data-feat-name="' + esc(f) + '" data-feat-desc="' + encodeURIComponent(dsc || f) + '" title="' + esc(dsc ? f + '：' + dsc.slice(0, 140) + (dsc.length > 140 ? '…' : '') : f) + '">' + esc(f) +
        '<span class="src' + (src.auto ? ' auto' : ' custom') + '">' + esc(src.tag) + '</span>' +
        '<button type="button" class="rm" data-act="feat-del" data-i="' + i + '">✕</button></span>';
    }).join('') || '<div class="cb2-hint">暂无特性 — 选择种族/职业/背景后自动添加，也可手动添加</div>';
  }
  function refreshFeatList() {
    var fl = $id('cb2c-feat-list');
    if (fl) fl.innerHTML = featListHtml();
  }
  var featHtml = featListHtml();

  // 2026-08-05：标准流程分步引导（唯一流程：基础信息→种族→职业→背景→属性→技能→法术→装备→特性）
  var flowHtml = '';
  var STEPS = [
    ['基础信息', '姓名 / 立绘 / 阵营 / 体型 / 语言 / 外貌性格'],
    ['种族', '种族选择与默认特性（黑暗视觉/抗性/血系）'],
    ['职业', '职业选择 / 等级 / 职业1级特性 / 可选熟练'],
    ['背景', '背景选择 / 属性提升 / 起源专长 / 装备'],
    ['属性', '骰点 / 购点 / 标准数组 / 手动 + 豁免'],
    ['技能', '按属性分组 · 职业候选手动选 / 背景自动联动'],
    ['法术', '按环位与学派选法术（施法职业）'],
    ['装备', editData ? '现行背包 / 数量 / 价格 / 装备状态 / 护甲联动' : '起始装备 A/B/C + 分类细分 + 护甲联动'],
    ['特性', '标签化特性（种族/职业/背景/自定义）']
  ];
  {
    var stepBar = '<div class="cb2-flow-steps" id="cb2c-flow-steps" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
      STEPS.map(function (s, i) {
        return '<span class="cb2-flow-step' + (i === 0 ? ' cur' : '') + '" data-act="flow-step" data-i="' + i + '" title="' + esc(s[1]) + '">' + (i + 1) + '. ' + esc(s[0]) + '</span>';
      }).join('') +
      '<span style="margin-left:auto;display:flex;gap:4px;align-items:center">' +
      '<button type="button" class="cb2-btn sm" data-act="flow-prev" id="cb2c-flow-prev" style="visibility:hidden">← 上一步</button>' +
      '<button type="button" class="cb2-btn gold sm" data-act="flow-next" id="cb2c-flow-next">下一步 →</button>' +
      '</span>' +
      '</div>';
    flowHtml = stepBar;
  }

  container.innerHTML = '<div class="cb2 cb2-create">' +
    (editData ? '<div class="cb2-rulever-tip" style="margin-bottom:10px"><b>现行角色卡编辑</b>：所有页面直接修改当前角色数据。装备页是正规背包，不会重新发放初始装备；属性为可编辑最终数值。</div>' : '') +
    flowHtml +
    // ═══ 页签1：基础信息 ═══
    '<div class="cb2-sec" data-step="0">' +
    '<h4 class="cb2-sec-h">📋 基础信息</h4>' +
    // 规则版本切换（2024 玩家手册 / 2014 玩家手册）
    '<div class="cb2-rulever" style="margin-bottom:10px"><span class="cb2-rulever-ic">📚</span>规则版本' +
    '<div class="cb2-rulever-sw">' +
    '<button type="button" class="cb2-rulever-btn' + (st.ruleVersion === '2024' ? ' on' : '') + '" data-act="rule-ver" data-v="2024" title="玩家手册2024：背景提供属性提升与起源专长，技能含专精">2024 玩家手册</button>' +
    '<button type="button" class="cb2-rulever-btn' + (st.ruleVersion === '2014' ? ' on' : '') + '" data-act="rule-ver" data-v="2014" title="玩家手册2014：背景不提供属性与专长，技能无专精">2014 玩家手册</button>' +
    '</div></div>' +
    '<div class="cb2-rulever-tip" id="cb2c-rulever-tip" style="margin-bottom:10px">' + (st.ruleVersion === '2024' ? '背景提供 3 项属性提升与 1 个起源专长，自动应用' : '背景不提供属性提升与专长（2014 规则），技能无专精') + '</div>' +
    // 姓名 + 阵营 + 体型 + 语言（角色身份信息）
    '<div class="cb2-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="cb2-field" style="flex:2;min-width:180px"><label>角色姓名 *</label>' +
    '<input type="text" class="cb2-in" id="cb2c-name" value="' + esc(st.name) + '" placeholder="如：阿拉贡·风行"></div>' +
    '<div class="cb2-field"><label>阵营</label><select class="cb2-in" id="cb2c-align" style="min-width:120px">' + alignOptions + '</select></div>' +
    '<div class="cb2-field"><label>体型</label><select class="cb2-in" id="cb2c-size" style="min-width:100px">' +
    ['微型', '小型', '中型', '大型', '巨型'].map(function (z) { return '<option' + (st.size === z ? ' selected' : '') + '>' + z + '</option>'; }).join('') + '</select></div>' +
    '<div class="cb2-field" style="flex:1;min-width:160px"><label>语言</label><input type="text" class="cb2-in" id="cb2c-lang" value="' + esc(st.languages) + '" placeholder="如：通用语、精灵语"></div>' +
    '</div>' +
    // 立绘与头像（2026-08-06：独立窗口三段流程——上传原图 → 截取立绘(3:4) → 截取头像(圆形)，含抠背景色工具；
    // 主窗口只显示立绘/头像结果预览，不内嵌裁剪器）
    '<h4 class="cb2-sec-h" style="margin-top:12px">🖼 立绘与头像 <span class="cb2-sec-note">独立窗口裁剪 · 3:4垂直立绘（AVG发言立绘）· 圆形头像（地图/列表）· 支持抠背景色</span></h4>' +
    '<div class="cb2-portrait-box">' +
    '<div style="text-align:center">' +
    '<div class="cb2-avatar-frame" id="cb2c-avatar-frame" title="圆形头像预览"></div>' +
    '<div class="cb2-row" style="margin-top:6px;justify-content:center">' +
    '<button type="button" class="cb2-btn sm gold" data-act="portrait-open">🖼 打开立绘/头像工具</button>' +
    '<button type="button" class="cb2-btn sm" data-act="portrait-remove" id="cb2c-portrait-remove" style="display:none">✕ 移除</button>' +
    '</div></div>' +
    '<div style="text-align:center">' +
    '<div class="cb2-portrait-preview" id="cb2c-portrait-preview" title="3:4 垂直立绘预览"><div style="color:var(--text-3);font-size:10px;line-height:52px">立绘预览</div></div>' +
    '<div class="cb2-mini-label">立绘（3:4 垂直）· 剧情频道 AVG 发言使用</div>' +
    '</div>' +
    '<input type="file" id="cb2c-portrait-file" accept="image/*" style="display:none">' +
    '</div>' +
    // 背景设定（外貌/性格/理想/牵绊/缺陷 + 玩家自写背景故事，均多行文本）
    '<h4 class="cb2-sec-h" style="margin-top:12px">🧬 外貌与角色设定 <span class="cb2-sec-note">多行文本 · 可选</span></h4>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field"><label>外貌</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-appearance" placeholder="如：银发灰眸，左颊有一道旧伤">' + esc(st.bio.appearance || '') + '</textarea></div>' +
    '<div class="cb2-field"><label>性格</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-personality" placeholder="如：沉着冷静，对弱者心怀怜悯">' + esc(st.bio.personality || '') + '</textarea></div>' +
    '<div class="cb2-field"><label>理想</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-ideals" placeholder="如：荣耀高于一切">' + esc(st.bio.ideals || '') + '</textarea></div>' +
    '<div class="cb2-field"><label>牵绊</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-bonds" placeholder="如：誓死保护同行的旅伴">' + esc(st.bio.bonds || '') + '</textarea></div>' +
    '<div class="cb2-field full"><label>缺陷</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-flaws" placeholder="如：无法拒绝求助之人">' + esc(st.bio.flaws || '') + '</textarea></div>' +
    '<div class="cb2-field full"><label>📖 背景故事（你的角色故事，区别于规则背景）</label>' +
    '<textarea rows="4" class="cb2-in cb2-ta" id="cb2c-bio-backstory" placeholder="写下你角色的过往、出身、旅途中的经历……">' + esc(st.bio.backstory || '') + '</textarea></div>' +
    '</div></div>' +
    // ═══ 页签2：种族 ═══
    '<div class="cb2-sec" data-step="1">' +
    '<h4 class="cb2-sec-h">🧝 种族 <span class="cb2-sec-note">默认特性自动生效</span></h4>' +
    '<div class="cb2-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="cb2-field"><label>种族</label><select class="cb2-in" id="cb2c-race" style="min-width:150px">' + raceOptions + '</select></div>' +
    '<div class="cb2-field"><label>&nbsp;</label><div class="cb2-mini-label">体型/语言已随种族自动填入基础信息</div></div>' +
    '</div>' +
    '<div id="cb2c-race-card"></div>' +
    '</div>' +
    // ═══ 页签3：职业 ═══
    '<div class="cb2-sec" data-step="2">' +
    '<h4 class="cb2-sec-h">⚔️ 职业 <span class="cb2-sec-note">1级特性自动预填</span></h4>' +
    '<div class="cb2-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="cb2-field"><label>职业</label><select class="cb2-in" id="cb2c-cls" style="min-width:150px">' + clsOptions + '</select></div>' +
    '<div class="cb2-field" id="cb2c-custom-cls-wrap" style="display:' + (st.cls === '自定义' ? '' : 'none') + '"><label>自定义职业名</label>' +
    '<input type="text" class="cb2-in" id="cb2c-custom-cls" value="' + esc(st.customClass) + '" placeholder="如：魔剑士" style="min-width:120px"></div>' +
    '<div class="cb2-field"><label>等级</label><input type="number" class="cb2-in cb2-in-sm" id="cb2c-level" min="1" max="20" value="' + st.level + '"></div>' +
    '</div>' +
    '<div class="cb2-prof-hint" style="margin-top:8px" id="cb2c-cls-prof-hint">' + esc(CLASS_PROF_HINT[st.cls] || '（自定义职业，手动选择）') + '</div>' +
    '<div id="cb2c-cls-features" style="margin-top:8px"></div>' +
    // 2026-08-06：职业规则预览（分页下方内嵌该职业规则书网页，随时对照）
    '<details class="cb2-cls-preview" id="cb2c-cls-preview-wrap" style="margin-top:10px"><summary>📖 职业规则原文预览（' + esc(st.cls === '自定义' ? (st.customClass || '自定义') : st.cls) + '）<span class="cb2-sec-note">点击展开/收起</span></summary>' +
    '<div id="cb2c-cls-preview" class="cb2-cls-preview-frame"></div></details>' +
    '</div>' +
    // ═══ 页签4：背景 ═══
    '<div class="cb2-sec" data-step="3">' +
    '<h4 class="cb2-sec-h">📜 背景 <span class="cb2-sec-note">属性提升 / 专长 / 技能 / 工具 / 装备</span></h4>' +
    '<div class="cb2-field" style="max-width:260px"><label>背景</label><select class="cb2-in" id="cb2c-bg">' + bgOptions + '</select></div>' +
    '<div class="cb2-bg-card" id="cb2c-bg-card"></div>' +
    '</div>' +
    // ═══ 页签5：属性（双列：左属性生成 + 右豁免/派生）═══
    '<div class="cb2-sec" data-step="4">' +
    '<h4 class="cb2-sec-h">⚡ ' + (editData ? '属性数值' : '属性生成') + ' <span class="cb2-sec-note" id="cb2c-mode-note"></span></h4>' +
    '<div class="cb2-bonus-bar" id="cb2c-bonus" style="display:none"></div>' +
    '<div class="cb2-step-row">' +
    '<div>' +
    '<div class="cb2-mode-tabs"' + (editData ? ' style="display:none"' : '') + '>' +
    '<button type="button" class="cb2-mode-tab" data-mode="rolled">🎲 骰点</button>' +
    '<button type="button" class="cb2-mode-tab" data-mode="pointbuy">⚖️ 购点 27</button>' +
    '<button type="button" class="cb2-mode-tab" data-mode="array">📋 标准数组</button>' +
    '<button type="button" class="cb2-mode-tab" data-mode="manual">✍️ 手动</button>' +
    '</div>' +
    '<div class="cb2-mode-hint" id="cb2c-mode-hint"></div>' +
    '<div id="cb2c-pool-wrap"></div>' +
    '<div class="cb2-ability-grid cb2-horz" id="cb2c-ability-grid"></div>' +
    '<div class="cb2-row" style="margin-top:10px" id="cb2c-mode-extra"></div>' +
    '</div>' +
    '<div>' +
    '<h4 class="cb2-sec-h" style="margin:0 0 6px">🛡️ 豁免与战斗</h4>' +
    '<div class="cb2-hint" style="margin-bottom:6px">豁免熟练由职业自动赋予，可手动勾选。</div>' +
    '<div class="cb2-save-grid" id="cb2c-saves"></div>' +
    '<div class="cb2-derived" id="cb2c-derived"></div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    // ═══ 页签6：技能（按属性分组）═══
    '<div class="cb2-sec" data-step="5">' +
    '<h4 class="cb2-sec-h">🎓 技能熟练 <span class="cb2-sec-note">' + SKILLS.length + ' 项 · 按属性分组</span></h4>' +
    '<div class="cb2-hint">熟练 +' + 'PB' + '（熟练加值），专精 +PB×2。职业与背景自动勾选并标注来源。</div>' +
    '<div id="cb2c-skill-quota"></div>' +
    '<div class="cb2-skill-groups" id="cb2c-skill-groups">' + skillRows + '</div>' +
    '</div>' +
    // ═══ 页签7：法术 ═══
    '<div class="cb2-sec" data-step="6" id="cb2c-spell-sec">' +
    '<h4 class="cb2-sec-h">🔮 法术 <span class="cb2-sec-note" id="cb2c-spell-count">读取中…</span></h4>' +
    '<div id="cb2c-spell-body"><div class="cb2-loading">⏳ 正在从规则书加载职业法术表…</div></div>' +
    '</div>' +
    // ═══ 页签8：装备（起始装备 + 护甲联动）═══
    '<div class="cb2-sec" data-step="7" id="cb2c-equip-sec">' +
    '<h4 class="cb2-sec-h">🎒 ' + (editData ? '背包与装备' : '起始装备') + ' <span class="cb2-sec-note" id="cb2c-item-count">读取中…</span></h4>' +
    '<div class="cb2-hint">' + (editData ? '管理现有背包、数量、装备状态与后续购入物品。护甲只能从背包中已有护甲选择，并实时更新 AC。' : '护甲取决于角色拥有的护甲（职业起始装备/背景赠送），随装备自动联动。') + '</div>' +
    '<div id="cb2c-equip-body"><div class="cb2-loading">⏳ 正在从规则书加载装备表…</div></div>' +
    '</div>' +
    // ═══ 页签9：特性（标签化）═══
    '<div class="cb2-sec" data-step="8" id="cb2c-feat-sec">' +
    '<h4 class="cb2-sec-h">⭐ 特性 <span class="cb2-sec-note">种族 / 职业 / 背景 / 自定义 标签化</span></h4>' +
    '<div class="cb2-hint">职业 1 级特性、背景起源专长自动加入；手动添加的特性标记「自定义」标签。</div>' +
    '<div class="cb2-feat-chiprow" id="cb2c-feat-list"></div>' +
    '<div class="cb2-feat-add">' +
    '<input type="text" class="cb2-in" id="cb2c-feat-input" placeholder="如：精灵之优雅、初阶魔导" style="flex:1;min-width:180px">' +
    '<button type="button" class="cb2-btn gold sm" data-act="feat-add">＋ 添加特性</button>' +
    '</div></div>' +
    '</div>';

  // ── 记录各区块原始 display（分页恢复用）── 必须在任何显隐操作之前
  container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
    sec.setAttribute('data-orig-display', sec.style.display || '');
  });

  // ── 工具 ──
  function $id(id) { return container.querySelector('#' + id); }
  function setText(id, txt) { var el = $id(id); if (el) el.textContent = txt; }

  // ── 种族特性卡（2024 PHB 角色起源·种族：特性/血系展示 + 可选项自动化）──
  function raceChoiceDesc(race, key, val) {
    if (!val) return '';
    var info = RACE_FEATURES[race];
    if (!info || !info.choices) return '';
    for (var i = 0; i < info.choices.length; i++) {
      if (info.choices[i].key === key) {
        var opts = info.choices[i].options || [];
        for (var j = 0; j < opts.length; j++) {
          if (opts[j].v === val) {
            // feat 类选项缺描述时从 ORIGIN_FEATS 补充
            if (opts[j].d) return opts[j].d;
            if (info.choices[i].kind === 'feat' && ORIGIN_FEATS[val]) return ORIGIN_FEATS[val].replace(/<br>/g, '；').replace(/<[^>]+>/g, '');
            return val;
          }
        }
        return val;
      }
    }
    return val;
  }
  // 移除特性：仅当该特性不再被任何来源（当前背景/种族可选项/职业）持有时才真正删除
  function removeFeatIfUnused(name) {
    if (!name) return;
    // 当前背景仍持有
    var bgInfo = BACKGROUNDS[st.background];
    if (bgInfo && bgInfo.feat === name) return;
    // 种族可选项仍持有
    var raceOwned = false;
    Object.keys(RACE_FEATURES).forEach(function (r) {
      if (raceOwned) return;
      var rf = RACE_FEATURES[r];
      (rf.choices || []).forEach(function (ch) {
        if (ch.kind === 'feat' && (st.raceChoices || {})[ch.key] === name) raceOwned = true;
      });
    });
    if (raceOwned) return;
    st.features = st.features.filter(function (f) { return f !== name; });
  }
  // 应用种族可选项：加入/移除特性、技能来源
  function applyRaceChoice(key, val) {
    var r = st.race;
    var info = RACE_FEATURES[r];
    var ch = null;
    (info && info.choices || []).forEach(function (c) { if (c.key === key) ch = c; });
    if (!ch) return;
    var oldVal = st.raceChoices[key];
    // 清理旧值（先解除持有再移除，避免与背景/职业同名来源冲突）
    if (oldVal) {
      st.raceChoices[key] = '';
      if (ch.kind === 'feat') {
        removeFeatIfUnused(oldVal);
      } else if (ch.kind === 'skill') {
        removeSkillSource(oldVal, '种族·' + r);
      }
    }
    st.raceChoices[key] = val || '';
    // 应用新值
    if (val) {
      if (ch.kind === 'feat') {
        if (st.features.indexOf(val) < 0) st.features.push(val);
      } else if (ch.kind === 'skill') {
        addSkillSource(val, '种族·' + r);
      }
    }
    renderRaceCard();
    refreshFeatList();
    updateDerived();
    // 技能类选择：同步技能页下拉显示
    if (ch.kind === 'skill') {
      var skSel = container.querySelector('[data-sk-sel="' + val + '"]');
      if (skSel) skSel.value = '熟练';
      if (oldVal && oldVal !== val) {
        var skSelOld = container.querySelector('[data-sk-sel="' + oldVal + '"]');
        if (skSelOld) skSelOld.value = st.trained[oldVal] || '未熟练';
      }
    }
  }
  // 切换种族：清理旧种族的可选项来源
  function clearRaceChoices(oldRace) {
    var info = RACE_FEATURES[oldRace];
    if (!info || !info.choices) return;
    info.choices.forEach(function (ch) {
      var oldVal = st.raceChoices[ch.key];
      if (!oldVal) return;
      st.raceChoices[ch.key] = ''; // 先解除持有
      if (ch.kind === 'feat') {
        removeFeatIfUnused(oldVal);
      } else if (ch.kind === 'skill') {
        removeSkillSource(oldVal, '种族·' + oldRace);
      }
    });
    st.raceChoices = {};
  }
  function renderRaceCard() {
    var card = $id('cb2c-race-card');
    if (!card) return;
    var r = st.race;
    var info = RACE_FEATURES[r];
    if (!info) {
      card.innerHTML = '<div class="cb2-race-card"><div class="cb2-hint">自定义种族：特性请手动在「特性」页签添加。</div></div>';
      return;
    }
    var html = '<div class="cb2-race-card"><div class="cb2-race-head">🧝 ' + esc(r) + ' <span class="cb2-bg-card-tag">种族特性</span></div>' +
      '<div class="cb2-race-meta">' +
      '<span class="cb2-tag">生物类型：' + esc(info.type) + '</span>' +
      '<span class="cb2-tag">体型：' + esc(info.size) + '</span>' +
      '<span class="cb2-tag">速度：' + esc(info.speed) + '</span>' +
      '<span class="cb2-tag">语言：' + esc(RACE_LANGS[r] || '通用语') + '</span>' +
      '</div>' +
      '<div class="cb2-race-traits">' +
      (info.traits || []).map(function (t) {
        // 龙裔：伤害抗性动态化（随所选龙种显示实际抗性）
        var dyn = '';
        if (r === '龙裔' && t.n === '伤害抗性' && st.raceChoices.dragon) {
          var dInfo = raceChoiceDesc(r, 'dragon', st.raceChoices.dragon);
          var dm = String(dInfo || '').match(/获得(.+?)抗性/);
          if (dm) dyn = '<b style="color:var(--green-l)"> → 已选' + esc(st.raceChoices.dragon) + '：获得' + esc(dm[1]) + '抗性</b>';
          else dyn = '<b style="color:var(--green-l)"> → 已选' + esc(st.raceChoices.dragon) + '</b>';
        }
        return '<div class="cb2-race-trait"><b>' + esc(t.n) + '。</b>' + esc(t.d) + dyn + '</div>';
      }).join('') +
      '</div>' +
      ((info.choices || []).map(function (ch) {
        var cur = st.raceChoices[ch.key];
        var sel = '<select class="cb2-in" data-race-choice="' + esc(ch.key) + '" style="max-width:230px">' +
          '<option value="">— 选择' + esc(ch.n) + ' —</option>' +
          (ch.options || []).map(function (o) {
            return '<option value="' + esc(o.v) + '"' + (cur === o.v ? ' selected' : '') + '>' + esc(o.v) + '</option>';
          }).join('') + '</select>';
        var curDesc = cur ? raceChoiceDesc(r, ch.key, cur) : '';
        return '<div class="cb2-race-choice"><div class="t">☑ ' + esc(ch.n) + '</div>' +
          '<div class="cb2-row" style="gap:6px;align-items:center;flex-wrap:wrap">' + sel +
          (cur ? '<span class="cb2-race-trait" style="border-left-color:var(--green);flex:1;min-width:170px">' + esc(curDesc) + '</span>' : '') +
          '</div></div>';
      }).join('')) +
      '</div>';
    card.innerHTML = html;
  }

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
  function applyBgAttr(mode, abilityList) {
    var info = BACKGROUNDS[st.background];
    // 自定义背景：属性列表由表单选择器提供（customBg.attrKeys）；标准背景取预设 abilities
    var list = abilityList || (info && info.abilities);
    if (!list || !list.length) return;
    currentScores();
    // 守卫：骰点模式且存在未分配属性 → 标记 pending，分配完成后自动补应用
    if (st.mode === 'rolled') {
      var hasNull = ABILITIES.some(function (a) { return st.scores[a.key] == null; });
      if (hasNull) {
        st.bgAttrPending = true;
        return;
      }
    }
    st.bgAttrPending = false;
    // 先撤销旧背景加值（恢复应用前的原始值；仅恢复当时有值的项，防止清掉后分配的骰点）
    if (st.bgApplied && st.bgApplied.before) {
      ABILITIES.forEach(function (a) {
        var before = st.bgApplied.before[a.key];
        if (before != null) st.scores[a.key] = before;
      });
    }
    if (!mode) {
      st.bgApplied = null;
    } else {
      // 记录未加背景时的原始值，再应用新模式
      var before = {};
      ABILITIES.forEach(function (a) { before[a.key] = st.scores[a.key]; });
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
  // ── 技能熟练配额（2024 规则）──
  // 职业：从候选列表中选 N 项（CLASS_SKILL_COUNT）；背景：固定技能数（或自定义背景所选数）；种族：技能类选择
  function profQuota() {
    var q = 0;
    if (st.cls && st.cls !== '自定义') q += (CLASS_SKILL_COUNT[st.cls] || (SKILL_RECS[st.cls] || []).length);
    if (st.background && st.background !== '自定义背景') {
      var bi = BACKGROUNDS[st.background];
      if (bi && bi.skills) q += bi.skills.length;
    } else if (st.background === '自定义背景' && st.customBg) {
      q += (st.customBg.skills || []).length;
    }
    if (st.race && RACE_FEATURES[st.race] && RACE_FEATURES[st.race].choices) {
      RACE_FEATURES[st.race].choices.forEach(function (ch) {
        if (ch.kind === 'skill' && st.raceChoices && st.raceChoices[ch.key]) q += 1;
      });
    }
    return q;
  }
  // 当前已获熟练数（来源去重后，非"未熟练"的技能数）
  function profUsed() {
    var n = 0;
    SKILLS.forEach(function (s) { if (st.trained[s.name] && st.trained[s.name] !== '未熟练') n++; });
    return n;
  }
  // 职业来源当前已选数
  function clsProfUsed() {
    var n = 0;
    Object.keys(st.skillSources || {}).forEach(function (k) {
      (st.skillSources[k] || []).forEach(function (src) { if (src === '职业·' + st.cls) n++; });
    });
    return n;
  }
  // 渲染技能配额条（职业 N 项 / 背景 M 项 / 已选 X 项；超限提示）
  // 2026-08-05 全站重构：职业候选为"可选熟练"chips——玩家手动勾选 N 项，不自动强制；
  // 不在候选范围内的技能不能通过职业来源获得熟练。
  function renderSkillQuota() {
    var box = $id('cb2c-skill-quota');
    if (!box) return;
    var parts = [];
    if (st.cls && st.cls !== '自定义') {
      var q = CLASS_SKILL_COUNT[st.cls] || (SKILL_RECS[st.cls] || []).length;
      parts.push('职业<span class="q">' + q + '</span>项');
    }
    if (st.background && st.background !== '自定义背景') {
      var bi = BACKGROUNDS[st.background];
      if (bi && bi.skills) parts.push('背景<span class="q">' + bi.skills.length + '</span>项');
    } else if (st.background === '自定义背景' && st.customBg) {
      parts.push('背景<span class="q">' + (st.customBg.skills || []).length + '</span>项');
    }
    var used = profUsed();
    var quota = profQuota();
    // 职业候选 chips（可点选）
    var candHtml = '';
    if (st.cls && st.cls !== '自定义') {
      var cands = SKILL_RECS[st.cls] || [];
      var clsQ = CLASS_SKILL_COUNT[st.cls] || cands.length;
      candHtml = '<div class="cb2-cls-skill-pick" id="cb2c-cls-skill-pick"><span class="cb2-mini-label" style="margin:0;align-self:center;white-space:nowrap">⚔ 职业可选熟练（选 <b style="color:var(--gold-l)">' + clsQ + '</b> 项，点击勾选/取消）：</span>' +
        (cands.length ? cands.map(function (n) {
          var srcs = st.skillSources && st.skillSources[n] ? st.skillSources[n] : [];
          var on = srcs.indexOf('职业·' + st.cls) >= 0;
          var bgOn = srcs.some(function (x) { return x !== '职业·' + st.cls; });
          return '<span class="cb2-chip' + (on ? ' on' : ' off') + '" data-act="cls-skill-pick" data-name="' + esc(n) + '" title="' + (on ? '点击取消（' + st.cls + ' 不再提供该项熟练）' : (bgOn ? '由 ' + srcs.join('、') + ' 提供熟练，无需职业勾选' : '点击勾选为职业熟练')) + '">' + esc(n) + '</span>';
        }).join('') : '<span style="color:var(--text-mute);font-size:11px">（无候选列表）</span>') +
        '</div>';
    }
    box.innerHTML = '<div class="cb2-quota' + (used > quota ? ' over' : '') + '">熟练配额：' +
      (parts.length ? parts.join(' + ') + ' = <span class="q">' + quota + '</span> 项' : '<span class="q">不限</span>（选择职业/背景后生成配额）') +
      ' · 当前已选 <span class="q">' + used + '</span> 项' +
      (used > quota ? '<span class="warn"> ⚠ 超出配额 ' + (used - quota) + ' 项（多出的为手动添加）</span>' : '') +
      '</div>' + candHtml;
  }
  // 刷新技能下拉列表（职业/背景/种族切换后同步选中态与来源锁定）
  function renderSkillRows() {
    var box = $id('cb2c-skill-groups');
    if (!box) return;
    var html = ABILITIES.map(function (ab) {
      var rows = SKILLS.filter(function (s) { return s.ability === ab.name; }).map(function (s) {
        var t = st.trained[s.name] || '未熟练';
        var srcs = st.skillSources && st.skillSources[s.name] ? st.skillSources[s.name] : [];
        var hasAuto = srcs.some(function (x) { return x !== '自定义'; });
        var srcHtml = srcs.length ? '<span class="cb2-skill-src">' + srcs.map(function (x) { return esc(x); }).join(' · ') + '</span>' : '';
        var opt = function (v, label, extra) {
          return '<option value="' + v + '"' + (t === v ? ' selected' : '') + (extra || '') + '>' + label + '</option>';
        };
        return '<div class="cb2-skill-row' + (hasAuto ? ' locked' : '') + '">' +
          '<span class="nm">' + esc(s.name) + srcHtml + '</span>' +
          '<span class="bn" id="cb2c-sk-' + esc(s.name) + '">+0</span>' +
          '<select class="cb2-in" data-sk-sel="' + esc(s.name) + '">' +
          opt('未熟练', '未熟练', hasAuto ? ' disabled' : '') +
          opt('熟练', '熟练') +
          opt('专精', '专精') +
          '</select></div>';
      }).join('');
      return rows ? '<div class="cb2-skill-grp"><div class="cb2-skill-grp-t">' + esc(ab.name) + '<span class="ab">' + ab.short + '</span></div>' + rows + '</div>' : '';
    }).join('');
    box.innerHTML = html;
    updateDerived();
  }
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
      // 移除旧职业豁免（手动勾选的保留），实现切职业豁免动态切换
      st.saves = st.saves || {};
      st.manualSaves = st.manualSaves || {};
      st.saveSources = st.saveSources || {};
      (SAVE_RECS[oldCls] || []).forEach(function (k) {
        if (!st.manualSaves[k]) {
          st.saves[k] = false;
          // 移除旧职业来源记录（手动来源保留）
          if (st.saveSources[k]) st.saveSources[k] = st.saveSources[k].filter(function (x) { return x !== '职业·' + oldCls; });
        }
      });
    }
    st.cls = cls;
    if (cls !== '自定义') {
      // 2026-08-05 全站重构：职业技能熟练改为"可选熟练"——候选列表由玩家手动勾选 N 项，
      // 不再自动强制打开；不在候选范围内的技能不能通过职业来源选择（下拉已做限制）。
      // 豁免熟练仍为职业固定项（规则书表固定 2 项），自动赋予。
      st.saves = st.saves || {};
      st.manualSaves = st.manualSaves || {};
      st.saveSources = st.saveSources || {};
      (SAVE_RECS[cls] || []).forEach(function (k) {
        if (st.saves[k] || st.manualSaves[k]) { st.saves[k] = true; return; }
        st.saves[k] = true;
        // 自动来源记录（手动勾选过的保留手动来源）
        if (!st.manualSaves[k] && (!st.saveSources[k] || st.saveSources[k].indexOf('职业·' + cls) < 0)) {
          st.saveSources[k] = st.saveSources[k] || [];
          st.saveSources[k].push('职业·' + cls);
        }
      });
    }
    renderSkillQuota();
    renderSkillRows();
  }
  // ── 职业特性联动辅助（全等级表 + 副职）──
  // 将职业当前等级应解锁的特性并入 st.features（去重）
  function applyClassFeaturesToState(cls) {
    if (!cls || cls === '自定义') return;
    var lv = Number(st.level) || 1;
    var names = [];
    for (var i = 1; i <= lv; i++) names = names.concat(classFeaturesAt(cls, i));
    // 副职特性：若已选副职且达到对应等级，一并加入
    var sub = st.subclass;
    if (sub && SUBCLASSES[cls]) {
      var si = SUBCLASSES[cls].list[sub];
      if (si && si.feats) {
        Object.keys(si.feats).forEach(function (fl) {
          if (Number(fl) <= lv) si.feats[fl].forEach(function (f) { names.push(subclassFeatName(sub, f)); });
        });
      }
    }
    names.forEach(function (f) {
      if (f && st.features.indexOf(f) < 0) st.features.push(f);
    });
  }
  // 渲染职业页特性列表（当前等级已解锁 + 未来等级预览）
  function renderClsFeatHint() {
    var clsFeatEl = $id('cb2c-cls-features');
    if (!clsFeatEl) return;
    var profHintEl = $id('cb2c-cls-prof-hint');
    if (profHintEl) profHintEl.textContent = CLASS_PROF_HINT[st.cls] || '（自定义职业，手动选择）';
    var lv = Number(st.level) || 1;
    var lv1 = CLASS_LV1_FEATURES[st.cls] || [];
    var rows = [];
    // 当前等级特性（含副职占位替换）
    for (var i = 1; i <= lv; i++) {
      var names = classFeaturesAt(st.cls, i);
      if (i === 3 && SUBCLASSES[st.cls] && st.cls !== '牧师' && st.cls !== '德鲁伊' && st.cls !== '魔契师' && st.cls !== '术士') {
        names = names.filter(function (n) { return n !== '副职'; });
      }
      if (i === 2 && (st.cls === '德鲁伊' || st.cls === '法师')) {
        names = names.filter(function (n) { return n !== '副职'; });
      }
      if (i === 1 && (st.cls === '牧师' || st.cls === '魔契师' || st.cls === '术士')) {
        names = names.filter(function (n) { return n !== '副职'; });
      }
      if (names.length) {
        rows.push('<span class="cb2-cls-lv">' + i + '级</span>' + names.map(function (n) {
          var dd = lookupFeatDesc(n, st.cls);
          return (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({ name: n, type: 'cls', source: '职业·' + st.cls, desc: dd || n, title: n }) : '<span class="cb2-feat-chip" data-feat-name="' + esc(n) + '" data-feat-desc="' + encodeURIComponent(dd || n) + '">' + esc(n) + '</span>';
        }).join(''));
      }
    }
    // 副职选择器（达到副职等级才显示）
    var subSel = st.cls !== '自定义' && SUBCLASSES[st.cls] && lv >= SUBCLASSES[st.cls].level
      ? '<div class="cb2-subclass-box" style="margin-top:8px">' +
        '<div class="cb2-mini-label">副职（' + (SUBCLASSES[st.cls].level === 1 ? '1 级' : SUBCLASSES[st.cls].level + ' 级') + '解锁）· 已选：' + (st.subclass || '未选择') + '</div>' +
        '<div class="cb2-chiprow">' +
        Object.keys(SUBCLASSES[st.cls].list).map(function (sn) {
          var si = SUBCLASSES[st.cls].list[sn];
          return (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({ name: sn, type: 'subclass', active: st.subclass === sn, source: '副职', desc: si.desc || sn, dataAct: 'subclass', dataName: sn, title: sn }) : '<span class="cb2-chip' + (st.subclass === sn ? ' on' : '') + '" data-act="subclass" data-name="' + esc(sn) + '">' + esc(sn) + '</span>';
        }).join('') +
        '</div></div>'
      : '';
    // 未来等级预览（未达等级的特性淡显）
    var future = [];
    for (var fi = lv + 1; fi <= 20; fi++) {
      var fn = classFeaturesAt(st.cls, fi);
      if (fn.length) future.push(fn.join('、'));
    }
    var futureHtml = future.length
      ? '<div class="cb2-mini-label" style="margin-top:6px;color:var(--text-mute)">后续等级：' + esc(future.slice(0, 3).join(' ｜ ')) + (future.length > 3 ? '…' : '') + '</div>'
      : '';
    clsFeatEl.innerHTML =
      '<div class="cb2-mini-label">' + (st.cls === '自定义' ? '自定义职业' : '职业特性（' + lv + ' 级已解锁，点击可看描述）') + '</div>' +
      '<div class="cb2-feat-chiprow">' + (rows.length ? rows.join('') : '<span class="cb2-hint">（自定义职业）</span>') + '</div>' +
      subSel + futureHtml;
  }
  // 渲染副职选择器（职业页内，等级达标后显示）
  function renderSubclassSelect() {
    var box = container.querySelector('.cb2-subclass-box');
    if (!box) { renderClsFeatHint(); return; }
    var cls = st.cls;
    var sc = SUBCLASSES[cls];
    if (!sc || Number(st.level) < sc.level) {
      box.remove();
      return;
    }
    box.innerHTML =
      '<div class="cb2-mini-label">副职（' + (sc.level === 1 ? '1 级' : sc.level + ' 级') + '解锁）· 已选：' + (st.subclass || '未选择') + '</div>' +
      '<div class="cb2-chiprow">' +
      Object.keys(sc.list).map(function (sn) {
        var si = sc.list[sn];
        return '<span class="cb2-chip' + (st.subclass === sn ? ' on' : '') + '" data-act="subclass" data-name="' + esc(sn) + '" title="' + esc(si.desc) + '">' + esc(sn) + '</span>';
      }).join('') +
      '</div>';
  }
  // 选择副职：清旧副职特性 → 记录 → 加入新副职特性
  function applySubclass(name) {
    var cls = st.cls;
    var sc = SUBCLASSES[cls];
    if (!sc || !sc.list[name]) return;
    if (st.subclass === name) return;
    // 清旧副职特性
    if (st.subclass && sc.list[st.subclass]) {
      var oldFeats = sc.list[st.subclass].feats || {};
      Object.keys(oldFeats).forEach(function (lv) {
        oldFeats[lv].forEach(function (f) { removeFeatIfUnused(subclassFeatName(st.subclass, f)); });
      });
    }
    st.subclass = name;
    // 加入新副职特性（当前等级已解锁的）
    var lv = Number(st.level) || 1;
    var sf = sc.list[name].feats || {};
    Object.keys(sf).forEach(function (fl) {
      if (Number(fl) <= lv) sf[fl].forEach(function (f) {
        var fn = subclassFeatName(name, f);
        if (st.features.indexOf(fn) < 0) st.features.push(fn);
      });
    });
    renderClsFeatHint();
    refreshFeatList();
    updateDerived();
    try { showToast('已选择副职「' + name + '」，对应特性已加入角色', 'ok'); } catch (e) {}
  }
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
    renderSkillQuota();
    renderSkillRows();
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
  // 2026-08-05 全站重构：自定义背景"选择即生效"——每次交互自动应用（技能/工具/属性/装备），
  // 不再需要点击"应用此背景"按钮；来源统一标记「背景·自定义」。
  function applyCustomBgNow(silent) {
    var cbg3 = st.customBg || (st.customBg = { name: '', skills: [], tool: '', toolCat: '', equip: 'A', equipGold: 0, attr: '21' });
    st.background = '自定义背景';
    // 1) 重建自定义技能/工具来源（先移除旧的「背景·自定义」来源，再按当前配置添加）
    SKILLS.forEach(function (sk) {
      var srcs = st.skillSources && st.skillSources[sk.name] ? st.skillSources[sk.name] : [];
      if (srcs.indexOf('背景·自定义') >= 0) removeSkillSource(sk.name, '背景·自定义');
    });
    (st.toolProfs || []).slice().forEach(function (t) {
      var tsrcs = st.toolSources && st.toolSources[t] ? st.toolSources[t] : [];
      if (tsrcs.indexOf('背景·自定义') >= 0) removeToolSource(t, '背景·自定义');
    });
    (cbg3.skills || []).forEach(function (n) { addSkillSource(n, '背景·自定义'); });
    if (cbg3.tool) addToolSource(cbg3.tool, '背景·自定义');
    // 2) 属性提升：撤销旧提升后按当前配置重应用（骰点未分配完 → pending，分配完成后自动补）
    if (st.bgApplied) applyBgAttr(null);
    if (st.ruleVersion === '2024') {
      var aKeys = [];
      (cbg3.attrKeys || []).forEach(function (k) { if (k && aKeys.indexOf(k) < 0) aKeys.push(k); });
      var need = cbg3.attr === '111' ? 3 : 2;
      if (aKeys.length >= need) {
        applyBgAttr(cbg3.attr || '21', aKeys.slice(0, need));
      } else if (st.mode === 'rolled' && ABILITIES.some(function (a) { return st.scores[a.key] == null; })) {
        st.bgAttrPending = true;
      } else if (!silent) {
        try { showToast('请为每项属性加值选择属性（方案 ' + (cbg3.attr === '111' ? 'B：3 项各 +1' : 'A：+2 与 +1') + '）', 'error'); } catch (e) {}
      }
    }
    // 3) 装备
    if (cbg3.equip === 'B') {
      st.bgEquip = 'B'; st.bgGold = cbg3.gold || 50; st.bgAppliedItems = []; st.bgEquipData = null;
    } else {
      st.bgEquip = 'A';
      var its = (cbg3.items || []).map(function (n) { return { name: n, quantity: 1 }; });
      st.bgAppliedItems = its; st.bgGold = 0; st.bgEquipData = null;
    }
    renderSkillQuota();
    renderSkillRows();
    renderBgCard();
    updateDerived();
  }

  // 应用背景装备选项（A 套装 / B 金币）
  function applyBgEquip(opt) {    var eqOpts = st.bgEquipData || {};
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
        merged.push(buildCatalogItem(n, isArmor ? (armorCat(n) || '护甲') : (findEquipCat(n) || '杂物'), { quantity: names[n], equipped: isArmor && n === st.armor, free: true, freeQuantity: names[n], price: null }));
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
      // 属性选择器（方案A两个下拉 / 方案B三个下拉，值存 cb.attrKeys 中文名数组）
      // 规则：+2/+1 与 +1×3 不能落在同一属性上 —— 下拉提供「— 选择 —」空项，已选属性在其他下拉中禁用
      var cbAttrSelHtml = '';
      if (cb.attr) {
        var attrCnt = cb.attr === '21' ? 2 : 3;
        var attrLabels = cb.attr === '21' ? ['主属性 (+2)', '副属性 (+1)'] : ['属性 1', '属性 2', '属性 3'];
        var attrKeys = cb.attrKeys || [];
        for (var ai = 0; ai < attrCnt; ai++) {
          var curKey = attrKeys[ai] || '';
          cbAttrSelHtml += '<label class="cb2-mini-label">' + attrLabels[ai] + '</label><select class="cb2-in cb2-in-sm" data-cbg-attrkey data-idx="' + ai + '" style="max-width:112px">' +
            '<option value="">— 选择 —</option>' +
            ABILITIES.map(function (a) {
              var taken = false;
              for (var ti = 0; ti < attrCnt; ti++) {
                if (ti !== ai && attrKeys[ti] === a.name) taken = true;
              }
              return '<option value="' + a.name + '"' + (curKey === a.name ? ' selected' : '') + (taken ? ' disabled' : '') + '>' + a.name + '</option>';
            }).join('') +
            '</select>';
        }
      }
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
        (st.ruleVersion === '2024' && cb.attr ? '<div class="cb2-bg-cell full"><label>' + (cb.attr === '21' ? '指定属性：主 +2 / 副 +1' : '指定属性：三项各 +1') + '</label><div class="cb2-row" style="gap:6px;flex-wrap:wrap">' + cbAttrSelHtml + '</div></div>' : '') +
        '<div class="cb2-bg-cell full" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<span class="cb2-mini-label" style="color:var(--green-l);margin:0">✓ 选择即生效：技能/工具/装备/属性提升实时应用，来源标记「背景·自定义」</span>' +
        '</div>' +
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
      gridCells += '<div class="cb2-bg-cell"><label>起源专长</label><div>' + ((window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({ name: feat, type: 'bg', source: '背景·' + bg, desc: featDesc || feat, title: feat }) : '<span class="cb2-feat-chip">' + esc(feat) + '</span>') + '</div></div>';
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
          // ── 层级1：手动逐次掷骰（已掷组列表 + 掷骰按钮，上限5组） ──
          var setsHtml = st.rollSets.length
            ? '<div class="cb2-rollset-grid">' + st.rollSets.map(function (rs, i) {
              return '<button type="button" class="cb2-rollset-card" data-act="roll-pick-set" data-i="' + i + '" title="使用第 ' + (i + 1) + ' 组并分配属性">' +
                '<div class="cb2-rollset-t"><span>第 ' + (i + 1) + ' 组</span><span class="cb2-rollset-sum">合计 ' + rollSetSum(rs) + '</span></div>' +
                '<div class="cb2-rollset-chips">' + rs.pool.map(function (v) { return '<span>' + v + '</span>'; }).join('') + '</div>' +
                (rs.detail ? '<div class="cb2-rollset-dice">' + rs.detail.map(function (d) { return d.sum; }).join(' · ') + '</div>' : '') +
                '</button>';
            }).join('') + '</div>'
            : '<div class="cb2-hint" style="margin-bottom:6px">🎲 尚未掷骰 —— 点击下方按钮逐次掷出一组属性（4d6 去最低 ×6）。不满意可继续掷下一组，最多 5 组。</div>';
          var canRoll = st.rollTimes < 5;
          poolWrap.innerHTML = setsHtml +
            '<div class="cb2-rollset-back">' +
            '<button type="button" class="cb2-btn gold sm" data-act="roll-new-set"' + (canRoll ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>' +
            (canRoll ? '🎲 掷出第 ' + (st.rollTimes + 1) + ' 组属性（4d6×6）' : '⏳ 已达 5 组上限（点击某组使用）') + '</button>' +
            '<span class="cb2-rollset-cur">已掷 <b>' + st.rollTimes + '</b>/5 组</span>' +
            '</div>' +
            (st.rollSets.length ? '<div class="cb2-pool-msg">点击一组进入属性分配；不满意可继续掷下一组（最多 5 组）。</div>' : '');
        } else {
          // ── 层级2：当前组骰池 + 4d6 过程 + 返回重选 ──
          var rsCur = st.rollSets[st.rollPick];
          var detailHtml = '';
          if (rsCur && rsCur.detail) {
            detailHtml = '<div class="cb2-rollset-detail">' + rsCur.detail.map(function (d, di) {
              return '<span class="cb2-rsd" title="掷出的 4 个骰子：' + d.dice.join(', ') + '，去掉最低 ' + d.dice[0] + '">' +
                (di + 1) + ': <i>' + d.dice.join('+') + '</i> → <b>' + d.sum + '</b></span>';
            }).join('') + '</div>';
          }
          poolWrap.innerHTML =
            '<div class="cb2-rollset-back"><button type="button" class="cb2-btn sm" data-act="roll-back">← 返回掷骰/重选</button>' +
            '<span class="cb2-rollset-cur">第 <b>' + (st.rollPick + 1) + ' 组</b> · 合计 ' + rollSetSum(st.rollSets[st.rollPick]) + '</span>' +
            '<span class="cb2-rollset-cur" style="color:var(--text-3)">4d6 去最低过程：</span></div>' +
            detailHtml +
            '<div class="cb2-pool" data-pool="1">' + st.rolledPool.map(function (v, i) {
              // 2026-08-06：骰值可拖拽到属性槽分配（也可点击选中后点击分配）
              return '<button type="button" class="cb2-pool-chip' + (st.pickedIdx === i ? ' sel' : '') + '" draggable="true" data-act="pick-pool" data-i="' + i + '" data-pool-val="' + v + '" title="拖动到属性槽分配，或点击选中后再点击属性槽">' + v + '</button>';
            }).join('') + '</div>' +
            '<div class="cb2-pool-msg">' + (st.pickedIdx >= 0 ? '已选中 <b>' + st.rolledPool[st.pickedIdx] + '</b>，点击上方属性槽分配；或再点骰值取消。' : '把骰值<b>拖到</b>属性槽分配；或点击骰值选中后点击属性槽。') + '</div>';
        }
      }
      if (extraEl) extraEl.innerHTML = ''; // 骰点不可重掷：掷骰由上方按钮控制
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
    // 豁免区（2026-08-05：显示来源标签——职业固定项/手动勾选；切职业自动移除）
    var savesEl = $id('cb2c-saves');
    if (savesEl) {
      st.saveSources = st.saveSources || {};
      savesEl.innerHTML = ABILITIES.map(function (a) {
        var srcs = st.saveSources[a.key] || [];
        var srcTxt = srcs.length ? '<em>' + esc(srcs.join('+')) + '</em>' : '';
        return '<label class="cb2-save"><input type="checkbox" data-save="' + a.key + '"' + (st.saves[a.key] ? ' checked' : '') + '>' + esc(a.name) + '豁免' + srcTxt + '</label>';
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
      } else if (st.bgAttrPending && st.mode === 'rolled') {
        // 2026-08-05 全站重构：骰点模式 + 属性未分配完 → 显示"待应用"预览（分配完成后自动应用）
        var pInfo = BACKGROUNDS[st.background];
        var pKeys = [];
        var pMode = '21';
        if (pInfo) { pKeys = pInfo.abilities.slice(0, 2); }
        else if (st.customBg) {
          pMode = st.customBg.attr === '111' ? '111' : '21';
          pKeys = (st.customBg.attrKeys || []).filter(Boolean).slice(0, pMode === '111' ? 3 : 2);
        }
        var pTxt = pMode === '21'
          ? (pKeys[0] ? pKeys[0] + ' +2' : '? +2') + '、' + (pKeys[1] ? pKeys[1] + ' +1' : '? +1')
          : pKeys.map(function (k) { return (k || '?') + ' +1'; }).join('、');
        bonusEl.style.display = '';
        bonusEl.innerHTML = '<span class="cb2-bonus-ic">📜</span> 背景「' + esc(st.background === '自定义背景' && st.customBg ? (st.customBg.name || '自定义背景') : st.background) + '」加值 <b>待应用</b>：' +
          '<b>' + esc(pTxt) + '</b>' +
          '<span class="cb2-bonus-tip">完成六项属性分配后自动应用</span>';
      } else {
        bonusEl.style.display = 'none';
        bonusEl.innerHTML = '';
      }
    }
  }

  // ── 法术区渲染（精简化：先选环位 → 再以列表勾选该环位法术；chip 悬浮显示效果）──
  // ── 2026-08-06：完整法术信息（rule_spells_full.json 优先，回退 schools 简项）──
  function spellFullInfo(sp) {
    var spellName = sp && typeof sp === 'object' ? sp.name : sp;
    var f = st.spellsFull ? (st.spellsFull[spellName] || null) : null;
    if (!f && st.spellsFull && String(spellName).indexOf('/') >= 0) {
      var parts = String(spellName).split('/');
      for (var pi = 0; pi < parts.length; pi++) {
        if (st.spellsFull[parts[pi]]) { f = st.spellsFull[parts[pi]]; break; }
      }
    }
    if (!f && st.schoolByName) {
      var info = st.schoolByName[spellName] || null;
      if (!info && String(spellName).indexOf('/') >= 0) {
        var parts2 = String(spellName).split('/');
        for (var pj = 0; pj < parts2.length; pj++) {
          if (st.schoolByName[parts2[pj]]) { info = st.schoolByName[parts2[pj]]; break; }
        }
      }
      if (info) {
        f = { school: info.school, level: info.level, castingTime: info.castingTime, range: info.range, components: info.components, duration: info.duration, concentration: info.concentration, ritual: info.ritual, desc: info.desc || '' };
      }
    }
    return f || null;
  }
  function spellVersionAllowed(sp) {
    var name = sp && typeof sp === 'object' ? sp.name : String(sp || '');
    var info = spellFullInfo(name);
    if (st.ruleVersion === '2024') {
      // 2024 角色表不混入仅属于 2014 的同名旧版条目；改名法术使用 2024 正式名称。
      if (name === '印记斩') return false;
      if (info && String(info.source || '').toUpperCase() === 'PHB14') return false;
    }
    if (st.ruleVersion === '2014' && name === '闪耀斩') return false;
    return true;
  }
  function versionSpellList(list) { return (Array.isArray(list) ? list : []).filter(spellVersionAllowed); }
  // 完整法术信息文本（标签浮动详情/悬浮窗用，非简报）
  function spellDetailText(sp) {
    var f = spellFullInfo(sp);
    if (!f) return '';
    var parts = [];
    if (f.level !== undefined) parts.push((f.level === 0 ? '戏法' : f.level + '环') + ' · ' + (f.school || '未知学派'));
    if (f.castingTime) parts.push('施法时间：' + f.castingTime);
    if (f.range) parts.push('距离：' + f.range);
    if (f.components) parts.push('成分：' + f.components);
    if (f.duration) parts.push('持续时间：' + f.duration);
    if (f.concentration) parts.push('【专注】');
    if (f.ritual) parts.push('【仪式】');
    var head = parts.join('\n');
    var desc = String(f.desc || '').trim();
    return head + (desc ? '\n\n' + desc : '');
  }

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
      var arr = versionSpellList(lists[String(lv)] || lists[lv] || []);
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

    // 当前环位法术：按学派分组显示（2026-08-05 全站重构：塑能/防护/咒法/预言/惑控/幻术/死灵/变化）
    var curRing = st.spellRing;
    var arr = versionSpellList(lists[String(curRing)] || lists[curRing] || []);
    // 查学派（规则书速查数据 → 名称映射；复合名如"目盲术/耳聋术"按 "/" 拆分匹配）
    function lookupSchool(sp) {
      var info = st.schoolByName ? st.schoolByName[sp] : null;
      if (info) return info.school || '';
      var parts = String(sp).split('/');
      for (var pi = 0; pi < parts.length; pi++) {
        var pinfo = st.schoolByName ? st.schoolByName[parts[pi]] : null;
        if (pinfo && pinfo.school) return pinfo.school;
      }
      return '';
    }
    function lookupSpellInfo(sp) { return st.schoolByName ? (st.schoolByName[sp] || null) : null; }
    var SCHOOL_ORDER = ['塑能', '防护', '咒法', '预言', '惑控', '幻术', '死灵', '变化'];
    var schoolGroups = {};
    var noSchool = [];
    arr.forEach(function (sp) {
      var sc = lookupSchool(sp);
      if (sc && SCHOOL_ORDER.indexOf(sc) >= 0) {
        if (!schoolGroups[sc]) schoolGroups[sc] = [];
        schoolGroups[sc].push(sp);
      } else {
        noSchool.push(sp);
      }
    });
    var SCHOOL_TONE = { '塑能': 'weapon', '防护': 'armor', '咒法': 'wondrous', '预言': 'info', '惑控': 'status', '幻术': 'effect', '死灵': 'feat', '变化': 'spell' };
    // 2026-08-06：法术标签统一为宿主原生 TrpgTag（保留交互 data-act/data-name/data-level，悬浮显示完整法术信息）
    var TG = window.TrpgTag || null;
    function spellChipHtml(sp, isOn, curRing) {
      var detailText = spellDetailText(sp);
      if (TG && typeof TG.chip === 'function') {
        var chip = TG.chip({
          name: sp,
          type: 'spell',
          active: isOn,
          desc: detailText || sp,
          dataAct: 'spell',
          dataName: sp,
          title: sp
        });
        // TrpgTag 无 data-level 参数，渲染后注入（点击选择用环位）
        chip = chip.replace('<span class="tg', '<span data-level="' + curRing + '" class="tg');
        return chip;
      }
      return '<span class="cb2-chip' + (isOn ? ' on' : '') + '" data-act="spell" data-name="' + esc(sp) + '" data-level="' + curRing + '" data-tg-desc="' + encodeURIComponent(detailText || sp) + '">' + esc(sp) + '</span>';
    }
    var chipHtml = '<div class="cb2-spell-groups">';
    var hasAny = false;
    SCHOOL_ORDER.forEach(function (sc) {
      var list = schoolGroups[sc];
      if (!list || !list.length) return;
      hasAny = true;
      var selN = list.filter(function (sp) { return st.spellList.some(function (s) { return s.name === sp && Number(s.level) === curRing; }); }).length;
      chipHtml += '<div class="cb2-spell-grp"><div class="cb2-grp-t"><span class="cb2-school-tag">' + esc(sc) + '</span><b>' + list.length + '</b> 个<span class="cnt">已选 ' + selN + '</span></div><div class="cb2-chiprow">' +
        list.map(function (sp) {
          var isOn = st.spellList.some(function (s) { return s.name === sp && Number(s.level) === curRing; });
          return spellChipHtml(sp, isOn, curRing);
        }).join('') + '</div></div>';
    });
    if (noSchool.length) {
      hasAny = true;
      var selN2 = noSchool.filter(function (sp) { return st.spellList.some(function (s) { return s.name === sp && Number(s.level) === curRing; }); }).length;
      chipHtml += '<div class="cb2-spell-grp"><div class="cb2-grp-t"><span class="cb2-school-tag">其他</span><b>' + noSchool.length + '</b> 个<span class="cnt">已选 ' + selN2 + '</span></div><div class="cb2-chiprow">' +
        noSchool.map(function (sp) {
          var isOn = st.spellList.some(function (s) { return s.name === sp && Number(s.level) === curRing; });
          return spellChipHtml(sp, isOn, curRing);
        }).join('') + '</div></div>';
    }
    if (!hasAny) chipHtml += '<span class="cb2-hint" style="color:var(--text-mute)">该环位暂无列表法术（可手动添加）</span>';
    chipHtml += '</div>';
    // 已选法术汇总（TrpgTag 标签 + 移除按钮，2026-08-06 统一原生风格）
    var selectedHtml = '<div class="cb2-selected-box"><div class="lb">已选法术（' + st.spellList.length + '）</div><div class="cb2-selected">' +
      (st.spellList.length ? st.spellList.map(function (s, i) {
        var dt = spellDetailText(s.name);
        if (TG && typeof TG.chip === 'function') {
          return TG.chip({
            name: s.name,
            type: 'spell',
            active: true,
            extra: (Number(s.level) === 0 ? '戏法' : Number(s.level) + '环'),
            desc: dt || s.name,
            removable: true,
            rmAct: 'spell-del',
            dataI: i,
            dataName: s.name,
            title: s.name
          });
        }
        return '<span class="cb2-sel-chip">' + (Number(s.level) === 0 ? '戏法' : Number(s.level) + '环') + ' ' + esc(s.name) +
          '<button type="button" class="rm" data-act="spell-del" data-i="' + i + '">✕</button></span>';
      }).join('') : '<span style="color:var(--text-mute);font-size:11px">尚未选择任何法术</span>') + '</div></div>';

    // 2026-08-06：上限可视化（进度条：已选/上限/剩余，超限红色警示）
    function limitBar(label, used, max, hint) {
      var p = max > 0 ? Math.min(100, Math.round(used / max * 100)) : 0;
      var over = used > max;
      return '<div class="cb2-limit-row" title="' + esc(hint || '') + '"><span class="lb">' + label + '</span>' +
        '<div class="cb2-bar"><div class="cb2-bar-fill' + (over ? ' over' : '') + '" style="width:' + p + '%"></div></div>' +
        '<span class="cnt' + (over ? ' over' : '') + '">' + used + ' / ' + max + (over ? ' ⚠超限' : '') + '</span></div>';
    }
    var usedCount = st.spellList.length;
    var cantripCount = st.spellList.filter(function (s) { return Number(s.level) === 0; }).length;
    var nonCantrip = usedCount - cantripCount;
    var limitHtml = '<div class="cb2-mini-label">' +
      limitBar('戏法', cantripCount, cantripMax, '戏法上限：' + esc(cls) + '基础 ' + (CANTRIP_BASE[cls] || 0) + '，每 4 级 +1（当前 Lv' + st.level + '）') +
      limitBar('准备法术', nonCantrip, prepMax, '准备上限：' + (castStat ? esc(castStat.toUpperCase()) : '') + ' 修正 ' + castMod + ' + 等级 ' + Math.max(1, st.level) + '（至少 1）') +
      '</div>';

    var manualHtml = '<div class="cb2-row" style="margin-top:8px">' +
      '<input type="text" class="cb2-in" id="cb2c-spell-input" placeholder="输入法术名（自动匹配职业法术表环位）" list="cb2c-spell-dl" style="flex:1">' +
      '<datalist id="cb2c-spell-dl">' + allSpellNames(lists).map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
      '<select class="cb2-in cb2-in-sm" id="cb2c-spell-level"><option value="0">戏法</option>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (r) { return '<option value="' + r + '">' + r + '环</option>'; }).join('') +
      '</select>' +
      '<button type="button" class="cb2-btn gold sm" data-act="spell-add">＋ 添加</button>' +
      '</div>';

    body.innerHTML = ringTabs + chipHtml + selectedHtml + limitHtml + manualHtml;
    if (count) count.textContent = '已选 ' + usedCount + ' 个' + warn;
  }

  // ── 装备区渲染（起始装备：2024 职业表「选 A/B/C」套装选项 + 类别浏览补充）──
  // 装备表全部条目名（用于手动输入 datalist 建议）
  function allEquipNames() {
    var names = [];
    if (st.equipData && st.equipData.equipment) {
      Object.keys(st.equipData.equipment).forEach(function (cat) {
        (st.equipData.equipment[cat] || []).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
      });
    }
    return names;
  }
  // 从装备表中按名称反查类别（未命中返回 null）
  function findEquipCat(name) {
    if (!st.equipData || !st.equipData.equipment) return null;
    var hit = null;
    Object.keys(st.equipData.equipment).forEach(function (cat) {
      if (hit) return;
      if ((st.equipData.equipment[cat] || []).indexOf(name) >= 0) hit = cat;
    });
    return hit;
  }
  // 职业法术表全部法术名（用于手动输入 datalist 建议）
  function allSpellNames(lists) {
    var names = [];
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (lv) {
      var arr = lists ? (lists[String(lv)] || lists[lv] || []) : [];
      arr.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    });
    return names;
  }
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
      merged.push(buildCatalogItem(n, isArmor ? (armorCat(n) || '护甲') : (findEquipCat(n) || '杂物'), { quantity: names[n], equipped: isArmor && n === st.armor, free: true, freeQuantity: names[n], price: null }));
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
  // 金币格式化：≥1 显示 GP，<1 转 SP/CP
  function fmtGP(gp) {
    gp = Number(gp) || 0;
    if (gp >= 1) return (gp % 1 === 0 ? gp : gp.toFixed(2)) + ' GP';
    var sp = gp * 10;
    if (sp >= 1) return (sp % 1 === 0 ? sp : sp.toFixed(2)) + ' SP';
    return Math.round(gp * 100) + ' CP';
  }
  // 物品单价（GP）：价格表 → 手动项为 0
  function itemPrice(name) {
    if (!name || !st.equipPrices) return null;
    var p = st.equipPrices[name];
    return (p == null || p === '') ? null : Number(p);
  }
  // 由规则数据构造正式背包条目：购买/获得时即带上武器、护甲、套组与价格信息，
  // 后续角色卡、AI、战斗结算只读取同一份物品对象，不再靠名称临时猜测。
  function buildCatalogItem(name, category, opts) {
    opts = opts || {};
    var item = Object.assign({
      name: name,
      category: category || findEquipCat(name) || '杂物',
      quantity: Math.max(1, Number(opts.quantity) || 1),
      equipped: !!opts.equipped,
      price: opts.price != null ? opts.price : itemPrice(name),
      free: !!opts.free,
      freeQuantity: Math.max(0, Number(opts.freeQuantity) || 0)
    }, opts);
    var wp = st.wpnPropsByName ? st.wpnPropsByName[name] : null;
    if (wp) {
      item.category = item.category || '武器';
      item.damageFormula = item.damageFormula || wp.damage || '';
      item.damageType = item.damageType || wp.damageType || '';
      item.properties = Array.isArray(wp.properties) ? wp.properties.slice() : [];
      item.mastery = item.mastery || wp.mastery || '';
      item.weight = item.weight || wp.weight || '';
      item.attackAbility = item.attackAbility || ((String(item.category).indexOf('远程') >= 0 || item.properties.indexOf('灵巧') >= 0) ? '敏捷' : '力量');
      item.addAbilityToDamage = item.addAbilityToDamage !== false;
      item.desc = item.desc || [item.damageFormula ? '伤害 ' + item.damageFormula + ' ' + item.damageType : '', item.properties.length ? '属性：' + item.properties.join('、') : '', item.mastery ? '精通：' + item.mastery : ''].filter(Boolean).join('\n');
    }
    var ai = ARMOR_INFO[name];
    if (ai) {
      item.category = armorCat(name) || item.category || '护甲';
      item.baseAC = ai.baseAC;
      item.maxDex = ai.maxDex;
      item.strReq = ai.strReq || 0;
      item.desc = item.desc || '护甲等级 ' + ai.baseAC + (ai.maxDex < 10 ? '；敏捷加值上限 +' + ai.maxDex : '') + (ai.strReq ? '；力量需求 ' + ai.strReq : '');
    }
    var kit = st.kitData && st.kitData[name];
    if (kit) {
      item.category = '冒险套组';
      item.contents = Array.isArray(kit.contents) ? kit.contents.slice() : [];
      if ((item.price == null || item.price === '') && kit.price != null) item.price = Number(kit.price);
      item.desc = item.desc || (item.contents.length ? '包含：' + item.contents.join('、') : '规则套组');
    }
    return item;
  }
  function chargeableQuantity(it) {
    var qty = Math.max(1, Number(it && it.quantity) || 1);
    if (!it || !it.free) return qty;
    return Math.max(0, qty - Math.max(0, Number(it.freeQuantity) || 0));
  }
  // 起始金币总额：职业选项金币 + 背景金币
  function goldBudget() {
    if (editData) return Number(st.goldStart) || 0;
    return (Number(st.equipGold) || 0) + (Number(st.bgGold) || 0);
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
    var startRow = editData ? '' : ('<div class="cb2-start-row">' +
      '<div class="info">职业熟练：<b>' + esc(profHint || '（自定义职业，手动选择）') + '</b></div>' +
      (optHtml ? optHtml : '') +
      '</div>' + clsToolHtml);
    // 当前护甲（2026-08-06：护甲选择限制为背包内已有护甲；购买后自动可选并装备）
    var ownArmor = st.items.filter(function (it) { return ARMOR_LIST.indexOf(it.name) >= 0; }).map(function (it) { return it.name; });
    var armorOptions = ['无甲'];
    if (st.armor && st.armor !== '无甲' && ownArmor.indexOf(st.armor) < 0) {
      // 旧数据兜底：当前装备的甲不在背包（历史角色），补进背包避免丢失
      st.items.push(buildCatalogItem(st.armor, armorCat(st.armor) || '护甲', { quantity: 1, price: itemPrice(st.armor), free: true, freeQuantity: 1, equipped: true }));
      ownArmor.push(st.armor);
    }
    ownArmor.forEach(function (m) { if (armorOptions.indexOf(m) < 0) armorOptions.push(m); });
    var armorSelHtml = '<div class="cb2-start-row" style="margin-top:6px">' +
      '<div class="info">当前护甲：<b>' + esc(st.armor || '无甲') + '</b>' +
      '<span style="color:var(--text-3)">（只能选择背包中已有的护甲；AC 自动计算）</span></div>' +
      '<select class="cb2-in" id="cb2c-armor" style="max-width:220px">' +
      armorOptions.map(function (m) {
        var tip = m === '无甲' ? '' : ' (AC ' + ARMOR_INFO[m].baseAC + (ARMOR_INFO[m].maxDex < 10 ? ' 敏限+' + ARMOR_INFO[m].maxDex : '') + ')';
        return '<option value="' + esc(m) + '"' + (st.armor === m ? ' selected' : '') + '>' + esc(m) + tip + '</option>';
      }).join('') + '</select>' +
      (ownArmor.length ? '' : '<span style="color:var(--amber);font-size:11px">⚠ 背包中没有护甲 — 请从下方护甲类别中购买（如皮甲 10GP）</span>') +
      '<label class="cb2-save" style="font-size:12px"><input type="checkbox" id="cb2c-shield"' + (st.shield ? ' checked' : '') + '> 🛡 持盾 (+2 AC)</label>' +
      '</div>';
    // 已选物品（含自动预填）——金币账本：起始总额 = 职业选项金币 + 背景金币；点选购买扣减
    var budget = goldBudget();
    var spent = 0;
    st.items.forEach(function (it) {
      if (it.price != null && it.price > 0) spent += Number(it.price) * chargeableQuantity(it);
    });
    st.goldStart = budget;
    st.goldSpent = spent;
    st.goldRemain = Math.max(0, budget - spent);
    var over = spent > budget;
    var walletCell = editData
      ? '<label class="cb2-gl-cell">💰 当前钱包 <input id="cb2c-wallet" class="cb2-in cb2-in-sm" type="number" min="0" step="0.01" value="' + budget + '" style="width:92px;margin-left:6px"> GP<span class="cb2-gl-src">可直接调整现行角色持有金币</span></label>'
      : '<span class="cb2-gl-cell">💰 起始金币 <b>' + fmtGP(budget) + '</b><span class="cb2-gl-src">职业选项 ' + fmtGP(st.equipGold || 0) + (st.bgGold ? ' + 背景 ' + fmtGP(st.bgGold) : '') + '</span></span>';
    var goldHtml = '<div class="cb2-gold-ledger">' + walletCell +
      '<span class="cb2-gl-cell">本次采购 <b style="color:' + (over ? 'var(--red-l)' : 'var(--gold-l)') + '">' + fmtGP(spent) + '</b></span>' +
      '<span class="cb2-gl-cell">保存后余额 <b style="color:' + (over ? 'var(--red-l)' : 'var(--green-l)') + '">' + fmtGP(st.goldRemain) + '</b>' + (over ? ' ⚠超支' : '') + '</span>' +
      '</div>';
    // 2026-08-06：正规背包——条目化长条列表（名称/类别/数量±/单价/总价/装备状态/移除），条目悬浮显示完整详情
    var selHtml = '<div class="cb2-selected-box"><div class="lb">🎒 背包（' + st.items.length + ' 件）· 点击条目查看详情，数量可增减，护甲/武器可装备</div><div class="cb2-inv-list">' +
      (st.items.length ? st.items.map(function (it, i) {
        var isArmor = ARMOR_LIST.indexOf(it.name) >= 0;
        var isWeapon = it.category === '武器' || (it.category && String(it.category).indexOf('武器') >= 0);
        var qty = Number(it.quantity) || 1;
        var unit = it.price != null ? Number(it.price) : null;
        var total = unit != null ? Math.round(unit * qty * 100) / 100 : null;
        var equipped = isArmor ? (st.armor === it.name) : (it.equipped === true);
        var descParts = [it.category || '杂物'];
        if (unit != null) descParts.push('单价 ' + fmtGP(unit));
        if (it.free) descParts.push('赠送');
        if (it.desc) descParts.push(String(it.desc));
        var wp = st.wpnPropsByName ? st.wpnPropsByName[it.name] : null;
        if (wp) {
          if (wp.damage) descParts.push('伤害 ' + wp.damage + ' ' + (wp.damageType || ''));
          if (wp.properties && wp.properties.length) descParts.push('属性 ' + wp.properties.join('/'));
          if (wp.mastery) descParts.push('精通 ' + wp.mastery);
        }
        var tgType = isWeapon ? 'weapon' : (isArmor ? 'armor' : (it.category === '冒险套组' ? 'wondrous' : (it.category === '卷轴' ? 'spell' : 'item')));
        var itemTag = (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({
          name: it.name,
          type: tgType,
          extra: '×' + qty,
          source: equipped ? '已装备' : (it.free ? '已持有' : '本次采购'),
          meta: { '类别': it.category || '杂物', '数量': qty, '单价': unit != null ? fmtGP(unit) : '—', '总价': total != null ? fmtGP(total) : '—' },
          desc: descParts.join('\n'),
          title: it.name
        }) : '<span class="cb2-inv-name' + (equipped ? ' eq' : '') + '">' + esc(it.name) + (equipped ? ' ◈' : '') + '</span>';
        return '<div class="cb2-inv-row">' + itemTag +
          '<span class="cb2-inv-cat">' + esc(it.category || '杂物') + '</span>' +
          '<span class="cb2-inv-qty"><button type="button" class="cb2-btn sm" data-act="qty-minus" data-i="' + i + '" title="减少数量">−</button>' +
          '<b>' + qty + '</b>' +
          '<button type="button" class="cb2-btn sm" data-act="qty-plus" data-i="' + i + '" title="增加数量">＋</button></span>' +
          '<span class="cb2-inv-price">' + (unit != null ? fmtGP(unit) : '—') + (total != null && qty > 1 ? ' · ' + fmtGP(total) : '') + '</span>' +
          ((isArmor || isWeapon) ? '<button type="button" class="cb2-btn sm' + (equipped ? ' gold' : '') + '" data-act="equip-toggle" data-i="' + i + '" title="' + (equipped ? '卸下' : '装备' + (isArmor ? '（AC自动更新）' : '')) + '">' + (equipped ? '已装备' : '装备') + '</button>' : '<span class="cb2-inv-cat" style="color:var(--text-3)">—</span>') +
          '<button type="button" class="cb2-btn sm danger" data-act="equip-del" data-i="' + i + '" title="移除">✕</button>' +
          '</div>';
      }).join('') : '<span style="color:var(--text-mute);font-size:11px">背包为空 — ' + (editData ? '从下方类别中添加物品' : '点击上方起始装备选项（A/B/C）或从下方类别中选择购买') + '</span>') +
      '</div>' + goldHtml + '</div>';
    // 类别浏览补充（来自规则装备表；2026-08-05：武器条目附加属性细分标签——单手/双手/多用/灵巧/重型…）
    var html = startRow + armorSelHtml + selHtml;
    if (st.equipData && st.equipData.equipment) {
      var eq = st.equipData.equipment;
      var keys = Object.keys(eq);
      var catHtml = '';
      keys.forEach(function (cat) {
        var rawArr = eq[cat];
        if (!Array.isArray(rawArr) || !rawArr.length) return;
        // 套组有独立的数据驱动分组，避免同一物品又散落在“冒险装备”里重复出现。
        var arr = rawArr.filter(function (nm) { return !(st.kitData && st.kitData[nm]); });
        if (!arr.length) return;
        var selN = st.items.filter(function (it) { return it.category === cat && !(st.kitData && st.kitData[it.name]); }).length;
        var catTotal = 0;
        arr.forEach(function (nm) { var p = itemPrice(nm); if (p != null) catTotal += p; });
        catHtml += '<div class="cb2-grp"><div class="cb2-grp-t">' + esc(cat) + ' <b>' + arr.length + '</b>' +
          '<span class="cnt">已选 ' + selN + ' · 单件 ' + (catTotal ? fmtGP(catTotal) : '—') + '</span></div><div class="cb2-chiprow">' +
          arr.map(function (it) {
            var isOn = st.items.some(function (x) { return x.name === it; });
            var isArmor = cat === '轻甲' || cat === '中甲' || cat === '重甲';
            var pr = itemPrice(it);
            var preview = buildCatalogItem(it, cat, false);
            var wp = st.wpnPropsByName ? st.wpnPropsByName[it] : null;
            var isWeapon = !!wp || String(cat).indexOf('武器') >= 0;
            var desc = [];
            if (preview.desc) desc.push(preview.desc);
            if (wp) {
              if (wp.damage) desc.push('伤害：' + wp.damage + ' ' + (wp.damageType || ''));
              if (wp.properties && wp.properties.length) desc.push('武器属性：' + wp.properties.join('、'));
              if (wp.mastery) desc.push('精通：' + wp.mastery);
              if (wp.weight) desc.push('重量：' + wp.weight);
            }
            if (isArmor) {
              if (preview.baseAC != null) desc.push('基础 AC：' + preview.baseAC);
              if (preview.maxDexBonus != null) desc.push('敏捷加值上限：' + preview.maxDexBonus);
              if (preview.strengthRequirement) desc.push('力量需求：' + preview.strengthRequirement);
            }
            return (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({
              name: it,
              type: isWeapon ? 'weapon' : (isArmor ? 'armor' : 'item'),
              active: isOn,
              extra: (isArmor && st.armor === it ? '◈ ' : '') + (pr != null ? fmtGP(pr) : ''),
              source: cat,
              meta: { '类别': cat, '价格': pr != null ? fmtGP(pr) : '—', '持有': isOn ? '是' : '否' },
              desc: desc.join('\n') || '规则装备条目',
              title: it,
              dataAct: 'item',
              dataName: it,
              dataCat: cat
            }) : '<span class="cb2-chip' + (isOn ? ' on' : '') + '" data-act="item" data-name="' + esc(it) + '" data-cat="' + esc(cat) + '">' + esc(it) + '</span>';
          }).join('') + '</div></div>';
      });
      if (catHtml) {
        // 2026-08-06：套组归类——冒险装备中的「XX套组」单独分组展示（带内容清单悬浮详情）
        var kitHtml = '';
        if (st.kitData) {
          var kitNames = Object.keys(st.kitData);
          var inCat = {};
          arr = null;
          Object.keys(eq).forEach(function (c2) {
            (eq[c2] || []).forEach(function (nm) { if (kitNames.indexOf(nm) >= 0) inCat[nm] = c2; });
          });
          if (Object.keys(inCat).length) {
            kitHtml = '<div class="cb2-grp"><div class="cb2-grp-t">🎒 冒险套组 <b>' + Object.keys(inCat).length + '</b><span class="cnt">内容清单见悬浮详情</span></div><div class="cb2-chiprow">' +
              kitNames.map(function (kn) {
                var kd = st.kitData[kn];
                var isOn = st.items.some(function (x) { return x.name === kn; });
                var kitCat = inCat[kn] || '冒险装备';
                var kitDesc = kd && kd.contents && kd.contents.length ? '完整内容：' + kd.contents.join('、') : '规则数据中尚无套组内容清单';
                return (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({
                  name: kn,
                  type: 'wondrous',
                  active: isOn,
                  extra: kd && kd.price != null ? fmtGP(kd.price) : '',
                  source: '冒险套组',
                  meta: { '类别': kitCat, '价格': kd && kd.price != null ? fmtGP(kd.price) : '—', '物品数': kd && kd.contents ? kd.contents.length : 0, '持有': isOn ? '是' : '否' },
                  desc: kitDesc,
                  title: kn,
                  dataAct: 'item',
                  dataName: kn,
                  dataCat: kitCat
                }) : '<span class="cb2-chip' + (isOn ? ' on' : '') + '" data-act="item" data-name="' + esc(kn) + '" data-cat="' + esc(kitCat) + '">' + esc(kn) + '</span>';
              }).join('') + '</div></div>';
          }
        }
        html += '<div class="cb2-grp-t" style="margin-top:6px">装备表补充（点击勾选购买）</div>' + kitHtml + catHtml;
      }
    }
    // 2026-08-06：卷轴动态价格（2024 PHB 冒险装备：戏法卷轴 30GP / 一环卷轴 50GP；选择法术自动算价）
    var scrollHtml = '';
    var lists = st.spellData && st.spellData.spellLists ? st.spellData.spellLists[st.cls] : null;
    var sc0 = versionSpellList((lists && (lists['0'] || lists[0])) || []);
    var sc1 = versionSpellList((lists && (lists['1'] || lists[1])) || []);
    if (sc0.length || sc1.length) {
      var scrollOpts = sc1.map(function (n) { return '<option value="' + esc(n) + '" data-lv="1">' + esc(n) + '</option>'; }).join('') +
        sc0.map(function (n) { return '<option value="' + esc(n) + '" data-lv="0">' + esc(n) + '</option>'; }).join('');
      scrollHtml = '<div class="cb2-scroll-maker"><div class="cb2-grp-t">🧻 法术卷轴（动态价格：戏法 30GP / 一环 50GP）</div>' +
        '<div class="cb2-row" style="gap:8px;margin-top:4px;align-items:center;flex-wrap:wrap">' +
        '<select class="cb2-in cb2-in-sm" id="cb2c-scroll-spell" style="max-width:220px"><option value="">选择法术（职业法表内）</option>' + scrollOpts + '</select>' +
        '<span class="cb2-scroll-price" id="cb2c-scroll-price" style="color:var(--gold-l);font-size:12px">—</span>' +
        '<button type="button" class="cb2-btn gold sm" data-act="scroll-add" id="cb2c-scroll-add">＋ 购买卷轴</button>' +
        '</div></div>';
    }
    html += '<div class="cb2-row" style="margin-top:8px">' +
      '<input type="text" class="cb2-in" id="cb2c-item-input" placeholder="输入物品名（自动匹配装备表价格/类别）" list="cb2c-item-dl" style="flex:1">' +
      '<datalist id="cb2c-item-dl">' + allEquipNames().map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
      '<select class="cb2-in cb2-in-sm" id="cb2c-item-cat"><option>冒险装备</option><option>杂物</option><option>简易近战武器</option><option>简易远程武器</option></select>' +
      '<button type="button" class="cb2-btn gold sm" data-act="item-add">＋ 添加</button>' +
      '</div>' + scrollHtml +
      '<div class="cb2-mini-label">点击类别条目购买（自动扣金币并计入剩余）；再点退回。起始装备（职业 A/B/C 与背景）为赠送不扣金币；护甲自动更新 AC，「◈」为已装备；套组购买时悬浮可见内容清单。</div>';
    body.innerHTML = html;
    // 卷轴价格实时联动
    var spSel = $id('cb2c-scroll-spell');
    if (spSel) {
      spSel.addEventListener('change', function () {
        var opt = spSel.selectedOptions && spSel.selectedOptions[0];
        var lv = opt ? Number(opt.getAttribute('data-lv')) : 0;
        var price = lv === 0 ? 30 : 50;
        var pe = $id('cb2c-scroll-price');
        if (pe) pe.textContent = spSel.value ? (lv === 0 ? '戏法卷轴 · 30 GP' : '一环卷轴 · 50 GP') : '选择法术后显示价格';
      });
    }
    if (count) count.textContent = st.items.length + ' 件';
  }

  // 已选法术/装备变化 → 刷新两个区
  function refreshSelection() {
    renderSpellSection();
    renderEquipSection();
  }

  // ── 立绘上传与圆形头像裁剪（2026-08-06：独立窗口三段流程）──
  // 上传原图 → 压缩存入 localStorage（供独立窗口读取）→ 打开独立裁剪窗口：
  //   截取立绘(3:4) → 截取头像(圆形) → 抠背景色工具（吸管采样+容差）
  // 独立窗口保存后通过 storage 事件写回 st.assets { avatar, avatarFramed, portrait }
  var _ptool = { img: null, crop: null, dragging: false };
  function portraitCssPx() { return 340; }

  // 打开独立立绘/头像工具窗口
  function openPortraitTool() {
    var sys = (ctx && ctx.system) || '';
    var tid = (ctx && ctx.token && ctx.token.id) || '';
    window.open('/portrait-tool.html?system=' + encodeURIComponent(sys) + '&id=' + encodeURIComponent(tid), '_blank');
  }

  // 应用独立窗口保存的素材
  function applyPortraitResult(payload) {
    if (!payload) return;
    var a = payload.assets || payload;
    if (!a.avatar && !a.portrait) return;
    st.assets = {
      avatar: a.avatar || (st.assets && st.assets.avatar),
      avatarFramed: a.avatarFramed || a.avatar || (st.assets && st.assets.avatarFramed),
      portrait: a.portrait || (st.assets && st.assets.portrait)
    };
    var frame = $id('cb2c-avatar-frame');
    if (frame && st.assets.avatarFramed) frame.innerHTML = '<img src="' + esc(st.assets.avatarFramed) + '">';
    var pv = $id('cb2c-portrait-preview');
    if (pv && st.assets.portrait) pv.innerHTML = '<img src="' + esc(st.assets.portrait) + '">';
    var rm = $id('cb2c-portrait-remove');
    if (rm) rm.style.display = '';
  }

  function initPortraitTool() {
    var fileInput = $id('cb2c-portrait-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = this.files && this.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function (e) {
          var img = new Image();
          img.onload = function () {
            // 压缩原图（最长边 1600px，PNG 保留透明通道）存入 localStorage，供独立窗口读取
            try {
              var maxSide = 1600;
              var sc = Math.min(1, maxSide / Math.max(img.width, img.height));
              var cw = Math.round(img.width * sc), chh = Math.round(img.height * sc);
              var cv = document.createElement('canvas');
              cv.width = cw; cv.height = chh;
              cv.getContext('2d').drawImage(img, 0, 0, cw, chh);
              localStorage.setItem('trpg_portrait_source', cv.toDataURL('image/png'));
            } catch (e2) { /* 原图过大等异常：跳过，独立窗口可自行选图 */ }
            openPortraitTool();
          };
          img.src = e.target.result;
        };
        rd.readAsDataURL(f);
      });
    }
    // 2026-08-06：监听独立裁剪窗口保存结果
    window.addEventListener('storage', function (e) {
      if (e.key !== 'trpg_portrait_result') return;
      var val = null;
      try { val = JSON.parse(e.newValue); } catch (err) {}
      if (val && (val.assets || val.avatar || val.portrait)) {
        applyPortraitResult(val);
        try { localStorage.removeItem('trpg_portrait_result'); } catch (err) {}
      }
    });
    var canvas = $id('cb2c-portrait-canvas');
    if (canvas) {
      canvas.addEventListener('mousedown', function (e) {
        if (!_ptool.img || !_ptool.crop) return;
        var rect = canvas.getBoundingClientRect();
        var scale = canvas.width / rect.width;
        var x = (e.clientX - rect.left) * scale;
        var y = (e.clientY - rect.top) * scale;
        var c = _ptool.crop;
        if (Math.hypot(x - c.cx, y - c.cy) <= c.r + 10) {
          _ptool.dragging = true;
          _ptool.dragOff = { dx: x - c.cx, dy: y - c.cy };
        }
      });
      canvas.addEventListener('mousemove', function (e) {
        if (!_ptool.dragging || !_ptool.crop) return;
        var rect = canvas.getBoundingClientRect();
        var scale = canvas.width / rect.width;
        var x = (e.clientX - rect.left) * scale;
        var y = (e.clientY - rect.top) * scale;
        _ptool.crop.cx = x - _ptool.dragOff.dx;
        _ptool.crop.cy = y - _ptool.dragOff.dy;
        drawPortraitCanvas();
      });
      canvas.addEventListener('mouseup', function () {
        if (_ptool.dragging) { _ptool.dragging = false; savePortraitAssets(); }
      });
      canvas.addEventListener('mouseleave', function () {
        if (_ptool.dragging) { _ptool.dragging = false; savePortraitAssets(); }
      });
      canvas.addEventListener('wheel', function (e) {
        if (!_ptool.img || !_ptool.crop) return;
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        _ptool.crop.r = Math.max(12, Math.min(150, _ptool.crop.r * factor));
        drawPortraitCanvas();
        savePortraitAssets();
      }, { passive: false });
    }
  }
  function drawPortraitCanvas() {
    var canvas = $id('cb2c-portrait-canvas');
    if (!canvas || !_ptool.img || !_ptool.crop) return;
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, size, size);
    var img = _ptool.img;
    var fit = Math.min(size / img.width, size / img.height) * 0.92;
    var dw = img.width * fit, dh = img.height * fit;
    var dx = (size - dw) / 2, dy = (size - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    var c = _ptool.crop;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.strokeStyle = '#c9a84c';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  // 生成并保存头像/立绘资产（圆形头像 + 带框头像 + 3:4竖版立绘）
  // 2026-08-06 坐标修复：canvas 预览坐标 → 原图像素坐标换算（view.fit/dx/dy），所见=所得
  function savePortraitAssets() {
    if (!_ptool.img || !_ptool.crop) return;
    var img = _ptool.img;
    var c = _ptool.crop;
    var view = _ptool.view || { fit: 1, dx: 0, dy: 0 };
    // 换算：canvas 坐标 (cx,cy,r) → 原图坐标
    var sx0 = (c.cx - view.dx) / view.fit;
    var sy0 = (c.cy - view.dy) / view.fit;
    var sr = c.r / view.fit;
    sx0 = Math.max(0, Math.min(img.width - sr * 2, sx0));
    sy0 = Math.max(0, Math.min(img.height - sr * 2, sy0));
    sr = Math.max(1, Math.min(sr, Math.min(img.width, img.height) / 2));
    // 圆形头像（透明底，144px）
    var av = document.createElement('canvas');
    av.width = 144; av.height = 144;
    var actx = av.getContext('2d');
    actx.beginPath();
    actx.arc(72, 72, 72, 0, Math.PI * 2);
    actx.clip();
    actx.drawImage(img, sx0, sy0, sr * 2, sr * 2, 0, 0, 144, 144);
    var avatarUrl = av.toDataURL('image/png');
    // 带框头像（金边圆，160px）
    var af = document.createElement('canvas');
    af.width = 160; af.height = 160;
    var fctx = af.getContext('2d');
    fctx.beginPath();
    fctx.arc(80, 80, 76, 0, Math.PI * 2);
    fctx.clip();
    fctx.drawImage(img, sx0, sy0, sr * 2, sr * 2, 4, 4, 152, 152);
    fctx.beginPath();
    fctx.arc(80, 80, 76, 0, Math.PI * 2);
    fctx.strokeStyle = '#c9a84c';
    fctx.lineWidth = 4;
    fctx.stroke();
    var framedUrl = af.toDataURL('image/png');
    // 3:4 竖版立绘（取裁剪圈为中心的全身区域，768x1024）
    var pw = 768, ph = 1024;
    var pr = document.createElement('canvas');
    pr.width = pw; pr.height = ph;
    var pctx = pr.getContext('2d');
    var ratio = pw / ph;
    var sw = img.width, sh = sw / ratio;
    if (sh > img.height) { sh = img.height; sw = sh * ratio; }
    var sx = (img.width - sw) / 2;
    // 立绘以裁剪圈圆心为纵向参考（换算后的原图坐标），向图片上下取 3:4 竖版窗口
    var sy = Math.max(0, sy0 - sh * 0.5);
    sy = Math.max(0, Math.min(img.height - sh, sy));
    pctx.drawImage(img, sx, sy, sw, sh, 0, 0, pw, ph);
    var portraitUrl = pr.toDataURL('image/png');
    st.assets = { avatar: avatarUrl, avatarFramed: framedUrl, portrait: portraitUrl };
    // 更新预览
    var frame = $id('cb2c-avatar-frame');
    if (frame) frame.innerHTML = '<img src="' + esc(framedUrl) + '">';
    var rm = $id('cb2c-portrait-remove');
    if (rm) rm.style.display = '';
    var wrap = $id('cb2c-portrait-wrap');
    if (wrap) wrap.style.display = '';
  }
  function removePortraitAssets() {
    st.assets = null;
    _ptool.img = null;
    _ptool.crop = null;
    var frame = $id('cb2c-avatar-frame');
    if (frame) frame.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--text-3);font-size:10px">无头像</div>';
    var pv = $id('cb2c-portrait-preview');
    if (pv) pv.innerHTML = '<div style="color:var(--text-3);font-size:10px;line-height:52px">立绘预览</div>';
    var rm = $id('cb2c-portrait-remove');
    if (rm) rm.style.display = 'none';
    var wrap = $id('cb2c-portrait-wrap');
    if (wrap) wrap.style.display = 'none';
    try { localStorage.removeItem('trpg_portrait_source'); } catch (e) {}
  }

  // ── 职业规则原文预览（2026-08-06）：职业分页下方内嵌该职业规则书网页，随时对照特性/表格 ──
  function renderClassPreview() {
    var box = $id('cb2c-cls-preview');
    if (!box) return;
    var clsName = st.cls === '自定义' ? (st.customClass || '') : st.cls;
    if (!clsName) { box.innerHTML = '<div class="cb2-hint">选择职业后显示其规则书原文预览</div>'; return; }
    var sys = (ctx && ctx.system) || '';
    // 2024：玩家手册2024/角色职业/<职业>/<职业>.htm；2014：玩家手册/职业/<职业>.html
    var file = st.ruleVersion === '2024'
      ? '玩家手册2024/角色职业/' + clsName + '/' + clsName + '.htm'
      : '玩家手册/职业/' + clsName + '.html';
    box.innerHTML = '<iframe src="/view.html?system=' + encodeURIComponent(sys) + '&file=' + encodeURIComponent(file) +
      '" style="width:100%;height:380px;border:1px solid var(--border-light);border-radius:8px;background:#14142b;" loading="lazy"></iframe>' +
      '<div class="cb2-mini-label">来源：' + esc(file) + '（<a href="/view.html?system=' + encodeURIComponent(sys) + '&file=' + encodeURIComponent(file) + '" target="_blank" style="color:var(--gold-l)">在新窗口打开完整原文</a>）</div>';
  }

  // ── 规则数据加载 ──
  function loadSpellData() {
    try {
      if (!ctx || typeof ctx.fetch !== 'function') { renderSpellSection(); return; }
      var url = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spell_lists.json';
      ctx.fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        st.spellData = j || null;
        // 2026-08-05：法术学派数据（rule_spell_schools.json）——创建界面按学派归类
        var sUrl = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spell_schools.json';
        ctx.fetch(sUrl).then(function (r2) { return r2.json(); }).then(function (sj) {
          st.spellSchools = (sj && sj.spells) || null;
          if (st.spellSchools) {
            st.schoolByName = {};
            Object.keys(st.spellSchools).forEach(function (k) {
              var v = st.spellSchools[k];
              if (v && v.name) st.schoolByName[v.name] = v;
            });
          }
          // 2026-08-06：完整法术信息（rule_spells_full.json：完整描述/距离/持续时间/成分/升环）
          var fUrl = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spells_full.json';
          ctx.fetch(fUrl).then(function (r3) { return r3.json(); }).then(function (fj) {
            st.spellsFull = (fj && fj.spells) || null;
            renderSpellSection();
          }).catch(function () { st.spellsFull = null; renderSpellSection(); });
        }).catch(function () { st.spellSchools = null; renderSpellSection(); });
      }).catch(function () { renderSpellSection(); });
    } catch (e) { renderSpellSection(); }
  }
  function loadEquipData() {
    try {
      if (!ctx || typeof ctx.fetch !== 'function') { renderEquipSection(); return; }
      var url = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_equipment.json';
      var priceUrl = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_equip_prices.json';
      ctx.fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        st.equipData = j || null;
        // 价格表（金币账本）：规则书装备价格 → 点选购买扣金币
        ctx.fetch(priceUrl).then(function (r2) { return r2.json(); }).then(function (pj) {
          st.equipPrices = (pj && pj.prices) || {};
          // 2026-08-05：武器属性细分数据（rule_weapon_props.json：单手/双手/多用/灵巧/重型…）
          var wUrl = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_weapon_props.json';
          ctx.fetch(wUrl).then(function (r3) { return r3.json(); }).then(function (wj) {
            st.weaponProps = (wj && wj.weapons) || null;
            if (st.weaponProps) {
              st.wpnPropsByName = {};
              Object.keys(st.weaponProps).forEach(function (k) {
                var v = st.weaponProps[k];
                if (v && v.name) st.wpnPropsByName[v.name] = v;
              });
            }
            // 2026-08-06：冒险套组定义（rule_kits.json：探索套组等的内容清单/价格）
            var kUrl = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_kits.json';
            ctx.fetch(kUrl).then(function (r4) { return r4.json(); }).then(function (kj) {
              st.kitData = (kj && kj.kits) || null;
              renderEquipSection();
            }).catch(function () { st.kitData = null; renderEquipSection(); });
          }).catch(function () { st.weaponProps = null; renderEquipSection(); });
        }).catch(function () { renderEquipSection(); });
      }).catch(function () { renderEquipSection(); });
    } catch (e) { renderEquipSection(); }
  }

  // ── 模式切换 ──
  function setMode(mode) {
    st.mode = mode;
    container.querySelectorAll('.cb2-mode-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    // 骰点模式：手动逐次掷骰（切回时若未生成则重置为待掷状态；骰点上限 5 组）
    if (mode === 'rolled' && (!st.rollSets || !st.rollSets.length)) {
      st.rollSets = [];
      st.rollTimes = 0;
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
      assets: st.assets ? JSON.parse(JSON.stringify(st.assets)) : null, // 立绘/头像（AVG发言立绘 + 地图头像）
      race: st.race,
      raceChoices: JSON.parse(JSON.stringify(st.raceChoices || {})),
      raceFeatures: RACE_FEATURES[st.race] ? JSON.parse(JSON.stringify(RACE_FEATURES[st.race])) : null,
      class: cls,
      subclass: st.subclass || '', // 副职
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
      manualSaves: Object.assign({}, st.manualSaves || {}), // 手动豁免记录（切职业保留）
      saveSources: JSON.parse(JSON.stringify(st.saveSources || {})), // 豁免来源（详情页显示）
      skills: skills,
      skillSources: JSON.parse(JSON.stringify(st.skillSources || {})),
      toolSources: JSON.parse(JSON.stringify(st.toolSources || {})),
      customBg: st.customBg ? JSON.parse(JSON.stringify(st.customBg)) : null,
      spellSlots: spellSlotsFor(st.cls, level),
      spellSlotsUsed: editData && editData.spellSlotsUsed ? Object.assign({}, editData.spellSlotsUsed) : {},
      spellList: st.spellList.map(function (s) {
        var full = spellFullInfo(s.name) || s || {}; return { name: s.name, fullName: full.fullName || s.fullName || s.name, level: Number(s.level) || Number(full.level) || 0, school: full.school || s.school || '', castingTime: full.castingTime || full.time || s.castingTime || '', range: full.range || s.range || '', components: full.components || s.components || '', duration: full.duration || s.duration || '', concentration: full.concentration != null ? !!full.concentration : !!s.concentration, ritual: full.ritual != null ? !!full.ritual : !!s.ritual, source: full.source || s.source || '', classes: Array.isArray(full.classes) ? full.classes.slice() : (Array.isArray(s.classes) ? s.classes.slice() : []), prepared: s.prepared !== false, desc: full.desc || full.description || s.desc || '' };
      }),
      items: st.items.map(function (it) {
        var savedItem = Object.assign({}, it, {
          name: it.name,
          category: it.category || '杂物',
          quantity: Math.max(1, Number(it.quantity) || 1),
          price: (it.price === '' || it.price == null) ? '' : String(it.price),
          equipped: !!it.equipped
        });
        delete savedItem.free;
        delete savedItem.freeQuantity;
        delete savedItem.acquired;
        return savedItem;
      }),
      goldStart: goldBudget(),
      goldSpent: st.goldSpent || 0,
      goldRemain: st.goldRemain || 0,
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
    while (el && el !== container && !el.getAttribute('data-feat-desc')) el = el.parentNode;
    if (el && el !== container) {
      var fd = el.getAttribute('data-feat-desc');
      if (fd) {
        var desc = '';
        try { desc = decodeURIComponent(fd); } catch (e) { desc = fd; }
        showTipAt(el, el.getAttribute('data-feat-name') || String(el.textContent || '').replace(/ⓘ\s*$/, '').trim(), desc);
        return;
      }
    }
  });
  container.addEventListener('mouseout', function () { hideSpellTip(); });

  // ── 2026-08-06：骰值拖拽分配（骰池 → 属性槽；已分配值可拖回骰池）──
  var _dragFromPool = false, _dragFromSlot = null;
  container.addEventListener('dragstart', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var poolVal = t.getAttribute('data-pool-val');
    if (poolVal != null && poolVal !== '') {
      e.dataTransfer.setData('text/plain', poolVal);
      e.dataTransfer.effectAllowed = 'move';
      _dragFromPool = true;
      return;
    }
    if (t.getAttribute('data-drop') === 'ab' && t.getAttribute('data-ab-val') !== '' && t.getAttribute('data-ab-val') != null) {
      e.dataTransfer.setData('text/plain', 'ab:' + t.getAttribute('data-ab'));
      e.dataTransfer.effectAllowed = 'move';
      _dragFromSlot = t.getAttribute('data-ab');
      return;
    }
  });
  container.addEventListener('dragend', function () { _dragFromPool = false; _dragFromSlot = null; });
  container.addEventListener('dragover', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.getAttribute('data-drop') === 'ab' || (t.getAttribute('data-pool') != null && _dragFromSlot)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  container.addEventListener('drop', function (e) {
    e.preventDefault();
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var val = e.dataTransfer.getData('text/plain');
    // 骰值 → 属性槽
    if (t.getAttribute('data-drop') === 'ab' && /^\d+$/.test(val)) {
      var abKey = t.getAttribute('data-ab');
      if (st.scores[abKey] != null) { try { showToast('该属性已有数值，可先点它回收或拖回骰池', 'error'); } catch (e2) {} return; }
      var nv = Number(val);
      var poolIdx = st.rolledPool.indexOf(nv);
      if (poolIdx >= 0) {
        st.scores[abKey] = nv;
        st.rolledPool.splice(poolIdx, 1);
        st.pickedIdx = -1;
        saveCurrentRollSet();
        renderAbilityGrid();
        updateDerived();
        if (st.mode === 'rolled' && st.background && st.ruleVersion === '2024' && st.bgAttrPending) {
          var allDone = ABILITIES.every(function (a) { return st.scores[a.key] != null; });
          if (allDone) autoApplyBgBonus();
        }
      }
      return;
    }
    // 已分配值 → 拖回骰池
    if (val.indexOf('ab:') === 0 && t.getAttribute('data-pool') != null) {
      var retKey = val.substring(3);
      if (st.scores[retKey] != null) {
        st.rolledPool.push(st.scores[retKey]);
        st.scores[retKey] = null;
        st.rolledPool.sort(function (a, b) { return a - b; });
        saveCurrentRollSet();
        renderAbilityGrid();
        updateDerived();
      }
    }
  });
  // 骰点分配全部就位后自动补背景加值（点击/拖动共用）
  function autoApplyBgBonus() {
    var bInfo = BACKGROUNDS[st.background];
    if (bInfo) {
      applyBgAttr('21');
      try { showToast('背景「' + st.background + '」属性加值已自动应用（' + bInfo.abilities[0] + ' +2、' + bInfo.abilities[1] + ' +1）', 'ok'); } catch (e) {}
    } else if (st.background === '自定义背景' && st.customBg) {
      var cNeed = st.customBg.attr === '111' ? 3 : 2;
      var cKeys = (st.customBg.attrKeys || []).filter(Boolean);
      var cPools = ABILITIES.map(function (a) { return a.name; });
      while (cKeys.length < cNeed) {
        var cPick = cPools.shift();
        if (cKeys.indexOf(cPick) < 0) cKeys.push(cPick);
      }
      if (cKeys.length) applyBgAttr(st.customBg.attr || '21', cKeys);
    }
  }
  container.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    // 2026-08-05 标签系统：点击标签移除按钮（✕）→ 触发其宿主条目行为
    var crm = null;
    var probe2 = e.target;
    while (probe2 && probe2 !== container) {
      if (probe2.getAttribute && probe2.getAttribute('data-tg-rm') != null) { crm = probe2; break; }
      probe2 = probe2.parentNode;
    }
    if (crm) {
      var chost = crm.parentNode;
      while (chost && chost !== container && !chost.getAttribute('data-act') && !chost.getAttribute('data-tg-rm-act')) chost = chost.parentNode;
      if (chost && chost !== container) {
        var crmAct = chost.getAttribute('data-tg-rm-act');
        if (crmAct) {
          var savedAct2 = chost.getAttribute('data-act');
          chost.setAttribute('data-act', crmAct);
          chost.click();
          if (savedAct2) chost.setAttribute('data-act', savedAct2); else chost.removeAttribute('data-act');
        } else {
          chost.click();
        }
      }
      return;
    }
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
          // 移除 2024 起源专长（若同时被种族可选项持有则保留）
          var bf = BACKGROUNDS[oldBg];
          if (bf && bf.feat) {
            removeFeatIfUnused(bf.feat);
            refreshFeatList();
          }
        }
      } else if (oldBg === '自定义背景') {
        // 自定义背景：撤销属性提升并清空来源（来源在重应用时恢复）
        if (st.bgApplied) applyBgAttr(null);
        applyBgProficiencies(null, null);
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
            refreshFeatList();
          }
        } else {
          // 2014：仅技能/工具（来源驱动仍保留来源记录，便于切回）
          applyBgProficiencies(oldBg, BACKGROUNDS[oldBg]);
        }
      } else if (oldBg === '自定义背景' && st.customBg) {
        applyBgProficiencies('自定义背景', null);
        if (rv === '2024') {
          var cKeys = (st.customBg.attrKeys || []).filter(Boolean);
          var cNeed = st.customBg.attr === '111' ? 3 : 2;
          var cPool = ABILITIES.map(function (a) { return a.name; });
          while (cKeys.length < cNeed) {
            var cPick = cPool.shift();
            if (cKeys.indexOf(cPick) < 0) cKeys.push(cPick);
          }
          if (cKeys.length) applyBgAttr(st.customBg.attr || '21', cKeys);
        }
      }
      renderBgCard();
      renderAbilityGrid();
      renderClassPreview(); // 2026-08-06：规则版本切换后职业原文预览同步切换
      updateDerived();
      return;
    }

    // ── 标准流程分步（唯一流程：移除快速创建选择）──
    if (act === 'flow-step') {
      var si = Number(el.getAttribute('data-i')) || 0;
      container.querySelectorAll('.cb2-flow-step').forEach(function (c) {
        c.classList.toggle('cur', Number(c.getAttribute('data-i')) === si);
      });
      // 标准流程：真正的分页——每步只显示对应区块
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
      if (cur >= STEPS.length - 1) {
        try { showToast('所有步骤已完成，请点击页面顶部的「保存角色卡」完成创建', 'ok'); } catch (e) {}
        return;
      }
      var nxt2 = cur + 1;
      var tgt2 = container.querySelector('.cb2-flow-step[data-i="' + nxt2 + '"]');
      if (tgt2) tgt2.click();
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

    if (act === 'roll-new-set') {
      // 手动逐次掷骰：掷出一组（4d6 去最低 ×6，含过程），上限 5 组
      if (st.rollTimes >= 5) {
        try { showToast('已达 5 组上限，请从已掷组中选择一组使用', 'error'); } catch (e) {}
        return;
      }
      st.rollSets.push(rollScoreSetWithDetail());
      st.rollTimes++;
      st.rollPick = -1;
      st.rolledPool = [];
      st.pickedIdx = -1;
      ABILITIES.forEach(function (a) { st.scores[a.key] = null; });
      renderAbilityGrid();
      updateDerived();
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
      // 骰点全部就位 + 有背景加值待应用 → 自动补应用（先选背景后分配场景，含自定义背景）
      if (st.mode === 'rolled' && st.background && st.ruleVersion === '2024' && st.bgAttrPending) {
        var allDone = ABILITIES.every(function (a) { return st.scores[a.key] != null; });
        if (allDone) {
          var bInfo = BACKGROUNDS[st.background];
          if (bInfo) {
            applyBgAttr('21');
            try { showToast('背景「' + st.background + '」属性加值已自动应用（' + bInfo.abilities[0] + ' +2、' + bInfo.abilities[1] + ' +1）', 'ok'); } catch (e) {}
          } else if (st.background === '自定义背景' && st.customBg) {
            var cNeed = st.customBg.attr === '111' ? 3 : 2;
            var cKeys = (st.customBg.attrKeys || []).filter(Boolean);
            var cPool = ABILITIES.map(function (a) { return a.name; });
            while (cKeys.length < cNeed) {
              var cPick = cPool.shift();
              if (cKeys.indexOf(cPick) < 0) cKeys.push(cPick);
            }
            if (cKeys.length) applyBgAttr(st.customBg.attr || '21', cKeys);
          }
        }
      }
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
      // 名称自动映射：命中职业法术表 → 自动使用其实际环位（忽略下拉选择）
      var lists = st.spellData && st.spellData.spellLists ? st.spellData.spellLists[st.cls] : null;
      if (lists) {
        for (var rl = 0; rl <= 9; rl++) {
          var arr = lists[String(rl)] || lists[rl] || [];
          if (arr.indexOf(v) >= 0) { lv2 = rl; break; }
        }
      }
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
        var price = itemPrice(itN);
        // 金币校验：有价物品需在剩余金币内（赠送物品 free 不计入花费）
        var spentNow = 0;
        st.items.forEach(function (x) { if (x.price != null && x.price > 0) spentNow += Number(x.price) * chargeableQuantity(x); });
        if (price != null && price > 0 && spentNow + price > goldBudget()) {
          try { showToast('金币不足：' + esc(itN) + ' 需 ' + fmtGP(price) + '，剩余 ' + fmtGP(Math.max(0, goldBudget() - spentNow)) + '（可先移除部分购买物）', 'error'); } catch (e) {}
          return;
        }
        st.items.push(buildCatalogItem(itN, itC, { quantity: 1, equipped: isArmorCat, price: price, free: price == null, freeQuantity: price == null ? 1 : 0 }));
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
      // 名称自动映射：命中装备表 → 自动取类别/价格（计入金币账本），未命中则按所选类别作自定义杂物
      var hitCat = findEquipCat(v2);
      var hitPrice = hitCat ? itemPrice(v2) : null;
      if (hitCat) {
        // 与类别浏览点击行为一致：金币校验 + 护甲联动
        var spentNow = 0;
        st.items.forEach(function (x) { if (x.price != null && x.price > 0) spentNow += Number(x.price) * chargeableQuantity(x); });
        if (hitPrice != null && hitPrice > 0 && spentNow + hitPrice > goldBudget()) {
          try { showToast('金币不足：' + esc(v2) + ' 需 ' + fmtGP(hitPrice) + '，剩余 ' + fmtGP(Math.max(0, goldBudget() - spentNow)) + '（可先移除部分购买物）', 'error'); } catch (e) {}
          return;
        }
        var isArmorCat = hitCat === '轻甲' || hitCat === '中甲' || hitCat === '重甲';
        st.items.push(buildCatalogItem(v2, hitCat, { quantity: 1, equipped: isArmorCat, price: hitPrice, free: hitPrice == null, freeQuantity: hitPrice == null ? 1 : 0 }));
        if (isArmorCat && (st.armor === '无甲' || !st.items.some(function (x) { return (x.category === '轻甲' || x.category === '中甲' || x.category === '重甲') && x.equipped && x.name !== v2; }))) {
          st.armor = v2;
        }
        var armorSel2 = $id('cb2c-armor');
        if (armorSel2) armorSel2.value = st.armor;
      } else {
        st.items.push(buildCatalogItem(v2, iCat ? iCat.value : '杂物', { quantity: 1, equipped: false, free: true, freeQuantity: 1 }));
      }
      if (iIn) iIn.value = '';
      refreshSelection();
      updateDerived();
      return;
    }
    // ── 2026-08-06：背包条目化操作（数量±/装备切换/卷轴购买）──
    if (act === 'qty-plus' || act === 'qty-minus') {
      var qi = Number(el.getAttribute('data-i'));
      if (st.items[qi]) {
        var qtyItem = st.items[qi];
        var qq = (Number(qtyItem.quantity) || 1);
        if (act === 'qty-plus' && qtyItem.price != null && Number(qtyItem.price) > 0) {
          var spentQty = 0;
          st.items.forEach(function (x) { if (x.price != null && Number(x.price) > 0) spentQty += Number(x.price) * chargeableQuantity(x); });
          if (spentQty + Number(qtyItem.price) > goldBudget()) {
            try { showToast('金币不足：再增加 1 个「' + qtyItem.name + '」需要 ' + fmtGP(qtyItem.price) + '，当前可用 ' + fmtGP(Math.max(0, goldBudget() - spentQty)), 'error'); } catch (e) {}
            return;
          }
        }
        qtyItem.quantity = act === 'qty-plus' ? qq + 1 : Math.max(1, qq - 1);
        renderEquipSection();
        updateDerived();
      }
      return;
    }
    if (act === 'equip-toggle') {
      var ei = Number(el.getAttribute('data-i'));
      var eit = st.items[ei];
      if (eit) {
        if (ARMOR_LIST.indexOf(eit.name) >= 0) {
          // 护甲：装备=设为当前护甲；再点=卸下回无甲
          st.armor = (st.armor === eit.name) ? '无甲' : eit.name;
          var armorSel3 = $id('cb2c-armor');
          if (armorSel3) armorSel3.value = st.armor;
        } else {
          eit.equipped = !eit.equipped;
        }
        renderEquipSection();
        updateDerived();
      }
      return;
    }
    if (act === 'scroll-add') {
      var spSel2 = $id('cb2c-scroll-spell');
      if (!spSel2 || !spSel2.value) { try { showToast('请先选择要写入卷轴的法术', 'error'); } catch (e) {} return; }
      var opt2 = spSel2.selectedOptions && spSel2.selectedOptions[0];
      var lv3 = opt2 ? Number(opt2.getAttribute('data-lv')) : 1;
      var price3 = lv3 === 0 ? 30 : 50;
      var spentNow2 = 0;
      st.items.forEach(function (x) { if (x.price != null && x.price > 0) spentNow2 += Number(x.price) * chargeableQuantity(x); });
      if (spentNow2 + price3 > goldBudget()) {
        try { showToast('金币不足：法术卷轴需 ' + fmtGP(price3) + '，剩余 ' + fmtGP(Math.max(0, goldBudget() - spentNow2)), 'error'); } catch (e) {}
        return;
      }
      var scrollName = lv3 === 0 ? '戏法卷轴' : '一环卷轴';
      var fullName2 = '法术卷轴（' + spSel2.value + '）';
      var fi2 = st.items.findIndex(function (x) { return x.name === fullName2; });
      if (fi2 >= 0) {
        st.items[fi2].quantity = (Number(st.items[fi2].quantity) || 1) + 1;
      } else {
        var scrollSpell = spellFullInfo(spSel2.value) || {};
        st.items.push({ name: fullName2, category: '卷轴', quantity: 1, price: price3, spell: spSel2.value, spellLevel: lv3, consumable: true, desc: [scrollName + '：' + spSel2.value, scrollSpell.castingTime ? '施法时间：' + scrollSpell.castingTime : '', scrollSpell.range ? '距离：' + scrollSpell.range : '', scrollSpell.components ? '成分：' + scrollSpell.components : '', scrollSpell.duration ? '持续时间：' + scrollSpell.duration : '', scrollSpell.desc || '', '施放后卷轴消失'].filter(Boolean).join('\n') });
      }
      try { showToast('已购买' + scrollName + '：' + spSel2.value + '（' + fmtGP(price3) + '）', 'ok'); } catch (e) {}
      refreshSelection();
      updateDerived();
      return;
    }
    // ── 副职选择 ──
    if (act === 'subclass') {
      applySubclass(el.getAttribute('data-name'));
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
    // ── 自定义背景交互（2026-08-05：选择即生效，无需"应用"按钮）──
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
      applyCustomBgNow(true);
      return;
    }
    if (act === 'cbg-equip-a') { st.customBg = st.customBg || {}; st.customBg.equip = 'A'; renderBgCard(); applyCustomBgNow(true); return; }
    if (act === 'cbg-equip-b') { st.customBg = st.customBg || {}; st.customBg.equip = 'B'; renderBgCard(); applyCustomBgNow(true); return; }
    if (act === 'cbg-attr-21') { st.customBg = st.customBg || {}; st.customBg.attr = '21'; renderBgCard(); applyCustomBgNow(true); return; }
    if (act === 'cbg-attr-111') { st.customBg = st.customBg || {}; st.customBg.attr = '111'; renderBgCard(); applyCustomBgNow(true); return; }
    if (act === 'cbg-toolcat') {
      st.customBg = st.customBg || {};
      st.customBg.toolCat = el.value;
      st.customBg.tool = '';
      renderBgCard();
      applyCustomBgNow(true);
      return;
    }
    if (act === 'cbg-tool') { st.customBg = st.customBg || {}; st.customBg.tool = el.value; applyCustomBgNow(true); return; }
    if (act === 'cbg-items') { st.customBg = st.customBg || {}; st.customBg.items = el.value.split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean); applyCustomBgNow(true); return; }
    if (act === 'cbg-gold') { st.customBg = st.customBg || {}; st.customBg.gold = Number(el.value) || 0; applyCustomBgNow(true); return; }
    // ── 立绘上传 / 移除（2026-08-05）──
    // 2026-08-06：立绘/头像三段流程——点击打开独立裁剪窗口；若尚未选图则先选图（原图压缩后传入独立窗口）
    if (act === 'portrait-open') {
      var hasLocal = false;
      try { hasLocal = !!(localStorage.getItem('trpg_portrait_source') || ''); } catch (e) {}
      var pf = $id('cb2c-portrait-file');
      if (pf && !hasLocal && !st.assets) { pf.click(); return; }
      openPortraitTool();
      return;
    }
    if (act === 'portrait-remove') { removePortraitAssets(); return; }
        // ── 职业可选熟练：手动勾选/取消（2026-08-05 全站重构）──
    if (act === 'cls-skill-pick') {
      var pickName = el.getAttribute('data-name');
      var pickSrcs = st.skillSources && st.skillSources[pickName] ? st.skillSources[pickName] : [];
      var pickOn = pickSrcs.indexOf('职业·' + st.cls) >= 0;
      if (pickOn) {
        // 取消：移除职业来源（若仍被背景/种族持有则保留熟练）
        removeSkillSource(pickName, '职业·' + st.cls);
        try { showToast('已取消职业熟练：' + pickName, 'ok'); } catch (e) {}
      } else {
        var clsQ = CLASS_SKILL_COUNT[st.cls] || (SKILL_RECS[st.cls] || []).length;
        if (clsProfUsed() >= clsQ) {
          try { showToast('职业熟练已选满 ' + clsQ + ' 项，请先取消一项再勾选「' + pickName + '」', 'error'); } catch (e) {}
          return;
        }
        addSkillSource(pickName, '职业·' + st.cls);
        try { showToast('已勾选职业熟练：' + pickName + '（' + st.cls + '）', 'ok'); } catch (e) {}
      }
      renderSkillQuota();
      renderSkillRows();
      updateDerived();
      return;
    }
    if (act === 'feat-add') {
      var fIn = $id('cb2c-feat-input');
      var fv = fIn ? fIn.value.trim() : '';
      if (fv && st.features.indexOf(fv) < 0) {
        st.features.push(fv);
        if (fIn) fIn.value = '';
        refreshFeatList();
      }
      return;
    }
    if (act === 'feat-del') {
      var di = Number(el.getAttribute('data-i'));
      if (st.features[di]) {
        st.features.splice(di, 1);
        refreshFeatList();
      }
      return;
    }
  });

  container.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    var id = t.id;
    if (id === 'cb2c-name') { st.name = t.value; return; }
    // 外貌/性格/理想/牵绊/缺陷/背景故事（多行文本统一保存）
    if (id.indexOf('cb2c-bio-') === 0) {
      var bKey = id.slice('cb2c-bio-'.length);
      if (bKey === 'appearance' || bKey === 'personality' || bKey === 'ideals' || bKey === 'bonds' || bKey === 'flaws' || bKey === 'backstory') {
        st.bio[bKey] = t.value;
      }
      return;
    }
    if (id === 'cb2c-race') {
      // 切换种族：清理旧种族的可选项来源（技能/特性），再应用新种族
      clearRaceChoices(st.race);
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
      renderRaceCard();
      refreshFeatList();
      updateDerived();
      return;
    }
    if (id === 'cb2c-bg') {
      var newBg = t.value;
      // 移除旧背景专长（若未被种族可选项持有则删除）
      var oldBgF = st.background && BACKGROUNDS[st.background] ? BACKGROUNDS[st.background].feat : '';
      if (oldBgF) removeFeatIfUnused(oldBgF);
      // 来源驱动：先撤旧背景来源（属性/技能/工具），再按规则版本自动应用新背景
      if (BACKGROUNDS[newBg]) {
        if (st.bgApplied) applyBgAttr(null);
        applyBgProficiencies(newBg, BACKGROUNDS[newBg]);
        if (st.ruleVersion === '2024') {
          applyBgAttr('21');
          var bInfo = BACKGROUNDS[newBg];
          if (bInfo && bInfo.feat && st.features.indexOf(bInfo.feat) < 0) {
            st.features.push(bInfo.feat);
            refreshFeatList();
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
      refreshFeatList();
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
      // 切换职业：移除旧职业全部等级特性（含副职特性，若仍被背景/种族选择持有则保留）
      if (st.cls !== t.value && st.cls) {
        var oldCls = st.cls;
        var oldFeatNames = [];
        for (var oi = 1; oi <= 20; oi++) oldFeatNames = oldFeatNames.concat(classFeaturesAt(oldCls, oi));
        var oldSub = SUBCLASSES[oldCls];
        if (oldSub) {
          Object.keys(oldSub.list).forEach(function (sn) {
            var sf = oldSub.list[sn].feats || {};
            Object.keys(sf).forEach(function (lv) {
              sf[lv].forEach(function (f) { oldFeatNames.push(subclassFeatName(sn, f)); });
            });
          });
        }
        oldFeatNames.forEach(function (f) { removeFeatIfUnused(f); });
        st.subclass = ''; // 副职重置
      }
      applyClassProficiencies(t.value);
      st.cls = t.value;
      var wrap = $id('cb2c-custom-cls-wrap');
      if (wrap) wrap.style.display = st.cls === '自定义' ? '' : 'none';
      if (st.cls !== '自定义') {
        if (!st.items.length) applyStartingEquip();
      }
      // 职业特性自动预填：当前等级已解锁的全部特性（去重合并，保留用户已添加内容）
      applyClassFeaturesToState(st.cls);
      refreshFeatList();
      renderSubclassSelect();
      // 职业页：熟练提示 + 全等级特性（统一标签系统展示）
      renderClsFeatHint();
      renderClassPreview(); // 2026-08-06：职业规则原文预览随职业切换
      updateDerived();
      renderSpellSection();
      renderEquipSection();
      return;
    }
    if (id === 'cb2c-custom-cls') {
      st.customClass = t.value;
      renderClassPreview(); // 自定义职业名实时更新预览
      return;
    }
    if (id === 'cb2c-level') {
      var oldLv = Number(st.level) || 1;
      st.level = Math.max(1, Math.min(20, Number(t.value) || 1));
      t.value = st.level;
      // 等级提升：自动补齐新解锁职业特性（含副职特性）
      if (st.level > oldLv) {
        applyClassFeaturesToState(st.cls);
        refreshFeatList();
      }
      renderClsFeatHint();
      updateDerived();
      if (casterType(st.cls) != null) renderSpellSection();
      return;
    }
    if (id === 'cb2c-align') { st.alignment = t.value; return; }
    if (id === 'cb2c-size') { st.size = t.value; return; }
    if (id === 'cb2c-lang') { st.languages = t.value; return; }
    if (id === 'cb2c-wallet') { st.goldStart = Math.max(0, Number(t.value) || 0); renderEquipSection(); return; }
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
    if (save) {
      st.manualSaves = st.manualSaves || {};
      st.manualSaves[save] = true; // 手动勾选记录，切职业时保留
      st.saves[save] = t.checked;
      // 豁免来源：手动勾选记「自定义」；取消勾选且无其他来源时清空
      st.saveSources = st.saveSources || {};
      var autoSrcs = (st.saveSources[save] || []).filter(function (x) { return x !== '自定义'; });
      if (t.checked) {
        if (!st.saveSources[save] || !st.saveSources[save].length) st.saveSources[save] = ['自定义'];
      } else {
        st.saveSources[save] = autoSrcs;
      }
      // 更新豁免来源标签
      var savesEl = $id('cb2c-saves');
      if (savesEl) {
        savesEl.innerHTML = ABILITIES.map(function (a) {
          var srcs = st.saveSources[a.key] || [];
          var srcTxt = srcs.length ? '<em>' + esc(srcs.join('+')) + '</em>' : '';
          return '<label class="cb2-save"><input type="checkbox" data-save="' + a.key + '"' + (st.saves[a.key] ? ' checked' : '') + '>' + esc(a.name) + '豁免' + srcTxt + '</label>';
        }).join('');
      }
      return;
    }
    var sk = t.getAttribute && t.getAttribute('data-sk-sel');
    if (sk) {
      // 技能熟练变更：
      // 1) 有自动来源（职业/背景/种族）的技能不允许降到未熟练——来源驱动的熟练不可手动清除
      // 2) 手动新增熟练受配额约束（职业 N 项 + 背景 M 项；超出的提示）
      var autoSrcs = st.skillSources && st.skillSources[sk] ? st.skillSources[sk].filter(function (x) { return x !== '自定义'; }) : [];
      if (t.value === '未熟练') {
        if (autoSrcs.length) {
          try { showToast('「' + sk + '」由 ' + autoSrcs.join('、') + ' 提供熟练，不能在技能页取消（请到对应来源处调整）', 'error'); } catch (e) {}
          t.value = st.trained[sk] || '熟练';
          return;
        }
        if (st.skillSources && st.skillSources[sk]) {
          st.skillSources[sk].slice().forEach(function (src) { removeSkillSource(sk, src); });
        }
        st.trained[sk] = '未熟练';
      } else {
        var wasUntrained = !st.trained[sk] || st.trained[sk] === '未熟练';
        if (wasUntrained) {
          var quota = profQuota();
          var usedNow = profUsed();
          if (usedNow >= quota) {
            // 职业候选换选：该技能在职业候选列表中且职业配额已满 → 替换一个职业来源技能（不占手动配额）
            var isClsCand = st.cls && st.cls !== '自定义' && (SKILL_RECS[st.cls] || []).indexOf(sk) >= 0;
            if (isClsCand) {
              var clsQ = CLASS_SKILL_COUNT[st.cls] || (SKILL_RECS[st.cls] || []).length;
              if (clsProfUsed() < clsQ) {
                // 职业配额未满：直接补为职业来源（正常自动选中）
                addSkillSource(sk, '职业·' + st.cls);
                st.trained[sk] = t.value;
                renderSkillQuota();
                renderSkillRows();
                updateDerived();
                return;
              }
              var replaced = null;
              Object.keys(st.skillSources || {}).forEach(function (k) {
                if (replaced) return;
                if (k === sk) return;
                if ((st.skillSources[k] || []).indexOf('职业·' + st.cls) >= 0) replaced = k;
              });
              if (replaced) {
                removeSkillSource(replaced, '职业·' + st.cls);
                addSkillSource(sk, '职业·' + st.cls);
                st.trained[sk] = t.value;
                renderSkillQuota();
                renderSkillRows();
                updateDerived();
                return;
              }
            }
            try { showToast('熟练配额已满（' + usedNow + '/' + quota + '），请先在职业/背景来源处释放名额，或减少其他技能', 'error'); } catch (e) {}
            t.value = '未熟练';
            return;
          }
        }
        st.trained[sk] = t.value;
        // 手动选择也视为来源（标记用户主动操作，避免被来源移除逻辑误删）
        if (!st.skillSources || !st.skillSources[sk] || !st.skillSources[sk].length) {
          st.skillSources = st.skillSources || {};
          st.skillSources[sk] = ['自定义'];
        }
      }
      renderSkillQuota();
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
    var rc = t.getAttribute && t.getAttribute('data-race-choice');
    if (rc) {
      applyRaceChoice(rc, t.value);
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
    // 自定义背景属性选择器（方案A主/副、方案B三项）——选择即生效
    var ck = t.getAttribute && t.getAttribute('data-cbg-attrkey');
    if (ck) {
      st.customBg = st.customBg || {};
      st.customBg.attrKeys = st.customBg.attrKeys || [];
      var ckIdx = Number(t.getAttribute('data-idx')) || 0;
      st.customBg.attrKeys[ckIdx] = t.value;
      // 全部选齐后自动应用属性提升（骰点未分配完则等待）
      var needN = st.customBg.attr === '111' ? 3 : 2;
      var filled = (st.customBg.attrKeys || []).filter(Boolean).length;
      if (filled >= needN || st.bgApplied) applyCustomBgNow(true);
      return;
    }
  });

  // ── 初始渲染 ──
  // 新建：应用默认职业（法师）的熟练来源；编辑：保留已保存来源
  if (!editData) {
    applyClassProficiencies(st.cls);
    if (st.background && BACKGROUNDS[st.background]) applyBgProficiencies(st.background, BACKGROUNDS[st.background]);
  }
  // 立绘工具初始化 + 已有资产预览（编辑模式）
  initPortraitTool();
  if (st.assets) {
    var frame0 = $id('cb2c-avatar-frame');
    if (frame0) frame0.innerHTML = '<img src="' + esc(st.assets.avatarFramed || st.assets.avatar || '') + '">';
    var pv0 = $id('cb2c-portrait-preview');
    if (pv0 && st.assets.portrait) pv0.innerHTML = '<img src="' + esc(st.assets.portrait) + '">';
    var rm0 = $id('cb2c-portrait-remove');
    if (rm0) rm0.style.display = '';
  }
  renderSkillQuota();
  renderSkillRows();
  renderBgCard();
  renderRaceCard();
  refreshFeatList();
  // 职业页初始特性（全等级联动 + 副职）
  renderClsFeatHint();
  renderClassPreview(); // 2026-08-06：职业规则原文预览
  setMode(st.mode);
  // 标准流程：分页显隐（默认第 1 步：基础信息；编辑模式显示全部区块）
  container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
    sec.style.display = (Number(sec.getAttribute('data-step')) === 0) ? (sec.getAttribute('data-orig-display') || '') : 'none';
  });
  var prevBtn0 = $id('cb2c-flow-prev');
  if (prevBtn0) prevBtn0.style.visibility = 'hidden';
  var nextBtn0 = $id('cb2c-flow-next');
  if (nextBtn0) nextBtn0.textContent = '下一步 →';
  // 标准流程：新建时自动应用当前职业起始装备（职业切换时也会联动）
  if (!editData && CLASS_STARTING_EQUIP[st.cls] && !st.items.length) applyStartingEquip();
  loadSpellData();
  loadEquipData();
  // 2026-08-05 标签系统：统一浮动详情绑定
  if (window.TrpgTag && typeof window.TrpgTag.bindTips === 'function') {
    try { window.TrpgTag.bindTips(container); } catch (e) {}
  }

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



