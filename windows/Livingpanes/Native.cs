// The Win32 calls the wallpaper needs: finding the desktop's own windows, putting a
// window among them, and reading what covers the screen.

using System.Runtime.InteropServices;
using System.Text;

namespace Livingpanes;

[StructLayout(LayoutKind.Sequential)]
struct RECT {
  public int Left, Top, Right, Bottom;
  public Rectangle ToRectangle() => Rectangle.FromLTRB(Left, Top, Right, Bottom);
}

[StructLayout(LayoutKind.Sequential)]
struct SYSTEM_POWER_STATUS {
  public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
  public int BatteryLifeTime, BatteryFullLifeTime;
}

static class Native {
  public const uint SMTO_NORMAL = 0;
  public const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
  public const long WS_CHILD = 0x40000000, WS_POPUP = 0x80000000, WS_VISIBLE = 0x10000000;
  public const long WS_CLIPSIBLINGS = 0x04000000, WS_CLIPCHILDREN = 0x02000000;
  public const long WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TRANSPARENT = 0x20;
  public const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
  public const uint SPI_GETDESKWALLPAPER = 0x0073, SPI_SETDESKWALLPAPER = 0x0014;
  public const uint SPI_GETCLIENTAREAANIMATION = 0x1042;
  public const int WM_POWERBROADCAST = 0x0218, PBT_POWERSETTINGCHANGE = 0x8013;
  public static readonly Guid GUID_CONSOLE_DISPLAY_STATE = new("6FE69556-704A-47A0-8F24-C28D936FDA47");

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string? className, string? title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string? className, string? title);
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessageTimeout(
    IntPtr window, uint message, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  public delegate bool EnumWindowsProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
  [DllImport("user32.dll")]
  public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
  public static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")]
  public static extern int MapWindowPoints(IntPtr from, IntPtr to, ref RECT points, int count);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint RegisterWindowMessage(string name);
  [DllImport("user32.dll")]
  public static extern IntPtr RegisterPowerSettingNotification(IntPtr recipient, ref Guid setting, int flags);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out RECT value, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW")]
  public static extern bool SystemParametersInfoText(uint action, uint size, StringBuilder? text, uint flags);
  [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")]
  public static extern bool SystemParametersInfoBool(uint action, uint size, out int value, uint flags);
  [DllImport("kernel32.dll")]
  public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);

  [DllImport("kernel32.dll")]
  public static extern bool AttachConsole(int process);

  public const int WM_HOTKEY = 0x0312;
  public const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_NOREPEAT = 0x4000;
  [DllImport("user32.dll")]
  public static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
  [DllImport("user32.dll")]
  public static extern bool UnregisterHotKey(IntPtr window, int id);

  public static string ClassOf(IntPtr window) {
    var name = new StringBuilder(256);
    GetClassName(window, name, name.Capacity);
    return name.ToString();
  }

  /// The window's visible frame. GetWindowRect includes the invisible resize borders.
  public static Rectangle FrameOf(IntPtr window) {
    if (DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, out RECT frame, Marshal.SizeOf<RECT>()) == 0)
      return frame.ToRectangle();
    return GetWindowRect(window, out var rect) ? rect.ToRectangle() : Rectangle.Empty;
  }

  public static bool IsCloaked(IntPtr window) =>
    DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0;
}
