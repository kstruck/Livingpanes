// A small window that asks for a pet's name and color.

namespace Livingpanes;

static class PetDialog {
  public static readonly string[] Palette =
    ["#ff8a3d", "#ffd23f", "#3ddcff", "#ff5fa2", "#8bff6a", "#b28dff", "#ffffff", "#ff3b3b"];

  public sealed record Answer(string Name, string Color);

  public static Answer? Ask(string title, string name, string color) {
    using var form = new Form {
      Text = title, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false,
      StartPosition = FormStartPosition.CenterScreen, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
      Padding = new Padding(16), Icon = TrayIcon.Draw(), TopMost = true,
    };
    var layout = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, Dock = DockStyle.Fill };
    layout.Controls.Add(new Label { Text = "Name", AutoSize = true });
    var box = new TextBox { Text = name, Width = 260, MaxLength = 24 };
    layout.Controls.Add(box);
    layout.Controls.Add(new Label { Text = "Color", AutoSize = true, Margin = new Padding(3, 12, 3, 3) });
    var swatches = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
    var chosen = color;
    var buttons = new List<Button>();
    foreach (var hex in Palette) {
      var swatch = new Button {
        Width = 28, Height = 28, FlatStyle = FlatStyle.Flat, BackColor = ColorTranslator.FromHtml(hex),
        Margin = new Padding(2), AccessibleName = $"Color {hex}", Tag = hex,
      };
      swatch.FlatAppearance.BorderSize = hex.Equals(chosen, StringComparison.OrdinalIgnoreCase) ? 3 : 1;
      swatch.Click += (_, _) => {
        chosen = hex;
        foreach (var b in buttons) b.FlatAppearance.BorderSize = (string)b.Tag! == hex ? 3 : 1;
      };
      buttons.Add(swatch);
      swatches.Controls.Add(swatch);
    }
    layout.Controls.Add(swatches);
    var actions = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Margin = new Padding(0, 14, 0, 0) };
    var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, AutoSize = true };
    var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
    actions.Controls.AddRange([ok, cancel]);
    layout.Controls.Add(actions);
    form.Controls.Add(layout);
    form.AcceptButton = ok;
    form.CancelButton = cancel;
    while (form.ShowDialog() == DialogResult.OK) {
      var clean = new string(box.Text.Where(c => !char.IsControl(c)).ToArray()).Trim();
      if (clean.Length > 0) return new Answer(clean, chosen);
      MessageBox.Show(form, "Give your pet a name.", title);
    }
    return null;
  }
}
