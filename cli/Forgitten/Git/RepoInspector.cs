using Forgitten.Model;

namespace Forgitten.Git;

/// <summary>Reads one repository: its checkouts, its branches, and what has not left this machine.</summary>
public static class RepoInspector
{
    /// <summary>
    /// The directory shared by every worktree of the repository at <paramref name="checkout"/>.
    /// Two checkouts with the same one are the same repository.
    /// </summary>
    public static GitResult CommonDir(string checkout) => GitRunner.Run(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir");

    public static RepoReport Inspect(string checkout)
    {
        var listed = GitRunner.Run(checkout, "worktree", "list", "--porcelain");
        if (!listed.Ok) return RepoReport.Failed(checkout, listed.Reason);

        var entries = ParseWorktrees(listed.Output);
        var main = entries.FirstOrDefault();
        if (main is null) return RepoReport.Failed(checkout, "git listed no worktrees");

        var worktrees = new List<WorktreeReport>();
        foreach (var entry in entries)
        {
            // A bare repository has no files to change, and a prunable worktree's directory is already gone.
            if (entry.Bare || entry.Prunable || !Directory.Exists(entry.Path)) continue;

            var status = GitRunner.Run(entry.Path, "status", "--porcelain");
            if (!status.Ok) return RepoReport.Failed(main.Path, $"{entry.Path}: {status.Reason}");

            var changes = ParseStatus(status.Lines);
            worktrees.Add(new WorktreeReport(entry.Path, entry.Branch, entry.Head, entry == main, changes.Staged, changes.Modified, changes.Untracked, changes.Conflicted));
        }

        var remoteUrl = RemoteUrl(main.Path);
        var refs = GitRunner.Run(main.Path, "for-each-ref", "--format=%(refname:short)%09%(upstream:short)%09%(upstream:track,nobracket)", "refs/heads");
        if (!refs.Ok) return RepoReport.Failed(main.Path, refs.Reason);

        // One git process per branch that needs counting; a repository with
        // hundreds of local branches is slow unless they run side by side.
        var branches = refs.Lines
            .Select(ParseBranch)
            .AsParallel()
            .AsOrdered()
            .Select(b => b with { Unpushed = Unpushed(main.Path, b, hasRemote: remoteUrl is not null) })
            .ToList();

        var stashes = GitRunner.Run(main.Path, "stash", "list");

        return new RepoReport(main.Path, RepoReport.NameOf(main.Path), remoteUrl, stashes.Ok ? stashes.Lines.Count() : 0, worktrees, branches, null);
    }

    /// <summary>
    /// Commits on the branch that no remote branch holds. A branch level with its
    /// upstream has none by definition, so git is only asked about the others.
    /// Without any remote the question has no answer and the repository is
    /// reported as having no remote instead.
    /// </summary>
    private static int Unpushed(string repo, BranchReport branch, bool hasRemote)
    {
        if (!hasRemote) return 0;
        if (branch.Upstream is not null && !branch.UpstreamGone && branch.Ahead == 0) return 0;

        var count = GitRunner.Run(repo, "rev-list", "--count", $"refs/heads/{branch.Name}", "--not", "--remotes");
        return count.Ok && int.TryParse(count.Output.Trim(), out var n) ? n : 0;
    }

    private static string? RemoteUrl(string repo)
    {
        var remotes = GitRunner.Run(repo, "remote").Lines.ToList();
        if (remotes.Count == 0) return null;

        var name = remotes.Contains("origin") ? "origin" : remotes[0];
        var url = GitRunner.Run(repo, "config", "--get", $"remote.{name}.url").Output.Trim();
        return url.Length == 0 ? null : StripCredentials(url);
    }

    /// <summary>Removes a user name and password from an http(s) URL. The report leaves this machine; a token must not.</summary>
    internal static string StripCredentials(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length == 0) return url;
        return new UriBuilder(uri) { UserName = string.Empty, Password = string.Empty }.Uri.ToString();
    }

    internal record WorktreeEntry(string Path, string Head, string? Branch, bool Bare, bool Prunable);

    internal static List<WorktreeEntry> ParseWorktrees(string porcelain)
    {
        var entries = new List<WorktreeEntry>();
        WorktreeEntry? current = null;

        foreach (var raw in porcelain.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("worktree ", StringComparison.Ordinal))
            {
                if (current is not null) entries.Add(current);
                current = new WorktreeEntry(line[9..], string.Empty, null, false, false);
            }
            else if (current is null)
            {
                continue;
            }
            else if (line.StartsWith("HEAD ", StringComparison.Ordinal))
            {
                // Before the first commit git prints an all-zero id; there is no commit to name.
                var sha = line[5..];
                current = current with { Head = sha.All(c => c == '0') ? string.Empty : sha[..Math.Min(7, sha.Length)] };
            }
            else if (line.StartsWith("branch refs/heads/", StringComparison.Ordinal))
            {
                current = current with { Branch = line[18..] };
            }
            else if (line == "bare")
            {
                current = current with { Bare = true };
            }
            else if (line.StartsWith("prunable", StringComparison.Ordinal))
            {
                current = current with { Prunable = true };
            }
        }

        if (current is not null) entries.Add(current);
        return entries;
    }

    internal record Changes(int Staged, int Modified, int Untracked, int Conflicted);

    /// <summary>Counts <c>git status --porcelain</c> entries by their two status letters.</summary>
    internal static Changes ParseStatus(IEnumerable<string> lines)
    {
        int staged = 0, modified = 0, untracked = 0, conflicted = 0;
        foreach (var line in lines)
        {
            if (line.Length < 2) continue;
            char index = line[0], tree = line[1];

            if (index == '?' && tree == '?') untracked++;
            else if (index == '!' && tree == '!') continue;
            else if (index == 'U' || tree == 'U' || (index == 'A' && tree == 'A') || (index == 'D' && tree == 'D')) conflicted++;
            else
            {
                if (index != ' ') staged++;
                if (tree != ' ') modified++;
            }
        }

        return new Changes(staged, modified, untracked, conflicted);
    }

    /// <summary>Parses one <c>name TAB upstream TAB track</c> line, where track is like <c>ahead 2, behind 1</c> or <c>gone</c>.</summary>
    internal static BranchReport ParseBranch(string line)
    {
        var parts = line.Split('\t');
        var upstream = parts.Length > 1 && parts[1].Length > 0 ? parts[1] : null;
        var track = parts.Length > 2 ? parts[2] : string.Empty;

        int ahead = 0, behind = 0;
        foreach (var piece in track.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (piece.StartsWith("ahead ", StringComparison.Ordinal)) _ = int.TryParse(piece[6..], out ahead);
            else if (piece.StartsWith("behind ", StringComparison.Ordinal)) _ = int.TryParse(piece[7..], out behind);
        }

        return new BranchReport(parts[0], upstream, track == "gone", ahead, behind, 0);
    }
}
