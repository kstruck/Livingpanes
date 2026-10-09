// Where a wallpaper window goes: behind the desktop icons, in front of the still picture.
//
// Explorer draws the icons in a SHELLDLL_DefView window and the picture in a WorkerW.
// Message 0x052C asks Progman to split those apart so a window can sit between them.
// Windows 11 24H2 moved both into Progman as children; earlier builds keep them as
// top-level windows. Both layouts are handled.

namespace Livingpanes;

sealed record DesktopHost(IntPtr Parent, IntPtr Below, string Layout);

static class Desktop {
  public static DesktopHost? Find() {
    var progman = Native.FindWindow("Progman", null);
    if (progman == IntPtr.Zero) return null;
    Native.SendMessageTimeout(progman, 0x052C, 0xD, 0x1, Native.SMTO_NORMAL, 1000, out _);
    Native.SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, Native.SMTO_NORMAL, 1000, out _);

    // 24H2 and later: the icons and the picture are siblings inside Progman. The
    // wallpaper goes directly under the icons.
    var icons = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (icons != IntPtr.Zero && Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null) != IntPtr.Zero)
      return new DesktopHost(progman, icons, "progman");

    // Earlier builds: the WorkerW that follows the one holding the icons is the picture.
    IntPtr picture = IntPtr.Zero;
    Native.EnumWindows((window, _) => {
      if (Native.FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
        picture = Native.FindWindowEx(IntPtr.Zero, window, "WorkerW", null);
      return true;
    }, IntPtr.Zero);
    if (picture != IntPtr.Zero) return new DesktopHost(picture, IntPtr.Zero, "workerw");

    // Icons inside Progman but no split happened: still below the icons.
    return icons != IntPtr.Zero ? new DesktopHost(progman, icons, "progman-nosplit") : null;
  }

  /// Makes a top-level window a child of the desktop, covering one screen.
  public static void Attach(IntPtr window, DesktopHost host, Rectangle screen) {
    var style = (long)Native.GetWindowLongPtr(window, Native.GWL_STYLE);
    style = (style & ~Native.WS_POPUP) | Native.WS_CHILD | Native.WS_VISIBLE
      | Native.WS_CLIPSIBLINGS | Native.WS_CLIPCHILDREN;
    Native.SetWindowLongPtr(window, Native.GWL_STYLE, (IntPtr)style);
    Native.SetParent(window, host.Parent);
    Place(window, host, screen);
  }

  /// Child coordinates are relative to the parent, which spans every screen.
  public static void Place(IntPtr window, DesktopHost host, Rectangle screen) {
    var rect = new RECT { Left = screen.Left, Top = screen.Top, Right = screen.Right, Bottom = screen.Bottom };
    Native.MapWindowPoints(IntPtr.Zero, host.Parent, ref rect, 2);
    var flags = Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW;
    Native.SetWindowPos(window, host.Below, rect.Left, rect.Top,
      rect.Right - rect.Left, rect.Bottom - rect.Top, flags);
  }

  /// Explorer repaints the still picture when it is set again. Closing the wallpaper
  /// would otherwise leave its last frame on the desktop on older layouts.
  public static void RepaintPicture() {
    var path = new System.Text.StringBuilder(1024);
    if (Native.SystemParametersInfoText(Native.SPI_GETDESKWALLPAPER, (uint)path.Capacity, path, 0)
        && path.Length > 0)
      Native.SystemParametersInfoText(Native.SPI_SETDESKWALLPAPER, 0, path, 0);
  }
}
