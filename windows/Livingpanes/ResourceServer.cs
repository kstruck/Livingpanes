// Serves every page from local files at https://deskworlds.local/, never the network.
//
// /user/<id>/...         saved scenes      %LOCALAPPDATA%\Livingpanes\scenes\<id>\
// /user/_drafts/<id>/... unsaved drafts    %LOCALAPPDATA%\Livingpanes\drafts\<id>\
// anything else          the app's scene folder (scenes, vendor, ui, studio)
//
// Each response carries a Content-Security-Policy that allows only this origin, so a
// page, including a scene whose code Claude wrote, cannot reach the internet.

using Microsoft.Web.WebView2.Core;

namespace Livingpanes;

sealed record Resolved(string File, string ContentType);

static class ResourceServer {
  public const string Origin = "https://" + Wallpaper.Host;

  public const string Policy =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; " +
    "worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

  static readonly Dictionary<string, string> types = new(StringComparer.OrdinalIgnoreCase) {
    [".html"] = "text/html; charset=utf-8",
    [".js"] = "text/javascript; charset=utf-8",
    [".mjs"] = "text/javascript; charset=utf-8",
    [".css"] = "text/css; charset=utf-8",
    [".json"] = "application/json; charset=utf-8",
    [".svg"] = "image/svg+xml",
    [".png"] = "image/png",
    [".jpg"] = "image/jpeg",
    [".jpeg"] = "image/jpeg",
    [".webp"] = "image/webp",
    [".gif"] = "image/gif",
    [".avif"] = "image/avif",
    [".bmp"] = "image/bmp",
    [".mp4"] = "video/mp4",
    [".webm"] = "video/webm",
    [".wasm"] = "application/wasm",
    [".txt"] = "text/plain; charset=utf-8",
    [".woff2"] = "font/woff2",
  };

  /// Maps a request URL to a file, or null when it is outside every root, missing, or
  /// of a type the app does not serve. Pure, so it can be tested.
  public static Resolved? Resolve(string url, string appRoot, string scenesRoot, string draftsRoot) {
    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return null;
    if (!string.Equals(uri.Scheme, "https", StringComparison.OrdinalIgnoreCase)
        || !string.Equals(uri.Host, Wallpaper.Host, StringComparison.OrdinalIgnoreCase)) return null;
    string path;
    try {
      path = Uri.UnescapeDataString(uri.AbsolutePath);
    } catch (UriFormatException) {
      return null;
    }
    if (path.Contains('\0') || path.Contains('\\') || path.Contains(':')) return null;
    if (path.EndsWith('/')) path += "index.html";
    var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length == 0 || parts.Any(p => p is "." or ".." || p.StartsWith('.'))) return null;

    string root;
    string[] rest;
    if (parts[0] == "user") {
      if (parts.Length >= 4 && parts[1] == "_drafts" && Store.IsId(parts[2])) {
        root = Path.Combine(draftsRoot, parts[2]);
        rest = parts[3..];
      } else if (parts.Length >= 3 && Store.IsId(parts[1])) {
        root = Path.Combine(scenesRoot, parts[1]);
        rest = parts[2..];
      } else {
        return null;
      }
    } else {
      root = appRoot;
      rest = parts;
    }
    var full = Path.GetFullPath(Path.Combine([root, .. rest]));
    var rootFull = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (!full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) return null;
    if (!types.TryGetValue(Path.GetExtension(full), out var type)) return null;
    return File.Exists(full) ? new Resolved(full, type) : null;
  }

  /// WebRTC can send UDP packets (STUN/TURN) that no Content-Security-Policy governs, so
  /// it is taken away in every frame before page code runs. Scenes never need it.
  public const string NoWebRtc = """
    (() => {
      const names = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription',
        'RTCIceCandidate', 'RTCRtpSender', 'RTCRtpReceiver', 'RTCRtpTransceiver', 'RTCDtlsTransport',
        'RTCIceTransport', 'RTCSctpTransport', 'RTCCertificate'];
      const strip = (w) => {
        for (const name of names) {
          try { Object.defineProperty(w, name, { value: undefined, writable: false, configurable: false }); } catch {}
        }
      };
      strip(window);
      // A frame a script creates without a URL gets no document-created script, so it is
      // stripped the moment its window is reached.
      for (const proto of [HTMLIFrameElement.prototype, HTMLFrameElement.prototype, HTMLObjectElement.prototype]) {
        for (const property of ['contentWindow', 'contentDocument']) {
          const original = Object.getOwnPropertyDescriptor(proto, property);
          if (!original?.get) continue;
          Object.defineProperty(proto, property, {
            configurable: false,
            get() {
              const value = original.get.call(this);
              const win = property === 'contentWindow' ? value : value?.defaultView;
              if (win) { try { strip(win); } catch {} }
              return value;
            },
          });
        }
      }
    })();
    """;

  public static async Task InstallAsync(CoreWebView2 core, CoreWebView2Environment environment, string appRoot) {
    await core.AddScriptToExecuteOnDocumentCreatedAsync(NoWebRtc);
    core.AddWebResourceRequestedFilter($"{Origin}/*", CoreWebView2WebResourceContext.All,
      CoreWebView2WebResourceRequestSourceKinds.All);
    core.WebResourceRequested += (_, e) => {
      var found = e.Request.Method is "GET" or "HEAD"
        ? Resolve(e.Request.Uri, appRoot, Store.ScenesRoot, Store.DraftsRoot) : null;
      if (found is null) {
        e.Response = environment.CreateWebResourceResponse(null, 404, "Not Found",
          $"Content-Security-Policy: {Policy}\r\nAccess-Control-Allow-Origin: null");
        return;
      }
      Stream stream;
      try {
        stream = new MemoryStream(File.ReadAllBytes(found.File));
      } catch (IOException) {
        e.Response = environment.CreateWebResourceResponse(null, 500, "Unreadable", "");
        return;
      }
      e.Response = environment.CreateWebResourceResponse(stream, 200, "OK",
        $"Content-Type: {found.ContentType}\r\n" +
        $"Content-Security-Policy: {Policy}\r\n" +
        // The Studio preview is a sandboxed frame with an opaque ("null") origin; its module
        // and image loads from this host need CORS to succeed. No other origin can ever
        // load a page here, since navigation never leaves deskworlds.local.
        "Access-Control-Allow-Origin: null\r\n" +
        "Cache-Control: no-cache\r\n" +
        "X-Content-Type-Options: nosniff");
    };
    // Nothing leaves deskworlds.local: no links, no redirects, no pop-ups.
    core.NavigationStarting += (_, e) => {
      if (!e.Uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) {
        Quiet($"blocked navigation to {Truncate(e.Uri)}");
        e.Cancel = true;
      }
    };
    core.FrameNavigationStarting += (_, e) => {
      if (!e.Uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase) && e.Uri != "about:blank"
          && e.Uri != "about:srcdoc") {
        Quiet($"blocked frame navigation to {Truncate(e.Uri)}");
        e.Cancel = true;
      }
    };
    core.NewWindowRequested += (_, e) => e.Handled = true;
    core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
    core.DownloadStarting += (_, e) => e.Cancel = true;
  }

  static DateTime quietWindow = DateTime.MinValue;
  static int quietCount;

  /// A page stuck in a redirect loop is logged a few times a minute, not thousands.
  static void Quiet(string text) {
    var now = DateTime.UtcNow;
    if (now - quietWindow > TimeSpan.FromMinutes(1)) { quietWindow = now; quietCount = 0; }
    if (++quietCount <= 10) Log.Write(text);
  }

  public static string Truncate(string? text, int length = 300) =>
    text is null ? "" : text.Length <= length ? text : text[..length] + "…";
}
