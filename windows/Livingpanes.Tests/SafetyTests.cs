// The parts that keep pages and shared scene files from reaching anything they should not.

using System.IO.Compression;
using System.Text.Json.Nodes;
using Livingpanes;
using Xunit;

public sealed class ResolveTests : IDisposable {
  readonly string temp = Directory.CreateTempSubdirectory("livingpanes-tests-").FullName;
  readonly string app, scenes, drafts;

  public ResolveTests() {
    app = Path.Combine(temp, "app");
    scenes = Path.Combine(temp, "scenes");
    drafts = Path.Combine(temp, "drafts");
    Write(app, "scenes/riverscape/wallpaper.html", "<html>");
    Write(app, "vendor/three.module.js", "export {}");
    Write(app, "studio/index.html", "<html>");
    Write(scenes, "lagoon-ab12cd/recipe.json", "{}");
    Write(scenes, "lagoon-ab12cd/image.jpg", "jpg");
    Write(drafts, "d0123456789ab/recipe.json", "{}");
    Write(temp, "secret.txt", "do not serve");
    Write(app, "notes.exe", "binary");
  }

  static void Write(string root, string relative, string text) {
    var file = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
    Directory.CreateDirectory(Path.GetDirectoryName(file)!);
    File.WriteAllText(file, text);
  }

  Resolved? Get(string url) => ResourceServer.Resolve(url, app, scenes, drafts);

  [Fact]
  public void ServesAppFiles() {
    Assert.EndsWith("wallpaper.html", Get("https://deskworlds.local/scenes/riverscape/wallpaper.html?quality=native")!.File);
    Assert.StartsWith("text/javascript", Get("https://deskworlds.local/vendor/three.module.js")!.ContentType);
    Assert.EndsWith("index.html", Get("https://deskworlds.local/studio/")!.File);
  }

  [Fact]
  public void ServesSavedScenesAndDrafts() {
    Assert.StartsWith(scenes, Get("https://deskworlds.local/user/lagoon-ab12cd/image.jpg")!.File);
    Assert.StartsWith(drafts, Get("https://deskworlds.local/user/_drafts/d0123456789ab/recipe.json")!.File);
  }

  [Theory]
  [InlineData("https://deskworlds.local/../secret.txt")]
  [InlineData("https://deskworlds.local/%2e%2e/secret.txt")]
  [InlineData("https://deskworlds.local/scenes/%2e%2e/%2e%2e/secret.txt")]
  [InlineData("https://deskworlds.local/user/lagoon-ab12cd/..%2f..%2fsecret.txt")]
  [InlineData("https://deskworlds.local/user/..%5c..%5csecret.txt")]
  [InlineData("https://deskworlds.local/user/LAGOON/recipe.json")]
  [InlineData("https://deskworlds.local/user/_drafts/../secret.txt")]
  [InlineData("https://deskworlds.local/user/_drafts/x/recipe.json/../../../secret.txt")]
  [InlineData("https://deskworlds.local/C:/Windows/win.ini")]
  [InlineData("https://deskworlds.local/notes.exe")]
  [InlineData("https://deskworlds.local/.git/config")]
  [InlineData("https://example.com/scenes/riverscape/wallpaper.html")]
  [InlineData("http://deskworlds.local/scenes/riverscape/wallpaper.html")]
  [InlineData("file:///C:/Windows/win.ini")]
  [InlineData("not a url")]
  public void RefusesEverythingElse(string url) => Assert.Null(Get(url));

  public void Dispose() => Directory.Delete(temp, true);
}

public sealed class StoreTests {
  [Theory]
  [InlineData("lagoon-ab12cd", true)]
  [InlineData("d0123456789ab", true)]
  [InlineData("", false)]
  [InlineData("Lagoon", false)]
  [InlineData("../x", false)]
  [InlineData("a/b", false)]
  [InlineData("con.txt", false)]
  public void Ids(string id, bool ok) => Assert.Equal(ok, Store.IsId(id));

  [Fact]
  public void IdLengthIsCapped() => Assert.False(Store.IsId(new string('a', 65)));

  [Fact]
  public void CheckRecipeDropsFilesThatAreNotThere() {
    var folder = Directory.CreateTempSubdirectory("livingpanes-recipe-").FullName;
    try {
      File.WriteAllText(Path.Combine(folder, "image.jpg"), "x");
      var recipe = Store.CheckRecipe("""
        { "mode": "code", "backdrop": { "kind": "image", "image": "image.jpg", "depth": "../../secret.png" } }
        """, folder);
      Assert.Equal("image.jpg", recipe["backdrop"]!["image"]!.GetValue<string>());
      Assert.Null(recipe["backdrop"]!["depth"]);
      Assert.Equal("recipe", recipe["mode"]!.GetValue<string>());
    } finally {
      Directory.Delete(folder, true);
    }
  }

  [Theory]
  [InlineData("[]")]
  [InlineData("\"text\"")]
  [InlineData("{")]
  public void CheckRecipeRefusesNonObjects(string json) =>
    Assert.ThrowsAny<Exception>(() => Store.CheckRecipe(json, Path.GetTempPath()));

  [Fact]
  public void CheckRecipeRefusesHugeRecipes() =>
    Assert.Throws<InvalidDataException>(() => Store.CheckRecipe("{\"name\":\"" + new string('a', Store.MaxRecipeBytes) + "\"}", Path.GetTempPath()));

  static string Zip(params (string name, string text)[] entries) {
    var file = Path.Combine(Path.GetTempPath(), $"livingpanes-{Guid.NewGuid():N}.livingpane");
    using var zip = ZipFile.Open(file, ZipArchiveMode.Create);
    foreach (var (name, text) in entries) {
      using var writer = new StreamWriter(zip.CreateEntry(name).Open());
      writer.Write(text);
    }
    return file;
  }

  [Theory]
  [InlineData("../evil.js")]
  [InlineData("..\\evil.js")]
  [InlineData("sub/recipe.json")]
  [InlineData("evil.exe")]
  [InlineData("C:/Windows/evil.js")]
  public void ImportRefusesUnexpectedFiles(string name) {
    var file = Zip(("recipe.json", "{}"), (name, "x"));
    try {
      Assert.Throws<InvalidDataException>(() => Store.Import(file));
    } finally {
      File.Delete(file);
    }
  }

  [Fact]
  public void ImportNeverTurnsCodeOn() {
    var file = Zip(("recipe.json", """{ "name": "Shared", "mode": "code" }"""), ("scene.js", "export default () => {}"));
    string? id = null;
    try {
      id = Store.Import(file);
      var recipe = JsonNode.Parse(File.ReadAllText(Path.Combine(Store.SceneFolder(id), "recipe.json")))!;
      Assert.Equal("recipe", recipe["mode"]!.GetValue<string>());
      Assert.True(recipe["importedCode"]!.GetValue<bool>());
    } finally {
      File.Delete(file);
      if (id is not null) Store.DeleteScene(id);
    }
  }

  [Fact]
  public void ImportRefusesAZipWithoutARecipe() {
    var file = Zip(("image.jpg", "x"));
    try {
      Assert.Throws<InvalidDataException>(() => Store.Import(file));
    } finally {
      File.Delete(file);
    }
  }
}
