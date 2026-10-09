using System.Text.Json;

namespace Livingpanes;

/// A scene the app can show. Chase Lean's six handcrafted worlds each have their own
/// wallpaper.html; Studio scenes and examples all run in the Studio engine.
sealed record World(string Name, string Title, Color Background, string Page, bool Studio = false) {
  public static readonly World[] Handcrafted = [
    Builtin("riverscape", "Riverbed", Color.FromArgb(8, 14, 12)),
    Builtin("reefscape", "Coral reef", Color.FromArgb(11, 24, 37)),
    Builtin("bettascape", "Betta", Color.Black),
    Builtin("plasmascape", "Plasma globe", Color.Black),
    Builtin("koiscape", "Koi pond", Color.FromArgb(4, 6, 5)),
    Builtin("bonfirescape", "Bonfire", Color.Black),
  ];

  static World Builtin(string name, string title, Color background) =>
    new(name, title, background, $"/scenes/{name}/wallpaper.html");

  public static World Example(string name, string title) =>
    new($"example:{name}", title, Color.Black, $"/scenes/studio/wallpaper.html?example={name}", true);

  public static World Scene(string id, string title) =>
    new($"scene:{id}", title, Color.Black, $"/scenes/studio/wallpaper.html?scene={id}", true);

  /// Only worlds with something to eat have anything to feed; the bonfire is stirred.
  public bool CanFeed => Name != "plasmascape";
  public string FeedTitle => Name == "bonfirescape" ? "Stir the fire" : "Feed";

  /// Every world the app knows right now: handcrafted, then Studio examples, then the user's.
  public static List<World> All(string appRoot) {
    var worlds = new List<World>(Handcrafted);
    try {
      foreach (var scene in Store.List(appRoot))
        worlds.Add(scene.Example ? Example(scene.Id, scene.Name) : Scene(scene.Id, scene.Name));
    } catch (Exception error) {
      Log.Write($"scene list unreadable: {error.Message}");
    }
    return worlds;
  }

  public static World Named(string? name, string appRoot) =>
    All(appRoot).FirstOrDefault(w => w.Name == name) ?? Handcrafted[0];
}

/// A named creature that lives in every world. Fed by any feeding; sulks after a day without.
sealed class Pet {
  public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
  public string Name { get; set; } = "";
  public string Color { get; set; } = "#ff8a3d";
  public DateTime Born { get; set; } = DateTime.UtcNow;
  public DateTime LastFed { get; set; } = DateTime.UtcNow;
  public int Meals { get; set; }
}

/// The choices that outlive a restart. A missing Paused means nobody has chosen yet.
sealed class Settings {
  public string? World { get; set; }
  public bool? Paused { get; set; }
  public bool FollowClock { get; set; } = true;
  public bool Hotkeys { get; set; } = true;
  public string Model { get; set; } = Claude.DefaultModel;
  public List<Pet> Pets { get; set; } = [];

  static string FilePath => Path.Combine(Log.Folder, "settings.json");

  public static Settings Load() {
    try {
      return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings();
    } catch {
      return new Settings();
    }
  }

  public void Save() {
    try {
      File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
    } catch (Exception error) {
      Log.Write($"settings not saved: {error.Message}");
    }
  }
}

static class Log {
  public static readonly string Folder = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Livingpanes");

  static readonly object gate = new();

  public static void Write(string text) {
    try {
      lock (gate) {
        Directory.CreateDirectory(Folder);
        var file = Path.Combine(Folder, "livingpanes.log");
        // Two files of at most 2 MB each, so a chatty page can never fill the disk.
        if (File.Exists(file) && new FileInfo(file).Length > 2 * 1024 * 1024)
          File.Move(file, file + ".1", true);
        File.AppendAllText(file, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {text}{Environment.NewLine}");
      }
    } catch {
      // A log that cannot be written is not worth stopping the wallpaper for.
    }
  }
}
