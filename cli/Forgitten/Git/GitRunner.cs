using System.ComponentModel;
using System.Diagnostics;

namespace Forgitten.Git;

public record GitResult(int ExitCode, string Output, string Error)
{
    public bool Ok => ExitCode == 0;

    public IEnumerable<string> Lines => Output.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.TrimEnd('\r'));

    /// <summary>The first line git wrote to stderr, without its "fatal: " prefix.</summary>
    public string Reason
    {
        get
        {
            var line = Error.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? $"git exited with {ExitCode}";
            return line.StartsWith("fatal: ", StringComparison.Ordinal) ? line[7..] : line;
        }
    }
}

public static class GitRunner
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);

    public static GitResult Run(string workingDir, params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "git",
            WorkingDirectory = workingDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);

        // A scan only reads. Without this, `git status` refreshes the index and
        // takes its lock, which can fail a commit running at the same moment.
        psi.Environment["GIT_OPTIONAL_LOCKS"] = "0";
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
        psi.Environment["LC_ALL"] = "C";

        try
        {
            using var process = Process.Start(psi);
            if (process is null) return new GitResult(-1, string.Empty, "git did not start");
            process.StandardInput.Close();

            // Both pipes are drained at once: git blocks when either fills.
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(Timeout))
            {
                process.Kill(entireProcessTree: true);
                return new GitResult(-1, string.Empty, $"git {args.FirstOrDefault()} timed out after {Timeout.TotalSeconds:0}s");
            }

            return new GitResult(process.ExitCode, stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or IOException)
        {
            return new GitResult(-1, string.Empty, ex.Message);
        }
    }

    public static bool IsAvailable() => Run(Environment.CurrentDirectory, "--version").Ok;
}
