'use strict';

/* ============================================================================
 * DND 五版不全书 · 角色卡系统插件（character-builder）
 * ============================================================================
 * 【单文件模块化结构（2026-08-06 重构）】插件系统只加载本文件（热加载），
 * 因此模块化在单文件内通过分区 + 接口约定实现：
 *
 *   PART 1  数据字典层（纯数据，无逻辑）
 *     1.1 属性/技能/职业基础字典
 *     1.2 创建字典（种族/背景/专长/子职业/装备/法术）
 *     1.3 样式常量
 *   PART 2  纯函数工具层（无状态、无 DOM）
 *     2.1 文本/数值工具
 *     2.2 规则计算（派生值/法术位/效果累计）
 *     2.3 数据归一化（存档 → 展示模型）
 *     2.4 词条查找（专长/特性/法术效果）
 *   PART 3  查看/详情渲染层（只读展示）
 *     3.1 主详情 renderDetail + 各 tab
 *     3.2 弹窗（HP/休息/升级/物品/效果/状态/法术）
 *     3.3 持久化与宿主交互（存档/Toast/模态/骰子日志）
 *   PART 4  创建/编辑系统（register 内工厂，编辑态状态机）
 *     4.1 initState 单一状态集中定义
 *     4.2 DataLoader 数据就绪编排（加载 → 就绪标记 → reconcile 重放）
 *     4.3 渲染层 renderXxx（纯 HTML 输出，只读 st）
 *     4.4 动作层 applyXxx（状态变更，统一 commit 重渲染）
 *     4.5 事件层：委托 → ACT 路由表（白名单分派，禁止巨型 if 链）
 *     4.6 收集与保存 collect()
 *   PART 5  register(api) 入口
 *
 * 【关键约定（防历史缺陷复发）】
 *  - data-act 一律经 ACT_TABLE 路由；属性冲突由路由表 + handler 参数校验双保险
 *  - 背景加值单一事实源 = bgApplied.abilities；候选仅 UI 提示
 *  - ASI 槽位数组保持位置语义（不紧凑化）
 *  - 异步数据加载统一进 DataLoader，完成后统一 onDataReady 重放
 * ========================================================================== */

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

var SKILL_RULE_SOURCE = '玩家手册2024/进行游戏/熟练.htm';
var SKILL_RULES = {
  '特技': '在复杂的环境里屹立不倒或是表演杂技特技。',
  '驯兽': '让动物平静下来、训练它们，又或者让它们做某种特定的事。',
  '奥秘': '回忆有关于法术、魔法物品和存在位面的知识。',
  '运动': '比平时跳得更远，在汹涌的水面上漂浮或是打碎什么东西。',
  '欺瞒': '撒一个让人信服的谎话或者做出让人深信不疑的伪装。',
  '历史': '回忆有关历史事件、人民、国家和文化传统的知识。',
  '洞悉': '辨别某人的情绪或意图。',
  '威吓': '恫吓他人或胁迫某人去做你想要他做的事。',
  '调查': '在书本中寻辨晦涩难懂的信息或推断某些事物是如何运作的。',
  '医药': '诊断某种疾病或是确定近期死亡的死者的死因。',
  '自然': '回忆有关地形、植物、动物和天气的知识。',
  '察觉': '结合各种感官，注意一些容易忽略的细节。',
  '表演': '演戏、讲述故事、演奏乐曲或翩翩起舞。',
  '游说': '真诚且优雅地在某件事上说服他人。',
  '宗教': '回忆有关神的传说、宗教仪式的学问以及圣徽的知识。',
  '巧手': '扒窃口袋，藏起只手可握的小物件或是耍一些手上把戏。',
  '隐匿': '通过悄悄地移动和藏在事物后面来躲避别人的注意。',
  '求生': '跟踪追查、寻找食物、寻觅踪迹或是避免遭遇自然灾害。'
};

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

function abilityMod(score) {
  return Math.floor((Number(score) - 10) / 2);
}

function proficiencyBonus(level) {
  level = Number(level) || 1;
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

function avgHpPerLevel(die) {
  var face = parseInt(String(die || 'd8').replace('d', ''), 10) || 8;
  return Math.ceil(face / 2) + 1;
}

var ASI_LEVELS = { 4: 1, 8: 1, 12: 1, 16: 1, 19: 1 };
var PROF_BUMP_LEVELS = { 5: 1, 9: 1, 13: 1, 17: 1 };
var CASTING_STAT = {
  '吟游诗人': 'cha', '牧师': 'wis', '德鲁伊': 'wis', '圣武士': 'cha',
  '游侠': 'wis', '魔契师': 'cha', '术士': 'cha', '法师': 'int', '奇械师': 'int'
};

var ARMOR_LIST = ['无甲', '布甲', '皮甲', '镶钉皮甲', '兽皮甲', '链甲衫', '鳞甲', '胸甲', '半身板甲', '环甲', '链甲', '板条甲', '板甲'];
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

function defaultSpeed(race) {
  var r = String(race || '');
  if (r.indexOf('歌利亚') >= 0) return 35; // 2024 PHB 歌利亚 35尺
  return 30; // 2024 PHB：矮人/半身人 30尺，其余均为 30尺
}

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
function thirdCasterSubclass(cls, subclass) {
  return (cls === '战士' && subclass === '奥法骑士') || (cls === '游荡者' && subclass === '诡术师');
}
function casterType(cls, subclass) {
  if (FULL_CASTER[cls]) return 'full';
  if (HALF_CASTER[cls]) return 'half';
  if (PACT_CASTER[cls]) return 'pact';
  if (thirdCasterSubclass(cls, subclass)) return 'third';
  return null;
}
function castingStatFor(cls, subclass) {
  if (thirdCasterSubclass(cls, subclass)) return 'int';
  return CASTING_STAT[cls] || null;
}
function spellListClassFor(cls, subclass) {
  return thirdCasterSubclass(cls, subclass) ? '法师' : cls;
}
function spellSelectionSource(cls, subclass) {
  return '职业法术·' + cls + (subclass ? '·' + subclass : '');
}
function spellSlotsFor(cls, level, subclass) {
  var lv = Math.max(1, Math.min(20, Number(level) || 1));
  var type = casterType(cls, subclass);
  var slots = {};
  if (type === 'full') {
    var row = FULL_SLOTS[lv];
    for (var i = 0; i < 9; i++) slots[i + 1] = row[i];
  } else if (type === 'half') {
    var eff = Math.ceil(lv / 2);
    var row2 = FULL_SLOTS[eff];
    for (var j = 0; j < 9; j++) slots[j + 1] = row2[j];
  } else if (type === 'third') {
    var eff3 = lv < 3 ? 0 : Math.ceil(lv / 3);
    var row3 = eff3 ? FULL_SLOTS[eff3] : [0,0,0,0,0,0,0,0,0];
    for (var t = 0; t < 9; t++) slots[t + 1] = row3[t];
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
  var strScore = Number(scores.str) || 0;
  var cap = carryCapacity(strScore);
  var capHeavy = carryCapacityHeavy(strScore);
  var load = Number(data.currentLoad) || 0;
  var cst = carryStatus(load, cap, capHeavy);
  var speed = baseSpeed - (cst.speedPenalty > 0 ? cst.speedPenalty : 0);
  speed += effectSum(data, mods, ['speed']);
  var equippedItems = normalizeItems(data).filter(function (it) { return it.equipped === true; });
  var equippedArmorItem = equippedItems.filter(function (it) { return itemEquipKind(it) === 'armor'; }).slice(-1)[0];
  var armorName = data.armor || (equippedArmorItem && equippedArmorItem.name) || '无甲';
  var shieldOn = !!data.shield || equippedItems.some(function (it) { return itemEquipKind(it) === 'shield'; });
  var AC = armorAC(armorName, dexMod, shieldOn) + effectSum(data, mods, ['ac', 'ac.bonus']);
  var initiative = dexMod + effectSum(data, mods, ['initiative']);
  var attackBonus = Math.max(mods.str || 0, dexMod) + prof + effectSum(data, mods, ['attack.all', 'weapon.attack']);
  var spellDC = null;
  var spellAttack = null;
  var castingStat = castingStatFor(data.class, data.subclass);
  if (castingStat) {
    var cm = mods[castingStat] || 0;
    spellDC = 8 + prof + cm + effectSum(data, mods, ['spell.dc']);
    spellAttack = prof + cm + effectSum(data, mods, ['spell.attack']);
  }
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
  var saves = {};
  var saveProf = data.savingThrows || {};
  ABILITIES.forEach(function (a) {
    var trained = !!saveProf[a.key];
    var bonus = mods[a.key] || 0;
    if (trained) bonus += prof;
    bonus += effectSum(data, mods, ['save.all', 'save.' + a.key]);
    saves[a.key] = { trained: trained, bonus: bonus };
  });
  var dieFace = parseInt(String(data.hitDice || CLASS_HD[data.class] || 'd8').replace('d', ''), 10) || 8;
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

function sourceKind(source) {
  if (source && typeof source === 'object' && source.sourceKind) return source.sourceKind;
  var s = String(source && source.source ? source.source : (source || ''));
  return /第三方|同人|自制|Homebrew|DMGuild|3PP|Third[- ]?Party|新UA/i.test(s) ? 'thirdParty' : 'official';
}
function briefText(text, maxLen) {
  var t = String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b\d+级[：:][\s\S]*$/g, '').trim();
  maxLen = maxLen || 160;
  return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
}

function skillBonus(skill, data) {
  var derived = computeDerived(data);
  return (derived.skills[skill.name] || {}).bonus || 0;
}

function itemEquipKind(it) {
  it = it || {};
  var cat = String(it.category || '');
  var slot = String(it.equipSlot || it.slot || '').toLowerCase();
  if (it.canEquip === false || it.equippable === false || it.consumable === true) return '';
  if (/^(weapon|武器)$/.test(slot)) return 'weapon';
  if (/^(armor|护甲)$/.test(slot)) return 'armor';
  if (/^(shield|盾)$/.test(slot)) return 'shield';
  if (/^(accessory|饰品|gear|装备)$/.test(slot)) return 'gear';
  if (it.baseAC != null || /护甲|轻甲|中甲|重甲/.test(cat)) return 'armor';
  if (it.damageFormula || /武器/.test(cat)) return 'weapon';
  if (/盾/.test(cat)) return 'shield';
  if (it.canEquip === true || it.equippable === true) return 'gear';
  return '';
}
function normalizeItems(data) {
  var raw = Array.isArray(data.items) ? data.items : [];
  var items = raw.map(function (it) {
    if (!it || typeof it !== 'object') return { name: String(it || ''), category: '杂物', quantity: 1, equipped: false };
    var out = Object.assign({}, it);
    out.quantity = Math.max(1, Number(out.quantity) || 1);
    var kind = itemEquipKind(out);
    if (!kind) out.equipped = false;
    else if (!out.equipSlot) out.equipSlot = kind;
    return out;
  });
  if (!items.length && data.equipment) {
    String(data.equipment).split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (line) {
      items.push({ name: line, category: '杂物', quantity: 1, price: '', equipped: false, effect: '', equipSlot: '' });
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

function buildAiSummary(data) {
  data = data || {};
  var d = computeDerived(data);
  var hp = data.HP || { current: 0, max: 0, temp: 0 };
  var maxHp = d.maxHp != null ? d.maxHp : (hp.max || 0);
  var parts = [];
  parts.push('【' + (data.name || '未命名') + '】' + [data.race, data.class, characterBackgroundName(data), data.level ? 'Lv' + data.level : ''].filter(Boolean).join(' '));
  parts.push('HP ' + hp.current + '/' + maxHp + (hp.temp ? ' 临时' + hp.temp : '') + ' | AC ' + d.AC + ' | 先攻 ' + signed(d.initiative) + ' | 速度 ' + d.speed + '尺');
  parts.push('熟练加值 ' + signed(d.proficiency) + ' | 攻击 ' + signed(d.attackBonus) + (d.spellDC != null ? ' | 法术DC ' + d.spellDC + ' | 法术攻击 ' + signed(d.spellAttack) : ''));
  parts.push('属性: ' + ABILITIES.map(function (a) { return a.name + a.key.toUpperCase() + ' ' + (data.abilityScores || {})[a.key] + '(' + signed(d.abilityMods[a.key]) + ')'; }).join(' '));
  var statuses = normalizeStatuses(data);
  if (statuses.length) parts.push('状态: ' + statuses.map(function (s) { return s.name + (s.remaining ? '(' + s.remaining + ')' : ''); }).join('、'));
  else parts.push('状态: 无');
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
  var fx = [];
  (Array.isArray(data.effectTags) ? data.effectTags : []).forEach(function (t) {
    var k = resolveEffectTagKey(t); if (k) fx.push(EFFECT_TAG_PRESETS[k].label);
  });
  (Array.isArray(data.effects) ? data.effects : []).forEach(function (e) {
    if (e && e.name) fx.push(e.name);
  });
  if (fx.length) parts.push('生效效果: ' + fx.join('、'));
  if (data.hitDice) parts.push('生命骰 ' + (data.hitDiceRemaining != null ? data.hitDiceRemaining : data.level || 1) + '/' + (data.level || 1) + ' (' + data.hitDice + ')');
  return parts.join('\n');
}

function persistTokens() {
  try {
    if (!window.MapEngine || typeof window.MapEngine.getAllTokens !== 'function') return;
    var tokens = window.MapEngine.getAllTokens();
    var arr = (tokens || []).map(function (t) {
      var saved = Object.assign({}, t);
      saved.conditions = Array.isArray(t.conditions) ? t.conditions.slice() : [];
      saved.data = t.data || null;
      return saved;
    });
    localStorage.setItem('trpg_characters', JSON.stringify(arr));
  } catch (e) { /* 静默 */ }
}

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

var _activeCardModal = null;
function hideCardFloatingUi() {
  try { if (window.TrpgTag && window.TrpgTag.hideTip) window.TrpgTag.hideTip(); } catch (e) {}
  try { hideSpellTip(); } catch (e) {}
}
function closeCardModal(mask) {
  mask = mask || _activeCardModal;
  if (!mask) return;
  try {
    if (mask.__cb2KeyHandler) document.removeEventListener('keydown', mask.__cb2KeyHandler, true);
    if (mask.parentNode) mask.parentNode.removeChild(mask);
  } catch (e) {}
  if (_activeCardModal === mask) _activeCardModal = null;
}
function mountCardModal(mask) {
  if (!mask) return null;
  closeCardModal(_activeCardModal);
  try {
    Array.prototype.forEach.call(document.querySelectorAll('.cb2-modal-mask'), function (old) { if (old !== mask) closeCardModal(old); });
  } catch (e) {}
  hideCardFloatingUi();
  var dialog = mask.querySelector('.cb2-modal');
  if (dialog && !dialog.querySelector('[data-modal-close]')) {
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'cb2-modal-x';
    x.setAttribute('data-modal-close', '1');
    x.setAttribute('aria-label', '关闭');
    x.textContent = '×';
    dialog.insertBefore(x, dialog.firstChild);
  }
  mask.addEventListener('click', function (e) {
    var target = e.target;
    var cancel = target && target.closest ? target.closest('[data-cancel],[data-modal-close]') : null;
    if (target === mask || cancel) {
      e.preventDefault();
      e.stopPropagation();
      closeCardModal(mask);
    }
  }, true);
  mask.__cb2KeyHandler = function (e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCardModal(mask);
    }
  };
  document.addEventListener('keydown', mask.__cb2KeyHandler, true);
  document.body.appendChild(mask);
  _activeCardModal = mask;
  setTimeout(function () {
    try {
      var first = mask.querySelector('input:not([type="hidden"]),select,textarea,button[data-ok]');
      if (first) first.focus();
    } catch (e) {}
  }, 0);
  return mask;
}

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

var _rollLogList = null;
var _rollLogWrap = null;
var _rollLogCollapseTimer = null;
function ensureRollLog() {
  try {
    if (_rollLogList && document.body.contains(_rollLogList)) return _rollLogList;
    var wrap = document.createElement('div');
    wrap.className = 'cb-rolllog';
    wrap.innerHTML = '<div class="cb-rolllog-head"><span>🎲 掷骰日志</span><span class="cb-rolllog-actions">' +
      '<button type="button" class="cb-rolllog-collapse" title="收起">—</button>' +
      '<button type="button" class="cb-rolllog-clear" title="清空">清空</button>' +
      '<button type="button" class="cb-rolllog-close" title="关闭">×</button></span></div>' +
      '<div class="cb-rolllog-list"></div>';
    document.body.appendChild(wrap);
    _rollLogWrap = wrap;
    _rollLogList = wrap.querySelector('.cb-rolllog-list');
    wrap.addEventListener('click', function (e) {
      var target = e.target;
      if (target.closest && target.closest('.cb-rolllog-close')) {
        clearTimeout(_rollLogCollapseTimer);
        wrap.remove(); _rollLogWrap = null; _rollLogList = null; return;
      }
      if (target.closest && target.closest('.cb-rolllog-clear')) {
        if (_rollLogList) _rollLogList.innerHTML = '';
        e.stopPropagation(); return;
      }
      if ((target.closest && target.closest('.cb-rolllog-collapse')) || target.classList.contains('cb-rolllog-head')) {
        wrap.classList.toggle('collapsed');
        e.stopPropagation();
      }
    });
    return _rollLogList;
  } catch (e) { return null; }
}
function addRollLog(entry) {
  hideCardFloatingUi();
  var list = ensureRollLog();
  if (!list) return;
  if (_rollLogWrap) _rollLogWrap.classList.remove('collapsed');
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
  clearTimeout(_rollLogCollapseTimer);
  _rollLogCollapseTimer = setTimeout(function () {
    if (_rollLogWrap && document.body.contains(_rollLogWrap)) _rollLogWrap.classList.add('collapsed');
  }, 5200);
}

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

function levelUpFeatures(oldLevel, newLevel, cls, subclass) {
  var feats = [];
  var oldProf = proficiencyBonus(oldLevel);
  var newProf = proficiencyBonus(newLevel);
  if (newProf > oldProf) {
    feats.push({ type: 'prof', text: '熟练加值提升：+' + oldProf + ' → +' + newProf + '（已自动更新）' });
  }
  if (ASI_LEVELS[newLevel]) {
    var t = '属性提升：本次升级获得「属性提升」——可在编辑角色卡的「属性」页「属性提升来源」中拖动 +2/+1（或 +1×3）到属性，或改选一个专长（属性上限 20）';
    if (newLevel === 19) t += '；19 级同时获得一个「史诗恩惠」专长';
    feats.push({ type: 'asi', text: t });
  }
  if (ASI_LEVELS[oldLevel]) {
    feats.push({ type: 'asi-pending', text: '属性提升：上一级（' + oldLevel + ' 级）应已获得属性提升，若尚未分配请现在补选（+2 一项 / +1 两项 / 选专长）' });
  }
  if (casterType(cls, subclass)) {
    var sl = spellSlotsFor(cls, newLevel, subclass);
    feats.push({ type: 'slots', text: '施法者：达到 ' + newLevel + ' 级，法术位更新为「' + spellSlotsText(sl) + '」（已自动写入角色卡）' });
  }
  if (newLevel === 20) {
    feats.push({ type: 'max', text: '达到 20 级（最高等级），角色升级流程完成' });
  }
  var sc = SUBCLASSES[cls];
  if (sc && newLevel >= sc.level && oldLevel < sc.level) {
    feats.push({ type: 'subclass', text: '副职解锁：达到 ' + newLevel + ' 级，请在编辑页「职业」步骤选择副职（' + Object.keys(sc.list).join(' / ') + '）' });
  }
  var lvFeats = classFeaturesAt(cls, newLevel);
  if (lvFeats.length) {
    feats.push({ type: 'auto-feat', text: '已自动加入职业特性：' + lvFeats.join('、') + '（写入角色卡「特性」列表）' });
  }
  feats.push({ type: 'class', text: '职业能力：请点击「查看原文」打开职业页，确认 ' + newLevel + ' 级获得的新职业能力，并在下方手动记录' });
  return feats;
}

function applyLevelUp(data, hpGain, note) {
  data = data || {};
  var oldLevel = Number(data.level) || 1;
  var newLevel = oldLevel + 1;
  if (newLevel > 20) return null;
  var gain = Math.max(1, Math.round(Number(hpGain) || 1));
  var prof = proficiencyBonus(newLevel);
  var mods = Object.assign({}, data.abilityMods || {});
  var scores = Object.assign({}, data.abilityScores || {});
  var slots = spellSlotsFor(data.class || '', newLevel, data.subclass || '');
  var nd = Object.assign({}, data, {
    level: newLevel,
    proficiency: prof,
    attackBonus: Math.max(mods.str || 0, mods.dex || 0) + prof,
    initiative: mods.dex || 0,
    spellSlots: slots
  });
  if (slots && data.spellSlotsUsed) {
    var used2 = {};
    Object.keys(slots).forEach(function (r) {
      var total = Number(slots[r]) || 0;
      var usedN = Math.min(total, Number((data.spellSlotsUsed || {})[r]) || 0);
      if (usedN > 0) used2[r] = usedN;
    });
    nd.spellSlotsUsed = used2;
  }
  if (nd.hitDiceRemaining != null) nd.hitDiceRemaining = Math.min(newLevel, (Number(nd.hitDiceRemaining) || 0) + 1);
  else nd.hitDiceRemaining = newLevel;

  var log = Array.isArray(data.levelLog) ? data.levelLog.slice() : [];
  var oldMaxHp = (computeDerived(data).maxHp != null ? computeDerived(data).maxHp : Number((data.HP || {}).max) || 0);
  var newMaxHp = (computeDerived(nd).maxHp != null ? computeDerived(nd).maxHp : oldMaxHp);
  var hpGainLog = Math.max(0, newMaxHp - oldMaxHp);
  log.push({ level: newLevel, hpGain: hpGainLog, date: new Date().toISOString().slice(0, 10), note: note || '' });
  nd.levelLog = log;
  var f = String(note || '').trim();
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
  '.cb2-head{display:flex;align-items:center;gap:14px;padding:8px 6px 14px;border-bottom:1px solid var(--border);margin-bottom:12px;flex-wrap:wrap}' +
  '.cb2-avatar{width:64px;height:64px;border-radius:12px;object-fit:cover;border:2px solid var(--gold-d);background:var(--bg-surface);flex-shrink:0;box-shadow:0 2px 10px rgba(0,0,0,.4);transition:transform .25s}' +
  '.cb2-avatar:hover{transform:scale(1.06);border-color:var(--gold)}' +
  '.cb2-avatar-ph{width:64px;height:64px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:26px;background:linear-gradient(135deg,var(--bg-active),var(--bg-panel));border:2px dashed var(--border-light);color:var(--text-3);flex-shrink:0}' +
  '.cb2-title{flex:1;min-width:200px}' +
  '.cb2-name{font-family:"Cinzel","Noto Serif SC",serif;font-size:22px;font-weight:700;letter-spacing:.04em;color:var(--text);margin:0;text-shadow:0 2px 8px rgba(0,0,0,.5)}' +
  '.cb2-sub{font-family:"Noto Serif SC",serif;font-size:12.5px;color:var(--gold-l);margin-top:2px;letter-spacing:.02em}' +
  '.cb2-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
  '.cb2-switch{display:flex;gap:6px;align-items:center;background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:6px 8px;flex-wrap:wrap;max-width:340px}' +
  '.cb2-switch .cb2-sw-avatar{width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid var(--border-light);cursor:pointer;transition:all .2s;flex-shrink:0;background:var(--bg-surface)' +
  ';display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-2)}' +
  '.cb2-switch .cb2-sw-avatar:hover{transform:scale(1.15);border-color:var(--gold)}' +
  '.cb2-switch .cb2-sw-avatar.cur{border-color:var(--gold);box-shadow:0 0 8px rgba(201,168,76,.5)}' +
  '.cb2-sw-add{width:30px;height:30px;border-radius:50%;border:1.5px dashed var(--border-light);background:transparent;color:var(--text-3);cursor:pointer;font-size:16px;line-height:1;transition:all .2s;flex-shrink:0}' +
  '.cb2-sw-add:hover{border-color:var(--green);color:var(--green-l);transform:scale(1.12)}' +
  '.cb2-sw-del{width:30px;height:30px;border-radius:50%;border:1.5px solid var(--border-light);background:transparent;color:var(--text-3);cursor:pointer;font-size:14px;line-height:1;transition:all .2s;flex-shrink:0}' +
  '.cb2-sw-del:hover{border-color:var(--red);color:var(--red-l);transform:scale(1.12)}' +
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
  '.cb2-tabs{display:flex;gap:4px;background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:4px;margin-bottom:14px;flex-wrap:wrap}' +
  '.cb2-tab{border:none;background:transparent;color:var(--text-3);padding:7px 12px;border-radius:7px;cursor:pointer;font-size:12px;font-family:inherit;display:flex;align-items:center;gap:6px;transition:all .2s}' +
  '.cb2-tab:hover{color:var(--text);background:var(--bg-hover)}' +
  '.cb2-tab.active{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;font-weight:700;box-shadow:0 2px 8px rgba(201,168,76,.35)}' +
  '.cb2-tab .cb2-ic{font-size:13px}' +
  '.cb2-sec{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px;transition:border-color .2s}' +
  '.cb2-sec:hover{border-color:var(--border-light)}' +
  '.cb2-sec-h{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-family:"Noto Serif SC",serif;font-size:13px;font-weight:700;color:var(--gold-l);letter-spacing:.05em;padding-bottom:6px;border-bottom:1px solid var(--border);text-transform:uppercase}' +
  '.cb2-sec-h .cb2-sec-note{margin-left:auto;font-family:"Noto Sans SC",sans-serif;font-size:10.5px;font-weight:400;color:var(--text-3);text-transform:none}' +
  '.cb2-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;align-items:start}' +
  '.cb2{width:100%;box-sizing:border-box}' +
  '.cb2-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}' +
  '.cb2-hint{font-size:11px;color:var(--text-3)}' +
  '.cb2-empty{color:var(--text-mute);font-size:12px;padding:14px;text-align:center;border:1px dashed var(--border);border-radius:8px;background:rgba(26,26,46,.4)}' +
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
  '.cb2-corestats{display:grid;grid-template-columns:repeat(6,minmax(108px,1fr));gap:8px;margin:-4px 0 14px}' +
  '.cb2-corestat{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;gap:1px 8px;align-items:center;background:var(--bg-panel);border:1px solid var(--border);border-radius:9px;padding:8px 10px;cursor:pointer;transition:all .2s}' +
  '.cb2-corestat:hover{border-color:var(--gold-d);transform:translateY(-1px)}' +
  '.cb2-corestat .n{font-size:10px;color:var(--text-3)}' +
  '.cb2-corestat .score{grid-row:1/3;grid-column:2;font:700 20px/1 "Cinzel",serif;color:var(--text)}' +
  '.cb2-corestat .mod{font-size:12px;font-weight:700;color:var(--gold-l)}' +
  '.cb2-corestat .save{font-size:9px;color:var(--text-mute);margin-left:4px}' +
  '.cb2-coreextras{display:flex;gap:8px;flex-wrap:wrap;margin:-6px 0 14px}' +
  '.cb2-coreextra{padding:5px 9px;border:1px solid var(--border);background:rgba(22,33,62,.72);border-radius:999px;color:var(--text-2);font-size:10.5px}' +
  '@media(max-width:900px){.cb2-corestats{grid-template-columns:repeat(3,minmax(96px,1fr))}}' +
  '@media(max-width:520px){.cb2-corestats{grid-template-columns:repeat(2,minmax(96px,1fr))}}' +
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
  '.cb2-ability .cb2-ab-input{width:74px;margin:3px auto;display:block;text-align:center;font-family:"Cinzel",serif;font-size:20px;font-weight:700;color:var(--text);background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;padding:3px 2px;outline:none;cursor:text}' +
  '.cb2-ability .cb2-ab-input:hover,.cb2-ability .cb2-ab-input:focus{border-color:var(--gold-d);color:var(--gold-l)}' +
  '.cb2-abilities.cb2-ab-big{grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px}' +
  '.cb2-abilities.cb2-ab-big .cb2-ability{padding:12px 8px}' +
  '.cb2-skill-groups-detail{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}' +
  '.cb2-skill-grp{border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--bg-panel)}' +
  '.cb2-skill-grp-t{font-size:11px;color:var(--text-2);margin-bottom:6px}' +
  '.cb2-skill-grp .cb2-skills{grid-template-columns:1fr}' +
  '.cb2-skills{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px}' +
  '.cb2-skill{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;transition:background .15s;border:1px solid transparent}' +
  '.cb2-skill:hover{background:var(--bg-hover);border-color:var(--border-light)}' +
  '.cb2-skill .cb2-sk-name{flex:1;font-size:12px;color:var(--text)}' +
  '.cb2-skill .cb2-sk-ab{font-size:9.5px;color:var(--text-mute);width:22px}' +
  '.cb2-skill .cb2-sk-bonus{font-family:"Cinzel",serif;font-weight:700;font-size:13px;color:var(--gold-l);min-width:30px;text-align:right}' +
  '.cb2-skill.trained .cb2-sk-name::after{content:"●";color:var(--gold);font-size:7px;margin-left:4px;vertical-align:2px}' +
  '.cb2-skill.expert .cb2-sk-name::after{content:"◆";color:var(--gold-l);font-size:8px;margin-left:4px;vertical-align:1px}' +
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
  '.cb2-slotgrid{display:flex;flex-direction:column;gap:6px}' +
  '.cb2-slotrow{display:flex;align-items:center;gap:10px}' +
  '.cb2-slotrow .cb2-sl-l{font-size:11px;color:var(--text-2);min-width:42px;font-family:"Noto Serif SC",serif;font-weight:700}' +
  '.cb2-slotrow .cb2-sl-dots{display:flex;gap:6px;flex-wrap:wrap}' +
  '.cb2-slot{width:22px;height:22px;border-radius:50%;border:2px solid var(--gold-d);background:rgba(201,168,76,.18);cursor:pointer;transition:all .18s;flex-shrink:0}' +
  '.cb2-slot:hover{transform:scale(1.18);box-shadow:0 0 8px rgba(201,168,76,.55)}' +
  '.cb2-slot.used{background:var(--bg-deep);border-color:var(--border);box-shadow:inset 0 0 6px rgba(0,0,0,.6);cursor:pointer}' +
  '.cb2-slot.used:hover{border-color:var(--gold);transform:scale(1.18);box-shadow:0 0 8px rgba(201,168,76,.35)}' +
  '.cb2-slotrow .cb2-sl-n{font-size:11px;color:var(--text-3);min-width:52px}' +
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
  '.cb2-growth-board{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:10px;margin-top:8px;align-items:start}' +
  '.cb2-growth-tokens,.cb2-growth-targets{display:flex;gap:7px;flex-wrap:wrap}' +
  '.cb2-growth-token{border:1px solid var(--gold-d);background:linear-gradient(135deg,rgba(201,168,76,.22),rgba(201,168,76,.08));color:var(--gold-l);border-radius:10px;padding:7px 10px;font-size:12px;font-weight:800;cursor:grab;user-select:none;min-width:42px;text-align:center}' +
  '.cb2-growth-token.used{opacity:.42;border-style:dashed;background:var(--bg-deep);cursor:default}' +
  '.cb2-growth-abil{border:1px solid var(--border);background:var(--bg-panel);border-radius:10px;padding:7px 8px;min-width:84px;display:grid;gap:5px;cursor:pointer;transition:.15s}' +
  '.cb2-growth-abil:hover,.cb2-growth-abil.dragover{border-color:var(--gold-d);background:var(--bg-hover)}' +
  '.cb2-growth-abil .n{font-size:11px;color:var(--text-2)}' +
  '.cb2-growth-abil .v{font-size:13px;color:var(--text);font-family:"Cinzel",serif}' +
  '.cb2-growth-abil .adds{display:flex;gap:4px;flex-wrap:wrap;min-height:18px}' +
  '.cb2-growth-add{border:1px solid var(--green);background:rgba(46,204,113,.16);color:var(--green-l);border-radius:8px;padding:1px 6px;font-size:11px;cursor:pointer}' +
  '.cb2-selected-box.top{margin-bottom:10px;border-color:var(--gold-d);background:linear-gradient(135deg,rgba(201,168,76,.08),rgba(91,141,239,.04))}' +
  '.cb2-sub-level{display:flex;flex-direction:column;gap:6px;margin-top:8px}' +
  '.cb2-subclass-brief{margin-top:7px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:rgba(15,22,45,.62);color:var(--text-2);font-size:12px;line-height:1.55;max-width:680px}' +
  '.cb2-subclass-brief .src{display:block;margin-top:4px;color:var(--text-3);font-size:10px}' +
  '.cb2-status{display:flex;gap:8px;flex-wrap:wrap}' +
  '.cb2-status-chip{display:flex;align-items:center;gap:6px;background:rgba(229,72,77,.12);border:1px solid rgba(229,72,77,.4);color:var(--red-l);border-radius:16px;padding:3px 10px;font-size:11px;cursor:pointer;transition:all .2s}' +
  '.cb2-status-chip:hover{background:rgba(229,72,77,.2);transform:scale(1.05)}' +
  '.cb2-status-chip .cb2-st-src{color:var(--text-3);font-size:9.5px}' +
  '.cb2-status-chip .cb2-st-x{opacity:.6;font-size:10px}' +
  '.cb2-status-chip.blue{background:rgba(91,141,239,.12);border-color:rgba(91,141,239,.4);color:#9dbdf7}' +
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
  '.cb2-res{display:flex;gap:10px;flex-wrap:wrap}' +
  '.cb2-res-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:8px 12px;text-align:center;min-width:90px}' +
  '.cb2-res-card .cb2-r-name{font-size:10.5px;color:var(--text-3)}' +
  '.cb2-res-card .cb2-r-val{font-family:"Cinzel",serif;font-size:18px;font-weight:700;color:var(--amber);margin:2px 0}' +
  '.cb2-res-card .cb2-r-rec{font-size:9px;color:var(--text-mute)}' +
  '.cb2-feat{background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:12px;color:var(--text);cursor:pointer;transition:all .2s}' +
  '.cb2-feat:hover{border-color:var(--gold-d);background:var(--bg-hover)}' +
  '.cb2-feat .cb2-feat-desc{font-size:11px;color:var(--text-2);line-height:1.65;margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);white-space:pre-wrap}' +
  '.cb2-log{font-size:11px;color:var(--text-2);background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:6px 9px;margin-bottom:5px}' +
  '.cb-rolllog{position:fixed;right:18px;bottom:18px;width:min(300px,calc(100vw - 28px));max-height:260px;background:rgba(15,15,26,.97);border:1px solid var(--border-light);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.6);z-index:8500;overflow:hidden;backdrop-filter:blur(6px);font-family:"Noto Sans SC",system-ui,sans-serif}' +
  '.cb-rolllog.collapsed{max-height:34px}' +
  '.cb-rolllog.collapsed .cb-rolllog-list{display:none}' +
  '.cb-rolllog-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px 8px 12px;font-size:11px;font-weight:700;color:var(--gold-l);border-bottom:1px solid var(--border);cursor:pointer;letter-spacing:.05em;text-transform:uppercase}' +
  '.cb-rolllog-actions{display:flex;align-items:center;gap:4px}' +
  '.cb-rolllog-actions button{background:none;border:0;color:var(--text-mute);font:inherit;cursor:pointer;padding:2px 5px;border-radius:5px;text-transform:none}' +
  '.cb-rolllog-actions button:hover{color:var(--text);background:var(--bg-hover)}' +
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
  '.cb2-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(20px);background:linear-gradient(135deg,var(--green),#27ae60);color:#fff;padding:10px 22px;border-radius:10px;font-size:13px;font-weight:600;opacity:0;pointer-events:none;transition:all .35s;z-index:10000;box-shadow:0 6px 20px rgba(0,0,0,.4);font-family:"Noto Sans SC",sans-serif}' +
  '.cb2-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}' +
  '.cb2-toast.err{background:linear-gradient(135deg,var(--red),#c0392b)}' +
  '.cb2-toast.gold{background:linear-gradient(135deg,var(--gold),var(--gold-d));color:#141414}' +
  '.cb2-modal-mask{position:fixed;inset:0;background:rgba(5,5,12,.78);z-index:20000;display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(4px);animation:cb2-fade .2s}' +
  '.cb2-modal{position:relative;background:var(--bg-main);border:1px solid var(--border-light);border-radius:14px;padding:20px;width:min(520px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.68);animation:cb2-pop .25s ease-out;max-height:min(84vh,760px);overflow-y:auto}' +
  '.cb2-modal-x{position:absolute;right:10px;top:8px;width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text-2);cursor:pointer;font-size:20px;line-height:1}' +
  '.cb2-modal-x:hover{color:var(--red-l);border-color:var(--red)}' +
  '.cb2-modal h3{font-family:"Noto Serif SC",serif;color:var(--gold-l);margin:0 0 12px;font-size:15px}' +
  '.cb2-modal .cb2-m-hint{font-size:12px;color:var(--text-2);margin-bottom:12px;line-height:1.6}' +
  '.cb2-modal .cb2-m-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}' +
  '@keyframes cb2-fade{from{opacity:0}to{opacity:1}}' +
  '@keyframes cb2-pop{from{opacity:0;transform:scale(.92) translateY(10px)}to{opacity:1;transform:none}}' +
  '.cb2-in{background:var(--bg-deep);border:1px solid var(--border-light);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;font-family:inherit;width:100%;transition:border-color .2s}' +
  '.cb2-in:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 2px rgba(201,168,76,.2)}' +
  'select.cb2-in{appearance:auto}' +
  '.cb2-in-sm{width:64px}' +
  'textarea.cb2-in,textarea.cb2-ta{resize:vertical;min-height:44px;line-height:1.6;white-space:pre-wrap;overflow-wrap:break-word}' +
  '.cb2-field{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--text-2)}' +
  '.cb2-field label{font-size:10.5px;color:var(--text-3)}' +
  '.cb2-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
  '.cb2-edit-grid .full{grid-column:1/-1}' +
  '.cb2 [data-term]{cursor:help;border-bottom:1px dotted var(--text-mute)}' +
  '.cb2 [data-term]:hover{color:var(--gold-l);border-bottom-color:var(--gold)}' +
  '.cb2 .cb2-ic{display:inline-block;width:1em;text-align:center}' +
  '' +
  '.cb-card,.cb-sheet{font-family:"Noto Sans SC",system-ui,sans-serif;color:var(--text);background:transparent}' +
  '';

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
function raceTraitRecord(t, details) {
  if (typeof t === 'string') return { name: t, desc: (details && details[t]) || '' };
  if (t && typeof t === 'object') {
    var name = t.n || t.name || t.title || '未命名特性';
    return { name: String(name), desc: String(t.d || t.desc || t.description || (details && details[name]) || '') };
  }
  return { name: String(t || '未命名特性'), desc: '' };
}
function characterBackgroundName(data) {
  data = data || {};
  if (data.customBg && data.customBg.name && (data.background === '自定义背景' || data.background === data.customBg.name)) return String(data.customBg.name);
  return String(data.background || '');
}
function renderPrimaryStats(data, derived) {
  var scores = data.abilityScores || {};
  var blocks = ABILITIES.map(function (a) {
    var sc = scores[a.key] != null ? Number(scores[a.key]) : 10;
    var mod = Number(derived.abilityMods[a.key]) || 0;
    var sv = derived.saves[a.key] || { bonus: mod };
    return '<div class="cb2-corestat" data-act="roll-ab" data-ab="' + a.key + '" title="点击掷' + esc(a.name) + '检定">' +
      '<span class="n">' + esc(a.name) + ' · ' + esc(a.short) + '</span><span class="score">' + sc + '</span>' +
      '<span class="mod">' + signed(mod) + '<span class="save">豁免 ' + signed(sv.bonus) + '</span></span></div>';
  }).join('');
  var extras = [];
  var move = data.movement || {};
  [['飞行', data.flySpeed != null ? data.flySpeed : move.fly], ['游泳', data.swimSpeed != null ? data.swimSpeed : move.swim], ['攀爬', data.climbSpeed != null ? data.climbSpeed : move.climb], ['掘穴', data.burrowSpeed != null ? data.burrowSpeed : move.burrow]].forEach(function (m) {
    if (m[1] != null && m[1] !== '') extras.push(m[0] + ' ' + m[1] + ' 尺');
  });
  var pp = 10 + Number((derived.skills['察觉'] || {}).bonus || 0);
  extras.push('被动察觉 ' + pp);
  if (data.darkvision) extras.push('黑暗视觉 ' + data.darkvision + (String(data.darkvision).indexOf('尺') >= 0 ? '' : ' 尺'));
  return '<div class="cb2-corestats">' + blocks + '</div>' +
    (extras.length ? '<div class="cb2-coreextras">' + extras.map(function (x) { return '<span class="cb2-coreextra">' + esc(x) + '</span>'; }).join('') + '</div>' : '');
}

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

function renderOverview(data, derived) {
  var hp = data.HP || { current: 0, max: 0, temp: 0 };
  var maxHp = derived.maxHp != null ? derived.maxHp : (hp.max || 0);
  var pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round(hp.current / maxHp * 100))) : 0;
  var hpCls = pct <= 25 ? ' low' : '';
  var move = data.movement || {};
  var moveExtra = [];
  if (data.flySpeed != null || move.fly != null) moveExtra.push('飞' + (data.flySpeed != null ? data.flySpeed : move.fly));
  if (data.swimSpeed != null || move.swim != null) moveExtra.push('游' + (data.swimSpeed != null ? data.swimSpeed : move.swim));
  if (data.climbSpeed != null || move.climb != null) moveExtra.push('攀' + (data.climbSpeed != null ? data.climbSpeed : move.climb));
  var dcBlock = derived.spellDC != null ?
    '<div class="cb2-ov dc" data-act="roll-dc" title="点击掷法术攻击"><div class="cb2-ov-l">法术DC</div><div class="cb2-ov-v">' + derived.spellDC + '</div><div class="cb2-ov-s">法术攻击 ' + signed(derived.spellAttack) + '</div></div>' : '';
  return '<div class="cb2-overview">' +
    '<div class="cb2-ov ac" title="护甲等级"><div class="cb2-ov-l">AC</div><div class="cb2-ov-v">' + derived.AC + '</div><div class="cb2-ov-s">' + esc(data.armor || '无甲') + (data.shield ? '+盾' : '') + '</div></div>' +
    '<div class="cb2-ov hp' + hpCls + '" data-act="hp-edit" title="点击调整生命值"><div class="cb2-ov-l">HP</div><div class="cb2-ov-v">' + hp.current + '<span style="font-size:12px;color:var(--text-3)">/' + maxHp + '</span></div>' +
    (hp.temp ? '<div class="cb2-ov-s" style="color:var(--blue)">临时+' + hp.temp + '</div>' : '<div class="cb2-ov-s">' + Math.max(0, maxHp - hp.current) + ' 损</div>') +
    '<div class="cb2-hpbar"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="cb2-ov init" data-act="roll-init" title="点击掷先攻"><div class="cb2-ov-l">先攻</div><div class="cb2-ov-v">' + signed(derived.initiative) + '</div><div class="cb2-ov-s">点击掷骰</div></div>' +
    '<div class="cb2-ov speed"><div class="cb2-ov-l">速度</div><div class="cb2-ov-v">' + derived.speed + '</div><div class="cb2-ov-s">步行·尺' + (moveExtra.length ? ' · ' + moveExtra.join(' ') : '') + '</div></div>' +
    '<div class="cb2-ov prof"><div class="cb2-ov-l">熟练</div><div class="cb2-ov-v">' + signed(derived.proficiency) + '</div><div class="cb2-ov-s">角色等级 Lv' + (data.level || 1) + '</div></div>' +
    '<div class="cb2-ov atk" data-act="roll-atk" title="点击掷攻击"><div class="cb2-ov-l">攻击</div><div class="cb2-ov-v">' + signed(derived.attackBonus) + '</div><div class="cb2-ov-s">点击掷骰</div></div>' +
    dcBlock +
    '</div>';
}

function renderAttributesTab(data, derived, token) {
  var scores = data.abilityScores || {};
  var saveSrcs = data.saveSources || {}; // 豁免来源（职业·X / 自定义）
  var bgAlloc = (data.bgApplied && data.bgApplied.allocation) || {};
  var clsAlloc = {};
  Object.keys(data.classGrowthChoices || {}).forEach(function (lv) {
    var c = data.classGrowthChoices[lv];
    if (c && c.allocation) Object.keys(c.allocation).forEach(function (k) { clsAlloc[k] = (clsAlloc[k] || 0) + (Number(c.allocation[k]) || 0); });
  });
  var featAlloc = {};
  Object.keys(data.featAsi || {}).forEach(function (fn) {
    var fa = data.featAsi[fn];
    if (fa && fa.allocation) Object.keys(fa.allocation).forEach(function (k) { featAlloc[k] = (featAlloc[k] || 0) + (Number(fa.allocation[k]) || 0); });
  });
  var abBlocks = ABILITIES.map(function (a) {
    var sc = scores[a.key] != null ? scores[a.key] : 10;
    var mod = derived.abilityMods[a.key] || 0;
    var sv = derived.saves[a.key] || { trained: false, bonus: 0 };
    var srcs = saveSrcs[a.key] || [];
    var srcTip = sv.trained && srcs.length ? '（来源：' + srcs.join('、') + '）' : (sv.trained ? '（手动勾选）' : '');
    var addChips = [];
    if (bgAlloc[a.key]) addChips.push('背景+' + bgAlloc[a.key]);
    if (clsAlloc[a.key]) addChips.push('职业+' + clsAlloc[a.key]);
    if (featAlloc[a.key]) addChips.push('专长+' + featAlloc[a.key]);
    var base = sc;
    addChips.forEach(function (c) { base -= parseInt(c.split('+')[1], 10) || 0; });
    var chipHtml = addChips.length
      ? '<div class="cb2-ab-chips" title="来源加值">' + addChips.map(function (c) { return '<span class="cb2-ab-chip">' + c + '</span>'; }).join('') + '</div>'
      : '<div class="cb2-ab-base">基础 ' + base + '</div>';
    return '<div class="cb2-ability" title="属性值可直接修改（回车/失焦生效，派生值自动重算）">' +
      '<span class="cb2-ab-name" data-term="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
      '<span class="cb2-ab-short">' + a.short + '</span>' +
      '<input type="number" class="cb2-ab-input" data-ab-input="' + a.key + '" min="1" max="30" value="' + sc + '" title="直接修改属性值">' +
      '<div class="cb2-ab-mod' + (mod < 0 ? ' neg' : '') + '">' + signed(mod) + '</div>' +
      '<div class="cb2-ab-save' + (sv.trained ? ' prof' : '') + '" data-act="roll-save" data-ab="' + a.key + '" title="点击掷豁免' + esc(srcTip) + '">豁免 <b>' + signed(sv.bonus) + '</b></div>' +
      chipHtml +
      '</div>';
  }).join('');
  return '' +
    '<div class="cb2-sec"><h4 class="cb2-sec-h">属性 <span class="cb2-sec-note">数字可直接修改，派生值实时联动；基础值=最终值−来源加值</span></h4><div class="cb2-abilities cb2-ab-big">' + abBlocks + '</div></div>' +
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


function renderRaceTab(data, derived) {
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">🧝 种族 <span class="cb2-sec-note">种族特性自动生效</span></h4>';
  html += '<div class="cb2-hint">种族 <b style="color:var(--gold-l)">' + esc(data.race || '—') + '</b>' +
    (data.subrace ? ' · 亚种 <b style="color:var(--gold-l)">' + esc(data.subrace) + '</b>' : '') +
    (data.size ? ' · 体型 ' + esc(data.size) : '') +
    (data.speed != null ? ' · 速度 ' + esc(data.speed) + ' 尺' : '') + '</div>';
  var traits = (data.raceFeatures && data.raceFeatures.traits) || [];
  if (traits.length) {
    html += '<div class="cb2-feat-chiprow" style="margin-top:8px">' + traits.map(function (t) {
      var rec = raceTraitRecord(t, data.raceFeatures && data.raceFeatures.details);
      if (window.TrpgTag && window.TrpgTag.chip) {
        return window.TrpgTag.chip({ name: rec.name, type: 'race', source: '种族·' + (data.race || ''), desc: rec.desc || rec.name, title: rec.desc ? rec.name + '：' + rec.desc : rec.name });
      }
      return '<span class="cb2-feat-chip" title="' + esc(rec.desc || rec.name) + '">' + esc(rec.name) + '<span class="src auto">种族</span></span>';
    }).join('') + '</div>';
  } else {
    html += '<div class="cb2-empty">无种族特性记录（可在「特性」页查看）</div>';
  }
  html += '</div>';
  return html;
}

function renderClassTab(data, derived, ctx) {
  var classSource = data.ruleVersion === '2014'
    ? '玩家手册/职业/' + (data.class || '') + '.html'
    : '玩家手册2024/角色职业/' + (data.class || '') + '/' + (data.class || '') + '.htm';
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">⚔️ 职业 <span class="cb2-sec-note">等级与特性一览</span></h4>';
  html += '<div class="cb2-hint">职业 <b style="color:var(--gold-l)">' + esc(data.class || '—') + '</b>' +
    (data.subclass ? ' · 副职 <b style="color:var(--gold-l)">' + esc(data.subclass) + '</b>' : '') +
    ' · 等级 <b style="color:var(--gold-l)">Lv' + (data.level || 1) + '</b>' +
    ' · 熟练加值 <b style="color:var(--gold-l)">' + signed(derived.proficiency) + '</b>' +
    (data.hitDice ? ' · 生命骰 ' + esc(data.hitDice) : '') + '</div>';
  var growthChoices = data.classGrowthChoices || {};
  // 详情页不展示"职业成长选择"过程记录区块：属性提升结果已在属性页来源中展示，
  // 专长在下方"职业特性"区展示（唯一一次），避免重复与过程记录噪音
  var feats = Array.isArray(data.features) ? data.features : [];
  // 职业特性过滤：成长条目只保留"专长"（属性提升结果归属性页）；排除副职选择/种族/背景来源
  var clsFeats = feats.filter(function (f) {
    var s = String(f);
    if (s.indexOf('副职选择·') === 0) return false;
    if (s.indexOf('职业成长·') === 0) return s.indexOf('·专长：') >= 0;
    if (!featDetailSrc(f, data).auto) return false;
    var tag = featDetailSrc(f, data).tag;
    return tag.indexOf('种族') !== 0 && tag.indexOf('背景') !== 0;
  });
  var classChoices = data.classChoices || {};
  var choiceLabels = { fightingStyle: '战斗风格', divineOrder: '圣职', primalOrder: '原初职能', metamagic: '超魔法', invocations: '魔能祈唤' };
  var choiceTags = [];
  Object.keys(choiceLabels).forEach(function (key) {
    var values = Array.isArray(classChoices[key]) ? classChoices[key] : (classChoices[key] ? [classChoices[key]] : []);
    values.forEach(function (name) { choiceTags.push({ key: key, name: name, label: choiceLabels[key] }); });
  });
  if (choiceTags.length) {
    html += '<div class="cb2-mini-label" style="margin-top:9px">已选择的职业能力</div><div class="cb2-feat-chiprow" style="margin-top:5px">' + choiceTags.map(function (rec) {
      var details = data.classChoiceDetails && data.classChoiceDetails[rec.key] && data.classChoiceDetails[rec.key][rec.name];
      var desc = details && details.desc ? details.desc : rec.label + '：' + rec.name;
      var source = details && details.source ? details.source : ('职业·' + (data.class || ''));
      if (window.TrpgTag && window.TrpgTag.chip) return window.TrpgTag.chip({ name: rec.label + '：' + rec.name, type: 'cls', source: source, system: ctx && ctx.system, hideSource: true, desc: desc, title: rec.name });
      return '<span class="cb2-feat-chip" title="' + esc(desc) + '">' + esc(rec.label + '：' + rec.name) + '</span>';
    }).join('') + '</div>';
  }
  var subclassChoiceTags = [];
  var subclassChoices = data.subclassChoices || {};
  Object.keys(subclassChoices).forEach(function (key) {
    var values = Array.isArray(subclassChoices[key]) ? subclassChoices[key] : (subclassChoices[key] ? [subclassChoices[key]] : []);
    values.forEach(function (name) {
      var details = data.subclassChoiceDetails && data.subclassChoiceDetails[key] && data.subclassChoiceDetails[key][name];
      subclassChoiceTags.push({ key: key, name: name, details: details || {} });
    });
  });
  if (subclassChoiceTags.length) {
    html += '<div class="cb2-mini-label" style="margin-top:9px">已配置的子职业能力</div><div class="cb2-feat-chiprow" style="margin-top:5px">' + subclassChoiceTags.map(function (rec) {
      var label = rec.details.label || '子职业选择';
      var desc = rec.details.desc || (label + '：' + rec.name);
      var source = rec.details.source || ('副职·' + (data.subclass || ''));
      var timing = rec.details.replaceTiming ? '可在' + rec.details.replaceTiming + '更换。\n' : '';
      if (window.TrpgTag && window.TrpgTag.chip) return window.TrpgTag.chip({ name: label + '：' + rec.name, type: 'subclass', source: source, system: ctx && ctx.system, hideSource: true, desc: timing + desc, title: rec.name });
      return '<span class="cb2-feat-chip" title="' + esc(timing + desc) + '">' + esc(label + '：' + rec.name) + '</span>';
    }).join('') + '</div>';
  }
  if (clsFeats.length) {
    html += '<div class="cb2-mini-label" style="margin-top:9px">职业特性</div><div class="cb2-feat-chiprow" style="margin-top:5px">' + clsFeats.map(function (f) {
      var savedClassDetail = data.classFeatureDetails && data.classFeatureDetails[f];
      var savedSubclassDetail = data.subclassFeatureDetails && data.subclassFeatureDetails[f];
      var dsc = (savedSubclassDetail && savedSubclassDetail.desc) || (savedClassDetail && savedClassDetail.desc) || lookupFeatDesc(f, data.class);
      var src = featDetailSrc(f, data);
      var type = src.tag.indexOf('副职') === 0 ? 'subclass' : 'cls';
      // 成长专长条目显示名剥离"职业成长·X级·专长："前缀，直接展示专长名
      var showName = String(f).replace(/^职业成长·\d+级·专长：/, '');
      if (window.TrpgTag && window.TrpgTag.chip) {
        var ruleSource = savedSubclassDetail && savedSubclassDetail.source ? savedSubclassDetail.source : ((savedClassDetail && savedClassDetail.source) || classSource);
        return window.TrpgTag.chip({ name: showName, type: type, source: ruleSource, system: ctx && ctx.system, hideSource: true, desc: dsc || f, title: dsc ? showName + '：' + dsc : showName });
      }
      return '<span class="cb2-feat-chip" title="' + esc(dsc || f) + '">' + esc(showName) + '<span class="src auto">' + esc(src.tag) + '</span></span>';
    }).join('') + '</div>';
  } else {
    html += '<div class="cb2-mini-label" style="margin-top:9px">职业特性</div><div class="cb2-empty">无职业特性记录（升级/编辑时自动写入；可在「特性」页查看全部）</div>';
  }
  html += '</div>';
  return html;
}

function backgroundAbilityEvidence(data, allowed) {
  var applied = data && data.bgApplied;
  if (!applied || !applied.mode) return { summary: Array.isArray(allowed) ? allowed.join('、') : '—', trace: '' };
  var allocation = Object.assign({}, applied.allocation || {});
  if (!Object.keys(allocation).length) {
    var before = applied.before || {};
    ABILITIES.forEach(function (a) {
      var prev = before[a.key];
      var after = applied.after && applied.after[a.key] != null ? applied.after[a.key] : (data.abilityScores && data.abilityScores[a.key]);
      if (prev != null && after != null && Number(after) > Number(prev)) allocation[a.key] = Number(after) - Number(prev);
    });
  }
  var parts = ABILITIES.map(function (a) { return allocation[a.key] ? a.name + ' +' + allocation[a.key] : ''; }).filter(Boolean);
  var traces = ABILITIES.map(function (a) {
    if (!allocation[a.key]) return '';
    var before = applied.before && applied.before[a.key] != null ? Number(applied.before[a.key]) : null;
    var after = applied.after && applied.after[a.key] != null ? Number(applied.after[a.key]) : (before == null ? null : before + Number(allocation[a.key]));
    var current = data.abilityScores && data.abilityScores[a.key] != null ? Number(data.abilityScores[a.key]) : after;
    var text = a.name + '：' + (before == null ? '?' : before) + ' + ' + allocation[a.key] + ' = ' + (after == null ? '?' : after);
    if (current != null && after != null && current !== after) text += '，当前 ' + current;
    return text;
  }).filter(Boolean);
  return { summary: parts.join('、') || (applied.mode === '111' ? '三项属性各提高 1' : '一项属性提高 2，另一项提高 1'), trace: traces.join('；') };
}

function renderBackgroundTab(data, derived) {
  var isCustom = data.background === '自定义背景' || !!data.customBg;
  var cbg = data.customBg || {};
  var displayName = isCustom ? (cbg.name || '自定义背景') : (data.background || '—');
  var bd = isCustom ? cbg : ((data.bgData && (data.bgData.abilities || data.bgData.skills || data.bgData.feat)) ? data.bgData : (BACKGROUNDS[data.background] || {}));
  var ev = backgroundAbilityEvidence(data, isCustom ? (cbg.attrKeys || []) : (bd.abilities || []));
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">📜 背景 <span class="cb2-sec-note">每项加值都保留来源与应用轨迹</span></h4>' +
    '<div class="cb2-hint">背景 <b style="color:var(--gold-l)">' + esc(displayName) + '</b>' + (isCustom ? ' · 自定义背景' : '') + '</div>';
  var skills = isCustom ? (cbg.skills || []) : (Array.isArray(bd.skills) ? bd.skills : []);
  var toolText = isCustom ? (cbg.tool || '—') : ((data.toolProfs && data.toolProfs.length) ? data.toolProfs.join('、') : (bd.tool || '—'));
  var equipText = '—';
  if (isCustom) {
    equipText = cbg.equip === 'B' ? '金币 ' + (cbg.gold || cbg.equipGold || 50) + ' GP' : ((cbg.items || []).filter(Boolean).join('、') || '未填写装备');
  } else if (data.bgEquip === 'B') equipText = '金币 ' + (data.bgGold || 50) + ' GP';
  else if (data.bgEquipData && data.bgEquipData.A) {
    var eq = data.bgEquipData.A;
    if (typeof eq === 'string') equipText = eq;
    else if (eq && Array.isArray(eq.items)) equipText = eq.items.map(function (it) { return it.name + ((Number(it.quantity) || 1) > 1 ? ' ×' + it.quantity : ''); }).join('、') + (eq.gold ? '、' + eq.gold + ' GP' : '');
  } else if (bd.equip) equipText = bd.equip;
  html += '<div class="cb2-bg-card-grid" style="margin-top:10px">' +
    '<div class="cb2-bg-cell full"><label>属性提升</label><div><b style="color:var(--gold-l)">' + esc(data.ruleVersion === '2014' ? '2014 规则不提供背景属性提升' : ev.summary) + '</b>' +
      (ev.trace ? '<div class="cb2-mini-label" style="margin-top:4px">应用记录：' + esc(ev.trace) + '</div>' : '') + '</div></div>' +
    '<div class="cb2-bg-cell"><label>起源专长</label><div>' + esc(isCustom ? (cbg.feat || '—') : (bd.feat || '—')) + '</div></div>' +
    '<div class="cb2-bg-cell"><label>技能熟练</label><div>' + esc(skills.join('、') || '—') + skillSrcLine(data, skills) + '</div></div>' +
    '<div class="cb2-bg-cell"><label>工具熟练</label><div>' + esc(toolText) + toolSrcLine(data, toolText) + '</div></div>' +
    '<div class="cb2-bg-cell full"><label>装备方案</label><div>' + esc(equipText) + '</div></div>' +
    '</div></div>';
  return html;
}

function renderSkillTab(data, derived, ctx) {
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">🎓 技能熟练 <span class="cb2-sec-note">悬浮查看规则定义 · 点击掷骰 · 来源自动标注</span></h4><div class="cb2-skill-groups cb2-skill-groups-detail">';
  ABILITIES.forEach(function (a) {
    var list = SKILLS.filter(function (skill) { return skill.ability === a.name; });
    var items = list.map(function (skill) {
      var sk = derived.skills[skill.name] || { ability: skill.ability, trained: '未熟练', bonus: 0, sources: [] };
      var cls = sk.trained === '专精' ? ' expert' : (sk.trained === '熟练' ? ' trained' : '');
      var sources = sk.sources && sk.sources.length ? sk.sources : ['未熟练'];
      var definition = SKILL_RULES[skill.name] || (skill.name + '技能检定。');
      var chip = window.TrpgTag && window.TrpgTag.chip
        ? window.TrpgTag.chip({ name: skill.name, type: 'skill', source: SKILL_RULE_SOURCE, system: ctx && ctx.system, hideSource: true, desc: definition, meta: { '关联属性': skill.ability, '熟练状态': sk.trained, '来源': sources.join('、') }, title: skill.name + '规则定义' })
        : '<span class="cb2-sk-name" title="' + esc(definition) + '">' + esc(skill.name) + '</span>';
      return '<div class="cb2-skill' + cls + '" data-act="roll-skill" data-skill="' + esc(skill.name) + '" title="点击掷' + esc(skill.name) + '检定">' +
        '<span class="cb2-sk-ab">' + esc(a.short) + '</span>' + chip + '<span class="cb2-sk-bonus">' + signed(sk.bonus) + '</span></div>';
    }).join('');
    if (items) html += '<div class="cb2-skill-grp"><div class="cb2-skill-grp-t">' + esc(a.name) + ' <span class="cnt">' + esc(a.short) + '</span></div><div class="cb2-skills">' + items + '</div></div>';
  });
  var system = ctx && ctx.system ? String(ctx.system) : '';
  var sourceHref = '/view.html?system=' + encodeURIComponent(system) + '&file=' + encodeURIComponent(SKILL_RULE_SOURCE);
  html += '</div><div class="cb2-mini-label" style="margin-top:8px">技能定义来自 <a href="' + esc(sourceHref) + '" target="_blank" rel="noopener" style="color:var(--gold-l)">玩家手册原文</a>；悬浮任一技能可查看定义与熟练来源。</div></div>';
  return html;
}

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
function fmtGPInline(gp) {
  gp = Number(gp) || 0;
  if (gp >= 1) return (gp % 1 === 0 ? gp : gp.toFixed(2)) + ' GP';
  var sp = gp * 10;
  if (sp >= 1) return (sp % 1 === 0 ? sp : sp.toFixed(2)) + ' SP';
  return Math.round(gp * 100) + ' CP';
}

function renderInventoryTab(data, derived) {
  var items = normalizeItems(data);
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
  var loadBar = '<div class="cb2-gold-ledger" style="margin-bottom:10px">' +
    '<span class="cb2-gl-cell">负重 <b>' + (data.currentLoad || 0) + ' / ' + derived.carryCapacity + ' 磅</b></span>' +
    '<span class="cb2-gl-cell">状态 <b style="color:' + (derived.carrySpeedPenalty > 0 ? 'var(--red-l)' : 'var(--green-l)') + '">' + esc(derived.carryStatus) + '</b></span>' +
    (derived.carrySpeedPenalty > 0 ? '<span class="cb2-gl-cell">速度惩罚 <b style="color:var(--red-l)">-' + derived.carrySpeedPenalty + ' 尺</b></span>' : '') + '</div>';
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">背包与装备 <span class="cb2-sec-note">' + items.length + ' 件物品 · 负重与装备状态统一管理</span></h4>' + loadBar + goldBar +
    '<div class="cb2-itemrows">';
  if (!items.length) html += '<div class="cb2-empty">背包空空如也 — 点击「＋ 添加物品」录入你的装备</div>';
  items.forEach(function (it, i) {
    var cat = it.category || '杂物';
    var isWeapon = !!it.damageFormula || String(cat).indexOf('武器') >= 0;
    var isArmor = it.baseAC != null || /护甲|轻甲|中甲|重甲/.test(String(cat));
    var equipKind = itemEquipKind(it);
    var isEquipped = !!equipKind && it.equipped === true;
    var type = isWeapon ? 'weapon' : (isArmor ? 'armor' : (cat === '奇物' || cat === '冒险套组' ? 'wondrous' : (cat === '盾' ? 'shield' : (cat === '卷轴' ? 'spell' : 'item'))));
    var descParts = [];
    if (it.damageFormula) descParts.push('伤害 ' + it.damageFormula + (it.magicBonus ? '+' + it.magicBonus : '') + ' ' + (it.damageType || '') + (it.attackAbility ? '（' + it.attackAbility + '）' : ''));
    if (it.baseAC) descParts.push('AC ' + it.baseAC + (it.maxDex != null && it.maxDex < 99 ? '（敏捷上限+' + it.maxDex + '）' : '') + (it.strReq ? ' 需力量' + it.strReq : ''));
    if (it.effect) descParts.push('效果：' + it.effect);
    if (it.desc) descParts.push(it.desc);
    var tagOpts = {
      name: it.name,
      type: type,
      source: isEquipped ? '已装备' : (equipKind ? '可装备' : '背包物品'),
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
      title: it.name + (isEquipped ? '（已装备）' : '') + '（点击编辑，✕删除）',
      rmAct: 'item-del',
      dataI: i,
      removable: true
    };
    var chipHtml = (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip(tagOpts) : '<span class="cb2-it-tag ' + type + '">' + esc(it.name) + '</span>';
    html += '<div class="cb2-itemrow' + (isEquipped ? ' equipped' : '') + '" data-act="item-edit" data-i="' + i + '" title="点击编辑物品">' +
      chipHtml +
      '<span class="cb2-itemrow-acts">' +
      (equipKind ? '<button type="button" class="cb2-micon eq' + (isEquipped ? ' eq' : '') + '" data-act="item-equip" data-i="' + i + '" title="' + (isEquipped ? '卸下' : '装备') + '">' + (isEquipped ? '✓' : '装') + '</button>' : '<span class="cb2-item-static" title="该物品不可装备">—</span>') +
      '</span></div>';
  });
  html += '</div>' +
    '<div class="cb2-row" style="margin-top:10px"><button type="button" class="cb2-btn gold sm" data-act="item-add">＋ 添加物品</button></div></div>';
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
  var plainName = name.replace(/^职业成长·\d+级·专长：/, '');
  // 选择槽前缀剥离（选择槽效果完整显示标准）："战斗风格：X" 等格式剥离前缀后按名称查效果
  var slotMatch = plainName.match(/^(战斗风格|圣职|原初职能|超魔法|魔能祈唤)：(.+)$/);
  if (slotMatch && slotMatch[2]) {
    var slotName = slotMatch[2];
    var slotFull = (typeof window !== 'undefined' && window.__cbFeatsFull) ? window.__cbFeatsFull[slotName] : null;
    if (slotFull && slotFull.desc) return stripHtmlTags(slotFull.desc);
    if (ORIGIN_FEATS[slotName]) return stripHtmlTags(ORIGIN_FEATS[slotName]);
    if (clsName && CLASS_FEATURE_DESC[clsName + '·' + slotName]) return stripHtmlTags(CLASS_FEATURE_DESC[clsName + '·' + slotName]);
    if (CLASS_FEATURE_DESC[slotName]) return stripHtmlTags(CLASS_FEATURE_DESC[slotName]);
  }
  var fullFeat = (typeof window !== 'undefined' && window.__cbFeatsFull) ? window.__cbFeatsFull[plainName] : null;
  var growthFeat = name.match(/^职业成长·(\d+)级·专长：(.+)$/);
  if (growthFeat) {
    var featName = growthFeat[2];
    // 专长效果优先：featsFull 完整描述 → ORIGIN_FEATS → CLASS_FEATURE_DESC
    var fullDesc = (typeof window !== 'undefined' && window.__cbFeatsFull) ? window.__cbFeatsFull[featName] : null;
    if (fullDesc && fullDesc.desc) return stripHtmlTags(fullDesc.desc);
    if (ORIGIN_FEATS[featName]) return stripHtmlTags(ORIGIN_FEATS[featName]);
    if (CLASS_FEATURE_DESC[featName]) return stripHtmlTags(CLASS_FEATURE_DESC[featName]);
    return featName;
  }
  var growthAbility = name.match(/^职业成长·(\d+)级·属性提升：(.+)$/);
  if (growthAbility) return growthAbility[1] + '级职业成长选择属性提升：' + growthAbility[2];
  if (clsName && CLASS_FEATURE_DESC[clsName + '·' + name]) return stripHtmlTags(CLASS_FEATURE_DESC[clsName + '·' + name]);
  if (CLASS_FEATURE_DESC[name]) return stripHtmlTags(CLASS_FEATURE_DESC[name]);
  if (fullFeat && fullFeat.desc) return stripHtmlTags(fullFeat.desc);
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
function featDetailSrc(f, data) {
  var name = String(f || '');
  if (data && data.classFeatureDetails && data.classFeatureDetails[name]) return { tag: name.indexOf('职业成长·') === 0 ? '职业成长' : ('职业·' + (data.class || '')), auto: true };
  if (name.indexOf('职业成长·') === 0) return { tag: '职业成长', auto: true };
  if (name.indexOf('副职选择·') === 0) return { tag: '副职·' + ((data && data.subclass) || '选择'), auto: true };
  if (data && data.subclass && name.indexOf(data.subclass + '·') === 0) return { tag: '副职·' + data.subclass, auto: true };
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
  if (data && data.class && (CLASS_FEATURE_DESC[data.class + '·' + name] || CLASS_FEATURE_DESC[name])) return { tag: '职业·' + data.class, auto: true };
  if (typeof window !== 'undefined' && window.__cbFeatsFull && window.__cbFeatsFull[name]) return { tag: window.__cbFeatsFull[name].source || '专长', auto: true };
  return { tag: '自定义', auto: false };
}
function renderFeaturesTab(data, token, ctx) {
  var html = '';
  var feats = Array.isArray(data.features) ? data.features : [];
  html += '<div class="cb2-sec"><h4 class="cb2-sec-h">已获能力 <span class="cb2-sec-note">' + feats.length + ' 项 · 标签化，悬停查看效果</span></h4>';
  if (!feats.length) html += '<div class="cb2-empty">暂无记录 — 升级时在「升级弹窗」中手动记录职业能力</div>';
  html += '<div class="cb2-feat-chiprow">';
  // 详情页兜底：若角色数据缺少子职业特性详情（老存档），异步从规则书压缩数据补齐完整效果
  if (!data.subclassFeatureDetails && data.subclass && ctx && typeof ctx.fetch === 'function') {
    try {
      var _sys = ctx.system || '';
      ctx.fetch('/Ruler/' + encodeURIComponent(_sys) + '/compressed/rule_subclasses.json').then(function (r) { return r.json().catch(function () { return null; }); }).then(function (sj) {
        if (!sj || !sj.classes) return;
        var clsRec = sj.classes[data.class] || {};
        var subRec = clsRec[data.subclass] || {};
        var details = {};
        (subRec.features || []).forEach(function (ft) {
          var nm = (data.subclass || '') + '·' + (ft.name || '');
          details[nm] = { level: Number(ft.level) || 0, desc: ft.desc || ft.text || ft.name || nm, source: subRec.source || '' };
        });
        if (Object.keys(details).length) {
          data.subclassFeatureDetails = details;
          renderFeaturesTab(data, token, ctx);
        }
      }).catch(function () { /* 静默 */ });
    } catch (e) { /* 静默 */ }
  }
  feats.forEach(function (f, i) {
    var dsc = lookupFeatDesc(f, data.class);
    var src = featDetailSrc(f, data);
    var type = src.auto ? (src.tag.indexOf('种族') === 0 ? 'race' : (src.tag.indexOf('副职') === 0 ? 'subclass' : (src.tag.indexOf('背景') === 0 ? 'bg' : 'cls'))) : 'custom';
    var showName = String(f).replace(/^职业成长·\d+级·专长：/, '');
    if (window.TrpgTag && window.TrpgTag.chip) {
      var detailed = (data.subclassFeatureDetails && data.subclassFeatureDetails[f]) || (data.classFeatureDetails && data.classFeatureDetails[f]) || (data.classChoiceDetails && data.classChoiceDetails[f]) || (data.subclassChoiceDetails && data.subclassChoiceDetails[f]);
      var featureSource = detailed && detailed.source ? detailed.source : '';
      if (!featureSource && src.tag.indexOf('种族') === 0) featureSource = data.ruleVersion === '2014' ? '玩家手册/种族/' + (data.race || '') + '.html' : '玩家手册2024/角色起源/种族/' + (data.race || '') + '.htm';
      if (!featureSource && src.tag.indexOf('背景') === 0) featureSource = data.ruleVersion === '2014' ? '玩家手册/个性与背景/' + (data.background || '') + '.html' : '玩家手册2024/角色起源/背景/' + (data.background || '') + '.htm';
      if (!featureSource && src.tag.indexOf('职业') === 0) featureSource = data.ruleVersion === '2014' ? '玩家手册/职业/' + (data.class || '') + '.html' : '玩家手册2024/角色职业/' + (data.class || '') + '/' + (data.class || '') + '.htm';
      html += window.TrpgTag.chip({
        name: showName, type: type, source: featureSource || src.tag, system: featureSource ? (ctx && ctx.system) : '', hideSource: !!featureSource,
        desc: (detailed && detailed.desc) || dsc || f,
        title: showName,
        dataAct: 'feat-del', dataI: i, removable: true
      });
    } else {
      html += '<span class="cb2-feat-chip" data-feat-name="' + esc(f) + '" data-feat-desc="' + encodeURIComponent(dsc || f) + '" title="' + esc(showName) + '">' + esc(showName) +
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
  var world = data.world;
  if (world) {
    html += '<div class="cb2-sec"><h4 class="cb2-sec-h">世界状态</h4>' +
      '<div class="cb2-hint">' + esc(world.time || '') + (world.place ? ' · ' + esc(world.place) : '') + (world.chapter ? ' · ' + esc(world.chapter) : '') + '</div></div>';
  }
  return html;
}

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
        (s.desc ? '<div class="cb2-it-desc" style="margin-top:4px;white-space:pre-wrap">' + esc(String(s.desc).trim()) + '</div>' : '') +
        '<div class="cb2-sp-toggle">' + (s.prepared ? '已准备' : '未准备') + '</div>' +
        '</div>';
    });
  });
  spellHtml += '</div><div class="cb2-row" style="margin-top:10px"><button type="button" class="cb2-btn gold sm" data-act="spell-add">＋ 手动添加法术</button></div></div>';
  return slotHtml + spellHtml;
}

function renderNotesTab(data) {
  var notes = data.notes || {};
  var content = notes.content || '';
  var html = '<div class="cb2-sec"><h4 class="cb2-sec-h">冒险笔记</h4>' +
    '<div class="cb2-hint" style="white-space:pre-wrap;line-height:1.7">' + esc(content || '（暂无笔记 — 战斗中记录的关键情报会显示在这里）') + '</div></div>';
  return html;
}
function skillSrcLine(data, skillNames) {
  var map = (data && data.skillSources) || {};
  var parts = (skillNames || []).filter(Boolean).map(function (n) {
    var srcs = map[n] || [];
    return srcs.length ? n + '←' + srcs.join('+') : null;
  }).filter(Boolean);
  return parts.length ? '<div class="cb2-bg-src">' + esc(parts.join('；')) + '</div>' : '';
}
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
  // bio 为字符串（AI/外部写入的自由设定文本）时：概览直接展示全文，保留原段落
  var bioIsString = typeof data.bio === 'string';
  var bioText = bioIsString ? String(data.bio) : '';
  var b = (data.bio && typeof data.bio === 'object') ? data.bio : {};
  var rows = bioIsString ? [] : [
    ['阵营', data.alignment], ['外貌', b.appearance], ['性格', b.personality],
    ['理想', b.ideals], ['牵绊', b.bonds], ['缺陷', b.flaws]
  ];
  var bg = data.background;
  var bgInfo = (data.bgData && data.bgData.abilities) ? data.bgData : (BACKGROUNDS[bg] || null);
  var bgHtml = '';
  if (bgInfo) {
    var toolShow = (data.toolProfs && data.toolProfs.length) ? data.toolProfs.join('、') : bgInfo.tool;
    var attrShow = bgInfo.abilities.join('、');
    if (data.bgApplied) {
      attrShow += '（' + (data.bgApplied.mode === '21'
        ? bgInfo.abilities[0] + ' +2、' + bgInfo.abilities[1] + ' +1'
        : bgInfo.abilities.join('、') + ' 各 +1') + '）';
    }
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
        var rec = raceTraitRecord(t, raceInfo.details);
        var dyn = '';
        if (data.race === '龙裔' && rec.name === '伤害抗性' && (data.raceChoices || {}).dragon) {
          var dOpt = null;
          (raceInfo.choices || []).forEach(function (ch) {
            if (ch.key === 'dragon') (ch.options || []).forEach(function (o) { if (o.v === data.raceChoices.dragon) dOpt = o.d; });
          });
          var dm = String(dOpt || '').match(/获得(.+?)抗性/);
          dyn = '<b style="color:var(--green-l)"> → 已选' + esc(data.raceChoices.dragon) + (dm ? '：获得' + esc(dm[1]) + '抗性' : '') + '</b>';
        }
        return '<div class="cb2-race-trait"><b>' + esc(rec.name) + '。</b>' + esc(rec.desc) + dyn + '</div>';
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
  var html = raceHtml + '<div class="cb2-sec"><h4 class="cb2-sec-h">角色档案</h4><div class="cb2-edit-grid">' +
    (bioIsString
      ? '<div class="cb2-field full"><label>角色设定</label><div class="cb2-hint" style="color:var(--text);font-size:12px;white-space:pre-wrap;line-height:1.8;height:220px;overflow-y:auto;margin:0;border:1px solid rgba(85,215,210,.25);background:rgba(85,215,210,.06);border-radius:8px;padding:8px 10px">' + (bioText.trim() ? esc(bioText) : '—') + '</div></div>'
      : rows.map(function (r) {
          var isLong = r[0] === '外貌' || r[0] === '性格' || r[0] === '理想' || r[0] === '牵绊' || r[0] === '缺陷';
          var style = isLong ? 'color:var(--text);font-size:12px;white-space:pre-wrap;line-height:1.7;height:96px;overflow-y:auto;margin:0;border:1px solid rgba(85,215,210,.25);background:rgba(85,215,210,.06);border-radius:8px;padding:8px 10px' : 'color:var(--text);font-size:12px';
          return '<div class="cb2-field"><label>' + esc(r[0]) + '</label><div class="cb2-hint" style="' + style + '">' + esc(r[1] || '—') + '</div></div>';
        }).join('') +
        (b.backstory ? '<div class="cb2-field full"><label>📖 背景故事</label><div class="cb2-hint" style="color:var(--text);font-size:12px;white-space:pre-wrap;line-height:1.8;height:220px;overflow-y:auto;margin:0;border:1px solid rgba(85,215,210,.25);background:rgba(85,215,210,.06);border-radius:8px;padding:8px 10px">' + esc(b.backstory) + '</div></div>' : '')) +
    '</div></div>';
  return html;
}

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
  mountCardModal(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || (e.target.closest && e.target.closest('[data-cancel]'))) closeCardModal(mask);
    if ((e.target.closest && e.target.closest('[data-ok]'))) {
      var dmg = Math.abs(Number(mask.querySelector('#cb2-hp-dmg').value) || 0);
      var heal = Math.abs(Number(mask.querySelector('#cb2-hp-heal').value) || 0);
      var temp = Math.abs(Number(mask.querySelector('#cb2-hp-temp').value) || 0);
      var nd = Object.assign({}, data);
      var nhp = Object.assign({}, hp);
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
      closeCardModal(mask);
      refreshDetail(tokenId);
    }
  });
}

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
  mountCardModal(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || (e.target.closest && e.target.closest('[data-cancel]'))) closeCardModal(mask);
    if ((e.target.closest && e.target.closest('[data-ok]'))) {
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
      closeCardModal(mask);
      refreshDetail(tokenId);
    }
  });
}

function doLongRest(tokenId, data) {
  var level = Number(data.level) || 1;
  var nd = Object.assign({}, data);
  var hp = Object.assign({}, nd.HP || { current: 0, max: 0 });
  var maxHp = computeDerived(nd).maxHp != null ? computeDerived(nd).maxHp : (hp.max || 0);
  hp.current = maxHp;
  hp.temp = 0;
  nd.HP = hp;
  if (nd.spellSlots && typeof nd.spellSlots === 'object') {
    var used = {};
    Object.keys(nd.spellSlots).forEach(function (r) { used[r] = 0; });
    nd.spellSlotsUsed = used;
  }
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

function openLevelUpModal(tokenId, data, derived) {
  var cur = Number(data.level) || 1;
  if (cur >= 20) { showToast('已达 20 级（最高等级）', 'error'); return; }
  var next = cur + 1;
  var cls = data.class || '';
  var die = String(data.hitDice || 'd8').replace('d', '');
  var conMod = derived.abilityMods.con || 0;
  var feats = levelUpFeatures(cur, next, cls, data.subclass || '');
  var oldProf = proficiencyBonus(cur), newProf = proficiencyBonus(next);
  var profTxt = oldProf !== newProf ? oldProf + ' → <b style="color:var(--gold-l)">' + newProf + '</b>（+1）' : oldProf + ' → ' + newProf + '（不变）';
  var oldSlots = spellSlotsFor(cls, cur, data.subclass || ''), newSlots = spellSlotsFor(cls, next, data.subclass || '');
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
  mountCardModal(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || (e.target.closest && e.target.closest('[data-cancel]'))) closeCardModal(mask);
    if ((e.target.closest && e.target.closest('[data-ok]'))) {
      var oldMax = derived.maxHp != null ? derived.maxHp : (Number((data.HP || {}).max) || 0);
      var nd = applyLevelUp(data, 0, mask.querySelector('#cb2-lv-note').value);
      if (!nd) { showToast('已达 20 级', 'error'); return; }
      // 升级到 ASI 等级：自动建立该级「属性提升」选择（编辑角色卡属性页统一面板可分配）
      if (ASI_LEVELS[next]) {
        nd.classGrowthChoices = Object.assign({}, data.classGrowthChoices || {});
        if (!nd.classGrowthChoices[String(next)]) {
          nd.classGrowthChoices[String(next)] = { type: 'ability', mode: '21', attrs: [], allocation: {}, feat: '' };
        }
      }
      var newMax = computeDerived(nd).maxHp != null ? computeDerived(nd).maxHp : oldMax;
      var gain = Math.max(0, newMax - oldMax);
      saveCharacterData(tokenId, nd, { toast: '升级成功：Lv' + next + '，最大生命 ' + oldMax + ' → ' + newMax + (gain > 0 ? '（+' + gain + '）' : '') });
      closeCardModal(mask);
      refreshDetail(tokenId);
    }
  });
}

function openItemModal(tokenId, data, editIndex) {
  var items = normalizeItems(data);
  var it = editIndex != null ? items[editIndex] : { name: '', category: '武器', quantity: 1, price: '', equipped: false, effect: '', desc: '', damageFormula: '', damageType: '挥砍', attackAbility: '力量', magicBonus: 0, baseAC: 10, maxDex: 99, strReq: 0 };
  var cats = ['武器', '护甲', '盾', '饰品', '奇物', '杂物', '药水', '卷轴', '工具', '货币', '冒险套组'];
  var catOpts = cats.map(function (c) { return '<option value="' + c + '"' + (it.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');
  var mask = document.createElement('div');
  mask.className = 'cb2-modal-mask';
  mask.innerHTML = '<div class="cb2-modal"><h3>' + (editIndex != null ? '编辑物品' : '＋ 添加物品') + '</h3>' +
    '<div class="cb2-edit-grid">' +
    '<div class="cb2-field full"><label>名称</label><input type="text" class="cb2-in" id="cb2-it-name" value="' + esc(it.name) + '" placeholder="如：+1 长剑"></div>' +
    '<div class="cb2-field"><label>类别</label><select class="cb2-in" id="cb2-it-cat">' + catOpts + '</select></div>' +
    '<div class="cb2-field"><label>数量</label><input type="number" class="cb2-in" id="cb2-it-qty" min="1" value="' + (it.quantity || 1) + '"></div>' +
    '<div class="cb2-field"><label>装备槽</label><select class="cb2-in" id="cb2-it-slot">' +
    '<option value="">不可装备</option><option value="weapon">武器</option><option value="armor">护甲</option><option value="shield">盾</option><option value="gear">饰品/其他装备</option></select></div>' +
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
  mountCardModal(mask);
  var catSel = mask.querySelector('#cb2-it-cat');
  catSel.addEventListener('change', function () {
    mask.querySelector('#cb2-weapon-row').style.display = catSel.value === '武器' ? 'grid' : 'none';
  });
  var slotSel = mask.querySelector('#cb2-it-slot');
  var inferredSlot = itemEquipKind(it);
  if (slotSel) slotSel.value = it.equipSlot || inferredSlot || '';
  var attrSel = mask.querySelector('#cb2-it-attr');
  if (it.attackAbility) {
    Array.prototype.forEach.call(attrSel.options, function (o) { if (o.value === it.attackAbility) o.selected = true; });
  }
  mask.addEventListener('click', function (e) {
    if (e.target === mask || (e.target.closest && e.target.closest('[data-cancel]'))) closeCardModal(mask);
    if ((e.target.closest && e.target.closest('[data-ok]'))) {
      var items2 = normalizeItems(data).slice();
      var ni = {
        name: mask.querySelector('#cb2-it-name').value.trim(),
        category: catSel.value,
        quantity: Math.max(1, Number(mask.querySelector('#cb2-it-qty').value) || 1),
        price: mask.querySelector('#cb2-it-price').value.trim(),
        equipSlot: slotSel ? slotSel.value : '',
        canEquip: !!(slotSel && slotSel.value),
        equipped: !!(slotSel && slotSel.value) && !!it.equipped,
        effect: mask.querySelector('#cb2-it-eff').value.trim(),
        desc: mask.querySelector('#cb2-it-desc').value.trim(),
        magicBonus: Number(mask.querySelector('#cb2-it-magic').value) || 0
      };
      if (catSel.value === '武器') {
        ni.damageFormula = mask.querySelector('#cb2-it-dmg').value.trim() || '1d6';
        ni.damageType = mask.querySelector('#cb2-it-dtype').value.trim() || '挥砍';
        ni.attackAbility = attrSel.value;
      }
      if (!ni.equipSlot) ni.equipped = false;
      if (catSel.value === '护甲') {
        ni.baseAC = it.baseAC || 10;
        ni.maxDex = it.maxDex != null ? it.maxDex : 99;
        ni.strReq = it.strReq || 0;
      }
      if (!ni.name) { showToast('物品名称不能为空', 'error'); return; }
      if (editIndex != null) items2[editIndex] = ni; else items2.push(ni);
      var niKind = itemEquipKind(ni);
      if (ni.equipped && (niKind === 'armor' || niKind === 'shield')) {
        items2.forEach(function (x, xi) { if (xi !== (editIndex != null ? editIndex : items2.length - 1) && itemEquipKind(x) === niKind) x.equipped = false; });
      }
      var nd = Object.assign({}, data, { items: items2 });
      if (niKind === 'armor') nd.armor = ni.equipped ? ni.name : (items2.filter(function (x) { return x.equipped && itemEquipKind(x) === 'armor'; }).slice(-1)[0] || {}).name || '无甲';
      if (niKind === 'shield') nd.shield = items2.some(function (x) { return x.equipped && itemEquipKind(x) === 'shield'; });
      saveCharacterData(tokenId, nd, { toast: editIndex != null ? '物品已更新' : '已添加：' + ni.name });
      closeCardModal(mask);
      refreshDetail(tokenId);
    }
  });
}

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
  mountCardModal(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || (e.target.closest && e.target.closest('[data-cancel]'))) closeCardModal(mask);
    if ((e.target.closest && e.target.closest('[data-ok]'))) {
      var name = mask.querySelector('#cb2-fx-name').value.trim();
      var target = mask.querySelector('#cb2-fx-target').value;
      var value = mask.querySelector('#cb2-fx-value').value.trim();
      if (!name) { showToast('效果名称不能为空', 'error'); return; }
      var effects = Array.isArray(data.effects) ? data.effects.slice() : [];
      effects.push({ name: name, target: target, mode: 'add', value: value, enabled: true });
      saveCharacterData(tokenId, { effects: effects }, { toast: '已添加效果：' + name });
      closeCardModal(mask);
      refreshDetail(tokenId);
    }
  });
}

function addFxPreset(tokenId, data, key) {
  var p = EFFECT_TAG_PRESETS[key];
  if (!p) return;
  var tags = Array.isArray(data.effectTags) ? data.effectTags.slice() : [];
  if (tags.indexOf(key) >= 0) { showToast('该效果已存在', 'error'); return; }
  tags.push(key);
  saveCharacterData(tokenId, { effectTags: tags }, { toast: '已启用：' + p.label });
  refreshDetail(tokenId);
}

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
  mountCardModal(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || (e.target.closest && e.target.closest('[data-cancel]'))) closeCardModal(mask);
    if ((e.target.closest && e.target.closest('[data-ok]'))) {
      var statuses = normalizeStatuses(data).slice();
      statuses.push({
        name: mask.querySelector('#cb2-st-name').value,
        remaining: mask.querySelector('#cb2-st-rem').value.trim(),
        source: mask.querySelector('#cb2-st-src').value.trim(),
        desc: ''
      });
      saveCharacterData(tokenId, { statuses: statuses }, { toast: '已添加状态' });
      closeCardModal(mask);
      refreshDetail(tokenId);
    }
  });
}

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
  mountCardModal(mask);
  mask.addEventListener('click', function (e) {
    if (e.target === mask || (e.target.closest && e.target.closest('[data-cancel]'))) closeCardModal(mask);
    if ((e.target.closest && e.target.closest('[data-ok]'))) {
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
      closeCardModal(mask);
      refreshDetail(tokenId);
    }
  });
}

function refreshDetail(tokenId) {
  try {
    if (window.UIManager && typeof window.UIManager.showCharacterDetail === 'function') {
      window.UIManager.showCharacterDetail(tokenId);
    }
  } catch (e) {}
}

function renderDetail(container, token, ctx) {
  injectStyle();
  var d = (token && token.data) || {};
  var derived = computeDerived(d);
  var tokenId = token.id;
  var tab = (ctx && ctx._cbTab) || 'bio';
  if (tab === 'race' || tab === 'attr') tab = 'bio';

  var head = '<div class="cb2-head">' +
    avatarHtml(token, 'cb2-avatar', d.name || token.name) +
    '<div class="cb2-title">' +
    '<div class="cb2-name">' + esc(d.name || token.name || '未命名角色') + '</div>' +
    '<div class="cb2-sub">' + [d.race, d.subclass ? d.subclass + '（' + d.class + '）' : d.class, characterBackgroundName(d), d.level ? 'Lv' + d.level : ''].filter(Boolean).join(' · ') + '</div>' +
    '</div>' +
    '<div class="cb2-actions">' +
    '<button type="button" class="cb2-btn green" data-act="short-rest" title="消耗生命骰与短休资源">⏳ 短休</button>' +
    '<button type="button" class="cb2-btn blue" data-act="long-rest" title="恢复生命、法术位与长休资源">🌙 长休</button>' +
    '<button type="button" class="cb2-btn gold" data-act="levelup" title="升级到下一级">⬆ 升级</button>' +
    '<button type="button" class="cb2-btn blue" data-act="ai-summary" title="复制AI状态摘要">🤖 AI摘要</button>' +
    ((window.UIManager && window.UIManager.canEditCharacter ? window.UIManager.canEditCharacter(tokenId) : true) && window.UIManager && window.UIManager.openCharacterModalForEdit ? '<button type="button" class="cb2-btn green" data-act="edit-sheet">✏️ 编辑</button>' : '') +
    '</div></div>';

  var tabs = [
    ['bio', '👤', '概览'], ['cls', '⚔️', '职业'], ['bg', '📜', '背景'],
    ['skill', '🎓', '技能'], ['spell', '🔮', '法术'], ['inv', '🎒', '背包'],
    ['feat', '⭐', '特性'], ['status', '🩹', '状态'], ['note', '📝', '笔记']
  ];
  var tabHtml = '<div class="cb2-tabs">' + tabs.map(function (t) {
    return '<button type="button" class="cb2-tab' + (tab === t[0] ? ' active' : '') + '" data-act="tab" data-tab="' + t[0] + '">' +
      '<span class="cb2-ic">' + t[1] + '</span>' + t[2] + '</button>';
  }).join('') + '</div>';


    var tabContent = {
      cls: renderClassTab(d, derived, ctx),
      bg: renderBackgroundTab(d, derived),
      skill: renderSkillTab(d, derived, ctx),
      status: renderStatusTab(d, derived, token),
      inv: renderInventoryTab(d, derived),
      feat: renderFeaturesTab(d, token, ctx),
      spell: renderSpellsTab(d, derived),
      note: renderNotesTab(d),
      bio: renderBioTab(d)
    }[tab] || renderAttributesTab(d, derived, token);

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

  container.innerHTML = '<div class="cb2" data-token="' + esc(tokenId) + '">' +
    head + renderOverview(d, derived) + renderPrimaryStats(d, derived) + tabHtml +
    '<div class="cb2-grid">' + tabContent + '</div>' +
    '</div>';
  if (window.TrpgTag && window.TrpgTag.bindTips) window.TrpgTag.bindTips(container);

  container.addEventListener('mouseover', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    var el = t && t.getAttribute ? t : null;
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
  container.addEventListener('pointerdown', hideSpellTip, true);
  container.addEventListener('scroll', hideSpellTip, true);

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

  container.addEventListener('dragstart', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-token"]') : null;
    if (!el || el.classList.contains('used')) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ level: el.getAttribute('data-level'), slot: el.getAttribute('data-slot') }));
  });
  container.addEventListener('dragover', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-target"]') : null;
    if (!el) return;
    e.preventDefault();
    el.classList.add('dragover');
  });
  container.addEventListener('dragleave', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-target"]') : null;
    if (el) el.classList.remove('dragover');
  });
  container.addEventListener('drop', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-target"]') : null;
    if (!el) return;
    e.preventDefault();
    el.classList.remove('dragover');
    var payload = {};
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (err) { payload = {}; }
    setClassGrowthAttr(Number(payload.level || el.getAttribute('data-level')) || st.classLevelTab, Number(payload.slot) || 0, el.getAttribute('data-ability'));
  });

  // ===== 3.1 查看层事件：VIEW_ACT_TABLE 白名单路由（与编辑层 ACT_TABLE 同一模式）=====
  var VIEW_ACT_TABLE = {
    'tab': function (actEl) { ctx._cbTab = actEl.getAttribute('data-tab'); refreshDetail(tokenId); },
    'switch-add': function () { if (window.UIManager && window.UIManager.openCharacterModal) window.UIManager.openCharacterModal(); },
    'switch-del': function () { if (window.UIManager && window.UIManager.deleteCharacter) window.UIManager.deleteCharacter(tokenId); },
    'roll-init': function (a, d2) { playerRoll('先攻检定', d2.initiative, null); },
    'roll-atk': function (a, d2) { playerRoll('攻击检定', d2.attackBonus, null); },
    'roll-dc': function (a, d2) { playerRoll('法术攻击', d2.spellAttack != null ? d2.spellAttack : 0, null); },
    'roll-ab': function (actEl, d2) {
      var ab = actEl.getAttribute('data-ab');
      var mod = d2.abilityMods[ab] || 0;
      playerRoll(ABILITIES.filter(function (x) { return x.key === ab; })[0].name + '检定', mod, null);
    },
    'roll-save': function (actEl, d2) {
      var ab2 = actEl.getAttribute('data-ab');
      var sv = d2.saves[ab2] || { bonus: 0 };
      playerRoll(ABILITIES.filter(function (x) { return x.key === ab2; })[0].name + '豁免', sv.bonus, null);
    },
    'roll-skill': function (actEl, d2) {
      var sk = actEl.getAttribute('data-skill');
      var sb = d2.skills[sk] || { bonus: 0 };
      playerRoll(sk + '检定', sb.bonus, null);
    },
    'spell-roll': function (actEl, d2, data2) {
      var si = Number(actEl.getAttribute('data-i'));
      var sp = normalizeSpells(data2)[si];
      if (sp) playerRoll('施放 ' + sp.name, d2.spellAttack != null ? d2.spellAttack : 0, d2.spellDC, function (r) {
        addRollLog({ title: '法术命中判定', detail: sp.name + ' 攻击 vs DC' + d2.spellDC, result: r.verdict || String(r.total), raw: r.raw });
      });
    },
    'hp-edit': function (a, d2, data2) { openHpModal(tokenId, data2, d2); },
    'short-rest': function (a, d2, data2) { openShortRestModal(tokenId, data2); },
    'long-rest': function (a, d2, data2) {
      if (window.confirm('进行长休？将恢复全部 HP、法术位、资源，并恢复一半生命骰。')) doLongRest(tokenId, data2);
    },
    'levelup': function (a, d2, data2) { openLevelUpModal(tokenId, data2, d2); },
    'death-save': function (actEl, d2, data2) {
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
    },
    'inspiration': function (a, d2, data2) {
      saveCharacterData(tokenId, { inspiration: !data2.inspiration }, { toast: data2.inspiration ? '灵感已消耗' : '灵感已获得！', type: 'gold' });
      refreshDetail(tokenId);
    },
    'hd-edit': function (a, d2, data2) {
      var nv = window.prompt('剩余生命骰数量（0-' + (data2.level || 1) + '）：', data2.hitDiceRemaining != null ? data2.hitDiceRemaining : data2.level || 1);
      if (nv != null && nv !== '') {
        var nn = Math.max(0, Math.min(data2.level || 1, Number(nv) || 0));
        saveCharacterData(tokenId, { hitDiceRemaining: nn }, { toast: '生命骰剩余 ' + nn });
        refreshDetail(tokenId);
      }
    },
    'item-add': function (a, d2, data2) { openItemModal(tokenId, data2, null); },
    'item-edit': function (actEl, d2, data2) { openItemModal(tokenId, data2, Number(actEl.getAttribute('data-i'))); },
    'wpn-roll': function (actEl, d2, data2) {
      var wii = Number(actEl.getAttribute('data-i'));
      var wpns = normalizeItems(data2).filter(function (x) { return x.category === '武器' || x.damageFormula; });
      var wd = wpns[wii];
      if (!wd) return;
      var m2 = d2.abilityMods || {};
      var attrK2 = wd.attackAbility === '敏捷' ? 'dex' : (wd.attackAbility === '智力' ? 'int' : (wd.attackAbility === '感知' ? 'wis' : (wd.attackAbility === '魅力' ? 'cha' : 'str')));
      var atk2 = (Number(m2[attrK2]) || 0) + Number(d2.proficiency) + (Number(wd.magicBonus) || 0) + effectSum(data2, m2, ['weapon.attack', 'attack.all']);
      var rollRes = playerRoll(wd.name + ' 攻击', atk2, null);
      if (rollRes.verdict && rollRes.verdict.indexOf('大成功') >= 0) {
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
    },
    'item-equip': function (actEl, d2, data2) {
      var ii = Number(actEl.getAttribute('data-i'));
      var items3 = normalizeItems(data2).slice();
      if (!items3[ii]) return;
      var kind3 = itemEquipKind(items3[ii]);
      if (!kind3) { showToast('「' + items3[ii].name + '」不是可装备物品', 'error'); return; }
      var nextEq = !items3[ii].equipped;
      if ((kind3 === 'armor' || kind3 === 'shield') && nextEq) {
        items3.forEach(function (x, xi) { if (xi !== ii && itemEquipKind(x) === kind3) x.equipped = false; });
      }
      items3[ii].equipped = nextEq;
      var equippedArmor = items3.filter(function (x) { return x.equipped && itemEquipKind(x) === 'armor'; });
      var equippedShield = items3.some(function (x) { return x.equipped && itemEquipKind(x) === 'shield'; });
      var nd2 = Object.assign({}, data2, { items: items3 });
      if (kind3 === 'armor') nd2.armor = equippedArmor.length ? equippedArmor[equippedArmor.length - 1].name : '无甲';
      if (kind3 === 'shield') nd2.shield = equippedShield;
      saveCharacterData(tokenId, nd2, { toast: nextEq ? '已装备：' + items3[ii].name : '已卸下：' + items3[ii].name });
      refreshDetail(tokenId);
    },
    'item-del': function (actEl, d2, data2) {
      var di = Number(actEl.getAttribute('data-i'));
      var items4 = normalizeItems(data2).slice();
      if (!items4[di]) return;
      var removed = items4.splice(di, 1)[0];
      var removedKind = itemEquipKind(removed);
      var nd3 = Object.assign({}, data2, { items: items4 });
      if (removedKind === 'armor' && data2.armor === removed.name) nd3.armor = '无甲';
      if (removedKind === 'shield' && removed.equipped) nd3.shield = items4.some(function (x) { return x.equipped && itemEquipKind(x) === 'shield'; });
      saveCharacterData(tokenId, nd3, { toast: '已删除：' + removed.name });
      refreshDetail(tokenId);
    },
    'fx-add': function (a, d2, data2) { openFxModal(tokenId, data2); },
    'fx-preset': function (a, d2, data2) {
      addFxPreset(tokenId, data2, 'ac_plus_1');
      setTimeout(function () { addFxPreset(tokenId, data2, 'save_plus_1'); }, 120);
      setTimeout(function () { addFxPreset(tokenId, data2, 'spell_dc_plus_1'); }, 240);
    },
    'status-add': function (a, d2, data2) { openStatusModal(tokenId, data2); },
    'status-del': function (actEl, d2, data2) {
      var sdi = Number(actEl.getAttribute('data-i'));
      var sts = normalizeStatuses(data2).slice();
      if (sts[sdi]) {
        sts.splice(sdi, 1);
        saveCharacterData(tokenId, { statuses: sts }, { toast: '已移除状态' });
        refreshDetail(tokenId);
      }
    },
    'slot-toggle': function (actEl, d2, data2) {
      var ring = actEl.getAttribute('data-ring');
      var dpos = Number(actEl.getAttribute('data-d'));
      var used2 = Object.assign({}, data2.spellSlotsUsed || {});
      var curUsed = Number(used2[ring]) || 0;
      var isUsed = dpos < curUsed;
      used2[ring] = isUsed ? dpos : dpos + 1;
      saveCharacterData(tokenId, { spellSlotsUsed: used2 }, { toast: isUsed ? ring + '环法术位已恢复' : ring + '环法术位已消耗' });
      refreshDetail(tokenId);
    },
    'spell-add': function (a, d2, data2) { openSpellModal(tokenId, data2, null); },
    'spell-detail': function (actEl, d2, data2) { openSpellModal(tokenId, data2, Number(actEl.getAttribute('data-i'))); },
    'feat-del': function (actEl, d2, data2) {
      var fi = Number(actEl.getAttribute('data-i'));
      var feats = (Array.isArray(data2.features) ? data2.features : []).slice();
      if (feats[fi]) {
        feats.splice(fi, 1);
        saveCharacterData(tokenId, { features: feats }, { toast: '已删除能力记录' });
        refreshDetail(tokenId);
      }
    },
    'ai-summary': function (a, d2, data2) {
      var summary = buildAiSummary(data2);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(summary).then(function () {
            showToast('AI状态摘要已复制到剪贴板');
          }, function () { showToast(summary.slice(0, 40) + '…（请手动复制）'); });
        } else { showToast(summary.slice(0, 40) + '…（请手动复制）'); }
      } catch (err) { showToast(summary.slice(0, 40) + '…（请手动复制）'); }
    },
    'open-src': function () { if (ctx && ctx.openRuleFile) ctx.openRuleFile('玩家手册2024/角色职业/' + d.class + '/' + d.class + '.htm'); },
    'edit-sheet': function () { if (window.UIManager && window.UIManager.openCharacterModalForEdit) window.UIManager.openCharacterModalForEdit(tokenId); }
  };
  container.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    // 特殊路由：标签移除（data-tg-rm）
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
    while (actEl && actEl !== container && !actEl.getAttribute('data-act') && !actEl.getAttribute('data-switch')) actEl = actEl.parentNode;
    if (!actEl || actEl === container) return;
    // 特殊路由：角色切换（data-switch）
    var switchId = actEl.getAttribute('data-switch');
    if (switchId && switchId !== tokenId) {
      if (window.UIManager && window.UIManager.showCharacterDetail) window.UIManager.showCharacterDetail(switchId);
      return;
    }
    var act = actEl.getAttribute('data-act');
    var data2 = (token && token.data) || {};
    var derived2 = computeDerived(data2);
    var h = VIEW_ACT_TABLE[act];
    if (h) h(actEl, derived2, data2);
  });

  var statusList = container.querySelector('#cb2-status-list');
  if (statusList) {
    var addBtn = document.createElement('div');
    addBtn.style.cssText = 'margin-top:8px';
    addBtn.innerHTML = '<button type="button" class="cb2-btn sm" data-act="status-add">＋ 添加状态</button>';
    statusList.parentNode.insertBefore(addBtn, statusList.nextSibling);
    addBtn.querySelector('[data-act="status-add"]').addEventListener('click', function () { openStatusModal(tokenId, (token && token.data) || {}); });
  }

  if (window.TrpgTermTip && typeof window.TrpgTermTip.bind === 'function') {
    try { window.TrpgTermTip.bind(container, (ctx && ctx.system) || ''); } catch (e) {}
  }
  if (window.TrpgTag && typeof window.TrpgTag.bindTips === 'function') {
    try { window.TrpgTag.bindTips(container); } catch (e) {}
  }
}


var CREATE_RACES = ['阿斯莫', '龙裔', '矮人', '精灵', '侏儒', '歌利亚', '半身人', '人类', '兽人', '提夫林'];
var RACE_SIZE = {
  '阿斯莫': '中型', '龙裔': '中型', '矮人': '中型', '精灵': '中型', '侏儒': '小型',
  '歌利亚': '中型', '半身人': '小型', '人类': '中型', '兽人': '中型', '提夫林': '中型'
};
var RACE_LANGS = {
  '阿斯莫': '通用语、天界语', '龙裔': '通用语、龙语', '矮人': '通用语、矮人语', '精灵': '通用语、精灵语',
  '侏儒': '通用语、侏儒语', '歌利亚': '通用语、巨人语', '半身人': '通用语、半身人语', '人类': '通用语',
  '兽人': '通用语、兽人语', '提夫林': '通用语、炼狱语'
};
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
var ALIGNMENTS = ['守序善良', '守序中立', '守序邪恶', '中立善良', '绝对中立', '中立邪恶', '混乱善良', '混乱中立', '混乱邪恶'];
var POINTBUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
var POINTBUY_POINTS = 27;
var STD_ARRAY = [15, 14, 13, 12, 10, 8];
var CLASS_COLORS = {
  '野蛮人': '#e07a3f', '吟游诗人': '#c66bc4', '牧师': '#e8d44d', '德鲁伊': '#58a05a',
  '战士': '#b0453a', '武僧': '#6fb3c8', '圣武士': '#c9a84c', '游侠': '#4f8f5e',
  '魔契师': '#7d5bb8', '法师': '#5b8def', '游荡者': '#5a5a6e', '术士': '#d34f6f',
  '奇械师': '#3f9d8a'
};
var SAVE_RECS = {
  '野蛮人': ['str', 'con'], '吟游诗人': ['dex', 'cha'], '牧师': ['wis', 'cha'],
  '德鲁伊': ['int', 'wis'], '战士': ['str', 'con'], '武僧': ['str', 'dex'],
  '圣武士': ['wis', 'cha'], '游侠': ['str', 'dex'], '魔契师': ['wis', 'cha'],
  '法师': ['int', 'wis'], '游荡者': ['dex', 'int'], '术士': ['con', 'cha'],
  '奇械师': ['con', 'int']
};
var SKILL_RECS = {
  '野蛮人': ['运动', '驯兽', '威吓', '求生'], '吟游诗人': ['表演', '游说', '巧手', '欺瞒'],
  '牧师': ['洞悉', '医药', '历史', '宗教'], '德鲁伊': ['自然', '驯兽', '求生', '医药'],
  '战士': ['运动', '特技', '历史', '威吓'], '武僧': ['特技', '运动', '洞悉', '隐匿'],
  '圣武士': ['宗教', '游说', '洞悉', '威吓'], '游侠': ['求生', '隐匿', '察觉', '自然'],
  '魔契师': ['奥秘', '历史', '欺瞒', '调查'], '法师': ['奥秘', '历史', '调查', '宗教'],
  '游荡者': ['特技', '巧手', '隐匿', '察觉'], '术士': ['欺瞒', '表演', '威吓', '游说'],
  '奇械师': ['调查', '奥秘', '巧手', '宗教']
};
var CANTRIP_BASE = {
  '吟游诗人': 2, '牧师': 3, '德鲁伊': 2, '魔契师': 2, '术士': 4, '法师': 3, '奇械师': 2
};
var CLASS_SKILL_COUNT = {
  '野蛮人': 2, '吟游诗人': 3, '牧师': 2, '德鲁伊': 2, '战士': 2, '武僧': 2,
  '圣武士': 2, '游侠': 3, '游荡者': 4, '术士': 2, '魔契师': 2, '法师': 2, '奇械师': 3
};

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
  '奇械师': { options: [
    { label: 'A', items: ['皮甲', '轻弩', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '弩矢', '盗贼工具', '学者套组'], gold: 0 },
    { label: 'B', gold: 50 }
  ] }
};
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

var CLASS_TOOL_CHOICE = {
  '武僧': ['工匠工具', '乐器']
};
function replaceToolPlaceholder(items, toolProfs) {
  var t = (toolProfs || [])[0];
  return items.map(function (n) {
    if (/所选的工匠工具或乐器/.test(String(n))) return t || '所选的工匠工具或乐器';
    return n;
  });
}

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
var BG_ABILITY_KEY = { '力量': 'str', '敏捷': 'dex', '体质': 'con', '智力': 'int', '感知': 'wis', '魅力': 'cha' };

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

var TOOL_LISTS = {
  '工匠工具': ['炼金工具', '酿酒工具', '书法工具', '木匠工具', '制图工具', '鞋匠工具', '厨师工具', '玻璃匠工具', '珠宝匠工具', '皮匠工具', '石匠工具', '画家工具', '陶匠工具', '铁匠工具', '修补工具', '织布工具', '木雕工具'],
  '乐器': ['风笛', '鼓', '扬琴', '长笛', '鲁特琴', '竖琴', '号角', '排箫', '肖姆管', '提琴'],
  '赌具': ['骰子套组', '龙棋套组', '卡牌套组', '三龙赌局套组']
};
function bgToolCategory(toolStr) {
  var s = String(toolStr || '');
  if (s.indexOf('工匠工具') >= 0) return '工匠工具';
  if (s.indexOf('乐器') >= 0) return '乐器';
  if (s.indexOf('赌具') >= 0) return '赌具';
  return '';
}

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

function classFeaturesAt(cls, level) {
  var lv = Number(level) || 1;
  var tbl = CLASS_FEATURES_BY_LEVEL[cls];
  if (!tbl || !tbl[lv]) return [];
  return tbl[lv].filter(function (n) { return n && n !== '属性提升' && n !== '专长' && n !== '副职' && n !== '副职特性'; });
}
function subclassPickAt(cls, level) {
  var sc = SUBCLASSES[cls];
  if (!sc) return null;
  var lv = Number(level) || 1;
  var tbl = CLASS_FEATURES_BY_LEVEL[cls];
  if (tbl && tbl[lv] && tbl[lv].indexOf('副职') >= 0) return sc;
  return null;
}
function subclassFeatName(subName, feat) { return subName + '·' + feat; }




var CLASS_FEATURE_DESC = { "野蛮人·狂暴": "你可以将名为狂暴的原初之力赋予己身，为你带来超越常规的伟力和韧性。未着装重甲时，你能够以一个附赠动作进入狂暴。 你可以进入狂暴的次数见野蛮人特性表中狂暴一栏。当你完成一次 短休 时，你重获一次已消耗的使用次数；当你完成一次 长休 时，你重获所有已消耗的使用次数。 狂暴激活期间，你将遵循以下这些规则： 伤害抗性Damage Resistance。 你具有钝击、穿刺、挥砍伤害的抗性。 狂暴伤害Rage Damage。 当你使用力量发动一次攻击（无论这是一次武器攻击还是一次徒手打击）并对目标造成伤害时，你的伤害掷骰获得额外加值，这个加值随着你的野蛮人等级提升，见野蛮人特性表中狂暴伤害一栏。 力量优势Strength Advantage。 你的力量检定和力量豁免检定具有 优势 。 无法专注或施法No Concentration or Spells。 你无法保持 专注 ，也不能施展法术。 持续时间Duration。 狂暴持续至你的下个回合结束，如果你穿戴重甲或陷入 失能 状态，狂暴提前结束。如果在你的下一回合狂暴仍处于激活状态，你可以通过以下的任一方式令狂暴延长一轮： 对一名敌人进行一次攻击检定。 迫使一名敌人进行一次豁免检定。 以一个附赠动作延长你的狂暴。 每当狂暴被延长，都会持续至你的下个回合结束。你至多可以维持狂暴10分钟。", "狂暴": "你可以将名为狂暴的原初之力赋予己身，为你带来超越常规的伟力和韧性。未着装重甲时，你能够以一个附赠动作进入狂暴。 你可以进入狂暴的次数见野蛮人特性表中狂暴一栏。当你完成一次 短休 时，你重获一次已消耗的使用次数；当你完成一次 长休 时，你重获所有已消耗的使用次数。 狂暴激活期间，你将遵循以下这些规则： 伤害抗性Damage Resistance。 你具有钝击、穿刺、挥砍伤害的抗性。 狂暴伤害Rage Damage。 当你使用力量发动一次攻击（无论这是一次武器攻击还是一次徒手打击）并对目标造成伤害时，你的伤害掷骰获得额外加值，这个加值随着你的野蛮人等级提升，见野蛮人特性表中狂暴伤害一栏。 力量优势Strength Advantage。 你的力量检定和力量豁免检定具有 优势 。 无法专注或施法No Concentration or Spells。 你无法保持 专注 ，也不能施展法术。 持续时间Duration。 狂暴持续至你的下个回合结束，如果你穿戴重甲或陷入 失能 状态，狂暴提前结束。如果在你的下一回合狂暴仍处于激活状态，你可以通过以下的任一方式令狂暴延长一轮： 对一名敌人进行一次攻击检定。 迫使一名敌人进行一次豁免检定。 以一个附赠动作延长你的狂暴。 每当狂暴被延长，都会持续至你的下个回合结束。你至多可以维持狂暴10分钟。", "野蛮人·无甲防御": "若你未着装任何护甲，你的基础 护甲等级 等于10+你的敏捷调整值+你的体质调整值。你可以使用盾牌并仍从此特性获益。", "野蛮人·武器精通": "你对武器的训练使你能够运用两种自选的简易或军用近战武器的精通词条，例如巨斧和手斧。每当你完成一次 长休 时，你可以重新演练武器技巧，来改变你所选择的其中一个武器类型。 当你到达特定的野蛮人等级时，你还可以使用更多种类武器的精通词条，详见野蛮人特性表中武器精通一栏。", "吟游诗人·吟游诗人激励": "你可以用语言，音乐或舞蹈的形式对他人进行超自然的激励。这种激励的表现形式为数颗D6骰，这些骰子被称为诗人激励骰。 使用诗人激励Using Bardic Inspriration。 以一个附赠动作，你可以激励位于你60尺内的另一名能听见或看见你的生物。那名生物获得一枚你的诗人激励骰。一个生物同一时间只能拥有一枚诗人激励骰。在接下来的1小时内，当那名生物在一次 D20检定 中失败时，那名生物可以投掷诗人激励骰并将掷骰结果附加到该次d20中，这可能将失败变为成功。诗人激励骰将在投掷时已消耗。 使用次数Number of Uses。 你可以授予诗人激励骰的次数等于你的魅力调整值（最少1次），当你完成 长休 时，你重获所有已消耗的使用次数。 更高等级At Higher Levels。 你的诗人激励骰会在你到达特定吟游诗人等级时改变，如吟游诗人特性表中的诗人骰所示。你的诗人骰会在5级时变为d8，在10级时变为d10，在15级时变为d12。 吟游诗人的曲目 A Bard's Repertoire 你扮演的吟游诗人在吟诵古代英雄壮举时敲鼓相伴吗？他是拨动鲁特琴伴着低唱浪漫的旋律？还是演绎激昂的咏叹调？是朗诵经典悲剧中最震撼人心的独白？还是说他会在战斗中以民俗舞蹈的节奏协调战友的移动？又或者他会创作俏皮的打油诗？ 当你扮演吟游诗人时，你需要考虑你钟意的艺术表演风格、你可能唤起的情绪以及能激发你创作灵感的主题。你的诗歌被大自然的美好瞬间启发，亦或是对伤感失去的不散回想？你更偏好恢弘盛大的赞美诗，还是闹腾喧嚣的酒馆小曲儿？你是被逝者的哀悼还是庆祝时的喜悦所吸引？你跳起的是欢快的快步舞曲又或者是你精心编排、充满深意的舞步？你是专注于其中之一，还是以掌握所有风格为目标努力？", "吟游诗人激励": "你可以用语言，音乐或舞蹈的形式对他人进行超自然的激励。这种激励的表现形式为数颗D6骰，这些骰子被称为诗人激励骰。 使用诗人激励Using Bardic Inspriration。 以一个附赠动作，你可以激励位于你60尺内的另一名能听见或看见你的生物。那名生物获得一枚你的诗人激励骰。一个生物同一时间只能拥有一枚诗人激励骰。在接下来的1小时内，当那名生物在一次 D20检定 中失败时，那名生物可以投掷诗人激励骰并将掷骰结果附加到该次d20中，这可能将失败变为成功。诗人激励骰将在投掷时已消耗。 使用次数Number of Uses。 你可以授予诗人激励骰的次数等于你的魅力调整值（最少1次），当你完成 长休 时，你重获所有已消耗的使用次数。 更高等级At Higher Levels。 你的诗人激励骰会在你到达特定吟游诗人等级时改变，如吟游诗人特性表中的诗人骰所示。你的诗人骰会在5级时变为d8，在10级时变为d10，在15级时变为d12。 吟游诗人的曲目 A Bard's Repertoire 你扮演的吟游诗人在吟诵古代英雄壮举时敲鼓相伴吗？他是拨动鲁特琴伴着低唱浪漫的旋律？还是演绎激昂的咏叹调？是朗诵经典悲剧中最震撼人心的独白？还是说他会在战斗中以民俗舞蹈的节奏协调战友的移动？又或者他会创作俏皮的打油诗？ 当你扮演吟游诗人时，你需要考虑你钟意的艺术表演风格、你可能唤起的情绪以及能激发你创作灵感的主题。你的诗歌被大自然的美好瞬间启发，亦或是对伤感失去的不散回想？你更偏好恢弘盛大的赞美诗，还是闹腾喧嚣的酒馆小曲儿？你是被逝者的哀悼还是庆祝时的喜悦所吸引？你跳起的是欢快的快步舞曲又或者是你精心编排、充满深意的舞步？你是专注于其中之一，还是以掌握所有风格为目标努力？", "吟游诗人·施法": "Spellcasting 你从吟游艺术中学会了如何施展法术。施法规则见第七章。下文将详述如何将这些规则应用于吟游诗人法术，吟游诗人法术详见本章后文职业描述中的吟游诗人法术列表。 戏法Cantrips。 你知晓两道你选择的吟游诗人戏法。推荐选择 舞光术Dancing Light 和 恶言相加Vicious Mockery 。 每当你获得一个吟游诗人等级时，你都能从你的戏法*中选择其一替换为另一道你所选择的吟游诗人戏法。 当你的吟游诗人等级到达4级和10级时，你都能另选一道吟游诗人戏法并习得，如吟游诗人特性表中戏法一列所示。 *译注：原文无关于法术来源的描述，是否可以替换其他方式学到的戏法有待设计师确认，考虑到法师写法，疑似可以替换其他来源的戏法 法术位Spell Slots。 吟游诗人特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成 长休 时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择四道吟游诗人法术。推荐选择 魅惑类人Charm person ， 七彩喷射Color Spray ， 不谐低语Dissonant Whispers 和 治愈真言Healing Word 。 已准备法术数量会随你吟游诗人等级的提升而增加，如吟游诗人特性表中的准备法术一列所示。每当这一列的数字增加时，从吟游诗人法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级吟游诗人，则你的准备法术列表能包括六道一环或二环的吟游诗人法术，随意组合。 如果吟游诗人的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为吟游诗人法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个吟游诗人等级时，你就可以将你准备列表上的一道法术替换为另一道吟游诗人法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你吟游诗人法术的施法属性是 魅力 。 施法法器 Spellcasting Focus。 你可以使用 乐器 作为你吟游诗人法术的 施法法器 。", "牧师·施法": "你通过祈祷，冥想与奉献习得如何施法。施法规则见第七章。下文将详述如何将这些规则应用于牧师法术，牧师法术详见本章后文职业描述中的牧师法术列表。 戏法Cantrips。 你知晓三道你选择的牧师戏法。推荐选择 神导术Guidance ， 圣火术Sacred Flame 和 奇术Thaumaturgy 。 每当你获得一个牧师等级时，你都能从你的戏法中选择其一替换为另一道你所选择的牧师戏法。 当你的牧师等级到达4级和10级时，你都能另选一道牧师戏法并习得，如牧师特性表中戏法一列所示。 法术位Spell Slots。 牧师特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择四道牧师法术。推荐选择 祝福术Bless ， 疗伤术Cure Wounds ， 光导箭Guiding Bolt 和 虔诚护盾Shield of Faith 。 已准备法术数量会随你牧师等级的提升而增加，如牧师特性表中的准备法术一列所示。每当这一列的数字增加时，从牧师法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级牧师，则你的准备法术列表能包括六道一环或二环的牧师法术，随意组合。 如果牧师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为牧师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道或更多法术替换为其他牧师法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你牧师法术的施法属性是感知。 施法法器 Spellcasting Focus。 你可以使用圣徽作为你牧师法术的施法法器 。", "牧师·圣职": "Divine Order 你让自己投身于以下一种由你自己选择的神圣职能： 保护者Protcetor。 为战斗做足训练，你获得军用武器熟练与重甲受训。 奇术使Thaumaturage。 你从牧师法术列表中额外学会一道戏法。此外，你与神性的神秘链接使你在智力（奥秘和宗教）检定中获得加值。加值等于你的感知调整值（至少加1）。", "圣职": "Divine Order 你让自己投身于以下一种由你自己选择的神圣职能： 保护者Protcetor。 为战斗做足训练，你获得军用武器熟练与重甲受训。 奇术使Thaumaturage。 你从牧师法术列表中额外学会一道戏法。此外，你与神性的神秘链接使你在智力（奥秘和宗教）检定中获得加值。加值等于你的感知调整值（至少加1）。", "德鲁伊·德鲁伊语": "你学会了德鲁伊语，一门德鲁伊之间的秘密语言。在学会这门古老语言的同时，你也解锁了和动物交谈的魔法：你始终准备着法术 动物交谈Speak With Animals 。 你可以使用德鲁伊语来传递隐藏的信息。你和其他知晓这门语言的对象能够自动辨认出信息。其他人需要通过DC15的智力（调查）检定才能意识到信息的存在，但不借助魔法则无法解读。", "德鲁伊语": "你学会了德鲁伊语，一门德鲁伊之间的秘密语言。在学会这门古老语言的同时，你也解锁了和动物交谈的魔法：你始终准备着法术 动物交谈Speak With Animals 。 你可以使用德鲁伊语来传递隐藏的信息。你和其他知晓这门语言的对象能够自动辨认出信息。其他人需要通过DC15的智力（调查）检定才能意识到信息的存在，但不借助魔法则无法解读。", "德鲁伊·原初职能": "你将自己投身于所选择的以下一项神圣的角色之中： 术师Magician。 你从德鲁伊法术列表中额外学会一道戏法。此外，你与自然的神秘连接让你在智力（奥秘和自然）检定上获得加值。加值等于你的感知调整值（最低+1）。 卫士Warden。 你为战斗做足训练，你获得军用武器熟练和中甲受训。", "原初职能": "你将自己投身于所选择的以下一项神圣的角色之中： 术师Magician。 你从德鲁伊法术列表中额外学会一道戏法。此外，你与自然的神秘连接让你在智力（奥秘和自然）检定上获得加值。加值等于你的感知调整值（最低+1）。 卫士Warden。 你为战斗做足训练，你获得军用武器熟练和中甲受训。", "德鲁伊·施法": "你通过研究自然的神秘伟力学会了如何施展法术。施法规则见第七章。下文将详述如何将这些规则应用于德鲁伊法术，德鲁伊法术详见本章后文职业描述中的德鲁伊法术列表。 戏法Cantrips 。 你知晓两道你选择的德鲁伊戏法。推荐选择 德鲁伊伎俩Druidcraft 和 燃火术Produce Flame 。 每当你获得一个德鲁伊等级时，你都能从你的戏法中选择其一替换为另一道你所选择的德鲁伊戏法。 当你的德鲁伊等级到达4级和10级时，你都能另选一道德鲁伊戏法并习得，如德鲁伊特性表中戏法一列所示。 法术位Spell Slots。德鲁伊特性 表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术 Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择四道德鲁伊法术。推荐选择 化兽为友Animal Friendship 、 疗伤术Cure Wounds 、 妖火Faerie Fire 和 雷鸣波Thunderwave 。 已准备法术数量会随你德鲁伊等级的提升而增加，如德鲁伊特性表中的准备法术一列所示。每当这一列的数字增加时，从德鲁伊法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级德鲁伊，则你的准备法术列表能包括六道一环或二环的德鲁伊法术，随意组合。 如果德鲁伊的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为德鲁伊法术。 改变你的准备法术Changing Your Prepared Spells。 当你完成一次长休时，你可以将你准备列表上的一道或更多法术替换为其他德鲁伊法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你德鲁伊法术的施法属性是感知。 施法法器Spellcasting Focus。 你可以使用德鲁伊法器作为你德鲁伊法术的施法法器。", "战士·战斗风格": "你不断磨练你的武艺。你获得一项你选择的战斗风格专长（见第五章）。推荐选择防御。 每当你获得战士等级时，你可以将其改为另一个战斗风格专长。", "战斗风格": "你不断磨练你的武艺。你获得一项你选择的战斗风格专长（见第五章）。推荐选择防御。 每当你获得战士等级时，你可以将其改为另一个战斗风格专长。", "战士·回气": "你可以利用有限的精力与体力来重整旗鼓。以一个附赠动作，你可以用此法恢复生命值，其总值为1d10＋你的战士职业等级。 你可以使用此特性两次，并且在完成短休后恢复一次已消耗的使用次数，完成长休后恢复所有已消耗的使用次数。 当你到达特定战士等级时，你获得这项特性的额外使用次数，已列在战士特性表的回气一列。", "回气": "你可以利用有限的精力与体力来重整旗鼓。以一个附赠动作，你可以用此法恢复生命值，其总值为1d10＋你的战士职业等级。 你可以使用此特性两次，并且在完成短休后恢复一次已消耗的使用次数，完成长休后恢复所有已消耗的使用次数。 当你到达特定战士等级时，你获得这项特性的额外使用次数，已列在战士特性表的回气一列。", "战士·武器精通": "你对武器的训练使你能够运用三种自选的简易或军用武器的精通词条。每当你完成一次长休时，你可以重新演练武器技巧，来改变你所选择的其中一个武器类型。 当你到达特定的战士等级时，你还可以使用更多种类武器的精通词条，详见战士特性表中武器精通一栏。", "武僧·武艺": "你的武艺修行让你将徒手打击与武僧武器的使用方式烂熟于心。武僧武器包括： 简易近战武器 拥有轻型词条的军用近战武器 只要你未着装任何护甲也没持用盾牌，且徒手或只持用武僧武器，则你获得下列增益： 附赠徒手打击Bonus Unarmed Strike。 你可以用附赠动作发动一次徒手打击。 武艺骰Martial Arts Die。 你使用徒手打击或武僧武器进行攻击时，可以选择用1d6骰代替原本的伤害。该骰子将随武僧职业等级的提升而增大，具体数据见武僧特性表中的武艺骰一列。 敏捷攻击Dexterous Attacks。 你使用徒手打击或武僧武器进行攻击时，可以用敏捷代替力量进行攻击检定和伤害掷骰。此外，当你使用徒手打击的擒抱或推撞选项时，你也可以使用你的敏捷代替力量决定豁免DC。", "武艺": "你的武艺修行让你将徒手打击与武僧武器的使用方式烂熟于心。武僧武器包括： 简易近战武器 拥有轻型词条的军用近战武器 只要你未着装任何护甲也没持用盾牌，且徒手或只持用武僧武器，则你获得下列增益： 附赠徒手打击Bonus Unarmed Strike。 你可以用附赠动作发动一次徒手打击。 武艺骰Martial Arts Die。 你使用徒手打击或武僧武器进行攻击时，可以选择用1d6骰代替原本的伤害。该骰子将随武僧职业等级的提升而增大，具体数据见武僧特性表中的武艺骰一列。 敏捷攻击Dexterous Attacks。 你使用徒手打击或武僧武器进行攻击时，可以用敏捷代替力量进行攻击检定和伤害掷骰。此外，当你使用徒手打击的擒抱或推撞选项时，你也可以使用你的敏捷代替力量决定豁免DC。", "武僧·无甲防御": "若你未着装任何护甲且未持用盾牌，你的基础护甲等级等于10＋你的敏捷调整值＋你的感知调整值。", "圣武士·圣疗": "你的触碰溢满祝福，可以医治伤口。你获得一个治疗能量池，其内的治疗能量在每次完成长休时自动补满。治疗能量池储备的可恢复生命值总值等于你的圣武士等级的五倍。 你能够以附赠动作触碰一名生物（可以是你自己），并抽取治疗能量池中的能量恢复该生物的生命值，其恢复量最多等于你治疗能量池中剩余的治疗量。 此外，你也可以使用5点治疗量来移除目标身上的中毒状态，这些点数不会同时恢复生物的生命值。", "圣疗": "你的触碰溢满祝福，可以医治伤口。你获得一个治疗能量池，其内的治疗能量在每次完成长休时自动补满。治疗能量池储备的可恢复生命值总值等于你的圣武士等级的五倍。 你能够以附赠动作触碰一名生物（可以是你自己），并抽取治疗能量池中的能量恢复该生物的生命值，其恢复量最多等于你治疗能量池中剩余的治疗量。 此外，你也可以使用5点治疗量来移除目标身上的中毒状态，这些点数不会同时恢复生物的生命值。", "圣武士·施法": "你已经学会了如何通过祈祷与冥想来施展法术。施法规则见第七章。下文将详述如何将这些规则应用于圣武士法术，圣武士法术详见本章后文职业描述中的圣武士法术列表。 法术位Spell Slots。 圣武士特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 准备一环或以上的法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道圣武士法术推荐选择 英雄气概Heroism 和 炽焰斩Searing Smite 。 已准备法术数量会随你圣武士等级的提升而增加，如圣武士特性表中的准备法术一列所示。每当这一列的数字增加时，法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名5级的圣武士，则你的准备法术列表能包括六道一环或二环的圣武士法术，随意组合。 如果圣武士的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为圣武士法术。 改变准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道法术替换为其他圣武士法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你圣武士法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用圣徽作为你圣武士法术的施法法器 。", "圣武士·武器精通": "你对武器的训练使你能够运用两种自选的你具有熟练的武器的精通词条，例如长剑和标枪。 每当你完成一次长休时，你可以改变你所选择的武器类型。比如你可以改为戟和链枷。", "游侠·施法": "你学会运用自然世界的魔法本源进行施法。施法规则见第七章。下文将详述如何将这些规则应用于游侠法术，游侠法术详见本章后文职业描述中的游侠法术表。 法术位 Spell Slots。 游侠特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of 1st+ Level。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道游侠法术。推荐选择 捕获打击Ensnaring Strike 和 疗伤术Cure Wounds 。 已准备法术数量会随你游侠等级的提升而增加，如游侠特性表中的准备法术一列所示。每当这一列的数字增加时，从游侠法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名5级游侠，则你的准备法术列表能包括六道一环或二环的游侠法术，随意组合。 如果游侠的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为游侠法术。 改变你的准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道法术替换为其他游侠法术，新替换的法术必须是你拥有法术位的法术。 施法属性Spellcasting Ability。 你游侠法术的施法属性是感知。 施法法器Spellcasting Focus。 你可以使用德鲁伊法器作为你游侠法术的施法法器。", "游侠·宿敌": "你始终准备着法术 猎人印记Hunter's Mark 。你可以无需法术位地施展此法术共计两次，并在完成一次长休后恢复此能力的所有使用次数。 你能无需法术位施展该法术的次数会在你获得特定游侠等级时提升，见游侠特性表中的宿敌一栏。", "宿敌": "你始终准备着法术 猎人印记Hunter's Mark 。你可以无需法术位地施展此法术共计两次，并在完成一次长休后恢复此能力的所有使用次数。 你能无需法术位施展该法术的次数会在你获得特定游侠等级时提升，见游侠特性表中的宿敌一栏。", "游侠·武器精通": "你对武器的训练使你能够自选并使用2种已熟练武器的精通词条，例如长弓和短剑。 当你完成一次长休时，你可以改变你所选择的武器类型。比如你可以将其改为弯刀和长剑。", "魔契师·魔能祈唤": "你在神秘学识的研习过程中发掘出了使用魔能祈唤的方式，这些禁忌的知识残章让你获得了持久的魔法能力或其他锻炼成果。你获得一个自选的魔能祈唤，如书之魔契（详见后文“魔能祈唤选项”）。 先决Prerequisites。 如果一个魔能祈唤具有先决，那你必须满足它才能选取。例如，若一个魔能祈唤需要你魔契师等级5+，则只有你魔契师等级达到5级才可以选取该祈唤。 替换与获取魔能祈唤Replacing and Gaining Invocation。 每当你获得一级魔契师等级时，你都可以用新的祈唤替换一个已有的祈唤，但你必须满足其先决条件。如果一个祈唤是某个其他祈唤的先决条件，那你无法替换它。 当你到达特定的魔契师等级时，你还可以习得更多的魔能祈唤，具体数据见魔契师特性表中祈唤一列。 你不能多次重复选择同一个魔能祈唤，除非该祈唤的描述另有说明。", "魔能祈唤": "你在神秘学识的研习过程中发掘出了使用魔能祈唤的方式，这些禁忌的知识残章让你获得了持久的魔法能力或其他锻炼成果。你获得一个自选的魔能祈唤，如书之魔契（详见后文“魔能祈唤选项”）。 先决Prerequisites。 如果一个魔能祈唤具有先决，那你必须满足它才能选取。例如，若一个魔能祈唤需要你魔契师等级5+，则只有你魔契师等级达到5级才可以选取该祈唤。 替换与获取魔能祈唤Replacing and Gaining Invocation。 每当你获得一级魔契师等级时，你都可以用新的祈唤替换一个已有的祈唤，但你必须满足其先决条件。如果一个祈唤是某个其他祈唤的先决条件，那你无法替换它。 当你到达特定的魔契师等级时，你还可以习得更多的魔能祈唤，具体数据见魔契师特性表中祈唤一列。 你不能多次重复选择同一个魔能祈唤，除非该祈唤的描述另有说明。", "魔契师·契约魔法": "依靠玄秘的仪式，你与一位神秘存在缔结契约以获得魔法力量。这位存在隐于影中，仅闻其声，身份不明——但其恩泽是切实的。施法规则见第七章。下文将详述如何将这些规则应用于魔契师法术，魔契师法术详见本章后文职业描述中的魔契师法术列表。 戏法Cantrips。 你知晓两道你选择的魔契师戏法。推荐选择 魔能爆Eldritch Blast 和 魔法伎俩Prestidigitation 。每当你获得一个魔契师等级，你都能从此特性的戏法中选择其一替换为另一道你所选择的魔契师戏法。 当你的魔契师等级到达4级和10级时，你都能另选一道魔契师戏法并习得，如魔契师特性表中戏法一列所示。 法术位Spell Slots。 魔契师特性表中显示了你可用于施展一环到五环魔契师法术的法术位数量。表中还显示了法术位对应的法术环阶，你所有的法术位都属于同一环阶。当你完成短休或长休时，你重获所有已消耗的法术位。 例如，5级时，你总共具有两枚三环法术位。你施展一环法术 巫术箭Witch Bolt 时，必须消耗这些法术位其中之一，并把它作为一个三环法术施展。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道魔契师法术。推荐选择 魅惑类人Charm Person 和 脆弱诅咒Hex 。 已准备法术数量会随你魔契师等级的提升而增加，如魔契师特性表中的准备法术一列所示。每当这一列的数字增加时，从魔契师法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须不高于表中法术位环阶一栏中的环阶。例如，当你到达6级时，你可以新习得一道一环到三环的魔契师法术。 如果魔契师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为魔契师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个魔契师等级，你可以将你准备列表上的一道法术法术替换为另一道魔契师法术，新法术的环阶必须小于或等于你当前的法术位环阶。 施法属性Spellcasting Ability。 你魔契师法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用奥术法器作为你魔契师法术的施法法器。", "契约魔法": "依靠玄秘的仪式，你与一位神秘存在缔结契约以获得魔法力量。这位存在隐于影中，仅闻其声，身份不明——但其恩泽是切实的。施法规则见第七章。下文将详述如何将这些规则应用于魔契师法术，魔契师法术详见本章后文职业描述中的魔契师法术列表。 戏法Cantrips。 你知晓两道你选择的魔契师戏法。推荐选择 魔能爆Eldritch Blast 和 魔法伎俩Prestidigitation 。每当你获得一个魔契师等级，你都能从此特性的戏法中选择其一替换为另一道你所选择的魔契师戏法。 当你的魔契师等级到达4级和10级时，你都能另选一道魔契师戏法并习得，如魔契师特性表中戏法一列所示。 法术位Spell Slots。 魔契师特性表中显示了你可用于施展一环到五环魔契师法术的法术位数量。表中还显示了法术位对应的法术环阶，你所有的法术位都属于同一环阶。当你完成短休或长休时，你重获所有已消耗的法术位。 例如，5级时，你总共具有两枚三环法术位。你施展一环法术 巫术箭Witch Bolt 时，必须消耗这些法术位其中之一，并把它作为一个三环法术施展。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道魔契师法术。推荐选择 魅惑类人Charm Person 和 脆弱诅咒Hex 。 已准备法术数量会随你魔契师等级的提升而增加，如魔契师特性表中的准备法术一列所示。每当这一列的数字增加时，从魔契师法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须不高于表中法术位环阶一栏中的环阶。例如，当你到达6级时，你可以新习得一道一环到三环的魔契师法术。 如果魔契师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为魔契师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个魔契师等级，你可以将你准备列表上的一道法术法术替换为另一道魔契师法术，新法术的环阶必须小于或等于你当前的法术位环阶。 施法属性Spellcasting Ability。 你魔契师法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用奥术法器作为你魔契师法术的施法法器。", "法师·施法": "你已经入门了奥术魔法，学会了如何施展法术。施法规则见第七章。下文将详述如何将这些规则应用于法师法术，法师法术详见本章后文职业描述中的法师法术表。 戏法Cantrips。 你知晓三道你选择的法师戏法。推荐选择 光亮术Light 、 法师之手Mage Hand 和 冷冻射线Ray of Frost 。 每当你完成一次长休时，你都能从此特性的戏法中选择其一替换为另一道你所选择的法师戏法。 当你的法师等级到达4级和10级时，你都能另选一道法师戏法并习得，如法师特性表中戏法一列所示。 法术书Spellbook。 你在法师学徒阶段获取的所有成果汇集于一本独特的书：你的法术书。它是一个重3磅的微型物件，内有100页，并且只能被你自己或者施展了 鉴定术Identify 的人阅读。你来决定法术书的外貌和材料，比如一本镶金边的典籍或用麻绳装订的牛皮纸集。 这本书包含所有你已知的一环及以上的法术。最初，它记录着六道由你选择的一环法师法术。推荐选择 侦测魔法Detect Magic 、 羽落术Feather Fall 、 法师护甲Mage Armor 、 魔法飞弹Magic Missile 、 睡眠术Sleep 和 雷鸣波Thunderwave 。 1级之后每当你获得一个法师等级时，你就可以往法术书中添加两道你选择的法师法术。你所选择法术的环阶必须是你所拥有法术位对应的环阶，你所拥有的法术位如法师特性表中所示。这些法术是你定期进行奥术研究的成果。 法术位Spell Slots。 法师特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。为此，从法术书中选择四道法师法术。你所选择法术的环阶必须是你所拥有法术位对应的环阶。 已准备法术数量会随你法师等级的提升而增加，如法师特性表中的准备法术一列所示。每当该数字增加时，从你的法术书中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一名3级法师，则你的准备法术列表能包括六道一环或二环的法师法术（从法术书中选取），随意组合。 如果法师的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为法师法术。 改变你的准备法术Changing Your Prepared Spells。 每当你完成一次长休时，你可以将你准备列表上的一道或更多法术替换为你法术书上的其他法师法术。 施法属性Spellcasting Ability。 你法师法术的施法属性是智力。 施法法器Spellcasting Focus。 你可以使用奥术法器或你的法术书作为你法师法术的施法法器。 扩展与替换法术书 Expanding and Replacing a Spellbook 你获得职业等级时添加到法术书中的法术反映了你自己进行的魔法研究，但你可能会在冒险过程中发现其他可以添加至法术书中的法术。例如，你可能在一张 法术卷轴Spell Scroll 中发现一道法师法术，然后将该法术抄到你的法术书中。 将一道法术抄写到法术书中Copying a Spell into the Book。 当你发现一道一环或更高环阶的法师法术时，如果它是你能进行准备的法术位环阶且你能抽出时间来抄写它，则你可以将其抄写到你的法术书中。每个法术环阶的抄录过程都需要2小时并花费50GP。在此之后，你就可以像准备法术书中的其他法术一样准备该法术了。 替换法术书Replacing the Book。 你可以将法术从你自己的法术书复制到另一本书中。这就像将新法术复制到你的法术书中一样，但更快也更简单，因为你已经知道如何施展这些法术。复制过程只需每个法术环阶花费1小时和10GP。 如果你失去了你的法术书，则你可以使用相同的过程将你已准备的法师法术转录到新的法术书中。你仍需要找到新的法术来填满新书的剩余部分。出于这个原因，许多法师都会保留一本备用法术书。", "法师·仪式学家": "你能以仪式施展你法术书中任何带有仪式标签的法术。你不需要准备这些法术，但你以此法施展法术时必须阅读这本书。", "仪式学家": "你能以仪式施展你法术书中任何带有仪式标签的法术。你不需要准备这些法术，但你以此法施展法术时必须阅读这本书。", "法师·奥术回想": "你学会了通过研读法术书来恢复魔法能量的办法。你完成一次短休后，可以选择恢复已消耗的法术位。所恢复的法术位环阶总和不得大于你法师等级的一半（向上取整），且任何一个法术位的环阶都必须小于六环。例如，作为一名4级法师时，你可恢复环阶总数最多为二的法术位。你可以选择恢复一个二环法术位或两个一环法术位。 此特性一经使用，直至完成长休你都无法再次使用。", "奥术回想": "你学会了通过研读法术书来恢复魔法能量的办法。你完成一次短休后，可以选择恢复已消耗的法术位。所恢复的法术位环阶总和不得大于你法师等级的一半（向上取整），且任何一个法术位的环阶都必须小于六环。例如，作为一名4级法师时，你可恢复环阶总数最多为二的法术位。你可以选择恢复一个二环法术位或两个一环法术位。 此特性一经使用，直至完成长休你都无法再次使用。", "游荡者·专精": "你获得两项由你选择的你已熟练的技能的专精。 如果你有这两项技能的熟练的话，推荐选择巧手和隐匿。 当你的游荡者等级为6级时，你额外再获得两项由你选择的你已熟练的技能的专精。", "专精": "你获得两项由你选择的你已熟练的技能的专精。 如果你有这两项技能的熟练的话，推荐选择巧手和隐匿。 当你的游荡者等级为6级时，你额外再获得两项由你选择的你已熟练的技能的专精。", "游荡者·偷袭": "你知道如何利用敌人的分心并发动致命的精巧打击。每个回合一次，当你以攻击检定命中了一个生物时，你可以造成1d6的额外伤害。这次攻击必须使用一把灵巧或远程武器并具有优势。额外伤害的伤害类型与该武器的伤害类型一致。 除此之外，若你的目标周围5尺内有你的盟友，并且该盟友没有陷入失能状态，你的攻击检定也没有劣势的话，则你不需要优势也造成额外伤害。 你的额外伤害会随着你的游荡者等级提高而增长，具体如游荡者特性表中的偷袭一列所示。", "偷袭": "你知道如何利用敌人的分心并发动致命的精巧打击。每个回合一次，当你以攻击检定命中了一个生物时，你可以造成1d6的额外伤害。这次攻击必须使用一把灵巧或远程武器并具有优势。额外伤害的伤害类型与该武器的伤害类型一致。 除此之外，若你的目标周围5尺内有你的盟友，并且该盟友没有陷入失能状态，你的攻击检定也没有劣势的话，则你不需要优势也造成额外伤害。 你的额外伤害会随着你的游荡者等级提高而增长，具体如游荡者特性表中的偷袭一列所示。", "游荡者·盗贼黑话": "Thieves' Cant 你在施展自己游荡者才华的社区里学习了多样的语言。你习得盗贼黑话和第二章的语言表中的一项语言。", "盗贼黑话": "Thieves' Cant 你在施展自己游荡者才华的社区里学习了多样的语言。你习得盗贼黑话和第二章的语言表中的一项语言。", "游荡者·武器精通": "你对武器的训练使你能够运用两种自选的你具有熟练的武器的精通词条，例如匕首和短弓。 每当你完成一次长休时，你可以改变你所选择的武器类型。比如你可以改为弯刀和短剑。", "术士·施法": "你从你的天生魔法汲取魔力用于施展法术。参见第七章有关施法的规则。下述信息将详述如何将这些规则应用于术士法术，术士法术详见本章后文职业描述中的术士法表。 戏法Cantrips。 你知晓四道你选择的术士戏法。推荐选择 光亮术Light 、 魔法伎俩Prestidigitation 、 电爪Shocking Grasp 和 术法爆发Sorcerous Burst 。每当你获得一个术士等级时，你都能将通过此特性知晓的其中一个戏法替换为另一个你所选择的术士戏法。 当你的术士等级达到4级和10级时，你都能另选一道术士戏法并习得，如术士特性表中戏法一列所示。 法术位Spell Slots。 术士特性表显示了你可用于施展一环及以上法术的法术位数量。当你完成长休时，你重获所有已消耗的法术位。 一环及以上的准备法术Prepared Spells of Level 1+。 你准备可供你以此特性施展的一环及更高环阶的法术列表。最初，选择两道术士法术。推荐选择 燃烧之手Burning Hands 和 侦测魔法Detect Magic 。 已准备法术数量会随你术士等级的提升而增加，如术士特性表中的准备法术一列所示。每当这一列的数字增加时，从术士法术列表中选择额外法术准备，直至已准备法术的数量与表格中的数字一致。你所选择法术的环阶必须是你所拥有法术位对应的环阶。例如，如果你是一位3级术士，则你的准备法术列表能包括六道一环或二环的术士法术，随意组合。 如果术士的其他特性给了你始终准备着的法术，这些法术不计入你以此法准备的法术数量，但这些法术对你而言都视为术士法术。 改变你的准备法术Changing Your Prepared Spells。 每当你获得一个术士等级时，你就可以将你准备列表上的一道法术替换为另一道术士法术，你必须拥有替换后法术对应环阶的法术位才可以替换。 施法属性Spellcasting Ability。 你术士法术的施法属性是魅力。 施法法器Spellcasting Focus。 你可以使用奥术法器作为你术士法术的施法法器。", "术士·先天术法": "你过去经历的某件事在你身上留下了不可磨灭的印记，为你注入了难以控制的涌动魔力。以一个附赠动作，你可以将魔力释放而出，持续1分钟。在这1分钟期间，你获得以下增益： 你的术士法术豁免DC+1。 你在你施展的术士法术的攻击检定中具有优势。 你可以使用此特性两次，你在完成一次长休时重获所有已消耗的使用次数。", "先天术法": "你过去经历的某件事在你身上留下了不可磨灭的印记，为你注入了难以控制的涌动魔力。以一个附赠动作，你可以将魔力释放而出，持续1分钟。在这1分钟期间，你获得以下增益： 你的术士法术豁免DC+1。 你在你施展的术士法术的攻击检定中具有优势。 你可以使用此特性两次，你在完成一次长休时重获所有已消耗的使用次数。" };

var COMPONENT_DEF = {
  V: { label: '言语', desc: '必须念出特定咒语或短语。无法说话（沉默术、溺水等）时不能施法。' },
  S: { label: '姿势', desc: '必须以特定方式比划手势。双手被束缚（被擒抱、被缚绑）时不能施法。' },
  M: { label: '材料', desc: '必须手持规则规定的小物件，或用施法法器代替（材料有明确价值/被消耗时不可代替）。' }
};
function parseComponents(c) {
  var out = [], seen = {};
  var s = String(c || '');
  String(s).replace(/成分/g, '').replace(/[VSM]/g, function (ch) {
    var k = ch.toUpperCase();
    if ((k === 'V' || k === 'S' || k === 'M') && !seen[k]) {
      seen[k] = 1;
      out.push({ key: k, label: COMPONENT_DEF[k].label, desc: COMPONENT_DEF[k].desc, material: '' });
    }
    return ch;
  });
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

// 译名差异表（模块级，查看层/编辑层共用）：同一法术在不同数据文件中的译名不同时使用
// （示例："强制决斗" = rule_spell_schools.json 中的"强令对决"Compelled Duel）
var SPELL_NAME_ALIAS = {
  '强制决斗': '强令对决',
  '人类定身术': '定身类人',
  '怪物定身术': '定身怪物',
  '力墙术': '力场墙',
  '威力法阵': '原力法阵',
  '秘 法眼': '秘法眼'
};
var _spellDescCache = {};
var _schoolByName = null; // rule_spell_schools.json → name 索引（数据文件驱动，非搜索）
function spellDescFromDataFiles(ctx, name) {
  // 数据文件驱动：法术效果一律来自专门构建的数据文件（rule_spells_full.json / rule_spell_schools.json），
  // 禁止运行时搜索获取规则内容。文件名/键名差异（中文+英文全名、译名差异）在此兼容。
  if (_fullSpellCache && _fullSpellCache[name]) return formatSpellFull(_fullSpellCache[name]);
  var rec = null;
  if (_schoolByName) {
    rec = _schoolByName[name] || null;
    if (!rec) {
      var k0 = Object.keys(_schoolByName).filter(function (k) { return k.indexOf(name) === 0; })[0];
      if (k0) rec = _schoolByName[k0];
    }
  }
  if (!rec && SPELL_NAME_ALIAS[name]) {
    var al = SPELL_NAME_ALIAS[name];
    rec = (_fullSpellCache && _fullSpellCache[al]) || (_schoolByName && _schoolByName[al]) || null;
    if (!rec && _schoolByName) {
      var k1 = Object.keys(_schoolByName).filter(function (k) { return k.indexOf(al) === 0; })[0];
      if (k1) rec = _schoolByName[k1];
    }
  }
  if (rec) return formatSpellFull(rec);
  return '';
}
function querySpellDesc(ctx, name, cb) {
  name = String(name || '').trim();
  if (!name) { cb(''); return; }
  if (_spellDescCache[name] !== undefined) { cb(_spellDescCache[name]); return; }
  try {
    if (!ctx || typeof ctx.fetch !== 'function') { cb(''); return; }
    // 首选：加载专门构建的数据文件（规则内容文件化，程序化取用）
    var u1 = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spells_full.json';
    var u2 = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spell_schools.json';
    Promise.all([
      ctx.fetch(u1).then(function (r) { return r.json(); }).catch(function () { return null; }),
      ctx.fetch(u2).then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (rows) {
      if (!_fullSpellCache && rows[0] && rows[0].spells) _fullSpellCache = rows[0].spells;
      if (!_schoolByName && rows[1] && rows[1].spells) {
        _schoolByName = {};
        Object.keys(rows[1].spells).forEach(function (k) {
          var v = rows[1].spells[k];
          if (v && v.name) _schoolByName[v.name] = v;
        });
      }
      var txt = spellDescFromDataFiles(ctx, name);
      _spellDescCache[name] = txt;
      cb(txt);
    }).catch(function () {
      // 最后兜底：索引搜索（仅数据文件缺失/异常时；正常流程不依赖搜索）
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
    });
  } catch (e) { cb(''); }
}
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

var STYLE_EXTRA =
  '.cb2-comp-tag{display:inline-flex;align-items:center;gap:3px;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:800;cursor:help;line-height:1.6;border:1px solid var(--border-light)}' +
  '.cb2-comp-tag i{font-style:normal;font-weight:600;font-size:9.5px;opacity:.85}' +
  '.cb2-comp-v{color:#7fd4ff;background:rgba(63,142,239,.14);border-color:rgba(63,142,239,.4)}' +
  '.cb2-comp-s{color:#9fe8a8;background:rgba(88,160,90,.14);border-color:rgba(88,160,90,.4)}' +
  '.cb2-comp-m{color:#f2d38a;background:rgba(201,168,76,.13);border-color:rgba(201,168,76,.42)}' +
  '.cb2-spell-tip{position:fixed;z-index:11000;max-width:280px;background:var(--bg-surface);border:1px solid var(--gold-d);border-radius:10px;padding:9px 11px;box-shadow:0 10px 34px rgba(0,0,0,.55);font-size:12px;color:var(--text);line-height:1.65;animation:cb2-slide .18s ease-out;pointer-events:none}' +
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
  '.cb2-gold-ledger{display:flex;gap:14px;flex-wrap:wrap;align-items:center;background:linear-gradient(135deg,rgba(201,168,76,.10),rgba(201,168,76,.03));border:1px solid rgba(201,168,76,.3);border-radius:8px;padding:6px 10px;margin-top:6px}' +
  '.cb2-gl-cell{font-size:11px;color:var(--text-2)}' +
  '.cb2-gl-cell b{font-family:"Cinzel",serif;font-size:13px;color:var(--gold-l)}' +
  '.cb2-gl-src{display:block;font-size:9px;color:var(--text-mute)}' +
  '.cb2-chip-price{display:inline-block;font-size:9px;color:var(--gold-l);background:rgba(201,168,76,.12);border-radius:7px;padding:0 5px;margin-left:5px;vertical-align:1px}' +
  '.cb2-wp-prop{display:inline-block;font-size:8.5px;color:#ffa7a7;background:rgba(229,72,77,.12);border:1px solid rgba(229,72,77,.35);border-radius:7px;padding:0 5px;margin-left:5px;vertical-align:1px;font-style:normal}' +
  '.cb2-start-item .cb2-it-price{display:inline-block;font-size:9px;color:var(--green-l);background:rgba(46,204,113,.12);border-radius:7px;padding:0 5px;margin-left:5px;vertical-align:1px}' +
  '.cb2-start-item .cb2-it-price.free{color:var(--text-mute);background:rgba(255,255,255,.06)}' +
  '.cb2-prof-hint{font-size:10.5px;color:var(--text-3);border-left:3px solid var(--gold-d);padding:4px 8px;background:var(--bg-panel);border-radius:4px;margin-top:6px;line-height:1.6}' +
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
  '.cb2-cls-skill-pick{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}' +
  '.cb2-cls-skill-pick .cb2-chip{cursor:pointer}' +
  '.cb2-cls-skill-pick .cb2-chip.off{opacity:.45}' +
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
  '.cb2-inv-list{display:flex;flex-direction:column;gap:4px;margin-top:6px}' +
  '.cb2-inv-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-deep);font-size:11.5px;transition:border-color .15s}' +
  '.cb2-inv-row:hover{border-color:var(--gold-d)}' +
  '.cb2-inv-row.empty{min-height:38px;border-style:dashed;cursor:pointer;color:var(--text-3);opacity:.72}' +
  '.cb2-inv-row.empty:hover{opacity:1;color:var(--gold-l);background:rgba(201,168,76,.06)}' +
  '.cb2-inv-row.empty span:first-child{flex:1.4;min-width:120px;font-weight:600}' +
  '.cb2-inv-row.empty span:not(:first-child){flex:.8;min-width:56px;font-size:10px}' +
  '.cb2-inv-row .cb2-inv-name{flex:1.4;min-width:120px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.cb2-inv-row .cb2-inv-name.eq{color:var(--gold-l)}' +
  '.cb2-inv-row .cb2-inv-cat{flex:.8;min-width:56px;font-size:10px;color:var(--text-3);white-space:nowrap}' +
  '.cb2-inv-row .cb2-inv-qty{display:flex;align-items:center;gap:5px;flex-shrink:0}' +
  '.cb2-inv-row .cb2-inv-qty b{min-width:18px;text-align:center;color:var(--text)}' +
  '.cb2-inv-row .cb2-inv-price{flex:.9;min-width:74px;font-size:10.5px;color:var(--gold-l);white-space:nowrap}' +
  '.cb2-scroll-maker{border:1px dashed var(--border-light);border-radius:8px;padding:6px 10px;margin-top:8px;background:var(--bg-deep)}' +
  '.cb2-bg-card{background:var(--bg-panel);border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;margin-top:2px}' +
  '.cb2-bg-card-t{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:8px}' +
  '.cb2-bg-card-tag{font-size:9.5px;font-weight:600;color:#141414;background:linear-gradient(135deg,var(--gold-d),var(--gold));border-radius:10px;padding:1px 8px}' +
  '.cb2-bg-card-t .cb2-btn{margin-left:auto}' +
  '.cb2-bg-card-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 10px}' +
  '@media(max-width:880px){.cb2-bg-card-grid{grid-template-columns:repeat(2,1fr)}}' +
  '.cb2-attr-plan-row{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;margin-bottom:10px}' +
  '.cb2-attr-plan{flex:1;min-width:130px;border:1.5px solid var(--border-light);border-radius:10px;padding:8px 12px;cursor:pointer;transition:all .18s;background:var(--bg-deep);text-align:center}' +
  '.cb2-attr-plan:hover{border-color:var(--gold-d);background:var(--bg-hover);transform:translateY(-1px)}' +
  '.cb2-attr-plan.on{border-color:var(--gold);background:linear-gradient(135deg,rgba(201,168,76,.16),transparent);box-shadow:0 0 0 1px var(--gold-d)}' +
  '.cb2-attr-plan-t{font-size:9.5px;color:var(--text-3);letter-spacing:1px;margin-bottom:3px}' +
  '.cb2-attr-plan-v{font-size:13px;font-weight:800;color:var(--gold-l);line-height:1.5}' +
  '.cb2-attr-plan.on .cb2-attr-plan-v{color:var(--gold)}' +
  '.cb2-attr-undo{align-self:center}' +
  '.cb2-attr-plan-row .cb2-btn{align-self:center}' +
  '.cb2-source-switch{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px}' +
  '.cb2-bgattr-panel{margin-top:10px;border:1px solid var(--border-light);border-radius:12px;background:rgba(21,32,58,.62);padding:10px}' +
  '.cb2-bgattr-proof{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}' +
  '.cb2-asi-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:700;color:var(--gold-l);margin:0 0 8px}' +
  '.cb2-asi-panel-empty{border:1px dashed var(--border-light);border-radius:10px;padding:10px;color:var(--text-3);font-size:12px;background:rgba(21,32,58,.38)}' +
  '.cb2-asi-src{border:1px solid var(--border-light);border-radius:12px;background:rgba(21,32,58,.62);padding:9px 11px;margin-bottom:8px;display:grid;grid-template-columns:minmax(130px,1fr) auto auto;gap:8px 12px;align-items:center}' +
  '.cb2-asi-src-t{font-size:12.5px;font-weight:700;color:var(--text);display:flex;flex-direction:column;gap:2px}' +
  '.cb2-asi-src-ctl{display:flex;gap:5px;flex-wrap:wrap;align-items:center;justify-content:flex-end}' +
  '.cb2-asi-tokens{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end}' +
  '.cb2-asi-token{border:1px solid var(--gold-d);background:linear-gradient(135deg,rgba(201,168,76,.22),rgba(201,168,76,.08));color:var(--gold-l);border-radius:10px;padding:6px 11px;font-size:12px;font-weight:800;cursor:grab;user-select:none;min-width:40px;text-align:center}' +
  '.cb2-asi-token.used{opacity:.45;border-style:dashed;background:var(--bg-deep);cursor:default}' +
  '.cb2-asi-token:hover:not(.used){transform:translateY(-1px);box-shadow:0 2px 8px rgba(201,168,76,.3)}' +
  '.cb2-ab-final{position:relative;width:62px;margin:5px auto 2px;text-align:center;font-size:17px;font-weight:800;display:block;padding:5px 2px;border:1px dashed var(--green);border-radius:8px;background:rgba(46,204,113,.06);color:var(--green-l);cursor:pointer;transition:all .18s;font-family:"Cinzel",serif}' +
  '.cb2-ab-final:hover,.cb2-ab-final.dragover{border-color:var(--gold);color:var(--gold-l);background:rgba(201,168,76,.1);box-shadow:0 0 0 2px rgba(201,168,76,.25)}' +
  '.cb2-ab-final .cb2-ab-base{display:block;font-style:normal;font-size:8.5px;color:var(--text-3);font-family:system-ui,sans-serif;font-weight:500;letter-spacing:.5px;margin-top:1px}' +
  '.cb2-ab-base{font-size:9px;color:var(--text-3);margin-top:2px;letter-spacing:.4px}' +
  '.cb2-ab-chips{display:flex;gap:3px;flex-wrap:wrap;justify-content:center;margin-top:3px}' +
  '.cb2-ab-chip{border:1px solid rgba(46,204,113,.5);background:rgba(46,204,113,.1);color:var(--green-l);border-radius:6px;padding:1px 5px;font-size:9px;cursor:pointer;line-height:1.5}' +
  '.cb2-ab-chip:hover{border-color:var(--red);color:var(--red-l);background:rgba(229,72,77,.1)}' +
  '.cb2-feat-picker{position:relative}' +
  '.cb2-feat-picker-t{font-size:12px;font-weight:800;color:var(--text);margin:8px 0 5px;letter-spacing:1px}' +
  '.cb2-feat-filter{width:100%;max-width:300px;margin-bottom:6px}' +
  '.cb2-feat-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:5px;max-height:210px;overflow-y:auto;border:1px solid var(--border-light);border-radius:10px;padding:7px;background:var(--bg-deep)}' +
  '.cb2-feat-item{border:1px solid var(--border);background:var(--bg-surface);color:var(--text-2);border-radius:8px;padding:5px 8px;font-size:11.5px;cursor:pointer;transition:all .15s;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.cb2-feat-item:hover{border-color:var(--gold-d);color:var(--gold-l);background:var(--bg-hover)}' +
  '.cb2-feat-item.on{border-color:var(--gold);background:linear-gradient(135deg,rgba(201,168,76,.2),transparent);color:var(--gold-l);font-weight:700}' +
  '.cb2-feat-desc{min-height:46px;max-height:96px;overflow-y:auto;margin-top:6px;padding:7px 9px;border:1px dashed var(--border-light);border-radius:8px;background:var(--bg-deep);font-size:11.5px;line-height:1.7;color:var(--text-2)}' +
  '.cb2-rollset-list{display:flex;flex-direction:column;gap:6px;max-height:248px;overflow-y:auto;padding-right:3px}' +
  '.cb2-rollset-row{display:grid;grid-template-columns:86px 1fr 84px;gap:8px;align-items:center;border:1px solid var(--border);border-radius:10px;background:var(--bg-deep);padding:8px;color:var(--text);cursor:pointer;text-align:left}' +
  '.cb2-rollset-row:hover{border-color:var(--gold-d);background:var(--bg-hover)}' +
  '.cb2-rollset-row.empty{opacity:.72;border-style:dashed}' +
  '.cb2-rollset-row:disabled{cursor:default;opacity:.38}' +
  '.cb2-rollset-row .cb2-rollset-chips{display:flex;gap:5px;flex-wrap:wrap}' +
  '.cb2-rollset-row .cb2-rollset-chips i{font-style:normal;min-width:28px;text-align:center;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,.04);padding:3px 6px}' +
  '.cb2-equip-catalog-note{margin-top:8px;border:1px dashed var(--border);border-radius:10px;padding:8px;background:rgba(10,14,30,.38)}' +
  '.cb2-skill-src{display:block;font-size:9px;color:var(--gold-d);margin-top:2px;font-weight:600}' +
  '.cb2-bg-src{display:block;font-size:9px;color:var(--gold-d);margin-top:3px;font-weight:600;line-height:1.5}' +
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
  '.cb2-feat-chip{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;border:1px solid var(--gold-d);background:rgba(201,168,76,.1);color:var(--gold-l);border-radius:14px;padding:3px 9px;font-size:11px;line-height:1.5;cursor:help}' +
  '.cb2-feat-chip:hover{border-color:var(--gold);box-shadow:0 0 8px rgba(201,168,76,.35)}' +
  '.cb2-feat-chip .src{font-size:9px;color:var(--text-3);border:1px solid var(--border-light);border-radius:8px;padding:0 5px}' +
  '.cb2-feat-chip .src.auto{color:var(--gold-l);border-color:var(--gold-d)}' +
  '.cb2-feat-chip .src.custom{color:var(--blue-l,#9dbdf7);border-color:rgba(91,141,239,.4)}' +
  '.cb2-feat-chip .rm{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:12px;line-height:1;padding:0 0 0 2px}' +
  '.cb2-feat-chip .rm:hover{color:var(--red-l)}' +
  '.cb2-bg-equip{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
  '.cb2-bg-equip-d{font-size:10.5px;color:var(--text-3)}' +
  '.cb2-bonus-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:rgba(201,168,76,.08);border:1px dashed var(--gold-d);border-radius:8px;padding:5px 10px;font-size:11.5px;color:var(--text-2);margin-bottom:8px}' +
  '.cb2-bonus-bar b{color:var(--gold-l)}' +  '.cb2-bonus-ic{font-size:12px}' +
  '.cb2-bonus-tip{color:var(--text-3);font-size:10px;margin-left:auto}' +
  '.cb2-start-opt{display:flex;gap:6px;flex-wrap:wrap}' +
  '.cb2-start-opt .cb2-btn{padding:4px 10px;font-size:11px}' +
  '.cb2-start-opt .cb2-btn.gold{border-color:var(--gold)}';


var CREATE_STYLE = '' +
  '.cb2-create-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}' +
  '@media(max-width:880px){.cb2-create-grid{grid-template-columns:1fr}}' +
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
  '.cb2-pool{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}' +
  '.cb2-pool-chip{width:46px;height:46px;border-radius:10px;border:1px solid var(--border-light);background:var(--bg-deep);color:var(--text);font-family:"Cinzel",serif;font-size:17px;font-weight:700;cursor:pointer;transition:all .18s;box-shadow:0 2px 6px rgba(0,0,0,.35)}' +
  '.cb2-pool-chip:hover{transform:translateY(-2px);border-color:var(--gold-d);color:var(--gold-l)}' +
  '.cb2-pool-chip.sel{background:linear-gradient(135deg,var(--gold-d),var(--gold));color:#141414;border-color:var(--gold);transform:translateY(-2px) scale(1.06);box-shadow:0 4px 14px rgba(201,168,76,.45)}' +
  '.cb2-pool-msg{font-size:11px;color:var(--text-3);margin-bottom:8px;line-height:1.6}' +
  '.cb2-pool-msg b{color:var(--gold-l)}' +
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
  '.cb2-derived{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}' +
  '@media(max-width:640px){.cb2-derived{grid-template-columns:repeat(2,1fr)}}' +
  '.cb2-dv{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:7px 6px;text-align:center}' +
  '.cb2-dv .l{font-size:10px;color:var(--text-3);letter-spacing:.03em}' +
  '.cb2-dv .v{font-size:16px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums}' +
  '.cb2-dv .v.warn{color:var(--amber)}' +
  '.cb2-dv .v.ok{color:var(--green-l)}' +
  '.cb2-dv .v.over{color:var(--red-l)}' +
  '.cb2-dv .s{font-size:9.5px;color:var(--text-3)}' +
  '.cb2-skill-row{display:grid;grid-template-columns:1fr 44px 92px;gap:6px;align-items:center;margin-bottom:5px;padding:3px 6px;border-radius:6px;transition:background .15s}' +
  '.cb2-skill-row:hover{background:var(--bg-hover)}' +
  '.cb2-skill-row .nm{font-size:12px;color:var(--text);display:flex;align-items:baseline;gap:6px}' +
  '.cb2-skill-row .nm em{font-style:normal;font-size:9.5px;color:var(--text-3)}' +
  '.cb2-skill-row .bn{font-size:12px;font-weight:700;color:var(--gold-l);text-align:right;font-variant-numeric:tabular-nums}' +
  '.cb2-skill-row select{width:100%}' +
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
  '.cb2-selected{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
  '.cb2-sel-chip{display:inline-flex;align-items:center;gap:5px;background:var(--bg-active);border:1px solid var(--gold-d);color:var(--gold-l);border-radius:14px;padding:3px 8px;font-size:11px}' +
  '.cb2-sel-chip .rm{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:12px;line-height:1;padding:0 0 0 2px}' +
  '.cb2-sel-chip .rm:hover{color:var(--red-l)}' +
  '.cb2-sel-chip .lv{color:var(--text-3);font-size:9.5px}' +
  '.cb2-mini-label{font-size:10.5px;color:var(--text-3);margin-top:8px}' +
  '.cb2-limit-row{display:flex;align-items:center;gap:8px;margin-top:5px}' +
  '.cb2-limit-row .lb{width:64px;flex-shrink:0;color:var(--text-2)}' +
  '.cb2-bar{flex:1;height:7px;border-radius:4px;background:var(--bg-active);border:1px solid var(--border);overflow:hidden}' +
  '.cb2-bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#5b8def,#7fd4ff);transition:width .25s}' +
  '.cb2-bar-fill.over{background:linear-gradient(90deg,#e5484d,#ff8a8a)}' +
  '.cb2-limit-row .cnt{font-size:10.5px;color:var(--gold-l);flex-shrink:0}' +
  '.cb2-limit-row .cnt.over{color:var(--red-l);font-weight:700}' +
  '.cb2-edit-grid .full{grid-column:1/-1}' +
  '.cb2-loading{color:var(--text-3);font-size:11.5px;padding:6px 0;animation:cb2-fade .4s}' +
  '.cb2-create .cb2-sec:hover{border-color:var(--border-light)}' +
  '.cb2-ability-grid.cb2-horz{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}' +
  '.cb2-ab-item.cb2-ab-horz{padding:8px 4px}' +
  '.cb2-ab-item.cb2-ab-horz .nm{font-size:10.5px}' +
  '.cb2-ab-item.cb2-ab-horz .cb2-ab-input{width:52px;font-size:14px}' +
  '.cb2-ab-item.cb2-ab-horz .cb2-ab-slot{width:54px;font-size:14px}' +
  '.cb2-ab-item.cb2-ab-horz .save-t{top:4px;right:4px}' +
  '.cb2-race-card{background:var(--bg-panel);border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;margin-top:2px}' +
  '.cb2-race-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:8px}' +
  '.cb2-race-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
  '.cb2-race-meta .cb2-tag{font-size:10px;color:var(--text-2);border:1px solid var(--border-light);border-radius:10px;padding:2px 8px;background:var(--bg-deep)}' +
  '.cb2-race-traits{display:grid;gap:6px}' +
  '.cb2-race-trait{border-left:2px solid var(--gold-d);background:var(--bg-deep);border-radius:0 6px 6px 0;padding:5px 9px;font-size:11px;color:var(--text-2);line-height:1.55}' +
  '.cb2-race-trait b{color:var(--gold-l);font-weight:700}' +
  '.cb2-race-choice{margin-top:6px;border-top:1px dashed var(--border);padding-top:6px}' +
  '.cb2-race-choice .t{font-size:10px;color:var(--text-3);margin-bottom:4px}' +
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
  '.cb2-feat-chiprow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}' +
  '.cb2-feat-chip .cb2-feat-desc{flex:1 1 100%;min-width:100%;max-width:460px;font-size:10px;color:var(--text-3);line-height:1.6;padding:3px 2px 1px;font-weight:400;white-space:pre-wrap;overflow-wrap:break-word}' +
  '.cb2-feat-chip .rm{background:none;border:none;color:var(--text-3);cursor:pointer;font-size:12px;line-height:1;padding:0 0 0 2px}' +
  '.cb2-feat-chip .rm:hover{color:var(--red-l)}' +
  '.cb2-feat-add{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}' +
  '.cb2-step-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
  '@media(max-width:1000px){.cb2-step-row{grid-template-columns:1fr}}';

function roll4d6DropLowest() {
  var arr = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort(function (a, b) { return a - b; });
  return arr[1] + arr[2] + arr[3];
}
function roll4d6Detail() {
  var arr = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort(function (a, b) { return a - b; });
  return { dice: arr.slice(), kept: arr.slice(1), sum: arr[1] + arr[2] + arr[3] };
}
function rollScoreSetWithDetail() {
  var pool = [], detail = [];
  for (var i = 0; i < 6; i++) {
    var d = roll4d6Detail();
    detail.push(d);
    pool.push(d.sum);
  }
  return { pool: pool, scores: null, detail: detail };
}
function rollScorePool() {
  var pool = [];
  for (var i = 0; i < 6; i++) pool.push(roll4d6DropLowest());
  return pool;
}
function rollScoreSets(count) {
  var sets = [];
  for (var i = 0; i < count; i++) sets.push({ pool: rollScorePool(), scores: null });
  return sets;
}
function rollSetSum(rs) {
  return rs.pool.reduce(function (a, b) { return a + b; }, 0);
}
function defaultScores() { return { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }; }
function clampScore(v) { v = Math.round(Number(v) || 8); return Math.max(3, Math.min(20, v)); }
function pointbuyCost(scores) {
  var sum = 0;
  ABILITIES.forEach(function (a) {
    var v = clampScore(scores[a.key]);
    if (POINTBUY_COST[v] != null) sum += POINTBUY_COST[v];
  });
  return sum;
}
function inArray(arr, x) { return arr.indexOf(x) >= 0; }

  // ===== 4.1 initState：单一状态集中定义（新建/编辑共用，字段注释语义）=====
  function initState(editData) {
    var st = {
      name: editData ? editData.name || '' : '',
      race: editData && editData.race ? editData.race : '人类',
      raceChoices: (editData && editData.raceChoices) ? JSON.parse(JSON.stringify(editData.raceChoices)) : {}, // 种族可选项：{choiceKey: 选中值}
      raceFeatures: (editData && editData.raceFeatures) ? JSON.parse(JSON.stringify(editData.raceFeatures)) : null,
      cls: editData && editData.class && CLASS_HD[editData.class] ? editData.class : '法师',
      customClass: editData ? editData.customClass || '' : '',
      level: editData ? Math.max(1, Math.min(20, Number(editData.level) || 1)) : 1,
      background: editData ? editData.background || '' : '',
      bgApplied: (editData && editData.bgApplied) ? editData.bgApplied : null, // 背景属性加值（单一事实源=abilities）
      bgAttrMode: (editData && editData.bgAttrMode) || (editData && editData.bgApplied && editData.bgApplied.mode) || '21',
      bgAttrKeys: (editData && Array.isArray(editData.bgAttrKeys)) ? editData.bgAttrKeys.slice() : ((editData && editData.bgApplied && Array.isArray(editData.bgApplied.abilities)) ? editData.bgApplied.abilities.slice() : []),
      bgAttrPending: false,
      manualSaves: (editData && editData.manualSaves) ? editData.manualSaves : {}, // 手动勾选的豁免（切职业时保留）
      saveSources: (editData && editData.saveSources) ? JSON.parse(JSON.stringify(editData.saveSources)) : {}, // 豁免来源（职业·X / 自定义）
      bgEquip: (editData && editData.bgEquip) ? editData.bgEquip : '',          // 背景装备选项 'A'|'B'|''
      bgGold: (editData && editData.bgGold) ? Number(editData.bgGold) || 0 : 0, // 背景 B 选项金币
      bgEquipData: (editData && editData.bgEquipData) ? { A: editData.bgEquipData.A, B: editData.bgEquipData.B } : null, // 解析后的背景装备选项
      bgAppliedItems: (editData && editData.bgEquip === 'A' && editData.bgEquipData && editData.bgEquipData.A && editData.bgEquipData.A.items)
        ? editData.bgEquipData.A.items.map(function (it) { return it.name; }) : [], // 背景 A 套装加入的物品名（切换时移除）
      toolProfs: (editData && Array.isArray(editData.toolProfs)) ? editData.toolProfs.slice() : [], // 工具熟练
      skillSources: (editData && editData.skillSources) ? JSON.parse(JSON.stringify(editData.skillSources)) : {},
      toolSources: (editData && editData.toolSources) ? JSON.parse(JSON.stringify(editData.toolSources)) : {},
      customBg: (editData && editData.customBg) ? JSON.parse(JSON.stringify(editData.customBg)) : null, // 自定义背景配置
      ruleVersion: (editData && editData.ruleVersion) ? editData.ruleVersion : '2024',
      equipChoice: (editData && editData.equipChoice) ? editData.equipChoice : '', // 职业起始装备选项 A/B/C
      equipGold: (editData && editData.equipGold) ? Number(editData.equipGold) || 0 : 0, // 选项附带金币
      equipAppliedItems: [],                                                         // 最近一次选项加入的物品名
      equipPrices: null,       // 规则价格表 {名称: GP}（由 loadEquipData 一并加载）
      equipDetails: null,
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
      baseFixed: !!editData,               // 基础属性是否已固定（创建模式生成后固定；编辑模式默认固定）
      baseScores: (editData && editData.baseScores) ? Object.assign({}, editData.baseScores) : null, // 固定时的基础值快照 {str..cha}
      featAsi: (editData && editData.featAsi) ? JSON.parse(JSON.stringify(editData.featAsi)) : {}, // 专长属性提升 {专长名: {amount, options, allocation:{key:n}}}
      saves: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
      subclass: (editData && editData.subclass) || '',
      classChoices: (editData && editData.classChoices) ? JSON.parse(JSON.stringify(editData.classChoices)) : {},
      classChoiceDetails: (editData && editData.classChoiceDetails) ? JSON.parse(JSON.stringify(editData.classChoiceDetails)) : {},
      classGrowthChoices: (editData && editData.classGrowthChoices) ? JSON.parse(JSON.stringify(editData.classGrowthChoices)) : {},
      classFeatureDetails: (editData && editData.classFeatureDetails) ? JSON.parse(JSON.stringify(editData.classFeatureDetails)) : {},
      subclassChoices: (editData && editData.subclassChoices) ? JSON.parse(JSON.stringify(editData.subclassChoices)) : {},
      subclassChoiceDetails: (editData && editData.subclassChoiceDetails) ? JSON.parse(JSON.stringify(editData.subclassChoiceDetails)) : {},
      subclassFeatureDetails: (editData && editData.subclassFeatureDetails) ? JSON.parse(JSON.stringify(editData.subclassFeatureDetails)) : {},
      classProgression: null,
      classChoiceData: null,
      subclassRules: null,
      subclassChoiceData: null,
      classLevelTab: editData ? Math.max(1, Math.min(20, Number(editData.level) || 1)) : 1,
      trained: {},
      armor: editData && editData.armor ? editData.armor : '无甲',
      shield: !!(editData && editData.shield),
      spellList: [],
      items: [],
      features: editData && Array.isArray(editData.features) ? editData.features.slice() : [],
      bio: typeof (editData && editData.bio) === 'string' ? String(editData.bio) : Object.assign({ appearance: '', personality: '', ideals: '', bonds: '', flaws: '', backstory: '' }, (editData && editData.bio) || {}),
      assets: (editData && editData.assets) ? JSON.parse(JSON.stringify(editData.assets)) : null,
      spellData: null,
      featsFull: null,
      contentSources: (editData && editData.contentSources) ? Object.assign({ official: true, thirdParty: false }, editData.contentSources) : { official: true, thirdParty: false },
      equipData: null,
      flowType: 'guide',
      flowStep: 0
    };
    if (editData && editData.abilityScores) {
      ABILITIES.forEach(function (a) { if (editData.abilityScores[a.key] != null) st.scores[a.key] = clampScore(editData.abilityScores[a.key]); });
    }
    // 编辑模式：不保留基础快照，基础值动态计算（最终值 - 来源加成），用户改最终值后自动一致
    if (editData && !editData.baseScores) {
      st.baseScores = null;
    }
    if (editData && editData.savingThrows) {
      ABILITIES.forEach(function (a) { st.saves[a.key] = !!editData.savingThrows[a.key]; });
    }
    if (editData && editData.subclass) st.subclass = editData.subclass;
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
    if (!editData) {
      (SAVE_RECS[st.cls] || []).forEach(function (k) { st.saves[k] = true; });
      (CLASS_LV1_FEATURES[st.cls] || []).forEach(function (f) { if (st.features.indexOf(f) < 0) st.features.push(f); });
      if (RACE_SIZE[st.race]) st.size = RACE_SIZE[st.race];
      if (RACE_LANGS[st.race] && !st.languages) st.languages = RACE_LANGS[st.race];
    }
    if (!editData && st.mode === 'rolled') {
      st.rollSets = [];
      st.rollTimes = 0;
      st.rollPick = -1; // 层级1：先掷骰/选组
      st.rolledPool = [];
      st.pickedIdx = -1;
      ABILITIES.forEach(function (a) { st.scores[a.key] = null; });
    }
    return st;
  }

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

  // 状态单一事实源（4.1 initState）
  var st = initState(editData);

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
  var bgOptions = '<option value=""' + (!st.background ? ' selected' : '') + '>— 未选择背景 —</option>' +
    Object.keys(BACKGROUNDS).map(function (b) {
      return '<option value="' + esc(b) + '"' + (st.background === b ? ' selected' : '') + '>' + esc(b) + '</option>';
    }).join('') +
    (st.background && !BACKGROUNDS[st.background] && st.background !== '自定义背景'
      ? '<option value="' + esc(st.background) + '" selected>' + esc(st.background) + '（旧）</option>' : '') +
    '<option value="自定义背景"' + (st.background === '自定义背景' ? ' selected' : '') + '>自定义背景…</option>';

  function renderAbilityGrid() {
    var grid = $id('cb2c-ability-grid');
    if (!grid) return;
    var isRoll = st.mode === 'rolled';
    if (isRoll && st.rollPick < 0) {
      grid.innerHTML = '<div class="cb2-hint">👆 请先在上方 <b>5 组骰点</b> 中选择一组，再分配六项属性</div>';
      return;
    }
    var fixed = !!st.baseFixed;
    var baseScores = st.baseScores || (fixed ? computeBaseScores() : null);
    grid.innerHTML = ABILITIES.map(function (a) {
      var v = st.scores[a.key];
      var has = v != null;
      var md = abilityMod(has ? v : 8);
      var base = baseScores ? Number(baseScores[a.key]) : null;
      var chips = fixed ? asiChipsFor(a.key) : [];
      var slotHtml;
      if (fixed && !editData) {
        // 创建流程固定后：只读最终值 + 基础值 + 来源chips
        slotHtml = '<div class="cb2-ab-final" data-asi-drop="1" data-ability="' + a.key + '" title="' + (chips.length ? chips.map(function (c) { return c.label + ' +' + c.v; }).join('、') : '基础值 ' + base + '（可在下方来源面板拖动点数增加）') + '">' + (has ? v : '—') + (base != null ? '<i class="cb2-ab-base">基础 ' + base + '</i>' : '') + '</div>' +
          (chips.length ? '<div class="cb2-ab-chips">' + chips.map(function (c) { return '<span class="cb2-ab-chip" data-act="asi-unassign" data-src="' + esc(c.src) + '" data-key="' + a.key + '" title="点击移除该来源加值（仅移除本项，不影响其他加值）">' + esc(c.label) + ' +' + c.v + ' ✕</span>'; }).join('') + '</div>' : '');
      } else if (fixed && editData) {
        // 编辑模式：可直接修改数字，同时显示来源chips
        slotHtml = '<input type="number" class="cb2-in cb2-ab-input" id="cb2c-ab-' + a.key + '" min="3" max="20" value="' + (has ? v : 8) + '" title="最终属性值（含来源加值）">' +
          (chips.length ? '<div class="cb2-ab-chips">' + chips.map(function (c) { return '<span class="cb2-ab-chip" data-act="asi-unassign" data-src="' + esc(c.src) + '" data-key="' + a.key + '" title="点击移除该来源加值（仅移除本项，不影响其他加值）">' + esc(c.label) + ' +' + c.v + ' ✕</span>'; }).join('') + '</div>' : '');
      } else {
        slotHtml = isRoll
          ? '<button type="button" class="cb2-ab-slot' + (has ? ' filled' : '') + '" data-act="assign-ab" data-ab="' + a.key + '" data-drop="ab" data-ab-val="' + (has ? v : '') + '" title="' + (has ? '点击回收该值到骰池（也可拖回骰池）' : '把骰值拖到这里分配，或先点骰值再点这里') + '">' + (has ? v : '待分配') + '</button>'
          : '<input type="number" class="cb2-in cb2-ab-input" id="cb2c-ab-' + a.key + '" min="3" max="20" value="' + (has ? v : 8) + '">';
      }
      return '<div class="cb2-ab-item' + (has ? ' filled' : '') + '">' +
        '<div class="save-t"><label class="cb2-save" title="该属性豁免是否熟练"><input type="checkbox" data-save="' + a.key + '"' + (st.saves[a.key] ? ' checked' : '') + '>豁免</label></div>' +
        '<div class="nm">' + esc(a.name) + '<span class="sc-ab">' + a.short + '</span></div>' +
        slotHtml +
        '<div class="md' + (md < 0 ? ' neg' : '') + '" id="cb2c-ab-md-' + a.key + '">' + signed(md) + '</div>' +
        '</div>';
    }).join('');
  }

  function saveCurrentRollSet() {
    if (st.rollPick >= 0 && st.rollSets[st.rollPick]) {
      st.rollSets[st.rollPick].scores = Object.assign({}, st.scores);
      st.rollSets[st.rollPick].pool = st.rolledPool.slice();
    }
  }
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

  var skillGroupsHtml = ABILITIES.map(function (ab) {
    var rows = SKILLS.filter(function (s) { return s.ability === ab.name; }).map(function (s) {
      var t = st.trained[s.name] || '未熟练';
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

  function featDesc(f) {
    // 优先取已加载的详情记录（职业特性/子职业特性/成长选择），保证数值与效果完整
    var dt = st.subclassFeatureDetails && st.subclassFeatureDetails[f];
    if (dt && dt.desc) return dt.desc;
    var ct = st.classFeatureDetails && st.classFeatureDetails[f];
    if (ct && ct.desc) return ct.desc;
    var c2 = st.classChoiceDetails && st.classChoiceDetails[f];
    if (c2 && c2.desc) return c2.desc;
    var s2 = st.subclassChoiceDetails && st.subclassChoiceDetails[f];
    if (s2 && s2.desc) return s2.desc;
    // 选择槽前缀名回退（选择槽效果完整显示标准）：从 classChoiceData 的选项数据取完整效果（战斗风格：X 等）
    var slotM = String(f || '').match(/^(战斗风格|圣职|原初职能|超魔法|魔能祈唤)：(.+)$/);
    if (slotM && st.classChoiceData && st.classChoiceData.choices) {
      var keyMap = { '战斗风格': 'fightingStyle', '圣职': 'divineOrder', '原初职能': 'primalOrder', '超魔法': 'metamagic', '魔能祈唤': 'invocations' };
      var rec = st.classChoiceData.choices[keyMap[slotM[1]]];
      if (rec && Array.isArray(rec.options)) {
        for (var oi = 0; oi < rec.options.length; oi++) {
          if (rec.options[oi].name === slotM[2] && rec.options[oi].desc) return rec.options[oi].desc;
        }
      }
    }
    return lookupFeatDesc(f, st.cls);
  }
  function featSrcTag(f) {
    var name = String(f || '');
    if (st.subclass && name.indexOf(st.subclass + '·') === 0) return { tag: '副职·' + st.subclass, auto: true };
    if (name.indexOf('副职选择·') === 0) return { tag: '副职·' + (st.subclass || '选择'), auto: true };
    var raceHit = null;
    Object.keys(RACE_FEATURES).forEach(function (r) {
      if (raceHit) return;
      var rf = RACE_FEATURES[r];
      (rf.traits || []).forEach(function (t) { if (t.n === name) raceHit = r; });
    });
    if (raceHit) return { tag: '种族·' + raceHit, auto: true };
    if (name.indexOf('职业成长·') === 0) return { tag: '职业成长', auto: true };
    if (name && (CLASS_LV1_FEATURES[st.cls] || []).indexOf(name) >= 0) return { tag: '职业·' + st.cls, auto: true };
    var bgInfo2 = BACKGROUNDS[st.background];
    if (bgInfo2 && bgInfo2.feat === name) return { tag: '背景·' + st.background, auto: true };
    Object.keys(RACE_FEATURES).forEach(function (r) {
      if (raceHit) return;
      var rf = RACE_FEATURES[r];
      (rf.choices || []).forEach(function (ch) {
        if (raceHit) return;
        if (ch.kind === 'feat' && (st.raceChoices || {})[ch.key] === name) raceHit = r;
      });
    });
    if (raceHit) return { tag: '种族·' + raceHit, auto: true };
    if (st.classFeatureDetails && st.classFeatureDetails[name]) return { tag: '职业·' + st.cls, auto: true };
    if (st.subclassFeatureDetails && st.subclassFeatureDetails[name]) return { tag: '副职·' + st.subclass, auto: true };
    if (typeof window !== 'undefined' && window.__cbFeatsFull && window.__cbFeatsFull[name]) return { tag: '专长', auto: true };
    return { tag: '自定义', auto: false };
  }
  function featListHtml() {
    return st.features.map(function (f, i) {
      var src = featSrcTag(f);
      var dsc = featDesc(f);
      // 显示名：去除「职业成长·X级·专长：」前缀，直接显示专长/特性名
      var showName = String(f).replace(/^职业成长·\d+级·专长：/, '');
      if (window.TrpgTag && window.TrpgTag.chip) {
        var type = src.auto ? (src.tag.indexOf('种族') === 0 ? 'race' : (src.tag.indexOf('副职') === 0 ? 'subclass' : (src.tag.indexOf('背景') === 0 ? 'bg' : 'cls'))) : 'custom';
        return window.TrpgTag.chip({
          name: showName, type: type, source: src.tag,
          desc: dsc || f,
          title: showName,
          dataAct: 'feat-del', dataI: i, removable: true
        });
      }
      return '<span class="cb2-feat-chip" data-feat-name="' + esc(f) + '" data-feat-desc="' + encodeURIComponent(dsc || f) + '" title="' + esc(showName) + '">' + esc(showName) +
        '<span class="src' + (src.auto ? ' auto' : ' custom') + '">' + esc(src.tag) + '</span>' +
        '<button type="button" class="rm" data-act="feat-del" data-i="' + i + '">✕</button></span>';
    }).join('') || '<div class="cb2-hint">暂无特性 — 选择种族/职业/背景后自动添加，也可手动添加</div>';
  }
  function refreshFeatList() {
    var fl = $id('cb2c-feat-list');
    if (fl) fl.innerHTML = featListHtml();
  }
  var featHtml = featListHtml();

  var flowHtml = '';
  var STEPS = [
    ['基础信息', '姓名 / 立绘 / 阵营 / 体型 / 语言 / 外貌性格'],
    ['种族', '种族选择与默认特性（黑暗视觉/抗性/血系）'],
    ['职业', '职业选择 / 等级成长 / 子职业 / 专长或属性提升'],
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
    '<div class="cb2-sec" data-step="0">' +
    '<h4 class="cb2-sec-h">📋 基础信息</h4>' +
    '<div class="cb2-rulever" style="margin-bottom:10px"><span class="cb2-rulever-ic">📚</span>规则版本' +
    '<div class="cb2-rulever-sw">' +
    '<button type="button" class="cb2-rulever-btn' + (st.ruleVersion === '2024' ? ' on' : '') + '" data-act="rule-ver" data-v="2024" title="玩家手册2024：背景提供属性提升与起源专长，技能含专精">2024 玩家手册</button>' +
    '<button type="button" class="cb2-rulever-btn' + (st.ruleVersion === '2014' ? ' on' : '') + '" data-act="rule-ver" data-v="2014" title="玩家手册2014：背景不提供属性与专长，技能无专精">2014 玩家手册</button>' +
    '</div></div>' +
    '<div class="cb2-rulever-tip" id="cb2c-rulever-tip" style="margin-bottom:10px">' + (st.ruleVersion === '2024' ? '背景提供 3 项属性提升与 1 个起源专长' : '背景不提供属性提升与专长（2014 规则），技能无专精') + '</div>' +
    '<div class="cb2-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="cb2-field" style="flex:2;min-width:180px"><label>角色姓名 *</label>' +
    '<input type="text" class="cb2-in" id="cb2c-name" value="' + esc(st.name) + '" placeholder="如：阿拉贡·风行"></div>' +
    '<div class="cb2-field"><label>阵营</label><select class="cb2-in" id="cb2c-align" style="min-width:120px">' + alignOptions + '</select></div>' +
    '<div class="cb2-field"><label>体型</label><select class="cb2-in" id="cb2c-size" style="min-width:100px">' +
    ['微型', '小型', '中型', '大型', '巨型'].map(function (z) { return '<option' + (st.size === z ? ' selected' : '') + '>' + z + '</option>'; }).join('') + '</select></div>' +
    '<div class="cb2-field" style="flex:1;min-width:160px"><label>语言</label><input type="text" class="cb2-in" id="cb2c-lang" value="' + esc(st.languages) + '" placeholder="如：通用语、精灵语"></div>' +
    '</div>' +
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
    '<h4 class="cb2-sec-h" style="margin-top:12px">🧬 外貌与角色设定 <span class="cb2-sec-note">多行文本 · 可选</span></h4>' +
    (typeof st.bio === 'string'
      ? '<div class="cb2-edit-grid"><div class="cb2-field full"><label>角色设定（自由文本）</label>' +
        '<textarea rows="6" class="cb2-in cb2-ta" id="cb2c-bio-free" placeholder="写下角色的外貌、性格、经历与背景……">' + esc(st.bio) + '</textarea>' +
        '<div class="cb2-mini-label">此角色设定为自由文本格式，将原样保存。</div></div></div>'
      : '<div class="cb2-edit-grid">' +
        '<div class="cb2-field"><label>外貌</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-appearance" placeholder="如：银发灰眸，左颊有一道旧伤">' + esc(st.bio.appearance || '') + '</textarea></div>' +
        '<div class="cb2-field"><label>性格</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-personality" placeholder="如：沉着冷静，对弱者心怀怜悯">' + esc(st.bio.personality || '') + '</textarea></div>' +
        '<div class="cb2-field"><label>理想</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-ideals" placeholder="如：荣耀高于一切">' + esc(st.bio.ideals || '') + '</textarea></div>' +
        '<div class="cb2-field"><label>牵绊</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-bonds" placeholder="如：誓死保护同行的旅伴">' + esc(st.bio.bonds || '') + '</textarea></div>' +
        '<div class="cb2-field full"><label>缺陷</label><textarea rows="2" class="cb2-in cb2-ta" id="cb2c-bio-flaws" placeholder="如：无法拒绝求助之人">' + esc(st.bio.flaws || '') + '</textarea></div>' +
        '<div class="cb2-field full"><label>📖 背景故事（你的角色故事，区别于规则背景）</label>' +
        '<textarea rows="4" class="cb2-in cb2-ta" id="cb2c-bio-backstory" placeholder="写下你角色的过往、出身、旅途中的经历……">' + esc(st.bio.backstory || '') + '</textarea></div>' +
        '</div>') +
    '</div>' +
    '<div class="cb2-sec" data-step="1">' +
    '<h4 class="cb2-sec-h">🧝 种族 <span class="cb2-sec-note">默认特性自动生效</span></h4>' +
    '<div class="cb2-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="cb2-field"><label>种族</label><select class="cb2-in" id="cb2c-race" style="min-width:150px">' + raceOptions + '</select></div>' +
    '<div class="cb2-field"><label>&nbsp;</label><div class="cb2-mini-label">体型/语言已随种族自动填入基础信息</div></div>' +
    '</div>' +
    '<div id="cb2c-race-card"></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="2">' +
    '<h4 class="cb2-sec-h">⚔️ 职业 <span class="cb2-sec-note">按等级显示成长与选择项</span></h4>' +
    '<div class="cb2-row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="cb2-field"><label>职业</label><select class="cb2-in" id="cb2c-cls" style="min-width:150px">' + clsOptions + '</select></div>' +
    '<div class="cb2-field" id="cb2c-custom-cls-wrap" style="display:' + (st.cls === '自定义' ? '' : 'none') + '"><label>自定义职业名</label>' +
    '<input type="text" class="cb2-in" id="cb2c-custom-cls" value="' + esc(st.customClass) + '" placeholder="如：魔剑士" style="min-width:120px"></div>' +
    '<div class="cb2-field"><label>等级</label><input type="number" class="cb2-in cb2-in-sm" id="cb2c-level" min="1" max="20" value="' + st.level + '"></div>' +
    '</div>' +
    '<div id="cb2c-cls-features" style="margin-top:8px"></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="3">' +
    '<h4 class="cb2-sec-h">📜 背景 <span class="cb2-sec-note">属性提升 / 专长 / 技能 / 工具 / 装备</span></h4>' +
    '<div class="cb2-field" style="max-width:260px"><label>背景</label><select class="cb2-in" id="cb2c-bg">' + bgOptions + '</select></div>' +
    '<div class="cb2-bg-card" id="cb2c-bg-card"></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="4">' +
    '<h4 class="cb2-sec-h">⚡ ' + (editData ? '属性数值' : '属性生成') + ' <span class="cb2-sec-note" id="cb2c-mode-note"></span></h4>' +
    '<div class="cb2-bonus-bar" id="cb2c-bonus" style="display:none"></div>' +
    (editData ? '' : '<div class="cb2-bonus-bar" id="cb2c-base-fix-bar" style="display:none">✔ <b>基础属性已固定</b>：下方 6 项为生成的基础值。外部来源（职业等级 / 背景 / 专长）的属性提升请在本页「属性提升来源」中拖动点数分配。</div>') +
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
    '<div class="cb2-row" style="margin-top:8px" id="cb2c-base-fix-wrap"></div>' +
    '</div>' +
    '<div>' +
    '<h4 class="cb2-sec-h" style="margin:0 0 6px">🛡️ 豁免与战斗</h4>' +
    '<div class="cb2-hint" style="margin-bottom:6px">豁免熟练由职业自动赋予，可手动勾选。</div>' +
    '<div class="cb2-save-grid" id="cb2c-saves"></div>' +
    '<div class="cb2-derived" id="cb2c-derived"></div>' +
    '<div id="cb2c-bg-attr-panel"></div>' +
    '</div>' +
    '</div>' +
    '<div id="cb2c-asi-panel"></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="5">' +
    '<h4 class="cb2-sec-h">🎓 技能熟练 <span class="cb2-sec-note">' + SKILLS.length + ' 项 · 按属性分组</span></h4>' +
    '<div class="cb2-hint">熟练 +' + 'PB' + '（熟练加值），专精 +PB×2。职业与背景自动勾选并标注来源。</div>' +
    '<div id="cb2c-skill-quota"></div>' +
    '<div class="cb2-skill-groups" id="cb2c-skill-groups">' + skillRows + '</div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="6" id="cb2c-spell-sec">' +
    '<h4 class="cb2-sec-h">🔮 法术 <span class="cb2-sec-note" id="cb2c-spell-count">读取中…</span></h4>' +
    '<div id="cb2c-spell-body"><div class="cb2-loading">⏳ 正在从规则书加载职业法术表…</div></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="7" id="cb2c-equip-sec">' +
    '<h4 class="cb2-sec-h">🎒 ' + (editData ? '背包与装备' : '起始装备') + ' <span class="cb2-sec-note" id="cb2c-item-count">读取中…</span></h4>' +
    '<div class="cb2-hint">' + (editData ? '管理现有背包、数量、装备状态与后续购入物品。护甲只能从背包中已有护甲选择，并实时更新 AC。' : '护甲取决于角色拥有的护甲（职业起始装备/背景赠送），随装备自动联动。') + '</div>' +
    '<div id="cb2c-equip-body"><div class="cb2-loading">⏳ 正在从规则书加载装备表…</div></div>' +
    '</div>' +
    '<div class="cb2-sec" data-step="8" id="cb2c-feat-sec">' +
    '<h4 class="cb2-sec-h">⭐ 特性 <span class="cb2-sec-note">种族 / 职业 / 背景 / 自定义 标签化</span></h4>' +
    '<div class="cb2-hint">职业成长、背景起源专长与手动特性统一生成标签，悬停查看完整规则。</div>' +
    '<div class="cb2-feat-chiprow" id="cb2c-feat-list"></div>' +
    '<div class="cb2-feat-add">' +
    '<input type="text" class="cb2-in" id="cb2c-feat-input" placeholder="如：精灵之优雅、初阶魔导" style="flex:1;min-width:180px">' +
    '<button type="button" class="cb2-btn gold sm" data-act="feat-add">＋ 添加特性</button>' +
    '</div></div>' +
    '</div>';

  container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
    sec.setAttribute('data-orig-display', sec.style.display || '');
  });

  function $id(id) { return container.querySelector('#' + id); }
  function setText(id, txt) { var el = $id(id); if (el) el.textContent = txt; }

  function raceChoiceDesc(race, key, val) {
    if (!val) return '';
    var info = RACE_FEATURES[race];
    if (!info || !info.choices) return '';
    for (var i = 0; i < info.choices.length; i++) {
      if (info.choices[i].key === key) {
        var opts = info.choices[i].options || [];
        for (var j = 0; j < opts.length; j++) {
          if (opts[j].v === val) {
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
  function removeFeatIfUnused(name) {
    if (!name) return;
    var bgInfo = BACKGROUNDS[st.background];
    if (bgInfo && bgInfo.feat === name) return;
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
  function applyRaceChoice(key, val) {
    var r = st.race;
    var info = RACE_FEATURES[r];
    var ch = null;
    (info && info.choices || []).forEach(function (c) { if (c.key === key) ch = c; });
    if (!ch) return;
    var oldVal = st.raceChoices[key];
    if (oldVal) {
      st.raceChoices[key] = '';
      if (ch.kind === 'feat') {
        removeFeatIfUnused(oldVal);
      } else if (ch.kind === 'skill') {
        removeSkillSource(oldVal, '种族·' + r);
      }
    }
    st.raceChoices[key] = val || '';
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
    if (ch.kind === 'skill') {
      var skSel = container.querySelector('[data-sk-sel="' + val + '"]');
      if (skSel) skSel.value = '熟练';
      if (oldVal && oldVal !== val) {
        var skSelOld = container.querySelector('[data-sk-sel="' + oldVal + '"]');
        if (skSelOld) skSelOld.value = st.trained[oldVal] || '未熟练';
      }
    }
  }
  function clearRaceChoices(oldRace) {
    var info = RACE_FEATURES[oldRace];
    if (!info || !info.choices) return;
    info.choices.forEach(function (ch) {
      var oldVal = st.raceChoices[ch.key];
      if (!oldVal) return;
      st.raceChoices[ch.key] = '';
      if (ch.kind === 'feat') {
        removeFeatIfUnused(oldVal);
      } else if (ch.kind === 'skill') {
        removeSkillSource(oldVal, '种族·' + oldRace);
      }
    });
    st.raceChoices = {};
  }
  function adaptiveRuleTrait(title, desc, extra) {
    return '<div class="cb2-race-trait"><b>' + esc(title) + '。</b>' + esc(desc || '') + (extra || '') + '</div>';
  }
  function adaptiveRuleChoice(label, controlHtml, detailHtml, meta) {
    return '<div class="cb2-race-choice"><div class="t">☑ ' + esc(label) + (meta ? '<span class="cb2-mini-label" style="float:right">' + esc(meta) + '</span>' : '') + '</div>' +
      '<div class="cb2-row" style="gap:6px;align-items:flex-start;flex-wrap:wrap">' + controlHtml +
      (detailHtml ? '<span class="cb2-race-trait" style="border-left-color:var(--green);flex:1;min-width:170px">' + detailHtml + '</span>' : '') +
      '</div></div>';
  }
  function adaptiveRuleCard(icon, title, badge, metaHtml, traitsHtml, choicesHtml) {
    return '<div class="cb2-race-card"><div class="cb2-race-head">' + icon + ' ' + esc(title) + ' <span class="cb2-bg-card-tag">' + esc(badge) + '</span></div>' +
      (metaHtml ? '<div class="cb2-race-meta">' + metaHtml + '</div>' : '') +
      (traitsHtml ? '<div class="cb2-race-traits">' + traitsHtml + '</div>' : '') +
      (choicesHtml || '') + '</div>';
  }
  function progressionTabs(selected, current) {
    var out = '';
    for (var i = 1; i <= 20; i++) {
      var state = i === selected ? ' gold' : '';
      var op = i <= current ? '1' : '.48';
      out += '<button type="button" class="cb2-btn sm' + state + '" data-act="class-level-tab" data-level="' + i + '" style="min-width:34px;padding:5px 7px;opacity:' + op + '">' + i + '</button>';
    }
    return out;
  }
  function orderedUnique(list) {
    var out = [];
    (list || []).forEach(function (v) { if (v && out.indexOf(v) < 0) out.push(v); });
    return out;
  }
  function classGrowthPrefix(level) { return '职业成长·' + level + '级·'; }
  function featureIsClassPlaceholder(name) {
    return /^(属性值提升|属性提升|专长|副职|子职|子职特性|副职特性|子职业)$/.test(String(name || '').trim());
  }
  function growthKindsFor(features) {
    var hasAsi = false, hasFeat = false;
    (features || []).forEach(function (name) {
      var v = String(name || '');
      if (/属性值?提升|属性提升/.test(v)) hasAsi = true;
      if (/^专长$|专长选择|史诗恩惠/.test(v)) hasFeat = true;
    });
    return { ability: hasAsi, feat: hasFeat || hasAsi };
  }
  function generalFeatNames(level) {
    var names = Object.keys(ORIGIN_FEATS || {});
    var full = st.featsFull || (typeof window !== 'undefined' ? window.__cbFeatsFull : null) || {};
    Object.keys(full).forEach(function (name) {
      var rec = full[name] || {};
      if (!sourceAllowed(rec)) return;
      if (Number(level) < 19 && /传奇恩惠|Epic Boon|史诗恩惠/.test(String(rec.desc || '') + String(rec.source || ''))) return;
      names.push(name);
    });
    ['属性值提升', '运动健将', '冲锋', '防御式决斗', '双持客', '巨武器大师', '幸运', '凶蛮打手', '哨兵', '神射手', '战地施法者', '法术狙击', '坚韧', '武器大师', '熟习', '治疗师', '元素专家', '战斗先机'].forEach(function (n) { names.push(n); });
    return orderedUnique(names).sort(function (a, b) { return a.localeCompare(b, 'zh'); });
  }
  function classGrowthSummary(c) {
    if (!c || !c.type) return '待选择';
    if (c.type === 'feat') return c.feat ? ('选择专长：' + c.feat) : '选择专长：待选择';
    var allocation = c.allocation || {};
    if (!Object.keys(allocation).length) {
      var attrs = validGrowthAttrs(c);
      var slots = growthSlotsForMode(c.mode === '111' ? '111' : '21');
      attrs.forEach(function (k, i) { if (slots[i]) allocation[k] = (allocation[k] || 0) + slots[i].v; });
    }
    var parts = ABILITIES.map(function (a) { return allocation[a.key] ? a.name + ' +' + allocation[a.key] : ''; }).filter(Boolean);
    return parts.length ? parts.join('、') : '属性提升：待分配';
  }
  function clearClassGrowthEffects(level) {
    var key = String(level);
    var c = st.classGrowthChoices && st.classGrowthChoices[key];
    if (c && c.before) {
      ABILITIES.forEach(function (a) {
        if (c.before[a.key] != null) st.scores[a.key] = Number(c.before[a.key]);
      });
      delete c.before;
      delete c.after;
      delete c.allocation;
    }
    var pre = classGrowthPrefix(level);
    st.features = (st.features || []).filter(function (f) { return String(f).indexOf(pre) !== 0; });
    if (st.classFeatureDetails) {
      Object.keys(st.classFeatureDetails).forEach(function (name) { if (String(name).indexOf(pre) === 0) delete st.classFeatureDetails[name]; });
    }
  }
  function abilityKeyOf(v) {
    if (!v) return '';
    if (ABILITIES.some(function (a) { return a.key === v; })) return v;
    return BG_ABILITY_KEY[v] || '';
  }
  function validGrowthAttrs(c) {
    // 槽位位置语义：保持与 slots 等长且保留空位（''），禁止紧凑化导致 +2/+1 槽位漂移；
    // 禁止用 allocation 展开（曾导致重复加点膨胀）
    var raw = Array.isArray(c && c.attrs) ? c.attrs.slice() : [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var k = abilityKeyOf(raw[i]);
      out.push(ABILITIES.some(function (a) { return a.key === k; }) ? k : '');
    }
    return out;
  }
  function growthSlotsForMode(mode) { return mode === '111' ? [{ v: 1 }, { v: 1 }, { v: 1 }] : [{ v: 2 }, { v: 1 }]; }
  function applyClassGrowth(level) {
    var key = String(level);
    if (!st.classGrowthChoices) st.classGrowthChoices = {};
    var c = st.classGrowthChoices[key];
    clearClassGrowthEffects(level);
    if (!c || Number(level) > Number(st.level || 1)) return;
    if (c.type === 'feat') {
      if (c.feat) {
        var featName = classGrowthPrefix(level) + '专长：' + c.feat;
        st.features.push(featName);
        st.classFeatureDetails = st.classFeatureDetails || {};
        st.classFeatureDetails[featName] = { level: Number(level), desc: lookupFeatDesc(featName, st.cls) || c.feat, source: classRuleSource(st.cls) };
      }
      return;
    }
    if (c.type !== 'ability') return;
    currentScores();
    if (!c.before) {
      c.before = {};
      ABILITIES.forEach(function (a) { c.before[a.key] = st.scores[a.key]; });
    }
    var attrs = validGrowthAttrs(c);
    var mode = c.mode === '111' ? '111' : '21';
    var slots = growthSlotsForMode(mode);
    if (attrs.length < slots.length) return;
    var allocation = {};
    slots.forEach(function (slot, i) { var k = attrs[i]; if (k) allocation[k] = (allocation[k] || 0) + slot.v; });
    Object.keys(allocation).forEach(function (k) { st.scores[k] = clampScore(Number(st.scores[k] || 8) + allocation[k]); });
    c.allocation = allocation;
    c.after = {};
    ABILITIES.forEach(function (a) { c.after[a.key] = st.scores[a.key]; });
    var growthName = classGrowthPrefix(level) + '属性提升：' + classGrowthSummary(c);
    st.features.push(growthName);
    st.classFeatureDetails = st.classFeatureDetails || {};
    st.classFeatureDetails[growthName] = { level: Number(level), desc: lookupFeatDesc(growthName, st.cls), source: classRuleSource(st.cls) };
  }
  function syncClassGrowthChoices() {
    st.classGrowthChoices = st.classGrowthChoices || {};
    Object.keys(st.classGrowthChoices).forEach(function (lv) { applyClassGrowth(Number(lv)); });
    ABILITIES.forEach(function (a) {
      var iEl = $id('cb2c-ab-' + a.key);
      if (iEl && st.scores[a.key] != null) iEl.value = st.scores[a.key];
    });
  }
  function setClassGrowthType(level, type) {
    var key = String(level);
    st.classGrowthChoices = st.classGrowthChoices || {};
    clearClassGrowthEffects(level);
    st.classGrowthChoices[key] = type ? { type: type, mode: '21', attrs: [], allocation: {}, feat: '' } : null;
    if (!type) delete st.classGrowthChoices[key];
    applyClassGrowth(level);
    renderAbilityGrid();
    updateDerived();
    refreshFeatList();
    renderClsFeatHint();
  }
  function setClassGrowthAttr(level, slot, value) {
    var key = String(level);
    var c = st.classGrowthChoices[key] || (st.classGrowthChoices[key] = { type: 'ability', mode: '21', attrs: [], allocation: {}, feat: '' });
    var idx = Number(slot) || 0;
    var val = abilityKeyOf(value || '');
    c.type = 'ability';
    c.attrs = Array.isArray(c.attrs) ? c.attrs.slice() : [];
    var slots = growthSlotsForMode(c.mode === '111' ? '111' : '21');
    if (idx >= slots.length) return;
    if (val && c.attrs.some(function (x, i) { return i !== idx && abilityKeyOf(x) === val; })) {
      c.attrs = c.attrs.map(function (x, i) { return i === idx ? val : (abilityKeyOf(x) === val ? '' : x); });
    } else if (val) c.attrs[idx] = val;
    else c.attrs[idx] = '';
    // 保持槽位位置语义：只截断不紧凑（移除中间槽后，剩余属性仍留在原 +1 槽，不会被提升到 +2 槽）
    c.attrs = c.attrs.slice(0, slots.length);
    applyClassGrowth(level);
    renderAbilityGrid();
    updateDerived();
    refreshFeatList();
    renderClsFeatHint();
  }
  function setClassGrowthMode(level, mode) {
    var key = String(level);
    var c = st.classGrowthChoices[key] || (st.classGrowthChoices[key] = { type: 'ability', mode: '21', attrs: [], feat: '' });
    c.type = 'ability';
    c.mode = mode === '111' ? '111' : '21';
    c.attrs = validGrowthAttrs(c).slice(0, growthSlotsForMode(c.mode).length);
    applyClassGrowth(level);
    renderAbilityGrid();
    updateDerived();
    refreshFeatList();
    renderClsFeatHint();
  }
  function setClassGrowthFeat(level, feat) {
    var key = String(level);
    var c = st.classGrowthChoices[key] || (st.classGrowthChoices[key] = { type: 'feat', mode: '21', attrs: [], feat: '' });
    clearClassGrowthEffects(level);
    c.type = 'feat';
    c.feat = feat || '';
    applyClassGrowth(level);
    if (feat) ensureFeatAsi(feat, true); // 用户主动选择专长：其属性提升写入统一来源
    updateDerived();
    refreshFeatList();
    renderClsFeatHint();
  }
  function growthTokenHtml(level, slot, value, assigned) {
    return '<div class="cb2-growth-token' + (assigned ? ' used' : '') + '" draggable="true" data-act="class-growth-token" data-level="' + level + '" data-slot="' + slot + '">+' + value + '</div>';
  }
  function renderGrowthBoard(level, c) {
    var mode = c.mode === '111' ? '111' : '21';
    var attrs = validGrowthAttrs(c).slice(0, growthSlotsForMode(mode).length);
    c.attrs = attrs.slice();
    var slots = growthSlotsForMode(mode);
    var tokenRow = '<div class="cb2-growth-tokens">' + slots.map(function (slot, i) { return growthTokenHtml(level, i, slot.v, !!attrs[i]); }).join('') + '</div>';
    var targetRow = '<div class="cb2-growth-targets">' + ABILITIES.map(function (a) {
      var adds = slots.map(function (slot, i) {
        return attrs[i] === a.key ? '<span class="cb2-growth-add" data-act="class-growth-unassign" data-level="' + level + '" data-slot="' + i + '">+' + slot.v + '</span>' : '';
      }).join('');
      return '<div class="cb2-growth-abil" data-act="class-growth-target" data-level="' + level + '" data-ability="' + a.key + '"><div class="n">' + esc(a.name) + '</div><div class="v">' + esc(String(st.scores[a.key] == null ? '—' : st.scores[a.key])) + '</div><div class="adds">' + adds + '</div></div>';
    }).join('') + '</div>';
    return '<div class="cb2-growth-board"><div>' + tokenRow + '</div>' + targetRow + '</div><div class="cb2-hint" style="margin-top:6px">' + esc(classGrowthSummary(c)) + '</div>';
  }
  function renderClassGrowthChoice(level, features, current) {
    var kinds = growthKindsFor(features);
    if (ASI_LEVELS[level]) { kinds.ability = true; kinds.feat = true; }
    if (!kinds.ability && !kinds.feat) return '';
    var disabled = Number(level) > Number(current);
    var c = (st.classGrowthChoices || {})[String(level)] || {};
    var typeControls = '<div class="cb2-attr-plan-row" style="margin:0;flex:1">' +
      (kinds.ability ? '<div class="cb2-attr-plan' + (c.type === 'ability' ? ' on' : '') + '" data-act="class-growth-type" data-level="' + level + '" data-type="ability"><div class="cb2-attr-plan-t">属性提升</div><div class="cb2-attr-plan-v">拖动点数到属性</div></div>' : '') +
      (kinds.feat ? '<div class="cb2-attr-plan' + (c.type === 'feat' ? ' on' : '') + '" data-act="class-growth-type" data-level="' + level + '" data-type="feat"><div class="cb2-attr-plan-t">专长</div><div class="cb2-attr-plan-v">选择具体专长</div></div>' : '') +
      '</div>';
    if (disabled) return adaptiveRuleChoice(level + '级成长选择', typeControls, '', '');
    var detail = '';
    if (c.type === 'ability') {
      var mode = c.mode === '111' ? '111' : '21';
      detail = '<div class="cb2-row" style="gap:7px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
        '<button type="button" class="cb2-btn sm' + (mode === '21' ? ' gold' : '') + '" data-act="class-growth-mode-btn" data-level="' + level + '" data-mode="21">+2 / +1</button>' +
        '<button type="button" class="cb2-btn sm' + (mode === '111' ? ' gold' : '') + '" data-act="class-growth-mode-btn" data-level="' + level + '" data-mode="111">三项 +1</button>' +
        '<span class="cb2-mini-label" style="margin:0">分配请在「属性」页「属性提升来源」中拖动点数到属性</span>' +
        '</div>' + (classGrowthSummary(c) !== '属性提升：待分配' ? '<div class="cb2-hint" style="margin-top:6px">当前分配：' + esc(classGrowthSummary(c)) + '</div>' : '');
    } else if (c.type === 'feat') {
      var opts = generalFeatNames(level);
      var featInfo = c.feat ? ((st.featsFull && st.featsFull[c.feat]) || (typeof window !== 'undefined' && window.__cbFeatsFull && window.__cbFeatsFull[c.feat]) || null) : null;
      var featDescTxt = c.feat ? (lookupFeatDesc(c.feat, st.cls) || c.feat) : '';
      // 固定结构：专长标题 + 固定框候选（常驻）+ 效果描述块（常驻，选择前显示占位、选择后填充效果，块高度恒定不跳版）
      detail = '<div class="cb2-feat-picker">' +
        '<div class="cb2-feat-picker-t">专长</div>' +
        '<input type="text" class="cb2-in cb2-feat-filter" data-class-growth-feat-input="' + level + '" value="' + esc(c.feat || '') + '" placeholder="输入名称筛选…" autocomplete="off" data-cand-pool="' + esc(encodeURIComponent(JSON.stringify(opts.slice(0, 300)))) + '">' +
        '<div class="cb2-feat-list" data-class-growth-feat-cands="' + level + '">' +
        opts.map(function (name) {
          var selCls = c.feat === name ? ' on' : '';
          return '<button type="button" class="cb2-feat-item' + selCls + '" data-act="feat-cand-pick" data-level="' + level + '" data-name="' + esc(name) + '" title="' + esc(lookupFeatDesc(name, st.cls) || name) + '">' + esc(name) + '</button>';
        }).join('') +
        '</div>' +
        '<div class="cb2-feat-desc">' +
        (c.feat
          ? '<b>' + esc(c.feat) + '。</b>' + esc(featDescTxt) + (featInfo && featInfo.source ? '<div class="cb2-mini-label" style="margin-top:4px">来源：' + esc(featInfo.source) + '</div>' : '')
          : '<span class="cb2-mini-label" style="margin:0">尚未选择专长 — 点击上方候选项后，这里显示该专长的完整效果</span>') +
        '</div>' +
        '</div>';
    }
    return adaptiveRuleChoice(level + '级成长选择', typeControls + detail, '', c.type ? classGrowthSummary(c) : '待选择');
  }
  function optionSlotSelects(kind, key, selected, count, options) {
    selected = Array.isArray(selected) ? selected : [];
    options = options || [];
    var label = kind === 'subclass' ? 'data-subclass-choice-slot' : 'data-class-choice-slot';
    var row = '<div class="cb2-row" style="gap:7px;flex-wrap:wrap;align-items:end">';
    for (var i = 0; i < count; i++) {
      var cur = selected[i] || '';
      row += '<label class="cb2-mini-label">槽位 ' + (i + 1) + '</label><select class="cb2-in" ' + label + '="' + esc(key) + '" data-slot="' + i + '" style="max-width:240px"><option value="">— 未选择 —</option>' +
        options.map(function (opt) {
          var used = selected.indexOf(opt.name) >= 0 && cur !== opt.name;
          return '<option value="' + esc(opt.name) + '"' + (cur === opt.name ? ' selected' : '') + (used ? ' disabled' : '') + '>' + esc(opt.name) + '</option>';
        }).join('') + '</select>';
    }
    return row + '</div>';
  }
  function selectedOptionDetails(selected, options, fallbackSource) {
    if (!selected || !selected.length) return '';
    var by = {};
    (options || []).forEach(function (opt) { by[opt.name] = opt; });
    return selected.map(function (name) {
      var opt = by[name] || { name: name, desc: name, source: fallbackSource };
      var src = opt.source ? '<div class="cb2-mini-label" style="margin-top:4px">来源：' + esc(opt.source) + '</div>' : '';
      return adaptiveRuleTrait(name, opt.desc || name, src);
    }).join('');
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
    var metaHtml = '<span class="cb2-tag">生物类型：' + esc(info.type) + '</span>' +
      '<span class="cb2-tag">体型：' + esc(info.size) + '</span>' +
      '<span class="cb2-tag">速度：' + esc(info.speed) + '</span>' +
      '<span class="cb2-tag">语言：' + esc(RACE_LANGS[r] || '通用语') + '</span>';
    var traitsHtml = (info.traits || []).map(function (t) {
      var dyn = '';
      if (r === '龙裔' && t.n === '伤害抗性' && st.raceChoices.dragon) {
        var dInfo = raceChoiceDesc(r, 'dragon', st.raceChoices.dragon);
        var dm = String(dInfo || '').match(/获得(.+?)抗性/);
        dyn = '<b style="color:var(--green-l)"> → 已选' + esc(st.raceChoices.dragon) + (dm ? '：获得' + esc(dm[1]) + '抗性' : '') + '</b>';
      }
      return adaptiveRuleTrait(t.n, t.d, dyn);
    }).join('');
    var choicesHtml = (info.choices || []).map(function (ch) {
      var cur = st.raceChoices[ch.key];
      var sel = '<select class="cb2-in" data-race-choice="' + esc(ch.key) + '" style="max-width:230px"><option value="">— 选择' + esc(ch.n) + ' —</option>' +
        (ch.options || []).map(function (o) { return '<option value="' + esc(o.v) + '"' + (cur === o.v ? ' selected' : '') + '>' + esc(o.v) + '</option>'; }).join('') + '</select>';
      return adaptiveRuleChoice(ch.n, sel, cur ? esc(raceChoiceDesc(r, ch.key, cur)) : '', cur ? '已应用' : '待选择');
    }).join('');
    var html = adaptiveRuleCard('🧝', r, '种族特性', metaHtml, traitsHtml, choicesHtml);
    card.innerHTML = html;
  }

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
  function bgEquipItemsText(items) {
    if (!items || !items.length) return '';
    return items.map(function (it) {
      return it.name + (it.quantity > 1 ? ' ×' + it.quantity : '');
    }).join('、');
  }
  function bgAllowedAbilities() {
    var info = BACKGROUNDS[st.background];
    if (info && Array.isArray(info.abilities)) return info.abilities.slice();
    if (st.background === '自定义背景') return ABILITIES.map(function (a) { return a.name; });
    return [];
  }
  function normalizedBgAttrKeys(mode, keys) {
    var allow = bgAllowedAbilities();
    var need = mode === '111' ? 3 : 2;
    var out = [];
    (keys || []).forEach(function (n) { if (n && allow.indexOf(n) >= 0 && out.indexOf(n) < 0) out.push(n); });
    allow.forEach(function (n) { if (out.length < need && out.indexOf(n) < 0) out.push(n); });
    return out.slice(0, need);
  }
  function applyBgAttr(mode, abilityList) {
    if (!mode) {
      currentScores();
      if (st.bgApplied && st.bgApplied.before) {
        ABILITIES.forEach(function (a) {
          var before = st.bgApplied.before[a.key];
          if (before != null) st.scores[a.key] = before;
        });
      }
      st.bgApplied = null;
      st.bgAttrPending = false;
      ABILITIES.forEach(function (a) {
        var iEl = $id('cb2c-ab-' + a.key);
        if (iEl && st.scores[a.key] != null) iEl.value = st.scores[a.key];
      });
      renderAbilityGrid();
      updateDerived();
      renderBgCard();
      return;
    }
    // 固定模式：保留空槽（未分配的槽不应用），不允许自动填满；未固定模式：自动补全默认候选
    var list;
    if (st.baseFixed) {
      var allow0 = bgAllowedAbilities();
      var srcKeys0 = Array.isArray(abilityList) ? abilityList.slice() : (st.bgAttrKeys || []).slice();
      list = [];
      for (var bi = 0; bi < (mode === '111' ? 3 : 2); bi++) {
        var bv = srcKeys0[bi] || '';
        list.push(allow0.indexOf(bv) >= 0 ? bv : '');
      }
    } else {
      list = normalizedBgAttrKeys(mode, abilityList || st.bgAttrKeys);
    }
    if (!list.length) return;
    currentScores();
    if (st.mode === 'rolled' && !st.baseFixed) {
      var hasNull = ABILITIES.some(function (a) { return st.scores[a.key] == null; });
      if (hasNull) {
        st.bgAttrPending = true;
        st.bgAttrMode = mode;
        st.bgAttrKeys = list.slice();
        return;
      }
    }
    st.bgAttrPending = false;
    if (st.bgApplied && st.bgApplied.before) {
      ABILITIES.forEach(function (a) {
        var before = st.bgApplied.before[a.key];
        if (before != null) st.scores[a.key] = before;
      });
    }
    var before = {};
    ABILITIES.forEach(function (a) { before[a.key] = st.scores[a.key]; });
    var allocation = {};
    if (mode === '21') {
      var pKey = list[0] ? BG_ABILITY_KEY[list[0]] : null, sKey = list[1] ? BG_ABILITY_KEY[list[1]] : null;
      if (pKey && st.scores[pKey] != null) { st.scores[pKey] = clampScore(Number(st.scores[pKey]) + 2); allocation[pKey] = 2; }
      if (sKey && st.scores[sKey] != null) { st.scores[sKey] = clampScore(Number(st.scores[sKey]) + 1); allocation[sKey] = (allocation[sKey] || 0) + 1; }
    } else {
      list.forEach(function (n) {
        var k = n ? BG_ABILITY_KEY[n] : null;
        if (k && st.scores[k] != null) { st.scores[k] = clampScore(Number(st.scores[k]) + 1); allocation[k] = (allocation[k] || 0) + 1; }
      });
    }
    var after = {};
    ABILITIES.forEach(function (a) { after[a.key] = st.scores[a.key]; });
    st.bgAttrMode = mode;
    st.bgAttrKeys = list.slice();
    if (st.customBg) { st.customBg.attr = mode; st.customBg.attrKeys = list.slice(); }
    st.bgApplied = { mode: mode, before: before, allocation: allocation, after: after, abilities: list.slice() };
    ABILITIES.forEach(function (a) {
      var iEl = $id('cb2c-ab-' + a.key);
      if (iEl && st.scores[a.key] != null) iEl.value = st.scores[a.key];
    });
    renderAbilityGrid();
    updateDerived();
    renderBgCard();
  }
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
  function profUsed() {
    var n = 0;
    SKILLS.forEach(function (s) { if (st.trained[s.name] && st.trained[s.name] !== '未熟练') n++; });
    return n;
  }
  function clsProfUsed() {
    var n = 0;
    Object.keys(st.skillSources || {}).forEach(function (k) {
      (st.skillSources[k] || []).forEach(function (src) { if (src === '职业·' + st.cls) n++; });
    });
    return n;
  }
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
    if (oldCls && oldCls !== '自定义') {
      var oldSkills = SKILL_RECS[oldCls] || [];
      oldSkills.forEach(function (n) { removeSkillSource(n, '职业·' + oldCls); });
      var oldTools = (CLASS_TOOL_CHOICE[oldCls] ? st.toolProfs.slice() : []);
      oldTools.forEach(function (t) {
        var isClsTool = (CLASS_TOOL_CHOICE[oldCls] || []).some(function (c) { return TOOL_LISTS[c].indexOf(t) >= 0; });
        if (isClsTool) removeToolSource(t, '职业·' + oldCls);
      });
      st.saves = st.saves || {};
      st.manualSaves = st.manualSaves || {};
      st.saveSources = st.saveSources || {};
      (SAVE_RECS[oldCls] || []).forEach(function (k) {
        if (!st.manualSaves[k]) {
          st.saves[k] = false;
          if (st.saveSources[k]) st.saveSources[k] = st.saveSources[k].filter(function (x) { return x !== '职业·' + oldCls; });
        }
      });
    }
    st.cls = cls;
    if (cls !== '自定义') {
      st.saves = st.saves || {};
      st.manualSaves = st.manualSaves || {};
      st.saveSources = st.saveSources || {};
      (SAVE_RECS[cls] || []).forEach(function (k) {
        if (st.saves[k] || st.manualSaves[k]) { st.saves[k] = true; return; }
        st.saves[k] = true;
        if (!st.manualSaves[k] && (!st.saveSources[k] || st.saveSources[k].indexOf('职业·' + cls) < 0)) {
          st.saveSources[k] = st.saveSources[k] || [];
          st.saveSources[k].push('职业·' + cls);
        }
      });
    }
    renderSkillQuota();
    renderSkillRows();
  }
  function classRuleSource(cls) {
    var rec = st.classProgression && st.classProgression.classes && st.classProgression.classes[cls];
    return rec && rec.source ? rec.source : ('玩家手册2024/角色职业/' + cls + '/' + cls + '.htm');
  }
  function classFeatureRows(cls, level) {
    var rec = st.classProgression && st.classProgression.classes && st.classProgression.classes[cls];
    var row = rec && rec.levels && rec.levels[String(level)];
    return row && Array.isArray(row.features) ? row.features.slice() : ((CLASS_FEATURES_BY_LEVEL[cls] && CLASS_FEATURES_BY_LEVEL[cls][level]) || []).slice();
  }
  function classFeatureDetail(cls, name) {
    var rec = st.classProgression && st.classProgression.classes && st.classProgression.classes[cls];
    var detail = rec && rec.featureDescriptions && rec.featureDescriptions[name];
    if (detail) return detail;
    return { level: 0, desc: lookupFeatDesc(name, cls) || '', source: classRuleSource(cls) };
  }
  function classChoiceDefinitions(cls, level) {
    var defs = [];
    if (cls === '战士' && level >= 1) defs.push({ key: 'fightingStyle', label: '战斗风格', unlock: 1, count: 1 });
    if ((cls === '圣武士' || cls === '游侠') && level >= 2) defs.push({ key: 'fightingStyle', label: '战斗风格', unlock: 2, count: 1 });
    if (cls === '牧师' && level >= 1) defs.push({ key: 'divineOrder', label: '圣职', unlock: 1, count: 1 });
    if (cls === '德鲁伊' && level >= 1) defs.push({ key: 'primalOrder', label: '原初职能', unlock: 1, count: 1 });
    if (cls === '术士' && level >= 2) defs.push({
      key: 'metamagic', label: '超魔法', unlock: 2,
      countByLevel: { 2: 2, 10: 3, 17: 4 },
      count: level >= 17 ? 4 : (level >= 10 ? 3 : 2)
    });
    if (cls === '魔契师' && level >= 1) {
      var counts = [0,1,3,3,3,5,5,6,6,7,7,7,8,8,8,9,9,9,10,10,10];
      var countByLevel = {};
      for (var invocationLevel = 1; invocationLevel <= 20; invocationLevel++) {
        if (invocationLevel === 1 || counts[invocationLevel] !== counts[invocationLevel - 1]) countByLevel[invocationLevel] = counts[invocationLevel];
      }
      defs.push({ key: 'invocations', label: '魔能祈唤', unlock: 1, countByLevel: countByLevel, count: counts[Math.max(1, Math.min(20, level))] });
    }
    return defs;
  }
  function classChoiceRecord(key) {
    return st.classChoiceData && st.classChoiceData.choices && st.classChoiceData.choices[key];
  }
  function classChoiceOptions(def) {
    var rec = classChoiceRecord(def.key);
    var selected = Array.isArray(st.classChoices[def.key]) ? st.classChoices[def.key] : [];
    return ((rec && rec.options) || []).filter(function (opt) {
      if (Number(opt.minLevel || 1) > Number(st.level || 1)) return false;
      var pre = String(opt.prerequisite || '');
      var pact = pre.match(/具有\s*([^，。]+魔契)/);
      if (pact && selected.indexOf(pact[1]) < 0) return false;
      var required = pre.match(/具有\s*([^，。]+祈唤)/);
      if (required && selected.indexOf(required[1]) < 0) return false;
      return true;
    });
  }
  function syncClassChoiceFeatures() {
    var prefixes = ['战斗风格：', '圣职：', '原初职能：', '超魔法：', '魔能祈唤：'];
    st.features = st.features.filter(function (f) { return !prefixes.some(function (pre) { return String(f).indexOf(pre) === 0; }); });
    st.classChoiceDetails = {};
    classChoiceDefinitions(st.cls, Number(st.level) || 1).forEach(function (def) {
      var rec = classChoiceRecord(def.key);
      var byName = {};
      ((rec && rec.options) || []).forEach(function (opt) { byName[opt.name] = opt; });
      var selected = Array.isArray(st.classChoices[def.key]) ? st.classChoices[def.key].slice(0, def.count) : [];
      st.classChoices[def.key] = selected;
      st.classChoiceDetails[def.key] = {};
      selected.forEach(function (name) {
        var opt = byName[name] || { name: name, desc: def.label + '：' + name, source: classRuleSource(st.cls) };
        st.classChoiceDetails[def.key][name] = { desc: opt.desc || name, prerequisite: opt.prerequisite || '', source: opt.source || (rec && rec.source) || classRuleSource(st.cls) };
        var featureName = def.label + '：' + name;
        if (st.features.indexOf(featureName) < 0) st.features.push(featureName);
      });
    });
  }
  function subclassChoiceDefinitions(level) {
    var cls = st.subclassChoiceData && st.subclassChoiceData.classes && st.subclassChoiceData.classes[st.cls];
    var rec = cls && cls[st.subclass];
    return ((rec && rec.choices) || []).filter(function (def) {
      return Number(def.unlock || 1) <= Number(level || st.level || 1);
    }).map(function (def) {
      var copy = Object.assign({}, def);
      var count = Number(copy.count) || 1;
      if (copy.countByLevel) {
        Object.keys(copy.countByLevel).map(Number).sort(function (a, b) { return a - b; }).forEach(function (lv) {
          if (lv <= Number(level || st.level || 1)) count = Number(copy.countByLevel[String(lv)]) || count;
        });
      }
      copy.count = count;
      return copy;
    });
  }
  function subclassChoiceRecord(key) {
    return subclassChoiceDefinitions(Number(st.level) || 1).filter(function (x) { return x.key === key; })[0] || null;
  }
  function maxSpellLevelAt(level) {
    var slots = spellSlotsFor(st.cls, level || st.level, st.subclass);
    var max = 0;
    Object.keys(slots || {}).forEach(function (k) { if (Number(slots[k]) > 0) max = Math.max(max, Number(k) || 0); });
    return max;
  }
  function subclassChoiceOptions(def) {
    if (!def) return [];
    if (def.optionSource !== 'spells') return (def.options || []).slice();
    var filter = def.spellFilter || {};
    var maxLevel = filter.maxLevelBySlots ? maxSpellLevelAt(st.level) : Number(filter.maxLevel);
    if (!isFinite(maxLevel)) maxLevel = 9;
    var classes = filter.classes || [];
    var schools = filter.schools || [];
    var names = {};
    if (st.spellsFull) {
      Object.keys(st.spellsFull).forEach(function (key) {
        var info = st.spellsFull[key] || {};
        var name = info.name || key;
        var level = Number(info.level) || 0;
        if (level > maxLevel) return;
        if (classes.length && !(info.classes || []).some(function (c) { return classes.indexOf(c) >= 0; })) return;
        if (schools.length && schools.indexOf(info.school || '') < 0) return;
        if (!spellVersionAllowed(name)) return;
        names[name] = { name: name, desc: spellDetailText(name) || name, source: info.source || def.source, level: level };
      });
    }
    if (!Object.keys(names).length && st.spellData && st.spellData.spellLists) {
      classes.forEach(function (cls) {
        var list = st.spellData.spellLists[cls] || {};
        Object.keys(list).forEach(function (lv) {
          if (Number(lv) > maxLevel) return;
          versionSpellList(list[lv] || []).forEach(function (name) {
            var info = spellFullInfo(name) || {};
            if (schools.length && schools.indexOf(info.school || '') < 0) return;
            names[name] = { name: name, desc: spellDetailText(name) || name, source: info.source || def.source, level: Number(info.level != null ? info.level : lv) || 0 };
          });
        });
      });
    }
    return Object.keys(names).map(function (name) { return names[name]; }).sort(function (a, b) {
      return (a.level - b.level) || a.name.localeCompare(b.name, 'zh');
    });
  }
  function clearGeneratedSubclassChoiceEffects() {
    var prefix = '副职选择·';
    st.features = st.features.filter(function (f) { return String(f).indexOf(prefix) !== 0; });
    st.spellList = st.spellList.filter(function (sp) { return !sp.grantedBySubclassChoice; });
    Object.keys(st.skillSources || {}).forEach(function (name) {
      st.skillSources[name] = (st.skillSources[name] || []).filter(function (src) { return String(src).indexOf(prefix) !== 0; });
      if (!st.skillSources[name].length) {
        delete st.skillSources[name];
        if (st.trained[name] === '熟练') st.trained[name] = '未熟练';
      }
    });
    Object.keys(st.toolSources || {}).forEach(function (name) {
      st.toolSources[name] = (st.toolSources[name] || []).filter(function (src) { return String(src).indexOf(prefix) !== 0; });
      if (!st.toolSources[name].length) {
        delete st.toolSources[name];
        st.toolProfs = st.toolProfs.filter(function (x) { return x !== name; });
      }
    });
    st.subclassChoiceDetails = {};
  }
  function addSubclassChoiceSpell(name, def, sourceLabel, spellbookOnly, fallbackLevel) {
    if (!name) return;
    var exists = st.spellList.some(function (sp) { return sp.name === name && sp.grantedBySubclassChoice; });
    if (exists) return;
    var full = spellFullInfo(name) || {};
    // 环阶/等级解析兜底标准：精确解析失败时用调用方提供的环位（选项 level / 法术组环位键）兜底，禁止默认 0（戏法）
    var lvlRes = Math.max(0, Number(full.level));
    if (!lvlRes && fallbackLevel != null) lvlRes = Math.max(0, Number(fallbackLevel));
    if (!lvlRes) lvlRes = 1;
    st.spellList.push({
      name: name,
      level: lvlRes,
      school: full.school || '',
      castingTime: full.castingTime || '',
      range: full.range || '',
      components: full.components || '',
      duration: full.duration || '',
      concentration: !!full.concentration,
      ritual: !!full.ritual,
      desc: full.desc || '',
      prepared: !spellbookOnly,
      alwaysPrepared: !spellbookOnly,
      spellbook: !!spellbookOnly,
      granted: true,
      grantedBySubclassChoice: def.key,
      source: sourceLabel
    });
  }
  function prefixSubclassChoice(label, name) {
    return '副职选择·' + label + '：' + name;
  }
  function syncSubclassChoiceData() {
    clearGeneratedSubclassChoiceEffects();
    if (!st.subclass) return;
    var level = Number(st.level) || 1;
    var defs = subclassChoiceDefinitions(level);
    defs.forEach(function (def) {
      var options = subclassChoiceOptions(def);
      var allowed = {};
      options.forEach(function (opt) { allowed[opt.name] = opt; });
      var selected = Array.isArray(st.subclassChoices[def.key]) ? st.subclassChoices[def.key].slice() : [];
      if (options.length) selected = selected.filter(function (name) { return !!allowed[name]; });
      selected = selected.slice(0, def.count);
      st.subclassChoices[def.key] = selected;
      st.subclassChoiceDetails[def.key] = {};
      var sourceLabel = '副职选择·' + st.subclass + '·' + def.label;
      selected.forEach(function (name) {
        var opt = allowed[name] || { name: name, desc: name, source: def.source };
        st.subclassChoiceDetails[def.key][name] = {
          label: def.label,
          desc: opt.desc || name,
          source: opt.source || def.source || classRuleSource(st.cls),
          replaceTiming: def.replaceTiming || '',
          level: Number(opt.level) || 0
        };
        var featureName = prefixSubclassChoice(def.label, name);
        if (st.features.indexOf(featureName) < 0) st.features.push(featureName);
        if (def.effects && def.effects.skillProficiency) addSkillSource(name, sourceLabel);
        if (def.effects && def.effects.toolProficiency) addToolSource(name, sourceLabel);
        if (def.effects && (def.effects.alwaysPreparedSpell || def.effects.spellbookSpell)) {
          addSubclassChoiceSpell(name, def, sourceLabel, !!def.effects.spellbookSpell, opt.level);
        }
        if (def.spellGroups && def.spellGroups[name]) {
          Object.keys(def.spellGroups[name]).forEach(function (requiredLevel) {
            if (Number(requiredLevel) > level) return;
            (def.spellGroups[name][requiredLevel] || []).forEach(function (spell) {
              addSubclassChoiceSpell(spell, def, sourceLabel, false, Number(requiredLevel));
            });
          });
        }
      });
    });
  }
  function renderSubclassChoicesAtLevel(tabLevel) {
    return subclassChoiceDefinitions(Number(st.level) || 1).filter(function (def) {
      if (Number(def.unlock || 1) === Number(tabLevel)) return true;
      return !!(def.countByLevel && Object.prototype.hasOwnProperty.call(def.countByLevel, String(tabLevel)));
    }).map(function (def) {
      var selected = Array.isArray(st.subclassChoices[def.key]) ? st.subclassChoices[def.key] : [];
      var options = subclassChoiceOptions(def);
      if (!options.length) return adaptiveRuleChoice('子职业选择：' + def.label, '<div class="cb2-empty">相关规则数据仍在加载，已保存的选择不会被清除。</div>', '', '待加载');
      var controls = optionSlotSelects('subclass', def.key, selected, def.count, options);
      var details = selectedOptionDetails(selected, options, def.source || classRuleSource(st.cls));
      return adaptiveRuleChoice('子职业选择：' + def.label, controls + details, '', '已选 ' + selected.length + ' / ' + def.count);
    }).join('');
  }
  function subclassRuleInfo(cls, name) {
    var exact = st.subclassRules && st.subclassRules.classes && st.subclassRules.classes[cls] && st.subclassRules.classes[cls][name];
    if (exact) return exact;
    var legacy = SUBCLASSES[cls] && SUBCLASSES[cls].list && SUBCLASSES[cls].list[name];
    if (!legacy) return null;
    var feats = [];
    Object.keys(legacy.feats || {}).forEach(function (lv) {
      (legacy.feats[lv] || []).forEach(function (f) { feats.push({ level: Number(lv) || 0, name: f, desc: f, source: '内置子职业索引' }); });
    });
    return { name: name, class: cls, source: '内置子职业索引', sourceKind: 'official', summary: legacy.desc || '', features: feats, spells: [] };
  }
  function subclassUnlockLevel(cls) {
    var rec = st.classProgression && st.classProgression.classes && st.classProgression.classes[cls];
    if (rec && rec.levels) {
      for (var lv = 1; lv <= 20; lv++) {
        var row = rec.levels[String(lv)];
        if (row && (row.features || []).some(function (x) { return /子职|副职/.test(x); })) return lv;
      }
    }
    return SUBCLASSES[cls] ? SUBCLASSES[cls].level : 3;
  }
  function sourceAllowed(source) {
    if (sourceKind(source) === 'thirdParty') return !!(st.contentSources && st.contentSources.thirdParty);
    return !st.contentSources || st.contentSources.official !== false;
  }
  function subclassNames(cls) {
    var names = [];
    var exact = st.subclassRules && st.subclassRules.classes && st.subclassRules.classes[cls];
    if (exact) Object.keys(exact).forEach(function (name) { if (sourceAllowed(exact[name]) && names.indexOf(name) < 0) names.push(name); });
    var legacy = SUBCLASSES[cls] && SUBCLASSES[cls].list;
    if (legacy) Object.keys(legacy).forEach(function (name) { if (names.indexOf(name) < 0) names.push(name); });
    return names;
  }
  function subclassBriefBody(info) {
    if (!info) return '';
    var text = String(info.summary || info.desc || info.text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^.*?旁白[：:]?/,'').trim();
    var cut = text.search(/(\d+级|第\d+级|\d+(st|nd|rd|th)|等级\s*(特性|法术)|圣誓法术|法术表)/i);
    if (cut > 20) text = text.slice(0, cut).trim();
    if (/等级\s*(特性|法术)/.test(text)) text = '';
    return briefText(text, 170);
  }
  function briefSubclassSummary(info) {
    if (!info) return '';
    var text = subclassBriefBody(info);
    if (text) return text;
    return info.source ? '来源：' + info.source : '';
  }
  function removeGeneratedSubclassData() {
    var names = subclassNames(st.cls);
    st.features = st.features.filter(function (f) {
      return !names.some(function (sub) { return String(f).indexOf(sub + '·') === 0; });
    });
    st.spellList = st.spellList.filter(function (spell) { return !spell.grantedBySubclass; });
    st.subclassFeatureDetails = {};
  }
  function syncSubclassData() {
    removeGeneratedSubclassData();
    if (!st.subclass) { syncSubclassChoiceData(); return; }
    var lv = Number(st.level) || 1;
    var exact = subclassRuleInfo(st.cls, st.subclass);
    if (exact) {
      (exact.features || []).forEach(function (feat) {
        if (Number(feat.level) <= lv) {
          var name = subclassFeatName(st.subclass, feat.name);
          if (st.features.indexOf(name) < 0) st.features.push(name);
          st.subclassFeatureDetails[name] = {
            level: Number(feat.level) || 0,
            desc: feat.desc || feat.text || feat.name,
            source: exact.source || classRuleSource(st.cls)
          };
        }
      });
      var casting = exact.spellcasting || null;
      if (casting && Array.isArray(casting.requiredCantrips)) {
        casting.requiredCantrips.forEach(function (spellName) {
          if (st.spellList.some(function (sp) { return sp.name === spellName && sp.grantedBySubclass === st.subclass; })) return;
          var fullCantrip = spellFullInfo(spellName) || {};
          st.spellList.push({
            name: spellName, level: 0, school: fullCantrip.school || '', castingTime: fullCantrip.castingTime || '',
            range: fullCantrip.range || '', components: fullCantrip.components || '', duration: fullCantrip.duration || '',
            concentration: !!fullCantrip.concentration, ritual: !!fullCantrip.ritual, desc: fullCantrip.desc || '',
            prepared: true, alwaysPrepared: true, granted: true, grantedBySubclass: st.subclass,
            source: casting.source || exact.source || ('副职·' + st.subclass)
          });
        });
      }
      var hasChoiceSpellGroups = subclassChoiceDefinitions(lv).some(function (def) { return !!def.spellGroups; });
      (hasChoiceSpellGroups ? [] : (exact.spells || [])).forEach(function (row) {
        if (Number(row.level) > lv) return;
        (row.spells || []).forEach(function (name) {
          var exists = st.spellList.some(function (sp) { return sp.name === name && sp.grantedBySubclass; });
          if (!exists) {
            var full = spellFullInfo(name) || {};
            // 环阶/等级解析兜底标准：禁止数据缺失时默认 0（戏法）。
            // 精确解析失败时按该规则书"获得等级→环位"规律推导（示例：DND 誓约法术 3/5/9/13/17 级 → 1/2/3/4/5 环），
            // 加载完成后 reconcileGrantedSpells() 会用完整数据再次校正。
            var lvlRes = Math.max(0, Number(full.level));
            if (!lvlRes) {
              var oathRowLv = Number(row.level);
              var oathRingMap = { 3: 1, 5: 2, 9: 3, 13: 4, 17: 5 };
              lvlRes = oathRingMap[oathRowLv] || 1;
            }
            st.spellList.push({
              name: name,
              level: lvlRes,
              school: full.school || '',
              castingTime: full.castingTime || '',
              range: full.range || '',
              components: full.components || '',
              duration: full.duration || '',
              concentration: !!full.concentration,
              ritual: !!full.ritual,
              desc: full.desc || '',
              prepared: true,
              alwaysPrepared: true,
              granted: true,
              grantedBySubclass: st.subclass,
              source: exact.source || ('副职·' + st.subclass)
            });
          }
        });
      });
      syncSubclassChoiceData();
      return;
    }
    var legacy = SUBCLASSES[st.cls] && SUBCLASSES[st.cls].list[st.subclass];
    if (legacy && legacy.feats) Object.keys(legacy.feats).forEach(function (fl) {
      if (Number(fl) <= lv) legacy.feats[fl].forEach(function (f) {
        var name = subclassFeatName(st.subclass, f);
        if (st.features.indexOf(name) < 0) st.features.push(name);
      });
    });
    syncSubclassChoiceData();
  }

  function applyClassFeaturesToState(cls) {
    Object.keys(st.classFeatureDetails || {}).forEach(function (name) {
      var idx = st.features.indexOf(name);
      if (idx >= 0) st.features.splice(idx, 1);
    });
    st.classFeatureDetails = {};
    if (!cls || cls === '自定义') return;
    var lv = Number(st.level) || 1;
    for (var i = 1; i <= lv; i++) {
      classFeatureRows(cls, i).forEach(function (name) {
        if (!name || featureIsClassPlaceholder(name) || /子职$/.test(name) || /子职业$/.test(name)) return;
        var detail = classFeatureDetail(cls, name);
        st.classFeatureDetails[name] = {
          level: i,
          desc: detail.desc || lookupFeatDesc(name, cls) || name,
          source: detail.source || classRuleSource(cls)
        };
        if (st.features.indexOf(name) < 0) st.features.push(name);
      });
    }
  }
  function renderSubclassLevelEntries(level, current) {
    var chosen = st.subclass ? subclassRuleInfo(st.cls, st.subclass) : null;
    if (!chosen) return '';
    var lv = Number(level) || 1;
    var rows = [];
    (chosen.features || []).forEach(function (feat) {
      if (Number(feat.level) !== lv) return;
      rows.push(adaptiveRuleTrait(feat.name, feat.desc || feat.text || feat.name));
    });
    (chosen.spells || []).forEach(function (row) {
      if (Number(row.level) !== lv) return;
      var tags = (row.spells || []).map(function (spellName) {
        var full = spellFullInfo(spellName) || {};
        // 环阶/等级解析兜底标准：解析失败时按该规则书"获得等级→环位"推导（3/5/9/13/17 → 1/2/3/4/5），禁止显示"0环"
        var ringLv = Number(full.level);
        if (!ringLv) {
          var oathRowLv = Number(row.level);
          var oathRingMap = { 3: 1, 5: 2, 9: 3, 13: 4, 17: 5 };
          ringLv = oathRingMap[oathRowLv] || 0;
        }
        if (window.TrpgTag && window.TrpgTag.chip) return window.TrpgTag.chip({
          name: spellName,
          type: 'spell',
          extra: ringLv === 0 ? '戏法' : ringLv + '环',
          source: full.source || chosen.source,
          system: ctx && ctx.system,
          hideSource: true,
          desc: spellDetailText(spellName) || spellName,
          title: spellName
        });
        return '<span class="cb2-chip">' + esc(spellName) + '</span>';
      }).join('');
      rows.push('<div class="cb2-race-choice"><div class="t">🔮 子职业法术</div><div class="cb2-feat-chiprow">' + tags + '</div></div>');
    });
    if (!rows.length) return '';
    return '<div class="cb2-sub-level">' + rows.join('') + '</div>';
  }

  function renderClsFeatHint() {
    var box = $id('cb2c-cls-features');
    if (!box) return;
    if (st.cls === '自定义') {
      box.innerHTML = adaptiveRuleCard('⚔', '自定义职业', '玩家维护', '', adaptiveRuleTrait('职业成长', '职业特性、选择项与等级能力由玩家在角色卡中维护。'), '');
      return;
    }
    var current = Number(st.level) || 1;
    st.classLevelTab = Math.max(1, Math.min(20, Number(st.classLevelTab) || current));
    var source = classRuleSource(st.cls);
    var allFeatures = classFeatureRows(st.cls, st.classLevelTab);
    var subclassFeatureNamesAtTab = {};
    var chosenAtTab = st.subclass ? subclassRuleInfo(st.cls, st.subclass) : null;
    if (chosenAtTab && Array.isArray(chosenAtTab.features)) {
      chosenAtTab.features.forEach(function (feat) {
        if (Number(feat.level) === Number(st.classLevelTab) && feat.name) subclassFeatureNamesAtTab[feat.name] = true;
      });
    }
    var visibleFeatures = allFeatures.filter(function (name) { return !featureIsClassPlaceholder(name) && !subclassFeatureNamesAtTab[name]; });
    var featureRows = visibleFeatures.length ? visibleFeatures.map(function (name) {
      var detail = classFeatureDetail(st.cls, name);
      var desc = detail.desc || '该等级获得此职业能力。';
      return adaptiveRuleTrait(name, desc);
    }).join('') : '';
    var choices = classChoiceDefinitions(st.cls, current).filter(function (def) {
      return Number(def.unlock) === Number(st.classLevelTab) || !!(def.countByLevel && def.countByLevel[String(st.classLevelTab)] != null);
    }).map(function (def) {
      var rec = classChoiceRecord(def.key);
      var selected = Array.isArray(st.classChoices[def.key]) ? st.classChoices[def.key] : [];
      var options = classChoiceOptions(def);
      var milestoneCount = def.countByLevel && def.countByLevel[String(st.classLevelTab)] != null ? Number(def.countByLevel[String(st.classLevelTab)]) : def.count;
      var priorCount = 0;
      if (def.countByLevel) Object.keys(def.countByLevel).map(Number).sort(function (a, b) { return a - b; }).forEach(function (lv) { if (lv < st.classLevelTab) priorCount = Number(def.countByLevel[String(lv)]) || priorCount; });
      var gained = Math.max(0, milestoneCount - priorCount);
      var controls = optionSlotSelects('class', def.key, selected, def.count, options);
      var details = selectedOptionDetails(selected, options, (rec && rec.source) || source);
      return adaptiveRuleChoice(def.label, controls + details, '', '已选 ' + selected.length + ' / ' + def.count + (gained ? ' · 本级 +' + gained : ''));
    }).join('');
    var subUnlock = subclassUnlockLevel(st.cls);
    var subNames = subclassNames(st.cls);
    var subChoice = '';
    if (subNames.length && st.classLevelTab === subUnlock) {
      var opts = '<select class="cb2-in" data-class-subclass-select="1" style="max-width:260px"><option value="">— 选择子职业 —</option>' + subNames.map(function (name) {
        return '<option value="' + esc(name) + '"' + (st.subclass === name ? ' selected' : '') + '>' + esc(name) + '</option>';
      }).join('') + '</select>';
      var chosenInfo = st.subclass ? subclassRuleInfo(st.cls, st.subclass) : null;
      var chosenDesc = chosenInfo ? briefSubclassSummary(chosenInfo) : '';
      var brief = chosenDesc ? '<div class="cb2-subclass-brief">' + esc(chosenDesc) + (chosenInfo && chosenInfo.source ? '<span class="src">' + esc(chosenInfo.source) + '</span>' : '') + '</div>' : '';
      subChoice = adaptiveRuleChoice('子职业', opts + brief, '', subUnlock + '级解锁 · 当前：' + (st.subclass || '未选择'));
    }
    var subclassLevelHtml = st.subclass ? renderSubclassLevelEntries(st.classLevelTab, current) : '';
    var nestedChoiceHtml = st.subclass ? renderSubclassChoicesAtLevel(st.classLevelTab) : '';
    var growthChoice = renderClassGrowthChoice(st.classLevelTab, allFeatures, current);
    var metaHtml = '<span class="cb2-tag">当前等级：' + current + '</span>' +
      '<span class="cb2-tag">查看等级：' + st.classLevelTab + '</span>' +
      '<span class="cb2-tag">生命骰：' + esc(CLASS_HD[st.cls] || '—') + '</span>' +
      '<span class="cb2-tag">豁免：' + esc((SAVE_RECS[st.cls] || []).map(function (k) { return ABILITIES_MAP[k] || k; }).join('、') || '—') + '</span>' +
      '<span class="cb2-tag">熟练：' + esc(CLASS_PROF_HINT[st.cls] || '—') + '</span>';
    var levelSelector = adaptiveRuleChoice('成长等级', '<div style="display:flex;gap:5px;flex-wrap:wrap">' + progressionTabs(st.classLevelTab, current) + '</div>', '', '1—20级');
    var sourceToggle = '<div class="cb2-source-switch"><label class="cb2-save"><input type="checkbox" checked disabled> 官方规则扩展</label><label class="cb2-save"><input type="checkbox" id="cb2c-src-thirdparty"' + (st.contentSources && st.contentSources.thirdParty ? ' checked' : '') + '> 第三方扩展</label></div>';
    var card = adaptiveRuleCard('⚔', st.cls + ' · ' + st.classLevelTab + '级', '职业成长', metaHtml, sourceToggle + levelSelector + featureRows + subclassLevelHtml, growthChoice + choices + subChoice + nestedChoiceHtml);
    var growth = '';
    box.innerHTML = card + growth;
    if (window.TrpgTag && typeof window.TrpgTag.bindTips === 'function') try { window.TrpgTag.bindTips(box); } catch (e) {}
  }
  function renderSubclassSelect() { renderClsFeatHint(); }
  function applySubclass(name) {
    if (subclassNames(st.cls).indexOf(name) < 0 || st.subclass === name) return;
    removeGeneratedSubclassData();
    clearGeneratedSubclassChoiceEffects();
    st.subclassChoices = {};
    st.subclass = name;
    pruneClassSpellSelections();
    syncSubclassData();
    renderClsFeatHint();
    refreshFeatList();
    renderSpellSection();
    updateDerived();
    try { showToast('已选择子职业「' + name + '」，成长特性与固定法术已同步', 'ok'); } catch (e) {}
  }
  function applyBgProficiencies(bg, bgInfo) {
    var oldBg = st.background;
    if (oldBg && oldBg !== '自定义背景') {
      var oldInfo = BACKGROUNDS[oldBg];
      if (oldInfo) {
        (oldInfo.skills || []).forEach(function (n) { removeSkillSource(n, '背景·' + oldBg); });
        var oldTool = st.bgToolCache || oldInfo.tool;
        if (oldTool && oldTool !== '选择一种工匠工具' && oldTool !== '选择一种乐器' && oldTool !== '选择一种赌具') {
          removeToolSource(oldTool, '背景·' + oldBg);
        } else {
          var oldCat = bgToolCategory(oldTool);
          if (oldCat) {
            st.toolProfs.slice().forEach(function (t) {
              if (TOOL_LISTS[oldCat].indexOf(t) >= 0) removeToolSource(t, '背景·' + oldBg);
            });
          }
        }
      }
    } else if (oldBg === '自定义背景' && st.customBg) {
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
      (st.customBg.skills || []).forEach(function (n) { addSkillSource(n, '背景·自定义'); });
      if (st.customBg.tool) addToolSource(st.customBg.tool, '背景·自定义');
    }
    renderSkillQuota();
    renderSkillRows();
  }
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
  function applyCustomBgNow(silent) {
    var cbg3 = st.customBg || (st.customBg = { name: '', skills: [], tool: '', toolCat: '', equip: 'A', equipGold: 0, attr: '21' });
    st.background = '自定义背景';
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
    if (st.bgApplied) applyBgAttr(null);
    if (st.ruleVersion === '2024') {
      // 不默认应用：仅记录方案与候选属性，固定基础属性后在「属性提升来源」中拖动分配
      var aKeys = [];
      (cbg3.attrKeys || []).forEach(function (k) { if (k && aKeys.indexOf(k) < 0) aKeys.push(k); });
      var need = cbg3.attr === '111' ? 3 : 2;
      st.bgAttrMode = cbg3.attr === '111' ? '111' : '21';
      st.bgAttrKeys = normalizedBgAttrKeys(st.bgAttrMode, aKeys);
      st.bgAttrPending = false;
      if (!silent && st.baseFixed) {
        try { showToast('背景属性提升已记录，请在「属性」页「属性提升来源」中拖动分配（方案 ' + (cbg3.attr === '111' ? 'B：3 项各 +1' : 'A：+2 与 +1') + '）', 'ok'); } catch (e) {}
      }
    }
    decrementItemsByNames(st.bgAppliedItems || []);
    if (cbg3.equip === 'B') {
      st.bgEquip = 'B'; st.bgGold = cbg3.gold || 50; st.bgAppliedItems = []; st.bgEquipData = null;
    } else {
      st.bgEquip = 'A';
      var its = (cbg3.items || []).filter(Boolean).map(function (n) { return { name: n, quantity: 1 }; });
      st.bgAppliedItems = addGrantedItems(its, '背景·自定义·A套装'); st.bgGold = 0; st.bgEquipData = null;
    }
    renderSkillQuota();
    renderSkillRows();
    renderBgCard();
    updateDerived();
  }

  function expandGrantItems(items) {
    var out = [];
    (items || []).forEach(function (it) {
      if (!it) return;
      if (typeof it === 'string') { out.push(it); return; }
      var qty = Math.max(1, Number(it.quantity) || 1);
      for (var i = 0; i < qty; i++) out.push(it.name);
    });
    return out.filter(Boolean);
  }
  function decrementItemsByNames(names) {
    var rmMap = {};
    (names || []).forEach(function (n) { if (n) rmMap[n] = (rmMap[n] || 0) + 1; });
    if (!Object.keys(rmMap).length) return;
    st.items.forEach(function (x) {
      if (!rmMap[x.name]) return;
      var d = Math.min(rmMap[x.name], Math.max(1, Number(x.quantity) || 1));
      rmMap[x.name] -= d;
      x.quantity = Math.max(0, (Number(x.quantity) || 1) - d);
      if (x.freeQuantity != null) x.freeQuantity = Math.max(0, (Number(x.freeQuantity) || 0) - d);
    });
    st.items = st.items.filter(function (x) { return Number(x.quantity) > 0; });
    if (st.armor && st.armor !== '无甲' && !st.items.some(function (x) { return x.name === st.armor; })) st.armor = '无甲';
    if (st.shield && !st.items.some(function (x) { return itemEquipKind(x) === 'shield' && x.equipped; })) st.shield = false;
  }
  function addGrantedItems(items, sourceLabel) {
    var expanded = expandGrantItems(items);
    expanded.forEach(function (n) {
      var hit = st.items.filter(function (x) { return x.name === n; })[0];
      if (hit) {
        hit.quantity = (Number(hit.quantity) || 1) + 1;
        hit.free = true;
        hit.freeQuantity = Math.max(0, Number(hit.freeQuantity) || 0) + 1;
        hit.grantSource = sourceLabel || hit.grantSource || '';
      } else {
        var isArmor = ARMOR_LIST.indexOf(n) >= 0;
        var it = buildCatalogItem(n, isArmor ? (armorCat(n) || '护甲') : (findEquipCat(n) || '杂物'), { quantity: 1, equipped: false, free: true, freeQuantity: 1, grantSource: sourceLabel || '' });
        st.items.push(it);
      }
    });
    return expanded;
  }
  function applyBgEquip(opt) {
    var eqOpts = st.bgEquipData || {};
    var pick = opt === 'A' ? eqOpts.A : eqOpts.B;
    if (!pick) return;
    decrementItemsByNames(st.bgAppliedItems || []);
    st.bgEquip = opt;
    st.bgAppliedItems = [];
    if (opt === 'B') {
      st.bgGold = pick.gold || 0;
    } else {
      st.bgGold = 0;
      st.bgAppliedItems = addGrantedItems(pick.items || [], '背景·' + (st.background || '') + '·A套装');
    }
    refreshSelection();
    updateDerived();
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
          ? '2024 背景提供 <b>3 项属性提升</b>（+2/+1 或三项各 +1）、<b>1 个起源专长</b>、<b>2 项技能熟练</b>、<b>工具熟练</b>与<b>装备（或 50GP）</b>。选择背景后可在属性页确认属性提升，技能熟练会同步写入。'
          : '2014 背景提供 <b>2 项技能熟练</b>、<b>工具熟练</b>与<b>装备（或金币）</b>，不提供属性提升与专长。') +
        '</div></div></div>';
      return;
    }
    var info = BACKGROUNDS[bg];
    if (!info) {
      var cb = st.customBg || (st.customBg = { name: '', skills: [], tool: '', toolCat: '', equip: 'A', equipGold: 0, attr: '21' });
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
      var cbSkillHtml = SKILLS.map(function (s) {
        var on = cb.skills.indexOf(s.name) >= 0;
        var disabled = !on && cb.skills.length >= 2;
        return '<span class="cb2-chip' + (on ? ' on' : '') + (disabled ? ' dis' : '') + '" data-act="cbg-skill" data-name="' + esc(s.name) + '"' + (disabled ? ' style="opacity:.4;cursor:not-allowed"' : '') + '>' + esc(s.name) + '</span>';
      }).join('');
      var cbToolCat = cb.toolCat || '工匠工具';
      var cbToolSel = '<select class="cb2-in cb2-in-sm" data-cbg-toolcat style="max-width:110px">' +
        Object.keys(TOOL_LISTS).map(function (c) { return '<option value="' + c + '"' + (cb.toolCat === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
        '<select class="cb2-in cb2-in-sm" data-cbg-tool style="max-width:150px">' +
        '<option value="">— 选择 —</option>' +
        TOOL_LISTS[cbToolCat].map(function (t) { return '<option value="' + esc(t) + '"' + (cb.tool === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>';
      var cbItemValues = (cb.items || []).slice(0, 5);
      while (cbItemValues.length < 5) cbItemValues.push('');
      var cbItemSlots = cbItemValues.map(function (v, idx) {
        return '<input type="text" class="cb2-in" data-cbg-item-slot="' + idx + '" value="' + esc(v) + '" placeholder="物品 ' + (idx + 1) + '" style="min-width:150px">';
      }).join('');
      var cbEquipHtml = '<div class="cb2-bg-equip" style="align-items:flex-start;flex-wrap:wrap">' +
        '<button type="button" class="cb2-btn sm' + (cb.equip === 'A' ? ' gold' : '') + '" data-act="cbg-equip-a" title="选择装备套装">A 套装</button>' +
        '<span class="cb2-bg-equip-d" style="display:grid;grid-template-columns:repeat(2,minmax(150px,1fr));gap:6px;flex:1">' + (cb.equip === 'A' ? cbItemSlots : '') + '</span>' +
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
        (st.ruleVersion === '2024' ? '<div class="cb2-bg-cell full"><label>属性提升</label><div class="cb2-mini-label">请到「属性」页右侧配置自定义背景的 +2/+1 或三项各 +1。</div></div>' : '') +
        '<div class="cb2-bg-cell full" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<span class="cb2-mini-label" style="color:var(--green-l);margin:0">✓ 选择即生效：技能/工具/装备/属性提升实时应用，来源标记「背景·自定义」</span>' +
        '</div>' +
        '</div>';
      return;
    }
    if (!st.bgEquipData) st.bgEquipData = parseBgEquip(info.equip);
    var eqOpts = st.bgEquipData || {};
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
      st.toolProfs = st.toolProfs || [];
      if (st.toolProfs.indexOf(info.tool) < 0) st.toolProfs.push(info.tool);
    }
    var feat = info.feat;
    var featDesc = '';
    Object.keys(ORIGIN_FEATS).forEach(function (k) {
      if (feat.indexOf(k) >= 0) featDesc = ORIGIN_FEATS[k];
    });
    var applied = st.bgApplied;
    var attrState = applied ? ABILITIES.map(function (a) {
      var add = applied.allocation && applied.allocation[a.key] || 0;
      return add ? a.name + ' +' + add : '';
    }).filter(Boolean).join('、') : '未应用';
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
    var is2024 = st.ruleVersion === '2024';
    var attrPlanHtml = is2024
      ? '<span class="cb2-bg-card-tag">属性提升请在「属性」页右侧配置</span><button type="button" class="cb2-btn sm" data-act="bg-apply-skills" title="将背景的两项技能设为熟练">🎓 勾选技能</button>'
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
      '<div class="cb2-bg-card-grid">' + gridCells + '</div>' +
      '<div class="cb2-row" style="margin-top:8px;gap:8px;align-items:center">' + attrPlanHtml + '</div>';
  }

  function currentScores() {
    if (st.mode === 'rolled') return st.scores; // 骰点模式：值由骰池分配维护，不读输入框
    ABILITIES.forEach(function (a) {
      var el = $id('cb2c-ab-' + a.key);
      if (el) st.scores[a.key] = clampScore(el.value);
    });
    return st.scores;
  }

  // ===== 属性提升归一化：统一来源模型 =====
  // 来源类型：'bg' 背景 | 'cls-<level>' 职业ASI | 'feat-<name>' 专长ASI
  function asiChipsFor(key) {
    var out = [];
    // 背景
    if (st.bgApplied && st.bgApplied.allocation) {
      var bAdd = st.bgApplied.allocation[key] || 0;
      if (bAdd) out.push({ src: 'bg', label: '背景·' + esc(st.background || '背景'), v: bAdd });
    }
    // 职业 ASI（每级成长选择）
    Object.keys(st.classGrowthChoices || {}).forEach(function (lv) {
      var c = st.classGrowthChoices[lv];
      if (!c || c.type !== 'ability' || !c.allocation) return;
      var add = c.allocation[key] || 0;
      if (add) out.push({ src: 'cls-' + lv, label: '职业·' + lv + '级', v: add });
    });
    // 专长 ASI
    Object.keys(st.featAsi || {}).forEach(function (fn) {
      var fa = st.featAsi[fn];
      if (!fa || !fa.allocation) return;
      var add = fa.allocation[key] || 0;
      if (add) out.push({ src: 'feat-' + fn, label: '专长·' + fn, v: add });
    });
    return out;
  }
  function asiTotalFor(key) {
    return asiChipsFor(key).reduce(function (s, c) { return s + c.v; }, 0);
  }
  function computeBaseScores() {
    var base = {};
    ABILITIES.forEach(function (a) {
      base[a.key] = clampScore((st.scores[a.key] != null ? Number(st.scores[a.key]) : 8) - asiTotalFor(a.key));
    });
    return base;
  }
  function fixBaseScores() {
    currentScores();
    if (st.mode === 'rolled') {
      var missing = ABILITIES.filter(function (a) { return st.scores[a.key] == null; });
      if (missing.length) {
        try { showToast('还有 ' + missing.length + ' 项属性未分配，请先完成基础属性分配', 'error'); } catch (e) {}
        return false;
      }
    }
    // 基础值 = 当前值 - 已存在的来源提升（若在背景/职业页先配置过，保留之）
    st.baseScores = computeBaseScores();
    st.baseFixed = true;
    renderAbilityGrid();
    renderAsiPanel();
    updateDerived();
    renderBaseFixBar();
    try { showToast('基础属性已固定，之后通过下方「属性提升来源」面板添加外部加值', 'ok'); } catch (e) {}
    return true;
  }
  function unfixBaseScores() {
    clearAllAsiEffects();
    st.baseFixed = false;
    st.baseScores = null;
    st.featAsi = {};
    st.classGrowthChoices = {};
    st.bgApplied = null;
    st.bgAttrMode = '21';
    st.bgAttrKeys = [];
    renderAbilityGrid();
    renderAsiPanel();
    updateDerived();
    renderBaseFixBar();
  }
  function renderBaseFixBar() {
    var bar = $id('cb2c-base-fix-bar');
    if (bar) bar.style.display = st.baseFixed ? '' : 'none';
    // 固定后隐藏生成模式切换（仅创建模式；编辑模式本就不显示模式切换）
    if (!editData) {
      container.querySelectorAll('.cb2-mode-tabs').forEach(function (mt) { mt.style.display = st.baseFixed ? 'none' : ''; });
    }
    var wrap = $id('cb2c-base-fix-wrap');
    if (!wrap) return;
    if (editData) {
      wrap.innerHTML = '<span class="cb2-mini-label" style="margin:0">编辑模式：属性数字可直接修改（基础值=最终值−来源加值）；来源提升可在下方面板调整</span>';
      return;
    }
    if (st.baseFixed) {
      wrap.innerHTML = '<button type="button" class="cb2-btn sm" data-act="base-unfix" title="撤销固定：移除全部来源提升并回到基础属性编辑">↩ 重新生成基础属性</button>' +
        '<span class="cb2-mini-label" style="margin:0">基础属性已锁定，外部来源提升在下方面板</span>';
    } else {
      wrap.innerHTML = '<button type="button" class="cb2-btn gold sm" data-act="base-fix" title="固定当前六项为基础属性，之后来源提升只允许在下方面板拖动分配">✔ 固定基础属性</button>' +
        '<span class="cb2-mini-label" style="margin:0">基础属性确定后固定，避免与外部来源加值混淆</span>';
    }
  }
  // 专长 ASI：从专长描述解析属性提升（如"你的力量或敏捷提升1"）
  function parseFeatAsiDesc(desc) {
    var d = String(desc || '').replace(/<[^>]+>/g, ' ');
    var m = d.match(/你的((?:力量|敏捷|体质|智力|感知|魅力)(?:、|或)?(?:力量|敏捷|体质|智力|感知|魅力)?(?:、|或)?(?:力量|敏捷|体质|智力|感知|魅力)?)提升\s*(\d+)/);
    if (!m) return null;
    var names = [];
    ['力量', '敏捷', '体质', '智力', '感知', '魅力'].forEach(function (n) { if (m[1].indexOf(n) >= 0 && names.indexOf(n) < 0) names.push(n); });
    if (!names.length) return null;
    return { amount: parseInt(m[2], 10) || 1, options: names };
  }
  function featAsiInfo(featName) {
    var rec = st.featsFull ? st.featsFull[featName] : null;
    if (!rec && typeof window !== 'undefined' && window.__cbFeatsFull) rec = window.__cbFeatsFull[featName] || null;
    if (rec) {
      var r = parseFeatAsiDesc(rec.desc || '');
      if (r) return r;
    }
    if (ORIGIN_FEATS[featName]) {
      var r2 = parseFeatAsiDesc(ORIGIN_FEATS[featName]);
      if (r2) return r2;
    }
    return null;
  }
  function ensureFeatAsi(featName, force) {
    if (!featName) return;
    if (st.featAsi[featName]) return;
    // 编辑老存档加载同步：基础值已含专长提升（反推时未拆分），不自动新建记录，避免重复计算；
    // 用户主动选择（force）时允许创建
    if (editData && !force) return;
    var info = featAsiInfo(featName);
    if (info) st.featAsi[featName] = { amount: info.amount, options: info.options, allocation: {} };
  }
  function setFeatAsiAttr(featName, abilityKey) {
    var fa = st.featAsi[featName];
    if (!fa) return;
    clearFeatAsiEffects(featName);
    if (!abilityKey) return;
    var k = abilityKeyOf(abilityKey) || '';
    if (!k) return;
    if (fa.options && fa.options.length && fa.options.indexOf(ABILITIES_MAP[k]) < 0) {
      try { showToast('「' + featName + '」只能提升：' + fa.options.join('、'), 'error'); } catch (e) {}
      return;
    }
    fa.allocation[k] = fa.amount;
    st.scores[k] = clampScore(Number(st.scores[k] != null ? st.scores[k] : (st.baseScores && st.baseScores[k] != null ? st.baseScores[k] : 8)) + fa.amount);
    renderAbilityGrid();
    renderAsiPanel();
    updateDerived();
  }
  function clearFeatAsiEffects(featName) {
    var fa = st.featAsi[featName];
    if (!fa || !fa.allocation) return;
    Object.keys(fa.allocation).forEach(function (k) {
      st.scores[k] = clampScore(Number(st.scores[k] != null ? st.scores[k] : 8) - fa.allocation[k]);
    });
    fa.allocation = {};
  }
  function clearAllAsiEffects() {
    Object.keys(st.featAsi || {}).forEach(function (fn) { clearFeatAsiEffects(fn); });
    Object.keys(st.classGrowthChoices || {}).forEach(function (lv) { clearClassGrowthEffects(Number(lv)); });
    if (st.bgApplied) applyBgAttr(null);
  }
  function renderAsiPanel() {
    var el = $id('cb2c-asi-panel');
    if (!el) return;
    if (!st.baseFixed) {
      el.innerHTML = '';
      return;
    }
    // 同步专长 ASI：扫描特性列表中的专长（职业成长·X级·专长：名 / 背景起源专长 / 手动专长）
    if (st.featsFull || (typeof window !== 'undefined' && window.__cbFeatsFull)) {
      var fullPool = st.featsFull || window.__cbFeatsFull || {};
      (st.features || []).forEach(function (f) {
        var s = String(f || '');
        var m = s.match(/^职业成长·\d+级·专长：(.+)$/);
        var name = m ? m[1] : s;
        if (name && (fullPool[name] || ORIGIN_FEATS[name]) && !featureIsClassPlaceholder(name)) ensureFeatAsi(name);
      });
    }
    var rows = [];
    // 背景来源
    if (st.ruleVersion === '2024' && st.background) {
      var allow = bgAllowedAbilities();
      var mode = st.bgAttrMode || (st.bgApplied && st.bgApplied.mode) || '21';
      var need = mode === '111' ? 3 : 2;
      // 候选/已分配 keys：只取"实际已分配"（bgApplied.abilities）；未分配的槽渲染为空槽（可拖）。
      // 禁止把预填候选（bgAttrKeys）当作已分配，否则会出现"数值未应用且不可拖动"的死锁。
      var keys = [];
      var srcKeys = (st.bgApplied && st.bgApplied.abilities) ? st.bgApplied.abilities.slice() : [];
      // 固定属性+值：候选数 ≤ 需要数时自动固定加算（不拖动，上限 20）
      if (allow.length && allow.length <= need && !st.bgApplied) {
        var fixedKeys = [];
        for (var fi = 0; fi < need; fi++) fixedKeys.push(allow[fi] || '');
        var curVals = {};
        ABILITIES.forEach(function (a) { curVals[a.key] = Number(st.scores[a.key] != null ? st.scores[a.key] : (st.baseScores && st.baseScores[a.key] != null ? st.baseScores[a.key] : 8)); });
        var over = fixedKeys.some(function (n) { var k = BG_ABILITY_KEY[n]; return k && (curVals[k] + (mode === '21' ? (fixedKeys.indexOf(n) === 0 ? 2 : 1) : 1)) > 20; });
        if (!over) {
          st.bgAttrKeys = fixedKeys;
          applyBgAttr(mode, fixedKeys);
        }
        keys = fixedKeys;
      } else {
        for (var ki = 0; ki < need; ki++) {
          var kv = srcKeys[ki] || '';
          keys.push(allow.indexOf(kv) >= 0 ? kv : '');
        }
      }
      var labels = mode === '21' ? ['2', '1'] : ['1', '1', '1'];
      var tokens = '';
      for (var i = 0; i < need; i++) {
        var cur = keys[i] || '';
        var assigned = !!cur;
        tokens += '<span class="cb2-asi-token' + (assigned ? ' used' : '') + '" draggable="true" data-asi-src="bg" data-asi-slot="' + i + '" data-asi-label="背景+' + labels[i] + '" title="' + (assigned ? '已分配：' + cur + '（点击下方属性上的标签可移除）' : '拖到属性上分配 +' + labels[i]) + '">+' + labels[i] + '</span>';
      }
      var bgSel = '';
      if (st.background === '自定义背景') {
        bgSel = '<div class="cb2-mini-label" style="margin:0">自定义背景：请在「背景」页设置属性方案</div>';
      }
      rows.push('<div class="cb2-asi-src">' +
        '<div class="cb2-asi-src-t">📜 背景 · ' + esc(st.background === '自定义背景' && st.customBg ? (st.customBg.name || '自定义背景') : st.background) + '<span class="cb2-mini-label" style="margin:0">' + (mode === '21' ? '方案A +2/+1' : '方案B 三项+1') + '</span></div>' +
        '<div class="cb2-asi-src-ctl">' +
        '<button type="button" class="cb2-btn sm' + (mode === '21' ? ' gold' : '') + '" data-act="bg-attr-mode" data-mode="21">方案A +2/+1</button>' +
        '<button type="button" class="cb2-btn sm' + (mode === '111' ? ' gold' : '') + '" data-act="bg-attr-mode" data-mode="111">方案B 三项+1</button>' +
        '<button type="button" class="cb2-btn sm" data-act="bg-attr-undo">↩ 撤销</button>' +
        '</div>' +
        '<div class="cb2-asi-tokens">' + tokens + '</div>' +
        bgSel +
        '</div>');
    }
    // 职业 ASI 来源（仅当前等级及以下）
    Object.keys(st.classGrowthChoices || {}).forEach(function (lv) {
      var c = st.classGrowthChoices[lv];
      if (!c || c.type !== 'ability') return;
      if (Number(lv) > Number(st.level || 1)) return;
      var mode = c.mode === '111' ? '111' : '21';
      var slots = growthSlotsForMode(mode);
      var attrs = validGrowthAttrs(c);
      var tokens = slots.map(function (slot, i) {
        var assigned = !!attrs[i];
        return '<span class="cb2-asi-token' + (assigned ? ' used' : '') + '" draggable="true" data-asi-src="cls-' + lv + '" data-asi-slot="' + i + '" data-asi-label="' + lv + '级+' + slot.v + '" title="' + (assigned ? '已分配：' + (ABILITIES_MAP[attrs[i]] || attrs[i]) : '拖到属性上分配 +' + slot.v) + '">+' + slot.v + '</span>';
      }).join('');
      rows.push('<div class="cb2-asi-src">' +
        '<div class="cb2-asi-src-t">⚔ 职业 · ' + lv + '级属性提升<span class="cb2-mini-label" style="margin:0">' + (mode === '21' ? '+2/+1' : '三项+1') + '</span></div>' +
        '<div class="cb2-asi-src-ctl">' +
        '<button type="button" class="cb2-btn sm' + (mode === '21' ? ' gold' : '') + '" data-act="class-growth-mode-btn" data-level="' + lv + '" data-mode="21">+2/+1</button>' +
        '<button type="button" class="cb2-btn sm' + (mode === '111' ? ' gold' : '') + '" data-act="class-growth-mode-btn" data-level="' + lv + '" data-mode="111">三项+1</button>' +
        '<button type="button" class="cb2-btn sm" data-act="class-growth-undo" data-level="' + lv + '">↩ 撤销</button>' +
        '</div>' +
        '<div class="cb2-asi-tokens">' + tokens + '</div>' +
        '</div>');
    });
    // 专长 ASI 来源
    Object.keys(st.featAsi || {}).forEach(function (fn) {
      var fa = st.featAsi[fn];
      var assignedKey = Object.keys(fa.allocation || {})[0] || '';
      var token;
      if (fa.options && fa.options.length === 1) {
        // 固定属性+值：不拖动，直接固定加算（上限 20）
        var fixedKey = BG_ABILITY_KEY[fa.options[0]];
        if (!assignedKey && fixedKey) {
          // 自动应用（仅在未分配时，且不超过上限）
          var curVal = Number(st.scores[fixedKey] != null ? st.scores[fixedKey] : (st.baseScores && st.baseScores[fixedKey] != null ? st.baseScores[fixedKey] : 8));
          if (curVal + fa.amount <= 20) {
            fa.allocation[fixedKey] = fa.amount;
            st.scores[fixedKey] = clampScore(curVal + fa.amount);
            assignedKey = fixedKey;
          } else {
            try { showToast('「' + fn + '」：' + fa.options[0] + ' 已达上限 20，无法再加 +' + fa.amount, 'error'); } catch (e) {}
          }
        }
        token = '<span class="cb2-asi-token used" data-asi-src="feat-' + fn + '" title="固定加算：' + fa.options[0] + ' +' + fa.amount + '（上限 20）">+' + fa.amount + ' ' + esc(fa.options[0]) + '</span>';
      } else {
        token = '<span class="cb2-asi-token' + (assignedKey ? ' used' : '') + '" draggable="true" data-asi-src="feat-' + fn + '" data-asi-slot="0" data-asi-label="专长+' + fa.amount + '" title="' + (assignedKey ? '已分配：' + (ABILITIES_MAP[assignedKey] || assignedKey) : '拖到属性上分配 +' + fa.amount) + '">+' + fa.amount + '</span>';
      }
      rows.push('<div class="cb2-asi-src">' +
        '<div class="cb2-asi-src-t">⭐ 专长 · ' + esc(fn) + '<span class="cb2-mini-label" style="margin:0">' + (fa.options && fa.options.length === 1 ? '固定：' + esc(fa.options[0]) : esc(fa.options.join('、'))) + '</span></div>' +
        '<div class="cb2-asi-tokens">' + token + '</div>' +
        '</div>');
    });
    if (!rows.length) {
      el.innerHTML = '<div class="cb2-asi-panel-empty">📊 暂无属性提升来源 — 在「职业」页选择属性提升或专长、「背景」页选择背景后，这里会列出可拖动分配的点数。</div>';
      return;
    }
    el.innerHTML = '<div class="cb2-asi-head">📊 属性提升来源 <span class="cb2-mini-label" style="margin:0">拖动 +N 点数到上方 6 项属性槽完成分配（点击属性上的来源标签可移除）</span></div>' + rows.join('');
  }

  function renderBgAttrPanel() {
    var el = $id('cb2c-bg-attr-panel');
    if (!el) return;
    if (st.ruleVersion !== '2024') { el.innerHTML = ''; return; }
    // 未固定基础属性：不显示属性提升相关配置（也不预览）
    if (!st.baseFixed) { el.innerHTML = ''; return; }
    var titleName = st.background === '自定义背景' && st.customBg ? (st.customBg.name || '自定义背景') : st.background;
    if (!st.background) {
      el.innerHTML = '<div class="cb2-bgattr-panel"><b>📜 背景属性提升</b><div class="cb2-mini-label">选择背景后，在本页「属性提升来源」中拖动分配背景提供的属性加值。</div></div>';
      return;
    }
    if (st.baseFixed) {
      var mode = st.bgAttrMode || (st.bgApplied && st.bgApplied.mode) || '21';
      var appliedTxt = '未应用';
      if (st.bgApplied && st.bgApplied.allocation) {
        appliedTxt = ABILITIES.map(function (a) {
          var add = st.bgApplied.allocation[a.key] || 0;
          return add ? a.name + ' +' + add : '';
        }).filter(Boolean).join('、') || '未应用';
      }
      el.innerHTML = '<div class="cb2-bgattr-panel"><div class="cb2-bg-card-t">📜 背景属性提升 <span class="cb2-bg-card-tag">' + esc(titleName || '未命名背景') + '</span></div>' +
        '<div class="cb2-mini-label">已并入「属性提升来源」面板（下方）：' + esc(appliedTxt) + '</div></div>';
      return;
    }
    var allow = bgAllowedAbilities();
    var mode = st.bgAttrMode || (st.bgApplied && st.bgApplied.mode) || '21';
    var keys = normalizedBgAttrKeys(mode, st.bgAttrKeys || (st.bgApplied && st.bgApplied.abilities));
    var need = mode === '111' ? 3 : 2;
    var labels = mode === '21' ? ['主属性 +2', '副属性 +1'] : ['属性 +1', '属性 +1', '属性 +1'];
    var selects = '';
    for (var i = 0; i < need; i++) {
      var cur = keys[i] || '';
      selects += '<label class="cb2-mini-label">' + labels[i] + '</label><select class="cb2-in cb2-in-sm" data-bg-attrkey data-idx="' + i + '" style="max-width:132px">' +
        allow.map(function (n) {
          var taken = false;
          for (var j = 0; j < need; j++) if (j !== i && keys[j] === n) taken = true;
          return '<option value="' + esc(n) + '"' + (cur === n ? ' selected' : '') + (taken ? ' disabled' : '') + '>' + esc(n) + '</option>';
        }).join('') + '</select>';
    }
    var proof = '';
    if (st.bgApplied && st.bgApplied.allocation) {
      proof = '<div class="cb2-bgattr-proof">' + ABILITIES.map(function (a) {
        var add = st.bgApplied.allocation[a.key] || 0;
        if (!add) return '';
        var before = st.bgApplied.before && st.bgApplied.before[a.key];
        var after = st.bgApplied.after && st.bgApplied.after[a.key];
        return '<span class="cb2-tag">' + esc(a.name) + ' +' + add + '：' + before + ' → ' + after + '</span>';
      }).join('') + '</div>';
    }
    el.innerHTML = '<div class="cb2-bgattr-panel"><div class="cb2-bg-card-t">📜 背景属性提升 <span class="cb2-bg-card-tag">' + esc(titleName || '未命名背景') + '</span></div>' +
      '<div class="cb2-attr-plan-row"><div class="cb2-attr-plan' + (mode === '21' ? ' on' : '') + '" data-act="bg-attr-mode" data-mode="21"><div class="cb2-attr-plan-t">方案 A</div><div class="cb2-attr-plan-v">+2 / +1</div></div>' +
      '<div class="cb2-attr-plan' + (mode === '111' ? ' on' : '') + '" data-act="bg-attr-mode" data-mode="111"><div class="cb2-attr-plan-t">方案 B</div><div class="cb2-attr-plan-v">三项各 +1</div></div>' +
      '<button type="button" class="cb2-btn sm cb2-attr-undo" data-act="bg-attr-undo">↩ 撤销</button></div>' +
      '<div class="cb2-row" style="gap:6px;flex-wrap:wrap;align-items:end">' + selects + '</div>' + proof +
      '<div class="cb2-mini-label" style="margin-top:6px">提示：固定基础属性后，背景加值将统一到「属性提升来源」面板中拖动分配。</div>' +
      '</div>';
  }

  function fightingStyleAcBonus() {
    // 战斗风格效果联动（选择槽效果完整显示标准）：效果不只显示原文，还接入派生值
    // 示例：防御风格 → AC +1（选项名以规则数据为准，兼容"防御/Defense"）
    var bonus = 0;
    try {
      var fsSel = (st.classChoices && st.classChoices.fightingStyle) || [];
      if (!fsSel.length) return 0;
      var fsDefName = null;
      if (st.classChoiceData && st.classChoiceData.choices && st.classChoiceData.choices.fightingStyle && st.classChoiceData.choices.fightingStyle.options) {
        st.classChoiceData.choices.fightingStyle.options.forEach(function (o) { if (/防御/.test(o.name || '')) fsDefName = o.name; });
      }
      if (fsSel.some(function (n) { return !!n && (n === fsDefName || /防御/.test(String(n))); })) bonus += 1;
    } catch (e) { /* 联动失败不影响主流程 */ }
    return bonus;
  }

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
    var AC = armorAC(st.armor, mods.dex, st.shield) + fightingStyleAcBonus();
    var speed = defaultSpeed(st.race);
    var cap = carryCapacity(scores.str);
    var init = mods.dex;
    var atk = Math.max(mods.str || 0, mods.dex || 0) + prof;
    var cs = castingStatFor(cls, st.subclass);
    var dc = cs != null ? 8 + prof + (mods[cs] || 0) : null;
    var atkSpell = cs != null ? prof + (mods[cs] || 0) : null;

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
    renderBgAttrPanel();

    SKILLS.forEach(function (s) {
      var t = st.trained[s.name] || '未熟练';
      var b = (mods[ABILITY_KEY[s.ability]] || 0) + (t === '专精' ? prof * 2 : t === '熟练' ? prof : 0);
      setText('cb2c-sk-' + s.name, signed(b));
    });

    var hintEl = $id('cb2c-mode-hint');
    var extraEl = $id('cb2c-mode-extra');
    var noteEl = $id('cb2c-mode-note');
    if (hintEl) {
      if (st.baseFixed) {
        hintEl.innerHTML = '✔ 基础属性已固定为：' + ABILITIES.map(function (a) { return a.name + ' ' + (st.baseScores ? st.baseScores[a.key] : (st.scores[a.key] != null ? st.scores[a.key] : 8)); }).join('、') +
          '。外部来源提升请在下方「属性提升来源」面板分配。';
      } else if (st.mode === 'rolled') hintEl.innerHTML = st.rollPick < 0
        ? '一次性掷出 <b>5 组</b> 属性（每组 4d6 去最低 ×6）。<b>选中一组</b>后进入分配；骰点不可重掷，想重掷只能关闭角色卡重新创建。'
        : '第 <b>' + (st.rollPick + 1) + ' 组</b> 分配中（合计 ' + rollSetSum(st.rollSets[st.rollPick]) + '）：<b>点击骰值选中 → 点击属性槽分配</b>；已分配槽可回收重分；可返回重新选择属性组。';
      else if (st.mode === 'pointbuy') hintEl.innerHTML = '27 点购点（8→0、9→1、10→2、11→3、12→4、13→5、14→7、15→9）。<b>属性值限 8-15</b>，不可低于 3。';
      else if (st.mode === 'array') hintEl.innerHTML = '标准数组 <b>[15, 14, 13, 12, 10, 8]</b> 随机分配至六项属性，可切手动微调。';
      else hintEl.innerHTML = '自由输入 3-20 的属性值（默认 8）。';
    }
    var poolWrap = $id('cb2c-pool-wrap');
    if (st.baseFixed) {
      if (poolWrap) poolWrap.innerHTML = '';
    } else if (st.mode === 'rolled') {
      if (poolWrap) {
        if (st.rollPick < 0) {
          var rollRows = [];
          for (var ri = 0; ri < 5; ri++) {
            var rs = st.rollSets[ri];
            if (rs) {
              rollRows.push('<button type="button" class="cb2-rollset-row" data-act="roll-pick-set" data-i="' + ri + '" title="使用第 ' + (ri + 1) + ' 组并分配属性">' +
                '<span>第 ' + (ri + 1) + ' 组</span>' +
                '<span class="cb2-rollset-chips">' + rs.pool.map(function (v) { return '<i>' + v + '</i>'; }).join('') + '</span>' +
                '<b>合计 ' + rollSetSum(rs) + '</b></button>');
            } else {
              rollRows.push('<button type="button" class="cb2-rollset-row empty" data-act="roll-new-set"' + (ri === st.rollTimes ? '' : ' disabled') + ' title="预留第 ' + (ri + 1) + ' 组">' +
                '<span>第 ' + (ri + 1) + ' 组</span><span>—</span><b>' + (ri === st.rollTimes ? '点击掷骰' : '待掷') + '</b></button>');
            }
          }
          var canRoll = st.rollTimes < 5;
          poolWrap.innerHTML = '<div class="cb2-rollset-list">' + rollRows.join('') + '</div>' +
            '<div class="cb2-rollset-back">' +
            '<button type="button" class="cb2-btn gold sm" data-act="roll-new-set"' + (canRoll ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>' +
            (canRoll ? '🎲 掷出第 ' + (st.rollTimes + 1) + ' 组属性（4d6×6）' : '⏳ 已达 5 组上限（点击某组使用）') + '</button>' +
            '<span class="cb2-rollset-cur">已掷 <b>' + st.rollTimes + '</b>/5 组</span>' +
            '</div>' +
            '<div class="cb2-pool-msg">固定 5 条候选栏；掷出后点击对应行进入属性分配。</div>';
        } else {
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
              return '<button type="button" class="cb2-pool-chip' + (st.pickedIdx === i ? ' sel' : '') + '" draggable="true" data-act="pick-pool" data-i="' + i + '" data-pool-val="' + v + '" title="拖动到属性槽分配，或点击选中后再点击属性槽">' + v + '</button>';
            }).join('') + '</div>' +
            '<div class="cb2-pool-msg">' + (st.pickedIdx >= 0 ? '已选中 <b>' + st.rolledPool[st.pickedIdx] + '</b>，点击上方属性槽分配；或再点骰值取消。' : '把骰值<b>拖到</b>属性槽分配；或点击骰值选中后点击属性槽。') + '</div>';
        }
      }
      if (extraEl) extraEl.innerHTML = ''; // 骰点不可重掷：掷骰由上方按钮控制
    } else if (st.baseFixed) {
      if (extraEl) extraEl.innerHTML = '';
    } else {
      if (poolWrap) poolWrap.innerHTML = '';
      if (extraEl) {
        if (st.mode === 'array') extraEl.innerHTML = '<button type="button" class="cb2-btn gold sm" data-act="shuffle-array">🔀 随机分配标准数组</button>';
        else extraEl.innerHTML = '';
      }
    }
    if (noteEl) {
      if (st.mode === 'pointbuy' && !st.baseFixed) {
        var cost = pointbuyCost(scores);
        var remain = POINTBUY_POINTS - cost;
        noteEl.textContent = '已用 ' + cost + ' / 27 点' + (remain >= 0 ? ' · 剩余 ' + remain : ' · 超支 ' + Math.abs(remain) + '！');
        noteEl.style.color = remain >= 0 ? 'var(--green-l)' : 'var(--red-l)';
      } else {
        noteEl.textContent = '';
        noteEl.style.color = '';
      }
    }
    var savesEl = $id('cb2c-saves');
    if (savesEl) {
      st.saveSources = st.saveSources || {};
      savesEl.innerHTML = ABILITIES.map(function (a) {
        var srcs = st.saveSources[a.key] || [];
        var srcTxt = srcs.length ? '<em>' + esc(srcs.join('+')) + '</em>' : '';
        return '<label class="cb2-save"><input type="checkbox" data-save="' + a.key + '"' + (st.saves[a.key] ? ' checked' : '') + '>' + esc(a.name) + '豁免' + srcTxt + '</label>';
      }).join('');
    }
    var bonusEl = $id('cb2c-bonus');
    if (bonusEl) {
      // 未固定基础属性：不预览任何加值
      if (!st.baseFixed) {
        bonusEl.style.display = 'none';
        bonusEl.innerHTML = '';
      } else {
        var bgInfo = BACKGROUNDS[st.background];
        if (bgInfo && st.bgApplied) {
          var parts = ABILITIES.map(function (a) {
            var add = st.bgApplied.allocation && st.bgApplied.allocation[a.key] || 0;
            return add ? a.name + ' +' + add : '';
          }).filter(Boolean);
          bonusEl.style.display = '';
          bonusEl.innerHTML = '<span class="cb2-bonus-ic">📜</span> 背景「' + esc(st.background) + '」来源加值：<b>' +
            parts.map(function (p) { return esc(p); }).join('、') +
            '</b><span class="cb2-bonus-tip">在本页「属性提升来源」中调整，变更会先撤销旧值再应用新值</span>';
        } else if (st.bgAttrPending && st.mode === 'rolled' && !st.baseFixed) {
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
            '<span class="cb2-bonus-tip">完成分配后写入属性</span>';
        } else {
          bonusEl.style.display = 'none';
          bonusEl.innerHTML = '';
        }
      }
    }
    renderAsiPanel();
    renderBaseFixBar();
  }

  // 译名差异表见模块级 SPELL_NAME_ALIAS（查看层/编辑层共用）；buildSpellAliasIndex 会从子职业
  // raw 字段自动提取更多别名，保证 spellFullInfo 能解析环位与完整效果。
  function buildSpellAliasIndex() {
    // 从子职业数据 raw 字段自动提取"中文名 → 英文名"，再用英文名匹配法术数据 fullName，
    // 建立 st.spellAlias[中文名] = 法术记录（覆盖所有译名差异，不依赖硬编码）
    if (!st.subclassRules) return;
    st.spellAlias = st.spellAlias || {};
    var enIndex = {};
    function normEn(s) { return String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }
    var spellSources = [st.spellsFull, st.schoolByName];
    spellSources.forEach(function (src) {
      if (!src) return;
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (v && v.fullName) {
          var en = String(v.fullName).replace(/^[\u4e00-\u9fa5\s]+/, '');
          if (en && !enIndex[normEn(en)]) enIndex[normEn(en)] = v;
        }
      });
    });
    function walkRaw(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(walkRaw); return; }
      if (Array.isArray(obj.spells) && typeof obj.raw === 'string') {
        (obj.spells || []).forEach(function (nm) {
          if (typeof nm !== 'string' || !nm || st.spellAlias[nm]) return;
          var esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          var m = obj.raw.match(new RegExp(esc + '\\s*([A-Za-z][A-Za-z ' + "'" + '\\-()]*)'));
          if (m && m[1] && m[1].trim()) {
            var rec = enIndex[normEn(m[1].trim())];
            if (rec) st.spellAlias[nm] = rec;
          }
        });
      }
      Object.keys(obj).forEach(function (k) { walkRaw(obj[k]); });
    }
    if (st.subclassRules.classes) walkRaw(st.subclassRules.classes);
  }

  function spellFullInfo(sp) {
    var spellName = sp && typeof sp === 'object' ? sp.name : sp;
    var f = st.spellsFull ? (st.spellsFull[spellName] || null) : null;
    if (!f && st.spellsFull && String(spellName).indexOf('/') >= 0) {
      var parts = String(spellName).split('/');
      for (var pi = 0; pi < parts.length; pi++) {
        if (st.spellsFull[parts[pi]]) { f = st.spellsFull[parts[pi]]; break; }
      }
    }
    // 键名格式兼容（环阶/等级解析兜底标准）：精确失败时前缀匹配（数据键可能为"中文+英文"全名）
    if (!f && st.spellsFull && String(spellName)) {
      var fk0 = Object.keys(st.spellsFull).filter(function (k) { return k.indexOf(String(spellName)) === 0; })[0];
      if (fk0) f = st.spellsFull[fk0];
    }
    // 译名差异兜底（同一法术不同翻译，如"强制决斗"= 数据中的"强令对决"Compelled Duel）：
    // 先查运行时别名索引（从子职业 raw 自动提取），再查内置已知别名表
    if (!f) {
      var aliasRec = (st.spellAlias && st.spellAlias[spellName]) || null;
      if (!aliasRec && SPELL_NAME_ALIAS[spellName]) {
        var al = SPELL_NAME_ALIAS[spellName];
        aliasRec = (st.spellsFull && st.spellsFull[al]) || (st.schoolByName && st.schoolByName[al]) || null;
        if (!aliasRec && st.spellsFull) {
          var ak0 = Object.keys(st.spellsFull).filter(function (k) { return k.indexOf(al) === 0; })[0];
          if (ak0) aliasRec = st.spellsFull[ak0];
        }
        if (!aliasRec && st.schoolByName) {
          var ak1 = Object.keys(st.schoolByName).filter(function (k) { return k.indexOf(al) === 0; })[0];
          if (ak1) aliasRec = st.schoolByName[ak1];
        }
      }
      if (aliasRec) f = aliasRec;
    }
    if (!f && st.schoolByName) {
      var info = st.schoolByName[spellName] || null;
      if (!info && String(spellName).indexOf('/') >= 0) {
        var parts2 = String(spellName).split('/');
        for (var pj = 0; pj < parts2.length; pj++) {
          if (st.schoolByName[parts2[pj]]) { info = st.schoolByName[parts2[pj]]; break; }
        }
      }
      if (!info && String(spellName)) {
        var ik0 = Object.keys(st.schoolByName).filter(function (k) { return k.indexOf(String(spellName)) === 0; })[0];
        if (ik0) info = st.schoolByName[ik0];
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
    if (info && !sourceAllowed(info.source || '')) return false;
    if (st.ruleVersion === '2024') {
      if (name === '印记斩') return false;
      if (info && String(info.source || '').toUpperCase() === 'PHB14') return false;
    }
    if (st.ruleVersion === '2014' && name === '闪耀斩') return false;
    return true;
  }
  function versionSpellList(list) { return (Array.isArray(list) ? list : []).filter(spellVersionAllowed); }
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

  function pruneClassSpellSelections() {
    var activeSource = spellSelectionSource(st.cls, st.subclass);
    st.spellList = st.spellList.filter(function (spell) {
      return !spell.selectedForClass || spell.selectedForClass === activeSource;
    });
  }
  function subclassSpellcastingRule() {
    var exact = st.subclass ? subclassRuleInfo(st.cls, st.subclass) : null;
    return exact && exact.spellcasting ? exact.spellcasting : null;
  }
  function valueAtLevel(map, level, fallback) {
    var result = fallback;
    Object.keys(map || {}).map(Number).sort(function (a, b) { return a - b; }).forEach(function (lv) {
      if (lv <= Number(level || 1)) result = Number(map[String(lv)]);
    });
    return result;
  }
  function classProgressionNumber(cls, level, labels, fallback) {
    var rec = st.classProgression && st.classProgression.classes && st.classProgression.classes[cls];
    var row = rec && rec.levels && rec.levels[String(level)];
    var columns = row && row.columns ? row.columns : {};
    var keys = Object.keys(columns);
    for (var i = 0; i < labels.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].indexOf(labels[i]) >= 0) {
          var raw = String(columns[keys[j]] == null ? '' : columns[keys[j]]).trim();
          if (/^\d+$/.test(raw)) return Number(raw);
        }
      }
    }
    return fallback;
  }
  function renderSpellSection() {
    var body = $id('cb2c-spell-body');
    var count = $id('cb2c-spell-count');
    if (!body) return;
    var cls = st.cls;
    var subclassCasting = subclassSpellcastingRule();
    var isCaster = casterType(cls, st.subclass) != null;
    if (!isCaster) {
      body.innerHTML = '<div class="cb2-hint">「' + esc(cls) + '」当前没有职业法术表。来自魔法物品、专长或自定义规则的法术可在角色卡中手动维护。</div>';
      if (count) count.textContent = '无职业法术';
      return;
    }
    if (!st.spellData || !st.spellData.spellLists) {
      body.innerHTML = '<div class="cb2-loading">⏳ 正在从规则书加载职业法术表…</div>';
      return;
    }
    var listClass = spellListClassFor(cls, st.subclass);
    var lists = st.spellData.spellLists[listClass];
    if (!lists) {
      body.innerHTML = '<div class="cb2-hint">规则书中暂无「' + esc(listClass) + '」法术表（可使用下方自定义接口补充）。</div>';
      return;
    }
    var cantripMax;
    if (subclassCasting) cantripMax = valueAtLevel(subclassCasting.cantripsByLevel, st.level, 0);
    else cantripMax = classProgressionNumber(cls, st.level, ['戏法'], Object.prototype.hasOwnProperty.call(CANTRIP_BASE, cls) ? CANTRIP_BASE[cls] + Math.floor(st.level / 4) : 0);
    var castStat = castingStatFor(cls, st.subclass);
    var castMod = castStat ? abilityMod(st.scores[castStat]) : 0;
    var prepMax = subclassCasting
      ? valueAtLevel(subclassCasting.preparedByLevel, st.level, 0)
      : classProgressionNumber(cls, st.level, ['准备法术', '已知法术'], Math.max(1, castMod + Math.max(1, st.level)));
    var slotsNow = spellSlotsFor(cls, st.level, st.subclass);
    var maxRing = 0;
    Object.keys(slotsNow).forEach(function (ring) { if (Number(slotsNow[ring]) > 0) maxRing = Math.max(maxRing, Number(ring)); });

    var availRings = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(function (lv) {
      if (lv > 0 && lv > maxRing) return st.spellList.some(function (s) { return Number(s.level) === lv; });
      var arr = versionSpellList(lists[String(lv)] || lists[lv] || []);
      if (arr.length) return true;
      if (lv === 0) {
        // 环阶/等级解析兜底标准：戏法分组 tab 只允许规则书定义（职业法表含戏法 / 子职业施法要求戏法），
        // 禁止因个别法术记录环阶错误（如数据缺失被默认 0）而凭空出现戏法 tab
        return !!(subclassCasting && Array.isArray(subclassCasting.requiredCantrips) && subclassCasting.requiredCantrips.length);
      }
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

    var curRing = st.spellRing;
    var arr = (curRing > 0 && curRing > maxRing) ? [] : versionSpellList(lists[String(curRing)] || lists[curRing] || []);
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
    var TG = window.TrpgTag || null;
    function spellChipHtml(sp, isOn, curRing) {
      var detailText = spellDetailText(sp);
      if (TG && typeof TG.chip === 'function') {
        var chip = TG.chip({
          name: sp,
          type: 'spell',
          active: isOn,
          desc: detailText || sp,
          source: (spellFullInfo(sp) || {}).source || '',
          system: ctx && ctx.system,
          dataAct: 'spell',
          dataName: sp,
          title: sp
        });
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

    function limitBar(label, used, max, hint) {
      var p = max > 0 ? Math.min(100, Math.round(used / max * 100)) : 0;
      var over = used > max;
      return '<div class="cb2-limit-row" title="' + esc(hint || '') + '"><span class="lb">' + label + '</span>' +
        '<div class="cb2-bar"><div class="cb2-bar-fill' + (over ? ' over' : '') + '" style="width:' + p + '%"></div></div>' +
        '<span class="cnt' + (over ? ' over' : '') + '">' + used + ' / ' + max + (over ? ' ⚠超限' : '') + '</span></div>';
    }
    var usedCount = st.spellList.length;
    var cantripCount = st.spellList.filter(function (s) { return Number(s.level) === 0; }).length;
    var nonCantrip = st.spellList.filter(function (s) {
      return Number(s.level) > 0 && !s.alwaysPrepared && !s.granted;
    }).length;
    var limitHtml = '<div class="cb2-mini-label">' +
      limitBar('戏法', cantripCount, cantripMax, subclassCasting ? (st.subclass + '施法表：Lv' + st.level + ' 可掌握 ' + cantripMax + ' 道戏法') : (cls + '职业成长表：Lv' + st.level + ' 可掌握 ' + cantripMax + ' 道戏法')) +
      limitBar('准备法术', nonCantrip, prepMax, subclassCasting ? (st.subclass + '施法表：Lv' + st.level + ' 可准备 ' + prepMax + ' 道一环及以上法术') : (cls + '职业成长表：Lv' + st.level + ' 可准备 ' + prepMax + ' 道法术')) +
      '</div>';

    var manualLevelOptions = (cantripMax > 0 || availRings.indexOf(0) >= 0) ? '<option value="0">戏法</option>' : '';
    manualLevelOptions += [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (r) { return '<option value="' + r + '">' + r + '环</option>'; }).join('');
    var spellSourceToggle = '<div class="cb2-source-switch" style="margin-bottom:8px"><label class="cb2-save"><input type="checkbox" checked disabled> 官方扩展</label><label class="cb2-save"><input type="checkbox" id="cb2c-src-thirdparty-spell"' + (st.contentSources && st.contentSources.thirdParty ? ' checked' : '') + '> 第三方扩展</label></div>';
    var manualHtml = '<div class="cb2-row" style="margin-top:8px">' +
      '<input type="text" class="cb2-in" id="cb2c-spell-input" placeholder="输入法术名（自动匹配职业法术表环位）" list="cb2c-spell-dl" style="flex:1">' +
      '<datalist id="cb2c-spell-dl">' + allSpellNames(lists).map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
      '<select class="cb2-in cb2-in-sm" id="cb2c-spell-level">' + manualLevelOptions + '</select>' +
      '<button type="button" class="cb2-btn gold sm" data-act="spell-add">＋ 添加</button>' +
      '</div>';

    body.innerHTML = spellSourceToggle + selectedHtml.replace('cb2-selected-box', 'cb2-selected-box top') + limitHtml + ringTabs + chipHtml + manualHtml;
    var warning = (cantripCount > cantripMax || nonCantrip > prepMax) ? ' · 超出当前等级上限' : '';
    if (count) count.textContent = '已选 ' + usedCount + ' 个' + warning;
  }

  function allEquipNames() {
    var names = [];
    if (st.equipData && st.equipData.equipment) {
      Object.keys(st.equipData.equipment).forEach(function (cat) {
        (st.equipData.equipment[cat] || []).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
      });
    }
    return names;
  }
  function findEquipCat(name) {
    if (!st.equipData || !st.equipData.equipment) return null;
    var hit = null;
    Object.keys(st.equipData.equipment).forEach(function (cat) {
      if (hit) return;
      if ((st.equipData.equipment[cat] || []).indexOf(name) >= 0) hit = cat;
    });
    return hit;
  }
  function allSpellNames(lists) {
    var names = [];
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (lv) {
      var arr = lists ? versionSpellList(lists[String(lv)] || lists[lv] || []) : [];
      arr.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    });
    if (st.spellsFull) Object.keys(st.spellsFull).forEach(function (name) {
      var info = st.spellsFull[name] || {};
      if (!sourceAllowed(info)) return;
      var clsNames = info.classes || [];
      if (clsNames.length && st.cls && clsNames.indexOf(spellListClassFor(st.cls, st.subclass)) < 0) return;
      if (names.indexOf(name) < 0) names.push(name);
    });
    return names.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
  }
  function applyStartingEquip(optLabel) {
    var eq = CLASS_STARTING_EQUIP[st.cls];
    if (!eq || !eq.options || !eq.options.length) {
      st.equipChoice = '';
      st.equipGold = 0;
      decrementItemsByNames(st.equipAppliedItems || []);
      st.equipAppliedItems = [];
      renderEquipSection();
      return;
    }
    var opt = null;
    for (var i = 0; i < eq.options.length; i++) if (eq.options[i].label === optLabel) { opt = eq.options[i]; break; }
    if (!opt) {
      var keep = null;
      eq.options.forEach(function (o) { if (o.label === st.equipChoice) keep = o.label; });
      optLabel = keep || eq.options[0].label;
      eq.options.forEach(function (o) { if (o.label === optLabel) opt = o; });
    }
    decrementItemsByNames(st.equipAppliedItems || []);
    st.equipChoice = opt.label;
    st.equipGold = opt.gold || 0;
    var optItems = replaceToolPlaceholder(opt.items || [], st.toolProfs);
    st.equipAppliedItems = addGrantedItems(optItems, '职业·' + st.cls + '·起始装备' + opt.label);
    var firstArmor = optItems.filter(function (n) { return ARMOR_LIST.indexOf(n) >= 0; })[0];
    if (firstArmor && st.armor === '无甲') {
      st.armor = firstArmor;
      st.items.forEach(function (x) { if (x.name === firstArmor) x.equipped = true; });
    }
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
  function fmtGP(gp) {
    gp = Number(gp) || 0;
    if (gp >= 1) return (gp % 1 === 0 ? gp : gp.toFixed(2)) + ' GP';
    var sp = gp * 10;
    if (sp >= 1) return (sp % 1 === 0 ? sp : sp.toFixed(2)) + ' SP';
    return Math.round(gp * 100) + ' CP';
  }
  function itemPrice(name) {
    if (!name || !st.equipPrices) return null;
    var p = st.equipPrices[name];
    return (p == null || p === '') ? null : Number(p);
  }
  function itemRuleDetail(name) {
    return st.equipDetails && st.equipDetails[name] ? st.equipDetails[name] : null;
  }
  function itemDetailText(it) {
    var name = it && it.name ? it.name : it;
    var d = itemRuleDetail(name) || {};
    var parts = [];
    parts.push('类别：' + (it && it.category || d.category || findEquipCat(name) || '杂物'));
    var p = it && it.price != null && it.price !== '' ? Number(it.price) : (d.price != null ? Number(d.price) : itemPrice(name));
    if (p != null && !isNaN(p)) parts.push('价格：' + fmtGP(p));
    if (d.weight || (it && it.weight)) parts.push('重量：' + (d.weight || it.weight));
    if (d.baseAC != null) parts.push('护甲等级：' + d.baseAC + (d.maxDex != null && d.maxDex < 10 ? '，敏捷上限 +' + d.maxDex : '') + (d.strReq ? '，力量需求 ' + d.strReq : ''));
    if (d.damage || (it && it.damageFormula)) parts.push('伤害：' + (d.damage || it.damageFormula) + ' ' + (d.damageType || (it && it.damageType) || ''));
    if ((d.properties && d.properties.length) || (it && it.properties && it.properties.length)) parts.push('武器属性：' + ((d.properties || it.properties || []).join('、')));
    if (d.mastery || (it && it.mastery)) parts.push('精通：' + (d.mastery || it.mastery));
    if (d.contents && d.contents.length) parts.push('包含：' + d.contents.join('、'));
    if (d.desc || (it && it.desc)) parts.push(String(d.desc || it.desc));
    if (d.source) parts.push('来源：' + d.source);
    return parts.filter(Boolean).join('\n');
  }
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
    var rd = itemRuleDetail(name);
    if (rd) {
      if (!item.category || item.category === '杂物') item.category = rd.category || item.category;
      if ((item.price == null || item.price === '') && rd.price != null) item.price = Number(rd.price);
      if (rd.weight && !item.weight) item.weight = rd.weight;
      if (rd.desc && !item.desc) item.desc = rd.desc;
      if (rd.contents && !item.contents) item.contents = rd.contents.slice ? rd.contents.slice() : rd.contents;
      if (rd.canEquip === false) { item.canEquip = false; item.equipped = false; }
      if (rd.equipSlot && !item.equipSlot) item.equipSlot = rd.equipSlot;
    }
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
      item.equipSlot = 'weapon';
      item.canEquip = true;
      item.desc = item.desc || [item.damageFormula ? '伤害 ' + item.damageFormula + ' ' + item.damageType : '', item.properties.length ? '属性：' + item.properties.join('、') : '', item.mastery ? '精通：' + item.mastery : ''].filter(Boolean).join('\n');
    }
    var ai = ARMOR_INFO[name];
    if (ai) {
      item.category = armorCat(name) || item.category || '护甲';
      item.baseAC = ai.baseAC;
      item.maxDex = ai.maxDex;
      item.strReq = ai.strReq || 0;
      item.equipSlot = 'armor';
      item.canEquip = true;
      item.desc = item.desc || '护甲等级 ' + ai.baseAC + (ai.maxDex < 10 ? '；敏捷加值上限 +' + ai.maxDex : '') + (ai.strReq ? '；力量需求 ' + ai.strReq : '');
    }
    var kit = st.kitData && st.kitData[name];
    if (kit) {
      item.category = '冒险套组';
      item.equipSlot = '';
      item.canEquip = false;
      item.equipped = false;
      item.contents = Array.isArray(kit.contents) ? kit.contents.slice() : [];
      if ((item.price == null || item.price === '') && kit.price != null) item.price = Number(kit.price);
      item.desc = item.desc || (item.contents.length ? '包含：' + item.contents.join('、') : '规则套组');
    }
    if (!item.equipSlot) {
      var inferred = itemEquipKind(item);
      item.equipSlot = inferred || '';
      item.canEquip = !!inferred;
      if (!inferred) item.equipped = false;
    }
    return item;
  }
  function chargeableQuantity(it) {
    if (editData) return 0;
    var qty = Math.max(1, Number(it && it.quantity) || 1);
    if (!it || !it.free) return qty;
    return Math.max(0, qty - Math.max(0, Number(it.freeQuantity) || 0));
  }
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
    var ownArmor = st.items.filter(function (it) { return ARMOR_LIST.indexOf(it.name) >= 0; }).map(function (it) { return it.name; });
    var armorOptions = ['无甲'];
    if (st.armor && st.armor !== '无甲' && ownArmor.indexOf(st.armor) < 0) {
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
    var inventoryRows = st.items.map(function (it, i) {
      var kind = itemEquipKind(it);
      var isArmor = kind === 'armor';
      var isWeapon = kind === 'weapon';
      var qty = Number(it.quantity) || 1;
      var unit = it.price != null ? Number(it.price) : null;
      var total = unit != null ? Math.round(unit * qty * 100) / 100 : null;
      var equipped = isArmor ? (st.armor === it.name && it.equipped !== false) : (!!kind && it.equipped === true);
      var descParts = [itemDetailText(it)];
      if (it.free) descParts.push('来源：赠送/起始装备');
      var wp = st.wpnPropsByName ? st.wpnPropsByName[it.name] : null;
      var tgType = isWeapon ? 'weapon' : (isArmor ? 'armor' : (it.category === '冒险套组' ? 'wondrous' : (it.category === '卷轴' ? 'spell' : 'item')));
      var itemTag = (window.TrpgTag && window.TrpgTag.chip) ? window.TrpgTag.chip({
        name: it.name,
        type: tgType,
        extra: '×' + qty,
        source: equipped ? '已装备' : (kind ? '可装备' : (it.free ? '已持有' : '本次采购')),
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
        (kind ? '<button type="button" class="cb2-btn sm' + (equipped ? ' gold' : '') + '" data-act="equip-toggle" data-i="' + i + '" title="' + (equipped ? '卸下' : '装备') + '">' + (equipped ? '已装备' : '装备') + '</button>' : '<span class="cb2-inv-cat" style="color:var(--text-3)">不可装备</span>') +
        '<button type="button" class="cb2-btn sm danger" data-act="equip-del" data-i="' + i + '" title="移除">✕</button>' +
        '</div>';
    }).join('');
    var emptyCount = Math.max(0, 5 - st.items.length);
    for (var emptyI = 0; emptyI < emptyCount; emptyI++) {
      inventoryRows += '<div class="cb2-inv-row empty" data-act="focus-item-add" title="点击前往添加物品">' +
        '<span>＋ 空物品栏</span><span>—</span><span>—</span><span>—</span><span>待添加</span><span> </span></div>';
    }
    var selHtml = '<div class="cb2-selected-box"><div class="lb">🎒 背包（' + st.items.length + ' 件）· 固定显示至少 5 个栏位，数量、价格与装备状态即时联动</div><div class="cb2-inv-list">' +
      inventoryRows + '</div>' + goldHtml + '</div>';
    var html = startRow + armorSelHtml + selHtml;
    if (st.equipData && st.equipData.equipment) {
      var eq = st.equipData.equipment;
      var catSummary = Object.keys(eq).map(function (cat) {
        var arr = Array.isArray(eq[cat]) ? eq[cat] : [];
        if (!arr.length) return '';
        return '<span class="cb2-tag">' + esc(cat) + ' ' + arr.length + '</span>';
      }).join('');
      html += '<details class="cb2-equip-catalog-note"><summary>📚 规则装备库已连接</summary>' +
        '<div class="cb2-mini-label">下方输入物品名会自动匹配类别、价格、是否可装备与规则说明；不再用大面积点选芯片堆叠。</div>' +
        '<div class="cb2-feat-chiprow" style="margin-top:6px">' + catSummary + '</div></details>';
    }
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
      '<input type="text" class="cb2-in" id="cb2c-item-input" placeholder="输入物品名（自动匹配类别、价格、详情）" list="cb2c-item-dl" style="flex:1">' +
      '<datalist id="cb2c-item-dl">' + allEquipNames().map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
      '<input type="number" class="cb2-in cb2-in-sm" id="cb2c-item-qty" min="1" step="1" value="1" style="width:74px" title="数量">' +
      '<select class="cb2-in cb2-in-sm" id="cb2c-item-cat"><option>冒险装备</option><option>杂物</option><option>简易近战武器</option><option>简易远程武器</option></select>' +
      '<button type="button" class="cb2-btn gold sm" data-act="item-add">＋ 添加到背包</button>' +
      '</div>' + scrollHtml +
      '<div class="cb2-mini-label">开卡时输入道具名会按规则价格计入起始采购；编辑现行角色卡时，手动加入背包只增加库存，不自动扣钱，交易扣款交给交易行为处理。起始装备与背景套装为赠送不扣金币；护甲自动更新 AC，「◈」为已装备。</div>';
    body.innerHTML = html;
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

  function refreshSelection() {
    renderSpellSection();
    renderEquipSection();
  }

  var _ptool = { img: null, crop: null, dragging: false };
  function portraitCssPx() { return 340; }

  function openPortraitTool() {
    var sys = (ctx && ctx.system) || '';
    var tid = (ctx && ctx.token && ctx.token.id) || '';
    var adv = (ctx && ctx.adventure) || '默认';
    window.open('/portrait-tool.html?system=' + encodeURIComponent(sys) + '&adventure=' + encodeURIComponent(adv) + '&id=' + encodeURIComponent(tid), '_blank');
  }

  function applyPortraitResult(payload) {
    if (!payload) return;
    var a = payload.assets || payload;
    if (!a.avatarFramed && !a.portrait && !a.avatar) return;
    st.assets = {
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
    function consumePortraitResult(val) {
      if (!val || !(val.assets || val.avatar || val.portrait)) return false;
      applyPortraitResult(val);
      try { showToast('立绘与头像已写入角色卡，保存角色卡后生效', 'ok'); } catch (err) {}
      return true;
    }
    function consumePortraitResultFromStorage() {
      var tid = (ctx && ctx.token && ctx.token.id) || 'new';
      var keys = ['trpg_portrait_result_' + tid, 'trpg_portrait_result'];
      for (var i = 0; i < keys.length; i++) {
        var val = null;
        try { val = JSON.parse(localStorage.getItem(keys[i]) || 'null'); } catch (err) {}
        if (consumePortraitResult(val)) {
          try { localStorage.removeItem(keys[i]); } catch (err) {}
          return true;
        }
      }
      return false;
    }
    window.addEventListener('storage', function (e) {
      if (e.key !== 'trpg_portrait_result' && String(e.key || '').indexOf('trpg_portrait_result_') !== 0) return;
      var val = null;
      try { val = JSON.parse(e.newValue); } catch (err) {}
      if (consumePortraitResult(val)) {
        try { localStorage.removeItem(e.key); } catch (err) {}
      }
    });
    window.addEventListener('message', function (e) {
      var msg = e && e.data;
      if (!msg || msg.type !== 'trpg_portrait_result') return;
      consumePortraitResult(msg.result || msg.assets || msg);
    });
    try {
      var bc = new BroadcastChannel('trpg_portrait');
      bc.onmessage = function (e) { var msg = e && e.data; if (msg && msg.type === 'trpg_portrait_result') consumePortraitResult(msg.result || msg.assets || msg); };
    } catch (err) {}
    window.addEventListener('focus', consumePortraitResultFromStorage);
    setTimeout(consumePortraitResultFromStorage, 120);
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
  function savePortraitAssets() {
    if (!_ptool.img || !_ptool.crop) return;
    var img = _ptool.img;
    var c = _ptool.crop;
    var view = _ptool.view || { fit: 1, dx: 0, dy: 0 };
    var sx0 = (c.cx - view.dx) / view.fit;
    var sy0 = (c.cy - view.dy) / view.fit;
    var sr = c.r / view.fit;
    sx0 = Math.max(0, Math.min(img.width - sr * 2, sx0));
    sy0 = Math.max(0, Math.min(img.height - sr * 2, sy0));
    sr = Math.max(1, Math.min(sr, Math.min(img.width, img.height) / 2));
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
    var pw = 768, ph = 1024;
    var pr = document.createElement('canvas');
    pr.width = pw; pr.height = ph;
    var pctx = pr.getContext('2d');
    var ratio = pw / ph;
    var sw = img.width, sh = sw / ratio;
    if (sh > img.height) { sh = img.height; sw = sh * ratio; }
    var sx = (img.width - sw) / 2;
    var sy = Math.max(0, sy0 - sh * 0.5);
    sy = Math.max(0, Math.min(img.height - sh, sy));
    pctx.drawImage(img, sx, sy, sw, sh, 0, 0, pw, ph);
    var portraitUrl = pr.toDataURL('image/png');
    st.assets = { avatarFramed: framedUrl, portrait: portraitUrl };
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

  // ===== 4.2 DataLoader：数据就绪编排（职业/法术/装备三路并行 → 全部就绪 → onDataReady 重放）=====
  // 规则内容文件化：内容一律来自 compressed/ 数据文件；加载完成统一编排，禁止"先执行后补丁"
  var DATA_LOADED = { class: false, spell: false, equip: false };
  var _dataReadyFns = [];
  function onDataReady(fn) { if (typeof fn === 'function') _dataReadyFns.push(fn); }
  function fireDataReady() {
    if (DATA_LOADED.class && DATA_LOADED.spell && DATA_LOADED.equip) {
      var fns = _dataReadyFns;
      _dataReadyFns = [];
      fns.forEach(function (fn) { try { fn(); } catch (e) {} });
    }
  }
  function loadAllRuleData() { loadClassRuleData(); loadSpellData(); loadEquipData(); }

  function mergeContentFiles(rows) {
    // 规则内容文件化（用户指令确立）：内容来自专门构建的数据文件（compressed/rule_*.json），
    // 加载后合并覆盖内置默认字典（内置仅作离线兜底）。既有引用点全部自动生效。
    try {
      if (rows[5] && rows[5].races) {
        Object.keys(rows[5].races).forEach(function (k) { RACE_FEATURES[k] = rows[5].races[k]; });
        if (rows[5].size) Object.keys(rows[5].size).forEach(function (k) { RACE_SIZE[k] = rows[5].size[k]; });
        if (rows[5].languages) Object.keys(rows[5].languages).forEach(function (k) { RACE_LANGS[k] = rows[5].languages[k]; });
      }
      if (rows[6] && rows[6].backgrounds) {
        Object.keys(rows[6].backgrounds).forEach(function (k) { BACKGROUNDS[k] = rows[6].backgrounds[k]; });
      }
      if (rows[7] && rows[7].classes) {
        Object.keys(rows[7].classes).forEach(function (k) { CLASS_STARTING_EQUIP[k] = rows[7].classes[k]; });
      }
      if (rows[8] && rows[8].classes) {
        var cm = rows[8].classes;
        if (cm.lv1Features) Object.keys(cm.lv1Features).forEach(function (k) { CLASS_LV1_FEATURES[k] = cm.lv1Features[k]; });
        if (cm.profHint) Object.keys(cm.profHint).forEach(function (k) { CLASS_PROF_HINT[k] = cm.profHint[k]; });
        if (cm.toolChoice) Object.keys(cm.toolChoice).forEach(function (k) { CLASS_TOOL_CHOICE[k] = cm.toolChoice[k]; });
        if (cm.cantripBase) Object.keys(cm.cantripBase).forEach(function (k) { CANTRIP_BASE[k] = cm.cantripBase[k]; });
        if (cm.skillCount) Object.keys(cm.skillCount).forEach(function (k) { CLASS_SKILL_COUNT[k] = cm.skillCount[k]; });
        if (cm.saves) Object.keys(cm.saves).forEach(function (k) { SAVE_RECS[k] = cm.saves[k]; });
        if (cm.colors) Object.keys(cm.colors).forEach(function (k) { CLASS_COLORS[k] = cm.colors[k]; });
        if (cm.hitDie) Object.keys(cm.hitDie).forEach(function (k) { CLASS_HD[k] = cm.hitDie[k]; });
      }
    } catch (e) { /* 合并失败保留内置兜底 */ }
  }

  function loadClassRuleData() {
    if (!ctx || typeof ctx.fetch !== 'function') { renderClsFeatHint(); return; }
    var base = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/';
    Promise.all([
      ctx.fetch(base + 'rule_class_progression.json').then(function (r) { return r.json(); }),
      ctx.fetch(base + 'rule_class_choices.json').then(function (r) { return r.json(); }),
      ctx.fetch(base + 'rule_subclasses.json').then(function (r) { return r.json(); }),
      ctx.fetch(base + 'rule_subclass_choices.json').then(function (r) { return r.json(); }),
      ctx.fetch(base + 'rule_feats_full.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
      ctx.fetch(base + 'rule_races.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
      ctx.fetch(base + 'rule_backgrounds.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
      ctx.fetch(base + 'rule_starting_equip.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
      ctx.fetch(base + 'rule_class_meta.json').then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (rows) {
      st.classProgression = rows[0] || null;
      st.classChoiceData = rows[1] || null;
      st.subclassRules = rows[2] || null;
      st.subclassChoiceData = rows[3] || null;
      st.featsFull = (rows[4] && rows[4].feats) || null;
      if (typeof window !== 'undefined') window.__cbFeatsFull = st.featsFull || window.__cbFeatsFull || {};
      mergeContentFiles(rows);
      buildSpellAliasIndex();
      syncClassChoiceFeatures();
      syncSubclassData();
      syncClassGrowthChoices();
      refreshFeatList();
      renderClsFeatHint();
      renderSpellSection();
      renderAsiPanel();
      DATA_LOADED.class = true;
      fireDataReady();
    }).catch(function () { renderClsFeatHint(); DATA_LOADED.class = true; fireDataReady(); });
  }
  function reconcileGrantedSpells() {
    // 环阶/等级解析兜底标准：异步数据加载完成后，校正已添加的"固定/授予"法术记录
    // （环位/学派/描述等与最新解析不一致时修正），禁止"先加错再不管"
    if (!st.spellList || !st.spellList.length) return;
    st.spellList.forEach(function (s) {
      if (!s || !(s.granted || s.grantedBySubclass || s.alwaysPrepared)) return;
      var full = spellFullInfo(s.name) || null;
      if (!full) return;
      if (full.level !== undefined && Number(full.level) >= 0 && Number(full.level) !== Number(s.level)) {
        s.level = Math.max(0, Number(full.level));
      }
      if (full.school && !s.school) s.school = full.school;
      if (full.castingTime && !s.castingTime) s.castingTime = full.castingTime;
      if (full.range && !s.range) s.range = full.range;
      if (full.components && !s.components) s.components = full.components;
      if (full.duration && !s.duration) s.duration = full.duration;
      if (full.concentration != null) s.concentration = !!full.concentration;
      if (full.ritual != null) s.ritual = !!full.ritual;
      if (full.desc && !s.desc) s.desc = full.desc;
    });
  }

  function loadSpellData() {
    var markDone = function () { DATA_LOADED.spell = true; fireDataReady(); };
    try {
      if (!ctx || typeof ctx.fetch !== 'function') { renderSpellSection(); markDone(); return; }
      var url = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spell_lists.json';
      ctx.fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        st.spellData = j || null;
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
          var fUrl = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/rule_spells_full.json';
          ctx.fetch(fUrl).then(function (r3) { return r3.json(); }).then(function (fj) {
            st.spellsFull = (fj && fj.spells) || null;
            buildSpellAliasIndex();
            reconcileGrantedSpells();
            syncSubclassChoiceData();
            renderSpellSection();
            renderClsFeatHint();
            markDone();
          }).catch(function () { st.spellsFull = null; renderSpellSection(); markDone(); });
        }).catch(function () { st.spellSchools = null; renderSpellSection(); markDone(); });
      }).catch(function () { renderSpellSection(); markDone(); });
    } catch (e) { renderSpellSection(); markDone(); }
  }
  function loadEquipData() {
    var markDone = function () { DATA_LOADED.equip = true; fireDataReady(); };
    try {
      if (!ctx || typeof ctx.fetch !== 'function') { renderEquipSection(); markDone(); return; }
      var base = '/Ruler/' + encodeURIComponent(ctx.system || '') + '/compressed/';
      Promise.all([
        ctx.fetch(base + 'rule_equipment.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
        ctx.fetch(base + 'rule_equip_prices.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
        ctx.fetch(base + 'rule_weapon_props.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
        ctx.fetch(base + 'rule_kits.json').then(function (r) { return r.json(); }).catch(function () { return null; }),
        ctx.fetch(base + 'rule_equipment_details.json').then(function (r) { return r.json(); }).catch(function () { return null; })
      ]).then(function (rows) {
        st.equipData = rows[0] || null;
        st.equipPrices = (rows[1] && rows[1].prices) || {};
        st.weaponProps = (rows[2] && rows[2].weapons) || null;
        st.wpnPropsByName = {};
        if (st.weaponProps) Object.keys(st.weaponProps).forEach(function (k) {
          var v = st.weaponProps[k];
          if (v && v.name) st.wpnPropsByName[v.name] = v;
        });
        st.kitData = (rows[3] && rows[3].kits) || null;
        st.equipDetails = (rows[4] && rows[4].equipment) || null;
        st.items = (st.items || []).map(function (it) { return buildCatalogItem(it.name, it.category, it); });
        renderEquipSection();
        markDone();
      }).catch(function () { renderEquipSection(); markDone(); });
    } catch (e) { renderEquipSection(); markDone(); }
  }

  function setMode(mode) {
    st.mode = mode;
    container.querySelectorAll('.cb2-mode-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    if (mode === 'rolled' && (!st.rollSets || !st.rollSets.length)) {
      st.rollSets = [];
      st.rollTimes = 0;
      st.rollPick = -1;
      st.rolledPool = [];
      st.pickedIdx = -1;
      ABILITIES.forEach(function (a) { st.scores[a.key] = null; });
    }
    renderAbilityGrid();
    updateDerived();
  }

  function collect() {
    var nameEl = $id('cb2c-name');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      try { showToast('请先填写角色姓名', 'error'); } catch (e) {}
      return null;
    }
    currentScores();
    if (st.mode === 'rolled' && !st.baseFixed) {
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
    if (st.mode === 'pointbuy' && !st.baseFixed) {
      var cost = pointbuyCost(st.scores);
      if (cost > POINTBUY_POINTS) {
        try { showToast('购点超支：已用 ' + cost + '/27 点', 'error'); } catch (e) {}
        return null;
      }
    }
    if (!editData && !st.baseFixed) {
      fixBaseScores(); // 创建流程：保存前自动固定基础属性
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
    var AC = armorAC(st.armor, mods.dex, st.shield) + fightingStyleAcBonus();
    var speed = defaultSpeed(st.race);
    var init = mods.dex;
    var atk = Math.max(mods.str || 0, mods.dex || 0) + prof;
    var cs = castingStatFor(st.cls, st.subclass);
    var dc = cs != null ? 8 + prof + (mods[cs] || 0) : null;
    var atkSpell = cs != null ? prof + (mods[cs] || 0) : null;

    var skills = {};
    SKILLS.forEach(function (s) {
      skills[s.name] = { ability: s.ability, trained: st.trained[s.name] || '未熟练' };
    });

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
      subclass: st.subclass || '',
      classChoices: JSON.parse(JSON.stringify(st.classChoices || {})),
      classChoiceDetails: JSON.parse(JSON.stringify(st.classChoiceDetails || {})),
      classGrowthChoices: JSON.parse(JSON.stringify(st.classGrowthChoices || {})),
      classFeatureDetails: JSON.parse(JSON.stringify(st.classFeatureDetails || {})),
      subclassChoices: JSON.parse(JSON.stringify(st.subclassChoices || {})),
      subclassChoiceDetails: JSON.parse(JSON.stringify(st.subclassChoiceDetails || {})),
      subclassFeatureDetails: JSON.parse(JSON.stringify(st.subclassFeatureDetails || {})),
      customClass: st.customClass,
      background: bgName,
      bgData: BACKGROUNDS[bgName] ? Object.assign({}, BACKGROUNDS[bgName]) : null,
      toolProfs: st.toolProfs.slice(),
      bgApplied: st.bgApplied ? { mode: st.bgApplied.mode, before: st.bgApplied.before, allocation: st.bgApplied.allocation || {}, after: st.bgApplied.after || {}, abilities: st.bgApplied.abilities || [] } : null,
      bgAttrMode: st.bgAttrMode || (st.bgApplied && st.bgApplied.mode) || '',
      bgAttrKeys: (st.bgAttrKeys || []).slice(),
      contentSources: Object.assign({ official: true, thirdParty: false }, st.contentSources || {}),
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
      baseScores: st.baseScores ? Object.assign({}, st.baseScores) : null,
      featAsi: JSON.parse(JSON.stringify(st.featAsi || {})),
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
      spellSlots: spellSlotsFor(st.cls, level, st.subclass),
      spellSlotsUsed: editData && editData.spellSlotsUsed ? Object.assign({}, editData.spellSlotsUsed) : {},
      spellList: st.spellList.map(function (s) {
        var full = spellFullInfo(s.name) || s || {}; return { name: s.name, fullName: full.fullName || s.fullName || s.name, level: Number(s.level) || Number(full.level) || 0, school: full.school || s.school || '', castingTime: full.castingTime || full.time || s.castingTime || '', range: full.range || s.range || '', components: full.components || s.components || '', duration: full.duration || s.duration || '', concentration: full.concentration != null ? !!full.concentration : !!s.concentration, ritual: full.ritual != null ? !!full.ritual : !!s.ritual, source: full.source || s.source || '', classes: Array.isArray(full.classes) ? full.classes.slice() : (Array.isArray(s.classes) ? s.classes.slice() : []), prepared: s.prepared !== false, alwaysPrepared: !!s.alwaysPrepared, spellbook: !!s.spellbook, granted: !!s.granted, grantedBySubclass: s.grantedBySubclass || '', grantedBySubclassChoice: s.grantedBySubclassChoice || '', selectedForClass: s.selectedForClass || '', desc: full.desc || full.description || s.desc || '' };
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
      bio: typeof st.bio === 'string' ? st.bio : Object.assign({ appearance: '', personality: '', ideals: '', bonds: '', flaws: '' }, st.bio),
      deathSaves: editData && editData.deathSaves ? Object.assign({ success: 0, failure: 0 }, editData.deathSaves) : { success: 0, failure: 0 },
      inspiration: !!(editData && editData.inspiration),
      statuses: editData && Array.isArray(editData.statuses) ? editData.statuses.slice() : [],
      effects: editData && Array.isArray(editData.effects) ? editData.effects.slice() : [],
      rollLog: editData && Array.isArray(editData.rollLog) ? editData.rollLog.slice() : [],
      levelLog: editData && Array.isArray(editData.levelLog) ? editData.levelLog.slice() : []
    };
    return { name: name, displayName: name, color: CLASS_COLORS[st.cls] || '#4ecdc4', data: data };
  }

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
  container.addEventListener('pointerdown', hideSpellTip, true);
  container.addEventListener('scroll', hideSpellTip, true);

  var _dragFromPool = false, _dragFromSlot = null, _dragAsi = null;
  container.addEventListener('dragstart', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var asiSrc = t.getAttribute('data-asi-src');
    if (asiSrc != null && asiSrc !== '' && !t.classList.contains('used')) {
      e.dataTransfer.setData('text/plain', 'asi:' + asiSrc + ':' + (t.getAttribute('data-asi-slot') || '0'));
      e.dataTransfer.effectAllowed = 'move';
      _dragAsi = { src: asiSrc, slot: t.getAttribute('data-asi-slot') || '0' };
      return;
    }
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
  container.addEventListener('dragend', function () { _dragFromPool = false; _dragFromSlot = null; _dragAsi = null; });
  container.addEventListener('dragover', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.getAttribute('data-drop') === 'ab' || (t.getAttribute('data-pool') != null && _dragFromSlot) || (t.getAttribute('data-asi-drop') != null && _dragAsi)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  container.addEventListener('drop', function (e) {
    e.preventDefault();
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var val = e.dataTransfer.getData('text/plain');
    if (val.indexOf('asi:') === 0 && t.getAttribute('data-asi-drop') != null) {
      var parts = val.split(':');
      var asiSrc = parts[1];
      var asiSlot = parts[2] || '0';
      var ability = t.getAttribute('data-ability');
      dispatchAsiDrop(asiSrc, asiSlot, ability);
      return;
    }
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
      }
      return;
    }
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
  function dispatchAsiDrop(src, slot, ability) {
    var k = abilityKeyOf(ability || '');
    if (!k) return;
    if (src === 'bg') {
      // 背景提升：写入 bgAttrKeys 对应槽位（保留其他已应用槽位，允许空槽）
      var mode = st.bgAttrMode || (st.bgApplied && st.bgApplied.mode) || '21';
      var need = mode === '111' ? 3 : 2;
      var idx = Math.min(need - 1, Number(slot) || 0);
      var oldKeys = (st.bgApplied && st.bgApplied.abilities) ? st.bgApplied.abilities.slice() : [];
      var keys = [];
      var allow = bgAllowedAbilities();
      for (var i = 0; i < need; i++) {
        keys.push(i === idx ? ABILITIES_MAP[k] : (oldKeys[i] && allow.indexOf(oldKeys[i]) >= 0 ? oldKeys[i] : ''));
      }
      // 已分配的属性不得重复出现在其他槽
      var usedNames = {};
      keys.forEach(function (n) { if (n) usedNames[n] = true; });
      var dup = -1;
      for (var j = 0; j < need; j++) if (j !== idx && keys[j] === ABILITIES_MAP[k]) dup = j;
      if (dup >= 0) keys[dup] = '';
      st.bgAttrKeys = keys.slice(0, need);
      st.bgAttrMode = mode;
      st.bgAttrPending = false;
      applyBgAttr(mode, st.bgAttrKeys);
      return;
    }
    if (src.indexOf('cls-') === 0) {
      var lv = Number(src.substring(4));
      setClassGrowthAttr(lv, Number(slot) || 0, k);
      return;
    }
    if (src.indexOf('feat-') === 0) {
      var fn = src.substring(5);
      setFeatAsiAttr(fn, k);
      return;
    }
  }
  function removeBgAttrSlot(abilityKey) {
    // 单槽移除（背景来源）：只清被点击属性对应的加值槽，其余槽保留；
    // 禁止用 applyBgAttr(null) 全量撤销（曾导致"点掉一个全部清除"）
    if (!st.bgApplied || !abilityKey) return;
    var mode = st.bgAttrMode || st.bgApplied.mode || '21';
    var need = mode === '111' ? 3 : 2;
    var keys = (Array.isArray(st.bgApplied.abilities) ? st.bgApplied.abilities.slice() : []);
    var found = false;
    for (var i = 0; i < need && i < keys.length; i++) {
      if (keys[i] && abilityKeyOf(keys[i]) === abilityKey) { keys[i] = ''; found = true; break; }
    }
    if (!found) return;
    while (keys.length < need) keys.push('');
    st.bgAttrKeys = keys.slice(0, need);
    st.bgAttrMode = mode;
    st.bgAttrPending = false;
    applyBgAttr(mode, st.bgAttrKeys);
    renderAbilityGrid();
    renderAsiPanel();
    updateDerived();
  }
  function removeClassGrowthSlot(level, abilityKey) {
    // 单槽移除（职业成长来源）：只清该级对应属性的加点，其余槽保留（槽位位置语义不漂移）
    if (!abilityKey) return;
    var key = String(level);
    var c = st.classGrowthChoices && st.classGrowthChoices[key];
    if (!c || !Array.isArray(c.attrs)) return;
    var idx = -1;
    for (var i = 0; i < c.attrs.length; i++) {
      if (c.attrs[i] && abilityKeyOf(c.attrs[i]) === abilityKey) { idx = i; break; }
    }
    if (idx < 0) return;
    setClassGrowthAttr(level, idx, '');
  }
  container.addEventListener('dragstart', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-token"]') : null;
    if (!el || el.classList.contains('used')) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ level: el.getAttribute('data-level'), slot: el.getAttribute('data-slot') }));
  });
  container.addEventListener('dragover', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-target"]') : null;
    if (!el) return;
    e.preventDefault();
    el.classList.add('dragover');
  });
  container.addEventListener('dragleave', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-target"]') : null;
    if (el) el.classList.remove('dragover');
  });
  container.addEventListener('drop', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="class-growth-target"]') : null;
    if (!el) return;
    e.preventDefault();
    el.classList.remove('dragover');
    var payload = {};
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (err) { payload = {}; }
    setClassGrowthAttr(Number(payload.level || el.getAttribute('data-level')) || st.classLevelTab, Number(payload.slot) || 0, el.getAttribute('data-ability'));
  });

  container.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var gfInput = t.getAttribute('data-class-growth-feat-input');
    if (gfInput != null) {
      var lv = Number(gfInput) || 0;
      var q = String(t.value || '').trim();
      // 固定框过滤：不重建框体，只显示/隐藏已有条目
      var box = container.querySelector('[data-class-growth-feat-cands="' + lv + '"]');
      if (!box) return;
      Array.prototype.forEach.call(box.children, function (child) {
        var nm = child.getAttribute && child.getAttribute('data-name') || '';
        child.style.display = (!q || String(nm).indexOf(q) >= 0) ? '' : 'none';
      });
      return;
    }
  });
  // ===== 4.5 事件层：ACT 路由表（白名单分派，禁止巨型 if 链）=====
  // 特殊路由：非 data-act 控件（专长候选/标签移除/模式 tab），命中返回 true
  function routeSpecialClick(e) {
    var t = e.target;
    while (t && t !== container && !t.getAttribute) t = t.parentNode;
    var fcp = t && t.getAttribute && t.getAttribute('data-act') === 'feat-cand-pick' ? t : (t && t.closest ? t.closest('[data-act="feat-cand-pick"]') : null);
    if (fcp) {
      var fcpLv = Number(fcp.getAttribute('data-level')) || 0;
      var fcpName = fcp.getAttribute('data-name') || '';
      setClassGrowthFeat(fcpLv, fcpName);
      var inp = container.querySelector('[data-class-growth-feat-input="' + fcpLv + '"]');
      if (inp) inp.value = fcpName;
      return true;
    }
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
      return true;
    }
    // 仅属性生成模式 tab（.cb2-mode-tab）触发 setMode；禁止劫持带 data-mode 的其他控件
    var m = t;
    while (m && m !== container && !(m.getAttribute && m.getAttribute('data-mode') && m.classList && m.classList.contains('cb2-mode-tab'))) m = m.parentNode;
    if (m && m !== container) {
      setMode(m.getAttribute('data-mode'));
      return true;
    }
    return false;
  }
  // ACT 白名单路由表：act → handler(el, e)。新功能在此登记，禁止再写巨型 if 链。
  var ACT_TABLE = {
    'base-fix': function () { fixBaseScores(); },
    'base-unfix': function () { unfixBaseScores(); },
    'asi-unassign': function (el) {
      var uSrc = el.getAttribute('data-src') || '';
      if (uSrc === 'bg') {
        removeBgAttrSlot(abilityKeyOf(el.getAttribute('data-key') || ''));
      } else if (uSrc.indexOf('cls-') === 0) {
        removeClassGrowthSlot(Number(uSrc.substring(4)), abilityKeyOf(el.getAttribute('data-key') || ''));
      } else if (uSrc.indexOf('feat-') === 0) {
        clearFeatAsiEffects(uSrc.substring(5));
      }
      renderAbilityGrid();
      renderAsiPanel();
      updateDerived();
      refreshFeatList();
      if (uSrc.indexOf('cls-') === 0) renderClsFeatHint();
    },
    'rule-ver': function (el) {
      var rv = el.getAttribute('data-v');
      if (rv === st.ruleVersion) return;
      var oldBg = st.background;
      if (BACKGROUNDS[oldBg]) {
        if (st.bgApplied) applyBgAttr(null);
        applyBgProficiencies(null, null);
        if (st.ruleVersion === '2024') {
          var bf = BACKGROUNDS[oldBg];
          if (bf && bf.feat) {
            removeFeatIfUnused(bf.feat);
            refreshFeatList();
          }
        }
      } else if (oldBg === '自定义背景') {
        if (st.bgApplied) applyBgAttr(null);
        applyBgProficiencies(null, null);
      }
      st.ruleVersion = rv;
      var tipEl = $id('cb2c-rulever-tip');
      if (tipEl) tipEl.textContent = rv === '2024' ? '背景提供 3 项属性提升与 1 个起源专长' : '背景不提供属性提升与专长（2014 规则），技能无专精';
      container.querySelectorAll('.cb2-rulever-btn').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-v') === rv);
      });
      if (BACKGROUNDS[oldBg]) {
        if (rv === '2024') {
          applyBgProficiencies(oldBg, BACKGROUNDS[oldBg]);
          st.bgAttrMode = st.bgAttrMode || '21';
          st.bgAttrKeys = [];
          st.bgAttrPending = false;
          var bInfo = BACKGROUNDS[oldBg];
          if (bInfo && bInfo.feat && st.features.indexOf(bInfo.feat) < 0) {
            st.features.push(bInfo.feat);
            refreshFeatList();
          }
        } else {
          applyBgProficiencies(oldBg, BACKGROUNDS[oldBg]);
        }
      } else if (oldBg === '自定义背景' && st.customBg) {
        applyBgProficiencies('自定义背景', null);
        if (rv === '2024') {
          st.bgAttrMode = st.customBg.attr === '111' ? '111' : '21';
          st.bgAttrKeys = [];
          st.bgAttrPending = false;
        }
      }
      renderBgCard();
      renderAbilityGrid();
      updateDerived();
    },
    'flow-step': function (el) {
      var si = Number(el.getAttribute('data-i')) || 0;
      container.querySelectorAll('.cb2-flow-step').forEach(function (c) {
        c.classList.toggle('cur', Number(c.getAttribute('data-i')) === si);
      });
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
    },
    'flow-prev': function () {
      var curP = 0;
      container.querySelectorAll('.cb2-flow-step').forEach(function (c) {
        if (c.classList.contains('cur')) curP = Number(c.getAttribute('data-i')) || 0;
      });
      var prv = (curP - 1 + STEPS.length) % STEPS.length;
      var tgtP = container.querySelector('.cb2-flow-step[data-i="' + prv + '"]');
      if (tgtP) tgtP.click();
    },
    'flow-next': function () {
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
    },
    'ring': function (el) { st.spellRing = Number(el.getAttribute('data-ring')) || 0; renderSpellSection(); },
    'spell-del': function (el) {
      var sdi = Number(el.getAttribute('data-i'));
      if (st.spellList[sdi]) {
        st.spellList.splice(sdi, 1);
        refreshSelection();
      }
    },
    'start-equip': function (el, e) {
      var optBtn = e.target.closest ? e.target.closest('[data-opt]') : null;
      applyStartingEquip(optBtn ? optBtn.getAttribute('data-opt') : undefined);
    },
    'equip-del': function (el) {
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
    },
    'roll-new-set': function () {
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
    },
    'roll-pick-set': function (el) { enterRollSet(Number(el.getAttribute('data-i'))); },
    'roll-back': function () {
      saveCurrentRollSet();
      st.rollPick = -1;
      st.pickedIdx = -1;
      renderAbilityGrid();
      updateDerived();
    },
    'pick-pool': function (el) {
      var pi = Number(el.getAttribute('data-i'));
      st.pickedIdx = (st.pickedIdx === pi) ? -1 : pi;
      updateDerived();
    },
    'assign-ab': function (el) {
      var abKey = el.getAttribute('data-ab');
      if (st.scores[abKey] != null) {
        st.rolledPool.push(st.scores[abKey]);
        st.scores[abKey] = null;
        st.rolledPool.sort(function (a, b) { return a - b; });
      } else if (st.pickedIdx >= 0 && st.rolledPool[st.pickedIdx] != null) {
        st.scores[abKey] = st.rolledPool[st.pickedIdx];
        st.rolledPool.splice(st.pickedIdx, 1);
        st.pickedIdx = -1;
      } else {
        try { showToast('请先在骰池中点击选择一个骰值，再点属性槽分配', 'error'); } catch (e) {}
        return;
      }
      saveCurrentRollSet();
      renderAbilityGrid();
      updateDerived();
    },
    'shuffle-array': function () {
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
    },
    'spell': function (el) {
      var nm = el.getAttribute('data-name');
      var lv = Number(el.getAttribute('data-level')) || 0;
      var found = -1;
      st.spellList.forEach(function (s, idx) { if (s.name === nm && Number(s.level) === lv) found = idx; });
      if (found >= 0) st.spellList.splice(found, 1);
      else st.spellList.push({ name: nm, level: lv, selectedForClass: spellSelectionSource(st.cls, st.subclass) });
      refreshSelection();
    },
    'spell-add': function () {
      var inEl = $id('cb2c-spell-input');
      var lvEl = $id('cb2c-spell-level');
      var v = inEl ? inEl.value.trim() : '';
      if (!v) return;
      var lv2 = Number(lvEl ? lvEl.value : 0) || 0;
      var activeListClass = spellListClassFor(st.cls, st.subclass);
      var lists = st.spellData && st.spellData.spellLists ? st.spellData.spellLists[activeListClass] : null;
      if (lists) {
        for (var rl = 0; rl <= 9; rl++) {
          var arr = lists[String(rl)] || lists[rl] || [];
          if (arr.indexOf(v) >= 0) { lv2 = rl; break; }
        }
      }
      if (!st.spellList.some(function (s) { return s.name === v && Number(s.level) === lv2; })) {
        st.spellList.push({ name: v, level: lv2, selectedForClass: spellSelectionSource(st.cls, st.subclass) });
      }
      if (inEl) inEl.value = '';
      refreshSelection();
    },
    'item': function (el) {
      var itN = el.getAttribute('data-name');
      var itC = el.getAttribute('data-cat') || '杂物';
      var fi = -1;
      st.items.forEach(function (x, idx) { if (x.name === itN) fi = idx; });
      var isArmorCat = itC === '轻甲' || itC === '中甲' || itC === '重甲';
      if (fi >= 0) {
        st.items.splice(fi, 1);
        if (isArmorCat && st.armor === itN) {
          var others = st.items.filter(function (x) { return (x.category === '轻甲' || x.category === '中甲' || x.category === '重甲'); });
          st.armor = others.length ? others[0].name : '无甲';
        }
      } else {
        var price = itemPrice(itN);
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
    },
    'focus-item-add': function () {
      var addInput = $id('cb2c-item-input');
      if (addInput) { try { addInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} addInput.focus(); }
    },
    'item-add': function () {
      var iIn = $id('cb2c-item-input');
      var iCat = $id('cb2c-item-cat');
      var iQtyEl = $id('cb2c-item-qty');
      var v2 = iIn ? iIn.value.trim() : '';
      var addQty = Math.max(1, Math.floor(Number(iQtyEl ? iQtyEl.value : 1) || 1));
      if (!v2) return;
      var hitCat = findEquipCat(v2);
      var hitPrice = hitCat ? itemPrice(v2) : null;
      var freeManual = !!editData || hitPrice == null;
      if (hitCat) {
        var spentNow = 0;
        st.items.forEach(function (x) { if (x.price != null && x.price > 0) spentNow += Number(x.price) * chargeableQuantity(x); });
        if (!editData && hitPrice != null && hitPrice > 0 && spentNow + hitPrice * addQty > goldBudget()) {
          try { showToast('金币不足：' + esc(v2) + ' ×' + addQty + ' 需 ' + fmtGP(hitPrice * addQty) + '，剩余 ' + fmtGP(Math.max(0, goldBudget() - spentNow)) + '（可先移除部分购买物）', 'error'); } catch (e) {}
          return;
        }
        var isArmorCat = hitCat === '轻甲' || hitCat === '中甲' || hitCat === '重甲';
        var same = st.items.filter(function (x) { return x.name === v2; })[0];
        if (same) {
          same.quantity = (Number(same.quantity) || 1) + addQty;
          if (freeManual) { same.free = true; same.freeQuantity = Math.max(0, Number(same.freeQuantity) || 0) + addQty; }
        } else {
          st.items.push(buildCatalogItem(v2, hitCat, { quantity: addQty, equipped: isArmorCat, price: hitPrice, free: freeManual, freeQuantity: freeManual ? addQty : 0 }));
        }
        if (isArmorCat && (st.armor === '无甲' || !st.items.some(function (x) { return (x.category === '轻甲' || x.category === '中甲' || x.category === '重甲') && x.equipped && x.name !== v2; }))) {
          st.armor = v2;
        }
        var armorSel2 = $id('cb2c-armor');
        if (armorSel2) armorSel2.value = st.armor;
      } else {
        st.items.push(buildCatalogItem(v2, iCat ? iCat.value : '杂物', { quantity: addQty, equipped: false, free: true, freeQuantity: addQty }));
      }
      if (iIn) iIn.value = '';
      if (iQtyEl) iQtyEl.value = 1;
      refreshSelection();
      updateDerived();
    },
    'qty-plus': function (el) { actQtyChange(el, 1); },
    'qty-minus': function (el) { actQtyChange(el, -1); },
    'equip-toggle': function (el) {
      var ei = Number(el.getAttribute('data-i'));
      var eit = st.items[ei];
      if (!eit) return;
      var ek = itemEquipKind(eit);
      if (!ek) { try { showToast('「' + eit.name + '」不是可装备物品', 'error'); } catch (e) {} return; }
      if (ek === 'armor') {
        var putOn = !(st.armor === eit.name && eit.equipped !== false);
        st.items.forEach(function (x) { if (itemEquipKind(x) === 'armor') x.equipped = false; });
        eit.equipped = putOn;
        st.armor = putOn ? eit.name : '无甲';
        var armorSel3 = $id('cb2c-armor');
        if (armorSel3) armorSel3.value = st.armor;
      } else if (ek === 'shield') {
        var shieldOn2 = !eit.equipped;
        st.items.forEach(function (x) { if (itemEquipKind(x) === 'shield') x.equipped = false; });
        eit.equipped = shieldOn2;
        st.shield = shieldOn2;
        var shieldCheck = $id('cb2c-shield');
        if (shieldCheck) shieldCheck.checked = shieldOn2;
      } else {
        eit.equipped = !eit.equipped;
      }
      renderEquipSection();
      updateDerived();
    },
    'scroll-add': function () {
      var spSel2 = $id('cb2c-scroll-spell');
      if (!spSel2 || !spSel2.value) { try { showToast('请先选择要写入卷轴的法术', 'error'); } catch (e) {} return; }
      var opt2 = spSel2.selectedOptions && spSel2.selectedOptions[0];
      var lv3 = opt2 ? Number(opt2.getAttribute('data-lv')) : 1;
      var price3 = lv3 === 0 ? 30 : 50;
      var spentNow2 = 0;
      st.items.forEach(function (x) { if (x.price != null && x.price > 0) spentNow2 += Number(x.price) * chargeableQuantity(x); });
      if (!editData && spentNow2 + price3 > goldBudget()) {
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
        st.items.push({ name: fullName2, category: '卷轴', quantity: 1, price: price3, free: !!editData, freeQuantity: editData ? 1 : 0, spell: spSel2.value, spellLevel: lv3, consumable: true, desc: [scrollName + '：' + spSel2.value, scrollSpell.castingTime ? '施法时间：' + scrollSpell.castingTime : '', scrollSpell.range ? '距离：' + scrollSpell.range : '', scrollSpell.components ? '成分：' + scrollSpell.components : '', scrollSpell.duration ? '持续时间：' + scrollSpell.duration : '', scrollSpell.desc || '', '施放后卷轴消失'].filter(Boolean).join('\n') });
      }
      try { showToast('已购买' + scrollName + '：' + spSel2.value + '（' + fmtGP(price3) + '）', 'ok'); } catch (e) {}
      refreshSelection();
      updateDerived();
    },
    'class-level-tab': function (el) {
      st.classLevelTab = Math.max(1, Math.min(20, Number(el.getAttribute('data-level')) || 1));
      renderClsFeatHint();
    },
    'class-growth-mode-btn': function (el) { setClassGrowthMode(Number(el.getAttribute('data-level')) || st.classLevelTab, el.getAttribute('data-mode')); },
    'class-growth-unassign': function (el) { setClassGrowthAttr(Number(el.getAttribute('data-level')) || st.classLevelTab, Number(el.getAttribute('data-slot')) || 0, ''); },
    'class-growth-target': function (el) {
      var gl = Number(el.getAttribute('data-level')) || st.classLevelTab;
      var gc = (st.classGrowthChoices || {})[String(gl)] || {};
      var slots = growthSlotsForMode(gc.mode === '111' ? '111' : '21');
      var attrs = validGrowthAttrs(gc);
      var free = 0;
      while (free < slots.length && attrs[free]) free++;
      if (free < slots.length) setClassGrowthAttr(gl, free, el.getAttribute('data-ability'));
    },
    'class-growth-type': function (el) { setClassGrowthType(Number(el.getAttribute('data-level')) || st.classLevelTab, el.getAttribute('data-type')); },
    'class-growth-undo': function (el) {
      var glv = Number(el.getAttribute('data-level')) || st.classLevelTab;
      clearClassGrowthEffects(glv);
      if (st.classGrowthChoices) delete st.classGrowthChoices[String(glv)];
      renderAbilityGrid();
      updateDerived();
      refreshFeatList();
      renderClsFeatHint();
    },
    'bg-apply-attr': function () { applyBgAttr('21', normalizedBgAttrKeys('21', st.bgAttrKeys)); },
    'bg-attr-111': function () { applyBgAttr('111', normalizedBgAttrKeys('111', st.bgAttrKeys)); },
    'bg-attr-mode': function (el) {
      var bm = el.getAttribute('data-mode') || '21';
      st.bgAttrMode = bm;
      if (st.baseFixed) {
        if (st.bgApplied) applyBgAttr(null);
        st.bgAttrKeys = [];
        st.bgAttrPending = false;
        renderAbilityGrid();
        renderAsiPanel();
        updateDerived();
      } else {
        st.bgAttrKeys = normalizedBgAttrKeys(bm, st.bgAttrKeys);
        applyBgAttr(bm, st.bgAttrKeys);
      }
    },
    'bg-attr-undo': function () {
      applyBgAttr(null);
      st.bgAttrKeys = [];
      st.bgAttrMode = st.bgAttrMode || '21';
      renderAbilityGrid();
      renderAsiPanel();
      updateDerived();
    },
    'bg-equip-a': function () { applyBgEquip('A'); },
    'bg-equip-b': function () { applyBgEquip('B'); },
    'bg-apply-skills': function () {
      applyBgSkills();
      try { showToast('已勾选背景技能熟练：' + BACKGROUNDS[st.background].skills.join('、'), 'ok'); } catch (e) {}
    },
    'cbg-skill': function (el) {
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
    },
    'cbg-equip-a': function () { st.customBg = st.customBg || {}; st.customBg.equip = 'A'; renderBgCard(); applyCustomBgNow(true); },
    'cbg-equip-b': function () { st.customBg = st.customBg || {}; st.customBg.equip = 'B'; renderBgCard(); applyCustomBgNow(true); },
    'cbg-attr-21': function () { st.customBg = st.customBg || {}; st.customBg.attr = '21'; renderBgCard(); applyCustomBgNow(true); },
    'cbg-attr-111': function () { st.customBg = st.customBg || {}; st.customBg.attr = '111'; renderBgCard(); applyCustomBgNow(true); },
    'cbg-toolcat': function (el) {
      st.customBg = st.customBg || {};
      st.customBg.toolCat = el.value;
      st.customBg.tool = '';
      renderBgCard();
      applyCustomBgNow(true);
    },
    'cbg-tool': function (el) { st.customBg = st.customBg || {}; st.customBg.tool = el.value; applyCustomBgNow(true); },
    'cbg-gold': function (el) { st.customBg = st.customBg || {}; st.customBg.gold = Number(el.value) || 0; applyCustomBgNow(true); },
    'portrait-open': function () {
      var hasLocal = false;
      try { hasLocal = !!(localStorage.getItem('trpg_portrait_source') || ''); } catch (e) {}
      var pf = $id('cb2c-portrait-file');
      if (pf && !hasLocal && !st.assets) { pf.click(); return; }
      openPortraitTool();
    },
    'portrait-remove': function () { removePortraitAssets(); },
    'cls-skill-pick': function (el) {
      var pickName = el.getAttribute('data-name');
      var pickSrcs = st.skillSources && st.skillSources[pickName] ? st.skillSources[pickName] : [];
      var pickOn = pickSrcs.indexOf('职业·' + st.cls) >= 0;
      if (pickOn) {
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
    },
    'feat-add': function () {
      var fIn = $id('cb2c-feat-input');
      var fv = fIn ? fIn.value.trim() : '';
      if (fv && st.features.indexOf(fv) < 0) {
        st.features.push(fv);
        if (fIn) fIn.value = '';
        refreshFeatList();
        if (st.baseFixed && !st.featAsi[fv]) ensureFeatAsi(fv);
        renderAsiPanel();
      }
    },
    'feat-del': function (el) {
      var di = Number(el.getAttribute('data-i'));
      if (st.features[di]) {
        var removedFeatName = st.features[di];
        st.features.splice(di, 1);
        refreshFeatList();
        if (st.featAsi[removedFeatName] && !st.features.some(function (f) { return String(f).indexOf(removedFeatName) >= 0; })) {
          clearFeatAsiEffects(removedFeatName);
          delete st.featAsi[removedFeatName];
          renderAbilityGrid();
          renderAsiPanel();
          updateDerived();
        }
      }
    }
  };
  // qty 增减共用：从 ACT_TABLE 分离的小工具
  function actQtyChange(el, delta) {
    var qi = Number(el.getAttribute('data-i'));
    if (!st.items[qi]) return;
    var qtyItem = st.items[qi];
    var qq = (Number(qtyItem.quantity) || 1);
    if (!editData && delta > 0 && qtyItem.price != null && Number(qtyItem.price) > 0) {
      var spentQty = 0;
      st.items.forEach(function (x) { if (x.price != null && Number(x.price) > 0) spentQty += Number(x.price) * chargeableQuantity(x); });
      if (spentQty + Number(qtyItem.price) > goldBudget()) {
        try { showToast('金币不足：再增加 1 个「' + qtyItem.name + '」需要 ' + fmtGP(qtyItem.price) + '，当前可用 ' + fmtGP(Math.max(0, goldBudget() - spentQty)), 'error'); } catch (e) {}
        return;
      }
    }
    qtyItem.quantity = delta > 0 ? qq + 1 : Math.max(1, qq - 1);
    renderEquipSection();
    updateDerived();
  }
  // click 统一入口：特殊路由 → ACT 查表
  container.addEventListener('click', function (e) {
    if (routeSpecialClick(e)) return;
    var el = e.target;
    while (el && el !== container && !el.getAttribute('data-act')) el = el.parentNode;
    if (!el || el === container) return;
    var act = el.getAttribute('data-act');
    var h = ACT_TABLE[act];
    if (h) h(el, e);
  });

  // ===== 4.5 事件层：change 路由表（ID 精确表 + ID 前缀表，统一模式防属性冲突）=====
  var CHANGE_ID_TABLE = {
    'cb2c-name': function (t) { st.name = t.value; },
    'cb2c-race': function (t) {
      clearRaceChoices(st.race);
      st.race = t.value;
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
    },
    'cb2c-bg': function (t) {
      var newBg = t.value;
      var oldBgF = st.background && BACKGROUNDS[st.background] ? BACKGROUNDS[st.background].feat : '';
      if (oldBgF) removeFeatIfUnused(oldBgF);
      if (BACKGROUNDS[newBg]) {
        if (st.bgApplied) applyBgAttr(null);
        applyBgProficiencies(newBg, BACKGROUNDS[newBg]);
        if (st.ruleVersion === '2024') {
          st.bgAttrMode = st.bgAttrMode || '21';
          st.bgAttrKeys = [];
          st.bgAttrPending = false;
          var bInfo = BACKGROUNDS[newBg];
          if (bInfo && bInfo.feat && st.features.indexOf(bInfo.feat) < 0) {
            st.features.push(bInfo.feat);
            refreshFeatList();
          }
        }
      } else {
        st.background = newBg;
      }
      decrementItemsByNames(st.bgAppliedItems || []);
      st.bgEquipData = null;
      st.bgEquip = '';
      st.bgGold = 0;
      st.bgAppliedItems = [];
      renderBgCard();
      refreshFeatList();
      updateDerived();
    },
    'cb2c-bg-custom': function (t) { st.customBg = st.customBg || {}; st.customBg.name = t.value; },
    'cb2c-cls': function (t) {
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
        removeGeneratedSubclassData();
        clearGeneratedSubclassChoiceEffects();
        st.subclass = '';
        st.classChoices = {};
        st.classChoiceDetails = {};
        Object.keys(st.classGrowthChoices || {}).forEach(function (lv) { clearClassGrowthEffects(Number(lv)); });
        st.classGrowthChoices = {};
        st.classFeatureDetails = {};
        st.subclassChoices = {};
        st.subclassChoiceDetails = {};
        st.subclassFeatureDetails = {};
      }
      applyClassProficiencies(t.value);
      st.cls = t.value;
      pruneClassSpellSelections();
      var wrap = $id('cb2c-custom-cls-wrap');
      if (wrap) wrap.style.display = st.cls === '自定义' ? '' : 'none';
      if (st.cls !== '自定义' && !editData) {
        st.equipChoice = '';
        applyStartingEquip();
      }
      applyClassFeaturesToState(st.cls);
      syncClassChoiceFeatures();
      syncSubclassData();
      syncClassGrowthChoices();
      refreshFeatList();
      renderSubclassSelect();
      renderClsFeatHint();
      updateDerived();
      renderSpellSection();
      renderEquipSection();
    },
    'cb2c-custom-cls': function (t) { st.customClass = t.value; },
    'cb2c-level': function (t) {
      var oldLv = Number(st.level) || 1;
      st.level = Math.max(1, Math.min(20, Number(t.value) || 1));
      t.value = st.level;
      applyClassFeaturesToState(st.cls);
      syncClassChoiceFeatures();
      syncSubclassData();
      syncClassGrowthChoices();
      refreshFeatList();
      renderClsFeatHint();
      updateDerived();
      if (casterType(st.cls, st.subclass) != null) renderSpellSection();
    },
    'cb2c-align': function (t) { st.alignment = t.value; },
    'cb2c-size': function (t) { st.size = t.value; },
    'cb2c-lang': function (t) { st.languages = t.value; },
    'cb2c-src-thirdparty': onThirdPartyToggle,
    'cb2c-src-thirdparty-spell': onThirdPartyToggle,
    'cb2c-wallet': function (t) { st.goldStart = Math.max(0, Number(t.value) || 0); renderEquipSection(); },
    'cb2c-armor': function (t) { st.armor = t.value; updateDerived(); renderEquipSection(); },
    'cb2c-shield': function (t) { st.shield = t.checked; updateDerived(); }
  };
  function onThirdPartyToggle(t) {
    st.contentSources = st.contentSources || { official: true, thirdParty: false };
    st.contentSources.thirdParty = !!t.checked;
    if (st.subclass && subclassNames(st.cls).indexOf(st.subclass) < 0) {
      removeGeneratedSubclassData();
      clearGeneratedSubclassChoiceEffects();
      st.subclass = '';
      st.subclassChoices = {};
    }
    renderClsFeatHint();
    renderSpellSection();
    refreshFeatList();
  }
  var CHANGE_ID_PREFIX = [
    { prefix: 'cb2c-bio-', fn: function (t, id) {
      var bKey = id.slice('cb2c-bio-'.length);
      if (bKey === 'free') {
        // 自由文本形态：原样保存字符串，不拆子字段
        st.bio = String(t.value);
      } else if (bKey === 'appearance' || bKey === 'personality' || bKey === 'ideals' || bKey === 'bonds' || bKey === 'flaws' || bKey === 'backstory') {
        if (typeof st.bio !== 'object' || st.bio === null) st.bio = {};
        st.bio[bKey] = t.value;
      }
    } },
    { prefix: 'cb2c-ab-', fn: function () { currentScores(); updateDerived(); } }
  ];
  container.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    var id = t.id;
    if (CHANGE_ID_TABLE[id]) { CHANGE_ID_TABLE[id](t); return; }
    for (var pi = 0; pi < CHANGE_ID_PREFIX.length; pi++) {
      if (id.indexOf(CHANGE_ID_PREFIX[pi].prefix) === 0) { CHANGE_ID_PREFIX[pi].fn(t, id); return; }
    }
  });

  // ===== 4.5 事件层：change 属性路由表（data-* → handler，顺序匹配）=====
  var CHANGE_ATTR_TABLE = [
    { attr: 'data-class-choice-slot', fn: function (t) {
      var cSlot = t.getAttribute('data-class-choice-slot');
      var idx = Number(t.getAttribute('data-slot')) || 0;
      var def = classChoiceDefinitions(st.cls, Number(st.level) || 1).filter(function (x) { return x.key === cSlot; })[0];
      if (!def) return;
      var arr = Array.isArray(st.classChoices[cSlot]) ? st.classChoices[cSlot].slice() : [];
      var val = t.value || '';
      if (val && arr.indexOf(val) >= 0 && arr[idx] !== val) {
        try { showToast('该选项已经在其他槽位选择。', 'error'); } catch (e) {}
        t.value = arr[idx] || '';
        return;
      }
      arr[idx] = val;
      st.classChoices[cSlot] = orderedUnique(arr.filter(Boolean)).slice(0, def.count);
      syncClassChoiceFeatures();
      refreshFeatList();
      renderClsFeatHint();
      updateDerived();
    } },
    { attr: 'data-subclass-choice-slot', fn: function (t) {
      var scSlot = t.getAttribute('data-subclass-choice-slot');
      var sidx = Number(t.getAttribute('data-slot')) || 0;
      var subDef = subclassChoiceRecord(scSlot);
      if (!subDef) return;
      var subArr = Array.isArray(st.subclassChoices[scSlot]) ? st.subclassChoices[scSlot].slice() : [];
      var subVal = t.value || '';
      if (subVal && subArr.indexOf(subVal) >= 0 && subArr[sidx] !== subVal) {
        try { showToast('该选项已经在其他槽位选择。', 'error'); } catch (e) {}
        t.value = subArr[sidx] || '';
        return;
      }
      subArr[sidx] = subVal;
      st.subclassChoices[scSlot] = orderedUnique(subArr.filter(Boolean)).slice(0, subDef.count);
      syncSubclassChoiceData();
      renderClsFeatHint();
      refreshFeatList();
      renderSpellSection();
      renderSkillRows();
      updateDerived();
    } },
    { attr: 'data-class-subclass-select', fn: function (t) {
      var sv = t.value || '';
      if (!sv) {
        removeGeneratedSubclassData();
        clearGeneratedSubclassChoiceEffects();
        st.subclass = '';
        st.subclassChoices = {};
        syncSubclassData();
        renderClsFeatHint();
        refreshFeatList();
        renderSpellSection();
        updateDerived();
      } else applySubclass(sv);
    } },
    { attr: 'data-class-growth-mode', fn: function (t) { setClassGrowthMode(Number(t.getAttribute('data-class-growth-mode')), t.value); } },
    { attr: 'data-class-growth-attr', fn: function (t) { setClassGrowthAttr(Number(t.getAttribute('data-class-growth-attr')), Number(t.getAttribute('data-slot')) || 0, t.value); } },
    { attr: 'data-class-growth-feat', fn: function (t) { setClassGrowthFeat(Number(t.getAttribute('data-class-growth-feat')), t.value); } },
    { attr: 'data-bg-attrkey', fn: function (t) {
      var bidx = Number(t.getAttribute('data-idx')) || 0;
      st.bgAttrMode = st.bgAttrMode || '21';
      st.bgAttrKeys = normalizedBgAttrKeys(st.bgAttrMode, st.bgAttrKeys);
      st.bgAttrKeys[bidx] = t.value;
      st.bgAttrKeys = normalizedBgAttrKeys(st.bgAttrMode, st.bgAttrKeys);
      applyBgAttr(st.bgAttrMode, st.bgAttrKeys);
    } },
    { attr: 'data-save', fn: function (t) {
      var save = t.getAttribute('data-save');
      st.manualSaves = st.manualSaves || {};
      st.manualSaves[save] = true;
      st.saves[save] = t.checked;
      st.saveSources = st.saveSources || {};
      var autoSrcs = (st.saveSources[save] || []).filter(function (x) { return x !== '自定义'; });
      if (t.checked) {
        if (!st.saveSources[save] || !st.saveSources[save].length) st.saveSources[save] = ['自定义'];
      } else {
        st.saveSources[save] = autoSrcs;
      }
      var savesEl = $id('cb2c-saves');
      if (savesEl) {
        savesEl.innerHTML = ABILITIES.map(function (a) {
          var srcs = st.saveSources[a.key] || [];
          var srcTxt = srcs.length ? '<em>' + esc(srcs.join('+')) + '</em>' : '';
          return '<label class="cb2-save"><input type="checkbox" data-save="' + a.key + '"' + (st.saves[a.key] ? ' checked' : '') + '>' + esc(a.name) + '豁免' + srcTxt + '</label>';
        }).join('');
      }
    } },
    { attr: 'data-sk-sel', fn: function (t) {
      var sk = t.getAttribute('data-sk-sel');
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
            var isClsCand = st.cls && st.cls !== '自定义' && (SKILL_RECS[st.cls] || []).indexOf(sk) >= 0;
            if (isClsCand) {
              var clsQ = CLASS_SKILL_COUNT[st.cls] || (SKILL_RECS[st.cls] || []).length;
              if (clsProfUsed() < clsQ) {
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
        if (!st.skillSources || !st.skillSources[sk] || !st.skillSources[sk].length) {
          st.skillSources = st.skillSources || {};
          st.skillSources[sk] = ['自定义'];
        }
      }
      renderSkillQuota();
      updateDerived();
    } },
    { attr: 'data-tool-sel', fn: function (t) {
      var tl = t.getAttribute('data-tool-sel');
      st.toolProfs = st.toolProfs || [];
      st.toolSources = st.toolSources || {};
      var catArr = TOOL_LISTS[tl] || [];
      st.toolProfs.slice().forEach(function (x) {
        if (catArr.indexOf(x) >= 0) {
          var srcs = st.toolSources[x] || [];
          srcs.slice().forEach(function (src) { removeToolSource(x, src); });
          if (!srcs.length) removeToolSource(x, '自定义');
        }
      });
      if (t.value) {
        st.toolProfs.push(t.value);
        var bgInfo2 = BACKGROUNDS[st.background];
        if (bgInfo2 && bgToolCategory(bgInfo2.tool) === tl) {
          st.toolSources[t.value] = ['背景·' + st.background];
        } else {
          st.toolSources[t.value] = ['自定义'];
        }
      }
    } },
    { attr: 'data-race-choice', fn: function (t) { applyRaceChoice(t.getAttribute('data-race-choice'), t.value); } },
    { attr: 'data-cls-tool', fn: function (t) {
      st.toolProfs = st.toolProfs || [];
      st.toolSources = st.toolSources || {};
      var cats = CLASS_TOOL_CHOICE[st.cls] || [];
      var remove = [];
      cats.forEach(function (c) { TOOL_LISTS[c].forEach(function (x) { remove.push(x); }); });
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
      if (st.equipAppliedItems && st.equipAppliedItems.some(function (n) { return /所选的工匠工具或乐器/.test(String(n)); })) {
        applyStartingEquip(st.equipChoice);
      } else {
        renderEquipSection();
        updateDerived();
      }
    } },
    { attr: 'data-cbg-item-slot', fn: function (t) {
      st.customBg = st.customBg || {};
      var vals = (st.customBg.items || []).slice(0, 5);
      while (vals.length < 5) vals.push('');
      vals[Number(t.getAttribute('data-cbg-item-slot')) || 0] = String(t.value || '').trim();
      st.customBg.items = vals;
      applyCustomBgNow(true);
    } },
    { attr: 'data-cbg-attrkey', fn: function (t) {
      st.customBg = st.customBg || {};
      st.customBg.attrKeys = st.customBg.attrKeys || [];
      var ckIdx = Number(t.getAttribute('data-idx')) || 0;
      st.customBg.attrKeys[ckIdx] = t.value;
      var needN = st.customBg.attr === '111' ? 3 : 2;
      var filled = (st.customBg.attrKeys || []).filter(Boolean).length;
      if (filled >= needN || st.bgApplied) applyCustomBgNow(true);
    } }
  ];
  container.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    for (var ai = 0; ai < CHANGE_ATTR_TABLE.length; ai++) {
      if (t.getAttribute && t.getAttribute(CHANGE_ATTR_TABLE[ai].attr) != null) {
        CHANGE_ATTR_TABLE[ai].fn(t);
        return;
      }
    }
  });

  if (!editData) {
    applyClassProficiencies(st.cls);
    if (st.background && BACKGROUNDS[st.background]) applyBgProficiencies(st.background, BACKGROUNDS[st.background]);
  }
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
  renderClsFeatHint();
  setMode(st.mode);
  renderBaseFixBar();
  container.querySelectorAll('.cb2-sec[data-step]').forEach(function (sec) {
    sec.style.display = (Number(sec.getAttribute('data-step')) === 0) ? (sec.getAttribute('data-orig-display') || '') : 'none';
  });
  var prevBtn0 = $id('cb2c-flow-prev');
  if (prevBtn0) prevBtn0.style.visibility = 'hidden';
  var nextBtn0 = $id('cb2c-flow-next');
  if (nextBtn0) nextBtn0.textContent = '下一步 →';
  if (!editData && CLASS_STARTING_EQUIP[st.cls] && !st.items.length) applyStartingEquip();
  loadAllRuleData();
  if (window.TrpgTag && typeof window.TrpgTag.bindTips === 'function') {
    try { window.TrpgTag.bindTips(container); } catch (e) {}
  }

  done(collect);
}

function register(api) {
  if (api && typeof api.registerCharacterSheet === 'function') {
    api.registerCharacterSheet({ renderCreate: renderCreate, renderDetail: renderDetail });
  }
}
var module = module || { exports: {} };
module.exports = { register: register };

/*__NEXT__*/



