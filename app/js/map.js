const MapEngine = (() => {
  'use strict';

  const UNIT_TO_METERS = { ft: 0.3048, m: 1, km: 1000, mi: 1609.344 };
  const UNIT_LABEL = { ft: '尺', m: '米', km: '公里', mi: '英里' };
  const DEFAULT_MAP = {
    id: 'map_main', name: '小队地图', kind: 'battle',
    view: { offsetX: 0, offsetY: 0, scale: 1 },
    settings: {
      cellSize: 50, showGrid: true, snapToGrid: true,
      gridColor: '#3a3a5c', bgColor: '#1a1a2e', rangeColor: '#ff6b6b',
      scaleDistance: 5, scaleUnit: 'ft', backgroundSrc: '', backgroundOpacity: 0.82,
      bgOffsetGridX: 0, bgOffsetGridY: 0
    },
    tokens: [], ranges: [], measurements: []
  };

  let canvas = null;
  let ctx = null;
  let maps = [];
  let activeMapId = DEFAULT_MAP.id;
  let tokenIdCounter = 0;
  let rangeIdCounter = 0;
  let measurementIdCounter = 0;
  let currentTool = 'select';
  let selectedToken = null;
  let hoveredToken = null;
  let selectedRange = null;
  let draftRange = null;
  let draftMeasure = null;
  let drag = null;
  let mouseGridX = 0;
  let mouseGridY = 0;
  let backgroundImage = null;
  let backgroundImageSrc = '';
  const tokenImageCache = {};

  let onTokenSelected = null;
  let onRangeSelected = null;
  let onRangeDraft = null;
  let onMeasureUpdate = null;
  let onMeasureComplete = null;
  let onCoordUpdate = null;
  let onZoomChanged = null;
  let onMapsChanged = null;
  let onMapChanged = null;
  let onStateChanged = null;
  let onTokenMoved = null;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function activeMap() { return maps.find(m => m.id === activeMapId) || maps[0]; }
  function settings() { return activeMap().settings; }
  function view() { return activeMap().view; }
  function actualCellSize() { return Math.max(4, Number(settings().cellSize || 50) * Number(view().scale || 1)); }

  function normalizeMap(raw, index) {
    const m = Object.assign({}, clone(DEFAULT_MAP), raw || {});
    m.id = String(m.id || uid('map'));
    m.name = String(m.name || ('地图 ' + (index + 1)));
    m.kind = String(m.kind || 'scene');
    m.view = Object.assign({}, DEFAULT_MAP.view, raw && raw.view || {});
    m.settings = Object.assign({}, DEFAULT_MAP.settings, raw && raw.settings || {});
    m.tokens = Array.isArray(raw && raw.tokens) ? raw.tokens.map(normalizeToken) : [];
    m.ranges = Array.isArray(raw && raw.ranges) ? raw.ranges.map(normalizeRange) : [];
    m.measurements = Array.isArray(raw && raw.measurements) ? raw.measurements.map(normalizeMeasurement) : [];
    return m;
  }

  function normalizeToken(raw) {
    const t = Object.assign({
      id: '', kind: 'character', name: '未命名', displayName: '', color: '#4ecdc4',
      gridX: 0, gridY: 0, size: 1, shape: 'circle', icon: '●', avatarUrl: '',
      hp: undefined, maxHp: undefined, ac: undefined, conditions: [], owner: null, data: {}
    }, raw || {});
    if (!t.id) t.id = uid('token');
    if (!t.displayName) t.displayName = t.name;
    if (!Array.isArray(t.conditions)) t.conditions = [];
    if (!t.data || typeof t.data !== 'object') t.data = {};
    return t;
  }

  function normalizeRange(raw) {
    return Object.assign({
      id: uid('range'), type: 'circle', originX: 0, originY: 0, endX: 0, endY: -1,
      distance: 20, unit: 'ft', width: 5, widthUnit: 'ft', angle: 60,
      color: '#ff6b6b', material: 'soft', opacity: 0.22, note: '', locked: true
    }, raw || {});
  }

  function normalizeMeasurement(raw) {
    return Object.assign({ id: uid('measure'), startX: 0, startY: 0, endX: 0, endY: 0, unit: settings().scaleUnit, note: '' }, raw || {});
  }

  function init(canvasEl, options = {}) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    onTokenSelected = options.onTokenSelected || null;
    onRangeSelected = options.onRangeSelected || null;
    onRangeDraft = options.onRangeDraft || null;
    onMeasureUpdate = options.onMeasureUpdate || null;
    onMeasureComplete = options.onMeasureComplete || null;
    onCoordUpdate = options.onCoordUpdate || null;
    onZoomChanged = options.onZoomChanged || null;
    onMapsChanged = options.onMapsChanged || null;
    onMapChanged = options.onMapChanged || null;
    onStateChanged = options.onStateChanged || null;
    onTokenMoved = options.onTokenMoved || null;
    const first = clone(DEFAULT_MAP);
    first.settings.cellSize = Number(options.cellSize || first.settings.cellSize);
    first.settings.gridColor = options.gridColor || first.settings.gridColor;
    first.settings.bgColor = options.bgColor || first.settings.bgColor;
    first.settings.rangeColor = options.rangeColor || first.settings.rangeColor;
    maps = [normalizeMap(first, 0)];
    activeMapId = maps[0].id;
    loadBackground();
    resize();
    setupEvents();
    zoomFit();
    notifyMaps();
  }

  function setupEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) {
      // 画布右键用于拖拽平移；地图管理菜单在上方地图标签条目上右键触发
      e.preventDefault();
    });
    window.addEventListener('keydown', onKeyDown);
  }

  function resize() {
    if (!canvas || !canvas.parentElement) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas._cssWidth = rect.width;
    canvas._cssHeight = rect.height;
    render();
  }

  function cssWidth() { return canvas ? (canvas._cssWidth || canvas.clientWidth || 1) : 1; }
  function cssHeight() { return canvas ? (canvas._cssHeight || canvas.clientHeight || 1) : 1; }
  function canvasPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, clientX: e.clientX, clientY: e.clientY }; }
  function screenToGrid(sx, sy) { const v = view(), c = actualCellSize(); return { x: (sx - v.offsetX) / c, y: (sy - v.offsetY) / c }; }
  function gridToScreen(gx, gy) { const v = view(), c = actualCellSize(); return { x: gx * c + v.offsetX, y: gy * c + v.offsetY }; }
  function snapGrid(gx, gy) { return settings().snapToGrid ? { x: Math.round(gx), y: Math.round(gy) } : { x: gx, y: gy }; }

  function distanceToMeters(value, unit) { return Number(value || 0) * (UNIT_TO_METERS[unit] || 1); }
  function metersToDistance(value, unit) { return Number(value || 0) / (UNIT_TO_METERS[unit] || 1); }
  function distanceToCells(value, unit) {
    const meters = distanceToMeters(value, unit);
    const cellMeters = distanceToMeters(settings().scaleDistance || 1, settings().scaleUnit || 'm');
    return cellMeters > 0 ? meters / cellMeters : meters;
  }
  function cellsToDistance(cells, unit) {
    const cellMeters = distanceToMeters(settings().scaleDistance || 1, settings().scaleUnit || 'm');
    return metersToDistance(Number(cells || 0) * cellMeters, unit || settings().scaleUnit || 'm');
  }
  function formatDistance(cells, unit) {
    const u = unit || settings().scaleUnit || 'm';
    const value = cellsToDistance(cells, u);
    const digits = Math.abs(value) >= 100 ? 0 : (Math.abs(value) >= 10 ? 1 : 2);
    return value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/g, '') + ' ' + (UNIT_LABEL[u] || u);
  }

  function findTokenAt(sx, sy) {
    const list = activeMap().tokens;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      const p = gridToScreen(t.gridX, t.gridY);
      const radius = actualCellSize() * Math.max(0.35, Number(t.size || 1) * 0.46);
      if (Math.hypot(sx - p.x, sy - p.y) <= radius) return t;
    }
    return null;
  }

  function pointInRange(gx, gy, r) {
    const dx = gx - r.originX, dy = gy - r.originY;
    const cells = distanceToCells(r.distance, r.unit);
    if (r.type === 'circle') return Math.hypot(dx, dy) <= cells;
    if (r.type === 'cube') return Math.abs(dx) <= cells / 2 && Math.abs(dy) <= cells / 2;
    const dirX = (r.endX - r.originX) || 0, dirY = (r.endY - r.originY) || -1;
    const len = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / len, uy = dirY / len;
    const along = dx * ux + dy * uy;
    const side = Math.abs(dx * -uy + dy * ux);
    if (r.type === 'line') return along >= 0 && along <= cells && side <= distanceToCells(r.width, r.widthUnit) / 2;
    if (r.type === 'cone') {
      if (along < 0 || Math.hypot(dx, dy) > cells) return false;
      const cos = along / Math.max(0.0001, Math.hypot(dx, dy));
      return Math.acos(Math.max(-1, Math.min(1, cos))) <= (Number(r.angle || 60) * Math.PI / 360);
    }
    return false;
  }

  function findRangeAt(sx, sy) {
    const g = screenToGrid(sx, sy);
    const ranges = activeMap().ranges;
    for (let i = ranges.length - 1; i >= 0; i--) if (pointInRange(g.x, g.y, ranges[i])) return ranges[i];
    return null;
  }

  function onPointerDown(e) {
    const p = canvasPos(e), g = screenToGrid(p.x, p.y), s = snapGrid(g.x, g.y);
    mouseGridX = g.x; mouseGridY = g.y;
    canvas.setPointerCapture?.(e.pointerId);

    // 右键拖拽平移地图（菜单在上方地图标签条目上右键触发，不占画布）
    if (e.button === 2) {
      drag = { type: 'pan', pointerId: e.pointerId, x: p.x, y: p.y, ox: view().offsetX, oy: view().offsetY };
      canvas.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;

    if (currentTool === 'range') {
      if (!draftRange) {
        draftRange = normalizeRange({ id: uid('range'), originX: s.x, originY: s.y, endX: s.x, endY: s.y - 1, unit: settings().scaleUnit, widthUnit: settings().scaleUnit, color: settings().rangeColor, locked: false });
        if (onRangeDraft) onRangeDraft(clone(draftRange), { clientX: p.clientX, clientY: p.clientY, phase: 'start' });
      } else {
        draftRange.endX = s.x; draftRange.endY = s.y;
        commitDraftRange({ clientX: p.clientX, clientY: p.clientY, phase: 'committed' });
      }
      render();
      return;
    }

    if (currentTool === 'measure') {
      if (!draftMeasure) {
        draftMeasure = normalizeMeasurement({ id: uid('measure'), startX: s.x, startY: s.y, endX: s.x, endY: s.y, unit: settings().scaleUnit });
        if (onMeasureUpdate) onMeasureUpdate(getDraftMeasureInfo(), { clientX: p.clientX, clientY: p.clientY, phase: 'start' });
      } else {
        draftMeasure.endX = s.x; draftMeasure.endY = s.y;
        const info = getDraftMeasureInfo();
        activeMap().measurements.push(normalizeMeasurement(draftMeasure));
        draftMeasure = null;
        if (onMeasureComplete) onMeasureComplete(info);
        changed('overlay');
      }
      render();
      return;
    }

    const token = findTokenAt(p.x, p.y);
    if (token) {
      selectedRange = null;
      selectedToken = token;
      drag = { type: 'token', pointerId: e.pointerId, token, x: p.x, y: p.y, gx: token.gridX, gy: token.gridY };
      if (onTokenSelected) onTokenSelected(token, { clientX: p.clientX, clientY: p.clientY, phase: 'select' });
      if (onRangeSelected) onRangeSelected(null);
      render();
      return;
    }
    const range = findRangeAt(p.x, p.y);
    if (range) {
      selectedToken = null;
      selectedRange = range;
      if (onTokenSelected) onTokenSelected(null);
      if (onRangeSelected) onRangeSelected(clone(range), { clientX: p.clientX, clientY: p.clientY, phase: 'select' });
      render();
      return;
    }
    selectedToken = null; selectedRange = null;
    if (onTokenSelected) onTokenSelected(null);
    if (onRangeSelected) onRangeSelected(null);
    render();
  }

  function onPointerMove(e) {
    const p = canvasPos(e), g = screenToGrid(p.x, p.y), s = snapGrid(g.x, g.y);
    mouseGridX = g.x; mouseGridY = g.y;
    if (onCoordUpdate) onCoordUpdate(s.x, s.y, { text: formatDistance(Math.hypot(s.x, s.y), settings().scaleUnit), map: getActiveMapSummary() });

    if (drag && drag.pointerId === e.pointerId) {
      if (drag.type === 'pan') {
        view().offsetX = drag.ox + p.x - drag.x;
        view().offsetY = drag.oy + p.y - drag.y;
        render(); return;
      }
      if (drag.type === 'token') {
        const ng = snapGrid(drag.gx + (p.x - drag.x) / actualCellSize(), drag.gy + (p.y - drag.y) / actualCellSize());
        drag.token.gridX = ng.x; drag.token.gridY = ng.y;
        render(); return;
      }
    }

    if (draftRange) {
      draftRange.endX = s.x; draftRange.endY = s.y;
      if (onRangeDraft) onRangeDraft(clone(draftRange), { clientX: p.clientX, clientY: p.clientY, phase: 'move' });
      render(); return;
    }
    if (draftMeasure) {
      draftMeasure.endX = s.x; draftMeasure.endY = s.y;
      if (onMeasureUpdate) onMeasureUpdate(getDraftMeasureInfo(), { clientX: p.clientX, clientY: p.clientY, phase: 'move' });
      render(); return;
    }
    hoveredToken = findTokenAt(p.x, p.y);
    render();
  }

  function onPointerUp(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.type === 'token') {
      changed('token');
      if (onTokenMoved) onTokenMoved(clone(drag.token), getTokenMapId(drag.token.id));
    }
    drag = null;
    canvas.classList.remove('panning');
    try { canvas.releasePointerCapture?.(e.pointerId); } catch (_) {}
  }

  function onWheel(e) {
    e.preventDefault();
    const p = canvasPos(e), before = screenToGrid(p.x, p.y);
    const factor = e.deltaY < 0 ? 1.13 : 1 / 1.13;
    view().scale = Math.max(0.12, Math.min(8, view().scale * factor));
    const after = screenToGrid(p.x, p.y), c = actualCellSize();
    view().offsetX += (after.x - before.x) * c;
    view().offsetY += (after.y - before.y) * c;
    if (onZoomChanged) onZoomChanged(view().scale, getActiveMapSummary());
    render();
  }

  function onKeyDown(e) {
    const tag = document.activeElement && document.activeElement.tagName && document.activeElement.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) && e.key !== 'Escape') return;
    const k = e.key.toLowerCase();
    if (k === 'v') setTool('select');
    else if (k === 'r') setTool('range');
    else if (k === 'm') setTool('measure');
    else if (k === 'escape') cancelDrafts();
    else if ((k === 'delete' || k === 'backspace') && selectedRange) removeRange(selectedRange.id);
    else if ((k === 'delete' || k === 'backspace') && selectedToken && (selectedToken.kind || 'character') !== 'character') removeToken(selectedToken.id);
  }

  function render() {
    if (!ctx || !canvas) return;
    const w = cssWidth(), h = cssHeight(), st = settings();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = st.bgColor; ctx.fillRect(0, 0, w, h);
    drawBackground();
    if (st.showGrid) drawGrid();
    activeMap().ranges.forEach(r => drawRange(r, r === selectedRange));
    if (draftRange) drawRange(draftRange, true, true);
    activeMap().measurements.forEach(m => drawMeasurement(m, false));
    if (draftMeasure) drawMeasurement(draftMeasure, true);
    activeMap().tokens.forEach(drawToken);
    drawOrigin();
  }

  function drawBackground() {
    if (!backgroundImage || !backgroundImage.complete || !backgroundImage.naturalWidth) return;
    const st = settings(), c = actualCellSize(), v = view();
    const ratio = c / Number(st.cellSize || 50);
    const x = Number(st.bgOffsetGridX || 0) * c + v.offsetX;
    const y = Number(st.bgOffsetGridY || 0) * c + v.offsetY;
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, Number(st.backgroundOpacity || 0.82)));
    ctx.drawImage(backgroundImage, x, y, backgroundImage.naturalWidth * ratio, backgroundImage.naturalHeight * ratio);
    ctx.restore();
  }

  function drawGrid() {
    const c = actualCellSize(), v = view(), w = cssWidth(), h = cssHeight(), st = settings();
    const sx = Math.floor(-v.offsetX / c) - 1, ex = Math.ceil((w - v.offsetX) / c) + 1;
    const sy = Math.floor(-v.offsetY / c) - 1, ey = Math.ceil((h - v.offsetY) / c) + 1;
    ctx.save(); ctx.strokeStyle = st.gridColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.56; ctx.beginPath();
    for (let x = sx; x <= ex; x++) { const px = x * c + v.offsetX; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
    for (let y = sy; y <= ey; y++) { const py = y * c + v.offsetY; ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke(); ctx.globalAlpha = 0.24; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let x = Math.floor(sx / 5) * 5; x <= ex; x += 5) { const px = x * c + v.offsetX; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
    for (let y = Math.floor(sy / 5) * 5; y <= ey; y += 5) { const py = y * c + v.offsetY; ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke(); ctx.restore();
  }

  function drawOrigin() {
    const p = gridToScreen(0, 0); ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = '#9096bd'; ctx.beginPath();
    ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y); ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8); ctx.stroke(); ctx.restore();
  }

  function applyRangeMaterial(r) {
    const color = r.color || settings().rangeColor;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = r === selectedRange ? 2.6 : 1.8;
    ctx.globalAlpha = Math.max(0.04, Math.min(0.85, Number(r.opacity == null ? 0.22 : r.opacity)));
    if (r.material === 'outline') ctx.globalAlpha = 0;
    if (r.material === 'hatch') ctx.globalAlpha *= 0.55;
  }

  function rangePath(r) {
    const p = gridToScreen(r.originX, r.originY), cells = Math.max(0.01, distanceToCells(r.distance, r.unit)), px = cells * actualCellSize();
    const dx = r.endX - r.originX, dy = r.endY - r.originY;
    const dir = Math.atan2(dy || -1, dx || 0);
    ctx.beginPath();
    if (r.type === 'circle') ctx.arc(p.x, p.y, px, 0, Math.PI * 2);
    else if (r.type === 'cube') ctx.rect(p.x - px / 2, p.y - px / 2, px, px);
    else if (r.type === 'cone') {
      const half = Number(r.angle || 60) * Math.PI / 360;
      ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, px, dir - half, dir + half); ctx.closePath();
    } else {
      const widthPx = Math.max(2, distanceToCells(r.width, r.widthUnit) * actualCellSize());
      const ex = p.x + Math.cos(dir) * px, ey = p.y + Math.sin(dir) * px;
      const nx = -Math.sin(dir) * widthPx / 2, ny = Math.cos(dir) * widthPx / 2;
      ctx.moveTo(p.x + nx, p.y + ny); ctx.lineTo(ex + nx, ey + ny); ctx.lineTo(ex - nx, ey - ny); ctx.lineTo(p.x - nx, p.y - ny); ctx.closePath();
    }
  }

  function drawRange(r, selected, draft) {
    ctx.save(); applyRangeMaterial(r); rangePath(r);
    if (r.material !== 'outline') ctx.fill();
    ctx.globalAlpha = selected || draft ? 0.95 : 0.72; ctx.setLineDash(r.material === 'hatch' ? [6, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    const origin = gridToScreen(r.originX, r.originY); ctx.fillStyle = r.color || settings().rangeColor; ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2); ctx.fill();
    const label = [r.note, r.distance + ' ' + (UNIT_LABEL[r.unit] || r.unit)].filter(Boolean).join(' · ');
    drawLabel(label, origin.x + 8, origin.y - 8, r.color || settings().rangeColor, 'left');
    ctx.restore();
  }

  function drawMeasurement(m, active) {
    const a = gridToScreen(m.startX, m.startY), b = gridToScreen(m.endX, m.endY);
    const cells = Math.hypot(m.endX - m.startX, m.endY - m.startY);
    ctx.save(); ctx.strokeStyle = active ? '#6ce4aa' : '#4fcf93'; ctx.lineWidth = active ? 2.4 : 1.5; ctx.setLineDash(active ? [6, 4] : [4, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    drawLabel(formatDistance(cells, m.unit), (a.x + b.x) / 2, (a.y + b.y) / 2, '#6ce4aa', 'center'); ctx.restore();
  }

  function drawLabel(text, x, y, color, align) {
    if (!text) return;
    ctx.save(); ctx.font = '600 11px "Microsoft YaHei", sans-serif'; const tw = ctx.measureText(text).width, pad = 6, h = 22;
    const left = align === 'center' ? x - tw / 2 - pad : x;
    ctx.fillStyle = 'rgba(7,9,19,.88)'; roundRect(ctx, left, y - h / 2, tw + pad * 2, h, 5); ctx.fill();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.65; ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = '#f4f5ff'; ctx.textAlign = align === 'center' ? 'center' : 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, align === 'center' ? x : x + pad, y); ctx.restore();
  }

  function drawToken(token) {
    const p = gridToScreen(token.gridX, token.gridY), c = actualCellSize(), size = Math.max(0.35, Number(token.size || 1)), r = c * 0.42 * size;
    const selected = token === selectedToken, hovered = token === hoveredToken;
    ctx.save();
    if (selected || hovered) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.fillStyle = selected ? 'rgba(224,188,88,.32)' : 'rgba(255,255,255,.12)'; ctx.fill(); if (selected) { ctx.strokeStyle = '#e0bc58'; ctx.lineWidth = 2; ctx.stroke(); } }
    const imageUrl = token.avatarUrl || token.data?.assets?.avatarFramed || token.data?.assets?.avatar;
    if (imageUrl) drawTokenImage(token, imageUrl, p.x, p.y, r);
    else {
      ctx.beginPath();
      if (token.shape === 'square') ctx.rect(p.x - r, p.y - r, r * 2, r * 2); else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = token.color || '#4ecdc4'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(12, r * .85)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(token.icon || String(token.name || '?').charAt(0), p.x, p.y);
    }
    if (token.hp !== undefined && token.maxHp > 0) {
      const ratio = Math.max(0, Math.min(1, token.hp / token.maxHp)), bw = r * 1.65, bh = 5, y = p.y - r - 9;
      ctx.fillStyle = 'rgba(5,7,14,.85)'; ctx.fillRect(p.x - bw / 2 - 1, y - 1, bw + 2, bh + 2);
      ctx.fillStyle = ratio > .5 ? '#55c07a' : ratio > .25 ? '#f0c040' : '#e05555'; ctx.fillRect(p.x - bw / 2, y, bw * ratio, bh);
    }
    drawLabel(token.displayName || token.name, p.x, p.y + r + 16, selected ? '#e0bc58' : 'rgba(255,255,255,.18)', 'center');
    ctx.restore();
  }

  function drawTokenImage(token, url, x, y, r) {
    let img = tokenImageCache[url];
    if (!img) { img = new Image(); img.onload = render; img.onerror = () => { tokenImageCache[url] = null; }; img.src = url; tokenImageCache[url] = img; }
    ctx.save(); ctx.beginPath(); if (token.shape === 'square') ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    if (img.complete && img.naturalWidth) ctx.drawImage(img, x - r, y - r, r * 2, r * 2); else { ctx.fillStyle = token.color; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.restore(); ctx.beginPath(); if (token.shape === 'square') ctx.rect(x - r, y - r, r * 2, r * 2); else ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function roundRect(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function changed(reason) { if (onStateChanged) onStateChanged(exportState(), reason || 'state'); }
  function notifyMaps() { if (onMapsChanged) onMapsChanged(getMaps(), activeMapId); if (onMapChanged) onMapChanged(getActiveMapSummary()); }
  function loadBackground() {
    const src = settings().backgroundSrc || '';
    backgroundImage = null; backgroundImageSrc = src;
    if (!src) { render(); return; }
    const img = new Image(); img.onload = () => { if (backgroundImageSrc === src) { backgroundImage = img; render(); } }; img.onerror = () => { if (backgroundImageSrc === src) { backgroundImage = null; render(); } }; img.src = src;
  }

  function setTool(tool) {
    currentTool = ['select', 'range', 'measure'].includes(tool) ? tool : 'select';
    cancelDrafts(false);
    canvas.className = currentTool === 'range' ? 'ranging' : currentTool === 'measure' ? 'measuring' : 'selecting';
    if (window.UIManager && window.UIManager.updateToolButtons) window.UIManager.updateToolButtons(currentTool);
    render();
  }
  function getTool() { return currentTool; }
  function cancelDrafts(renderNow = true) { draftRange = null; draftMeasure = null; if (onRangeDraft) onRangeDraft(null); if (onMeasureUpdate) onMeasureUpdate(null); if (renderNow) render(); }

  function updateDraftRange(patch) { if (!draftRange) return null; Object.assign(draftRange, patch || {}); render(); return clone(draftRange); }
  function commitDraftRange(anchor) {
    if (!draftRange) return null;
    const r = normalizeRange(Object.assign({}, draftRange, { locked: true }));
    activeMap().ranges.push(r); selectedRange = r; draftRange = null;
    if (onRangeDraft) onRangeDraft(null);
    if (onRangeSelected) onRangeSelected(clone(r), anchor || { phase: 'committed' });
    changed('overlay'); render(); return clone(r);
  }
  function getDraftRange() { return draftRange ? clone(draftRange) : null; }
  function getDraftMeasureInfo() {
    if (!draftMeasure) return null;
    const cells = Math.hypot(draftMeasure.endX - draftMeasure.startX, draftMeasure.endY - draftMeasure.startY);
    return { measurement: clone(draftMeasure), cells, distance: cellsToDistance(cells, draftMeasure.unit), unit: draftMeasure.unit, label: formatDistance(cells, draftMeasure.unit), map: getActiveMapSummary() };
  }

  function setRange(type, size, options = {}) {
    const origin = options.origin || { x: mouseGridX, y: mouseGridY };
    const r = normalizeRange({ type, distance: size, unit: options.unit || settings().scaleUnit, width: options.width || 5, widthUnit: options.widthUnit || settings().scaleUnit, angle: options.angle || 60, originX: origin.x, originY: origin.y, endX: origin.x, endY: origin.y - 1, color: options.color || settings().rangeColor, material: options.material || 'soft', note: options.note || '' });
    activeMap().ranges.push(r); selectedRange = r; changed('overlay'); render(); return r;
  }
  function clearRange() { activeMap().ranges = []; selectedRange = null; draftRange = null; changed('overlay'); render(); }
  function getRange() { return selectedRange ? clone(selectedRange) : null; }
  function updateRange(id, patch) { const r = activeMap().ranges.find(x => x.id === id); if (!r) return null; Object.assign(r, patch || {}); changed('overlay'); render(); return clone(r); }
  function removeRange(id) { const m = activeMap(); m.ranges = m.ranges.filter(r => r.id !== id); if (selectedRange && selectedRange.id === id) selectedRange = null; if (onRangeSelected) onRangeSelected(null); changed('overlay'); render(); }
  function getRanges() { return activeMap().ranges.map(clone); }
  function clearMeasurements() { activeMap().measurements = []; draftMeasure = null; changed('overlay'); render(); }

  function addToken(options = {}) {
    const target = maps.find(m => m.id === options.mapId) || activeMap();
    const raw = Object.assign({}, options); delete raw.mapId;
    const t = normalizeToken(raw);
    if (!options.id) do { t.id = `token_${++tokenIdCounter}`; } while (getTokenById(t.id));
    else {
      // 同 id 已存在：整体替换数据（服务端恢复/跨窗口同步时避免重复累积，保证该 id 全局唯一）
      const exist = getTokenById(t.id);
      if (exist) {
        Object.assign(exist, t);
        changed('token'); render();
        return exist;
      }
    }
    target.tokens.push(t); changed('token'); render(); return t;
  }
  function addTokenRemote(options) { return addToken(options); }
  function getTokenById(id) {
    for (const m of maps) { const t = m.tokens.find(x => x.id === id); if (t) return t; }
    return null;
  }
  function updateToken(id, patch) {
    let found = null;
    maps.forEach(m => m.tokens.forEach(t => { if (t.id === id) { Object.assign(t, patch || {}); if (!found) found = t; } }));
    if (found) changed('token'); render(); return found;
  }
  function updateTokenRemote(id, patch) { return updateToken(id, patch); }
  function removeToken(id) { maps.forEach(m => { m.tokens = m.tokens.filter(t => t.id !== id); }); if (selectedToken && selectedToken.id === id) selectedToken = null; if (onTokenSelected) onTokenSelected(null); changed('token'); render(); }
  function removeTokenRemote(id) { return removeToken(id); }
  function getAllTokens() { return activeMap().tokens.slice(); }
  function getAllCharacterTokens() {
    const byId = {};
    maps.forEach(m => m.tokens.forEach(t => { if ((t.kind || 'character') === 'character' && !byId[t.id]) byId[t.id] = t; }));
    return Object.keys(byId).map(id => byId[id]);
  }
  function getAllMapTokens() { return maps.reduce((out, m) => out.concat(m.tokens.map(t => Object.assign({ mapId: m.id, mapName: m.name }, clone(t)))), []); }
  function getTokenMapId(id) { const m = maps.find(map => map.tokens.some(t => t.id === id)); return m ? m.id : activeMapId; }
  function setTokens(list) { activeMap().tokens = (list || []).map(normalizeToken); changed('token'); render(); }
  function clearTokens() { activeMap().tokens = []; selectedToken = null; changed('token'); render(); }
  function getSelectedToken() { return selectedToken; }

  function getMaps() { return maps.map(m => ({ id: m.id, name: m.name, kind: m.kind, tokenCount: m.tokens.length, rangeCount: m.ranges.length, active: m.id === activeMapId })); }
  function getActiveMapSummary() { const m = activeMap(); return { id: m.id, name: m.name, kind: m.kind, settings: clone(m.settings), zoom: m.view.scale, scaleLabel: `1格 = ${m.settings.scaleDistance} ${UNIT_LABEL[m.settings.scaleUnit] || m.settings.scaleUnit}` }; }
  function addMap(options = {}) {
    const m = normalizeMap({ id: options.id || uid('map'), name: options.name || '新地图', kind: options.kind || 'scene', settings: Object.assign({}, DEFAULT_MAP.settings, options.settings || {}), view: { offsetX: cssWidth() / 2, offsetY: cssHeight() / 2, scale: 1 }, tokens: [], ranges: [], measurements: [] }, maps.length);
    maps.push(m); activeMapId = m.id; selectedToken = null; selectedRange = null; cancelDrafts(false); loadBackground(); notifyMaps(); changed('structure'); render(); return clone(m);
  }
  function switchMap(id) {
    if (!maps.some(m => m.id === id) || activeMapId === id) return getActiveMapSummary();
    activeMapId = id; selectedToken = null; selectedRange = null; cancelDrafts(false); loadBackground(); notifyMaps(); if (onZoomChanged) onZoomChanged(view().scale, getActiveMapSummary()); render(); return getActiveMapSummary();
  }
  function updateMap(id, patch) {
    const m = maps.find(x => x.id === id); if (!m) return null;
    if (patch.name != null) m.name = String(patch.name || '未命名地图');
    if (patch.kind != null) m.kind = String(patch.kind || 'scene');
    if (patch.settings) m.settings = Object.assign({}, m.settings, patch.settings);
    if (id === activeMapId) loadBackground(); notifyMaps(); changed('structure'); render(); return clone(m);
  }
  function removeMap(id) {
    if (maps.length <= 1) return false;
    maps = maps.filter(m => m.id !== id);
    if (activeMapId === id) activeMapId = maps[0].id;
    selectedToken = null; selectedRange = null; loadBackground(); notifyMaps(); changed('structure'); render(); return true;
  }

  function setZoom(value) { view().scale = Math.max(0.12, Math.min(8, Number(value || 1))); if (onZoomChanged) onZoomChanged(view().scale, getActiveMapSummary()); changed('view'); render(); }
  function zoomIn() { setZoom(view().scale * 1.2); }
  function zoomOut() { setZoom(view().scale / 1.2); }
  function zoomFit() { view().scale = 1; view().offsetX = cssWidth() / 2; view().offsetY = cssHeight() / 2; if (onZoomChanged) onZoomChanged(1, getActiveMapSummary()); changed('view'); render(); }
  function getZoom() { return view().scale; }
  function setGridVisible(v) { settings().showGrid = !!v; changed('structure'); render(); }
  function setSnapToGrid(v) { settings().snapToGrid = !!v; changed('structure'); }
  function setGridColor(v) { settings().gridColor = v; changed('structure'); render(); }
  function setBgColor(v) { settings().bgColor = v; changed('structure'); render(); }
  function setRangeColor(v) { settings().rangeColor = v; changed('structure'); render(); }
  function setCellSize(v) { settings().cellSize = Math.max(10, Number(v || 50)); changed('structure'); render(); }
  function setScale(distance, unit) { settings().scaleDistance = Math.max(0.0001, Number(distance || 1)); settings().scaleUnit = UNIT_TO_METERS[unit] ? unit : 'm'; changed('structure'); notifyMaps(); render(); }
  function setBackgroundImage(image, offsetGX = 0, offsetGY = 0, src) { settings().backgroundSrc = src || (image && image.src) || ''; settings().bgOffsetGridX = Number(offsetGX || 0); settings().bgOffsetGridY = Number(offsetGY || 0); backgroundImage = image || null; backgroundImageSrc = settings().backgroundSrc; changed('structure'); render(); }
  function setBackgroundSource(src, options = {}) { settings().backgroundSrc = String(src || ''); if (options.opacity != null) settings().backgroundOpacity = Number(options.opacity); if (options.offsetX != null) settings().bgOffsetGridX = Number(options.offsetX); if (options.offsetY != null) settings().bgOffsetGridY = Number(options.offsetY); loadBackground(); changed('structure'); }
  function removeBackgroundImage() { settings().backgroundSrc = ''; backgroundImage = null; backgroundImageSrc = ''; changed('structure'); render(); }
  function getMapSettings() { return clone(settings()); }

  function exportOverlayState(mapId) {
    const m = maps.find(item => item.id === mapId) || activeMap();
    return { mapId: m.id, ranges: clone(m.ranges), measurements: clone(m.measurements) };
  }

  function applyOverlayState(overlay) {
    if (!overlay || !overlay.mapId) return false;
    const m = maps.find(item => item.id === overlay.mapId);
    if (!m) return false;
    if (Array.isArray(overlay.ranges)) m.ranges = overlay.ranges.map(normalizeRange);
    if (Array.isArray(overlay.measurements)) m.measurements = overlay.measurements.map(normalizeMeasurement);
    if (m.id === activeMapId) {
      selectedRange = null;
      draftRange = null;
      draftMeasure = null;
      if (onRangeSelected) onRangeSelected(null);
      if (onRangeDraft) onRangeDraft(null);
      if (onMeasureUpdate) onMeasureUpdate(null);
      render();
    }
    return true;
  }

  function exportState() { return { version: 3, activeMapId, maps: clone(maps) }; }
  function importState(state, options = {}) {
    const localActiveMapId = activeMapId;
    const localViews = {};
    maps.forEach(map => { localViews[map.id] = clone(map.view); });
    if (state && Array.isArray(state.maps)) {
      maps = state.maps.map(normalizeMap);
      if (options.preserveView) {
        maps.forEach(map => { if (localViews[map.id]) map.view = localViews[map.id]; });
        activeMapId = maps.some(map => map.id === localActiveMapId) ? localActiveMapId : (maps.some(map => map.id === state.activeMapId) ? state.activeMapId : maps[0].id);
      } else {
        activeMapId = maps.some(map => map.id === state.activeMapId) ? state.activeMapId : maps[0].id;
      }
    } else {
      const legacy = normalizeMap({ id: DEFAULT_MAP.id, name: '小队地图', view: { offsetX: state?.offsetX || cssWidth() / 2, offsetY: state?.offsetY || cssHeight() / 2, scale: state?.scale || 1 }, settings: { cellSize: state?.cellSize || 50, showGrid: state?.showGrid !== false, snapToGrid: state?.snapToGrid !== false, gridColor: state?.gridColor || '#3a3a5c', bgColor: state?.bgColor || '#1a1a2e', rangeColor: state?.rangeColor || '#ff6b6b', scaleDistance: 5, scaleUnit: 'ft', bgOffsetGridX: state?.bgOffsetGridX || 0, bgOffsetGridY: state?.bgOffsetGridY || 0 }, tokens: state?.tokens || [], ranges: [] }, 0);
      maps = [legacy]; activeMapId = legacy.id;
    }
    selectedToken = null; selectedRange = null; cancelDrafts(false); loadBackground(); notifyMaps(); if (onZoomChanged) onZoomChanged(view().scale, getActiveMapSummary()); render();
  }

  return {
    init, resize, render, setTool, getTool, cancelDrafts,
    setZoom, zoomIn, zoomOut, zoomFit, getZoom,
    setGridVisible, setSnapToGrid, setGridColor, setBgColor, setRangeColor, setCellSize, setScale,
    setBackgroundImage, setBackgroundSource, removeBackgroundImage, getMapSettings, exportOverlayState, applyOverlayState,
    addToken, addTokenRemote, updateToken, updateTokenRemote, removeToken, removeTokenRemote, getTokenById,
    getAllTokens, getAllCharacterTokens, getAllMapTokens, getTokenMapId, setTokens, clearTokens, getSelectedToken,
    setRange, clearRange, getRange, getRanges, updateRange, removeRange, updateDraftRange, getDraftRange, commitDraftRange, clearMeasurements,
    getMaps, getActiveMapSummary, addMap, switchMap, updateMap, removeMap,
    screenToGrid, gridToScreen, distanceToCells, cellsToDistance, formatDistance,
    exportState, importState
  };
})();

if (typeof window !== 'undefined') window.MapEngine = MapEngine;
