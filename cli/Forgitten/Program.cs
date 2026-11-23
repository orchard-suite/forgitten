using System.CommandLine;
using Forgitten.Fleet;
using Forgitten.Git;
using Forgitten.Output;
using Forgitten.Scan;

// Scan -----------------------------------------------------------------------

var pathArgument = new Argument<DirectoryInfo[]>("path")
{
    Description = "Directories to scan for git repositories (default: current directory)",
    Arity = ArgumentArity.ZeroOrMore,
};
var jsonOption = new Option<bool>("--json") { Description = "Output the full report as JSON" };
var dirtyOption = new Option<bool>("--dirty") { Description = "Show only repos with uncommitted changes" };
var unsyncedOption = new Option<bool>("--unsynced") { Description = "Show only repos with unsynced branches" };
var ignoreOption = new Option<string[]>("--ignore") { Description = "Glob patterns to skip (repeatable)", AllowMultipleArgumentsPerToken = true };
var noColorOption = new Option<bool>("--no-color") { Description = "Disable colored output" };
var quietOption = new Option<bool>("--quiet", "-q") { Description = "Summary line only" };

var root = new RootCommand("Find git repos with work that has not left this machine: uncommitted changes, unpushed commits, stashes.")
{
    pathArgument, jsonOption, dirtyOption, unsyncedOption, ignoreOption, noColorOption, quietOption,
};

root.SetAction(parse =>
{
    var paths = parse.GetValue(pathArgument) is { Length: > 0 } given ? given : [new DirectoryInfo(Directory.GetCurrentDirectory())];
    var missing = paths.FirstOrDefault(p => !p.Exists);
    if (missing is not null)
    {
        Console.Error.WriteLine($"Error: Path '{missing.FullName}' does not exist");
        return 2;
    }

    if (!GitRunner.IsAvailable())
    {
        Console.Error.WriteLine("Error: git command not found");
        return 2;
    }

    var report = Scanner.Scan(paths.Select(p => p.FullName).ToList(), parse.GetValue(ignoreOption) ?? []);
    var attention = report.NeedsAttention;

    var dirty = parse.GetValue(dirtyOption);
    var unsynced = parse.GetValue(unsyncedOption);
    if (dirty || unsynced)
        report = report with { Repos = report.Repos.Where(r => (!dirty || r.HasUncommitted) && (!unsynced || r.HasUnsynced)).ToList() };

    OutputRenderer.Render(report, new OutputOptions(parse.GetValue(jsonOption), parse.GetValue(quietOption), parse.GetValue(noColorOption)));
    return attention ? 1 : 0;
});

// Fleet ----------------------------------------------------------------------

var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
http.DefaultRequestHeaders.UserAgent.ParseAdd($"forgitten/{Scanner.Version}");
var fleet = new FleetCommands(new FleetStore(), http, Console.Out, Console.Error);

var hubArgument = new Argument<string>("hub") { Description = "URL of the forgitten hub, like https://forgitten.example.org" };
var tenantOption = new Option<string>("--tenant") { Description = "Microsoft Entra tenant id the hub signs in with", Required = true };
var clientOption = new Option<string>("--client") { Description = "Client id of the hub's Entra app registration", Required = true };
var authorityOption = new Option<string>("--authority") { Description = "Entra sign-in host", DefaultValueFactory = _ => FleetCommands.DefaultAuthority };
var scopeOption = new Option<string?>("--scope") { Description = $"Scope to ask for (default: api://<client>/{FleetCommands.ScopeName})" };
var nameOption = new Option<string?>("--name") { Description = "Name this device shows under (default: its host name)" };
var fleetPathOption = new Option<string[]>("--path") { Description = "Directory this device scans (repeatable)", AllowMultipleArgumentsPerToken = true };
var fleetIgnoreOption = new Option<string[]>("--ignore") { Description = "Glob patterns to skip (repeatable)", AllowMultipleArgumentsPerToken = true };
var joinIntervalOption = new Option<int?>("--interval") { Description = $"Minutes between scheduled reports (default: {Schedule.DefaultMinutes}, or the device's current interval)" };
var noAgentOption = new Option<bool>("--no-agent") { Description = "Do not install the schedule; report only when `fleet report` is run" };

var join = new Command("join", "Sign in, add this device to a hub's fleet, and report on a schedule")
{
    hubArgument, tenantOption, clientOption, authorityOption, scopeOption, nameOption, fleetPathOption, fleetIgnoreOption, joinIntervalOption, noAgentOption,
};
join.SetAction((parse, cancel) => fleet.JoinAsync(
    new JoinOptions(
        parse.GetValue(hubArgument)!,
        parse.GetValue(tenantOption)!,
        parse.GetValue(clientOption)!,
        parse.GetValue(authorityOption)!,
        parse.GetValue(scopeOption),
        parse.GetValue(nameOption),
        parse.GetValue(fleetPathOption) ?? [],
        parse.GetValue(fleetIgnoreOption) ?? [],
        Agent: !parse.GetValue(noAgentOption),
        IntervalMinutes: parse.GetValue(joinIntervalOption)),
    cancel));

var report = new Command("report", "Scan this device's directories and send the result to the hub");
report.SetAction((_, cancel) => fleet.ReportAsync(cancel));

var pathsArgument = new Argument<string[]>("path") { Description = "Directories", Arity = ArgumentArity.OneOrMore };
var pathsList = new Command("list", "Show the directories this device scans");
pathsList.SetAction(_ => fleet.ListPaths());
var pathsAdd = new Command("add", "Scan more directories, and report at once") { pathsArgument };
pathsAdd.SetAction((parse, cancel) => fleet.AddPathsAsync(parse.GetValue(pathsArgument) ?? [], cancel));
var pathsRemove = new Command("remove", "Stop scanning directories, and report at once") { pathsArgument };
pathsRemove.SetAction((parse, cancel) => fleet.RemovePathsAsync(parse.GetValue(pathsArgument) ?? [], cancel));
var paths = new Command("paths", "Change which directories this device scans, without signing in again") { pathsList, pathsAdd, pathsRemove };

var status = new Command("status", "Show what this device reports and where");
status.SetAction(_ => fleet.Status());

var leave = new Command("leave", "Remove this device from the fleet and stop reporting");
leave.SetAction((_, cancel) => fleet.LeaveAsync(cancel));

var intervalOption = new Option<int>("--interval") { Description = "Minutes between reports", DefaultValueFactory = _ => Schedule.DefaultMinutes };
var agentInstall = new Command("install", "Report on a schedule, run by the operating system") { intervalOption };
agentInstall.SetAction(parse => fleet.InstallAgent(parse.GetValue(intervalOption)));

var agentUninstall = new Command("uninstall", "Stop reporting on a schedule");
agentUninstall.SetAction(_ => fleet.UninstallAgent());

root.Subcommands.Add(new Command("fleet", "Report this device to a forgitten hub")
{
    join, report, status, paths, leave,
    new Command("agent", "Manage the scheduled report") { agentInstall, agentUninstall },
});

// The parser drops a first argument whose file name is the program's own name,
// which is exactly what a path to a clone of this repository looks like. Naming
// the program first gives it that token to drop instead.
return await root.Parse([root.Name, .. args]).InvokeAsync();
