// 属性生成规则数据验证（DND五版2024）
var fails = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('FAIL', name, 'got=', got, 'want=', want); }
  else console.log('OK  ', name, '=', JSON.stringify(got));
}

// 1) 购点成本表（玩家手册2024：8-15）
var POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
check('购点成本 8..15', [8,9,10,11,12,13,14,15].map(function(v){return POINT_COST[v];}), [0,1,2,3,4,5,7,9]);

// 2) 标准数组 [15,14,13,12,10,8] 总购点 = 27（应刚好不超支）
var arr = [15,14,13,12,10,8];
var sum = arr.reduce(function(s,v){return s+POINT_COST[v];},0);
check('标准数组购点合计', sum, 27);

// 3) 熟练加值（1-4:+2 5-8:+3 9-12:+4 13-16:+5 17-20:+6）
function prof(l){l=Number(l)||1;if(l>=17)return 6;if(l>=13)return 5;if(l>=9)return 4;if(l>=5)return 3;return 2;}
check('熟练加值 1/4/5/8/9/12/13/16/17/20', [1,4,5,8,9,12,13,16,17,20].map(prof), [2,2,3,3,4,4,5,5,6,6]);

// 4) 属性修正
function abil(s){return Math.floor((Number(s)-10)/2);}
check('属性修正 8/10/14/15/18/20', [8,10,14,15,18,20].map(abil), [-1,0,2,2,4,5]);

// 5) 4d6 取三高：范围 3-18，且均值≈12.24（模拟100000次）
var r = [], i;
for (i = 0; i < 100000; i++) {
  var rolls = [];
  for (var j = 0; j < 4; j++) rolls.push(1 + Math.floor(Math.random() * 6));
  rolls.sort(function(a,b){return b-a;});
  rolls.pop();
  r.push(rolls[0]+rolls[1]+rolls[2]);
}
var min = Math.min.apply(null, r), max = Math.max.apply(null, r);
var mean = r.reduce(function(s,v){return s+v;},0) / r.length;
console.log('INFO 4d6x100000: min=' + min + ' max=' + max + ' mean=' + mean.toFixed(2));
if (min < 3 || max > 18) { fails++; console.log('FAIL 4d6 越界'); }
if (Math.abs(mean - 12.24) > 0.15) { fails++; console.log('FAIL 4d6 均值偏差过大'); }

// 6) 平均生命（d6→4, d8→5, d10→6, d12→7）
function avgHp(die){var f=parseInt(String(die).replace('d',''),10)||8;return Math.ceil(f/2)+1;}
check('平均生命 d6/d8/d10/d12', ['d6','d8','d10','d12'].map(avgHp), [4,5,6,7]);

// 7) 法术DC = 8 + 熟练 + 施法属性修正（1级法师：8+2+3=13）
function dc(prof, mod){return 8+prof+mod;}
check('法术DC 1级法师(INT 16)', dc(prof(1), abil(16)), 13);

console.log(fails === 0 ? '\nALL_PASS' : '\n' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
