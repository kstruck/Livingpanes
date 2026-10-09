# windows/

The Livingpanes Windows host. Install and usage are in the [main README](../README.md);
how it works is in [ARCHITECTURE.md](../ARCHITECTURE.md).

| File | Role |
| --- | --- |
| `Livingpanes/Program.cs` | entry point, single instance, `--snapshot` / `--quit` / `--studio` |
| `Livingpanes/Controller.cs` | one wallpaper per screen, frame-rate policy, tray menu, hotkeys, pets |
| `Livingpanes/Desktop.cs` | puts a window behind the desktop icons (24H2 Progman layout and the older WorkerW one) |
| `Livingpanes/Wallpaper.cs` | one WebView2 per screen and the page bridge |
| `Livingpanes/ResourceServer.cs` | serves every page from local files with a no-network CSP |
| `Livingpanes/Store.cs` | saved scenes, drafts, `.livingpane` import and export |
| `Livingpanes/Studio.cs` | the Studio window and its message protocol |
| `Livingpanes/Claude.cs` | "describe a scene" (user's own key, DPAPI-encrypted) |
| `Livingpanes/Depth.cs` | Depth Anything V2 Small on ONNX Runtime, for 3D parallax |
| `Livingpanes.Tests/` | path, id and import safety tests |

```powershell
dotnet test windows\Livingpanes.sln
dotnet run --project windows\Livingpanes
```

Run from a build, the app finds the scenes by walking up to the repository root. The log
is `%LOCALAPPDATA%\Livingpanes\livingpanes.log`; `Livingpanes.exe --snapshot` writes
`%TEMP%\livingpanes.png` and the page state to the log.
