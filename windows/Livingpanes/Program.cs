// A living world as a Windows desktop wallpaper. The Windows twin of wallpaper/Wallpaper.swift.
//
//   Livingpanes.exe              run (one copy at a time)
//   Livingpanes.exe --snapshot   ask the running copy to save its first screen to %TEMP%\livingpanes.png
//   Livingpanes.exe --quit       ask the running copy to quit
//   Livingpanes.exe --studio     ask the running copy to open the Studio

namespace Livingpanes;

static class Program {
  /// The folder the pages are served from, once found.
  public static string? Root { get; private set; }

  [STAThread]
  static int Main(string[] args) {
    if (args.Contains("--snapshot")) return Signal(Signals.SnapshotEvent);
    if (args.Contains("--quit")) return Signal(Signals.QuitEvent);
    if (args.Contains("--studio")) return Signal(Signals.StudioEvent);

    var root = Root = FindScenes();
    if (args.Length == 2 && args[0] == "--depth") {
      // Developer check: writes depth.png next to the given image.
      Native.AttachConsole(-1);
      try {
        var output = Depth.MakeAsync(Path.GetFullPath(args[1]), (text, _) => Console.WriteLine(text), CancellationToken.None)
          .GetAwaiter().GetResult();
        Console.WriteLine($"wrote {output}");
        return 0;
      } catch (Exception error) {
        Console.WriteLine($"depth failed: {error.Message}");
        return 1;
      }
    }
    if (args.Contains("--selftest")) {
      // A WinExe has no console of its own; borrow the caller's so results print there.
      Native.AttachConsole(-1);
      return root is null ? 2 : SelfTest.Run(root);
    }

    using var single = new Mutex(true, @"Local\Livingpanes", out var first);
    if (!first) return 0;

    if (root is null) {
      Log.Write("no scenes folder next to the app or above it");
      MessageBox.Show("Livingpanes could not find its scenes folder.", "Livingpanes");
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
