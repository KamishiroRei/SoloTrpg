// SoloTrpg single-file host (embedded Node runtime + WebView2 SDK)
// - One EXE does everything: node.exe is embedded (build-time /resource) and
//   extracted to %LOCALAPPDATA%\SoloTrpg\bin on first run.
// - Shows a native desktop window (WebView2 embedded web UI, game-like).
//   Closing the window stops the backend and exits.
// - Backend = external source server/server.js (stays on disk so the AI can
//   iterate on it without opencode).
// - Falls back to msedge --app window, then default browser, when WebView2
//   Runtime is missing.
// - CRITICAL: the entry class must not reference WebView2/Form types in its
//   static fields or method signatures referenced from Main, otherwise the
//   CLR resolves Microsoft.Web.WebView2.* before AssemblyResolve is
//   registered (type load happens while JITting Main). All WebView2 usage is
//   therefore confined to method bodies of GameWindow (JIT happens at call
//   time, after AssemblyResolve is set up).
using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using System.Diagnostics;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

class SoloTrpgApp
{
    static string Url = "http://127.0.0.1:3000";
    static string BinDir;
    static string NodeExe;
    static Process ServerProcess;

    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectory(string lpPathName);

    static void WriteErrorLog(string msg)
    {
        try
        {
            string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string errPath = Path.Combine(dir, "启动错误.log");
            File.AppendAllText(errPath, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + msg + "\n", System.Text.Encoding.UTF8);
        }
        catch { }
    }

    static string LocalDataDir()
    {
        string dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SoloTrpg");
        Directory.CreateDirectory(dir);
        return dir;
    }

    static void ExtractResource(string logicalName, string targetFile)
    {
        var asm = Assembly.GetExecutingAssembly();
        using (var s = asm.GetManifestResourceStream(logicalName))
        {
            if (s == null) throw new Exception("embedded resource missing: " + logicalName);
            using (var f = File.Create(targetFile))
                s.CopyTo(f);
        }
    }

    static void EnsureRuntime()
    {
        BinDir = Path.Combine(LocalDataDir(), "bin");
        Directory.CreateDirectory(BinDir);
        NodeExe = Path.Combine(BinDir, "node.exe");
        long minSize = 40L * 1024 * 1024;
        if (!File.Exists(NodeExe) || new FileInfo(NodeExe).Length < minSize)
        {
            ExtractResource("node.exe", NodeExe);
        }
        // Managed assemblies + native loader all extracted to bin (disk LoadFrom context is most reliable)
        foreach (string logical in new[] { "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll" })
        {
            string target = Path.Combine(BinDir, logical);
            if (!File.Exists(target))
            {
                ExtractResource(logical, target);
            }
        }
        // Make the bin dir a DLL search path (WebView2 managed lib P/Invokes the native loader from here)
        try { SetDllDirectory(BinDir); } catch { }
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        if (!path.Contains(BinDir))
        {
            Environment.SetEnvironmentVariable("PATH", BinDir + ";" + path);
        }
    }

    static Assembly ResolveEmbedded(object sender, ResolveEventArgs args)
    {
        string name = new AssemblyName(args.Name).Name;
        try
        {
            string file = Path.Combine(BinDir, name + ".dll");
            if (File.Exists(file)) return Assembly.LoadFrom(file);
        }
        catch { }
        var asm = Assembly.GetExecutingAssembly();
        string res = asm.GetManifestResourceNames().FirstOrDefault(r => r.EndsWith("." + name + ".dll"));
        if (res == null) return null;
        using (var stream = asm.GetManifestResourceStream(res))
        {
            byte[] buf = new byte[stream.Length];
            stream.Read(buf, 0, buf.Length);
            return Assembly.Load(buf);
        }
    }

    static bool StartServer()
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(dir, "server", "server.js");
        if (!File.Exists(script))
        {
            MessageBox.Show("Cannot find server/server.js next to this exe:\n" + script,
                "SoloTrpg", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
        var psi = new ProcessStartInfo();
        psi.FileName = NodeExe;
        psi.Arguments = "\"" + script + "\" --debug --no-open";
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        ServerProcess = Process.Start(psi);
        return true;
    }

    static bool WaitForServer(string url, int timeoutSec)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSec);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url + "/api/health");
                req.Timeout = 2000;
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    if ((int)resp.StatusCode == 200) return true;
                }
            }
            catch { }
            Thread.Sleep(500);
        }
        return false;
    }

    static void KillServer()
    {
        if (ServerProcess == null) return;
        try
        {
            if (!ServerProcess.HasExited)
            {
                var psi = new ProcessStartInfo("taskkill", "/PID " + ServerProcess.Id + " /T /F");
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.CreateNoWindow = true;
                using (var k = Process.Start(psi)) { if (k != null) k.WaitForExit(3000); }
            }
        }
        catch { }
        try { ServerProcess.Kill(); } catch { }
    }

    static void OpenFallback()
    {
        try
        {
            string[] edgePaths = {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) + "\\Microsoft\\Edge\\Application\\msedge.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) + "\\Microsoft\\Edge\\Application\\msedge.exe"
            };
            foreach (var edge in edgePaths)
            {
                if (File.Exists(edge)) { Process.Start(edge, "--app=" + Url); return; }
            }
        }
        catch { }
        try { Process.Start(Url); } catch { }
    }

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            AppDomain.CurrentDomain.UnhandledException += (s, e) => WriteErrorLog("未捕获异常: " + (e.ExceptionObject == null ? "null" : e.ExceptionObject.ToString()));
            EnsureRuntime();
            foreach (var a in args)
            {
                if (a.StartsWith("--url=")) Url = a.Substring(6);
            }
            if (!StartServer()) return 1;
            if (!WaitForServer(Url, 60))
            {
                OpenFallback();
                KillServer();
                return 1;
            }
            int code = GameWindow.Run(Url);
            KillServer();
            return code;
        }
        catch (Exception ex)
        {
            WriteErrorLog("启动失败: " + ex);
            return 1;
        }
    }
}

// Window logic: references WebView2/Form types ONLY inside method bodies,
// so assembly binding happens at call time (after AssemblyResolve is ready).
class GameWindow
{
    static string UserDataDir()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SoloTrpg", "WebView2");
    }

    static void TryShutdown(string url)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url + "/api/shutdown");
            req.Method = "POST";
            req.Timeout = 2000;
            using (var resp = (HttpWebResponse)req.GetResponse()) { }
        }
        catch { }
    }

    // 多窗口标准能力：window.open → 原生独立窗口（带边框、可拖动、与主窗口分离）
    static void HookNewWindow(WebView2 wv)
    {
        if (wv.CoreWebView2 == null) return;
        wv.CoreWebView2.NewWindowRequested += (s, e) =>
        {
            e.Handled = true;
            var uri = e.Uri;
            int w = 1100, h = 800;
            try
            {
                var f = e.WindowFeatures;
                if (f != null && f.Width > 0 && f.Height > 0) { w = (int)f.Width; h = (int)f.Height; }
            }
            catch { }
            var childForm = new Form();
            childForm.Text = "SoloTrpg";
            childForm.StartPosition = FormStartPosition.CenterScreen;
            childForm.Size = new Size(w, h);
            childForm.MinimumSize = new Size(640, 480);
            var childWv = new WebView2();
            childWv.Dock = DockStyle.Fill;
            childForm.Controls.Add(childWv);
            childForm.FormClosed += (s2, e2) => { try { childWv.Dispose(); } catch { } };
            childForm.Load += async (s2, e2) =>
            {
                try
                {
                    var env = await CoreWebView2Environment.CreateAsync(null, UserDataDir());
                    await childWv.EnsureCoreWebView2Async(env);
                    HookNewWindow(childWv);
                    childWv.CoreWebView2.NavigationCompleted += (s3, e3) =>
                    {
                        try
                        {
                            var title = childWv.CoreWebView2.DocumentTitle;
                            if (!string.IsNullOrEmpty(title)) childForm.Text = title;
                        }
                        catch { }
                    };
                    if (!string.IsNullOrEmpty(uri)) childWv.Source = new Uri(uri);
                }
                catch { }
            };
            childForm.Show();
        };
    }

    static async void InitWebViewAsync(string url, WebView2 webview, Form form)
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, UserDataDir());
            await webview.EnsureCoreWebView2Async(env);
            HookNewWindow(webview);
            webview.Source = new Uri(url);
        }
        catch (Exception ex)
        {
            try
            {
                string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                File.AppendAllText(Path.Combine(dir, "启动错误.log"),
                    "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] WebView2 init failed (fallback to browser): " + ex + "\n",
                    System.Text.Encoding.UTF8);
            }
            catch { }
            try
            {
                form.BeginInvoke((Action)(() =>
                {
                    try { Process.Start(url); } catch { }
                    TryShutdown(url);
                    Application.Exit();
                }));
            }
            catch { }
        }
    }

    [STAThread]
    public static int Run(string url)
    {
        bool closing = false;
        Form form = null;
        WebView2 webview = null;
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            form = new Form();
            form.Text = "SoloTrpg";
            form.StartPosition = FormStartPosition.CenterScreen;
            form.Size = new Size(1280, 800);
            form.MinimumSize = new Size(960, 600);
            form.FormClosing += (s, e) =>
            {
                if (!closing) { closing = true; TryShutdown(url); }
            };

            webview = new WebView2();
            webview.Dock = DockStyle.Fill;
            form.Controls.Add(webview);
            form.Load += (s, e) => InitWebViewAsync(url, webview, form);

            Application.Run(form);
            return 0;
        }
        catch (Exception ex)
        {
            try
            {
                string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                File.AppendAllText(Path.Combine(dir, "启动错误.log"),
                    "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] Window start failed: " + ex + "\n",
                    System.Text.Encoding.UTF8);
            }
            catch { }
            try { Process.Start(url); } catch { }
            return 1;
        }
    }
}
