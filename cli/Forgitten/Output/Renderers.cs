using System.Text.Json;
using Forgitten.Model;
using Spectre.Console;

namespace Forgitten.Output;

public record OutputOptions(bool Json, bool Quiet, bool NoColor);

public static class OutputRenderer
{
    public static void Render(ScanReport report, OutputOptions options)
    {
        if (options.Json)
        {
            // Quiet JSON keeps the shape a script reads the summary from.
            object output = options.Quiet ? new { summary = report.Summary } : report;
            Console.WriteLine(JsonSerializer.Serialize(output, Json.Pretty));
            return;
        }

        if (options.Quiet)
        {
            Console.WriteLine(ReportRows.SummaryLine(report.Summary));
            return;
        }

        if (Console.IsOutputRedirected || options.NoColor) Plain(report);
        else Table(report);
    }

    private static void Plain(ScanReport report)
    {
        Console.WriteLine("Repository\tBranch\tChanges\tSync");
        Console.WriteLine(new string('-', 60));

        foreach (var repo in report.Repos)
            foreach (var row in ReportRows.For(repo))
                Console.WriteLine($"{repo.Name}\t{row.Branch}\t{row.Changes}\t{row.Sync}");

        Console.WriteLine();
        Console.WriteLine(ReportRows.SummaryLine(report.Summary));
    }

    private static void Table(ScanReport report)
    {
        var table = new Table().Border(TableBorder.Rounded);
        table.AddColumn("Repository");
        table.AddColumn("Branch");
        table.AddColumn("Changes");
        table.AddColumn("Sync");

        foreach (var repo in report.Repos)
        {
            var first = true;
            foreach (var row in ReportRows.For(repo))
            {
                var name = !first ? string.Empty : repo.IsClean ? $"[green]{Markup.Escape(repo.Name)}[/]" : $"[red]{Markup.Escape(repo.Name)}[/]";
                var branch = row.Current ? $"[bold]{Markup.Escape(row.Branch)}[/]" : Markup.Escape(row.Branch);
                table.AddRow(name, branch, Cell(row.Changes, quiet: row.Changes is "clean" or "-"), Cell(row.Sync, quiet: row.Sync is "in sync" or "-"));
                first = false;
            }
        }

        AnsiConsole.Write(table);

        var s = report.Summary;
        var errors = s.Errors > 0 ? $", [red]{s.Errors}[/] unreadable" : string.Empty;
        AnsiConsole.MarkupLine($"\n[bold]{s.Dirty}[/] dirty, [bold]{s.Unsynced}[/] unsynced, [green]{s.Clean}[/] clean of [bold]{s.Total}[/] total{errors}");
    }

    private static string Cell(string text, bool quiet) => quiet ? $"[dim]{Markup.Escape(text)}[/]" : $"[red]{Markup.Escape(text)}[/]";
}
