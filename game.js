// 今晚吃啥转盘 — WeChat Mini GAME (canvas-only).
// Ported from dinner-wheel-miniprogram: dish data + wheel-draw + eased spin +
// landing math are reused. There is NO WXML/WXSS — the entire UI (title, tabs,
// wheel, spin button, result, "再转一次") is drawn on one full-screen canvas and
// interaction is manual coordinate hit-testing on wx.onTouchStart.

var dishes = require('./dishes.js');

// Appetizing, distinct segment colors (from index.js) + palette (from index.wxss).
var SEG_COLORS = [
  '#ff6b35', '#f7b32b', '#e94f37', '#2a9d8f',
  '#e76f51', '#ffca3a', '#c1666b', '#4d908e',
  '#f9844a', '#e9c46a', '#bc4749', '#43aa8b'
];
var CONFETTI_COLORS = ['#ff6b35', '#ffd23f', '#2a9d8f', '#e94f37', '#f9844a', '#faf3e6'];

// Palette (from index.wxss)
var COL_BG = '#1a1424';        // night-market aubergine
var COL_CHILI = '#ff6b35';     // chili
var COL_MARIGOLD = '#ffd23f';  // marigold
var COL_CREAM = '#faf3e6';
var COL_MUTED = 'rgba(250,243,230,0.6)';

var TWO_PI = Math.PI * 2;
var FONT = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

// ---- Canvas / screen setup -------------------------------------------------
var canvas = wx.createCanvas();
var ctx = canvas.getContext('2d');

var sys = wx.getSystemInfoSync();
var W = sys.screenWidth;          // CSS px
var H = sys.screenHeight;         // CSS px
var DPR = sys.pixelRatio || 1;

canvas.width = W * DPR;
canvas.height = H * DPR;
ctx.scale(DPR, DPR);              // draw everything in CSS px

var rAF = (typeof requestAnimationFrame === 'function')
  ? requestAnimationFrame
  : function (cb) { return canvas.requestAnimationFrame(cb); };

// ---- Layout (all CSS px) ---------------------------------------------------
// Scale reference: design around a 375-wide viewport, clamp for larger screens.
var PAD = 20;
var titleY = Math.max(48, H * 0.09);
var tabsY = titleY + 44;
var tabH = 32;
var tabRowGap = 8;

// Tab layout is static (labels don't change), so pack the 9 tabs into as many
// centered rows as needed to fit the screen width — computed ONCE at boot.
var TAB_FONT = '600 13px ' + '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
function layoutTabs() {
  var cats = dishes.CATEGORIES;
  ctx.font = TAB_FONT;
  var gap = 6, padX = 12;
  var maxRowW = W - PAD * 2;
  // Greedily pack into rows.
  var rows = [[]];
  var rowW = 0;
  for (var i = 0; i < cats.length; i++) {
    var w = ctx.measureText(cats[i].label).width + padX * 2;
    var add = (rows[rows.length - 1].length ? gap : 0) + w;
    if (rowW + add > maxRowW && rows[rows.length - 1].length) {
      rows.push([]); rowW = 0; add = w;
    }
    rows[rows.length - 1].push({ key: cats[i].key, label: cats[i].label, w: w });
    rowW += add;
  }
  // Assign x/y, centering each row.
  var rects = [];
  for (var r = 0; r < rows.length; r++) {
    var total = 0;
    for (var j = 0; j < rows[r].length; j++) total += rows[r][j].w;
    total += gap * (rows[r].length - 1);
    var x = (W - total) / 2;
    if (x < PAD) x = PAD;
    var y = tabsY + r * (tabH + tabRowGap);
    for (var k = 0; k < rows[r].length; k++) {
      var t = rows[r][k];
      rects.push({ key: t.key, label: t.label, x: x, y: y, w: t.w, h: tabH });
      x += t.w + gap;
    }
  }
  return { rects: rects, rowCount: rows.length };
}
var tabLayout = layoutTabs();
var tabsBlockH = tabLayout.rowCount * tabH + (tabLayout.rowCount - 1) * tabRowGap;

// Wheel geometry: centered, sized to fit width and leave room for result.
var wheelDiameter = Math.min(W - PAD * 2, H * 0.44);
var wheelR = wheelDiameter / 2;
var wheelCX = W / 2;
var wheelCY = tabsY + tabsBlockH + 24 + wheelR;
var hubR = Math.max(38, wheelR * 0.24);   // center spin button radius
var pointerH = Math.max(22, wheelR * 0.13);

// ---- Runtime state ---------------------------------------------------------
var state = {
  activeCat: 'all',
  pool: [],          // full dish list for the active tab
  items: [],         // the ~40 sampled onto the wheel this spin
  rotation: 0,       // radians
  spinning: false,
  result: null,      // { name, cuisine, emoji, line }
  raf: null
};

// Cached hit regions, recomputed on each draw.
var tabRects = [];         // [{ key, x, y, w, h }]
var againRect = null;      // { x, y, w, h } when a result is shown

// Confetti particles.
var confetti = [];         // [{ x, y, vx, vy, color, size, rot, vr, life }]
var confettiActive = false;

// ---- Category loading ------------------------------------------------------
function loadCategory(key) {
  state.activeCat = key;
  state.pool = dishes.getPool(key);
  state.items = dishes.sampleWheel(state.pool);
  state.rotation = 0;
  state.result = null;
  confetti = [];
  confettiActive = false;
  draw();
}

// ---- Drawing ---------------------------------------------------------------
function draw() {
  // Background: radial warm glow at top over aubergine (approximates the wxss).
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, W, H);
  var glow = ctx.createRadialGradient(W / 2, -H * 0.1, 0, W / 2, -H * 0.1, W * 0.9);
  glow.addColorStop(0, 'rgba(255,107,53,0.18)');
  glow.addColorStop(1, 'rgba(255,107,53,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  drawTitle();
  drawTabs();
  drawWheel();
  drawPointer();
  drawHub();
  drawResult();
  if (confettiActive) drawConfetti();
}

function drawTitle() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COL_MARIGOLD;
  ctx.font = '800 26px ' + FONT;
  ctx.fillText('今晚吃啥 🎡', W / 2, titleY);
  ctx.fillStyle = COL_MUTED;
  ctx.font = '400 13px ' + FONT;
  ctx.fillText('转一转，别再纠结了', W / 2, titleY + 24);
}

function drawTabs() {
  // tabLayout is precomputed once at boot; just render + expose hit rects.
  tabRects = tabLayout.rects;
  for (var j = 0; j < tabRects.length; j++) {
    var t = tabRects[j];
    var active = t.key === state.activeCat;
    roundRect(t.x, t.y, t.w, t.h, t.h / 2);
    if (active) {
      ctx.fillStyle = COL_MARIGOLD;
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = active ? COL_BG : 'rgba(250,243,230,0.75)';
    ctx.font = (active ? '700 ' : '600 ') + '13px ' + FONT;
    ctx.fillText(t.label, t.x + t.w / 2, t.y + t.h / 2 + 0.5);
  }
}

// Reused wheel-draw from index.js (translate/rotate + wedges + labels + rim).
// Adaptive rendering knobs that scale with segment count n, so the wheel stays
// legible from 8 up to ~64 dishes.
function wheelStyleFor(n) {
  // Font size: fewer segments -> bigger text.
  var fontSize;
  if (n <= 12) fontSize = 15;
  else if (n <= 20) fontSize = 12;
  else if (n <= 32) fontSize = 10;
  else if (n <= 48) fontSize = 9;
  else fontSize = 8;

  // Max label chars (Chinese chars are wide): tighter when dense.
  var maxChars;
  if (n <= 12) maxChars = 7;
  else if (n <= 20) maxChars = 6;
  else if (n <= 32) maxChars = 5;
  else maxChars = 4;

  // Thinner dividers + inset when dense.
  var divider = n > 32 ? 0.6 : (n > 20 ? 1 : 2);
  var inset = n > 32 ? 8 : (n > 20 ? 10 : 14);
  return { fontSize: fontSize, maxChars: maxChars, divider: divider, inset: inset };
}

function fitLabel(name, maxChars) {
  if (name.length <= maxChars) return name;
  return name.slice(0, maxChars - 1) + '…';
}

function drawWheel() {
  var items = state.items;
  var n = items.length;
  if (n === 0) return;
  var radius = wheelR;
  var seg = TWO_PI / n;
  var style = wheelStyleFor(n);

  ctx.save();
  ctx.translate(wheelCX, wheelCY);
  ctx.rotate(state.rotation);

  for (var i = 0; i < n; i++) {
    var start = i * seg;
    var end = start + seg;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = SEG_COLORS[i % SEG_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,20,36,0.55)';
    ctx.lineWidth = style.divider;
    ctx.stroke();

    // label
    ctx.save();
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL_BG;
    ctx.font = '600 ' + style.fontSize + 'px ' + FONT;
    var label = fitLabel(items[i].name, style.maxChars);
    ctx.fillText(label, radius - style.inset, 0);
    ctx.restore();
  }

  // outer rim
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.strokeStyle = COL_CREAM;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.restore();
}

// Top pointer (12 o'clock), drawn in screen space (does not rotate).
function drawPointer() {
  var tipY = wheelCY - wheelR - 2;
  var baseY = tipY - pointerH;
  var half = pointerH * 0.62;
  ctx.beginPath();
  ctx.moveTo(wheelCX, tipY);           // tip points DOWN at the wheel
  ctx.lineTo(wheelCX - half, baseY);
  ctx.lineTo(wheelCX + half, baseY);
  ctx.closePath();
  ctx.fillStyle = COL_CHILI;
  ctx.fill();
}

// Center hub = the 转! button.
function drawHub() {
  var g = ctx.createLinearGradient(wheelCX, wheelCY - hubR, wheelCX, wheelCY + hubR);
  g.addColorStop(0, '#ff8a4c');
  g.addColorStop(1, '#ff5722');
  ctx.beginPath();
  ctx.arc(wheelCX, wheelCY, hubR, 0, TWO_PI);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COL_CREAM;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = '800 ' + Math.round(hubR * 0.62) + 'px ' + FONT;
  ctx.fillText(state.spinning ? '…' : '转!', wheelCX, wheelCY + 1);
}

// Greedy char-wrap by measured width; caps at maxLines with an ellipsis.
// Caller must set ctx.font first.
function wrapLines(text, maxWidth, maxLines) {
  var lines = [];
  var cur = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (cur && ctx.measureText(cur + ch).width > maxWidth) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    var last = lines[maxLines - 1];
    while (last.length && ctx.measureText(last + '…').width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function drawResult() {
  againRect = null;
  var topY = wheelCY + wheelR + 22;
  if (!state.result) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COL_MUTED;
    ctx.font = '400 15px ' + FONT;
    ctx.fillText('点中间「转!」开始', W / 2, topY + 8);
    return;
  }
  var r = state.result;
  var maxW = W - PAD * 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  var y = topY;

  // Eyebrow — "今晚就吃", plus a ⭐必吃 tag when the dish is a regional icon.
  ctx.font = '600 13px ' + FONT;
  ctx.fillStyle = r.iconic ? COL_MARIGOLD : COL_MUTED;
  ctx.fillText(r.iconic ? '⭐ 今晚就吃 · 当地必吃' : '今晚就吃', W / 2, y);
  y += 20;

  // Dish name — shrink font if it would overflow the width.
  var nameStr = r.emoji + ' ' + r.name;
  var nameSize = 34;
  ctx.font = '800 ' + nameSize + 'px ' + FONT;
  while (nameSize > 20 && ctx.measureText(nameStr).width > maxW) {
    nameSize -= 3;
    ctx.font = '800 ' + nameSize + 'px ' + FONT;
  }
  ctx.fillStyle = COL_MARIGOLD;
  ctx.fillText(nameStr, W / 2, y);
  y += nameSize + 8;

  // Subtitle — native name (if any) · place.
  var sub = r.native ? (r.native + ' · ' + r.cuisine) : r.cuisine;
  ctx.font = '500 14px ' + FONT;
  ctx.fillStyle = COL_CHILI;
  ctx.fillText(sub, W / 2, y);
  y += 22;

  // Note (简介) — wrapped to at most 2 lines.
  if (r.note) {
    ctx.font = '400 13px ' + FONT;
    ctx.fillStyle = 'rgba(250,243,230,0.78)';
    var noteLines = wrapLines(r.note, maxW, 2);
    for (var i = 0; i < noteLines.length; i++) {
      ctx.fillText(noteLines[i], W / 2, y);
      y += 18;
    }
    y += 4;
  }

  // Fun one-liner.
  ctx.font = '500 15px ' + FONT;
  ctx.fillStyle = COL_CREAM;
  ctx.fillText(r.line, W / 2, y);
  y += 26;

  // 再转一次 button.
  var label = '再转一次';
  ctx.font = '700 16px ' + FONT;
  var bw = ctx.measureText(label).width + 56;
  var bh = 44;
  var bx = (W - bw) / 2;
  var by = y;
  roundRect(bx, by, bw, bh, bh / 2);
  ctx.fillStyle = COL_MARIGOLD;
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COL_BG;
  ctx.fillText(label, W / 2, by + bh / 2 + 0.5);
  againRect = { x: bx, y: by, w: bw, h: bh };
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- Spin (reused eased landing math from index.js) ------------------------
function spin() {
  if (state.spinning) return;
  if (!state.pool || state.pool.length === 0) return;
  // Fresh sample each spin: over repeated spins the whole region pool is seen.
  state.items = dishes.sampleWheel(state.pool);
  var items = state.items;
  var n = items.length;
  if (n === 0) return;

  var seg = TWO_PI / n;

  // Pick a random winning index up front, then compute the exact final rotation
  // that lands that segment's CENTER under the top pointer (12 o'clock =
  // canvas angle -PI/2).
  var winIndex = Math.floor(Math.random() * n);
  var segCenter = winIndex * seg + seg / 2;
  var pointerAngle = -Math.PI / 2;
  var extraTurns = 5 + Math.floor(Math.random() * 3); // 5-7 full spins
  var target = pointerAngle - segCenter;
  var current = state.rotation % TWO_PI;
  var normalizedTarget = ((target - current) % TWO_PI + TWO_PI) % TWO_PI;
  var totalDelta = extraTurns * TWO_PI + normalizedTarget;
  var startRotation = state.rotation;
  var endRotation = startRotation + totalDelta;

  var duration = 3500;
  var startTs = null;

  state.spinning = true;
  state.result = null;
  confettiActive = false;

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function frame(ts) {
    if (startTs === null) startTs = ts;
    var elapsed = ts - startTs;
    var t = Math.min(elapsed / duration, 1);
    var eased = easeOutCubic(t);
    state.rotation = startRotation + totalDelta * eased;
    draw();
    if (t < 1) {
      state.raf = rAF(frame);
    } else {
      state.rotation = endRotation;
      onLanded(winIndex);
    }
  }
  state.raf = rAF(frame);
}

function onLanded(winIndex) {
  var item = state.items[winIndex];
  var emojis = ['🍜', '🍲', '🍱', '🥘', '🍛', '🍢', '🥟'];
  state.result = {
    name: item.name,
    cuisine: item.cuisine,
    native: item.native || '',
    iconic: item.iconic === true,
    note: item.note || '',
    emoji: emojis[Math.floor(Math.random() * emojis.length)],
    line: dishes.pickFunLine()
  };
  state.spinning = false;
  celebrate();
}

// ---- Confetti (canvas-drawn burst) -----------------------------------------
function celebrate() {
  confetti = [];
  for (var i = 0; i < 60; i++) {
    var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
    var speed = 3 + Math.random() * 5;
    confetti.push({
      x: wheelCX + (Math.random() - 0.5) * 40,
      y: wheelCY,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 2,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 5 + Math.random() * 6,
      rot: Math.random() * TWO_PI,
      vr: (Math.random() - 0.5) * 0.4,
      life: 1
    });
  }
  confettiActive = true;
  animateConfetti();
}

function animateConfetti() {
  var alive = false;
  for (var i = 0; i < confetti.length; i++) {
    var p = confetti[i];
    p.vy += 0.22;       // gravity
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 0.012;
    if (p.life > 0 && p.y < H + 20) alive = true;
  }
  draw();
  if (alive) {
    rAF(animateConfetti);
  } else {
    confettiActive = false;
    draw();
  }
}

function drawConfetti() {
  for (var i = 0; i < confetti.length; i++) {
    var p = confetti[i];
    if (p.life <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---- Touch hit-testing -----------------------------------------------------
function inRect(x, y, r) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
function inCircle(x, y, cx, cy, radius) {
  var dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

wx.onTouchStart(function (e) {
  var t = e.touches && e.touches[0];
  if (!t) return;
  var x = t.clientX;   // CSS px — matches our draw space
  var y = t.clientY;

  if (state.spinning) return; // ignore taps mid-spin

  // 1) Tabs
  for (var i = 0; i < tabRects.length; i++) {
    if (inRect(x, y, tabRects[i])) {
      if (tabRects[i].key !== state.activeCat) loadCategory(tabRects[i].key);
      return;
    }
  }

  // 2) 再转一次 button (only present when a result is shown)
  if (inRect(x, y, againRect)) {
    spin();
    return;
  }

  // 3) Center 转! hub
  if (inCircle(x, y, wheelCX, wheelCY, hubR)) {
    spin();
    return;
  }
});

// ---- Boot ------------------------------------------------------------------
loadCategory('all');
