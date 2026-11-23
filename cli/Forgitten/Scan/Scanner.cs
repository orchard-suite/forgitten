using System.Collections.Concurrent;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Forgitten.Git;
using Forgitten.Model;

namespace Forgitten.Scan;

public static class Scanner
{
    public static ScanReport Scan(IReadOnlyList<string> roots, IReadOnlyList<string> ignore, int? intervalMinutes = null)
    {
        var started = DateTimeOffset.UtcNow;
        var clock = Stopwatch.StartNew();

        var finder = new RepoFinder(ignore);
        var checkouts = roots.SelectMany(finder.Find).Distinct(StringComparer.Ordinal).ToList();

        // A linked worktree found on its own names the same repository as its
        // main checkout. Group by the shared git directory so it is read once.
        var claimed = new ConcurrentDictionary<string, string>(StringComparer.Ordinal);
        var repos = new ConcurrentBag<RepoReport>();

        Parallel.ForEach(checkouts, new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount }, checkout =>
        {
            var common = RepoInspector.CommonDir(checkout);
            if (!common.Ok)
            {
                repos.Add(RepoReport.Failed(checkout, common.Reason));
                return;
            }

            if (claimed.TryAdd(common.Output.Trim(), checkout)) repos.Add(RepoInspector.Inspect(checkout));
        });

        return new ScanReport(
            ScanReport.CurrentSchema,
            started,
            clock.ElapsedMilliseconds,
            roots.ToList(),
            ignore.ToList(),
            intervalMinutes,
            Device(),
            repos.OrderBy(r => r.Path, StringComparer.Ordinal).ToList());
    }

    public static DeviceInfo Device()
    {
        var os = OperatingSystem.IsMacOS() ? "macos" : OperatingSystem.IsWindows() ? "windows" : OperatingSystem.IsLinux() ? "linux" : "other";
        return new DeviceInfo(
            Environment.MachineName,
            os,
            RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
            RuntimeInformation.OSDescription,
            Version);
    }

    public static string Version { get; } =
        typeof(Scanner).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";
}
