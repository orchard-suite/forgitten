using Microsoft.Extensions.FileSystemGlobbing;

namespace Forgitten.Git;

/// <summary>Walks a directory tree and returns every directory that is a git checkout.</summary>
public class RepoFinder
{
    /// <summary>Skipped unless the caller names them as a root: dependency trees hold thousands of directories and no work of yours.</summary>
    public static readonly string[] AlwaysIgnored = ["node_modules"];

    // Hidden directories are walked on purpose (worktrees live in them);
    // links are not, so a link back up the tree cannot loop the walk.
    private static readonly EnumerationOptions Walk = new()
    {
        IgnoreInaccessible = true,
        AttributesToSkip = FileAttributes.ReparsePoint,
        RecurseSubdirectories = false,
    };

    private readonly Matcher _ignore = new();

    public RepoFinder(IEnumerable<string>? ignorePatterns)
    {
        foreach (var pattern in AlwaysIgnored.Concat(ignorePatterns ?? []))
        {
            _ignore.AddInclude($"**/{pattern}");
            _ignore.AddInclude($"**/{pattern}/**");
        }
    }

    public List<string> Find(string root)
    {
        var found = new List<string>();
        var pending = new Stack<string>();
        root = Path.GetFullPath(root);
        pending.Push(root);

        while (pending.Count > 0)
        {
            var current = pending.Pop();
            if (current != root && IsIgnored(current, root)) continue;

            try
            {
                // A linked worktree and a submodule carry a `.git` file instead of a directory.
                var marker = Path.Combine(current, ".git");
                if (Directory.Exists(marker) || File.Exists(marker))
                {
                    found.Add(current);
                    continue; // Anything nested in a checkout belongs to that checkout.
                }

                foreach (var child in Directory.EnumerateDirectories(current, "*", Walk)) pending.Push(child);
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
            {
                // Unreadable, or removed while walking: there is nothing here to report.
            }
        }

        found.Sort(StringComparer.Ordinal);
        return found;
    }

    private bool IsIgnored(string path, string root) => _ignore.Match(Path.GetRelativePath(root, path).Replace('\\', '/')).HasMatches;
}
