# Deskworlds for Windows

The Windows 11 twin of the macOS agent in `wallpaper/`. It shows the same scenes from
`scenes/`, unchanged, behind the desktop icons on every screen.

## Install

You need Windows 10 or 11, the .NET 10 SDK, and the Microsoft Edge WebView2 Runtime
(already part of Windows 11). From the project folder, in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File windows\install.ps1
```

This builds the app, copies it and the scenes to `%LOCALAPPDATA%\Programs\Deskworlds`,
adds it to sign-in (`HKCU\...\CurrentVersion\Run`), and starts it. Your desktop picture
is not changed; the world draws over it. To remove it, run `windows\uninstall.ps1`.

## Usage

Click the Deskworlds icon in the system tray to switch worlds, feed the creatures, stir
the fire, pause, or quit. Desktop icons and clicks work as usual.

The wallpaper runs at 60 fps plugged in and 30 on battery, 20 when windows cover most of
a screen, and stops when a screen is almost fully covered, the session is locked, the
display is off, or Energy Saver is on. If Windows "Animation effects" is off, it starts
paused until you press Resume, as the Mac version does for Reduce Motion.

## How it works

| Part | File |
| --- | --- |
| Finds the desktop's windows and puts a window behind the icons (24H2 layout inside Progman, and the older WorkerW layout) | `Deskworlds/Desktop.cs` |
| One WebView2 per screen, serving the scenes from `https://deskworlds.local/`, with a stand-in for the WebKit message handlers the scenes call | `Deskworlds/Wallpaper.cs` |
| Frame rate policy, cursor tracking, tray menu, Explorer restarts, display power | `Deskworlds/Controller.cs` |

The page never gets mouse events; the cursor position is read on a timer and sent as a
`pointermove`, as on macOS.

## Checking it

- Log: `%LOCALAPPDATA%\Deskworlds\deskworlds.log`
- `Deskworlds.exe --snapshot` saves the first screen to `%TEMP%\deskworlds.png` and logs the page state.
- `Deskworlds.exe --quit` stops the running copy.
