using System.Text.Json;

namespace Deskworlds;

/// The scenes the app can show, each a directory under scenes/ with a wallpaper.html.
sealed record World(string Name, string Title, Color Background) {
  public static readonly World[] All = [
    new("riverscape", "Riverbed", Color.FromArgb(8, 14, 12)),
    new("reefscape", "Coral reef", Color.FromArgb(11, 24, 37)),
    new("bettascape", "Betta", Color.Black),
    new("plasmascape", "Plasma globe", Color.Black),
    new("koiscape", "Koi pond", Color.FromArgb(4, 6, 5)),
    new("bonfirescape", "Bonfire", Color.Black),
  ];

  /// Only worlds with something to eat have anything to feed; the bonfire is stirred.
  public bool CanFeed => Name != "plasmascape";
  public string FeedTitle => Name == "bonfirescape" ? "Stir the fire" : "Feed";
  public string Page => $"/scenes/{Name}/wallpaper.html";

  public static World Named(string? name) => All.FirstOrDefault(w => w.Name == name) ?? All[0];
}

/// The choices that outlive a restart. A missing Paused means nobody has chosen yet.
sealed class Settings {
  public string? World { get; set; }
  public bool? Paused { get; set; }

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
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Deskworlds");

  static readonly object gate = new();

  public static void Write(string text) {
    try {
      lock (gate) {
        Directory.CreateDirectory(Folder);
        File.AppendAllText(Path.Combine(Folder, "deskworlds.log"),
          $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {text}{Environment.NewLine}");
      }
    } catch {
      // A log that cannot be written is not worth stopping the wallpaper for.
    }
  }
}
