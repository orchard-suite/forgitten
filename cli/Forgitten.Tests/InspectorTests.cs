using Forgitten.Git;
using Forgitten.Scan;

namespace Forgitten.Tests;

public class InspectorTests : IDisposable
{
    private readonly GitSandbox _box = new();

    public void Dispose() => _box.Dispose();

    [Fact]
    public void A_pushed_clone_is_clean()
    {
        var repo = RepoInspector.Inspect(_box.Clone("app"));

        Assert.Null(repo.Error);
        Assert.True(repo.IsClean);
        Assert.Equal(_box.PathOf("app.remote"), repo.RemoteUrl);
        var branch = Assert.Single(repo.Branches);
        Assert.Equal(("main", "origin/main", 0, 0, 0), (branch.Name, branch.Upstream, branch.Ahead, branch.Behind, branch.Unpushed));
        var worktree = Assert.Single(repo.Worktrees);
        Assert.True(worktree.Main);
        Assert.Equal("main", worktree.Branch);
        Assert.Equal(7, worktree.Head.Length);
    }

    [Fact]
    public void Changes_are_counted_by_kind()
    {
        var clone = _box.Clone("app");
        File.WriteAllText(Path.Combine(clone, "README.md"), "edited");
        File.WriteAllText(Path.Combine(clone, "staged.txt"), "new");
        GitSandbox.Git(clone, "add", "staged.txt");
        File.WriteAllText(Path.Combine(clone, "loose.txt"), "new");

        var worktree = Assert.Single(RepoInspector.Inspect(clone).Worktrees);

        Assert.Equal((1, 1, 1, 0), (worktree.Staged, worktree.Modified, worktree.Untracked, worktree.Conflicted));
    }

    [Fact]
    public void A_commit_that_was_not_pushed_is_ahead_and_unpushed()
    {
        var clone = _box.Clone("app");
        _box.Commit(clone, "more.txt", "more");

        var repo = RepoInspector.Inspect(clone);

        var branch = Assert.Single(repo.Branches);
        Assert.Equal((1, 0, 1), (branch.Ahead, branch.Behind, branch.Unpushed));
        Assert.True(repo.HasUnsynced);
        Assert.False(repo.HasUncommitted);
    }

    [Fact]
    public void A_branch_the_remote_moved_past_is_behind_with_nothing_unpushed()
    {
        var clone = _box.Clone("app");
        _box.Commit(clone, "more.txt", "more");
        GitSandbox.Git(clone, "push");
        GitSandbox.Git(clone, "reset", "--hard", "HEAD~1");

        var branch = Assert.Single(RepoInspector.Inspect(clone).Branches);

        Assert.Equal((0, 1, 0), (branch.Ahead, branch.Behind, branch.Unpushed));
    }

    [Fact]
    public void A_branch_without_an_upstream_counts_only_commits_no_remote_has()
    {
        var clone = _box.Clone("app");
        GitSandbox.Git(clone, "branch", "merged-already");
        GitSandbox.Git(clone, "checkout", "-b", "local-work");
        _box.Commit(clone, "work.txt", "work");

        var repo = RepoInspector.Inspect(clone);

        var merged = repo.Branches.Single(b => b.Name == "merged-already");
        Assert.Null(merged.Upstream);
        Assert.Equal(0, merged.Unpushed);
        Assert.False(merged.IsUnsynced);

        var work = repo.Branches.Single(b => b.Name == "local-work");
        Assert.Null(work.Upstream);
        Assert.Equal(1, work.Unpushed);
        Assert.True(work.IsUnsynced);
    }

    [Fact]
    public void A_branch_whose_remote_branch_was_deleted_reports_its_upstream_gone()
    {
        var clone = _box.Clone("app");
        GitSandbox.Git(clone, "checkout", "-b", "feature");
        _box.Commit(clone, "feature.txt", "feature");
        GitSandbox.Git(clone, "push", "-u", "origin", "feature");
        GitSandbox.Git(clone, "push", "origin", "--delete", "feature");

        var feature = RepoInspector.Inspect(clone).Branches.Single(b => b.Name == "feature");

        Assert.True(feature.UpstreamGone);
        Assert.Equal(1, feature.Unpushed);
    }

    [Fact]
    public void A_repository_without_a_remote_is_unsynced()
    {
        var repo = RepoInspector.Inspect(_box.Local("scratch"));

        Assert.Null(repo.RemoteUrl);
        Assert.True(repo.HasUnsynced);
        Assert.Equal(0, Assert.Single(repo.Branches).Unpushed);
    }

    [Fact]
    public void A_detached_head_is_a_checkout_without_a_branch()
    {
        var clone = _box.Clone("app");
        GitSandbox.Git(clone, "checkout", "--detach");

        var worktree = Assert.Single(RepoInspector.Inspect(clone).Worktrees);

        Assert.Null(worktree.Branch);
        Assert.NotEmpty(worktree.Head);
    }

    [Fact]
    public void A_repository_before_its_first_commit_still_reports_its_files()
    {
        var repo = _box.Init("fresh");
        File.WriteAllText(Path.Combine(repo, "idea.txt"), "idea");

        var report = RepoInspector.Inspect(repo);

        Assert.Null(report.Error);
        Assert.Empty(report.Branches);
        var worktree = Assert.Single(report.Worktrees);
        Assert.Equal(("main", "", 1), (worktree.Branch, worktree.Head, worktree.Untracked));
        Assert.True(report.HasUncommitted);
    }

    [Fact]
    public void Stashes_are_counted()
    {
        var clone = _box.Clone("app");
        File.WriteAllText(Path.Combine(clone, "README.md"), "edited");
        GitSandbox.Git(clone, "stash");

        var repo = RepoInspector.Inspect(clone);

        Assert.Equal(1, repo.Stashes);
        Assert.False(repo.HasUncommitted);
    }

    [Fact]
    public void A_linked_worktree_is_reported_under_its_repository_once()
    {
        var clone = _box.Clone("app");
        var linked = _box.PathOf("elsewhere", "app-feature");
        GitSandbox.Git(clone, "worktree", "add", "-b", "feature", linked);
        File.WriteAllText(Path.Combine(linked, "wip.txt"), "wip");

        var report = Scanner.Scan([_box.Root], []);

        var repo = Assert.Single(report.Repos);
        Assert.Equal(clone, repo.Path);
        Assert.Equal(2, repo.Worktrees.Count);
        var worktree = repo.Worktrees.Single(w => !w.Main);
        Assert.Equal((linked, "feature", 1), (worktree.Path, worktree.Branch, worktree.Untracked));
        Assert.True(repo.HasUncommitted);
    }

    [Fact]
    public void A_directory_git_cannot_read_is_reported_with_the_reason()
    {
        var broken = _box.PathOf("broken");
        Directory.CreateDirectory(Path.Combine(broken, ".git"));

        var repo = Assert.Single(Scanner.Scan([_box.Root], []).Repos);

        Assert.Equal(broken, repo.Path);
        Assert.Contains("not a git repository", repo.Error);
        Assert.False(repo.IsClean);
    }

    [Theory]
    [InlineData("https://user:token@example.org/team/app.git", "https://example.org/team/app.git")]
    [InlineData("https://example.org/team/app.git", "https://example.org/team/app.git")]
    [InlineData("git@example.org:team/app.git", "git@example.org:team/app.git")]
    [InlineData("/srv/git/app.git", "/srv/git/app.git")]
    public void Credentials_never_leave_in_a_remote_url(string url, string expected)
    {
        Assert.Equal(expected, RepoInspector.StripCredentials(url));
    }

    [Fact]
    public void Conflicts_are_not_counted_as_staged_or_modified()
    {
        var changes = RepoInspector.ParseStatus(["UU both.txt", "AA added.txt", "M  staged.txt", " M edited.txt", "MM both-ways.txt", "?? new.txt"]);

        Assert.Equal(new RepoInspector.Changes(Staged: 2, Modified: 2, Untracked: 1, Conflicted: 2), changes);
    }
}
