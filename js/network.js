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

  let onPlayersUpdate = null;
  let onChat = null;
  let onDiceRoll = null;
  let onRoomCreated = null;
  let onRoomJoined = null;
  let onRoomError = null;

  // ── 连接并检查URL参数 ──────────────────────────────

  function connect() {
    if (!window.io) { console.warn('[网络] socket.io未加载'); return; }

    const url = (function() {
      if (window.location.port && window.location.port !== '5500' && window.location.port !== '8080') {
        return window.location.origin;
      }
      return 'http://localhost:3000';
    })();

    socket = window.io(url, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[网络] 已连接');

      // 检查URL参数 ?room=CODE 自动加入
      const params = new URLSearchParams(window.location.search);
      const autoRoom = params.get('room');
      if (autoRoom) {
        socket.emit('join_room', { code: autoRoom, name: localStorage.getItem('trpg_player_name') || '' });
      }
    });

    setupEvents();
  }

  function setupEvents() {
    socket.on('room_created', (data) => {
      roomCode = data.code;
      isHost = true;
      players = data.players || {};
      // 同步房间标记
      if (data.tokens && data.tokens.length > 0 && window.MapEngine.getAllTokens().length === 0) {
        window.MapEngine.setTokens(data.tokens);
        if (window.UIManager) window.UIManager.refreshCharacterList();
      }
      if (onRoomCreated) onRoomCreated(data);
    });

    socket.on('room_joined', (data) => {
      roomCode = data.code;
      isHost = false;
      players = data.players || {};
      if (data.tokens && data.tokens.length > 0 && window.MapEngine.getAllTokens().length === 0) {
        window.MapEngine.setTokens(data.tokens);
        if (window.UIManager) window.UIManager.refreshCharacterList();
      }
      if (onRoomJoined) onRoomJoined(data);
    });

    socket.on('room_error', (msg) => {
      if (onRoomError) onRoomError(msg);
    });

    socket.on('players_update', (data) => {
      players = data;
      if (onPlayersUpdate) onPlayersUpdate(players, isHost);
    });

    socket.on('chat', (data) => {
      if (onChat) onChat(data);
    });

    socket.on('dice_roll', (data) => {
      if (onDiceRoll) onDiceRoll(data);
    });

    // 游戏状态同步
    socket.on('token_add', (data) => {
      window.MapEngine.addToken(data);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });
    socket.on('token_move', (data) => {
      window.MapEngine.updateToken(data.id, { gridX: data.gridX, gridY: data.gridY });
    });
    socket.on('token_update', (data) => {
      window.MapEngine.updateToken(data.id, data);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });
    socket.on('token_remove', (data) => {
      window.MapEngine.removeToken(data.id);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });
    socket.on('token_sync_all', (data) => {
      window.MapEngine.setTokens(data.tokens || []);
      if (window.UIManager) window.UIManager.refreshCharacterList();
    });

    socket.on('disconnect', () => {
      roomCode = null;
      players = {};
      if (onPlayersUpdate) onPlayersUpdate({}, false);
    });
  }

  // ── 房间操作 ──────────────────────────────────────

  function createRoom() {
    if (!socket) return;
    socket.emit('create_room');
  }

  function joinRoom(code, name) {
    if (!socket) return;
    if (name) localStorage.setItem('trpg_player_name', name);
    socket.emit('join_room', { code, name });
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
      id: token.id, name: token.name, displayName: token.displayName,
      color: token.color, gridX: token.gridX, gridY: token.gridY,
      hp: token.hp, maxHp: token.maxHp, data: token.data
    });
  }

  function sendTokenMove(tokenId, gx, gy) {
    if (!socket) return;
    socket.emit('token_move', { id: tokenId, gridX: gx, gridY: gy });
  }

  function sendTokenUpdate(tokenId, updates) {
    if (!socket) return;
    socket.emit('token_update', { id: tokenId, ...updates });
  }

  function sendTokenRemove(tokenId) {
    if (!socket) return;
    socket.emit('token_remove', { id: tokenId });
  }

  function sendTokenSyncAll() {
    if (!socket) return;
    socket.emit('token_sync_all', { tokens: window.MapEngine.getAllTokens() });
  }

  function sendDiceRoll(expression, result) {
    if (!socket) return;
    socket.emit('dice_roll', { expression, result });
  }

  function sendChat(text) {
    if (!socket) return;
    socket.emit('chat_msg', { text });
  }

  function sendSetName(name) {
    if (!socket) return;
    socket.emit('set_name', name);
  }

  // ── 状态 ──────────────────────────────────────────

  function isConnected() { return socket && socket.connected; }
  function getRoomCode() { return roomCode; }
  function amIHost() { return isHost; }
  function getPlayers() { return { ...players }; }

  return {
    connect, createRoom, joinRoom, getRoomUrl,
    isConnected, getRoomCode, amIHost, getPlayers,
    sendTokenAdd, sendTokenMove, sendTokenUpdate, sendTokenRemove, sendTokenSyncAll,
    sendDiceRoll, sendChat, sendSetName,
    set onPlayersUpdate(fn) { onPlayersUpdate = fn; },
    set onChat(fn) { onChat = fn; },
    set onDiceRoll(fn) { onDiceRoll = fn; },
    set onRoomCreated(fn) { onRoomCreated = fn; },
    set onRoomJoined(fn) { onRoomJoined = fn; },
    set onRoomError(fn) { onRoomError = fn; }
  };
})();

if (typeof window !== 'undefined') { window.Network = Network; }
