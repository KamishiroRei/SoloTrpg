/* ============================================
   TrpgRecode - 地图引擎
   网格渲染、平移缩放、角色标记、范围显示
   ============================================ */

const MapEngine = (() => {
  'use strict';

  // 配置（可被外部修改）
  let cellSize = 50;          // 每个格子像素大小（初始值，缩放会改变）
  let baseCellSize = 50;    // 基准格子大小
  let showGrid = true;
  let snapToGrid = true;
  let gridColor = '#3a3a5c';
  let bgColor = '#1a1a2e';
  let rangeColor = '#ff6b6b';

  // 状态
  let canvas = null;
  let ctx = null;
  let offsetX = 0;       // 地图偏移（像素）
  let offsetY = 0;
  let scale = 1;         // 缩放因子
  let actualCellSize = cellSize; // 实际格子像素 = baseCellSize * scale

  // 标记列表
  let tokens = [];
  let tokenIdCounter = 0;

  // 范围显示
  let currentRange = null;  // { type, size, originX, originY, width, angle }

  // 交互状态
  let currentTool = 'select'; // 'select' | 'pan' | 'range' | 'measure'
  let isDragging = false;
  let dragTarget = null;        // 被拖拽的标记
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOrigGridX = 0;
  let dragOrigGridY = 0;
  let panStartX = 0;
  let panStartY = 0;
  let panStartOffsetX = 0;
  let panStartOffsetY = 0;
  let measureStartX = 0;
  let measureStartY = 0;
  let measureEndX = 0;
  let measureEndY = 0;
  let isMeasuring = false;
  let hoveredToken = null;
  let selectedToken = null;
  let mouseGridX = 0;
  let mouseGridY = 0;
  const tokenImageCache = {};

  // 地图背景
  let backgroundImage = null;
  let bgOffsetGridX = 0;
  let bgOffsetGridY = 0;

  // 回调
  let onTokenSelected = null;
  let onCoordUpdate = null;

  // ========== 初始化 ==========

  function init(canvasEl, options = {}) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');

    if (options.cellSize) cellSize = options.cellSize;
    if (options.gridColor) gridColor = options.gridColor;
    if (options.bgColor) bgColor = options.bgColor;
    if (options.rangeColor) rangeColor = options.rangeColor;
    if (options.onTokenSelected) onTokenSelected = options.onTokenSelected;
    if (options.onCoordUpdate) onCoordUpdate = options.onCoordUpdate;

    updateActualCellSize();
    resize();
    setupEvents();
    render();
  }

  function updateActualCellSize() {
    actualCellSize = baseCellSize * scale;
  }

  function resize() {
    const wrapper = canvas.parentElement;
    if (!wrapper) return;
    canvas.width = wrapper.clientWidth;
    canvas.height = wrapper.clientHeight;
    render();
  }

  // ========== 事件处理 ==========

  function setupEvents() {
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('resize', () => {
      resize();
    });

    // 键盘快捷键
    window.addEventListener('keydown', onKeyDown);
  }

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function screenToGrid(sx, sy) {
    const gx = (sx - offsetX) / actualCellSize;
    const gy = (sy - offsetY) / actualCellSize;
    return { x: gx, y: gy };
  }

  function gridToScreen(gx, gy) {
    const sx = gx * actualCellSize + offsetX;
    const sy = gy * actualCellSize + offsetY;
    return { x: sx, y: sy };
  }

  function snapGrid(gx, gy) {
    if (!snapToGrid) return { x: gx, y: gy };
    return {
      x: Math.round(gx),
      y: Math.round(gy)
    };
  }

  function findTokenAt(sx, sy) {
    const tokenRadius = actualCellSize * 0.45;
    // 从上到下查找（后绘制的在上面）
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      const pos = gridToScreen(t.gridX, t.gridY);
      const dx = sx - pos.x;
      const dy = sy - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < tokenRadius) {
        return t;
      }
    }
    return null;
  }

  function onMouseDown(e) {
    const pos = getCanvasPos(e);
    const grid = screenToGrid(pos.x, pos.y);
    mouseGridX = grid.x;
    mouseGridY = grid.y;

    if (currentTool === 'pan' || e.button === 1) {
      // 平移模式
      isDragging = true;
      panStartX = pos.x;
      panStartY = pos.y;
      panStartOffsetX = offsetX;
      panStartOffsetY = offsetY;
      canvas.classList.add('panning');
      return;
    }

    if (currentTool === 'measure') {
      isMeasuring = true;
      const snapped = snapGrid(grid.x, grid.y);
      measureStartX = snapped.x;
      measureStartY = snapped.y;
      measureEndX = snapped.x;
      measureEndY = snapped.y;
      render();
      return;
    }

    // 选择模式
    const token = findTokenAt(pos.x, pos.y);
    if (token) {
      isDragging = true;
      dragTarget = token;
      dragStartX = pos.x;
      dragStartY = pos.y;
      dragOrigGridX = token.gridX;
      dragOrigGridY = token.gridY;
      selectedToken = token;
      if (onTokenSelected) onTokenSelected(token);
      render();
    } else {
      selectedToken = null;
      if (onTokenSelected) onTokenSelected(null);
      render();
    }
  }

  function onMouseMove(e) {
    const pos = getCanvasPos(e);
    const grid = screenToGrid(pos.x, pos.y);
    mouseGridX = grid.x;
    mouseGridY = grid.y;

    if (onCoordUpdate) {
      const snapped = snapGrid(grid.x, grid.y);
      onCoordUpdate(snapped.x, snapped.y);
    }

    if (isDragging && dragTarget) {
      // 拖拽标记
      const dx = pos.x - dragStartX;
      const dy = pos.y - dragStartY;
      const newGridX = dragOrigGridX + dx / actualCellSize;
      const newGridY = dragOrigGridY + dy / actualCellSize;
      const snapped = snapGrid(newGridX, newGridY);
      dragTarget.gridX = snapped.x;
      dragTarget.gridY = snapped.y;
      render();
      return;
    }

    if (isDragging && currentTool === 'pan') {
      offsetX = panStartOffsetX + (pos.x - panStartX);
      offsetY = panStartOffsetY + (pos.y - panStartY);
      render();
      return;
    }

    if (isDragging && (e.buttons & 1) === 0 && (e.buttons & 4) === 0) {
      // 拖拽结束
      isDragging = false;
      dragTarget = null;
    }

    if (isMeasuring) {
      const snapped = snapGrid(grid.x, grid.y);
      measureEndX = snapped.x;
      measureEndY = snapped.y;
      render();
      return;
    }

    // hover 检测
    hoveredToken = findTokenAt(pos.x, pos.y);
    if (hoveredToken !== selectedToken || !hoveredToken) {
      render();
    }
  }

  function onMouseUp(e) {
    if (dragTarget) {
      dragTarget = null;
      isDragging = false;
      render();
    }
    if (isDragging && currentTool === 'pan') {
      isDragging = false;
      canvas.classList.remove('panning');
    }
    if (isMeasuring) {
      // 输出测量距离
      const dx = measureEndX - measureStartX;
      const dy = measureEndY - measureStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (window._onMeasureComplete) {
        window._onMeasureComplete(measureStartX, measureStartY, measureEndX, measureEndY, dist);
      }
      isMeasuring = false;
      render();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const pos = getCanvasPos(e);
    const oldGrid = screenToGrid(pos.x, pos.y);

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    scale = Math.max(0.2, Math.min(5, scale * zoomFactor));
    updateActualCellSize();

    // 以鼠标位置为中心缩放
    const newGrid = screenToGrid(pos.x, pos.y);
    offsetX += (newGrid.x - oldGrid.x) * actualCellSize;
    offsetY += (newGrid.y - oldGrid.y) * actualCellSize;

    if (onCoordUpdate) {
      const snapped = snapGrid(mouseGridX, mouseGridY);
      onCoordUpdate(snapped.x, snapped.y);
    }

    render();
  }

  function onKeyDown(e) {
    // 如果焦点在输入框中，不处理快捷键（除了Escape）
    const tag = document.activeElement?.tagName?.toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (isInput && e.key !== 'Escape') return;

    switch (e.key.toLowerCase()) {
      case 'v':
        setTool('select');
        break;
      case 'h':
        setTool('pan');
        break;
      case 'r':
        setTool('range');
        break;
      case 'm':
        setTool('measure');
        break;
      case 'escape':
        clearRange();
        selectedToken = null;
        if (onTokenSelected) onTokenSelected(null);
        render();
        break;
      case 'delete':
      case 'backspace':
        if (selectedToken && currentTool === 'select') {
          removeToken(selectedToken.id);
        }
        break;
    }
  }

  // ========== 渲染 ==========

  function render() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景色
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 背景图片
    if (backgroundImage) {
      const imgX = bgOffsetGridX * actualCellSize + offsetX;
      const imgY = bgOffsetGridY * actualCellSize + offsetY;
      const imgW = backgroundImage.width * (actualCellSize / baseCellSize);
      const imgH = backgroundImage.height * (actualCellSize / baseCellSize);
      ctx.globalAlpha = 0.7;
      ctx.drawImage(backgroundImage, imgX, imgY, imgW, imgH);
      ctx.globalAlpha = 1;
    }

    // 网格
    if (showGrid) {
      drawGrid();
    }

    // 范围显示
    if (currentRange) {
      drawRange();
    }

    // 测量线
    if (isMeasuring) {
      drawMeasureLine();
    }

    // 标记
    for (const token of tokens) {
      drawToken(token);
    }

    // 原点十字标记
    drawOriginCross();
  }

  function drawGrid() {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = Math.max(0.5, 0.5 * scale);

    // 计算可见范围
    const startGX = Math.floor(-offsetX / actualCellSize) - 1;
    const startGY = Math.floor(-offsetY / actualCellSize) - 1;
    const endGX = Math.ceil((canvas.width - offsetX) / actualCellSize) + 1;
    const endGY = Math.ceil((canvas.height - offsetY) / actualCellSize) + 1;

    ctx.beginPath();
    for (let gx = startGX; gx <= endGX; gx++) {
      const sx = gx * actualCellSize + offsetX;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    for (let gy = startGY; gy <= endGY; gy++) {
      const sy = gy * actualCellSize + offsetY;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();

    // 主轴线（每5格加粗）
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = Math.max(1, 1 * scale);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    for (let gx = Math.floor(startGX / 5) * 5; gx <= endGX; gx += 5) {
      const sx = gx * actualCellSize + offsetX;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    for (let gy = Math.floor(startGY / 5) * 5; gy <= endGY; gy += 5) {
      const sy = gy * actualCellSize + offsetY;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawOriginCross() {
    const origin = gridToScreen(0, 0);
    ctx.strokeStyle = '#666688';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(origin.x - 8, origin.y);
    ctx.lineTo(origin.x + 8, origin.y);
    ctx.moveTo(origin.x, origin.y - 8);
    ctx.lineTo(origin.x, origin.y + 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawToken(token) {
    const pos = gridToScreen(token.gridX, token.gridY);
    const r = actualCellSize * 0.42;
    const isSelected = token === selectedToken;
    const isHovered = token === hoveredToken;

    // 光晕
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? 'rgba(201, 168, 76, 0.4)' : 'rgba(255, 255, 255, 0.15)';
      ctx.fill();
      if (isSelected) {
        ctx.strokeStyle = '#c9a84c';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    const avatarUrl = token.avatarUrl || token.data?.assets?.avatarFramed || token.data?.assets?.avatar;
    if (avatarUrl) {
      drawTokenImage(token, avatarUrl, pos.x, pos.y, r);
    } else {
      // 身体圆
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = token.color || '#4ecdc4';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 首字母
      const initial = (token.name || token.displayName || '?').charAt(0);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, r * 0.9)}px "${getFontFamily()}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, pos.x, pos.y);
    }

    // 名字标签
    const display = token.displayName || token.name || '';
    if (display) {
      const fontSize = Math.max(9, 11 * scale);
      ctx.font = `${fontSize}px "${getFontFamily()}"`;
      const textWidth = ctx.measureText(display).width;
      const labelY = pos.y + r + fontSize + 2;

      // 背景
      const padX = 4;
      const padY = 2;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(pos.x - textWidth / 2 - padX, labelY - fontSize / 2 - padY, textWidth + padX * 2, fontSize + padY * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(display, pos.x, labelY);
    }

    // HP条（如果有）
    if (token.hp !== undefined && token.maxHp !== undefined && token.maxHp > 0) {
      const hpRatio = Math.max(0, token.hp / token.maxHp);
      const barWidth = r * 1.6;
      const barHeight = Math.max(3, 4 * scale);
      const barY = pos.y - r - barHeight - 2;

      // 背景
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(pos.x - barWidth / 2, barY, barWidth, barHeight);

      // HP填充
      const hpColor = hpRatio > 0.5 ? '#55c07a' : hpRatio > 0.25 ? '#f0c040' : '#e05555';
      ctx.fillStyle = hpColor;
      ctx.fillRect(pos.x - barWidth / 2, barY, barWidth * hpRatio, barHeight);
    }

    // 状态图标（如果有条件）
    if (token.conditions && token.conditions.length > 0) {
      const iconSize = Math.max(8, 12 * scale);
      const iconY = pos.y - r - 14 * scale;
      ctx.font = `${iconSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(token.conditions.slice(0, 3).join(''), pos.x, iconY);
    }
  }

  function drawTokenImage(token, url, x, y, r) {
    let img = tokenImageCache[url];
    if (!img) {
      img = new Image();
      img.onload = () => render();
      img.onerror = () => { tokenImageCache[url] = null; };
      img.src = url;
      tokenImageCache[url] = img;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = token.color || '#4ecdc4';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function getFontFamily() {
    return "'Microsoft YaHei', 'Noto Sans SC', 'Segoe UI', sans-serif";
  }

  // ========== 范围显示 ==========

  function drawRange() {
    if (!currentRange) return;

    const { type, size, width, angle } = currentRange;
    let originX, originY;

    if (currentRange.originTokenId && currentRange.originTokenId !== 'cursor') {
      const token = getTokenById(currentRange.originTokenId);
      if (token) {
        originX = token.gridX;
        originY = token.gridY;
      } else {
        originX = mouseGridX;
        originY = mouseGridY;
      }
    } else {
      originX = mouseGridX;
      originY = mouseGridY;
    }

    ctx.fillStyle = rangeColor;
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = rangeColor;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.globalAlpha = 1;
    ctx.setLineDash([4 * scale, 4 * scale]);

    switch (type) {
      case 'circle':
        drawCircleRange(originX, originY, size);
        break;
      case 'cone':
        drawConeRange(originX, originY, size, angle || 60);
        break;
      case 'line':
        drawLineRange(originX, originY, size, width || 5);
        break;
      case 'cube':
        drawCubeRange(originX, originY, size);
        break;
    }

    ctx.setLineDash([]);
  }

  function drawCircleRange(gx, gy, radius) {
    // 高亮范围内的格子
    const startGX = Math.floor(gx - radius);
    const startGY = Math.floor(gy - radius);
    const endGX = Math.ceil(gx + radius);
    const endGY = Math.ceil(gy + radius);

    ctx.fillStyle = rangeColor;
    ctx.globalAlpha = 0.2;
    for (let cx = startGX; cx <= endGX; cx++) {
      for (let cy = startGY; cy <= endGY; cy++) {
        // 使用格子中心计算距离
        const cellCenterX = cx + 0.5;
        const cellCenterY = cy + 0.5;
        const dist = Math.sqrt((cellCenterX - gx) ** 2 + (cellCenterY - gy) ** 2);
        if (dist <= radius) {
          const pos = gridToScreen(cx, cy);
          ctx.fillRect(pos.x, pos.y, actualCellSize, actualCellSize);
        }
      }
    }

    // 外圈
    const center = gridToScreen(gx, gy);
    const pixelRadius = radius * actualCellSize;
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = rangeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, pixelRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 中心点
    ctx.fillStyle = rangeColor;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  function drawConeRange(gx, gy, length, angleDeg) {
    const angleRad = (angleDeg * Math.PI) / 180;
    const center = gridToScreen(gx, gy);

    // 高亮锥形范围内的格子
    const startGX = Math.floor(gx - length);
    const startGY = Math.floor(gy - length);
    const endGX = Math.ceil(gx + length);
    const endGY = Math.ceil(gy + length);

    ctx.fillStyle = rangeColor;
    ctx.globalAlpha = 0.2;
    for (let cx = startGX; cx <= endGX; cx++) {
      for (let cy = startGY; cy <= endGY; cy++) {
        const cellCenterX = cx + 0.5;
        const cellCenterY = cy + 0.5;
        const dx = cellCenterX - gx;
        const dy = cellCenterY - gy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= length) {
          // 检查角度（锥形指向上方 -Y方向）
          const cellAngle = Math.atan2(-dy, dx);
          if (Math.abs(cellAngle - Math.PI / 2) <= angleRad / 2) {
            const pos = gridToScreen(cx, cy);
            ctx.fillRect(pos.x, pos.y, actualCellSize, actualCellSize);
          }
        }
      }
    }

    // 绘制锥形轮廓
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = rangeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const tipX = center.x;
    const tipY = center.y;
    const lenPx = length * actualCellSize;
    // 左侧射线（锥形指向上方）
    const leftAngle = Math.PI / 2 - angleRad / 2;
    const rightAngle = Math.PI / 2 + angleRad / 2;

    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(leftAngle) * lenPx, tipY - Math.sin(leftAngle) * lenPx);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(rightAngle) * lenPx, tipY - Math.sin(rightAngle) * lenPx);

    // 弧线
    ctx.beginPath();
    ctx.arc(tipX, tipY, lenPx, -(rightAngle), -(leftAngle), false);
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  function drawLineRange(gx, gy, length, width) {
    // 线形范围：从原点向上延伸
    const startGX = Math.floor(gx - width);
    const startGY = Math.floor(gy - length);
    const endGX = Math.ceil(gx + width);
    const endGY = Math.ceil(gy);

    ctx.fillStyle = rangeColor;
    ctx.globalAlpha = 0.2;
    for (let cx = startGX; cx <= endGX; cx++) {
      for (let cy = startGY; cy <= endGY; cy++) {
        const distY = gy - cy; // 上方距离
        const distX = Math.abs(cx - gx);
        if (distY >= 0 && distY <= length && distX <= width / 2) {
          const pos = gridToScreen(cx, cy);
          ctx.fillRect(pos.x, pos.y, actualCellSize, actualCellSize);
        }
      }
    }

    // 绘制线形轮廓（指向上方）
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = rangeColor;
    ctx.lineWidth = 2;
    const top = gridToScreen(gx, gy);
    const bottom = gridToScreen(gx, gy - length);
    const halfW = (width / 2) * actualCellSize;

    ctx.beginPath();
    ctx.moveTo(top.x - halfW, top.y);
    ctx.lineTo(bottom.x - halfW, bottom.y);
    ctx.lineTo(bottom.x + halfW, bottom.y);
    ctx.lineTo(top.x + halfW, top.y);
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  function drawCubeRange(gx, gy, sideLength) {
    // 方形范围以(gx, gy)为中心
    const half = sideLength / 2;
    const startGX = Math.floor(gx - half);
    const startGY = Math.floor(gy - half);
    const endGX = Math.ceil(gx + half);
    const endGY = Math.ceil(gy + half);

    ctx.fillStyle = rangeColor;
    ctx.globalAlpha = 0.2;
    for (let cx = startGX; cx <= endGX; cx++) {
      for (let cy = startGY; cy <= endGY; cy++) {
        const pos = gridToScreen(cx, cy);
        ctx.fillRect(pos.x, pos.y, actualCellSize, actualCellSize);
      }
    }

    // 边框
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = rangeColor;
    ctx.lineWidth = 2;
    const topLeft = gridToScreen(startGX, startGY);
    const sizePx = sideLength * actualCellSize;
    ctx.strokeRect(topLeft.x, topLeft.y, sizePx, sizePx);

    ctx.globalAlpha = 1;
  }

  function drawMeasureLine() {
    const start = gridToScreen(measureStartX, measureStartY);
    const end = gridToScreen(measureEndX, measureEndY);

    ctx.setLineDash([4 * scale, 4 * scale]);
    ctx.strokeStyle = '#55c07a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 距离标签
    const dx = measureEndX - measureStartX;
    const dy = measureEndY - measureStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const label = `${dist.toFixed(1)} 格`;
    const fontSize = Math.max(10, 12 * scale);
    ctx.font = `bold ${fontSize}px "${getFontFamily()}"`;
    const tw = ctx.measureText(label).width;
    ctx.fillRect(midX - tw / 2 - 4, midY - fontSize / 2 - 2, tw + 8, fontSize + 4);
    ctx.fillStyle = '#55c07a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);
  }

  // ========== 标记管理 ==========

  function addToken(options = {}) {
    const id = options.id || `token_${++tokenIdCounter}`;
    const token = {
      id,
      name: options.name || '未命名',
      displayName: options.displayName || options.name || '?',
      color: options.color || '#4ecdc4',
      gridX: options.gridX !== undefined ? options.gridX : 0,
      gridY: options.gridY !== undefined ? options.gridY : 0,
      hp: options.hp,
      maxHp: options.maxHp,
      ac: options.ac,
      conditions: options.conditions || [],
      data: options.data || {}  // 自定义数据
    };
    tokens.push(token);
    render();
    return token;
  }

  function removeToken(id) {
    const idx = tokens.findIndex(t => t.id === id);
    if (idx !== -1) {
      tokens.splice(idx, 1);
      if (selectedToken && selectedToken.id === id) {
        selectedToken = null;
        if (onTokenSelected) onTokenSelected(null);
      }
      render();
    }
  }

  function getTokenById(id) {
    return tokens.find(t => t.id === id) || null;
  }

  function updateToken(id, updates) {
    const token = getTokenById(id);
    if (token) {
      Object.assign(token, updates);
      render();
    }
    return token;
  }

  function getAllTokens() {
    return [...tokens];
  }

  function setTokens(newTokens) {
    tokens = newTokens.map(t => ({ ...t }));
    tokenIdCounter = tokens.length;
    render();
  }

  function clearTokens() {
    tokens = [];
    selectedToken = null;
    render();
  }

  function getSelectedToken() {
    return selectedToken;
  }

  // ========== 范围管理 ==========

  function setRange(type, size, options = {}) {
    currentRange = {
      type,
      size,
      width: options.width || 5,
      angle: options.angle || 60,
      originTokenId: options.originTokenId || 'cursor'
    };
    render();
  }

  function clearRange() {
    currentRange = null;
    render();
  }

  function getRange() {
    return currentRange;
  }

  // ========== 工具管理 ==========

  function setTool(tool) {
    currentTool = tool;
    canvas.className = '';
    if (tool === 'pan') canvas.classList.add('panning');
    else if (tool === 'select') canvas.classList.add('selecting');
    else if (tool === 'range') canvas.classList.add('ranging');
    else if (tool === 'measure') canvas.classList.add('measuring');
    isDragging = false;
    dragTarget = null;
    isMeasuring = false;
    // 通知UI更新工具按钮状态
    if (window.UIManager && window.UIManager.updateToolButtons) {
      window.UIManager.updateToolButtons(tool);
    }
    render();
  }

  function getTool() {
    return currentTool;
  }

  // ========== 视图控制 ==========

  function setZoom(z) {
    scale = Math.max(0.2, Math.min(5, z));
    updateActualCellSize();
    if (window.UIManager && window.UIManager.updateZoomLabel) {
      window.UIManager.updateZoomLabel();
    }
    render();
  }

  function zoomIn() {
    setZoom(scale * 1.2);
  }

  function zoomOut() {
    setZoom(scale / 1.2);
  }

  function zoomFit() {
    scale = 1;
    offsetX = canvas.width / 2;
    offsetY = canvas.height / 2;
    updateActualCellSize();
    if (window.UIManager && window.UIManager.updateZoomLabel) {
      window.UIManager.updateZoomLabel();
    }
    render();
  }

  function getZoom() {
    return scale;
  }

  // ========== 配置更新 ==========

  function setGridVisible(visible) {
    showGrid = visible;
    render();
  }

  function setSnapToGrid(snap) {
    snapToGrid = snap;
  }

  function setGridColor(color) {
    gridColor = color;
    render();
  }

  function setBgColor(color) {
    bgColor = color;
    render();
  }

  function setRangeColor(color) {
    rangeColor = color;
    render();
  }

  function setCellSize(size) {
    cellSize = size;
    baseCellSize = size;
    updateActualCellSize();
    render();
  }

  function setBackgroundImage(image, offsetGX = 0, offsetGY = 0) {
    backgroundImage = image;
    bgOffsetGridX = offsetGX;
    bgOffsetGridY = offsetGY;
    render();
  }

  function removeBackgroundImage() {
    backgroundImage = null;
    bgOffsetGridX = 0;
    bgOffsetGridY = 0;
    render();
  }

  // ========== 数据导出/导入 ==========

  function exportState() {
    return {
      tokens: tokens.map(t => ({ ...t })),
      offsetX,
      offsetY,
      scale,
      cellSize,
      showGrid,
      snapToGrid,
      gridColor,
      bgColor,
      rangeColor,
      bgOffsetGridX,
      bgOffsetGridY
    };
  }

  function importState(state) {
    if (state.tokens) setTokens(state.tokens);
    if (state.offsetX !== undefined) offsetX = state.offsetX;
    if (state.offsetY !== undefined) offsetY = state.offsetY;
    if (state.scale !== undefined) scale = state.scale;
    if (state.cellSize !== undefined) cellSize = state.cellSize;
    if (state.showGrid !== undefined) showGrid = state.showGrid;
    if (state.snapToGrid !== undefined) snapToGrid = state.snapToGrid;
    if (state.gridColor) gridColor = state.gridColor;
    if (state.bgColor) bgColor = state.bgColor;
    if (state.rangeColor) rangeColor = state.rangeColor;
    if (state.bgOffsetGridX !== undefined) bgOffsetGridX = state.bgOffsetGridX;
    if (state.bgOffsetGridY !== undefined) bgOffsetGridY = state.bgOffsetGridY;
    updateActualCellSize();
    render();
  }

  return {
    init,
    resize,
    render,
    setTool,
    getTool,
    setZoom,
    zoomIn,
    zoomOut,
    zoomFit,
    getZoom,
    setGridVisible,
    setSnapToGrid,
    setGridColor,
    setBgColor,
    setRangeColor,
    setCellSize,
    setBackgroundImage,
    removeBackgroundImage,
    addToken,
    removeToken,
    getTokenById,
    updateToken,
    getAllTokens,
    setTokens,
    clearTokens,
    getSelectedToken,
    setRange,
    clearRange,
    getRange,
    screenToGrid,
    gridToScreen,
    exportState,
    importState
  };
})();

if (typeof window !== 'undefined') {
  window.MapEngine = MapEngine;
}
