// ── PDF 文本提取（纯 Node 无依赖：zlib 内置解压 + ToUnicode CMap 映射）──
// 用途：gm_read_file 读取 PDF 时提取文本并导出同名 .txt，AI 后续按需读取 txt
// 支持：FlateDecode 压缩流、Identity-H/WinAnsi 字体、bfchar/bfrange 的 ToUnicode CMap、
//       Tj/TJ/'/" 文本操作符（十六进制串与括号字面量）。扫描件（图片型 PDF）无文本层，返回空。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 扫描全部对象（正则定位 N G obj，字节切 body）
function scanObjects(buf) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj/gi;
  const latin = buf.toString('latin1');
  let m;
  while ((m = re.exec(latin)) !== null) {
    const num = parseInt(m[1]);
    const start = m.index + m[0].length;
    const endIdx = buf.indexOf(Buffer.from('endobj'), start);
    if (endIdx < 0) continue;
    objs.set(num, { body: buf.subarray(start, endIdx) });
  }
  return objs;
}

// 拆分对象 body 为字典 + 流字节
function splitDictStream(bodyBuf) {
  const sIdx = bodyBuf.indexOf(Buffer.from('stream'));
  if (sIdx < 0) return { dictStr: bodyBuf.toString('latin1'), streamRaw: null };
  const dictStr = bodyBuf.subarray(0, sIdx).toString('latin1');
  let bodyStart = sIdx + 6;
  if (bodyBuf[bodyStart] === 0x0d) bodyStart++;
  if (bodyBuf[bodyStart] === 0x0a) bodyStart++;
  const eIdx = bodyBuf.indexOf(Buffer.from('endstream'), bodyStart);
  return { dictStr, streamRaw: bodyBuf.subarray(bodyStart, eIdx >= 0 ? eIdx : bodyBuf.length) };
}

// 按 beginbfchar / beginbfrange 分块解析 CMap（cidHex → unicodeHex）
function parseCMap(text) {
  const map = new Map();
  const charBlocks = text.split(/beginbfchar|endbfchar/g);
  for (let i = 1; i < charBlocks.length; i += 2) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = re.exec(charBlocks[i])) !== null) map.set(m[1].toUpperCase(), m[2]);
  }
  const rangeBlocks = text.split(/beginbfrange|endbfrange/g);
  for (let i = 1; i < rangeBlocks.length; i += 2) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = re.exec(rangeBlocks[i])) !== null) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      let dst = parseInt(m[3], 16);
      const w = m[3].length;
      const pad = m[1].length;
      for (let cid = lo; cid <= hi; cid++) {
        map.set(cid.toString(16).toUpperCase().padStart(pad, '0'), dst.toString(16).toUpperCase().padStart(w, '0'));
        dst++;
      }
    }
  }
  return map;
}

// CID/Unicode 码 → 字符
function hexToUnicode(hex, map) {
  const h = hex.toUpperCase();
  const u = map.get(h);
  if (u) {
    if (u.length === 8) {
      return String.fromCharCode(parseInt(u.substring(0, 4), 16), parseInt(u.substring(4, 8), 16));
    }
    const code = parseInt(u, 16);
    return code >= 0x20 ? String.fromCharCode(code) : '';
  }
  const code = parseInt(h, 16);
  return code >= 0x20 ? String.fromCharCode(code) : '';
}

// 内容流中提取文本操作符
function extractTextFromContent(str, map) {
  let out = '';
  const tjRe = /(?:<([0-9A-Fa-f]+)>|\[((?:<[0-9A-Fa-f]+>|\s|-?\d+\.?\d*)*)\]|\(([^()\\]*(?:\\.[^()\\]*)*)\))\s*(?:Tj|TJ|'|")/g;
  let m;
  while ((m = tjRe.exec(str)) !== null) {
    if (m[1] !== undefined) out += hexToUnicode(m[1], map);
    else if (m[2] !== undefined) {
      const arr = m[2].match(/<[0-9A-Fa-f]+>/g) || [];
      arr.forEach(h => { out += hexToUnicode(h.slice(1, -1), map); });
    } else if (m[3] !== undefined) {
      out += m[3].replace(/\\([nrtbf()\\])/g, (s, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || c));
    }
  }
  return out;
}

// 提取 PDF 全部文本（按页面流顺序）
function extractPdfText(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('不是有效的 PDF 文件');
  const objs = scanObjects(buf);
  // 1. 收集全部 ToUnicode CMap
  const cmaps = new Map();
  for (const [, o] of objs) {
    const { dictStr } = splitDictStream(o.body);
    const m = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(dictStr);
    if (!m) continue;
    const refObj = objs.get(parseInt(m[1]));
    if (!refObj) continue;
    const { streamRaw } = splitDictStream(refObj.body);
    if (!streamRaw) continue;
    let cmText = null;
    try { cmText = zlib.inflateSync(streamRaw).toString('latin1'); } catch (e) { cmText = streamRaw.toString('latin1'); }
    const cm = parseCMap(cmText);
    cm.forEach((v, k) => cmaps.set(k, v));
  }
  // 2. 提取页面内容流文本
  const pages = [];
  for (const [, o] of objs) {
    const { dictStr, streamRaw } = splitDictStream(o.body);
    if (!streamRaw || !/FlateDecode/.test(dictStr) || /\/Type\s*\/Page/.test(dictStr)) continue;
    let dec;
    try { dec = zlib.inflateSync(streamRaw); } catch (e) { continue; }
    const str = dec.toString('latin1');
    if (!/BT/.test(str)) continue;
    const text = extractTextFromContent(str, cmaps);
    if (text) pages.push(text);
  }
  const full = pages.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!full) throw new Error('PDF 内未提取到文本（可能为扫描图片型 PDF，无文字层）');
  return full;
}

// 提取并导出同名 .txt（PDF 同目录）；txt 已是最新（mtime >= pdf）时直接复用
function pdfToTxt(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/i, '.txt');
  try {
    const pdfStat = fs.statSync(pdfPath);
    const txtStat = fs.statSync(txtPath);
    if (txtStat.mtimeMs >= pdfStat.mtimeMs) {
      return { text: fs.readFileSync(txtPath, 'utf8'), txtPath, cached: true };
    }
  } catch (e) { /* txt 不存在则重新提取 */ }
  const text = extractPdfText(pdfPath);
  fs.writeFileSync(txtPath, text, 'utf8');
  return { text, txtPath, cached: false };
}

module.exports = { extractPdfText, pdfToTxt };
