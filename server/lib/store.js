// ── 共享存储工具（会话/冒险/角色目录；从 server.js 拆分，供各路由与引擎注入） ──
// 依赖注入 deps = { fs, path, RULER_DIR, cleanRuleName }
module.exports = function createStore(deps) {
  const { fs, path, RULER_DIR, cleanRuleName } = deps;

  function sessionFilePath(system, adventure, channel) {
    const sys = cleanRuleName(String(system || ''));
    const adv = String(adventure || '默认');
    const ch = String(channel || 'story').replace(/[^a-zA-Z0-9_\-]/g, '_');
    return path.join(RULER_DIR, sys, '存档', adv, 'sessions', ch + '.jsonl');
  }

  // 私聊会话文件（与公屏分开落盘，互不污染）：
  // kind='ai' → private-ai-<频道>.jsonl（GM↔AI 导演指令）
  // kind='pm' → private-pm-<a>-<b>.jsonl（玩家私聊会话对，a<b 字典序归一化，双方同冒险共用一个文件）
  function privateSessionFilePath(system, adventure, kind, key) {
    const sys = cleanRuleName(String(system || ''));
    const adv = String(adventure || '默认');
    const safeKey = String(key || 'x').replace(/[^\w\u4e00-\u9fa5\-]/g, '_').slice(0, 80) || 'x';
    return path.join(RULER_DIR, sys, '存档', adv, 'sessions', `private-${kind}-${safeKey}.jsonl`);
  }

  function repairSessionTools(msgs) {
    const pending = []; // 待匹配的 assistant tool_calls id 队列
    const result = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        m.tool_calls.forEach(tc => { if (tc.id) pending.push(tc.id); });
      } else if (m.role === 'tool' && !m.tool_call_id) {
        m.tool_call_id = pending.shift() || ('call_' + Math.random().toString(36).slice(2, 10));
      }
      result.push(m);
    }
    // 孤儿 tool_calls 自愈：assistant 声明的调用若无对应 tool 消息（工具崩溃/中止残留），
    // 全部未响应则剥离 tool_calls 字段（正文保留），部分未响应则只保留已响应的调用——否则 API 400
    const consumed = new Set(result.filter(m => m.role === 'tool' && m.tool_call_id).map(m => m.tool_call_id));
    for (const m of result) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const remain = m.tool_calls.filter(tc => tc.id && consumed.has(tc.id));
        if (remain.length !== m.tool_calls.length) {
          if (remain.length) m.tool_calls = remain;
          else delete m.tool_calls;
        }
      }
    }
    // 剔除无主工具消息：tool_call_id 未被任何（剥离后的）assistant tool_calls 声明的 tool 消息
    // 留在发送历史里同样会被 API 拒绝（对应 assistant 已被剔除的旧轮结果）
    const declared = new Set();
    for (const m of result) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        m.tool_calls.forEach(tc => { if (tc.id) declared.add(tc.id); });
      }
    }
    return result.filter(m => m.role !== 'tool' || (m.tool_call_id && declared.has(m.tool_call_id)));
  }

  function loadSession(system, adventure, channel) {
    const file = sessionFilePath(system, adventure, channel);
    try {
      if (!fs.existsSync(file)) return [];
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      const msgs = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      const repaired = repairSessionTools(msgs); // 自愈：旧数据缺 tool_call_id / 孤儿 tool_calls（工具崩溃残留）
      if (repaired.length === msgs.length && JSON.stringify(repaired) === JSON.stringify(msgs)) return repaired;
      const slim = repaired
        .map(m => {
          const s = { role: m.role, content: m.content };
          if (m.tool_calls) s.tool_calls = m.tool_calls;
          if (m.tool_call_id) s.tool_call_id = m.tool_call_id;
          if (m.id) s.id = m.id;
          if (m.reasoning_content) s.reasoning_content = m.reasoning_content;
          return JSON.stringify(s);
        })
        .join('\n');
      fs.writeFileSync(file, slim + (slim ? '\n' : ''), 'utf8');
      console.log(`[会话] 已自愈并回写 jsonl（${repaired.length} 条）`);
      return repaired;
    } catch (e) { return []; }
  }

  function appendSession(system, adventure, channel, messages) {
    const file = sessionFilePath(system, adventure, channel);
    return appendToFile(file, messages);
  }

  function appendPrivateSession(system, adventure, kind, key, messages) {
    const file = privateSessionFilePath(system, adventure, kind, key);
    return appendToFile(file, messages);
  }

  function appendToFile(file, messages) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const lines = (Array.isArray(messages) ? messages : [messages])
        .filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.kind === 'pm'))
        .map(m => {
          // 持久化轻量化：保留必要字段；tool 消息必须带 tool_call_id（DeepSeek API 校验必需）
          const slim = { role: m.role, content: m.content };
          if (m.tool_calls) slim.tool_calls = m.tool_calls;
          if (m.reasoning_content) slim.reasoning_content = m.reasoning_content;
          if (m.role === 'tool') slim.tool_call_id = m.tool_call_id || '';
          if (m.kind === 'pm') {
            slim.kind = 'pm'; slim.from = m.from; slim.to = m.to; slim.time = m.time;
          }
          if (m.role === 'user' || m.role === 'assistant') {
            slim.id = m.id || ('m_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
            if (m.edited) slim.edited = true;
            if (m.status === 'retracted') slim.status = 'retracted';
          }
          return JSON.stringify(slim);
        });
      fs.appendFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
      return true;
    } catch (e) { console.error('[会话] 追加失败:', e.message); return false; }
  }

  function loadPrivateSession(system, adventure, kind, key) {
    const file = privateSessionFilePath(system, adventure, kind, key);
    try {
      if (!fs.existsSync(file)) return [];
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      return lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { return []; }
  }

  function listPrivateSessions(system, adventure) {
    const sys = cleanRuleName(String(system || ''));
    const adv = String(adventure || '默认');
    const sessionsDir = path.join(RULER_DIR, sys, '存档', adv, 'sessions');
    const result = { ai: [], pm: [] };
    try {
      if (!fs.existsSync(sessionsDir)) return result;
      fs.readdirSync(sessionsDir).filter(f => /^private-(ai|pm)-.+\.jsonl$/.test(f)).forEach(f => {
        const m = f.match(/^private-(ai|pm)-(.+)\.jsonl$/);
        if (!m) return;
        const kind = m[1];
        const key = m[2];
        const size = fs.statSync(path.join(sessionsDir, f)).size;
        (kind === 'ai' ? result.ai : result.pm).push({ key, size });
      });
    } catch (e) { /* ignore */ }
    return result;
  }

  function characterDir(system, adventure, id) {
    const sys = cleanRuleName(String(system || ''));
    const adv = String(adventure || '默认');
    const cid = String(id || '').replace(/[^a-zA-Z0-9_\-]/g, '_') || 'char';
    return path.join(RULER_DIR, sys, '存档', adv, 'characters', cid);
  }

  function adventureMetaFile(system, adventure) {
    return path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档', String(adventure || '默认'), 'meta.json');
  }

  function loadAdventureMeta(system, adventure) {
    try {
      const f = adventureMetaFile(system, adventure);
      if (!fs.existsSync(f)) return {};
      return JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    } catch (e) { return {}; }
  }

  function saveAdventureMeta(system, adventure, meta) {
    try {
      const f = adventureMetaFile(system, adventure);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(meta, null, 2), 'utf8');
      return true;
    } catch (e) { console.error('[冒险] meta写入失败:', e.message); return false; }
  }

  function adventureStats(system, adventure) {
    const advDir = path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档', String(adventure || '默认'));
    const sessionsDir = path.join(advDir, 'sessions');
    const stats = { channels: 0, messages: 0, lastActiveAt: null, size: 0 };
    try {
      if (fs.existsSync(sessionsDir)) {
        fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')).forEach(f => {
          const fp = path.join(sessionsDir, f);
          stats.channels++;
          try {
            const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
            stats.messages += lines.length;
            stats.size += fs.statSync(fp).size;
            if (lines.length) {
              try {
                const last = JSON.parse(lines[lines.length - 1]);
                if (last && last.time) stats.lastActiveAt = last.time;
              } catch (e) {}
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
    return stats;
  }

  function listAdventures(system) {
    const base = path.join(RULER_DIR, cleanRuleName(String(system || '')), '存档');
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
      const meta = loadAdventureMeta(system, d.name);
      const stats = adventureStats(system, d.name);
      return {
        name: d.name,
        archived: !!meta.archived,
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        createdAt: meta.createdAt || null,
        lastActiveAt: stats.lastActiveAt,
        channels: stats.channels,
        messages: stats.messages,
        size: stats.size
      };
    }).sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return (b.lastActiveAt || '').localeCompare(a.lastActiveAt || '');
    });
  }

  return {
    sessionFilePath, privateSessionFilePath, loadSession, appendSession, appendPrivateSession, loadPrivateSession, listPrivateSessions, repairSessionTools,
    characterDir, adventureMetaFile, loadAdventureMeta, saveAdventureMeta, adventureStats, listAdventures
  };
};
