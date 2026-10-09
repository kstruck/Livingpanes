# Contributing

Thanks for helping. A few things keep this project healthy.

## Ground rules

- **The six handcrafted worlds are Chase Lean's.** Keep changes to `scenes/<world>/` as
  small as possible, so fixes from [Deskworlds](https://github.com/chaseleantj/deskworlds)
  can still be merged. Improvements to those scenes are best offered upstream first.
- New features go in new files: `windows/`, `studio/`, `scenes/studio/`, `scenes/shared/extras.js`.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing a contract (page hooks, Studio
  messages, the recipe schema). Change the doc in the same pull request.
- Every change ships with its test.

## Running the checks

You need Node.js 20+ and, for the Windows app, the .NET 10 SDK.

```powershell
npm test
npm run check
dotnet test windows\Livingpanes.sln
dotnet run --project windows\Livingpanes -- --selftest
```

`--selftest` opens a hidden WebView2 and tries to break out of the sandbox (network,
WebRTC, path traversal) and checks that the Studio preview loads. It must print only
`PASS` lines. Run it after any change to `ResourceServer.cs`, `Wallpaper.cs` or `Studio.cs`.

To try the scenes in a browser: `npm start`, then open http://127.0.0.1:8080. To run the
Windows app from source: `dotnet run --project windows\Livingpanes`.

## Adding an example scene

1. Make it in the Studio, or write `scenes/studio/examples/<name>/recipe.json` by hand.
2. Add `{ "name": "<name>", "title": "<Title>" }` to `scenes/studio/examples/index.json`.
3. `npm test` checks every example against the schema.

## Pull requests

CI must pass. Keep pull requests focused, and say what you tested and how.
