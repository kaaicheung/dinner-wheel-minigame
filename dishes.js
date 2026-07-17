// Shared dish data for the dinner wheel — ported verbatim from the
// mini-program (dinner-wheel-miniprogram/data/dishes.js). Mini games support
// CommonJS require(), so the structure is unchanged.
//
// Structure: category -> list of dishes (leaves). Cuisine is kept as a tag on
// each dish so we can show a fun subtitle line, but the wheel segments are the
// dishes themselves.

var CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'cn', label: '中餐' },
  { key: 'west', label: '西餐' },
  { key: 'sea', label: '东南亚' },
  { key: 'jk', label: '日韩' }
];

// Each dish: { name, cuisine (fun subtitle) }
var DISHES = {
  cn: [
    { name: '水煮鱼', cuisine: '川菜' },
    { name: '麻辣香锅', cuisine: '川菜' },
    { name: '回锅肉', cuisine: '川菜' },
    { name: '口水鸡', cuisine: '川菜' },
    { name: '烧腊', cuisine: '粤菜' },
    { name: '老火靓汤', cuisine: '粤菜' },
    { name: '清蒸海鲜', cuisine: '粤菜' },
    { name: '点心', cuisine: '粤菜' },
    { name: '剁椒鱼头', cuisine: '湘菜' },
    { name: '辣椒炒肉', cuisine: '湘菜' },
    { name: '狮子头', cuisine: '淮扬菜' },
    { name: '大煮干丝', cuisine: '淮扬菜' },
    { name: '东坡肉', cuisine: '浙菜本帮' },
    { name: '红烧肉', cuisine: '浙菜本帮' },
    { name: '锅包肉', cuisine: '东北菜' },
    { name: '铁锅炖', cuisine: '东北菜' },
    { name: '烤鸭', cuisine: '京菜' },
    { name: '炸酱面', cuisine: '京菜' },
    { name: '兰州拉面', cuisine: '西北菜' },
    { name: '大盘鸡', cuisine: '西北菜' },
    { name: '羊肉串', cuisine: '西北菜' },
    { name: '过桥米线', cuisine: '云南菜' },
    { name: '菌子', cuisine: '云南菜' },
    { name: '潮汕牛肉火锅', cuisine: '潮汕' },
    { name: '卤鹅', cuisine: '潮汕' },
    { name: '麻辣火锅', cuisine: '火锅' },
    { name: '椰子鸡', cuisine: '火锅' },
    { name: '猪肚鸡', cuisine: '火锅' }
  ],
  west: [
    { name: 'Pasta 意面', cuisine: '意大利' },
    { name: 'Pizza 披萨', cuisine: '意大利' },
    { name: 'Risotto 烩饭', cuisine: '意大利' },
    { name: '法式牛排', cuisine: '法餐' },
    { name: '鹅肝', cuisine: '法餐' },
    { name: 'Tapas', cuisine: '西班牙' },
    { name: 'Paella 海鲜饭', cuisine: '西班牙' },
    { name: '汉堡', cuisine: '美式' },
    { name: 'BBQ 烧烤', cuisine: '美式' },
    { name: '德国猪肘', cuisine: '德国' },
    { name: '德式香肠', cuisine: '德国' },
    { name: 'Gyros', cuisine: '希腊' },
    { name: '巴西烤肉', cuisine: '巴西' },
    { name: 'Taco', cuisine: '墨西哥' },
    { name: 'Burrito', cuisine: '墨西哥' }
  ],
  sea: [
    { name: '冬阴功', cuisine: '泰国' },
    { name: '绿咖喱', cuisine: '泰国' },
    { name: 'Pad Thai', cuisine: '泰国' },
    { name: 'Pho 越南粉', cuisine: '越南' },
    { name: '越式春卷', cuisine: '越南' },
    { name: 'Bánh Mì', cuisine: '越南' },
    { name: '海南鸡饭', cuisine: '新马' },
    { name: 'Laksa', cuisine: '新马' },
    { name: '肉骨茶', cuisine: '新马' },
    { name: '沙嗲', cuisine: '印尼' },
    { name: 'Rendang', cuisine: '印尼' },
    { name: 'Adobo', cuisine: '菲律宾' },
    { name: '茶叶沙拉', cuisine: '缅甸' }
  ],
  jk: [
    { name: '寿司', cuisine: '日料' },
    { name: '拉面', cuisine: '日料' },
    { name: '烧肉', cuisine: '日料' },
    { name: '天妇罗', cuisine: '日料' },
    { name: '韩式烤肉', cuisine: '韩餐' },
    { name: '部队锅', cuisine: '韩餐' },
    { name: '石锅拌饭', cuisine: '韩餐' },
    { name: '韩式炸鸡', cuisine: '韩餐' }
  ]
};

// Curated appealing mix for "全部" (~12 crowd-pleasers across cuisines).
var ALL_MIX = [
  { name: '麻辣火锅', cuisine: '火锅' },
  { name: '烤鸭', cuisine: '京菜' },
  { name: '寿司', cuisine: '日料' },
  { name: '韩式烤肉', cuisine: '韩餐' },
  { name: 'Pizza 披萨', cuisine: '意大利' },
  { name: '汉堡', cuisine: '美式' },
  { name: '冬阴功', cuisine: '泰国' },
  { name: 'Pho 越南粉', cuisine: '越南' },
  { name: '水煮鱼', cuisine: '川菜' },
  { name: '红烧肉', cuisine: '浙菜本帮' },
  { name: '海南鸡饭', cuisine: '新马' },
  { name: '兰州拉面', cuisine: '西北菜' }
];

// Fun one-liners; picker chooses one at random.
var FUN_LINES = [
  '别纠结了，就它了！',
  '天选之食，安排上 🍽️',
  '命运的齿轮开始转动',
  '今晚的胃已经预定',
  '就是这个味儿 😋',
  '缘分到了，冲！',
  '选择困难症退散',
  '不许反悔哦～'
];

// SEGMENT_CAP kept for reference/back-compat, but no longer used to truncate —
// Rico wants EVERY dish shown ("要全部列出来"). Adaptive font/label rendering in
// game.js keeps large wheels (28–64 segments) legible.
var SEGMENT_CAP = 12;

// Build the "全部" list = ALL dishes across every category, interleaved so
// cuisines/colors vary around the wheel (round-robin across categories rather
// than one long same-cuisine block). ALL_MIX above is kept for reference.
function buildAllDishes() {
  var order = ['cn', 'west', 'sea', 'jk'];
  var lists = order.map(function (k) { return (DISHES[k] || []).slice(); });
  var out = [];
  var maxLen = 0;
  for (var i = 0; i < lists.length; i++) {
    if (lists[i].length > maxLen) maxLen = lists[i].length;
  }
  for (var row = 0; row < maxLen; row++) {
    for (var c = 0; c < lists.length; c++) {
      if (row < lists[c].length) out.push(lists[c][row]);
    }
  }
  return out;
}

// Return the FULL list of dishes to render for a given category key.
// No cap, no shuffle-slice — every dish appears on the wheel.
function getWheelItems(catKey) {
  if (catKey === 'all') return buildAllDishes();
  var list = DISHES[catKey] || [];
  return list.slice();
}

function pickFunLine() {
  return FUN_LINES[Math.floor(Math.random() * FUN_LINES.length)];
}

module.exports = {
  CATEGORIES: CATEGORIES,
  DISHES: DISHES,
  ALL_MIX: ALL_MIX,
  FUN_LINES: FUN_LINES,
  SEGMENT_CAP: SEGMENT_CAP,
  getWheelItems: getWheelItems,
  pickFunLine: pickFunLine
};
