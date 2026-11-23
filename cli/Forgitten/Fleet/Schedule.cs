using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Text;

namespace Forgitten.Fleet;

/// <summary>
/// Hands the periodic report to the operating system's own scheduler: a
/// launchd daemon on macOS, a systemd user timer on Linux, Task Scheduler on Windows.
/// </summary>
public static class Schedule
{
    public const string Label = "com.forgitten.agent";
    public const int DefaultMinutes = 15;

    /// <summary>"every 15 minutes", "every minute".</summary>
    public static string Every(int minutes) => minutes == 1 ? "every minute" : $"every {minutes} minutes";

    private static string Home => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    /// <summary>
    /// The schedule's name. There is one per config directory: a device set up
    /// with a custom <see cref="FleetStore.DirectoryVariable"/> gets its own, so
    /// installing or leaving it never touches the default schedule.
    /// </summary>
    internal static string NameFor(string? configDir) =>
        string.IsNullOrEmpty(configDir)
            ? "forgitten"
            : $"forgitten-{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(configDir))))[..8]}";

    private static string Name => NameFor(Environment.GetEnvironmentVariable(FleetStore.DirectoryVariable));

    private static bool IsDefault => Name == NameFor(null);

    // A daemon, not a per-user agent: macOS keeps a launchd agent off the local
    // network until the person allows it, and it cannot ask on behalf of a bare
    // command-line binary. A hub on the home network would never hear from it.
    // The daemon runs as the person who installed it, one per person.
    private static string DaemonLabel => $"{Label}.{Environment.UserName}{Name[NameFor(null).Length..]}";

    public static string LaunchdPlistPath => Path.Combine("/Library", "LaunchDaemons", $"{DaemonLabel}.plist");

    /// <summary>Where releases before the daemon installed a per-user agent. Installing or removing the schedule takes it away.</summary>
    private static string LegacyAgentPath => Path.Combine(Home, "Library", "LaunchAgents", $"{Label}.plist");

    public static string LaunchdLogPath => Path.Combine(Home, "Library", "Logs", "forgitten", "agent.log");

    private static string SystemdDirectory
    {
        get
        {
            var xdg = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
            return Path.Combine(string.IsNullOrEmpty(xdg) ? Path.Combine(Home, ".config") : xdg, "systemd", "user");
        }
    }

    /// <summary>Installs or replaces the schedule. Returns a line saying what now runs the report.</summary>
    public static string Install(string binary, int minutes)
    {
        // The scheduler starts the report with a bare environment. It must find
        // git and the same configuration the person who installed it had.
        var environment = new Dictionary<string, string> { ["PATH"] = Environment.GetEnvironmentVariable("PATH") ?? string.Empty };
        var configDir = Environment.GetEnvironmentVariable(FleetStore.DirectoryVariable);
        if (!string.IsNullOrEmpty(configDir)) environment[FleetStore.DirectoryVariable] = configDir;

        if (OperatingSystem.IsMacOS())
        {
            if (IsDefault) RemoveLegacyAgent();

            // The daemon starts with no home of its own; the sign-in and the config live in this one.
            environment["HOME"] = Home;

            // Made as this person before launchd opens it, so the log stays theirs.
            Directory.CreateDirectory(Path.GetDirectoryName(LaunchdLogPath)!);
            if (!File.Exists(LaunchdLogPath)) File.WriteAllText(LaunchdLogPath, string.Empty);

            var staged = Path.Combine(Path.GetTempPath(), $"{DaemonLabel}.plist");
            File.WriteAllText(staged, LaunchdPlist(binary, minutes, LaunchdLogPath, DaemonLabel, Environment.UserName, environment));
            try
            {
                Console.Error.WriteLine("The schedule is a system launchd job, so sudo may ask for your password.");
                Require("sudo", "install", "-m", "644", "-o", "root", "-g", "wheel", staged, LaunchdPlistPath);
            }
            finally
            {
                File.Delete(staged);
            }

            Run("sudo", "launchctl", "bootout", $"system/{DaemonLabel}"); // Fails when nothing is loaded yet; that is the usual case.
            try
            {
                Require("sudo", "launchctl", "bootstrap", "system", LaunchdPlistPath);
            }
            catch (InvalidOperationException)
            {
                Run("sudo", "rm", "-f", LaunchdPlistPath);
                throw;
            }
            // launchd may hold a background job's first run until the machine is idle; run it now.
            Run("sudo", "launchctl", "kickstart", $"system/{DaemonLabel}");
            return $"launchd runs the report {Every(minutes)} as {Environment.UserName}. Log: {LaunchdLogPath}";
        }

        if (OperatingSystem.IsLinux())
        {
            Directory.CreateDirectory(SystemdDirectory);
            string[] units = [Path.Combine(SystemdDirectory, $"{Name}.service"), Path.Combine(SystemdDirectory, $"{Name}.timer")];
            File.WriteAllText(units[0], SystemdService(binary, environment));
            File.WriteAllText(units[1], SystemdTimer(minutes));
            RequireOrRemove(units, "systemctl", "--user", "daemon-reload");
            RequireOrRemove(units, "systemctl", "--user", "enable", "--now", $"{Name}.timer");
            return $"A systemd user timer runs the report {Every(minutes)}. Log: journalctl --user -u {Name}\n"
                + "On a machine nobody logs in to, run `loginctl enable-linger` once so the timer runs without a session.";
        }

        if (OperatingSystem.IsWindows())
        {
            Require("schtasks", "/Create", "/F", "/SC", "MINUTE", "/MO", minutes.ToString(), "/TN", Name, "/TR", $"\"{binary}\" fleet report");
            return $"Task Scheduler runs the report {Every(minutes)} as the task \"{Name}\".";
        }

        throw new PlatformNotSupportedException("No scheduler is supported on this operating system. Run `forgitten fleet report` from your own.");
    }

    /// <summary>Removes the schedule. Returns false when none was installed.</summary>
    public static bool Uninstall()
    {
        if (OperatingSystem.IsMacOS())
        {
            var legacy = IsDefault && RemoveLegacyAgent();
            if (!File.Exists(LaunchdPlistPath)) return legacy;
            Console.Error.WriteLine("The schedule is a system launchd job, so sudo may ask for your password.");
            Run("sudo", "launchctl", "bootout", $"system/{DaemonLabel}");
            Require("sudo", "rm", "-f", LaunchdPlistPath);
            return true;
        }

        if (OperatingSystem.IsLinux())
        {
            var timer = Path.Combine(SystemdDirectory, $"{Name}.timer");
            if (!File.Exists(timer)) return false;
            Run("systemctl", "--user", "disable", "--now", $"{Name}.timer");
            File.Delete(timer);
            File.Delete(Path.Combine(SystemdDirectory, $"{Name}.service"));
            Run("systemctl", "--user", "daemon-reload");
            return true;
        }

        if (OperatingSystem.IsWindows()) return Run("schtasks", "/Delete", "/F", "/TN", Name) == 0;

        return false;
    }

    public static bool IsInstalled()
    {
        if (OperatingSystem.IsMacOS()) return File.Exists(LaunchdPlistPath) || (IsDefault && File.Exists(LegacyAgentPath));
        if (OperatingSystem.IsLinux()) return File.Exists(Path.Combine(SystemdDirectory, $"{Name}.timer"));
        if (OperatingSystem.IsWindows()) return Run("schtasks", "/Query", "/TN", Name) == 0;
        return false;
    }

    /// <summary>Removes the per-user agent an earlier release installed. Returns false when there was none.</summary>
    private static bool RemoveLegacyAgent()
    {
        if (!File.Exists(LegacyAgentPath)) return false;
        Run("launchctl", "bootout", $"gui/{getuid()}/{Label}");
        File.Delete(LegacyAgentPath);
        return true;
    }

    internal static string LaunchdPlist(string binary, int minutes, string logPath, string label, string userName, IReadOnlyDictionary<string, string> environment)
    {
        static string Xml(string text) => SecurityElement.Escape(text);
        var variables = string.Concat(environment.Select(kv => $"\n        <key>{Xml(kv.Key)}</key>\n        <string>{Xml(kv.Value)}</string>"));

        return $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
                <key>Label</key>
                <string>{Xml(label)}</string>
                <key>UserName</key>
                <string>{Xml(userName)}</string>
                <key>ProgramArguments</key>
                <array>
                    <string>{Xml(binary)}</string>
                    <string>fleet</string>
                    <string>report</string>
                </array>
                <key>StartInterval</key>
                <integer>{minutes * 60}</integer>
                <key>RunAtLoad</key>
                <true/>
                <key>ProcessType</key>
                <string>Background</string>
                <key>EnvironmentVariables</key>
                <dict>{variables}
                </dict>
                <key>StandardOutPath</key>
                <string>{Xml(logPath)}</string>
                <key>StandardErrorPath</key>
                <string>{Xml(logPath)}</string>
            </dict>
            </plist>

            """;
    }

    internal static string SystemdService(string binary, IReadOnlyDictionary<string, string> environment)
    {
        static string Quote(string text) => "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("%", "%%") + "\"";
        var variables = string.Concat(environment.Select(kv => $"Environment={Quote($"{kv.Key}={kv.Value}")}\n"));

        return $"""
            [Unit]
            Description=Report git repository state to the forgitten hub

            [Service]
            Type=oneshot
            {variables}ExecStart={Quote(binary)} fleet report

            """;
    }

    internal static string SystemdTimer(int minutes) =>
        $"""
        [Unit]
        Description=Report git repository state to the forgitten hub every {minutes} minutes

        [Timer]
        OnActiveSec=30s
        OnUnitActiveSec={minutes}min

        [Install]
        WantedBy=timers.target

        """;

    private static void Require(string command, params string[] args)
    {
        var code = Run(command, out var error, args);
        if (code != 0) throw new InvalidOperationException($"`{command} {string.Join(' ', args)}` failed ({code}): {error.Trim()}");
    }

    /// <summary>Runs a scheduler command; when it fails, takes back the files written for it so nothing claims a schedule that is not running.</summary>
    private static void RequireOrRemove(string[] written, string command, params string[] args)
    {
        try
        {
            Require(command, args);
        }
        catch (InvalidOperationException)
        {
            foreach (var file in written) File.Delete(file);
            throw;
        }
    }

    private static int Run(string command, params string[] args) => Run(command, out _, args);

    private static int Run(string command, out string error, params string[] args)
    {
        var psi = new ProcessStartInfo { FileName = command, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in args) psi.ArgumentList.Add(arg);

        using var process = Process.Start(psi) ?? throw new InvalidOperationException($"{command} did not start");
        var stdout = process.StandardOutput.ReadToEndAsync();
        error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        _ = stdout.GetAwaiter().GetResult();
        return process.ExitCode;
    }

    [DllImport("libc")]
    private static extern uint getuid();
}
