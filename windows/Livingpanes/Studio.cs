// The Studio window: where people make scenes from a photo or from words. The page is
// studio/index.html; everything it can ask for is the table in ARCHITECTURE.md, and the
// host answers only its own top frame.

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Livingpanes;

sealed class StudioForm : Form {
  readonly Controller controller;
  readonly string root;
  readonly WebView2 view = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(14, 16, 18) };
  readonly CancellationTokenSource closing = new();

  public StudioForm(Controller controller, CoreWebView2Environment environment, string root) {
    this.controller = controller;
    this.root = root;
    Text = "Livingpanes Studio";
    Icon = TrayIcon.Draw();
    StartPosition = FormStartPosition.CenterScreen;
    var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1600, 1000);
    Size = new Size(Math.Min(1500, area.Width - 80), Math.Min(960, area.Height - 80));
    MinimumSize = new Size(960, 640);
    BackColor = Color.FromArgb(14, 16, 18);
    Controls.Add(view);
    _ = StartAsync(environment);
  }

  async Task StartAsync(CoreWebView2Environment environment) {
    try {
      await view.EnsureCoreWebView2Async(environment);
      var core = view.CoreWebView2;
      core.Settings.AreDevToolsEnabled = false;
      core.Settings.IsStatusBarEnabled = false;
      core.Settings.AreDefaultContextMenusEnabled = true;
      // No folder mapping: it would bypass ResourceServer and its policy (see Wallpaper.cs).
      await ResourceServer.InstallAsync(core, environment, root);
      // The Studio window only ever shows the Studio. Its top frame is the one page that
      // may spend API credit and write files, so it must not be navigated elsewhere.
      core.NavigationStarting += (_, e) => {
        if (!e.Uri.StartsWith($"{ResourceServer.Origin}/studio/", StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
      };
      // Only top-frame messages arrive here; frame messages need CoreWebView2Frame handlers,
      // which this app never adds, so the preview frame cannot reach HandleAsync.
      core.WebMessageReceived += OnMessage;
      core.Navigate($"{ResourceServer.Origin}/studio/index.html");
    } catch (Exception error) {
      Log.Write($"Studio did not start: {error}");
      MessageBox.Show(this, "The Studio could not start. See the log for details.", "Livingpanes");
    }
  }

  protected override void OnFormClosed(FormClosedEventArgs e) {
    closing.Cancel();
    view.Dispose();
    base.OnFormClosed(e);
  }

  async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e) {
    if (!e.Source.StartsWith($"{ResourceServer.Origin}/studio/", StringComparison.OrdinalIgnoreCase)) {
      Log.Write($"Studio ignored a message from {ResourceServer.Truncate(e.Source)}");
      return;
    }
    JsonObject request;
    string? id;
    string kind;
    try {
      request = JsonNode.Parse(e.WebMessageAsJson)!.AsObject();
      id = request["id"]?.ToString();
      kind = request["kind"] is JsonValue value && value.TryGetValue(out string? text) ? text : "";
    } catch {
      return;
    }
    try {
      var result = await HandleAsync(kind, request, id);
      Reply(new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = result });
    } catch (OperationCanceledException) {
      // The window closed; nobody is listening.
    } catch (Exception error) {
      Log.Write($"Studio {kind} failed: {error.Message}");
      Reply(new JsonObject { ["id"] = id, ["ok"] = false, ["error"] = Friendly(error) });
    }
  }

  static string Friendly(Exception error) => error switch {
    Anthropic.Exceptions.AnthropicApiException api when api.Message.Contains("anthropic-workspace-id") =>
      "This API key is not tied to a workspace. In Settings, paste your workspace ID (console.anthropic.com, Settings, Workspaces), or make a new key inside a workspace.",
    Anthropic.Exceptions.AnthropicApiException api when api.Message.Contains("401") || api.Message.Contains("authentication") =>
      "Anthropic did not accept the API key. Check it in Settings.",
    Anthropic.Exceptions.AnthropicRateLimitException => "Anthropic is rate limiting this key. Wait a minute and try again.",
    HttpRequestException => "Could not reach the internet. Check the connection and try again.",
    _ => ResourceServer.Truncate(error.Message, 400),
  };

  void Reply(JsonObject message) {
    if (IsDisposed || view.CoreWebView2 is null) return;
    view.CoreWebView2.PostWebMessageAsJson(message.ToJsonString());
  }

  void Progress(string? id, string text, double fraction) {
    if (InvokeRequired) {
      BeginInvoke(() => Progress(id, text, fraction));
      return;
    }
    Reply(new JsonObject { ["id"] = id, ["kind"] = "progress", ["text"] = text, ["fraction"] = fraction });
  }

  static string Arg(JsonObject request, string name) =>
    request[name]?.GetValue<string>() ?? throw new ArgumentException($"Missing {name}.");

  static string DraftBase(string draft) => $"/user/_drafts/{draft}/";

  static string? DraftImage(string draft) =>
    Directory.GetFiles(Store.DraftFolder(draft), "image.*").FirstOrDefault();

  async Task<JsonNode?> HandleAsync(string kind, JsonObject request, string? id) {
    switch (kind) {
      case "listScenes":
        return JsonSerializer.SerializeToNode(Store.List(root), camel);

      case "newDraft": {
        var draft = Store.NewDraft();
        return new JsonObject { ["draft"] = draft, ["base"] = DraftBase(draft) };
      }

      case "pickImage": {
        var draft = Arg(request, "draft");
        using var dialog = new OpenFileDialog {
          Title = "Choose a photo for your scene",
          Filter = "Images (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp",
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return null;
        var info = new FileInfo(dialog.FileName);
        if (info.Length > Store.MaxImageBytes) throw new InvalidDataException("That image is larger than 200 MB.");
        var (width, height) = Store.CheckImage(info.FullName);
        var folder = Store.DraftFolder(draft);
        foreach (var old in Directory.GetFiles(folder, "image.*").Concat(Directory.GetFiles(folder, "depth.png"))) {
          File.SetAttributes(old, FileAttributes.Normal);
          File.Delete(old);
        }
        var name = "image" + info.Extension.ToLowerInvariant();
        // The original file, byte for byte: the engine shows it at full quality.
        Store.CopyPlain(info.FullName, Path.Combine(folder, name));
        return new JsonObject {
          ["url"] = DraftBase(draft) + name, ["file"] = name, ["width"] = width, ["height"] = height,
          ["name"] = Path.GetFileNameWithoutExtension(info.Name),
        };
      }

      case "makeDepth": {
        var draft = Arg(request, "draft");
        var image = DraftImage(draft) ?? throw new FileNotFoundException("Choose a photo first.");
        await Depth.MakeAsync(image, (text, fraction) => Progress(id, text, fraction), closing.Token);
        return new JsonObject { ["url"] = DraftBase(draft) + "depth.png", ["file"] = "depth.png" };
      }

      case "generate": {
        var draft = Arg(request, "draft");
        var prompt = request["prompt"]?.GetValue<string>() ?? "";
        var allowCode = request["allowCode"]?.GetValue<bool>() == true;
        var image = DraftImage(draft);
        Progress(id, "Asking Claude for a scene", 0.1);
        var made = await Claude.GenerateAsync(prompt, controller.Model, allowCode, image, controller.Workspace, closing.Token);
        var recipe = JsonNode.Parse(made.Recipe)!.AsObject();
        if (image is not null) {
          var backdrop = recipe["backdrop"] as JsonObject ?? [];
          backdrop["kind"] = "image";
          backdrop["image"] = Path.GetFileName(image);
          if (File.Exists(Path.Combine(Store.DraftFolder(draft), "depth.png"))) backdrop["depth"] = "depth.png";
          recipe["backdrop"] = backdrop;
        }
        if (made.Code is not null) Store.WriteDraftCode(draft, made.Code);
        Store.SaveDraftRecipe(draft, recipe.ToJsonString());
        var saved = JsonNode.Parse(Store.ReadRecipe(Store.DraftFolder(draft))!);
        return new JsonObject { ["recipe"] = saved, ["code"] = made.Code };
      }

      case "saveDraft": {
        var draft = Arg(request, "draft");
        var recipe = request["recipe"] ?? throw new ArgumentException("Missing recipe.");
        Store.SaveDraftRecipe(draft, recipe.ToJsonString());
        return new JsonObject { ["base"] = DraftBase(draft) };
      }

      case "saveScene": {
        var sceneId = Store.SaveScene(Arg(request, "draft"));
        controller.ScenesChanged();
        return new JsonObject { ["id"] = sceneId };
      }

      case "editScene": {
        var draft = request["example"]?.GetValue<string>() is { } example
          ? Store.RemixExample(root, example) : Store.EditScene(Arg(request, "id"));
        var folder = Store.DraftFolder(draft);
        return new JsonObject {
          ["draft"] = draft, ["base"] = DraftBase(draft),
          ["recipe"] = JsonNode.Parse(Store.ReadRecipe(folder) ?? "{}"),
          ["code"] = Store.ReadCode(folder),
        };
      }

      case "deleteScene": {
        var sceneId = Arg(request, "id");
        if (MessageBox.Show(this, "Delete this scene? This cannot be undone.", "Livingpanes Studio",
              MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return false;
        Store.DeleteScene(sceneId);
        controller.ScenesChanged();
        return true;
      }

      case "useScene": {
        var name = request["example"]?.GetValue<string>() is { } example ? $"example:{example}" : $"scene:{Arg(request, "id")}";
        controller.SelectWorld(name);
        return true;
      }

      case "exportScene": {
        var sceneId = Arg(request, "id");
        using var dialog = new SaveFileDialog {
          Title = "Share this scene", Filter = "Livingpanes scene (*.livingpane)|*.livingpane",
          FileName = sceneId + ".livingpane",
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return null;
        Store.Export(sceneId, dialog.FileName);
        return new JsonObject { ["file"] = dialog.FileName };
      }

      case "importScene": {
        using var dialog = new OpenFileDialog {
          Title = "Add a scene someone shared", Filter = "Livingpanes scene (*.livingpane)|*.livingpane",
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return null;
        var sceneId = Store.Import(dialog.FileName);
        controller.ScenesChanged();
        return new JsonObject { ["id"] = sceneId };
      }

      case "getSettings":
        return new JsonObject {
          ["hasApiKey"] = Claude.HasKey, ["model"] = controller.Model,
          ["models"] = new JsonArray(Claude.Models.Select(m => (JsonNode)m).ToArray()),
          ["workspaceId"] = controller.Workspace ?? "",
        };

      case "setApiKey":
        Claude.SetKey(request["key"]?.GetValue<string>());
        return true;

      case "setWorkspace":
        controller.Workspace = request["id"]?.GetValue<string>();
        return true;

      case "setModel":
        controller.Model = Arg(request, "model");
        return true;

      default:
        throw new ArgumentException($"Unknown request {ResourceServer.Truncate(kind, 40)}.");
    }
  }

  static readonly JsonSerializerOptions camel = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
}
