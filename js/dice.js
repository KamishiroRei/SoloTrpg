/* ============================================
   TrpgRecode - 通用多变骰子系统
   支持: d4/d6/d8/d10/d12/d20/d100
   表达式: XdY+Z, XdYkH(取高), XdYkL(取低)
   优势/劣势: 2d20k1 / 2d20kl1
   ============================================ */

const DiceSystem = (() => {
  'use strict';

  /**
   * 解析骰子表达式
   * 支持格式:
   *   XdY     - 掷X个Y面骰
   *   XdY+Z   - 掷X个Y面骰，结果加Z
   *   XdY-Z   - 掷X个Y面骰，结果减Z
   *   XdYkH   - 掷X个Y面骰，取最高的H个
   *   XdYklL  - 掷X个Y面骰，取最低的L个
   *   dY      - 等同于 1dY
   * @param {string} expr - 骰子表达式
   * @returns {{ dice: number, sides: number, modifier: number, keepHighest: number|null, keepLowest: number|null } | null}
   */
  function parseExpression(expr) {
    const trimmed = expr.trim().toLowerCase();
    if (!trimmed) return null;

    // 匹配模式: (X)d(Y)(kH|klL)?(+/-Z)?
    const pattern = /^(\d+)?d(\d+)(?:k(\d+))?(?:kl(\d+))?(?:([+-])(\d+))?$/;
    const match = trimmed.match(pattern);

    if (!match) return null;

    const dice = parseInt(match[1]) || 1;
    const sides = parseInt(match[2]);
    const keepH = match[3] ? parseInt(match[3]) : null;
    const keepL = match[4] ? parseInt(match[4]) : null;
    const modSign = match[5] || null;
    const modVal = match[6] ? parseInt(match[6]) : 0;
    const modifier = modSign === '-' ? -modVal : modVal;

    // 校验
    if (dice < 1 || dice > 100) return null;
    if (![4, 6, 8, 10, 12, 20, 100].includes(sides)) return null;
    if (keepH !== null && (keepH < 1 || keepH > dice)) return null;
    if (keepL !== null && (keepL < 1 || keepL > dice)) return null;

    return {
      dice,
      sides,
      modifier,
      keepHighest: keepH,
      keepLowest: keepL
    };
  }

  /**
   * 掷单个骰子
   * @param {number} sides - 面数
   * @returns {number} 1~sides
   */
  function rollOne(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  /**
   * 执行掷骰
   * @param {object} parsed - parseExpression 的返回值
   * @returns {{ total: number, rolls: number[], kept: number[], dropped: number[], modifier: number, expression: string }}
   */
  function roll(parsed) {
    const { dice, sides, modifier, keepHighest, keepLowest } = parsed;

    // 掷所有骰子
    const allRolls = [];
    for (let i = 0; i < dice; i++) {
      allRolls.push(rollOne(sides));
    }

    let kept = [...allRolls];
    let dropped = [];

    // 处理取高
    if (keepHighest !== null) {
      const sorted = [...allRolls].sort((a, b) => b - a);
      kept = sorted.slice(0, keepHighest);
      dropped = sorted.slice(keepHighest);
    }

    // 处理取低
    if (keepLowest !== null) {
      const sorted = [...allRolls].sort((a, b) => a - b);
      kept = sorted.slice(0, keepLowest);
      dropped = sorted.slice(keepLowest);
    }

    const sum = kept.reduce((a, b) => a + b, 0);
    const total = sum + modifier;

    return {
      total,
      rolls: allRolls,
      kept,
      dropped,
      modifier,
      expression: buildExpressionString(parsed)
    };
  }

  /**
   * 构建可读的表达式字符串
   */
  function buildExpressionString(parsed) {
    const { dice, sides, modifier, keepHighest, keepLowest } = parsed;
    let expr = `${dice}d${sides}`;
    if (keepHighest !== null) expr += `k${keepHighest}`;
    if (keepLowest !== null) expr += `kl${keepLowest}`;
    if (modifier > 0) expr += `+${modifier}`;
    else if (modifier < 0) expr += `${modifier}`;
    return expr;
  }

  /**
   * 智能掷骰：自动识别并解析表达式
   */
  function smartRoll(expr) {
    const parsed = parseExpression(expr);
    if (!parsed) return null;
    return roll(parsed);
  }

  /**
   * 格式化掷骰结果显示
   */
  function formatResult(result) {
    const { total, rolls, kept, dropped, modifier, expression } = result;
    let text = `${expression} → **${total}**`;

    if (kept.length < rolls.length || dropped.length > 0) {
      text += ` (取${kept.length}个: [${kept.join(', ')}]`;
      if (dropped.length > 0) {
        text += ` | 弃: [${dropped.join(', ')}]`;
      }
      text += `)`;
    } else if (rolls.length > 1) {
      text += ` ([${rolls.join(', ')}]`;
      if (modifier !== 0) {
        text += ` ${modifier > 0 ? '+' : ''}${modifier}`;
      }
      text += `)`;
    } else if (modifier !== 0) {
      text += ` (${rolls[0]} ${modifier > 0 ? '+' : ''}${modifier})`;
    }

    return text;
  }

  /**
   * 批量优势/劣势掷骰
   */
  function rollAdvantage(modifier = 0) {
    const r1 = rollOne(20);
    const r2 = rollOne(20);
    const adv = Math.max(r1, r2) + modifier;
    const dis = Math.min(r1, r2) + modifier;
    return { r1, r2, modifier, advantageResult: adv, disadvantageResult: dis };
  }

  return {
    parseExpression,
    rollOne,
    roll,
    smartRoll,
    formatResult,
    rollAdvantage
  };
})();

// 导出到全局
if (typeof window !== 'undefined') {
  window.DiceSystem = DiceSystem;
}
