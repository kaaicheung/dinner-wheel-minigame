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

// ---- Filters (second selection axis: taste / type, on top of region) -------
// Each filter narrows the current region pool via a predicate over the tag
// fields (type / flavor / spice / diet). 'all' passes everything.
var FILTERS = [
  { key: 'all',     label: '全部' },
  { key: 'la',      label: '辣' },
  { key: 'light',   label: '清淡' },
  { key: 'veg',     label: '素' },
  { key: 'noodle',  label: '面' },
  { key: 'rice',    label: '米饭' },
  { key: 'hotpot',  label: '火锅' },
  { key: 'soup',    label: '汤' },
  { key: 'bbq',     label: '烧烤' },
  { key: 'sweet',   label: '甜点' },
  { key: 'seafood', label: '海鲜' },
  // 主料 (protein) — fine-grained meats + seafood, per Rico ("海鲜太笼统").
  { key: 'chicken', label: '鸡' },
  { key: 'duck',    label: '鸭' },
  { key: 'goose',   label: '鹅' },
  { key: 'pork',    label: '猪' },
  { key: 'beef',    label: '牛' },
  { key: 'lamb',    label: '羊' },
  { key: 'fish',    label: '鱼' },
  { key: 'shrimp',  label: '虾' },
  { key: 'crab',    label: '蟹' }
];
var PROTEIN_OF = {
  chicken: '鸡', duck: '鸭', goose: '鹅', pork: '猪',
  beef: '牛', lamb: '羊', fish: '鱼', shrimp: '虾', crab: '蟹'
};
function hasTag(arr, v) { return arr && arr.indexOf(v) >= 0; }
function matchFilter(d, key) {
  switch (key) {
    case 'all':     return true;
    case 'la':      return (d.spice || 0) >= 2 || hasTag(d.flavor, '辣') || hasTag(d.flavor, '麻');
    case 'light':   return hasTag(d.flavor, '清淡') || ((d.spice || 0) === 0 && d.type === '汤');
    case 'veg':     return d.diet === '素' || d.diet === '纯素';
    case 'noodle':  return d.type === '面';
    case 'rice':    return d.type === '米饭';
    case 'hotpot':  return d.type === '火锅';
    case 'soup':    return d.type === '汤';
    case 'bbq':     return d.type === '烧烤';
    case 'sweet':   return d.type === '甜点';
    case 'seafood': return d.diet === '海鲜' || d.type === '海鲜';
    default:        return PROTEIN_OF[key] ? hasTag(d.protein, PROTEIN_OF[key]) : true;
  }
}
// Which dimension each filter belongs to. Multi-select semantics: OR within a
// dimension, AND across dimensions — so 辣+素 = spicy AND vegetarian, but
// 面+米饭 = 面 OR 米饭 (a dish can't be two types at once).
var FILTER_DIM = {
  la: 'flavor', light: 'flavor',
  veg: 'diet', seafood: 'diet',
  noodle: 'type', rice: 'type', hotpot: 'type', soup: 'type', bbq: 'type', sweet: 'type',
  chicken: 'protein', duck: 'protein', goose: 'protein', pork: 'protein', beef: 'protein',
  lamb: 'protein', fish: 'protein', shrimp: 'protein', crab: 'protein'
};
function matchFilters(d, keys) {
  if (!keys || keys.length === 0) return true;
  var byDim = {};
  for (var i = 0; i < keys.length; i++) {
    var dim = FILTER_DIM[keys[i]] || keys[i];
    (byDim[dim] = byDim[dim] || []).push(keys[i]);
  }
  for (var dim in byDim) {
    var ks = byDim[dim], ok = false;
    for (var j = 0; j < ks.length; j++) {
      if (matchFilter(d, ks[j])) { ok = true; break; }
    }
    if (!ok) return false;   // AND across dimensions
  }
  return true;
}

// ---- Layout (all CSS px) ---------------------------------------------------
// Scale reference: design around a 375-wide viewport, clamp for larger screens.
var PAD = 20;
var titleY = Math.max(48, H * 0.09);
var tabsY = titleY + 42;
var tabH = 30;
var tabRowGap = 7;

// Generic chip-row packer: greedily wrap items into centered rows starting at
// startY, each row tabH tall. Returns rects (with x/y/w/h/key/label) + rowCount.
function packChips(items, startY, font) {
  ctx.font = font;
  var gap = 6, padX = 12;
  var maxRowW = W - PAD * 2;
  var rows = [[]], rowW = 0;
  for (var i = 0; i < items.length; i++) {
    var w = ctx.measureText(items[i].label).width + padX * 2;
    var add = (rows[rows.length - 1].length ? gap : 0) + w;
    if (rowW + add > maxRowW && rows[rows.length - 1].length) {
      rows.push([]); rowW = 0; add = w;
    }
    rows[rows.length - 1].push({ key: items[i].key, label: items[i].label, w: w });
    rowW += add;
  }
  var rects = [];
  for (var r = 0; r < rows.length; r++) {
    var total = 0;
    for (var j = 0; j < rows[r].length; j++) total += rows[r][j].w;
    total += gap * (rows[r].length - 1);
    var x = (W - total) / 2;
    if (x < PAD) x = PAD;
    var y = startY + r * (tabH + tabRowGap);
    for (var k = 0; k < rows[r].length; k++) {
      var t = rows[r][k];
      rects.push({ key: t.key, label: t.label, x: x, y: y, w: t.w, h: tabH });
      x += t.w + gap;
    }
  }
  return { rects: rects, rowCount: rows.length };
}
var TAB_FONT = '600 13px ' + '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
var FILTER_FONT = '500 12px ' + '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

var tabLayout = packChips(dishes.CATEGORIES, tabsY, TAB_FONT);
var tabsBlockH = tabLayout.rowCount * tabH + (tabLayout.rowCount - 1) * tabRowGap;

var filtersY = tabsY + tabsBlockH + 10;
var filterLayout = packChips(FILTERS, filtersY, FILTER_FONT);
var filtersBlockH = filterLayout.rowCount * tabH + (filterLayout.rowCount - 1) * tabRowGap;

// Wheel geometry: centered, sized to fit width and leave room for result.
var wheelDiameter = Math.min(W - PAD * 2, H * 0.36);
var wheelR = wheelDiameter / 2;
var wheelCX = W / 2;
var wheelCY = filtersY + filtersBlockH + 20 + wheelR;
var hubR = Math.max(38, wheelR * 0.24);   // center spin button radius
var pointerH = Math.max(22, wheelR * 0.13);

// ---- Runtime state ---------------------------------------------------------
var state = {
  locSel: [],              // selected location nodes (multi-select; [] = 全部)
                           //   node = { kind:'region'|'country'|'city', region, country, city, label }
  activeFilters: [],       // selected taste/type chips (multi-select; [] = 全部)
  pool: [],                // base pool (union of locSel) after the active taste/type filters
  items: [],               // the ~40 sampled onto the wheel this spin
  rotation: 0,             // radians
  spinning: false,
  result: null,      // { name, cuisine, emoji, line }
  raf: null,
  // location picker panel
  panel: null,             // null (closed) or { level:'root'|'region'|'country', region, country }
  searchText: '',
  searchResults: [],
  panelScroll: 0           // list scroll offset within the panel
};

// Cached hit regions, recomputed on each draw.
var tabRects = [];         // [{ key, x, y, w, h }]
var filterRects = [];      // [{ key, x, y, w, h }] taste/type filter chips
var againRect = null;      // { x, y, w, h } when a result is shown
var locBarRect = null;     // location bar (opens the picker)
var locClearRect = null;   // ✕ on the location bar (when a scope is active)
var panelSearchRect = null, panelCloseRect = null, panelBackRect = null, panelDoneRect = null;
var panelRows = [];        // [{ x, y, w, h, action }] visible list rows in the panel

// Confetti particles.
var confetti = [];         // [{ x, y, vx, vy, color, size, rot, vr, life }]
var confettiActive = false;

// ---- Location selection (one multi-select SET) + taste filters -------------
// Region tabs AND the picker panel both add/remove location nodes to state.locSel.
// [] = 全部 (all). Nodes combine as UNION (中国 + 熊本 + 福冈 → all their dishes).
function nodeKey(n) { return n.kind + '|' + (n.region || '') + '|' + (n.country || '') + '|' + (n.city || ''); }
function isSelected(n) {
  var k = nodeKey(n);
  for (var i = 0; i < state.locSel.length; i++) if (nodeKey(state.locSel[i]) === k) return true;
  return false;
}
// Toggle a node in/out of the selection. rebuild=true recomputes the wheel now
// (region-tab taps); false just redraws the panel (picker taps apply on close).
function toggleLocNode(n, rebuild) {
  var k = nodeKey(n), out = [], found = false;
  for (var i = 0; i < state.locSel.length; i++) {
    if (nodeKey(state.locSel[i]) === k) found = true; else out.push(state.locSel[i]);
  }
  if (!found) out.push(n);
  state.locSel = out;
  if (rebuild) applyFilter(); else draw();
}
function toggleRegion(key) {
  if (key === 'all') { state.locSel = []; applyFilter(); }
  else toggleLocNode({ kind: 'region', region: key, label: regionLabelOf(key) }, true);
}
function clearAllLoc() { state.locSel = []; applyFilter(); }

// Filter tap: 全部 clears all filters; a specific chip toggles in/out.
function toggleFilter(key) {
  if (key === 'all') {
    state.activeFilters = [];
  } else {
    var arr = state.activeFilters.slice();
    var i = arr.indexOf(key);
    if (i >= 0) arr.splice(i, 1); else arr.push(key);
    state.activeFilters = arr;
  }
  applyFilter();
}

// Dishes for a single location node (region / country / city).
function dishesForNode(n) {
  var pool = dishes.getPool(n.region);
  if (n.city) return pool.filter(function (d) { return d.city === n.city && d.country === n.country; });
  if (n.country) return pool.filter(function (d) { return d.country === n.country; });
  return pool;
}
// Base pool = union of all selected nodes (deduped by name), or every dish if none.
function basePool() {
  if (!state.locSel.length) return dishes.getPool('all');
  var seen = {}, out = [];
  for (var i = 0; i < state.locSel.length; i++) {
    var ds = dishesForNode(state.locSel[i]);
    for (var j = 0; j < ds.length; j++) {
      if (!seen[ds[j].name]) { seen[ds[j].name] = 1; out.push(ds[j]); }
    }
  }
  return out;
}
// Wheel pool = base pool narrowed by the active taste/type filters.
function applyFilter() {
  var base = basePool();
  state.pool = (state.activeFilters.length === 0)
    ? base.slice()
    : base.filter(function (d) { return matchFilters(d, state.activeFilters); });
  state.items = dishes.sampleWheel(state.pool);
  state.rotation = 0;
  state.result = null;
  confetti = [];
  confettiActive = false;
  draw();
}

// ---- Location picker: search index + drill navigation ----------------------
var REGION_LABEL = {};
dishes.CATEGORIES.forEach(function (c) { REGION_LABEL[c.key] = c.label; });
function regionLabelOf(rk) { return REGION_LABEL[rk] || rk; }

// Flat searchable index of every country + city across all regions.
var LOC_SEARCH = [];
(function buildSearchIndex() {
  var L = dishes.LOCATIONS || {};
  for (var rk in L) {
    for (var country in L[rk]) {
      LOC_SEARCH.push({ label: country, kind: 'country', region: rk, country: country });
      var cities = L[rk][country];
      for (var i = 0; i < cities.length; i++) {
        LOC_SEARCH.push({ label: cities[i], kind: 'city', region: rk, country: country, city: cities[i] });
      }
    }
  }
})();
function searchLoc(q) {
  if (!q) return [];
  var out = [];
  for (var i = 0; i < LOC_SEARCH.length && out.length < 60; i++) {
    if (LOC_SEARCH[i].label.indexOf(q) >= 0) out.push(LOC_SEARCH[i]);
  }
  return out;
}
function scopeFromEntry(r) {
  return r.kind === 'city'
    ? { region: r.region, country: r.country, city: r.city, label: r.country + ' · ' + r.city }
    : { region: r.region, country: r.country, label: r.country };
}

function openPanel() {
  state.panel = { level: 'root' };
  state.searchText = ''; state.searchResults = []; state.panelScroll = 0;
  draw();
}
function closePanel() {
  state.panel = null;
  if (typeof wx.hideKeyboard === 'function') { try { wx.hideKeyboard({}); } catch (e) {} }
  applyFilter();   // apply the multi-select made in the panel
}
function panelToRegion(rk) { state.panel = { level: 'region', region: rk }; state.panelScroll = 0; draw(); }
function panelToCountry(rk, co) { state.panel = { level: 'country', region: rk, country: co }; state.panelScroll = 0; draw(); }
function panelBack() {
  if (!state.panel) return;
  if (state.panel.level === 'country') state.panel = { level: 'region', region: state.panel.region };
  else if (state.panel.level === 'region') state.panel = { level: 'root' };
  state.panelScroll = 0; draw();
}

// A selectable (toggle) row for a location node — carries `sel` (checkmark) and
// toggles the node in/out of the multi-select set (applies on panel close).
function selRow(node, label, sub) {
  return { label: label, sub: sub, drill: false, sel: isSelected(node),
    action: (function (n) { return function () { toggleLocNode(n, false); }; })(node) };
}
// Build the list rows for the current panel level (or search results).
function buildPanelRows() {
  var rows = [];
  var L = dishes.LOCATIONS || {};
  if (state.searchText) {
    var res = state.searchResults;
    for (var i = 0; i < res.length; i++) {
      var r = res[i];
      var node = (r.kind === 'city')
        ? { kind: 'city', region: r.region, country: r.country, city: r.city, label: r.country + ' · ' + r.city }
        : { kind: 'country', region: r.region, country: r.country, label: r.country };
      rows.push(selRow(node, r.label, r.kind === 'city' ? r.country + ' · 城市' : regionLabelOf(r.region) + ' · 国家/地区'));
    }
    if (!res.length) rows.push({ label: '没找到「' + state.searchText + '」', sub: '换个词试试', drill: false, action: null });
    return rows;
  }
  if (state.panel.level === 'root') {
    dishes.CATEGORIES.forEach(function (c) {
      if (c.key === 'all') return;
      var nc = Object.keys(L[c.key] || {}).length;
      rows.push({ label: c.label, sub: nc + ' 个国家/地区 ›', drill: true,
        action: (function (k) { return function () { panelToRegion(k); }; })(c.key) });
    });
    return rows;
  }
  if (state.panel.level === 'region') {
    var rk = state.panel.region, cs = Object.keys(L[rk] || {});
    rows.push(selRow({ kind: 'region', region: rk, label: regionLabelOf(rk) }, '🎯 整个' + regionLabelOf(rk), '不限国家'));
    cs.forEach(function (country) {
      var cities = L[rk][country] || [];
      if (cities.length) {
        rows.push({ label: country, sub: cities.length + ' 城 ›', drill: true,
          action: (function (k, co) { return function () { panelToCountry(k, co); }; })(rk, country) });
      } else {
        rows.push(selRow({ kind: 'country', region: rk, country: country, label: country }, country, ''));
      }
    });
    return rows;
  }
  if (state.panel.level === 'country') {
    var rk2 = state.panel.region, co2 = state.panel.country, cities2 = (L[rk2] && L[rk2][co2]) || [];
    rows.push(selRow({ kind: 'country', region: rk2, country: co2, label: co2 }, '🎯 整个' + co2, '不限城市'));
    cities2.forEach(function (city) {
      rows.push(selRow({ kind: 'city', region: rk2, country: co2, city: city, label: co2 + ' · ' + city }, city, co2));
    });
    return rows;
  }
  return rows;
}

// wx keyboard for the search box (registered once; updates on input).
var _kbBound = false;
function openKeyboard() {
  if (typeof wx.showKeyboard !== 'function') return;
  if (!_kbBound) {
    _kbBound = true;
    wx.onKeyboardInput(function (res) {
      if (!state.panel) return;
      state.searchText = (res && res.value) || '';
      state.searchResults = searchLoc(state.searchText.trim());
      state.panelScroll = 0;
      draw();
    });
    if (typeof wx.onKeyboardConfirm === 'function') {
      wx.onKeyboardConfirm(function () { if (typeof wx.hideKeyboard === 'function') { try { wx.hideKeyboard({}); } catch (e) {} } });
    }
  }
  try {
    wx.showKeyboard({ defaultValue: state.searchText, maxLength: 20, multiple: false, confirmType: 'search' });
  } catch (e) {}
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

  if (state.panel) { drawPanel(); return; }

  drawTitle();
  drawLocBar();
  drawTabs();
  drawFilters();
  if (state.items.length === 0) {
    drawEmptyHint();
    return;
  }
  drawWheel();
  drawPointer();
  drawHub();
  drawResult();
  if (confettiActive) drawConfetti();
}

function drawEmptyHint() {
  // Name the active filter chips so the user knows which constraint emptied it.
  var labels = [];
  for (var i = 0; i < FILTERS.length; i++) {
    if (state.activeFilters.indexOf(FILTERS[i].key) >= 0) labels.push(FILTERS[i].label);
  }
  var what = labels.length ? '「' + labels.join('+') + '」' : '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COL_MUTED;
  ctx.font = '400 15px ' + FONT;
  ctx.fillText('这个组合下' + what + '暂时没有菜', W / 2, wheelCY - 8);
  ctx.fillStyle = 'rgba(250,243,230,0.42)';
  ctx.font = '400 13px ' + FONT;
  ctx.fillText('少选一个条件试试 🍽️', W / 2, wheelCY + 18);
}

function drawTitle() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COL_MARIGOLD;
  ctx.font = '800 26px ' + FONT;
  ctx.fillText('今晚吃啥 🎡', W / 2, titleY);
}

// Tappable location bar (sits where the subtitle was). Shows the active place, or
// prompts to pick one. Opens the location picker; the ✕ clears the scope.
function drawLocBar() {
  var by = titleY + 23, h = 26, padX = 14;
  var has = state.locSel.length > 0;
  var txt;
  if (!has) {
    txt = '📍 选地点：城市 / 国家（可多选）';
  } else {
    var labels = [];
    for (var i = 0; i < state.locSel.length; i++) labels.push(state.locSel[i].label);
    txt = (labels.length <= 2)
      ? '📍 ' + labels.join(' · ')
      : '📍 ' + labels.slice(0, 2).join(' · ') + ' +' + (labels.length - 2);
  }
  ctx.font = '600 13px ' + FONT;
  var tw = ctx.measureText(txt).width;
  var clearW = has ? 24 : 0;
  var w = Math.min(tw + padX * 2 + clearW, W - PAD * 2);
  var x = (W - w) / 2;
  roundRect(x, by - h / 2, w, h, h / 2);
  ctx.fillStyle = has ? 'rgba(255,210,63,0.16)' : 'rgba(255,255,255,0.07)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = has ? 'rgba(255,210,63,0.42)' : 'rgba(255,255,255,0.12)';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = has ? COL_MARIGOLD : 'rgba(250,243,230,0.82)';
  ctx.fillText(txt, x + padX, by + 0.5);
  locBarRect = { x: x, y: by - h / 2, w: w, h: h };
  if (has) {
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_CHILI;
    ctx.font = '700 15px ' + FONT;
    ctx.fillText('✕', x + w - clearW / 2 - 4, by + 0.5);
    locClearRect = { x: x + w - clearW - 6, y: by - h / 2, w: clearW + 10, h: h };
  } else {
    locClearRect = null;
  }
}

// Full-screen location picker: search box + region → country → city drill.
function drawPanel() {
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, W, H);
  var hy = Math.max(40, H * 0.06) + 6;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COL_MARIGOLD;
  ctx.font = '800 20px ' + FONT;
  ctx.fillText('选地点', PAD, hy);
  ctx.textAlign = 'right';
  ctx.fillStyle = COL_CREAM;
  ctx.font = '600 16px ' + FONT;
  ctx.fillText('✕ 关闭', W - PAD, hy);
  panelCloseRect = { x: W - PAD - 76, y: hy - 20, w: 76 + PAD, h: 40 };

  var sy = hy + 22, sh = 40;
  roundRect(PAD, sy, W - PAD * 2, sh, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '400 15px ' + FONT;
  if (state.searchText) {
    ctx.fillStyle = COL_CREAM;
    ctx.fillText('🔍 ' + state.searchText, PAD + 12, sy + sh / 2);
  } else {
    ctx.fillStyle = COL_MUTED;
    ctx.fillText('🔍 搜城市 / 国家（大阪 · 成都 · 里斯本）', PAD + 12, sy + sh / 2);
  }
  panelSearchRect = { x: PAD, y: sy, w: W - PAD * 2, h: sh };

  var listTop = sy + sh + 10;
  panelBackRect = null;
  if (!state.searchText && state.panel.level !== 'root') {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL_CHILI;
    ctx.font = '600 14px ' + FONT;
    ctx.fillText('‹ 返回', PAD, listTop + 14);
    panelBackRect = { x: PAD - 6, y: listTop, w: 130, h: 32 };
    ctx.textAlign = 'right';
    ctx.fillStyle = COL_MUTED;
    ctx.font = '400 12px ' + FONT;
    var bc = state.panel.level === 'region'
      ? regionLabelOf(state.panel.region)
      : regionLabelOf(state.panel.region) + ' › ' + state.panel.country;
    ctx.fillText(bc, W - PAD, listTop + 14);
    listTop += 34;
  }
  var listBottom = H - 60;   // reserve the bottom strip for the 完成 button

  var rows = buildPanelRows();
  var rowH = 46;
  var maxScroll = Math.max(0, rows.length * rowH - (listBottom - listTop));
  if (state.panelScroll > maxScroll) state.panelScroll = maxScroll;
  if (state.panelScroll < 0) state.panelScroll = 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, listTop, W, listBottom - listTop);
  ctx.clip();
  panelRows = [];
  for (var i = 0; i < rows.length; i++) {
    var ry = listTop + i * rowH - state.panelScroll;
    if (ry + rowH < listTop || ry > listBottom) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, ry + rowH);
    ctx.lineTo(W - PAD, ry + rowH);
    ctx.stroke();
    var selectable = (rows[i].sel !== undefined);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = (selectable && rows[i].sel) ? COL_MARIGOLD : COL_CREAM;
    ctx.font = '500 16px ' + FONT;
    ctx.fillText(rows[i].label, PAD + 2, ry + rowH / 2 - (rows[i].sub ? 8 : 0));
    if (rows[i].sub) {
      ctx.fillStyle = COL_MUTED;
      ctx.font = '400 12px ' + FONT;
      ctx.fillText(rows[i].sub, PAD + 2, ry + rowH / 2 + 11);
    }
    ctx.textAlign = 'right';
    if (rows[i].drill) {
      ctx.fillStyle = COL_MUTED;
      ctx.font = '500 18px ' + FONT;
      ctx.fillText('›', W - PAD, ry + rowH / 2);
    } else if (selectable) {
      ctx.fillStyle = rows[i].sel ? COL_MARIGOLD : 'rgba(250,243,230,0.3)';
      ctx.font = '600 17px ' + FONT;
      ctx.fillText(rows[i].sel ? '✓' : '○', W - PAD, ry + rowH / 2);
    }
    if (rows[i].action) panelRows.push({ x: 0, y: ry, w: W, h: rowH, action: rows[i].action });
  }
  ctx.restore();
  if (maxScroll > 0) {
    ctx.fillStyle = 'rgba(250,243,230,0.3)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '400 11px ' + FONT;
    ctx.fillText('↕ 上下滑动', W / 2, listBottom - 7);
  }
  // 完成 button — applies the multi-select and closes the panel.
  var bh = 42, by = H - bh - 10, bw = W - PAD * 2, bx = PAD;
  roundRect(bx, by, bw, bh, 10);
  ctx.fillStyle = COL_MARIGOLD;
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COL_BG;
  ctx.font = '700 16px ' + FONT;
  ctx.fillText(state.locSel.length ? ('完成 · 选了 ' + state.locSel.length + ' 个地点') : '完成（全部）', W / 2, by + bh / 2 + 0.5);
  panelDoneRect = { x: bx, y: by, w: bw, h: bh };
}

function drawTabs() {
  // tabLayout is precomputed once at boot; just render + expose hit rects.
  tabRects = tabLayout.rects;
  for (var j = 0; j < tabRects.length; j++) {
    var t = tabRects[j];
    var active = (t.key === 'all') ? (state.locSel.length === 0) : isSelected({ kind: 'region', region: t.key });
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

// Taste/type filter chips — chili accent when active, to read as a distinct
// axis from the marigold region tabs above.
function drawFilters() {
  filterRects = filterLayout.rects;
  for (var j = 0; j < filterRects.length; j++) {
    var t = filterRects[j];
    var active = (t.key === 'all')
      ? state.activeFilters.length === 0
      : state.activeFilters.indexOf(t.key) >= 0;
    roundRect(t.x, t.y, t.w, t.h, t.h / 2);
    if (active) {
      ctx.fillStyle = COL_CHILI;
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = active ? '#fff' : 'rgba(250,243,230,0.6)';
    ctx.font = (active ? '700 ' : '500 ') + '12px ' + FONT;
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

// Always-clear place label: a city carries its country ("俄罗斯 · 喀山"), a
// country-only dish shows just the country. Falls back to the raw cuisine.
function originLabel(country, city, cuisine) {
  if (country && city && city !== country) return country + ' · ' + city;
  if (country) return country;
  return cuisine || '';
}

function drawResult() {
  againRect = null;
  var maxW = W - PAD * 2;
  var bh = 44;
  var by = H - bh - 16;                    // 再转 button anchored near the bottom
  var topY = wheelCY + wheelR + 14;

  ctx.textAlign = 'center';
  if (!state.result) {
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL_MUTED;
    ctx.font = '400 15px ' + FONT;
    ctx.fillText('点中间「转!」开始', W / 2, (topY + by) / 2);
    return;
  }
  var r = state.result;
  ctx.textBaseline = 'top';
  var y = topY;

  // Eyebrow — "今晚就吃", plus a ⭐必吃 tag when the dish is a regional icon.
  ctx.font = '600 13px ' + FONT;
  ctx.fillStyle = r.iconic ? COL_MARIGOLD : COL_MUTED;
  ctx.fillText(r.iconic ? '⭐ 今晚就吃 · 当地必吃' : '今晚就吃', W / 2, y);
  y += 19;

  // Dish name — shrink font if it would overflow the width.
  var nameStr = r.emoji + ' ' + r.name;
  var nameSize = 32;
  ctx.font = '800 ' + nameSize + 'px ' + FONT;
  while (nameSize > 20 && ctx.measureText(nameStr).width > maxW) {
    nameSize -= 3;
    ctx.font = '800 ' + nameSize + 'px ' + FONT;
  }
  ctx.fillStyle = COL_MARIGOLD;
  ctx.fillText(nameStr, W / 2, y);
  y += nameSize + 6;

  // Subtitle — native name (if any) · place. Origin ALWAYS names the country so a
  // bare city (喀山 / 巴里) is never ambiguous: "国家 · 城市", or just the country.
  var origin = originLabel(r.country, r.city, r.cuisine);
  var sub = r.native ? (r.native + ' · ' + origin) : origin;
  ctx.font = '500 14px ' + FONT;
  ctx.fillStyle = COL_CHILI;
  ctx.fillText(sub, W / 2, y);
  y += 21;

  // Note (简介) — fit as many lines as the space above the button allows (0–2),
  // reserving room for the fun one-liner when there's space. Keeps everything on
  // screen from iPhone SE up to the tall phones.
  var remain = by - y - 6;
  if (r.note && remain >= 18) {
    var allow = Math.min(2, Math.floor((remain - 22) / 18));
    if (allow < 1) allow = 1;
    ctx.font = '400 13px ' + FONT;
    ctx.fillStyle = 'rgba(250,243,230,0.78)';
    var noteLines = wrapLines(r.note, maxW, allow);
    for (var i = 0; i < noteLines.length; i++) {
      ctx.fillText(noteLines[i], W / 2, y);
      y += 18;
    }
    y += 3;
  }

  // Fun one-liner — only if there's still vertical room before the button.
  if (by - y >= 20) {
    ctx.font = '500 14px ' + FONT;
    ctx.fillStyle = COL_CREAM;
    ctx.fillText(r.line, W / 2, y);
  }

  // 再转一次 button (anchored at by).
  var label = '再转一次';
  ctx.font = '700 16px ' + FONT;
  var bw = ctx.measureText(label).width + 56;
  var bx = (W - bw) / 2;
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
    country: item.country || '',
    city: item.city || '',
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

function pointFromEvent(e) {
  var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  return t ? { x: t.clientX, y: t.clientY } : null;
}

// Main-screen tap (panel closed): location bar, region tabs, filters, hub.
function handleMainTap(x, y) {
  if (inRect(x, y, locClearRect)) { clearAllLoc(); return; }
  if (inRect(x, y, locBarRect)) { openPanel(); return; }
  for (var i = 0; i < tabRects.length; i++) {
    if (inRect(x, y, tabRects[i])) { toggleRegion(tabRects[i].key); return; }
  }
  for (var f = 0; f < filterRects.length; f++) {
    if (inRect(x, y, filterRects[f])) { toggleFilter(filterRects[f].key); return; }
  }
  if (inRect(x, y, againRect)) { spin(); return; }
  if (inCircle(x, y, wheelCX, wheelCY, hubR)) { spin(); return; }
}

// Panel tap (resolved on touch-end when it wasn't a scroll drag).
function handlePanelTap(x, y) {
  if (inRect(x, y, panelDoneRect)) { closePanel(); return; }
  if (inRect(x, y, panelCloseRect)) { closePanel(); return; }
  if (inRect(x, y, panelSearchRect)) { openKeyboard(); return; }
  if (inRect(x, y, panelBackRect)) { panelBack(); return; }
  for (var i = 0; i < panelRows.length; i++) {
    if (inRect(x, y, panelRows[i]) && panelRows[i].action) { panelRows[i].action(); return; }
  }
}

var _t = { startY: 0, scroll0: 0, moved: false, panelAtStart: false };

wx.onTouchStart(function (e) {
  var p = pointFromEvent(e);
  if (!p) return;
  if (state.spinning) return;
  _t.startY = p.y; _t.scroll0 = state.panelScroll; _t.moved = false; _t.panelAtStart = !!state.panel;
  if (!state.panel) handleMainTap(p.x, p.y);   // main taps act immediately; panel taps on touch-end
});

if (typeof wx.onTouchMove === 'function') {
  wx.onTouchMove(function (e) {
    if (!_t.panelAtStart || !state.panel) return;
    var p = pointFromEvent(e);
    if (!p) return;
    var dy = p.y - _t.startY;
    if (Math.abs(dy) > 6) _t.moved = true;
    state.panelScroll = _t.scroll0 - dy;
    draw();
  });
}

if (typeof wx.onTouchEnd === 'function') {
  wx.onTouchEnd(function (e) {
    if (!_t.panelAtStart || !state.panel) return;
    if (_t.moved) return;   // it was a scroll, not a tap
    var p = pointFromEvent(e);
    if (p) handlePanelTap(p.x, p.y);
  });
}

// ---- Boot ------------------------------------------------------------------
applyFilter();
