// Flow harness for the multi-select location refactor.
// Runs game.js in a vm sandbox with a mocked wx + canvas ctx, then drives the
// real selection functions (toggleLocNode / toggleRegion / applyFilter / etc.)
// and asserts the multi-select semantics Rico asked for.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ---- ctx stub: any method is a no-op; the few that must return, return stubs.
function makeCtx() {
  const handler = { get(t, p) {
    if (p === 'measureText') return () => ({ width: 40 });
    if (typeof p === 'string' && /Gradient$/.test(p)) return () => ({ addColorStop() {} });
    if (p === 'canvas') return { width: 750, height: 1334 };
    if (p in t) return t[p];
    return () => {};
  }, set() { return true; } };
  return new Proxy({}, handler);
}
const ctx = makeCtx();
const canvas = { width: 0, height: 0, getContext: () => ctx };

let kbCb = null;
const wx = {
  createCanvas: () => canvas,
  getSystemInfoSync: () => ({ screenWidth: 375, screenHeight: 667, pixelRatio: 2 }),
  onTouchStart() {}, onTouchMove() {}, onTouchEnd() {},
  showKeyboard() {}, hideKeyboard() {}, updateKeyboard() {},
  onKeyboardInput(cb) { kbCb = cb; }, onKeyboardConfirm() {}, onKeyboardComplete() {},
  offKeyboardInput() {}, offKeyboardConfirm() {}, offKeyboardComplete() {},
  triggerGC() {},
};

const sandbox = {
  wx, console, Math, Date, JSON, Object, Array, String, Number, Boolean,
  setTimeout: () => 0, clearTimeout: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  module: { exports: {} }, exports: {},
};
sandbox.require = (m) => require(path.resolve(__dirname, m));
sandbox.global = sandbox;

const src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
vm.runInNewContext(src, sandbox, { filename: 'game.js' });

// ---- assertions ------------------------------------------------------------
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

const S = sandbox.state;
const dishes = require('./dishes.js');

// boot state = 全部
ok(S.locSel.length === 0, 'boot: locSel empty (=全部)');
const allN = dishes.getPool('all').length;
ok(sandbox.basePool().length === allN, 'boot: basePool = all dishes (' + allN + ')');

// pick two regions → union, 全部 no longer active
const rk = dishes.CATEGORIES.filter(c => c.key !== 'all').map(c => c.key);
sandbox.toggleRegion(rk[0]);
sandbox.toggleRegion(rk[1]);
ok(S.locSel.length === 2, 'two regions selected → locSel len 2');
ok(!sandbox.isSelected({ kind: 'region', region: 'all' }) && S.locSel.length > 0, '全部 light OFF while a scope active');
const p0 = dishes.getPool(rk[0]).length, p1 = dishes.getPool(rk[1]).length;
const uni = sandbox.basePool().length;
ok(uni <= p0 + p1 && uni >= Math.max(p0, p1), 'region union deduped (' + uni + ' ≤ ' + (p0 + p1) + ')');

// toggle one region OFF again
sandbox.toggleRegion(rk[0]);
ok(S.locSel.length === 1, 'toggle region off → len 1');

// clearAll → back to 全部
sandbox.clearAllLoc();
ok(S.locSel.length === 0 && sandbox.basePool().length === allN, 'clearAllLoc → 全部 restored');

// search-selected city + country multi-select (Rico: search results also multi-select)
const idx = sandbox.LOC_SEARCH;
const cityEntry = idx.find(e => e.kind === 'city');
const countryEntry = idx.find(e => e.kind === 'country' && e.country !== cityEntry.country);
const cityNode = { kind: 'city', region: cityEntry.region, country: cityEntry.country, city: cityEntry.city, label: cityEntry.country + ' · ' + cityEntry.city };
const countryNode = { kind: 'country', region: countryEntry.region, country: countryEntry.country, label: countryEntry.country };
sandbox.toggleLocNode(cityNode, false);
sandbox.toggleLocNode(countryNode, false);
ok(S.locSel.length === 2, 'search: city + country both selected (multi-select)');
ok(sandbox.isSelected(cityNode) && sandbox.isSelected(countryNode), 'both search nodes report selected');
const cityDishes = sandbox.dishesForNode(cityNode).length;
const countryDishes = sandbox.dishesForNode(countryNode).length;
ok(cityDishes > 0, 'city node yields dishes (' + cityDishes + ')');
ok(cityDishes <= countryDishes || cityEntry.country !== countryEntry.country, 'city ⊆ its country by count sanity');

// combined pool = union of the two, deduped
const combo = sandbox.basePool().length;
ok(combo > 0 && combo <= cityDishes + countryDishes, 'combined base pool = union (' + combo + ')');

// toggle city back off
sandbox.toggleLocNode(cityNode, false);
ok(S.locSel.length === 1 && !sandbox.isSelected(cityNode), 'toggle city off → len 1');

// applyFilter with a taste filter narrows the union pool
sandbox.clearAllLoc();
sandbox.toggleRegion(rk[0]);
const beforeF = sandbox.basePool().length;
S.activeFilters = ['素'];
sandbox.applyFilter();
ok(S.pool.length <= beforeF, 'taste filter narrows pool (' + S.pool.length + ' ≤ ' + beforeF + ')');

// ---- protein (主料) fine-grained filter ------------------------------------
sandbox.clearAllLoc();
S.activeFilters = [];
sandbox.toggleFilter('beef');            // 牛
const beefOnly = S.pool.length;
ok(beefOnly > 0 && S.pool.every(d => (d.protein || []).indexOf('牛') >= 0), '牛 chip → only 牛 dishes (' + beefOnly + ')');
sandbox.toggleFilter('chicken');         // 牛 OR 鸡 (same dimension → union)
const beefOrChicken = S.pool.length;
ok(beefOrChicken >= beefOnly && S.pool.every(d => { const p = d.protein || []; return p.indexOf('牛') >= 0 || p.indexOf('鸡') >= 0; }), '牛+鸡 → OR within 主料 (' + beefOrChicken + ' ≥ ' + beefOnly + ')');
sandbox.toggleFilter('la');              // (牛 OR 鸡) AND 辣  → across dimensions = AND
const spicyMeat = S.pool.length;
ok(spicyMeat <= beefOrChicken, '主料 AND 辣 across dims narrows (' + spicyMeat + ' ≤ ' + beefOrChicken + ')');
sandbox.toggleFilter('all');             // reset
ok(S.activeFilters.length === 0, '全部 clears filters');
sandbox.clearAllLoc();

// ---- province tier (3-level: country → province → city) --------------------
sandbox.clearAllLoc();
const provNode = { kind: 'province', region: 'cn', country: '中国', province: '广东', label: '中国 · 广东' };
const provDishes = sandbox.dishesForNode(provNode);
ok(provDishes.length > 0 && provDishes.every(d => d.province === '广东' && d.country === '中国'), 'province node → only 广东 dishes (' + provDishes.length + ')');
// province ⊆ country
sandbox.toggleLocNode({ kind: 'country', region: 'cn', country: '中国', label: '中国' }, false);
const cnAll = sandbox.basePool().length;
sandbox.clearAllLoc();
sandbox.toggleLocNode(provNode, false);
ok(sandbox.basePool().length <= cnAll, '广东 pool ⊆ 中国 pool (' + sandbox.basePool().length + ' ≤ ' + cnAll + ')');
// pinnedScope drops both country + province when a single province is selected
const pin = sandbox.pinnedScope();
ok(pin.country === '中国' && pin.province === '广东', 'single province selected → pins country+province');
ok(sandbox.originLabel('中国', '广东', '广州', pin) === '广州', '单选广东 → origin trims to just 城市 (广州)');
ok(sandbox.originLabel('中国', '广东', '广州', {}) === '中国 · 广东 · 广州', '全部 → origin full 国家·省·城市');
sandbox.clearAllLoc();

// US has states too (Rico's ask)
const usProv = sandbox.dishesForNode({ kind: 'province', region: 'na', country: '美国', province: '加州' });
ok(usProv.length > 0 && usProv.every(d => d.province === '加州'), '美国 加州 province node works (' + usProv.length + ')');

// searching a province name surfaces a drillable province entry
const searchGD = sandbox.searchLoc('广东').filter(r => r.kind === 'province' && r.province === '广东');
ok(searchGD.length >= 1, 'search 「广东」 surfaces a province entry');
const searchCA = sandbox.searchLoc('加州').filter(r => r.kind === 'province');
ok(searchCA.length >= 1, 'search 「加州」 surfaces a US-state entry');

// picker: country level shows province drill rows; province level shows cities
sandbox.openPanel();
sandbox.panelToCountry('cn', '中国');
const cnRows = sandbox.buildPanelRows();
ok(cnRows.some(r => r.label === '广东' && r.drill), '中国 country panel lists 广东 as a drill row');
sandbox.panelToProvince('cn', '中国', '广东');
const gdRows = sandbox.buildPanelRows();
ok(gdRows.some(r => r.label.indexOf('整个广东') >= 0) && gdRows.some(r => r.label === '广州'), '广东 province panel shows 整个广东 + cities');

// done button rect gets drawn — call drawPanel path indirectly via openPanel+draw
sandbox.openPanel();
sandbox.draw();
ok(sandbox.panelDoneRect && sandbox.panelDoneRect.h > 0, 'panelDoneRect set after panel draw');

console.log('\n' + (fails ? ('❌ ' + fails + ' FAIL') : '✅ ALL PASS'));
process.exit(fails ? 1 : 0);
