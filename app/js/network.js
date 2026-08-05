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
  let myName = ''; // 2026-08-06：玩家名 = 玩家身份（同名即同一玩家）

  let onPlayersUpdate = null;
  let onChat = null;
  let onAIChat = null;
  let onChatEdited = null;    // 2026-08-05 条目化：消息被编辑（其他端原地更新）
  let onChatRetracted = null; // 2026-08-05 条目化：消息被撤回（所有端移除条目）
  let onContentUpdated = null; // 2026-08-05：GM 内容更新通知（玩家端全量重载）
  let onDiceRoll = null;
  let onRoomCreated = null;
  let onRoomJoined = null;
  let onRoomError = null;
  let onPermDenied = null; // 2026-08-06：服务端权限拒绝（角色修改被拒，供前端回滚/提示）
  let onTokenUpdated = null; // 2026-08-06：角色控制权转交广播

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

  // 2026-08-06：玩家名（持久于本机 localStorage；进入房间时输入/选择）—— 见状态区 getMyName()

  function setupEvents() {
    socket.on('room_created', (data) => {
      roomCode = data.code;
      isHost = true;
      players = data.players || {};
      myName = data.myName || '';
      if (myName) { try { localStorage.setItem('trpg_player_name', myName); } catch (e) {} }
      // 同步房间标记
      if (data.tokens && data.tokens.length > 0 && window.MapEngine.getAllTokens().length === 0) {
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
      if (myName) { try { localStorage.setItem('trpg_player_name', myName); } catch (e) {} }
      if (data.tokens && data.tokens.length > 0 && window.MapEngine.getAllTokens().length === 0) {
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
      players = data;
      if (onPlayersUpdate) onPlayersUpdate(players, isHost);
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

    // 游戏状态同步（2026-08-06：远端应用走 MapEngine 的 remote 方法，不触发本地钩子转播，杜绝广播循环）
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

    socket.on('disconnect', () => {
      roomCode = null;
      players = {};
      if (onPlayersUpdate) onPlayersUpdate({}, false);
    });
  }

  // ── 房间操作 ──────────────────────────────────────

  function createRoom(system, adventure, gmName) {
    if (!socket) return;
    // 2026-08-06：GM 玩家名（房主身份=玩家名）
    socket.emit('create_room', { system: system || '', adventure: adventure || '默认', name: gmName || getMyName() || '房主' });
  }

  function joinRoom(code, name) {
    if (!socket) return;
    if (name) localStorage.setItem('trpg_player_name', name);
    socket.emit('join_room', { code, name: name || getMyName() });
  }

  // 2026-08-06：改名（身份变更；服务端把旧名创建的角色归属转给新名）
  function renameMe(newName) {
    if (!socket || !newName || !newName.trim()) return;
    socket.emit('set_name', newName.trim());
    if (newName.trim() !== myName) { try { localStorage.setItem('trpg_player_name', newName.trim()); } catch (e) {} }
    myName = newName.trim();
  }

  function getRoomUrl() {
    if (!roomCode) return '';
    const base = window.location.origin || 'http://localhost:3000';
    return `${base}?room=${roomCode}`;
  }

  // ── 事件发送 ──────────────────────────────────────

  function sendTokenAdd(token) {
    if (!socket) return;
    // 2026-08-06：owner = 当前玩家名（服务端强制校验覆盖），角色归属=创建者
    socket.emit('token_add', {
      id: token.id, name: token.name, displayName: token.displayName,
      color: token.color, gridX: token.gridX, gridY: token.gridY,
      hp: token.hp, maxHp: token.maxHp, data: token.data,
      owner: myName || getMyName()
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

  // 2026-08-06：GM 转交角色控制权
  function sendTokenTransfer(tokenId, toName) {
    if (!socket) return;
    socket.emit('token_transfer', { id: tokenId, to: toName });
  }

  // 2026-08-06：聊天带当前绑定角色名（显示"角色名（玩家名）"）
  function sendChat(text, channelId, msgId, characterName) {
    if (!socket) return;
    socket.emit('chat_msg', { text, channelId, id: msgId, characterName: characterName || '' });
  }

  function sendAIChat(text, channelId, msgId) {
    if (!socket) return;
    socket.emit('ai_chat', { text, channelId, id: msgId });
  }

  // 2026-08-05 条目化：编辑/撤回广播（服务端校验作者/GM权限后转发）
  function sendChatEdit(msgId, newText, channelId) {
    if (!socket) return;
    socket.emit('chat_edit', { id: msgId, newText, channelId });
  }

  function sendChatRetract(msgId, channelId) {
    if (!socket) return;
    socket.emit('chat_retract', { id: msgId, channelId });
  }

  // 2026-08-05：GM 手动广播内容更新（保存插件/界面/规则后调用），玩家端收到后全量重载
  function sendContentUpdate() {
    if (!socket) return;
    socket.emit('content_update', {});
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
  function getMyName() { return myName || (function() { try { return localStorage.getItem('trpg_player_name') || ''; } catch (e) { return ''; } })(); }

  return {
    connect, createRoom, joinRoom, getRoomUrl, renameMe,
    isConnected, getRoomCode, amIHost, getPlayers, getMyName,
    sendTokenAdd, sendTokenMove, sendTokenUpdate, sendTokenRemove, sendTokenSyncAll,
    sendTokenTransfer,
    sendDiceRoll, sendChat, sendAIChat, sendSetName,
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
    set onTokenUpdated(fn) { onTokenUpdated = fn; }
  };
})();

if (typeof window !== 'undefined') { window.Network = Network; }
