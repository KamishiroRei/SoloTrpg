// ── 通用风格化弹窗组件（替代浏览器原生 alert/confirm/prompt） ──
// 复用宿主 .modal/.modal-content/.modal-buttons 样式；挂载 window.UIManager.dialog
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.UIManager) return;
  var I = window.UIManager._internal || {};
  var esc = I.esc || function (s) { return String(s); };
  var layer = null;

  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement('div');
    layer.id = 'app-dialog-layer';
    document.body.appendChild(layer);
    return layer;
  }

  function open(title, bodyHtml, buttonsHtml, onClose) {
    var L = ensureLayer();
    var box = document.createElement('div');
    box.className = 'modal app-dialog';
    box.style.display = 'flex';
    box.innerHTML = '<div class="modal-content wide app-dialog-box">' +
      '<h3 class="app-dialog-title">' + esc(title) + '</h3>' +
      '<div class="app-dialog-body">' + bodyHtml + '</div>' +
      '<div class="modal-buttons app-dialog-buttons">' + buttonsHtml + '</div>' +
      '</div>';
    L.appendChild(box);
    var closed = false;
    function close(v) {
      if (closed) return;
      closed = true;
      try { L.removeChild(box); } catch (e) {}
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', function (e) {
      if (e.target === box) close(null); // 点击遮罩关闭
    });
    box._close = close;
    return box;
  }

  function btn(cls, label, cb, isPrimary) {
    return '<button type="button" class="btn-small ' + cls + (isPrimary ? ' accent' : '') + '" data-act>' + esc(label) + '</button>';
  }

  window.UIManager.dialog = {
    alert: function (title, msg, cb, okText) {
      var box = open(title, '<div class="app-dialog-msg">' + esc(msg) + '</div>', btn('', okText || '确定', null, true), cb);
      box.querySelector('[data-act]').addEventListener('click', function () { box._close(true); });
    },
    confirm: function (title, msg, cb, okText, cancelText) {
      var box = open(title,
        '<div class="app-dialog-msg">' + esc(msg) + '</div>',
        btn('', cancelText || '取消', null, false) + btn('', okText || '确定', null, true),
        cb);
      var bs = box.querySelectorAll('[data-act]');
      bs[0].addEventListener('click', function () { box._close(false); });
      bs[1].addEventListener('click', function () { box._close(true); });
    },
    prompt: function (title, placeholder, def, cb, extraBodyHtml) {
      var box = open(title,
        '<div class="app-dialog-msg">' + (extraBodyHtml || '') + '</div>' +
        '<input type="text" class="app-dialog-input" placeholder="' + esc(placeholder || '') + '" value="' + esc(def || '') + '">',
        btn('', '取消', null, false) + btn('', '确定', null, true),
        cb);
      var input = box.querySelector('.app-dialog-input');
      var bs = box.querySelectorAll('[data-act]');
      bs[0].addEventListener('click', function () { box._close(null); });
      bs[1].addEventListener('click', function () { box._close(input.value); });
      setTimeout(function () { input.focus(); input.select(); }, 30);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); box._close(input.value); }
      });
    }
  };
})();
