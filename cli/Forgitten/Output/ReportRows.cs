using Forgitten.Model;

namespace Forgitten.Output;

/// <summary>One printed line of a repository: a branch, a checkout, or both.</summary>
public record ReportRow(string Branch, bool Current, string Changes, string Sync, bool Attention);

public static class ReportRows
{
    /// <summary>
    /// The lines worth printing for a repository: every checkout, and every
    /// branch that has something to say. A clean repository is one line.
    /// </summary>
    public static List<ReportRow> For(RepoReport repo)
    {
        if (repo.Error is not null) return [new ReportRow("-", false, "-", $"error: {repo.Error}", true)];

        var rows = new List<ReportRow>();
        var noRemote = repo.RemoteUrl is null;

        foreach (var branch in repo.Branches)
        {
            var checkouts = repo.Worktrees.Where(w => w.Branch == branch.Name).ToList();
            if (checkouts.Count == 0 && !branch.IsUnsynced) continue;

            var sync = noRemote ? "no remote" : Sync(branch);
            if (checkouts.Count == 0) rows.Add(new ReportRow(branch.Name, false, "-", sync, true));
            foreach (var checkout in checkouts)
                rows.Add(new ReportRow(Label(branch.Name, checkout), true, Changes(checkout), sync, checkout.Changes > 0 || branch.IsUnsynced || noRemote));
        }

        // Checkouts with no branch ref behind them: a detached HEAD, or a branch before its first commit.
        foreach (var checkout in repo.Worktrees.Where(w => repo.Branches.All(b => b.Name != w.Branch)))
        {
            var name = checkout.Branch is null ? $"(detached {checkout.Head})" : $"{checkout.Branch} (no commits)";
            rows.Add(new ReportRow(Label(name, checkout), true, Changes(checkout), noRemote ? "no remote" : "-", checkout.Changes > 0 || noRemote));
        }

        if (repo.Stashes > 0) rows.Add(new ReportRow("(stash)", false, $"{repo.Stashes} stashed", "-", true));
        return rows;
    }

    private static string Label(string branch, WorktreeReport checkout) =>
        checkout.Main ? branch : $"{branch} @ {Path.GetFileName(checkout.Path.TrimEnd(Path.DirectorySeparatorChar))}";

    private static string Changes(WorktreeReport w)
    {
        if (w.Changes == 0) return "clean";
        var parts = new List<string>();
        if (w.Conflicted > 0) parts.Add($"{w.Conflicted} conflicted");
        if (w.Staged > 0) parts.Add($"{w.Staged} staged");
        if (w.Modified > 0) parts.Add($"{w.Modified} modified");
        if (w.Untracked > 0) parts.Add($"{w.Untracked} untracked");
        return string.Join(", ", parts);
    }

    private static string Sync(BranchReport b)
    {
        if (b.UpstreamGone) return b.Unpushed > 0 ? $"upstream gone, {b.Unpushed} unpushed" : "upstream gone";
        if (b.Upstream is null) return b.Unpushed > 0 ? $"{b.Unpushed} unpushed, no upstream" : "in sync";

        var parts = new List<string>();
        if (b.Ahead > 0) parts.Add($"{b.Ahead} ahead");
        if (b.Behind > 0) parts.Add($"{b.Behind} behind");
        return parts.Count == 0 ? "in sync" : string.Join(", ", parts);
    }

    public static string SummaryLine(ScanSummary s)
    {
        var line = $"{s.Dirty} dirty, {s.Unsynced} unsynced, {s.Clean} clean of {s.Total} total";
        return s.Errors > 0 ? $"{line}, {s.Errors} unreadable" : line;
    }
}
