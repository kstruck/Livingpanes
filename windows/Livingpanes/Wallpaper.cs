// One screen's worth of world: a borderless window holding a WebView2, made a child of
// the desktop so the icons stay on top and keep working. The window never sees the
// mouse; the cursor position is read on a timer and handed to the page instead.

using System.Globalization;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Livingpanes;

sealed class WallpaperForm : Form {
  public WallpaperForm(Rectangle bounds, Color background) {
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    StartPosition = FormStartPosition.Manual;
    Bounds = bounds;
    BackColor = background;
    Text = "Livingpanes";
  }

  protected override CreateParams CreateParams {
    get {
      var parameters = base.CreateParams;
      parameters.ExStyle |= (int)(Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE);
      return parameters;
    }
  }

  protected override bool ShowWithoutActivation => true;
}

sealed class Wallpaper : IDisposable {
  public const string Host = "deskworlds.local";

  // The scene's own hooks, plus a stand-in for the WebKit message handlers the macOS
  // agent provides, so the scenes run unchanged.
  const string Bridge = """
    (() => {
      // Frames inside a page (the Studio's sandboxed preview) get no bridge to the host.
      if (window !== window.top || !window.chrome?.webview) return;
      const post = (kind, text) => window.chrome.webview.postMessage({ kind, text: String(text) });
      window.webkit = { messageHandlers: {
        ready: { postMessage: () => post('ready', '') },
        report: { postMessage: (text) => post('report', text) },
      } };
      for (const level of ['error', 'warn']) {
        const original = console[level];
        console[level] = (...parts) => {
          post('report', parts.map((part) => part && part.stack ? part.stack : part).join(' '));
          original.apply(console, parts);
        };
      }
      addEventListener('error', (event) => post('report', `${event.message} at ${event.filename}:${event.lineno}`));
      addEventListener('unhandledrejection', (event) => post('report', event.reason));
      window.scenePointerCount = 0;
      // Positions arrive in physical pixels; the page works in CSS pixels.
      window.scenePointer = (x, y) => {
        const canvas = document.querySelector('#scene');
        const ratio = window.devicePixelRatio || 1;
        window.scenePointerCount++;
        if (canvas)
          canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x / ratio, clientY: y / ratio, bubbles: true }));
      };
      window.scenePointerOut = () => {
        const canvas = document.querySelector('#scene');
        if (canvas) canvas.dispatchEvent(new PointerEvent('pointerleave'));
      };
      // Ripples, pets and day/night for worlds that do not draw them themselves.
      addEventListener('DOMContentLoaded', () => {
        import('/scenes/shared/extras.js').catch((error) => post('report', `extras: ${error}`));
      });
    })();
    """;

  static readonly JsonSerializerOptions camel = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

  public readonly Rectangle Bounds;
  readonly WallpaperForm form;
  readonly WebView2 view;
  readonly DesktopHost host;
  bool loaded, inside, battery, disposed;
  int rate;
  DateTime reportWindow = DateTime.MinValue;
  int reports, reportsDropped;

  public Wallpaper(Rectangle bounds, DesktopHost host, World world, CoreWebView2Environment environment, string root) {
    Bounds = bounds;
    this.host = host;
    form = new WallpaperForm(bounds, world.Background);
    view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = world.Background };
    form.Controls.Add(view);
    form.Show();
    Desktop.Attach(form.Handle, host, bounds);
    _ = StartAsync(world, environment, root);
  }

  async Task StartAsync(World world, CoreWebView2Environment environment, string root) {
    try {
      var options = environment.CreateCoreWebView2ControllerOptions();
      // The page holds nothing worth keeping between runs.
      options.IsInPrivateModeEnabled = true;
      await view.EnsureCoreWebView2Async(environment, options);
      if (disposed) return;
      var core = view.CoreWebView2;
      core.Settings.AreDefaultContextMenusEnabled = false;
      core.Settings.AreDevToolsEnabled = false;
      core.Settings.IsZoomControlEnabled = false;
      core.Settings.IsStatusBarEnabled = false;
      core.Settings.AreBrowserAcceleratorKeysEnabled = false;
      // Served from a private host name so module imports resolve as from a web server.
      // ResourceServer answers every request itself, with a no-network policy. There must
      // be no SetVirtualHostNameToFolderMapping as well: with one, WebView2 serves the
      // folder directly and the handler (and its policy) never runs.
      await ResourceServer.InstallAsync(core, environment, root);
      core.WebMessageReceived += OnMessage;
      core.NavigationCompleted += (_, e) => {
        if (!e.IsSuccess) Log.Write($"the scene did not load: {e.WebErrorStatus}");
      };
      core.ProcessFailed += (_, e) => Log.Write($"web process failed: {e.ProcessFailedKind}");
      await core.AddScriptToExecuteOnDocumentCreatedAsync(Bridge);
      // Native: full display resolution plugged in, the Balanced profile on battery.
      core.Navigate($"https://{Host}{world.Page}{(world.Page.Contains('?') ? '&' : '?')}quality=native");
    } catch (Exception error) {
      Log.Write($"WebView2 did not start: {error}");
    }
  }

  void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e) {
    try {
      using var message = JsonDocument.Parse(e.WebMessageAsJson);
      var kind = message.RootElement.GetProperty("kind").GetString();
      // A wallpaper page can say only these two things; anything else is ignored, so a
      // scene whose code Claude wrote has no way to ask the host for anything.
      if (kind == "ready") {
        // The scene has installed its callbacks; a rate sent earlier would be lost.
        loaded = true;
        Log.Write($"scene ready on {Bounds}");
        Send();
        SendExtras();
      } else if (kind == "report") {
        // At most 20 lines a minute per screen; a page stuck in an error loop says so once.
        var now = DateTime.UtcNow;
        if (now - reportWindow > TimeSpan.FromMinutes(1)) {
          if (reportsDropped > 0) Log.Write($"page: ({reportsDropped} more messages dropped)");
          reportWindow = now;
          reports = 0;
          reportsDropped = 0;
        }
        if (++reports <= 20)
          Log.Write($"page: {ResourceServer.Truncate(message.RootElement.GetProperty("text").GetString(), 1000)}");
        else
          reportsDropped++;
      }
    } catch (Exception error) {
      Log.Write($"unreadable page message: {error.Message}");
    }
  }

  /// Explorer can be restarted, taking the parent window with it.
  public bool Attached => Native.IsWindow(host.Parent) && Native.IsWindow(form.Handle);

  void Run(string script) {
    if (!loaded || disposed || view.CoreWebView2 is null) return;
    _ = view.CoreWebView2.ExecuteScriptAsync(script);
  }

  /// Sends only changes; the page's ready message resends once.
  public bool SetRate(int wanted) {
    if (wanted == rate) return false;
    rate = wanted;
    Log.Write($"{rate} fps on {Bounds}");
    if (rate == 0 && inside) {
      Run("scenePointerOut()");
      inside = false;
    }
    Send();
    return true;
  }

  public void SetPower(bool onBattery) {
    if (battery == onBattery) return;
    battery = onBattery;
    Send();
  }

  void Send() => Run(
    $"typeof scenePower === 'function' && scenePower({(battery ? "true" : "false")});" +
    $"typeof sceneRate === 'function' && sceneRate({rate});");

  /// Food from the tray menu. The page picks its own spot, since there is no click.
  public void Feed() {
    if (rate > 0) Run("typeof sceneFeed === 'function' && sceneFeed()");
  }

  static string Css(Point p) => string.Create(CultureInfo.InvariantCulture,
    $"{p.X} / (window.devicePixelRatio || 1), {p.Y} / (window.devicePixelRatio || 1)");

  /// Food where the cursor is (the hotkey), in this screen's physical pixels.
  public void FeedAt(Point p) {
    if (rate == 0) return;
    Run($"typeof sceneFeedAt === 'function' ? sceneFeedAt({Css(p)}) : typeof sceneFeed === 'function' && sceneFeed()");
  }

  /// "Tap the glass": a ripple from the cursor, and everything nearby scatters.
  public void Tap(Point p) {
    if (rate == 0) return;
    Run($"typeof sceneTap === 'function' && sceneTap({Css(p)})");
  }

  string pets = "[]";
  bool followClock = true;

  public void SetPets(IReadOnlyList<Pet> list) {
    pets = JsonSerializer.Serialize(list, camel);
    SendExtras();
  }

  public void SetClock(bool follow) {
    followClock = follow;
    SendExtras();
  }

  /// Kept on window as well, so overlay code that loads after this call still finds it.
  void SendExtras() => Run(
    $"window.__livingpanes = {{ pets: {pets}, followClock: {(followClock ? "true" : "false")} }};" +
    "typeof scenePets === 'function' && scenePets(window.__livingpanes.pets);" +
    "typeof sceneClock === 'function' && sceneClock(window.__livingpanes.followClock);");

  /// A cursor position in this screen's physical pixels, or null when it left the screen.
  public void SetPointer(Point? point) {
    if (!loaded || rate == 0) return;
    if (point is not { } p) {
      if (inside) Run("scenePointerOut()");
      inside = false;
      return;
    }
    inside = true;
    Run(string.Create(CultureInfo.InvariantCulture, $"scenePointer({p.X},{p.Y})"));
  }

  /// What this screen shows right now, for checking a wallpaper nobody can click on.
  public async Task SnapshotAsync(string file) {
    if (view.CoreWebView2 is null) return;
    var state = await view.CoreWebView2.ExecuteScriptAsync("""
      (() => {
        const canvas = document.querySelector('#scene');
        const context = canvas && canvas.getContext('webgl2');
        return JSON.stringify({
          pixels: canvas && [canvas.width, canvas.height],
          covered: !document.querySelector('#loading')?.hidden,
          webgl2: Boolean(context),
          gpu: context && context.getParameter(context.RENDERER),
          hidden: document.hidden,
          pointers: window.scenePointerCount,
        });
      })()
      """);
    Log.Write($"page state: {state}");
    await using var stream = File.Create(file);
    await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    Log.Write($"wrote {file}");
  }

  public void Dispose() {
    if (disposed) return;
    disposed = true;
    view.Dispose();
    form.Close();
    form.Dispose();
  }
}
