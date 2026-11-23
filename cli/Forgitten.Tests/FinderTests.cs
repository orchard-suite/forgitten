using Forgitten.Git;

namespace Forgitten.Tests;

public class FinderTests : IDisposable
{
    private readonly GitSandbox _box = new();

    public void Dispose() => _box.Dispose();

    private string Checkout(params string[] parts)
    {
        var path = _box.PathOf(parts);
        Directory.CreateDirectory(Path.Combine(path, ".git"));
        return path;
    }

    [Fact]
    public void Finds_checkouts_at_any_depth_including_hidden_directories()
    {
        var top = Checkout("a");
        var deep = Checkout("group", "team", "b");
        var hidden = Checkout(".worktrees", "c");

        Assert.Equal(new[] { hidden, top, deep }.Order(StringComparer.Ordinal), new RepoFinder(null).Find(_box.Root));
    }

    [Fact]
    public void Does_not_look_inside_a_checkout()
    {
        var outer = Checkout("outer");
        Checkout("outer", "vendor", "inner");

        Assert.Equal([outer], new RepoFinder(null).Find(_box.Root));
    }

    [Fact]
    public void A_git_file_marks_a_checkout_too()
    {
        var linked = _box.PathOf("linked");
        Directory.CreateDirectory(linked);
        File.WriteAllText(Path.Combine(linked, ".git"), "gitdir: /somewhere/else");

        Assert.Equal([linked], new RepoFinder(null).Find(_box.Root));
    }

    [Fact]
    public void Skips_ignored_patterns_and_dependency_trees()
    {
        var kept = Checkout("kept");
        Checkout("archive", "old");
        Checkout("web", "node_modules", "some-dependency");

        Assert.Equal([kept], new RepoFinder(["archive"]).Find(_box.Root));
    }

    [Fact]
    public void The_root_itself_is_scanned_even_when_its_name_is_ignored()
    {
        var inside = Checkout("node_modules", "patched");

        Assert.Equal([inside], new RepoFinder(null).Find(_box.PathOf("node_modules")));
    }

    [Fact]
    public void A_link_back_up_the_tree_does_not_loop()
    {
        var repo = Checkout("a");
        Directory.CreateSymbolicLink(_box.PathOf("loop"), _box.Root);

        Assert.Equal([repo], new RepoFinder(null).Find(_box.Root));
    }
}
