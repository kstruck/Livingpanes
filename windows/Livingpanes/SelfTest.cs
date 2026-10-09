// Livingpanes.exe --selftest: loads a real page through ResourceServer in a hidden
// WebView2 and tries to get out. Prints one line per check and exits 0 only if every
// escape was blocked. CI runs it, because the protections live in the browser engine
// and only a real one can prove them.

using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Livingpanes;

static class SelfTest {
  const string Probe = """
    (async () => {
      const results = {};
      const violations = [];
      addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
      const settle = (ms) => new Promise((r) => setTimeout(r, ms));

      try { await fetch('https://example.com/'); results.fetchOut = 'REACHED'; } catch { results.fetchOut = 'blocked'; }
      results.webrtc = typeof RTCPeerConnection === 'undefined' && typeof webkitRTCPeerConnection === 'undefined' ? 'blocked' : 'AVAILABLE';
      const frame = document.createElement('iframe');
      document.body.append(frame);
      results.webrtcInFrame = typeof frame.contentWindow.RTCPeerConnection === 'undefined' ? 'blocked' : 'AVAILABLE';
      const image = new Image();
      const loaded = new Promise((r) => { image.onload = () => r('REACHED'); image.onerror = () => r('blocked'); });
      image.src = 'https://example.com/favicon.ico';
      results.imageOut = await Promise.race([loaded, settle(4000).then(() => 'blocked')]);
      try { new WebSocket('wss://example.com/'); await settle(500); results.socketOut = violations.includes('connect-src') ? 'blocked' : 'UNKNOWN'; }
      catch { results.socketOut = 'blocked'; }
      const page = await fetch(location.href);
      results.policyHeader = (page.headers.get('content-security-policy') || '').includes("default-src 'self'") ? 'present' : 'MISSING';
      const escape = await fetch('/user/..%2f..%2fsettings.json');
      results.traversal = escape.status === 404 ? 'blocked' : `STATUS ${escape.status}`;
      const exe = await fetch('/Livingpanes.dll');
      results.otherFiles = exe.status === 404 ? 'blocked' : `STATUS ${exe.status}`;

      // The Studio's preview: a sandboxed frame with an opaque origin must still load the
      // engine's own scripts, or the preview stays on "Loading world…".
      const preview = document.createElement('iframe');
      preview.setAttribute('sandbox', 'allow-scripts');
      const ready = new Promise((r) => addEventListener('message', (e) => {
        if (e.source === preview.contentWindow && e.data?.type === 'deskworlds:preview-ready') r('present');
      }));
      preview.src = '/scenes/studio/wallpaper.html?preview=1';
      document.body.append(preview);
      results.sandboxedPreviewLoads = await Promise.race([ready, settle(15000).then(() => 'MISSING (preview never became ready)')]);
      window.__selftest = JSON.stringify(results);
    })().catch((e) => { window.__selftest = JSON.stringify({ probe: "ERROR " + e }); });
    """;

  public static int Run(string root) {
    var exit = 1;
    using var form = new Form { ShowInTaskbar = false, Opacity = 0, Width = 640, Height = 480 };
    var view = new WebView2 { Dock = DockStyle.Fill };
    form.Controls.Add(view);
    form.Load += async (_, _) => {
      try {
        var environment = await CoreWebView2Environment.CreateAsync(null,
          Path.Combine(Path.GetTempPath(), "livingpanes-selftest"));
        await view.EnsureCoreWebView2Async(environment);
        await ResourceServer.InstallAsync(view.CoreWebView2, environment, root);
        var done = new TaskCompletionSource<bool>();
        view.CoreWebView2.NavigationCompleted += (_, e) => done.TrySetResult(e.IsSuccess);
        view.CoreWebView2.Navigate($"{ResourceServer.Origin}/scenes/studio/wallpaper.html?preview=1");
        if (!await done.Task) throw new InvalidOperationException("the test page did not load");
        // ExecuteScriptAsync does not wait for promises, so the probe leaves its answer on window.
        await view.CoreWebView2.ExecuteScriptAsync(Probe);
        string? text = null;
        for (var i = 0; i < 40 && text is null; i++) {
          await Task.Delay(250);
          text = JsonSerializer.Deserialize<string?>(await view.CoreWebView2.ExecuteScriptAsync("window.__selftest ?? null"));
        }
        text ??= "{\"probe\":\"TIMED OUT\"}";
        var results = JsonSerializer.Deserialize<Dictionary<string, string>>(text) ?? [];
        var ok = results.Count > 0;
        foreach (var (check, outcome) in results) {
          var pass = outcome is "blocked" or "present";
          ok &= pass;
          Console.WriteLine($"{(pass ? "PASS" : "FAIL")}  {check}: {outcome}");
        }
        exit = ok ? 0 : 1;
      } catch (Exception error) {
        Console.WriteLine($"FAIL  self-test could not run: {error.Message}");
      } finally {
        form.Close();
      }
    };
    Application.Run(form);
    return exit;
  }
}
