# Studio engine

`wallpaper.html` draws any scene recipe (`recipe.schema.json`). `index.html` shows the
shipped examples full window in a browser.

## Loading

| URL | Recipe | Assets relative to |
| --- | --- | --- |
| `wallpaper.html?scene=<id>` | `/user/<id>/recipe.json` | `/user/<id>/` |
| `wallpaper.html?example=<name>` | `./examples/<name>/recipe.json` | that folder |
| `wallpaper.html?draft=<draft>` | `/user/_drafts/<draft>/recipe.json` | that folder |
| `wallpaper.html?preview=1` | `postMessage({ type: 'deskworlds:recipe', recipe, base })` from the parent | `base` (must be on this host) |

In preview mode the page posts `{ type: 'deskworlds:preview-ready' }` to its parent once
it listens, and rebuilds on every recipe (bursts are coalesced, ~40 ms). Messages from
anything but `window.parent` are ignored.

Other parameters: `?quality=eco|balanced|detail|native`, `?clock=0` (fixed mood in a
browser), `?hour=21.5` (pretend it is 21:30, for checking lighting), `?capture&seed=n`
(repeatable start).

Every recipe goes through `normalize()` (`src/recipe.js`): numbers clamped, enums
whitelisted, colors checked, arrays capped, defaults filled. `validate()` lists the
problems in the console; the scene is drawn anyway with safe values.

## Hooks

`sceneRate`, `scenePower`, `sceneFeed`, `sceneFeedAt(x, y)`, `sceneTap(x, y)`,
`scenePets(pets)`, `sceneClock(follow)` as in `ARCHITECTURE.md`, plus
`window.sceneHandlesExtras = true`. `window.__livingpanes = { pets, followClock }` is read
at startup in case the host sent them before the module loaded. Hosted (a host bridge
and not preview), the page starts at 0 fps and obeys `sceneRate`; otherwise it runs at
60 fps. In a browser, click feeds and Shift+click taps the glass.

## Code mode

With `"mode": "code"` the engine imports `scene.js` from the recipe's folder. Its default
export is `create(ctx)` (may be async, may return `{ dispose() }`). The engine owns the
frame loop, the frame rate, the power profile and the hooks; the code only draws.

| `ctx.` | |
| --- | --- |
| `THREE` | the vendored three.js module |
| `canvas` | the page's canvas |
| `renderer` | a `THREE.WebGLRenderer` on that canvas, sized and color-managed (sRGB output) by the engine |
| `size()` | `{ width, height, pixelRatio }`, CSS pixels |
| `pointer` | `{ x, y, inside }`, CSS pixels from the top left, live |
| `night()` | 0 (day) .. 1 (night), eased, from the clock or the recipe's mood |
| `recipe` | a copy of the normalized recipe |
| `onFrame(fn(dt, t))` | every frame; call `ctx.renderer.render(...)` here. `dt` seconds (0 on a redraw while stopped), `t` seconds since start |
| `onResize(fn(w, h))` | CSS pixels; the renderer is already resized |
| `onFeed(fn(x, y))` | food at a CSS-pixel point (`sceneFeed` picks one) |
| `onTap(fn(x, y))` | the glass was tapped |
| `onPets(fn(pets))` | the pet list (`ARCHITECTURE.md` "Pets") |

Each `on*` returns a function that removes the handler. An exception from `create` or
any handler stops the scene and shows the error box; the page keeps running.

```js
export default function create({ THREE, renderer, onFrame, onResize, night }) {
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x113355 }));
  scene.add(quad);
  onFrame((dt, t) => { quad.material.color.setHSL(0.6, 0.5, 0.3 - 0.2 * night()); renderer.render(scene, camera); });
  return { dispose() { quad.geometry.dispose(); quad.material.dispose(); } };
}
```

## Files

`src/recipe.js` normalize/validate (pure) · `src/behavior.js` creatures, food, pets,
daylight (pure) · `src/backdrop.js` image/gradient, parallax, ripples, caustics, sway,
rays, fog, vignette · `src/particles.js` stateless GPU particles · `src/creatures.js` one
instanced draw per kind, procedural bodies · `src/food.js` · `src/labels.js` pet names ·
`src/scene.js` the recipe scene · `src/code.js` code mode · `src/main.js` loading, hooks,
loop. Tests: `node scenes/studio/tests/recipe.mjs`, `node scenes/studio/tests/behavior.mjs`.
