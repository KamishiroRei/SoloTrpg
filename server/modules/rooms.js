// ── WebSocket / 房间系统（从 server.js 整区原样搬迁） ──
// 依赖注入 ctx = { fs, path, RUNTIME_ROOT, cleanRuleName, appendPrivateSession }；创建 http server + socket.io，返回 { server, io, rooms, onlineNames }
module.exports = function createRooms(app, ctx) {
  const { fs, path, RUNTIME_ROOT, cleanRuleName, appendPrivateSession } = ctx;
// ── WebSocket / 房间系统 ─────────────────────────────

const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 房间管理
const rooms = {}; // { roomCode: { tokens:[], players:{}, hostId:null, createdAt:Date, messages:{} } }
// messages: { [msgId]: { author: socketId, type: 'user'|'ai' } } —— 条目化消息归属表（编辑/撤回权限校验用）


const DATA_DIR = path.join(RUNTIME_ROOT, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');

// 玩家注册表：{ [name]: { createdAt, lastSeenAt } }（持久）
let playerRegistry = {};
// 全局在线表：{ [name]: { socketIds:Set, roomCode, offlineSince } }（内存；offlineSince=null 表示在线）
const onlineNames = {};

function loadPlayerRegistry() {
  try {
    if (fs.existsSync(PLAYERS_FILE)) {
      playerRegistry = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')) || {};
    }
  } catch (e) { console.error('[联机] 玩家注册表加载失败:', e.message); }
}
function savePlayerRegistry() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playerRegistry, null, 1), 'utf8');
  } catch (e) { console.error('[联机] 玩家注册表保存失败:', e.message); }
}
loadPlayerRegistry();

// 房间存档（磁盘恢复：服务端重启后房间仍可按码恢复，玩家名/归属/token 不丢）
function roomArchivePath(code) { return path.join(ROOMS_DIR, String(code).toUpperCase() + '.json'); }
function saveRoomArchive(room) {
  try {
    if (!room || !room.code) return;
    fs.mkdirSync(ROOMS_DIR, { recursive: true });
    const snapshot = {
      code: room.code,
      system: room.system || '',
      adventure: room.adventure || '默认',
      hostName: room.hostName || '',
      gmName: room.gmName || '',
      createdAt: room.createdAt || Date.now(),
      updatedAt: Date.now(),
      // players 只存名字与主机标记（在线状态运行时判定）
      players: Object.keys(room.players || {}).reduce((acc, n) => {
        const p = room.players[n];
        acc[n] = { name: n, isHost: !!(p && p.isHost), role: p && p.role === 'gm' ? 'gm' : 'player' };
        return acc;
      }, {}),
      tokens: (room.tokens || []).map(t => JSON.parse(JSON.stringify(t))),
      mapState: room.mapState ? JSON.parse(JSON.stringify(room.mapState)) : null
    };
    fs.writeFileSync(roomArchivePath(room.code), JSON.stringify(snapshot, null, 1), 'utf8');
  } catch (e) { console.error('[联机] 房间存档失败:', e.message); }
}
function loadRoomArchive(code) {
  try {
    const file = roomArchivePath(code);
    if (!fs.existsSync(file)) return null;
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!snap || !snap.code) return null;
    const room = {
      code: snap.code,
      tokens: Array.isArray(snap.tokens) ? snap.tokens : [],
      mapState: snap.mapState || null,
      players: {},
      hostId: null, // 运行时判定（内存），重启后由 hostName 同名重连恢复
      hostName: snap.hostName || '',
      gmName: snap.gmName || '',
      system: snap.system || '',
      adventure: snap.adventure || '默认',
      createdAt: snap.createdAt || Date.now(),
      messages: {}
    };
    Object.keys(snap.players || {}).forEach((n) => {
      const archivedPlayer = snap.players[n] || {};
      const archivedRole = archivedPlayer.role === 'gm' || (!snap.gmName && archivedPlayer.isHost) ? 'gm' : 'player';
      room.players[n] = { name: n, isHost: !!archivedPlayer.isHost, role: archivedRole, socketIds: [], offlineSince: Date.now() };
      if (archivedRole === 'gm' && !room.gmName) room.gmName = n;
    });
    return room;
  } catch (e) { console.error('[联机] 房间存档加载失败:', e.message); }
  return null;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的 0O1I
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms[code] ? generateRoomCode() : code; // 防重复
}

function getOrCreateRoom(code) {
  if (!rooms[code]) {
    const archived = loadRoomArchive(code);
    if (archived) {
      rooms[code] = archived;
    } else {
      rooms[code] = {
        code,
        tokens: [],
        mapState: null,
        players: {},
        hostId: null,
        hostName: '',
        gmName: '',
        createdAt: Date.now(),
        messages: {}
      };
    }
  }
  return rooms[code];
}

// 玩家名占线检查：名字已注册且当前在线（非宽限期离线）→ 拒绝接管
function isNameTaken(name) {
  const o = onlineNames[name];
  return !!(o && o.socketIds && o.socketIds.size > 0);
}

function normalizeRoomRole(role) {
  return String(role || '').toLowerCase() === 'gm' ? 'gm' : 'player';
}

function isRoomGM(room, socketOrName) {
  if (!room || !socketOrName) return false;
  const name = typeof socketOrName === 'string' ? socketOrName : socketOrName.playerName;
  return !!(name && room.players[name] && room.players[name].role === 'gm');
}

// 玩家接入：注册/恢复身份 + 绑定本 socket
function bindPlayerName(socket, room, name, isHost, role) {
  const now = Date.now();
  socket.playerName = name;
  if (!playerRegistry[name]) {
    playerRegistry[name] = { createdAt: now, lastSeenAt: now };
    savePlayerRegistry();
  } else {
    playerRegistry[name].lastSeenAt = now;
  }
  if (!onlineNames[name]) onlineNames[name] = { socketIds: new Set(), roomCode: null, offlineSince: null };
  onlineNames[name].socketIds.add(socket.id);
  onlineNames[name].roomCode = room ? room.code : onlineNames[name].roomCode;
  onlineNames[name].offlineSince = null; // 宽限期内重连 = 恢复在线
  if (room) {
    if (!room.players[name]) room.players[name] = { name, isHost, role: normalizeRoomRole(role), socketIds: [], offlineSince: null };
    const p = room.players[name];
    p.socketIds = p.socketIds || [];
    if (p.socketIds.indexOf(socket.id) < 0) p.socketIds.push(socket.id);
    p.offlineSince = null;
    if (isHost) p.isHost = true;
    if (role) p.role = normalizeRoomRole(role);
    // 主机玩家也是玩家：不自动授予 GM 角色（除非创建房间时明确选择 GM 或已有人被指定为 GM）
    if (!p.role) p.role = 'player';
    if (p.role === 'gm') room.gmName = name;
    if (room.hostName && name === room.hostName) room.hostId = socket.id;
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = '';

  // ── 创建房间 ──
  socket.on('create_room', (data) => {
    const code = generateRoomCode();
    const room = getOrCreateRoom(code);
    room.hostId = socket.id;
    room.system = String((data && data.system) || '');
    room.adventure = String((data && data.adventure) || '默认');
    const creatorRole = normalizeRoomRole(data && data.role);

    playerName = String((data && data.name) || '').trim() || '房主';
    // 名字在线占用保护：GM 名若已被其他在线玩家使用 → 拒绝创建（不能接管在线者的名字）
    if (isNameTaken(playerName)) {
      socket.emit('room_error', '玩家名「' + playerName + '」已被在线玩家使用，请换一个名字');
      return;
    }
    bindPlayerName(socket, room, playerName, true, creatorRole);
    room.hostName = playerName;
    room.gmName = creatorRole === 'gm' ? playerName : '';

    socket.join(code);
    currentRoom = code;

    socket.emit('room_created', { code, players: room.players, tokens: room.tokens, mapState: room.mapState || null, system: room.system, adventure: room.adventure, myName: playerName, myRole: creatorRole, gmName: room.gmName });
    io.to(code).emit('players_update', room.players);
    saveRoomArchive(room);
    console.log(`[房间] ${code} 创建（房主=${playerName} 角色=${creatorRole} system=${room.system || '无'} adventure=${room.adventure}）`);
  });

  socket.on('join_room', (data) => {
    const code = (data.code || '').toUpperCase();
    if (!rooms[code] && !loadRoomArchive(code)) {
      socket.emit('room_error', '房间不存在');
      return;
    }
    const room = getOrCreateRoom(code);
    const name = String(data.name || '').trim();
    if (name) {
      if (isNameTaken(name)) {
        socket.emit('room_error', '玩家名「' + name + '」已被在线玩家使用（不能接管他人的名字）。若这是你本人（刷新/换设备），请稍候几秒重试，或使用下方"离线玩家"列表选择自己的名字接入。');
        return;
      }
      playerName = name;
    } else {
      // 匿名：自动生成访客名（避免与注册表重名）
      let idx = Object.keys(room.players).length + 1;
      playerName = '访客' + idx;
      while (isNameTaken(playerName) || playerRegistry[playerName]) { idx++; playerName = '访客' + idx; }
    }
    socket.playerName = playerName;
    const savedRole = room.players[playerName] && room.players[playerName].role;
    bindPlayerName(socket, room, playerName, room.hostName === playerName, savedRole || 'player');

    socket.join(code);
    currentRoom = code;

    const isHostBack = socket.id === room.hostId;
    socket.emit('room_joined', { code, players: room.players, tokens: room.tokens, mapState: room.mapState || null, isHost: isHostBack, system: room.system, adventure: room.adventure, myName: playerName, myRole: room.players[playerName] ? room.players[playerName].role : 'player', gmName: room.gmName || '' });
    socket.broadcast.to(code).emit('players_update', room.players);
    io.to(code).emit('chat', { sender: '系统', text: `${playerName} 加入了房间`, time: new Date().toLocaleTimeString('zh-CN') });
    saveRoomArchive(room);
    console.log(`[房间] ${code} ← ${playerName} 加入 (${Object.keys(room.players).length}人)`);
  });

  socket.on('set_role', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    if (socket.id !== room.hostId) {
      socket.emit('perm_denied', { action: 'set_role', message: '只有房主可以指定真人 GM' });
      return;
    }
    const targetName = String((data && data.name) || playerName || '').trim();
    const role = normalizeRoomRole(data && data.role);
    if (!room.players[targetName]) return;
    if (role === 'gm') {
      Object.keys(room.players).forEach(name => { room.players[name].role = name === targetName ? 'gm' : 'player'; });
      room.gmName = targetName;
    } else {
      room.players[targetName].role = 'player';
      if (room.gmName === targetName) room.gmName = '';
    }
    saveRoomArchive(room);
    io.to(currentRoom).emit('players_update', room.players);
    io.to(currentRoom).emit('role_updated', { name: targetName, role, gmName: room.gmName || '' });
    console.log(`[房间] ${currentRoom} 身份更新：${targetName} → ${role}`);
  });

  socket.on('content_update', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    if (socket.id !== room.hostId) return;
    io.to(currentRoom).emit('content_updated', { system: room.system, adventure: room.adventure, by: 'gm', time: new Date().toLocaleTimeString('zh-CN') });
    console.log(`[房间] ${currentRoom} GM内容已更新，通知玩家重载`);
  });


  const relay = (event, data) => {
    if (currentRoom) socket.broadcast.to(currentRoom).emit(event, data);
  };

  const relayAll = (event, data) => {
    if (currentRoom) io.to(currentRoom).emit(event, data);
  };

  const roomMapById = (room, mapId) => {
    if (!room || !room.mapState || !Array.isArray(room.mapState.maps)) return null;
    return room.mapState.maps.find(map => map.id === mapId) || room.mapState.maps.find(map => map.id === room.mapState.activeMapId) || room.mapState.maps[0] || null;
  };

  const findRoomToken = (room, id, mapId) => {
    const preferred = roomMapById(room, mapId);
    if (preferred && Array.isArray(preferred.tokens)) {
      const hit = preferred.tokens.find(token => token.id === id);
      if (hit) return hit;
    }
    if (room && room.mapState && Array.isArray(room.mapState.maps)) {
      for (const map of room.mapState.maps) {
        const hit = Array.isArray(map.tokens) && map.tokens.find(token => token.id === id);
        if (hit) return hit;
      }
    }
    return room && Array.isArray(room.tokens) ? room.tokens.find(token => token.id === id) : null;
  };

  const refreshLegacyRoomTokens = room => {
    const active = roomMapById(room, room && room.mapState && room.mapState.activeMapId);
    if (active && Array.isArray(active.tokens)) room.tokens = active.tokens;
  };

  const canEditToken = (room, token) => {
    if (!token) return false;
    if (isRoomGM(room, socket)) return true;
    return token.owner === socket.playerName;
  };

  socket.on('token_add', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      data.owner = socket.playerName;
      const targetMap = roomMapById(room, data.mapId);
      if (targetMap) {
        if (!Array.isArray(targetMap.tokens)) targetMap.tokens = [];
        if (!targetMap.tokens.some(token => token.id === data.id)) targetMap.tokens.push({ ...data });
        refreshLegacyRoomTokens(room);
      } else if (!room.tokens.some(token => token.id === data.id)) room.tokens.push(data);
      saveRoomArchive(room);
    }
    relay('token_add', data);
  });

  socket.on('token_move', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      const token = findRoomToken(room, data.id, data.mapId);
      if (token) { token.gridX = data.gridX; token.gridY = data.gridY; }
      refreshLegacyRoomTokens(room);
      saveRoomArchive(room);
    }
    relay('token_move', data);
  });

  socket.on('token_update', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      const token = findRoomToken(room, data.id, data.mapId);
      if (!canEditToken(room, token)) {
        socket.emit('perm_denied', { action: 'token_update', id: data.id, message: '该标记由 ' + (token && token.owner ? '玩家「' + token.owner + '」' : '其他玩家') + ' 创建，只有创建者或真人 GM 可修改', token: token || null });
        return;
      }
      if (token) Object.assign(token, data);
      refreshLegacyRoomTokens(room);
      saveRoomArchive(room);
    }
    relay('token_update', data);
  });

  socket.on('token_remove', (data) => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      const token = findRoomToken(room, data.id, data.mapId);
      if (!canEditToken(room, token)) {
        socket.emit('perm_denied', { action: 'token_remove', id: data.id, message: '只有创建者或真人 GM 可删除该角色或地图标记', token: token || null });
        return;
      }
      if (room.mapState && Array.isArray(room.mapState.maps)) {
        room.mapState.maps.forEach(map => { if (Array.isArray(map.tokens)) map.tokens = map.tokens.filter(item => item.id !== data.id); });
      }
      room.tokens = (room.tokens || []).filter(item => item.id !== data.id);
      refreshLegacyRoomTokens(room);
      saveRoomArchive(room);
    }
    relay('token_remove', data);
  });

  socket.on('token_sync_all', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    if (socket.id !== room.hostId && !isRoomGM(room, socket)) return;
    room.tokens = data.tokens || [];
    const active = roomMapById(room, room.mapState && room.mapState.activeMapId);
    if (active) active.tokens = room.tokens;
    saveRoomArchive(room);
    relay('token_sync_all', data);
  });

  socket.on('map_state', (data) => {
    if (!currentRoom || !rooms[currentRoom] || !data || !data.mapState) return;
    const room = rooms[currentRoom];
    if (socket.id !== room.hostId && !isRoomGM(room, socket)) {
      socket.emit('perm_denied', { action: 'map_state', message: '只有房主或真人 GM 可以修改共享地图结构' });
      return;
    }
    room.mapState = data.mapState;
    refreshLegacyRoomTokens(room);
    saveRoomArchive(room);
    relay('map_state', { mapState: room.mapState, by: playerName || 'GM' });
  });

  socket.on('map_overlay', (data) => {
    if (!currentRoom || !rooms[currentRoom] || !data || !data.overlay) return;
    const room = rooms[currentRoom];
    const overlay = data.overlay;
    const map = roomMapById(room, String(overlay.mapId || ''));
    if (!map) return;
    if (Array.isArray(overlay.ranges)) map.ranges = overlay.ranges.filter(item => item && typeof item === 'object');
    if (Array.isArray(overlay.measurements)) map.measurements = overlay.measurements.filter(item => item && typeof item === 'object');
    saveRoomArchive(room);
    relay('map_overlay', {
      overlay: { mapId: map.id, ranges: map.ranges || [], measurements: map.measurements || [] },
      by: playerName || '玩家'
    });
  });

  socket.on('token_transfer', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    if (!isRoomGM(room, socket)) { socket.emit('perm_denied', { action: 'token_transfer', id: data.id, message: '只有真人 GM 可转交角色控制权' }); return; }
    const t = room.tokens.find(tk => tk.id === data.id);
    if (!t) return;
    const to = String(data.to || '').trim();
    t.owner = to || t.owner;
    saveRoomArchive(room);
    relayAll('token_updated', { id: data.id, owner: t.owner, by: playerName || 'GM' });
    console.log(`[房间] ${currentRoom} 角色「${t.name || t.id}」控制权转交 → ${t.owner}`);
  });

  socket.on('dice_roll', (data) => {
    relay('dice_roll', { ...data, player: playerName });
  });

  // 输入状态提示：广播给房间内其他人（不含发送者），供聊天栏显示"谁正在输入"
  socket.on('typing', () => {
    relay('typing', { player: playerName || '玩家' });
  });

  socket.on('chat_msg', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const msgId = String(data.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    room.messages[msgId] = { author: socket.id, type: 'user' };
    relayAll('chat', {
      id: msgId,
      text: String(data.text || ''),
      channelId: data.channelId || 'story',
      sender: playerName || '玩家',
      characterName: String(data.characterName || ''),
      time: new Date().toLocaleTimeString('zh-CN')
    });
  });

  // 玩家私聊：仅发给目标玩家（含其多端），发送者其他端回显；目标离线时提示；双方所在冒险落盘（系统自动，不劳烦 AI）
  socket.on('private_msg', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const to = String(data.to || '').trim();
    const text = String(data.text || '').trim();
    if (!to || !text) return;
    if (to === playerName) return;
    const target = room.players[to];
    const payload = { from: playerName || '玩家', to, text, time: new Date().toLocaleTimeString('zh-CN'), ts: Date.now() };
    let delivered = false;
    if (target && Array.isArray(target.socketIds) && target.socketIds.length) {
      target.socketIds.forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) { s.emit('private_msg', payload); delivered = true; }
      });
    }
    if (!delivered) socket.emit('private_offline', { to });
    // 会话对归一化（a<b 字典序），发送方与接收方同冒险共用同一私聊文件
    if (room.system) {
      try {
        const pair = [playerName, to].sort();
        const pmMsg = { kind: 'pm', id: 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), from: playerName, to, text, time: payload.time, ts: payload.ts };
        appendPrivateSession(cleanRuleName(room.system), String(room.adventure || '默认'), 'pm', pair.join('-'), pmMsg);
      } catch (e) { console.error('[私聊] 落盘失败:', e.message); }
    }
  });

  // 玩家当前角色（头像/名字）：私聊与会话展示用；角色归属变更时由前端触发，广播全员
  socket.on('player_character', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[playerName];
    if (!p) return;
    p.character = {
      characterId: String((data && data.characterId) || ''),
      name: String((data && data.name) || ''),
      avatarUrl: String((data && data.avatarUrl) || '')
    };
    io.to(currentRoom).emit('players_update', room.players);
    saveRoomArchive(room);
  });

  socket.on('ai_chat', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    // AI输出只能由房主/GM广播；普通玩家不能伪造AI消息。
    if (!isRoomGM(room, socket)) return;
    const msgId = String(data.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    room.messages[msgId] = { author: socket.id, type: 'ai' };
    socket.broadcast.to(currentRoom).emit('ai_chat', {
      id: msgId,
      text: String(data.text || ''),
      channelId: data.channelId || 'story',
      sender: 'AI',
      time: new Date().toLocaleTimeString('zh-CN')
    });
  });

  socket.on('chat_edit', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const rec = room.messages[data.id];
    if (!rec) return;
    if (socket.id !== rec.author) return; // 非作者不可编辑
    relayAll('chat_edited', { id: data.id, newText: String(data.newText || ''), channelId: data.channelId });
  });

  socket.on('chat_retract', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const rec = room.messages[data.id];
    if (!rec) return;
    const isAuthor = socket.id === rec.author;
    const isGM = isRoomGM(room, socket);
    if (!isAuthor && !isGM) return; // 非作者且非GM不可撤回
    delete room.messages[data.id];
    relayAll('chat_retracted', { id: data.id, by: playerName || '玩家', channelId: data.channelId, isGM });
  });

  socket.on('set_name', (name) => {
    const newName = String(name || '').trim();
    if (!newName) return;
    if (newName === playerName) return;
    // 新名在线占用保护（不能接管在线者的名字）
    if (isNameTaken(newName)) {
      socket.emit('room_error', '玩家名「' + newName + '」已被在线玩家使用，请换一个名字');
      return;
    }
    if (!currentRoom || !rooms[currentRoom]) {
      // 未在房间：仅更新身份
      if (onlineNames[playerName]) onlineNames[playerName].socketIds.delete(socket.id);
      playerName = newName;
      socket.playerName = newName;
      bindPlayerName(socket, null, newName, false, 'player');
      return;
    }
    const room = rooms[currentRoom];
    const oldName = playerName;
    const oldP = room.players[oldName];
    if (oldP) {
      oldP.socketIds = (oldP.socketIds || []).filter(sid => sid !== socket.id);
      if (!oldP.socketIds.length && oldP.name !== room.hostName) {
        delete room.players[oldName];
        // 旧名创建的 token 归属转移给新名
        room.tokens.forEach(t => { if (t.owner === oldName) t.owner = newName; });
      }
    }
    if (onlineNames[oldName]) onlineNames[oldName].socketIds.delete(socket.id);
    var wasHost = room.hostName === oldName || socket.id === room.hostId;
    if (wasHost) room.hostName = newName;
    playerName = newName;
    socket.playerName = newName;
    bindPlayerName(socket, room, newName, wasHost, oldP && oldP.role ? oldP.role : 'player');
    if (wasHost) room.hostId = socket.id;
    if (room.gmName === oldName) room.gmName = newName;
    relayAll('players_update', room.players);
    relayAll('chat', { sender: '系统', text: `${oldName} 已改名为 ${newName}`, time: new Date().toLocaleTimeString('zh-CN') });
    saveRoomArchive(room);
  });

  const OFFLINE_GRACE_MS = 60000;
  socket.on('disconnect', () => {
    // 从全局在线表摘除本 socket
    if (onlineNames[playerName]) {
      onlineNames[playerName].socketIds.delete(socket.id);
    }
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[playerName];
    const now = Date.now();
    if (p) {
      p.socketIds = (p.socketIds || []).filter(sid => sid !== socket.id);
      if (!p.socketIds.length) {
        // 全部端离线：进入宽限期（不删玩家、不广播掉线；同名重连即恢复）
        p.offlineSince = now;
        if (onlineNames[playerName]) onlineNames[playerName].offlineSince = now;
        // GM 断线：hostId 置空，宽限期内同名重连恢复（bindPlayerName 处理）
        if (socket.id === room.hostId) room.hostId = null;
        setTimeout(() => {
          if (!rooms[currentRoom]) return;
          const r2 = rooms[currentRoom];
          const p2 = r2.players[playerName];
          // 宽限期内已重连（offlineSince 被清除）→ 不处理
          if (p2 && p2.offlineSince && (Date.now() - p2.offlineSince) >= OFFLINE_GRACE_MS) {
            delete r2.players[playerName];
            if (onlineNames[playerName]) { onlineNames[playerName].offlineSince = null; delete onlineNames[playerName]; }
            io.to(currentRoom).emit('players_update', r2.players);
            io.to(currentRoom).emit('chat', { sender: '系统', text: `${playerName} 已离线`, time: new Date().toLocaleTimeString('zh-CN') });
            saveRoomArchive(r2);
            console.log(`[房间] ${currentRoom} ← ${playerName} 宽限期结束，已离线`);
            if (Object.keys(r2.players).length === 0) {
              setTimeout(() => {
                if (rooms[currentRoom] && Object.keys(rooms[currentRoom].players).length === 0) {
                  delete rooms[currentRoom];
                  console.log(`[房间] ${currentRoom} 已清理（存档保留，可凭房间码恢复）`);
                }
              }, 600000);
            }
          }
        }, OFFLINE_GRACE_MS + 1000);
      }
    }
  });
});

  loadPlayerRegistry();
  return { server, io, rooms, onlineNames, isNameTaken };
};