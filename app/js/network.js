/* ============================================
   TrpgRecode - P2P房间网络模块
   房间码创建/加入、状态同步
   ============================================ */

const Network = (() => {
  'use strict';

  let socket = null;
  let roomCode = null;
  let isHost = false;
  let players = {};
  let myName = '';
  let myRole = 'player';
  let gmName = '';

  let onPlayersUpdate = null;
  let onChat = null;
  let onAIChat = null;
  let onChatEdited = null;
  let onChatRetracted = null;
  let onContentUpdated = null;
  let onDiceRoll = null;
  let onRoomCreated = null;
  let onRoomJoined = null;
  let onRoomError = null;
  let onPermDenied = null;
  let onTokenUpdated = null;
  let onRoleUpdated = null;
  let onPrivateMessage = null;
  let onPrivateOffline = null;
  let onTyping = null;

  // ── 连接并检查URL参数 ──────────────────────────────

  function connect() {
    if (!window.io) { console.warn('[网络] socket.io未加载'); return; }

    const url = (function() {
      if (window.location.port && window.location.port !== '5500' && window.location.port !== '8080') {
        return window.location.origin;
      }
      return 'http://localhost:3000';
    })();

    socket = window.io(url, { transports: ['websocket', 'polling'], timeout: 3000 });

    var connectTimer = setTimeout(function() {
      if (!socket.connected) {
        console.log('[网络] SoloTrpg后端连接超时');
        socket.close();
      }
    }, 4000);

    socket.on('connect', () => {
      clearTimeout(connectTimer);
      console.log('[网络] 已连接');
      const params = new URLSearchParams(window.location.search);
      const autoRoom = params.get('room');
      if (autoRoom) {
        socket.emit('join_room', { code: autoRoom, name: getMyName() });
      }
    });

    setupEvents();
  }


  function setupEvents() {
    socket.on('room_created', (data) => {
      roomCode = data.code;
      isHost = true;
      players = data.players || {};
      myName = data.myName || '';
      myRole = data.myRole === 'gm' ? 'gm' : 'player';
      gmName = data.gmName || '';
      if (myName) { try { localStorage.setItem('trpg_player_nickname', myName); localStorage.removeItem('trpg_player_name'); } catch (e) {} }
      if (data.mapState && window.MapEngine) {
        try { window.MapEngine.importState(data.mapState); } catch (e) { console.warn('[网络] 地图状态载入失败', e); }
      }
      // 同步房间标记
      if (!data.mapState && data.tokens && data.tokens.length > 0 && window.MapEngine.getAllTokens().length === 0) {
        window.MapEngine.setTokens(data.tokens);
        if (window.UIManager) window.UIManager.refreshCharacterList();
      }
      if (onRoomCreated) onRoomCreated(data);
    });

    socket.on('room_joined', (data) => {
      roomCode = data.code;
      isHost = !!data.isHost;
      players = data.players || {};
      myName = data.myName || '';
      myRole = data.myRole === 'gm' ? 'gm' : 'player';
      gmName = data.gmName || '';
      if (myName) { try { localStorage.setItem('trpg_player_nickname', myName); localStorage.removeItem('trpg_player_name'); } catch (e) {} }
      if (data.mapState && window.MapEngine) {
        try { window.MapEngine.importState(data.mapState); } catch (e) { console.warn('[网络] 地图状态载入失败', e); }
      }
      if (!data.mapState && data.tokens && data.tokens.length > 0 && window.MapEngine.getAllTokens().length === 0) {
        window.MapEngine.setTokens(data.tokens);
        if (window.UIManager) window.UIManager.refreshCharacterList();
      }
      if (onRoomJoined) onRoomJoined(data);
    });

    socket.on('room_error', (msg) => {
      if (onRoomError) onRoomError(msg);
    });

    socket.on('perm_denied', (data) => {
      if (onPermDenied) onPermDenied(data);
    });

    socket.on('token_updated', (data) => {
      if (onTokenUpdated) onTokenUpdated(data);
    });

    socket.on('players_update', (data) => {
      players = data || {};
      const me = players[myName];
      if (me && me.role) myRole = me.role === 'gm' ? 'gm' : 'player';
      const activeGM = Object.keys(players).find(name => players[name] && players[name].role === 'gm');
      gmName = activeGM || '';
      if (onPlayersUpdate) onPlayersUpdate(players, isHost);
    });

    socket.on('role_updated', (data) => {
      gmName = data && data.gmName ? data.gmName : '';
      if (data && data.name === myName) myRole = data.role === 'gm' ? 'gm' : 'player';
      if (onRoleUpdated) onRoleUpdated(data || {});
    });

    socket.on('private_msg', (data) => {
      if (onPrivateMessage) onPrivateMessage(data);
    });

    socket.on('private_offline', (data) => {
      if (onPrivateOffline) onPrivateOffline(data);
    });

    socket.on('typing', (data) => {
      if (onTyping) onTyping(data || {});
    });

    socket.on('chat', (data) => {
      if (onChat) onChat(data);
    });

    socket.on('ai_chat', (data) => {
      if (onAIChat) onAIChat(data);
    });

    socket.on('chat_edited', (data) => {
      if (onChatEdited) onChatEdited(data);
    });

    socket.on('chat_retracted', (data) => {
      if (onChatRetracted) onChatRetracted(data);
    });

    socket.on('content_updated', (data) => {
      if (onContentUpdated) onContentUpdated(data);
    });

    socket.on('dice_roll', (data) => {
      if (onDiceRoll) onDiceRoll(data);
    });

    socket.on('token_add', (data) => {
      window.MapEngine.addTokenRemote(data);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });
    socket.on('token_move', (data) => {
      window.MapEngine.updateTokenRemote(data.id, { gridX: data.gridX, gridY: data.gridY });
    });
    socket.on('token_update', (data) => {
      window.MapEngine.updateTokenRemote(data.id, data);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });
    socket.on('token_remove', (data) => {
      window.MapEngine.removeTokenRemote(data.id);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });
    socket.on('token_sync_all', (data) => {
      window.MapEngine.setTokens(data.tokens || []);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });

    socket.on('map_state', (data) => {
      if (!data || !data.mapState || !window.MapEngine) return;
      try {
        window.MapEngine.importState(data.mapState, { preserveView: true });
        if (window.UIManager) window.UIManager.refreshCharacterList();
      } catch (e) { console.warn('[网络] 地图状态同步失败', e); }
    });

    socket.on('map_overlay', (data) => {
      if (!data || !data.overlay || !window.MapEngine || !window.MapEngine.applyOverlayState) return;
      try { window.MapEngine.applyOverlayState(data.overlay); }
      catch (e) { console.warn('[网络] 地图范围同步失败', e); }
    });

    socket.on('disconnect', () => {
      roomCode = null;
      players = {};
      myRole = 'player';
      gmName = '';
      if (onPlayersUpdate) onPlayersUpdate({}, false);
    });
  }

  // ── 房间操作 ──────────────────────────────────────

  function createRoom(system, adventure, name, role) {
    if (!socket) return;
    socket.emit('create_room', {
      system: system || '',
      adventure: adventure || '默认',
      name: name || getMyName() || '房主',
      role: role === 'gm' ? 'gm' : 'player'
    });
  }

  function joinRoom(code, name) {
    if (!socket) return;
    if (name) { localStorage.setItem('trpg_player_nickname', name); localStorage.removeItem('trpg_player_name'); }
    socket.emit('join_room', { code, name: name || getMyName() });
  }

  function renameMe(newName) {
    if (!socket || !newName || !newName.trim()) return;
    socket.emit('set_name', newName.trim());
    if (newName.trim() !== myName) {
      // 全局昵称：房间内改名 = 修改全局昵称（覆盖旧房间独立昵称系统）
      try { localStorage.setItem('trpg_player_nickname', newName.trim()); localStorage.removeItem('trpg_player_name'); } catch (e) {}
    }
    myName = newName.trim();
  }

  function sendPlayerCharacter(character) {
    if (!socket || !roomCode) return;
    socket.emit('player_character', {
      characterId: (character && character.id) || '',
      name: (character && (character.displayName || character.name)) || '',
      avatarUrl: (character && (character.avatarUrl || (character.data && character.data.assets && (character.data.assets.avatarFramed || character.data.assets.avatar)))) || ''
    });
  }

  function setRole(role, name) {
    if (!socket || !roomCode || !isHost) return;
    socket.emit('set_role', { role: role === 'gm' ? 'gm' : 'player', name: name || myName });
  }

  function getRoomUrl() {
    if (!roomCode) return '';
    const base = window.location.origin || 'http://localhost:3000';
    return `${base}?room=${roomCode}`;
  }

  // ── 事件发送 ──────────────────────────────────────

  function sendTokenAdd(token) {
    if (!socket) return;
    socket.emit('token_add', {
      id: token.id, kind: token.kind || 'character', name: token.name, displayName: token.displayName,
      color: token.color, icon: token.icon, shape: token.shape, size: token.size, avatarUrl: token.avatarUrl,
      gridX: token.gridX, gridY: token.gridY, hp: token.hp, maxHp: token.maxHp, ac: token.ac,
      conditions: token.conditions || [], data: token.data, owner: token.owner || myName || getMyName(),
      mapId: window.MapEngine && window.MapEngine.getTokenMapId ? window.MapEngine.getTokenMapId(token.id) : ''
    });
  }

  function sendTokenMove(tokenId, gx, gy) {
    if (!socket) return;
    socket.emit('token_move', { id: tokenId, gridX: gx, gridY: gy, mapId: window.MapEngine && window.MapEngine.getTokenMapId ? window.MapEngine.getTokenMapId(tokenId) : '' });
  }

  function sendTokenUpdate(tokenId, updates) {
    if (!socket) return;
    socket.emit('token_update', { id: tokenId, mapId: window.MapEngine && window.MapEngine.getTokenMapId ? window.MapEngine.getTokenMapId(tokenId) : '', ...updates });
  }

  function sendTokenRemove(tokenId) {
    if (!socket) return;
    socket.emit('token_remove', { id: tokenId, mapId: window.MapEngine && window.MapEngine.getTokenMapId ? window.MapEngine.getTokenMapId(tokenId) : '' });
  }

  function sendTokenSyncAll() {
    if (!socket) return;
    socket.emit('token_sync_all', { tokens: window.MapEngine.getAllTokens() });
  }

  function sendMapState(mapState) {
    if (!socket || !roomCode) return;
    socket.emit('map_state', { mapState: mapState || (window.MapEngine && window.MapEngine.exportState ? window.MapEngine.exportState() : null) });
  }

  function sendMapOverlay(overlay) {
    if (!socket || !roomCode || !overlay) return;
    socket.emit('map_overlay', { overlay });
  }

  function sendDiceRoll(expression, result) {
    if (!socket) return;
    socket.emit('dice_roll', { expression, result });
  }

  function sendTokenTransfer(tokenId, toName) {
    if (!socket) return;
    socket.emit('token_transfer', { id: tokenId, to: toName });
  }

  function sendChat(text, channelId, msgId, characterName) {
    if (!socket) return;
    socket.emit('chat_msg', { text, channelId, id: msgId, characterName: characterName || '' });
  }

  function sendAIChat(text, channelId, msgId) {
    if (!socket) return;
    socket.emit('ai_chat', { text, channelId, id: msgId });
  }

  function sendChatEdit(msgId, newText, channelId) {
    if (!socket) return;
    socket.emit('chat_edit', { id: msgId, newText, channelId });
  }

  function sendChatRetract(msgId, channelId) {
    if (!socket) return;
    socket.emit('chat_retract', { id: msgId, channelId });
  }

  function sendContentUpdate() {
    if (!socket) return;
    socket.emit('content_update', {});
  }

  function sendSetName(name) {
    if (!socket) return;
    socket.emit('set_name', name);
  }

  function sendPrivateMessage(to, text) {
    if (!socket) return;
    socket.emit('private_msg', { to, text });
  }

  function sendTyping() {
    if (!socket) return;
    socket.emit('typing', {});
  }

  // ── 状态 ──────────────────────────────────────────

  function isConnected() { return socket && socket.connected; }
  function getRoomCode() { return roomCode; }
  function amIHost() { return isHost; }
  function amIGM() { return myRole === 'gm'; }
  function getMyRole() { return myRole; }
  function getGMName() { return gmName; }
  function getPlayers() { return { ...players }; }
  // 全局玩家昵称（设置页定义，覆盖旧房间独立昵称系统 trpg_player_name）：
  // 优先读 trpg_player_nickname；旧名存在时自动迁移并删除旧键
  function getMyName() {
    var nick = '';
    try { nick = localStorage.getItem('trpg_player_nickname') || ''; } catch (e) {}
    if (nick) return nick;
    try {
      var legacy = localStorage.getItem('trpg_player_name');
      if (legacy) {
        localStorage.setItem('trpg_player_nickname', legacy);
        localStorage.removeItem('trpg_player_name');
        return legacy;
      }
    } catch (e) {}
    return myName || '';
  }

  return {
    connect, createRoom, joinRoom, getRoomUrl, renameMe, setRole,
    isConnected, getRoomCode, amIHost, amIGM, getMyRole, getGMName, getPlayers, getMyName,
    sendTokenAdd, sendTokenMove, sendTokenUpdate, sendTokenRemove, sendTokenSyncAll, sendMapState, sendMapOverlay,
    sendTokenTransfer,
    sendDiceRoll, sendChat, sendAIChat, sendSetName, sendPrivateMessage, sendTyping,
    sendPlayerCharacter,
    sendChatEdit, sendChatRetract, sendContentUpdate,
    set onPlayersUpdate(fn) { onPlayersUpdate = fn; },
    set onChat(fn) { onChat = fn; },
    set onAIChat(fn) { onAIChat = fn; },
    set onChatEdited(fn) { onChatEdited = fn; },
    set onChatRetracted(fn) { onChatRetracted = fn; },
    set onContentUpdated(fn) { onContentUpdated = fn; },
    set onDiceRoll(fn) { onDiceRoll = fn; },
    set onRoomCreated(fn) { onRoomCreated = fn; },
    set onRoomJoined(fn) { onRoomJoined = fn; },
    set onRoomError(fn) { onRoomError = fn; },
    set onPermDenied(fn) { onPermDenied = fn; },
    set onTokenUpdated(fn) { onTokenUpdated = fn; },
    set onRoleUpdated(fn) { onRoleUpdated = fn; },
    set onPrivateMessage(fn) { onPrivateMessage = fn; },
    set onPrivateOffline(fn) { onPrivateOffline = fn; },
    set onTyping(fn) { onTyping = fn; }
  };
})();

if (typeof window !== 'undefined') { window.Network = Network; }
