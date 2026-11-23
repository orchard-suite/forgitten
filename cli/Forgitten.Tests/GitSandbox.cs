using System.Runtime.CompilerServices;
using Forgitten.Git;

namespace Forgitten.Tests;

/// <summary>A throwaway directory of real git repositories, cut off from the machine's own git configuration.</summary>
public sealed class GitSandbox : IDisposable
{
    [ModuleInitializer]
    internal static void IsolateGit()
    {
        // Child git processes inherit these, so no test reads or writes the developer's config.
        Environment.SetEnvironmentVariable("GIT_CONFIG_GLOBAL", OperatingSystem.IsWindows() ? "NUL" : "/dev/null");
        Environment.SetEnvironmentVariable("GIT_CONFIG_NOSYSTEM", "1");
        Environment.SetEnvironmentVariable("GIT_AUTHOR_NAME", "Test");
        Environment.SetEnvironmentVariable("GIT_AUTHOR_EMAIL", "user@example.com");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_NAME", "Test");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_EMAIL", "user@example.com");
    }

    public GitSandbox()
    {
        // Resolved, because git reports real paths and macOS keeps its temp directory behind a link.
        var created = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "forgitten-tests", Guid.NewGuid().ToString("N")));
        Root = ResolveParents(created.FullName);
    }

    public string Root { get; }

    public string PathOf(params string[] parts) => Path.Combine([Root, .. parts]);

    /// <summary>A bare repository to push to, and a clone of it with one pushed commit on main.</summary>
    public string Clone(string name)
    {
        var remote = PathOf($"{name}.remote");
        Directory.CreateDirectory(remote);
        Git(remote, "init", "--bare", "--initial-branch=main");

        var clone = PathOf(name);
        Git(Root, "clone", remote, clone);
        Git(clone, "checkout", "-b", "main");
        Commit(clone, "README.md", "hello");
        Git(clone, "push", "-u", "origin", "main");
        return clone;
    }

    /// <summary>A repository with one commit and no remote.</summary>
    public string Local(string name)
    {
        var repo = Init(name);
        Commit(repo, "README.md", "hello");
        return repo;
    }

    public string Init(string name)
    {
        var repo = PathOf(name);
        Directory.CreateDirectory(repo);
        Git(repo, "init", "--initial-branch=main");
        return repo;
    }

    public void Commit(string repo, string file, string content)
    {
        File.WriteAllText(Path.Combine(repo, file), content);
        Git(repo, "add", file);
        Git(repo, "commit", "-m", $"change {file}");
    }

    public static string Git(string directory, params string[] args)
    {
        var result = GitRunner.Run(directory, args);
        Assert.True(result.Ok, $"git {string.Join(' ', args)} failed: {result.Error}");
        return result.Output.Trim();
    }

    private static string ResolveParents(string path)
    {
        var parts = path.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        var resolved = Path.DirectorySeparatorChar.ToString();
        foreach (var part in parts)
        {
            resolved = Path.Combine(resolved, part);
            var target = new DirectoryInfo(resolved).ResolveLinkTarget(returnFinalTarget: true);
            if (target is not null) resolved = target.FullName;
        }

        return resolved;
    }

    public void Dispose()
    {
        // Git marks its object files read-only; clear that so the tree can go.
        foreach (var file in Directory.EnumerateFiles(Root, "*", new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = 0 }))
            File.SetAttributes(file, FileAttributes.Normal);
        Directory.Delete(Root, recursive: true);
    }
}
