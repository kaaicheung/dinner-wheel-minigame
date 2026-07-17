# 今晚吃啥转盘 — WeChat Mini GAME (小游戏)

Canvas-only WeChat **Mini Game** port of the dinner-wheel mini-program. No
WXML / WXSS / pages / components — the whole UI is drawn on one full-screen
canvas and interaction is manual touch hit-testing.

## Files
- `game.json` — global config (`deviceOrientation: portrait`, `showStatusBar: false`).
- `game.js` — entry point. Creates the canvas via `wx.createCanvas()`, draws the
  title / category tabs / wheel / center 转! button / result / 再转一次 button,
  runs the eased spin animation, and handles `wx.onTouchStart` hit-testing.
- `dishes.js` — dish data + categories + `getWheelItems` + `pickFunLine`
  (ported verbatim from the mini-program; loaded via `require`).
- `project.config.json` — **`compileType: "game"`** so DevTools treats it as a
  Mini Game. AppID `wxd7d745a7cc14f6c0` (Rico's registered 小游戏 account).

## Import into WeChat DevTools (Mini Game)
1. Open **微信开发者工具 (WeChat DevTools)**.
2. **新建/导入项目 → 小游戏 (Mini Game)** tab.
3. **导入项目**, choose this folder (`dinner-wheel-minigame/`).
4. AppID is prefilled as `wxd7d745a7cc14f6c0` (matches the game account). If you
   need to test without an account, pick 测试号 — but the real AppID is correct here.
5. The simulator opens straight into the game (there is no page navigation —
   a Mini Game has a single canvas surface).

## How it works
- **Wheel + spin + landing math** are reused from the mini-program: a winner is
  picked up front, then the final rotation is back-solved so that segment's
  center lands under the top pointer (12 o'clock). Spin is `easeOutCubic`,
  ~3.5s, 5–7 turns.
- **Touch:** `wx.onTouchStart` reads `touches[0].clientX/clientY` (CSS px) and
  hit-tests against tab rects (switch category → redraw), the center 转! circle
  (spin), and the 再转一次 rect (spin again).
- **DPR:** canvas backing store is sized `screen × pixelRatio` with
  `ctx.scale(dpr, dpr)`, so all drawing is in CSS px and stays crisp.
- **Confetti:** a canvas-drawn particle burst fires from the wheel center on landing.

## Palette (from the mini-program)
- Night-market aubergine `#1a1424` · chili `#ff6b35` · marigold `#ffd23f`
- Segment colors reused from `SEG_COLORS` in the original `index.js`.
