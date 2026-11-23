using System.Text.Json;
using Forgitten.Model;

namespace Forgitten.Fleet;

/// <summary>What this device needs to report to a hub. Written by <c>fleet join</c>.</summary>
public record FleetConfig(
    string HubUrl,
    string Authority,
    string TenantId,
    string ClientId,
    string Scope,
    string DeviceId,
    string DeviceName,
    List<string> Roots,
    List<string> Ignore,
    int? IntervalMinutes);

/// <summary>The sign-in that outlives a run. Kept apart from the config so it can be locked down on its own.</summary>
public record FleetCredentials(string RefreshToken);

public class FleetStore
{
    public const string DirectoryVariable = "FORGITTEN_CONFIG_DIR";

    public FleetStore(string? directory = null)
    {
        Directory = directory ?? DefaultDirectory();
    }

    public string Directory { get; }

    public string ConfigPath => Path.Combine(Directory, "fleet.json");

    private string CredentialsPath => Path.Combine(Directory, "credentials.json");

    public FleetConfig? LoadConfig() => Read<FleetConfig>(ConfigPath);

    public FleetCredentials? LoadCredentials() => Read<FleetCredentials>(CredentialsPath);

    public void Save(FleetConfig config) => Write(ConfigPath, config, secret: false);

    public void Save(FleetCredentials credentials) => Write(CredentialsPath, credentials, secret: true);

    public void Clear()
    {
        File.Delete(ConfigPath);
        File.Delete(CredentialsPath);
    }

    private static T? Read<T>(string path) where T : class =>
        File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json.Pretty) : null;

    private void Write<T>(string path, T value, bool secret)
    {
        System.IO.Directory.CreateDirectory(Directory);

        // Written beside the target and moved over it, so a run that dies
        // mid-write never leaves a half file where the sign-in used to be.
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(value, Json.Pretty));
        if (secret && !OperatingSystem.IsWindows()) File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.Move(temp, path, overwrite: true);
    }

    private static string DefaultDirectory()
    {
        var configured = Environment.GetEnvironmentVariable(DirectoryVariable);
        if (!string.IsNullOrEmpty(configured)) return configured;

        if (OperatingSystem.IsWindows())
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "forgitten");

        var xdg = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME");
        var root = string.IsNullOrEmpty(xdg) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config") : xdg;
        return Path.Combine(root, "forgitten");
    }
}
