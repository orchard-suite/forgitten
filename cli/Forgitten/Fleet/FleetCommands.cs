using System.Net;
using Forgitten.Model;
using Forgitten.Scan;

namespace Forgitten.Fleet;

/// <param name="Agent">Install the schedule after joining, so the device keeps reporting.</param>
/// <param name="IntervalMinutes">Minutes between scheduled reports. Null keeps the device's current interval, or the default.</param>
public record JoinOptions(string HubUrl, string TenantId, string ClientId, string Authority, string? Scope, string? Name, string[] Paths, string[] Ignore, bool Agent, int? IntervalMinutes);

/// <summary>The <c>fleet</c> commands. Each returns the process exit code: 0 done, 2 failed.</summary>
public class FleetCommands(FleetStore store, HttpClient http, TextWriter output, TextWriter errors)
{
    public const string DefaultAuthority = "https://login.microsoftonline.com";
    public const string ScopeName = "Fleet.Report";

    public async Task<int> JoinAsync(JoinOptions options, CancellationToken cancel)
    {
        var existing = store.LoadConfig();
        var hubUrl = options.HubUrl.TrimEnd('/');
        var sameHub = existing is not null && existing.HubUrl == hubUrl;

        var roots = options.Paths.Length > 0 ? options.Paths.Select(Path.GetFullPath).ToList() : sameHub ? existing!.Roots : [];
        if (roots.Count == 0) return Fail("Name at least one directory to scan with --path.");
        var missing = roots.FirstOrDefault(r => !Directory.Exists(r));
        if (missing is not null) return Fail($"'{missing}' is not a directory.");

        if ((InsecureUrl("hub", hubUrl) ?? InsecureUrl("sign-in host", options.Authority)) is { } insecure) return Fail(insecure);
        if (options.IntervalMinutes is < 1) return Fail("--interval must be at least 1 minute.");

        var ignore = options.Ignore.Length > 0 ? options.Ignore.ToList() : sameHub ? existing!.Ignore : [];
        var scope = options.Scope ?? $"api://{options.ClientId}/{ScopeName}";
        var auth = new EntraAuth(http, options.Authority, options.TenantId, options.ClientId, scope);

        try
        {
            var tokens = await auth.DeviceLoginAsync(prompt => output.WriteLine(prompt.Message), cancel);
            if (tokens.RefreshToken is null) return Fail("Sign-in returned no refresh token, so this device could not report later. The app registration must allow public client flows.");

            var hub = new HubClient(http, hubUrl, tokens.AccessToken);
            var device = new DeviceRegistration(options.Name, Scanner.Device());
            var registered = sameHub ? await UpdateOrRegisterAsync(hub, existing!.DeviceId, device, cancel) : await hub.RegisterAsync(device, cancel);

            store.Save(new FleetCredentials(tokens.RefreshToken));
            store.Save(new FleetConfig(hubUrl, options.Authority, options.TenantId, options.ClientId, scope, registered.Id, registered.Name, roots, ignore, sameHub ? existing!.IntervalMinutes : null));
            output.WriteLine($"Joined {hubUrl} as \"{registered.Name}\".");
        }
        catch (Exception ex) when (ex is SignInException or HubException)
        {
            return Fail(ex.Message);
        }

        var reported = await ReportAsync(cancel);
        if (!options.Agent)
        {
            if (reported == 0 && !Schedule.IsInstalled()) output.WriteLine("Run `forgitten fleet agent install` to keep reporting on a schedule.");
            return reported;
        }

        // Joined is a decision to keep reporting, so the schedule comes with it,
        // even when the first report failed: the next one may not.
        var minutes = options.IntervalMinutes ?? (sameHub ? existing!.IntervalMinutes : null) ?? Schedule.DefaultMinutes;
        var scheduled = InstallAgent(minutes);
        return reported != 0 ? reported : scheduled;
    }

    public async Task<int> ReportAsync(CancellationToken cancel)
    {
        var config = store.LoadConfig();
        var credentials = store.LoadCredentials();
        if (config is null || credentials is null) return Fail("This device has not joined a fleet. Run `forgitten fleet join` first.");

        try
        {
            var hub = await SignInAsync(config, credentials, cancel);
            var report = Scanner.Scan(config.Roots, config.Ignore, Schedule.IsInstalled() ? config.IntervalMinutes : null);
            await hub.ReportAsync(config.DeviceId, report, cancel);

            var s = report.Summary;
            output.WriteLine($"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss} reported {s.Total} {(s.Total == 1 ? "repo" : "repos")} to {config.HubUrl} ({s.Total - s.Clean} need attention) in {report.DurationMs / 1000.0:0.0}s");
            return 0;
        }
        catch (SignInException ex)
        {
            return Fail(ex.SignInAgain ? $"{ex.Message}\nRun `forgitten fleet join {config.HubUrl} --tenant {config.TenantId} --client {config.ClientId}` to sign in again." : ex.Message);
        }
        catch (HubException ex) when (ex.Status == HttpStatusCode.NotFound)
        {
            return Fail($"This device is no longer in the fleet at {config.HubUrl}. Run `forgitten fleet join` to add it back, or `forgitten fleet leave` to stop reporting.");
        }
        catch (HubException ex)
        {
            return Fail(ex.Message);
        }
    }

    public int ListPaths()
    {
        var config = store.LoadConfig();
        if (config is null) return Fail("This device has not joined a fleet. Run `forgitten fleet join` first.");
        foreach (var root in config.Roots) output.WriteLine(root);
        return 0;
    }

    /// <summary>Adds directories to the scan and sends a report so the hub shows them at once. No sign-in prompt: the stored one is used.</summary>
    public Task<int> AddPathsAsync(string[] paths, CancellationToken cancel) =>
        ChangePathsAsync(paths, (roots, path) =>
        {
            if (!Directory.Exists(path)) return $"'{path}' is not a directory.";
            if (!roots.Contains(path)) roots.Add(path);
            return null;
        }, cancel);

    public Task<int> RemovePathsAsync(string[] paths, CancellationToken cancel) =>
        ChangePathsAsync(paths, (roots, path) => roots.Remove(path) ? null : $"'{path}' is not scanned. `forgitten fleet paths list` shows what is.", cancel);

    private async Task<int> ChangePathsAsync(string[] paths, Func<List<string>, string, string?> change, CancellationToken cancel)
    {
        var config = store.LoadConfig();
        if (config is null) return Fail("This device has not joined a fleet. Run `forgitten fleet join` first.");
        if (paths.Length == 0) return Fail("Name at least one directory.");

        var roots = new List<string>(config.Roots);
        foreach (var path in paths.Select(Path.GetFullPath))
        {
            var problem = change(roots, path);
            if (problem is not null) return Fail(problem);
        }
        if (roots.Count == 0) return Fail("At least one directory must stay. Use `forgitten fleet leave` to stop reporting.");

        store.Save(config with { Roots = roots });
        output.WriteLine($"Scanning {string.Join(", ", roots)}");
        return await ReportAsync(cancel);
    }

    public int Status()
    {
        var config = store.LoadConfig();
        if (config is null)
        {
            output.WriteLine("This device has not joined a fleet.");
            return 0;
        }

        output.WriteLine($"Hub       {config.HubUrl}");
        output.WriteLine($"Device    {config.DeviceName} ({config.DeviceId})");
        output.WriteLine($"Scans     {string.Join(", ", config.Roots)}");
        if (config.Ignore.Count > 0) output.WriteLine($"Ignores   {string.Join(", ", config.Ignore)}");
        output.WriteLine($"Sign-in   {(store.LoadCredentials() is null ? "missing; run `forgitten fleet join` again" : "stored")}");
        output.WriteLine($"Schedule  {(Schedule.IsInstalled() ? Schedule.Every(config.IntervalMinutes ?? Schedule.DefaultMinutes) : "not installed; run `forgitten fleet agent install`")}");
        output.WriteLine($"Config    {store.ConfigPath}");
        return 0;
    }

    public async Task<int> LeaveAsync(CancellationToken cancel)
    {
        var config = store.LoadConfig();
        var credentials = store.LoadCredentials();
        if (config is null)
        {
            output.WriteLine("This device has not joined a fleet.");
            return 0;
        }

        // Stop reporting first: whatever happens next, this device goes quiet.
        if (Schedule.Uninstall()) output.WriteLine("Removed the schedule.");

        var removed = false;
        if (credentials is not null)
        {
            try
            {
                var hub = await SignInAsync(config, credentials, cancel);
                await hub.LeaveAsync(config.DeviceId, cancel);
                removed = true;
            }
            catch (HubException ex) when (ex.Status == HttpStatusCode.NotFound)
            {
                removed = true;
            }
            catch (Exception ex) when (ex is SignInException or HubException)
            {
                errors.WriteLine($"Could not remove the device from the hub: {ex.Message}");
            }
        }

        store.Clear();
        output.WriteLine(removed ? $"Left {config.HubUrl}." : $"This device stopped reporting. Remove \"{config.DeviceName}\" in the hub at {config.HubUrl}.");
        return removed ? 0 : 2;
    }

    public int InstallAgent(int minutes)
    {
        var config = store.LoadConfig();
        if (config is null) return Fail("This device has not joined a fleet. Run `forgitten fleet join` first.");
        if (minutes < 1) return Fail("--interval must be at least 1 minute.");

        var binary = Environment.ProcessPath;
        if (binary is null) return Fail("Could not find the path of this program to schedule it.");

        try
        {
            var installed = Schedule.Install(binary, minutes);
            store.Save(config with { IntervalMinutes = minutes });
            output.WriteLine(installed);
            return 0;
        }
        catch (Exception ex) when (ex is InvalidOperationException or PlatformNotSupportedException or IOException or UnauthorizedAccessException)
        {
            return Fail(ex.Message);
        }
    }

    public int UninstallAgent()
    {
        output.WriteLine(Schedule.Uninstall() ? "Removed the schedule." : "No schedule was installed.");
        return 0;
    }

    /// <summary>Trades the stored refresh token for an access token, keeping the new refresh token Entra hands back.</summary>
    private async Task<HubClient> SignInAsync(FleetConfig config, FleetCredentials credentials, CancellationToken cancel)
    {
        if ((InsecureUrl("hub", config.HubUrl) ?? InsecureUrl("sign-in host", config.Authority)) is { } insecure) throw new SignInException(insecure);

        var auth = new EntraAuth(http, config.Authority, config.TenantId, config.ClientId, config.Scope);
        var tokens = await auth.RefreshAsync(credentials.RefreshToken, cancel);
        if (tokens.RefreshToken is not null && tokens.RefreshToken != credentials.RefreshToken) store.Save(new FleetCredentials(tokens.RefreshToken));
        return new HubClient(http, config.HubUrl, tokens.AccessToken);
    }

    private static async Task<HubClient.Registered> UpdateOrRegisterAsync(HubClient hub, string id, DeviceRegistration device, CancellationToken cancel)
    {
        try
        {
            return await hub.UpdateAsync(id, device, cancel);
        }
        catch (HubException ex) when (ex.Status == HttpStatusCode.NotFound)
        {
            return await hub.RegisterAsync(device, cancel);
        }
    }

    /// <summary>
    /// Why a URL a sign-in token is sent to is not safe to send it to, or null when it is.
    /// Plain http is allowed only to this machine, where nobody else can read it.
    /// </summary>
    internal static string? InsecureUrl(string what, string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http"))
            return $"The {what} '{url}' is not an http(s) URL.";
        if (uri.Scheme == "http" && !uri.IsLoopback)
            return $"The {what} '{url}' uses plain http. Sign-in tokens are sent to it, so it must use https.";
        return null;
    }

    private int Fail(string message)
    {
        errors.WriteLine($"Error: {message}");
        return 2;
    }
}
