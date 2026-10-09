// The user's own scenes and drafts on disk, and the .deskworld files that share them.

using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Livingpanes;

sealed record SceneInfo(string Id, string Name, string Description, string Mode, string Base, bool Example,
  string? Image, string[]? Colors);

static partial class Store {
  public static string ScenesRoot => Path.Combine(Log.Folder, "scenes");
  public static string DraftsRoot => Path.Combine(Log.Folder, "drafts");

  public const int MaxRecipeBytes = 256 * 1024;
  public const int MaxCodeBytes = 512 * 1024;
  public const long MaxImageBytes = 200L * 1024 * 1024;
  public const long MaxSceneBytes = 450L * 1024 * 1024;

  /// The only files a scene folder may hold. Anything else in an import is refused.
  static readonly Regex allowedFile = AllowedFile();
  [GeneratedRegex(@"^(recipe\.json|scene\.js|depth\.png|image\.(jpg|jpeg|png|webp|avif|bmp))$", RegexOptions.IgnoreCase)]
  private static partial Regex AllowedFile();

  [GeneratedRegex(@"^[a-z0-9-]{1,64}$")]
  private static partial Regex IdPattern();
  public static bool IsId(string? id) => id is not null && IdPattern().IsMatch(id);

  static string NewId(string? name) {
    var slug = Regex.Replace((name ?? "").ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
    if (slug.Length > 40) slug = slug[..40].Trim('-');
    var tail = Guid.NewGuid().ToString("N")[..6];
    return slug.Length == 0 ? $"scene-{tail}" : $"{slug}-{tail}";
  }

  public static string SceneFolder(string id) =>
    IsId(id) ? Path.Combine(ScenesRoot, id) : throw new ArgumentException("bad scene id");
  public static string DraftFolder(string draft) =>
    IsId(draft) ? Path.Combine(DraftsRoot, draft) : throw new ArgumentException("bad draft id");

  public static string NewDraft() {
    var draft = "d" + Guid.NewGuid().ToString("N")[..12];
    Directory.CreateDirectory(DraftFolder(draft));
    return draft;
  }

  /// Drafts nobody saved are cleared after a week.
  public static void SweepDrafts() {
    try {
      if (!Directory.Exists(DraftsRoot)) return;
      foreach (var folder in Directory.GetDirectories(DraftsRoot))
        if (Directory.GetLastWriteTimeUtc(folder) < DateTime.UtcNow.AddDays(-7))
          Directory.Delete(folder, true);
    } catch (Exception error) {
      Log.Write($"draft sweep: {error.Message}");
    }
  }

  /// Checks a recipe from a page: valid JSON object, small, and naming only files that
  /// exist. The engine clamps every value itself; this only guards the disk.
  public static JsonObject CheckRecipe(string json, string folder) {
    if (json.Length > MaxRecipeBytes) throw new InvalidDataException("The recipe is too large.");
    if (JsonNode.Parse(json) is not JsonObject recipe) throw new InvalidDataException("The recipe is not an object.");
    if (recipe["backdrop"] is JsonObject backdrop) {
      foreach (var key in new[] { "image", "depth" }) {
        var file = backdrop[key]?.GetValue<string>();
        if (file is null) continue;
        if (!allowedFile.IsMatch(file) || !File.Exists(Path.Combine(folder, file)))
          backdrop.Remove(key);
      }
    }
    if (recipe["mode"]?.GetValue<string>() == "code" && !File.Exists(Path.Combine(folder, "scene.js")))
      recipe["mode"] = "recipe";
    return recipe;
  }

  public static void SaveDraftRecipe(string draft, string json) {
    var folder = DraftFolder(draft);
    if (!Directory.Exists(folder)) throw new DirectoryNotFoundException("That draft no longer exists.");
    var recipe = CheckRecipe(json, folder);
    File.WriteAllText(Path.Combine(folder, "recipe.json"), recipe.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
  }

  public static void WriteDraftCode(string draft, string code) {
    if (code.Length > MaxCodeBytes) throw new InvalidDataException("The code is too large.");
    File.WriteAllText(Path.Combine(DraftFolder(draft), "scene.js"), code);
  }

  /// Copies a draft into the saved scenes. Editing a saved scene writes it back in place.
  public static string SaveScene(string draft) {
    var source = DraftFolder(draft);
    var recipeFile = Path.Combine(source, "recipe.json");
    if (!File.Exists(recipeFile)) throw new FileNotFoundException("Save the draft first.");
    var recipe = JsonNode.Parse(File.ReadAllText(recipeFile)) as JsonObject;
    var marker = Path.Combine(source, ".scene");
    var id = File.Exists(marker) ? File.ReadAllText(marker).Trim() : NewId(recipe?["name"]?.GetValue<string>());
    if (!IsId(id)) id = NewId(null);
    var target = SceneFolder(id);
    var staging = target + ".saving";
    if (Directory.Exists(staging)) Directory.Delete(staging, true);
    Directory.CreateDirectory(staging);
    foreach (var file in Directory.GetFiles(source))
      if (allowedFile.IsMatch(Path.GetFileName(file)))
        File.Copy(file, Path.Combine(staging, Path.GetFileName(file)));
    if (Directory.Exists(target)) Directory.Delete(target, true);
    Directory.Move(staging, target);
    File.WriteAllText(marker, id);
    return id;
  }

  public static string EditScene(string id) {
    var source = SceneFolder(id);
    if (!Directory.Exists(source)) throw new DirectoryNotFoundException("That scene no longer exists.");
    var draft = NewDraft();
    foreach (var file in Directory.GetFiles(source))
      File.Copy(file, Path.Combine(DraftFolder(draft), Path.GetFileName(file)));
    File.WriteAllText(Path.Combine(DraftFolder(draft), ".scene"), id);
    return draft;
  }

  public static void DeleteScene(string id) {
    var folder = SceneFolder(id);
    if (Directory.Exists(folder)) Directory.Delete(folder, true);
  }

  /// A draft copy of a shipped example, saved later as the user's own scene.
  public static string RemixExample(string appRoot, string name) {
    if (!IsId(name)) throw new ArgumentException("bad example name");
    var source = Path.Combine(appRoot, "scenes", "studio", "examples", name);
    if (!File.Exists(Path.Combine(source, "recipe.json"))) throw new FileNotFoundException("That example does not exist.");
    var draft = NewDraft();
    foreach (var file in Directory.GetFiles(source))
      if (allowedFile.IsMatch(Path.GetFileName(file)))
        File.Copy(file, Path.Combine(DraftFolder(draft), Path.GetFileName(file)));
    return draft;
  }

  public static string? ReadRecipe(string folder) {
    var file = Path.Combine(folder, "recipe.json");
    return File.Exists(file) ? File.ReadAllText(file) : null;
  }

  public static List<SceneInfo> List(string appRoot) {
    var scenes = new List<SceneInfo>();
    if (Directory.Exists(ScenesRoot))
      foreach (var folder in Directory.GetDirectories(ScenesRoot).OrderBy(Directory.GetCreationTimeUtc)) {
        var id = Path.GetFileName(folder);
        if (!IsId(id)) continue;
        var info = Describe(id, ReadRecipe(folder), $"/user/{id}/", false);
        if (info is not null) scenes.Add(info);
      }
    var index = Path.Combine(appRoot, "scenes", "studio", "examples", "index.json");
    if (File.Exists(index)) {
      try {
        foreach (var entry in JsonNode.Parse(File.ReadAllText(index))?.AsArray() ?? []) {
          var name = entry?["name"]?.GetValue<string>();
          if (!IsId(name)) continue;
          var folder = Path.Combine(appRoot, "scenes", "studio", "examples", name!);
          var info = Describe(name!, ReadRecipe(folder), $"/scenes/studio/examples/{name}/", true);
          if (info is not null) scenes.Add(info);
        }
      } catch (Exception error) {
        Log.Write($"examples index unreadable: {error.Message}");
      }
    }
    return scenes;
  }

  static SceneInfo? Describe(string id, string? json, string baseUrl, bool example) {
    if (json is null) return null;
    try {
      var recipe = JsonNode.Parse(json) as JsonObject;
      var backdrop = recipe?["backdrop"] as JsonObject;
      var image = backdrop?["image"]?.GetValue<string>();
      var colors = (backdrop?["colors"] as JsonArray)?.Select(c => c?.GetValue<string>() ?? "").ToArray();
      return new SceneInfo(id, recipe?["name"]?.GetValue<string>() ?? id,
        recipe?["description"]?.GetValue<string>() ?? "", recipe?["mode"]?.GetValue<string>() ?? "recipe",
        baseUrl, example, image is null ? null : baseUrl + image, colors);
    } catch {
      return null;
    }
  }

  /// A .deskworld file is a zip of one scene folder.
  public static void Export(string id, string file) {
    var folder = SceneFolder(id);
    if (File.Exists(file)) File.Delete(file);
    using var zip = ZipFile.Open(file, ZipArchiveMode.Create);
    foreach (var path in Directory.GetFiles(folder))
      if (allowedFile.IsMatch(Path.GetFileName(path)))
        zip.CreateEntryFromFile(path, Path.GetFileName(path), CompressionLevel.Optimal);
  }

  /// Unpacks a .deskworld from anyone, so nothing in it is trusted: flat names only,
  /// known files only, sizes capped while reading (not from the header), JSON checked.
  public static string Import(string file) {
    using var zip = ZipFile.OpenRead(file);
    if (zip.Entries.Count is 0 or > 16) throw new InvalidDataException("That is not a Livingpanes scene.");
    var id = NewId(null);
    var staging = SceneFolder(id) + ".importing";
    Directory.CreateDirectory(staging);
    try {
      long total = 0;
      foreach (var entry in zip.Entries) {
        var name = entry.FullName;
        if (name != Path.GetFileName(name) || !allowedFile.IsMatch(name))
          throw new InvalidDataException($"The scene holds a file it should not: {ResourceServer.Truncate(name, 60)}");
        var limit = name == "recipe.json" ? MaxRecipeBytes : name == "scene.js" ? MaxCodeBytes : MaxImageBytes;
        using var input = entry.Open();
        using var output = File.Create(Path.Combine(staging, name));
        var buffer = new byte[81920];
        long written = 0;
        int read;
        while ((read = input.Read(buffer)) > 0) {
          written += read;
          total += read;
          if (written > limit || total > MaxSceneBytes) throw new InvalidDataException("The scene is too large.");
          output.Write(buffer, 0, read);
        }
      }
      var recipeFile = Path.Combine(staging, "recipe.json");
      if (!File.Exists(recipeFile)) throw new InvalidDataException("The scene has no recipe.");
      var recipe = CheckRecipe(File.ReadAllText(recipeFile), staging);
      // Imported code never runs until its new owner has read it in the Studio.
      if (recipe["mode"]?.GetValue<string>() == "code") {
        recipe["mode"] = "recipe";
        recipe["importedCode"] = true;
      }
      File.WriteAllText(recipeFile, recipe.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
      Directory.Move(staging, SceneFolder(id));
      return id;
    } catch {
      Directory.Delete(staging, true);
      throw;
    }
  }
}
