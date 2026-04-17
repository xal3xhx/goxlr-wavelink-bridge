using System;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

class TrayHelper : ApplicationContext
{
    private NotifyIcon trayIcon;
    private ToolStripMenuItem statusItem;
    private Icon iconConnected;
    private Icon iconPartial;
    private Icon iconDisconnected;
    private System.Windows.Forms.Timer readTimer;
    private Thread readerThread;
    private readonly System.Collections.Concurrent.ConcurrentQueue<string> inputQueue =
        new System.Collections.Concurrent.ConcurrentQueue<string>();

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayHelper());
    }

    public TrayHelper()
    {
        iconConnected = MakeIcon(Color.FromArgb(76, 175, 80));
        iconPartial = MakeIcon(Color.FromArgb(255, 193, 7));
        iconDisconnected = MakeIcon(Color.FromArgb(244, 67, 54));

        statusItem = new ToolStripMenuItem("Starting...");
        statusItem.Enabled = false;

        var configItem = new ToolStripMenuItem("Configure...");
        configItem.Click += (s, e) => SendEvent("configure");

        var reconnectItem = new ToolStripMenuItem("Reconnect");
        reconnectItem.Click += (s, e) => SendEvent("reconnect");

        var quitItem = new ToolStripMenuItem("Quit");
        quitItem.Click += (s, e) => SendEvent("quit");

        var menu = new ContextMenuStrip();
        menu.Items.Add(statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(configItem);
        menu.Items.Add(reconnectItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quitItem);

        trayIcon = new NotifyIcon();
        trayIcon.Icon = iconDisconnected;
        trayIcon.Text = "GoXLR-WaveLink Bridge";
        trayIcon.ContextMenuStrip = menu;
        trayIcon.DoubleClick += (s, e) => SendEvent("configure");
        trayIcon.Visible = true;

        // Read stdin on background thread
        readerThread = new Thread(ReadStdin);
        readerThread.IsBackground = true;
        readerThread.Start();

        // Process input on UI thread via timer
        readTimer = new System.Windows.Forms.Timer();
        readTimer.Interval = 50;
        readTimer.Tick += ProcessInput;
        readTimer.Start();

        SendEvent("ready");
    }

    private void ReadStdin()
    {
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                inputQueue.Enqueue(line);
            }
        }
        catch { }
        // stdin closed = parent died
        inputQueue.Enqueue("{\"cmd\":\"exit\"}");
    }

    private void ProcessInput(object sender, EventArgs e)
    {
        string line;
        while (inputQueue.TryDequeue(out line))
        {
            try
            {
                // Simple JSON parsing without dependencies
                if (line.Contains("\"exit\""))
                {
                    Cleanup();
                    Application.Exit();
                    return;
                }

                // Parse "cmd":"update"
                if (line.Contains("\"update\""))
                {
                    // Extract status
                    var statusVal = ExtractJsonValue(line, "status");
                    if (statusVal != null) statusItem.Text = statusVal;

                    // Extract icon
                    var iconVal = ExtractJsonValue(line, "icon");
                    if (iconVal == "connected") trayIcon.Icon = iconConnected;
                    else if (iconVal == "partial") trayIcon.Icon = iconPartial;
                    else if (iconVal == "disconnected") trayIcon.Icon = iconDisconnected;

                    // Extract tooltip (max 63 chars for NotifyIcon)
                    var tipVal = ExtractJsonValue(line, "tooltip");
                    if (tipVal != null)
                    {
                        if (tipVal.Length > 63) tipVal = tipVal.Substring(0, 63);
                        trayIcon.Text = tipVal;
                    }
                }
            }
            catch { }
        }
    }

    private static string ExtractJsonValue(string json, string key)
    {
        var search = "\"" + key + "\":\"";
        int start = json.IndexOf(search);
        if (start < 0) return null;
        start += search.Length;
        int end = json.IndexOf("\"", start);
        if (end < 0) return null;
        return json.Substring(start, end - start)
            .Replace("\\n", "\n")
            .Replace("\\\"", "\"")
            .Replace("\\\\", "\\");
    }

    private static void SendEvent(string type)
    {
        try
        {
            Console.WriteLine("{\"type\":\"" + type + "\"}");
            Console.Out.Flush();
        }
        catch { }
    }

    private static Icon MakeIcon(Color color)
    {
        using (var bmp = new Bitmap(32, 32))
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using (var brush = new SolidBrush(color))
            {
                g.FillEllipse(brush, 2, 2, 28, 28);
            }
            // Add a subtle border
            using (var pen = new Pen(Color.FromArgb(80, 0, 0, 0), 1.5f))
            {
                g.DrawEllipse(pen, 2, 2, 28, 28);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
    }

    private void Cleanup()
    {
        readTimer.Stop();
        trayIcon.Visible = false;
        trayIcon.Dispose();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) Cleanup();
        base.Dispose(disposing);
    }
}
