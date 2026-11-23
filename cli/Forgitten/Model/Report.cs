using System.Text.Json;
using System.Text.Json.Serialization;

namespace Forgitten.Model;

// The scan report. `--json` prints it and `fleet report` sends it, so the
// property names here are the wire contract with the hub.

/// <summary>One local branch and how it stands against the remotes.</summary>
/// <param name="Upstream">The tracked branch, like <c>origin/main</c>, or null when none is set.</param>
/// <param name="UpstreamGone">An upstream is set but no longer exists on the remote.</param>
/// <param name="Unpushed">Commits on this branch that no remote branch holds.</param>
public record BranchReport(string Name, string? Upstream, bool UpstreamGone, int Ahead, int Behind, int Unpushed)
{
    [JsonIgnore]
    public bool IsUnsynced => Ahead > 0 || Behind > 0 || Unpushed > 0 || UpstreamGone;
}

/// <summary>One checkout of a repository: the main one, or a linked worktree.</summary>
/// <param name="Branch">The checked out branch, or null when HEAD is detached.</param>
/// <param name="Head">Short commit id, or empty before the first commit.</param>
public record WorktreeReport(string Path, string? Branch, string Head, bool Main, int Staged, int Modified, int Untracked, int Conflicted)
{
    [JsonIgnore]
    public int Changes => Staged + Modified + Untracked + Conflicted;
}

/// <param name="Path">The main worktree.</param>
/// <param name="RemoteUrl">The origin URL (or the first remote's), credentials removed. Null when the repository has no remote.</param>
/// <param name="Error">Why git could not read this repository; the other fields are empty when set.</param>
public record RepoReport(string Path, string Name, string? RemoteUrl, int Stashes, List<WorktreeReport> Worktrees, List<BranchReport> Branches, string? Error)
{
    [JsonIgnore]
    public bool HasUncommitted => Worktrees.Any(w => w.Changes > 0);

    [JsonIgnore]
    public bool HasUnsynced => Branches.Any(b => b.IsUnsynced) || (RemoteUrl is null && Error is null && Branches.Count > 0);

    [JsonIgnore]
    public bool IsClean => Error is null && !HasUncommitted && !HasUnsynced;

    public static RepoReport Failed(string path, string error) => new(path, NameOf(path), null, 0, [], [], error);

    /// <summary>The last two path segments: enough to tell clones apart without the whole path.</summary>
    public static string NameOf(string path)
    {
        var parts = path.Split([System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? $"{parts[^2]}/{parts[^1]}" : parts.Length == 1 ? parts[0] : path;
    }
}

/// <summary>What a device says about itself.</summary>
public record DeviceInfo(string Hostname, string Os, string Arch, string Platform, string Version);

/// <param name="Name">The name to show the device under. Null keeps the one the hub has, or takes the host name for a new device.</param>
public record DeviceRegistration(string? Name, string Hostname, string Os, string Arch, string Platform, string Version)
{
    public DeviceRegistration(string? name, DeviceInfo device) : this(name, device.Hostname, device.Os, device.Arch, device.Platform, device.Version) { }
}

public record ScanSummary(int Total, int Dirty, int Unsynced, int Clean, int Errors);

/// <param name="IntervalMinutes">How often this device reports, when a schedule is installed.</param>
public record ScanReport(
    int Schema,
    DateTimeOffset ScannedAt,
    long DurationMs,
    List<string> Roots,
    List<string> Ignore,
    int? IntervalMinutes,
    DeviceInfo Device,
    List<RepoReport> Repos)
{
    public const int CurrentSchema = 1;

    public ScanSummary Summary => new(
        Repos.Count,
        Repos.Count(r => r.HasUncommitted),
        Repos.Count(r => r.HasUnsynced),
        Repos.Count(r => r.IsClean),
        Repos.Count(r => r.Error is not null));

    [JsonIgnore]
    public bool NeedsAttention => Repos.Any(r => !r.IsClean);
}

public static class Json
{
    public static readonly JsonSerializerOptions Wire = new(JsonSerializerDefaults.Web);

    public static readonly JsonSerializerOptions Pretty = new(JsonSerializerDefaults.Web) { WriteIndented = true };
}
