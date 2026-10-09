// A living world as a Windows desktop wallpaper. The Windows twin of wallpaper/Wallpaper.swift.
//
//   Deskworlds.exe              run (one copy at a time)
//   Deskworlds.exe --snapshot   ask the running copy to save its first screen to %TEMP%\deskworlds.png
//   Deskworlds.exe --quit       ask the running copy to quit

namespace Deskworlds;

static class Program {
  [STAThread]
  static int Main(string[] args) {
    if (args.Contains("--snapshot")) return Signal(Signals.SnapshotEvent);
    if (args.Contains("--quit")) return Signal(Signals.QuitEvent);

    using var single = new Mutex(true, @"Local\Deskworlds", out var first);
    if (!first) return 0;

    var root = FindScenes();
    if (root is null) {
      Log.Write("no scenes folder next to the app or above it");
      MessageBox.Show("Deskworlds could not find its scenes folder.", "Deskworlds");
      return 1;
    }
    Log.Write($"start, scenes from {root}");
    Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.ThreadException += (_, e) => Log.Write($"error: {e.Exception}");
    AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write($"fatal: {e.ExceptionObject}");
    // Installed before the controller exists, so requests from other threads that it
    // posts back land on this UI thread, where WebView2 must be called.
    SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
    Application.Run(new Controller(root));
    return 0;
  }

  static int Signal(string name) {
    if (!EventWaitHandle.TryOpenExisting(name, out var handle)) return 1;
    using (handle) handle.Set();
    return 0;
  }

  /// Installed: a "scene" folder beside the exe. From a build: the repository root above it.
  static string? FindScenes() {
    var installed = Path.Combine(AppContext.BaseDirectory, "scene");
    if (Directory.Exists(Path.Combine(installed, "scenes"))) return installed;
    for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
      if (Directory.Exists(Path.Combine(folder.FullName, "scenes"))
          && Directory.Exists(Path.Combine(folder.FullName, "vendor")))
        return folder.FullName;
    return null;
  }
}
