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
var tabH = 34;

// Wheel geometry: centered, sized to fit width and leave room for result.
var wheelDiameter = Math.min(W - PAD * 2, H * 0.46);
var wheelR = wheelDiameter / 2;
var wheelCX = W / 2;
var wheelCY = tabsY + tabH + 24 + wheelR;
var hubR = Math.max(38, wheelR * 0.24);   // center spin button radius
var pointerH = Math.max(22, wheelR * 0.13);

// ---- Runtime state ---------------------------------------------------------
var state = {
  activeCat: 'all',
  items: [],
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
  state.items = dishes.getWheelItems(key);
  state.activeCat = key;
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
  var cats = dishes.CATEGORIES;
  tabRects = [];
  ctx.font = '600 14px ' + FONT;
  var gap = 8;
  var padX = 14;
  // Measure widths.
  var widths = [];
  var total = 0;
  for (var i = 0; i < cats.length; i++) {
    var w = ctx.measureText(cats[i].label).width + padX * 2;
    widths.push(w);
    total += w;
  }
  total += gap * (cats.length - 1);
  var x = (W - total) / 2;
  if (x < PAD) x = PAD; // if it overflows, left-align with padding
  for (var j = 0; j < cats.length; j++) {
    var cw = widths[j];
    var active = cats[j].key === state.activeCat;
    roundRect(x, tabsY, cw, tabH, tabH / 2);
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
    ctx.font = (active ? '700 ' : '600 ') + '14px ' + FONT;
    ctx.fillText(cats[j].label, x + cw / 2, tabsY + tabH / 2 + 0.5);
    tabRects.push({ key: cats[j].key, x: x, y: tabsY, w: cw, h: tabH });
    x += cw + gap;
  }
}

// Reused wheel-draw from index.js (translate/rotate + wedges + labels + rim).
function drawWheel() {
  var items = state.items;
  var n = items.length;
  if (n === 0) return;
  var radius = wheelR;
  var seg = TWO_PI / n;

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
    ctx.lineWidth = 2;
    ctx.stroke();

    // label
    ctx.save();
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL_BG;
    var fontSize = n > 10 ? 12 : (n > 7 ? 14 : 16);
    ctx.font = '600 ' + fontSize + 'px ' + FONT;
    var label = items[i].name;
    if (label.length > 7) label = label.slice(0, 6) + '…';
    ctx.fillText(label, radius - 14, 0);
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
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.fillStyle = COL_MUTED;
  ctx.font = '400 13px ' + FONT;
  ctx.fillText('今晚就吃', W / 2, topY);

  ctx.fillStyle = COL_MARIGOLD;
  ctx.font = '800 34px ' + FONT;
  ctx.fillText(r.emoji + ' ' + r.name, W / 2, topY + 22);

  ctx.fillStyle = COL_CHILI;
  ctx.font = '500 14px ' + FONT;
  ctx.fillText(r.cuisine, W / 2, topY + 66);

  ctx.fillStyle = COL_CREAM;
  ctx.font = '500 16px ' + FONT;
  ctx.fillText(r.line, W / 2, topY + 90);

  // 再转一次 button
  var label = '再转一次';
  ctx.font = '700 16px ' + FONT;
  var bw = ctx.measureText(label).width + 56;
  var bh = 44;
  var bx = (W - bw) / 2;
  var by = topY + 122;
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
