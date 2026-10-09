# Security

Livingpanes runs web pages on your desktop all day, and it can run scenes that other
people share or that Claude writes. These are the protections, so you can judge them.

## What a scene can do

- **No network.** Every page is served by the app itself from `https://deskworlds.local/`
  with a Content-Security-Policy of `default-src 'self'`, so fetch, images, scripts and
  WebSockets to anywhere else are refused. WebRTC, which a policy cannot govern, is
  removed from every frame before page code runs. Navigation away, pop-ups, downloads
  and permission prompts (camera, microphone, location) are all refused.
  `Livingpanes.exe --selftest` proves this in a real WebView2 on every CI run.
- **No files outside its folder.** Requests are resolved against fixed folders and refused
  if they leave them (`..`, encoded slashes, drive letters and unknown file types are
  all rejected; see `windows/Livingpanes.Tests/SafetyTests.cs`).
- **No way to ask the host for anything.** A wallpaper page can send exactly two messages
  to the app: "ready" and a log line. Everything else is ignored.
- **The Studio preview is sandboxed.** It runs in an `<iframe sandbox="allow-scripts">`,
  so code in it cannot reach the Studio page, which is the only page allowed to spend API
  credit or write files.

## Code scenes

"Let Claude write code" is off by default. When it is on, the Studio shows the code and
will not run it until you tick "I've read this code and want to run it". Scenes you
import from a `.livingpane` file never run code until you have read it in the Studio.

**Read the code for real.** The protections above are layered, not perfect. In particular,
WebRTC is removed by a script, and a deliberately hostile scene could look for a way
around a script (for example through a frame it builds itself). Code you approve can also
read the photos in your Livingpanes scenes folder, because scenes are allowed to show
them. Only run code you have read and understood, and never code from someone you do
not trust. Recipe scenes (no code) cannot do any of this: the engine only reads numbers,
colors and names from them.

## Found and fixed before release

An independent review before the first release found that a WebView2 folder mapping was
serving files directly, so the network policy above was never applied. That mapping was
removed and `--selftest` was added so this cannot silently regress. The same review led
to the WebRTC removal, import size checks that ignore filename case, image size limits
(to stop decompression bombs), a log size cap, and atomic scene saves.

## Your API key

The key is encrypted with Windows DPAPI for your user account
(`%LOCALAPPDATA%\Livingpanes\apikey.bin`) and only ever read by the app itself. It is
never given to a page. Requests go straight from your PC to `api.anthropic.com`.

## The depth model

Downloaded once from a pinned Hugging Face revision and checked against its SHA-256
before it is loaded. A file that does not match is deleted.

## Reporting a problem

Please report security issues privately through
[GitHub security advisories](https://github.com/kstruck/Livingpanes/security/advisories/new)
rather than a public issue. Issues in the original scenes may also be relevant to
[Deskworlds](https://github.com/chaseleantj/deskworlds).
