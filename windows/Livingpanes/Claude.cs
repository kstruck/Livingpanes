// Turns a sentence into a scene recipe with Claude, using the user's own API key.
//
// The recipe schema (scenes/studio/recipe.schema.json) is the tool's input schema, so
// the answer arrives as structured JSON. The engine still clamps every value itself.

using System.Drawing.Imaging;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Anthropic;
using Anthropic.Models.Messages;

namespace Livingpanes;

sealed record Generated(string Recipe, string? Code);

static class Claude {
  public const string DefaultModel = "claude-opus-5-5";
  public static readonly string[] Models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

  static string KeyFile => Path.Combine(Log.Folder, "apikey.bin");
  static readonly byte[] entropy = Encoding.UTF8.GetBytes("Livingpanes API key v1");

  // The key is encrypted for the current Windows user (DPAPI) and never sent to a page.
  public static bool HasKey => File.Exists(KeyFile);

  public static void SetKey(string? key) {
    key = key?.Trim();
    if (string.IsNullOrEmpty(key)) {
      if (File.Exists(KeyFile)) File.Delete(KeyFile);
      return;
    }
    if (key.Length > 400 || key.Any(char.IsWhiteSpace)) throw new ArgumentException("That does not look like an API key.");
    Directory.CreateDirectory(Log.Folder);
    File.WriteAllBytes(KeyFile, ProtectedData.Protect(Encoding.UTF8.GetBytes(key), entropy, DataProtectionScope.CurrentUser));
  }

  static string ReadKey() {
    if (!HasKey) throw new InvalidOperationException("Add your Anthropic API key in Studio settings first.");
    return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(KeyFile), entropy, DataProtectionScope.CurrentUser));
  }

  const string Guide = """
    You design living desktop wallpapers for Livingpanes, a Windows app built on Chase Lean's
    Deskworlds. A scene is a recipe that a WebGL engine draws full screen behind the user's
    desktop icons, at up to 5K resolution, for hours at a time. Make scenes calm, beautiful
    and coherent rather than busy: a wallpaper must not distract from work.

    Call the make_scene tool exactly once with the complete recipe. Guidance:
    - medium: "water" for anything under water (fish, jellyfish, koi); "air" for skies,
      meadows, forests (birds, butterflies, fireflies).
    - backdrop: without an image, use kind "gradient" with 2-5 colors, top to bottom, that
      read as a place (deep water, sky at dusk, misty forest). Keep it dark enough at the
      top that desktop icons stay readable.
    - effects: values 0..1. Most scenes want 2-4 effects between 0.2 and 0.6, not all of them.
    - particles: up to 4 layers. creatures: up to 5 groups, 3-40 creatures in total for
      most scenes. Pick colors that harmonize with the backdrop. zone keeps a group in a
      vertical band ([0.1, 0.6] keeps birds in the sky).
    - food: what the user drops when they feed the scene. Pick one the creatures would eat.
    - light.followClock: true unless the user asks for a fixed time of day.
    - name: 2-4 words. description: one sentence.
    """;

  const string ImageGuide = """
    The user supplied the attached photo as the backdrop. Keep backdrop.kind "image"; the
    app fills in the file names. Set backdrop.focus to the most important point of the
    photo, choose a medium that fits what it shows, and pick creatures, particles, effects
    and colors that belong in it. Use backdrop.parallax around 0.4.
    """;

  const string CodeGuide = """
    The user also allowed a code scene. Besides the recipe (which is the fallback), you may
    put a complete ES module in "code" when the request needs something the recipe cannot
    express. The module runs in a page with no network access and default-exports
    create(ctx). ctx = { THREE (three.js r170+ module), canvas, renderer (a ready
    THREE.WebGLRenderer), size() -> {width, height, pixelRatio}, pointer {x, y, inside} in
    CSS pixels, night() -> 0..1, recipe, onFrame(fn(dt, t)), onResize(fn(w, h)),
    onFeed(fn(x, y)), onTap(fn(x, y)), onPets(fn(pets)) }. Do not start your own
    requestAnimationFrame loop, import anything, or touch the network or storage. Draw
    every frame in onFrame with renderer.render(scene, camera). Keep it under 400 lines.
    """;

  public static async Task<Generated> GenerateAsync(string prompt, string model, bool allowCode,
      string? imageFile, CancellationToken cancel) {
    prompt = prompt.Trim();
    if (prompt.Length == 0 && imageFile is null) throw new ArgumentException("Describe the scene you want.");
    if (prompt.Length > 2000) throw new ArgumentException("Keep the description under 2000 characters.");
    if (!Models.Contains(model)) model = DefaultModel;

    var schema = LoadSchema();
    var properties = new Dictionary<string, JsonElement>();
    foreach (var (key, value) in schema["properties"]!.AsObject()) {
      if (key is "version" or "mode") continue;
      properties[key] = JsonSerializer.SerializeToElement(value);
    }
    if (allowCode)
      properties["code"] = JsonSerializer.SerializeToElement(new {
        type = "string",
        description = "Optional ES module source for a code scene. Leave out unless the recipe cannot express the request.",
      });

    List<ContentBlockParam> content = [];
    if (imageFile is not null)
      content.Add(new ImageBlockParam {
        Source = new Base64ImageSource { Data = DownscaledJpeg(imageFile), MediaType = MediaType.ImageJpeg },
      });
    content.Add(new TextBlockParam {
      Text = prompt.Length > 0 ? prompt : "Make a living scene around this photo.",
    });

    var system = Guide + (imageFile is null ? "" : "\n" + ImageGuide) + (allowCode ? "\n" + CodeGuide : "");
    var client = new AnthropicClient { ApiKey = ReadKey() };
    var parameters = new MessageCreateParams {
      Model = model,
      MaxTokens = allowCode ? 32000 : 8000,
      System = system,
      Tools = [
        new Tool {
          Name = "make_scene",
          Description = "Create the living wallpaper scene. Call exactly once with the full recipe.",
          InputSchema = new() {
            Properties = properties,
            Required = ["name", "description", "medium", "backdrop", "effects", "particles", "creatures", "food", "light"],
          },
        },
      ],
      Messages = [new() { Role = Role.User, Content = content }],
    };
    Anthropic.Models.Messages.Message response = await client.Messages.Create(parameters, cancel);

    if (response.StopReason == StopReason.Refusal)
      throw new InvalidOperationException("Claude declined to make that scene. Try describing it differently.");
    foreach (var block in response.Content) {
      if (!block.TryPickToolUse(out ToolUseBlock? use) || use.Name != "make_scene") continue;
      var input = JsonNode.Parse(JsonSerializer.Serialize(use.Input))!.AsObject();
      string? code = null;
      if (input["code"] is JsonValue codeValue && codeValue.TryGetValue(out string? text) && !string.IsNullOrWhiteSpace(text))
        code = text;
      input.Remove("code");
      input["version"] = 1;
      input["mode"] = "recipe";
      return new Generated(input.ToJsonString(), code);
    }
    if (response.StopReason == StopReason.MaxTokens)
      throw new InvalidOperationException("Claude ran out of room before finishing. Try a simpler description.");
    throw new InvalidOperationException("Claude answered without a scene. Try again.");
  }

  static JsonObject LoadSchema() {
    var file = Path.Combine(Program.Root ?? AppContext.BaseDirectory, "scenes", "studio", "recipe.schema.json");
    return JsonNode.Parse(File.ReadAllText(file))!.AsObject();
  }

  /// Claude sees images up to about 1568 pixels on the long edge; larger costs more and adds nothing.
  static string DownscaledJpeg(string file) {
    using var source = Image.FromFile(file);
    var scale = Math.Min(1.0, 1568.0 / Math.Max(source.Width, source.Height));
    var width = Math.Max(1, (int)(source.Width * scale));
    var height = Math.Max(1, (int)(source.Height * scale));
    using var bitmap = new Bitmap(width, height);
    using (var g = Graphics.FromImage(bitmap)) {
      g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
      g.DrawImage(source, 0, 0, width, height);
    }
    using var stream = new MemoryStream();
    var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
    using var settings = new EncoderParameters(1);
    settings.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
    bitmap.Save(stream, codec, settings);
    return Convert.ToBase64String(stream.ToArray());
  }
}
