// Runs one wallpaper per screen, decides how fast they draw, and owns the tray icon.

using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Deskworlds;

sealed class Controller : ApplicationContext {
  readonly string root;
  readonly Settings settings = Settings.Load();
  readonly List<Wallpaper> screens = [];
  readonly NotifyIcon tray = new();
  readonly ToolStripMenuItem state = new() { Enabled = false };
  readonly ToolStripMenuItem worldMenu = new("World");
  readonly ToolStripMenuItem feed = new();
  readonly ToolStripMenuItem pause = new();
  readonly System.Windows.Forms.Timer pointerTimer = new();
  readonly System.Windows.Forms.Timer watchTimer = new() { Interval = 1000 };
  readonly Signals signals;
  CoreWebView2Environment? environment;
  DesktopHost? host;
  World world;
  bool stopped, awake = true, displayOn = true;
  int applied;
  Point lastPoint = new(int.MinValue, int.MinValue);
  Rectangle[] layout = [];

  public Controller(string root) {
    this.root = root;
    world = World.Named(settings.World);
    // Reduce Motion's Windows twin is "Animation effects". It decides how the wallpaper
    // starts and nothing more: somebody who installed it may want it anyway.
    stopped = settings.Paused ?? !AnimationsOn();
    signals = new Signals(this);
    BuildTray();

    pointerTimer.Tick += (_, _) => TrackPointer();
    // A cheap beat that also notices battery, Energy Saver and windows moving.
    watchTimer.Tick += (_, _) => { if (!Healthy()) Build(); else ApplyRate(); };
    watchTimer.Start();

    SystemEvents.DisplaySettingsChanged += (_, _) => {
      if (!Screen.AllScreens.Select(s => s.Bounds).SequenceEqual(layout)) Build();
    };
    SystemEvents.SessionSwitch += (_, e) => {
      if (e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect
          or SessionSwitchReason.RemoteDisconnect) awake = false;
      if (e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect
          or SessionSwitchReason.RemoteConnect) awake = true;
      ApplyRate();
    };
    SystemEvents.PowerModeChanged += (_, e) => {
      if (e.Mode == PowerModes.Suspend) awake = false;
      if (e.Mode == PowerModes.Resume) awake = true;
      ApplyRate();
    };
    SystemEvents.UserPreferenceChanged += (_, _) => {
      if (settings.Paused is not null) return;
      stopped = !AnimationsOn();
      ApplyRate();
    };

    _ = StartAsync();
  }

  async Task StartAsync() {
    try {
      // Chromium's own occlusion check sees the desktop icons on top of the page and
      // would stop drawing it. This app decides what is covered instead.
      var options = new CoreWebView2EnvironmentOptions(
        "--disable-features=CalculateNativeWinOcclusion --disable-background-timer-throttling");
      environment = await CoreWebView2Environment.CreateAsync(
        null, Path.Combine(Log.Folder, "WebView2"), options);
      Build();
    } catch (WebView2RuntimeNotFoundException) {
      Log.Write("the WebView2 runtime is missing");
      MessageBox.Show("Deskworlds needs the Microsoft Edge WebView2 Runtime.", "Deskworlds");
      ExitThread();
    }
  }

  bool Healthy() => environment is null || (host is not null && screens.All(s => s.Attached));

  void Build() {
    if (environment is null) return;
    foreach (var screen in screens) screen.Dispose();
    screens.Clear();
    layout = Screen.AllScreens.Select(s => s.Bounds).ToArray();
    host = Desktop.Find();
    if (host is null) {
      Log.Write("the desktop window was not found; trying again");
      return;
    }
    Log.Write($"desktop layout {host.Layout}, {layout.Length} screen(s): {string.Join(", ", layout)}");
    foreach (var bounds in layout) screens.Add(new Wallpaper(bounds, host, world, environment, root));
    ApplyRate();
  }

  static bool AnimationsOn() =>
    !Native.SystemParametersInfoBool(Native.SPI_GETCLIENTAREAANIMATION, 0, out int on, 0) || on != 0;

  static (bool battery, bool saver) Power() {
    if (!Native.GetSystemPowerStatus(out var status)) return (false, false);
    return (status.ACLineStatus == 0, (status.SystemStatusFlag & 1) != 0);
  }

  /// Full speed in plain sight, a slow beat when windows leave only part showing, and
  /// nothing at all behind a full screen of work, when locked or under Energy Saver.
  void ApplyRate() {
    var (battery, saver) = Power();
    var full = battery ? 30 : 60;
    var still = stopped || saver || !awake || !displayOn;
    var blockers = still ? [] : WindowBlockers();
    applied = 0;
    var changed = false;
    foreach (var screen in screens) {
      var showing = Exposure(screen.Bounds, blockers);
      var rate = still || showing < 0.15 ? 0 : showing < 0.4 ? 20 : full;
      screen.SetPower(battery);
      if (screen.SetRate(rate)) changed = true;
      applied = Math.Max(applied, rate);
    }
    if (changed) lastPoint = new Point(int.MinValue, int.MinValue);
    var wanted = Math.Min(30, applied);
    if (wanted == 0) {
      pointerTimer.Stop();
    } else {
      pointerTimer.Interval = 1000 / wanted;
      pointerTimer.Start();
    }
  }

  static readonly HashSet<string> desktopClasses =
    ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

  /// The frames of ordinary visible windows. Cloaked windows (other virtual desktops,
  /// suspended apps) and click-through overlays do not hide anything.
  List<Rectangle> WindowBlockers() {
    var blockers = new List<Rectangle>();
    var me = (uint)Environment.ProcessId;
    Native.EnumWindows((window, _) => {
      if (!Native.IsWindowVisible(window) || Native.IsIconic(window) || Native.IsCloaked(window)) return true;
      Native.GetWindowThreadProcessId(window, out var process);
      if (process == me) return true;
      var ex = (long)Native.GetWindowLongPtr(window, Native.GWL_EXSTYLE);
      if ((ex & (Native.WS_EX_TOOLWINDOW | Native.WS_EX_TRANSPARENT)) != 0) return true;
      if (desktopClasses.Contains(Native.ClassOf(window))) return true;
      var frame = Native.FrameOf(window);
      if (frame.Width > 0 && frame.Height > 0) blockers.Add(frame);
      return true;
    }, IntPtr.Zero);
    return blockers;
  }

  static double Exposure(Rectangle screen, List<Rectangle> blockers) {
    if (blockers.Count == 0) return 1;
    const int columns = 16, rows = 10;
    var free = 0;
    for (var column = 0; column < columns; column++)
      for (var row = 0; row < rows; row++) {
        var point = new Point(
          screen.Left + (int)(screen.Width * (column + 0.5) / columns),
          screen.Top + (int)(screen.Height * (row + 0.5) / rows));
        if (!blockers.Any(b => b.Contains(point))) free++;
      }
    return (double)free / (columns * rows);
  }

  /// The cursor belongs to Explorer, so its position is read rather than captured.
  void TrackPointer() {
    var point = Cursor.Position;
    if (point == lastPoint) return;
    lastPoint = point;
    foreach (var screen in screens)
      screen.SetPointer(screen.Bounds.Contains(point)
        ? new Point(point.X - screen.Bounds.Left, point.Y - screen.Bounds.Top) : null);
  }

  // The tray icon

  void BuildTray() {
    foreach (var choice in World.All) {
      var item = new ToolStripMenuItem(choice.Title) { Tag = choice };
      item.Click += (_, _) => SelectWorld(choice);
      worldMenu.DropDownItems.Add(item);
    }
    feed.Click += (_, _) => { foreach (var screen in screens) screen.Feed(); };
    pause.Click += (_, _) => {
      stopped = !stopped;
      settings.Paused = stopped;
      settings.Save();
      ApplyRate();
    };
    var quit = new ToolStripMenuItem("Quit");
    quit.Click += (_, _) => ExitThread();

    var menu = new ContextMenuStrip();
    menu.Items.AddRange([state, new ToolStripSeparator(), worldMenu, new ToolStripSeparator(), feed, pause,
      new ToolStripSeparator(), quit]);
    menu.Opening += (_, _) => UpdateMenu();
    tray.ContextMenuStrip = menu;
    tray.Icon = TrayIcon.Draw();
    tray.Text = $"Deskworlds · {world.Title}";
    tray.Visible = true;
    // A left click opens the same menu, as the menu bar item does on macOS.
    tray.MouseUp += (_, e) => {
      if (e.Button != MouseButtons.Left) return;
      typeof(NotifyIcon).GetMethod("ShowContextMenu",
        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.Invoke(tray, null);
    };
  }

  /// Says what the wallpaper is doing, and why. Unexplained stillness reads as a fault.
  void UpdateMenu() {
    var (_, saver) = Power();
    foreach (ToolStripMenuItem item in worldMenu.DropDownItems) item.Checked = (World?)item.Tag == world;
    state.Text =
      saver ? "Still, for Energy Saver"
      : stopped ? (settings.Paused is null ? "Paused, for Animation effects off" : "Paused")
      : !awake || !displayOn ? "Still, the screen is off"
      : applied == 0 ? "Resting behind your windows"
      : $"Running at {applied} frames a second";
    pause.Text = stopped ? "Resume" : "Pause";
    pause.Enabled = !saver;
    feed.Text = world.FeedTitle;
    feed.Enabled = applied > 0 && world.CanFeed;
  }

  void SelectWorld(World chosen) {
    if (chosen == world) return;
    world = chosen;
    settings.World = chosen.Name;
    settings.Save();
    tray.Text = $"Deskworlds · {chosen.Title}";
    Build();
  }

  // Requests from a second copy of the app, and from Explorer.

  internal void OnTaskbarCreated() {
    Log.Write("Explorer restarted; rebuilding");
    Build();
  }

  internal void OnDisplayPower(bool on) {
    displayOn = on;
    ApplyRate();
  }

  internal async void Snapshot() {
    if (screens.FirstOrDefault() is not { } first) return;
    foreach (var screen in screens) screen.SetRate(60);
    await Task.Delay(4000);
    try {
      await first.SnapshotAsync(Path.Combine(Path.GetTempPath(), "deskworlds.png"));
    } catch (Exception error) {
      Log.Write($"snapshot failed: {error.Message}");
    }
    ApplyRate();
  }

  protected override void ExitThreadCore() {
    watchTimer.Stop();
    pointerTimer.Stop();
    tray.Visible = false;
    tray.Dispose();
    foreach (var screen in screens) screen.Dispose();
    screens.Clear();
    signals.Dispose();
    Desktop.RepaintPicture();
    Log.Write("quit");
    base.ExitThreadCore();
  }
}

/// A hidden top-level window: Explorer broadcasts TaskbarCreated when it restarts, and
/// the display's power state arrives as a window message. Also listens for the named
/// events a second copy of the app sets for --snapshot and --quit.
sealed class Signals : NativeWindow, IDisposable {
  public const string SnapshotEvent = @"Local\Deskworlds.Snapshot";
  public const string QuitEvent = @"Local\Deskworlds.Quit";

  readonly Controller controller;
  readonly uint taskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");
  readonly EventWaitHandle snapshot = new(false, EventResetMode.AutoReset, SnapshotEvent);
  readonly EventWaitHandle quit = new(false, EventResetMode.AutoReset, QuitEvent);
  readonly RegisteredWaitHandle snapshotWait, quitWait;
  readonly SynchronizationContext ui = SynchronizationContext.Current!;

  public Signals(Controller controller) {
    this.controller = controller;
    CreateHandle(new CreateParams { Caption = "Deskworlds signals" });
    var display = Native.GUID_CONSOLE_DISPLAY_STATE;
    Native.RegisterPowerSettingNotification(Handle, ref display, 0);
    snapshotWait = ThreadPool.RegisterWaitForSingleObject(snapshot,
      (_, _) => ui.Post(_ => controller.Snapshot(), null), null, -1, false);
    quitWait = ThreadPool.RegisterWaitForSingleObject(quit,
      (_, _) => ui.Post(_ => controller.ExitThread(), null), null, -1, false);
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == (int)taskbarCreated) {
      controller.OnTaskbarCreated();
    } else if (m.Msg == Native.WM_POWERBROADCAST && (int)m.WParam == Native.PBT_POWERSETTINGCHANGE) {
      // POWERBROADCAST_SETTING: a GUID, a length, then the data. 0 off, 1 on, 2 dimmed.
      var data = Marshal.ReadInt32(m.LParam, 16 + 4);
      controller.OnDisplayPower(data != 0);
    }
    base.WndProc(ref m);
  }

  public void Dispose() {
    snapshotWait.Unregister(null);
    quitWait.Unregister(null);
    snapshot.Dispose();
    quit.Dispose();
    DestroyHandle();
  }
}

static class TrayIcon {
  /// The logo's slab of layered ground, drawn in white for the dark taskbar.
  public static Icon Draw() {
    using var bitmap = new Bitmap(32, 32);
    using (var g = Graphics.FromImage(bitmap)) {
      g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
      using var top = new SolidBrush(Color.FromArgb(240, 255, 255, 255));
      using var side = new SolidBrush(Color.FromArgb(150, 255, 255, 255));
      g.FillPolygon(top, [new Point(16, 4), new Point(29, 11), new Point(16, 18), new Point(3, 11)]);
      g.FillPolygon(side, [new Point(3, 14), new Point(16, 21), new Point(16, 28), new Point(3, 21)]);
      g.FillPolygon(side, [new Point(29, 14), new Point(16, 21), new Point(16, 28), new Point(29, 21)]);
    }
    return Icon.FromHandle(bitmap.GetHicon());
  }
}
