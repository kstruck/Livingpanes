# Architecture

This fork adds a Windows host, a scene **Studio**, and a set of playful extras to
[Deskworlds](https://github.com/chaseleantj/deskworlds) by Chase Lean. The six original
scenes in `scenes/` are Chase's work and stay as close to upstream as possible, so
upstream fixes can be merged. New code lives in new folders.

```
scenes/<world>/        Chase's six handcrafted worlds (upstream; minimal edits only)
scenes/shared/         upstream helpers + extras.js (overlay extras for every world)
scenes/studio/         the Studio engine: draws any scene recipe (image, gradient, creatures, effects)
scenes/studio/examples/  recipes that ship with the app
studio/                the Studio app UI (create scenes from an image or from words)
windows/               the Windows host (C#, .NET 10, WinForms + WebView2)
wallpaper/             the upstream macOS host (unchanged)
```

## Hosts

The Windows host serves every page from `https://deskworlds.local/` through a
`WebResourceRequested` handler (`windows/Deskworlds/ResourceServer.cs`), never from the
network:

| URL | Files |
| --- | --- |
| `/scenes/...`, `/vendor/...`, `/ui/...`, `/studio/...` | the app's scene folder |
| `/user/<id>/...` | `%LOCALAPPDATA%\Deskworlds\scenes\<id>\` (saved scenes) |
| `/user/_drafts/<draft>/...` | `%LOCALAPPDATA%\Deskworlds\drafts\<draft>\` (unsaved work) |

Every response carries a Content-Security-Policy that allows only `'self'` (plus inline
script for import maps), so no page can reach the network. Navigation away from
`https://deskworlds.local/` and new windows are refused. Ids match `^[a-z0-9-]{1,64}$`;
paths are resolved and must stay inside their root.

- ⚠️ **Never add `SetVirtualHostNameToFolderMapping`.** With a mapping, WebView2 serves
  the folder itself and `WebResourceRequested` never fires, so the policy and the path
  checks silently stop applying. This happened once, before release.
- WebRTC (UDP that no CSP governs) is removed in every frame by `ResourceServer.NoWebRtc`.
- Responses carry `Access-Control-Allow-Origin: null`, so the sandboxed (opaque-origin)
  Studio preview can load the engine's modules and the draft's images.
- `Livingpanes.exe --selftest` loads a page in a hidden WebView2 and tries fetch, image,
  WebSocket and WebRTC escapes, traversal, and the sandboxed preview. CI runs it.
- `Livingpanes.exe --depth <image>` writes `depth.png` beside an image (developer check).

## Wallpaper page contract

Every wallpaper page (`scenes/<world>/wallpaper.html`, `scenes/studio/wallpaper.html`)
may define these globals. The host calls them with `ExecuteScriptAsync`, guarded with
`typeof x === 'function'`.

| Hook | Meaning |
| --- | --- |
| `sceneRate(fps)` | 0 stops drawing; >0 caps the frame rate |
| `scenePower(onBattery)` | battery profile |
| `sceneFeed()` | food at a spot the scene picks |
| `sceneFeedAt(x, y)` | food at CSS-pixel point (x, y); fall back to `sceneFeed` |
| `sceneTap(x, y)` | "tap the glass" at CSS-pixel point: ripple, creatures scatter |
| `scenePets(pets)` | the pet list, see below |
| `sceneClock(follow)` | true: lighting follows the local time of day |
| `scenePointer(x, y)`, `scenePointerOut()` | cursor, physical pixels (defined by the host bridge) |

The page says it is ready with `webkit.messageHandlers.ready.postMessage(true)`, which
the Windows bridge forwards to the host. The bridge runs in the top frame only.

`scenes/shared/extras.js` is loaded into every wallpaper page by the host bridge. It
draws ripples, day/night grading and pets on a 2D overlay canvas for worlds that do not
handle them natively, and defines `sceneFeedAt`/`sceneTap`/`scenePets`/`sceneClock`
when the world has not. A world that handles them itself sets
`window.sceneHandlesExtras = true` before extras.js runs.

### Pets

```json
[{ "id": "a1b2", "name": "Bubbles", "color": "#ff8a3d", "born": "2026-10-09T12:00:00Z",
   "lastFed": "2026-10-09T12:00:00Z", "meals": 3 }]
```

The host owns the list (`settings.json`). Size grows with meals (`1 + min(meals, 40) *
0.025`). A pet unfed for 24 hours sulks: slower, greyer, a small cloud above it. Any
feeding (tray, hotkey) feeds the pets. Names are shown under each pet.

## Studio engine (`scenes/studio/`)

`wallpaper.html` loads a recipe from one of:

- `?scene=<id>` → `/user/<id>/recipe.json`; assets relative to `/user/<id>/`
- `?example=<name>` → `/scenes/studio/examples/<name>/recipe.json`
- `?draft=<draft>` → `/user/_drafts/<draft>/recipe.json`
- `?preview=1` → waits for `postMessage({ type: 'deskworlds:recipe', recipe, base })`
  from its parent and redraws on every new one

The recipe schema is `scenes/studio/recipe.schema.json`; `scenes/studio/src/recipe.js`
normalizes any input into a safe recipe (clamps, enums, defaults, never throws). The
same schema is sent to Claude as the tool input schema.

`mode: "code"` recipes load `scene.js` from the scene folder. It default-exports
`create(ctx)`; see `scenes/studio/README.md` for `ctx`. Code mode is off unless the user
turns it on in the Studio, and the Studio shows the code before it can run.

## Studio app (`studio/`)

A normal window (tray → Studio…) hosting `/studio/index.html`. It talks to the host
with `chrome.webview.postMessage({ id, kind, ...args })`; the host answers with
`{ id, ok, result }` or `{ id, ok: false, error }`, and may send
`{ id, kind: 'progress', text, fraction }` while working. The host accepts these only
from the Studio window's top frame.

| kind | args | result |
| --- | --- | --- |
| `listScenes` | | `[{ id, name, description, mode, base }]` saved scenes, plus examples with `example: true` |
| `newDraft` | | `{ draft, base }` |
| `pickImage` | `draft` | `{ url, width, height, file }` or `null` if cancelled |
| `makeDepth` | `draft` | `{ url }` (downloads the model once, 99 MB, SHA-256 checked) |
| `generate` | `draft, prompt, allowCode` | `{ recipe, code? }` (writes `scene.js` to the draft when code is returned) |
| `saveDraft` | `draft, recipe` | `{ base }` |
| `saveScene` | `draft` | `{ id }` (copies the draft into saved scenes) |
| `editScene` | `id` | `{ draft, base, recipe }` (a draft copy of a saved scene) |
| `deleteScene` | `id` | `true` |
| `useScene` | `id` or `example` | `true` (sets it as the wallpaper) |
| `exportScene` | `id` | `{ file }` or `null` (a `.deskworld` zip) |
| `importScene` | | `{ id }` or `null` |
| `getSettings` | | `{ hasApiKey, model, models }` |
| `setApiKey` | `key` (empty clears) | `true` |
| `setModel` | `model` | `true` |

The preview is an `<iframe sandbox="allow-scripts">` showing
`/scenes/studio/wallpaper.html?preview=1`, so code in it cannot reach the Studio page
or the host. It posts `{ type: 'deskworlds:preview-ready' }` to the parent once it
listens for recipes. Host-side, only the Studio window's top frame is heard
(`CoreWebView2.WebMessageReceived` never carries iframe messages, and no
`CoreWebView2Frame` handlers are ever added), and the Studio window cannot navigate
anywhere outside `/studio/`.

## Claude

`windows/Deskworlds/Claude.cs` calls `POST https://api.anthropic.com/v1/messages` with a
forced `make_scene` tool whose `input_schema` is the recipe schema (plus an optional
`code` string when code mode is on). When the draft has an image, a downscaled copy is
attached so the scene can match it. The API key is stored with Windows DPAPI
(current user) in `%LOCALAPPDATA%\Deskworlds\apikey.bin`, never in a page.

## Depth

`windows/Deskworlds/Depth.cs` runs Depth Anything V2 Small (Apache-2.0,
`onnx-community/depth-anything-v2-small`, revision `4472b736…`, `onnx/model.onnx`,
SHA-256 `afb6a5c2…df10c`) on the CPU with ONNX Runtime, and writes `depth.png`
(near = white) next to the image.
