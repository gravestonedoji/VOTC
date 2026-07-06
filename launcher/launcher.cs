// voice-mode fork: tiny taskbar-pinnable launcher.
// Windows can't pin .bat files to the taskbar, so this stub exists purely
// to be an .exe with the VOTC icon that runs "Start VOTC Voice.bat" from
// the folder it lives in. All real launch logic (collision guard, npm)
// stays in the .bat. Rebuild with build-launcher.bat after changes.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string bat = Path.Combine(dir, "Start VOTC Voice.bat");
        if (!File.Exists(bat))
        {
            MessageBox.Show(
                "Could not find 'Start VOTC Voice.bat' next to this launcher.\n\n" +
                "Keep VOTC Voice.exe inside the VOTC folder and pin it from there.",
                "VOTC Voice", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = bat,
            WorkingDirectory = dir,
            UseShellExecute = true,
        });
    }
}
