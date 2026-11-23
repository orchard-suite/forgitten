using System.Net;
using System.Text;
using Forgitten.Fleet;

namespace Forgitten.Tests;

public class FleetTests
{
    /// <summary>Answers each request with the next canned response and records what was asked.</summary>
    private sealed class Script(params (HttpStatusCode Status, string Body)[] answers) : HttpMessageHandler
    {
        private readonly Queue<(HttpStatusCode Status, string Body)> _answers = new(answers);

        public List<(string Url, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel)
        {
            Requests.Add((request.RequestUri!.ToString(), request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancel)));
            var (status, body) = _answers.Dequeue();
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static EntraAuth Auth(Script script) =>
        new(new HttpClient(script), "https://login.example.org/", "tenant-1", "client-1", "api://client-1/Fleet.Report");

    [Fact]
    public async Task Device_login_waits_while_pending_then_returns_both_tokens()
    {
        var script = new Script(
            (HttpStatusCode.OK, """{"device_code":"dc","user_code":"ABCD","verification_uri":"https://login.example.org/device","expires_in":60,"interval":0,"message":"go"}"""),
            (HttpStatusCode.BadRequest, """{"error":"authorization_pending"}"""),
            (HttpStatusCode.OK, """{"access_token":"at","refresh_token":"rt"}"""));
        DeviceCodePrompt? shown = null;

        var tokens = await Auth(script).DeviceLoginAsync(p => shown = p, CancellationToken.None);

        Assert.Equal(new TokenSet("at", "rt"), tokens);
        Assert.Equal("ABCD", shown?.UserCode);
        Assert.Equal("https://login.example.org/tenant-1/oauth2/v2.0/devicecode", script.Requests[0].Url);
        Assert.Contains("scope=api%3A%2F%2Fclient-1%2FFleet.Report+offline_access", script.Requests[0].Body);
        Assert.Equal("https://login.example.org/tenant-1/oauth2/v2.0/token", script.Requests[1].Url);
    }

    [Fact]
    public async Task Device_login_reports_a_refusal()
    {
        var script = new Script(
            (HttpStatusCode.OK, """{"device_code":"dc","user_code":"ABCD","verification_uri":"https://login.example.org/device","expires_in":60,"interval":0}"""),
            (HttpStatusCode.BadRequest, """{"error":"authorization_declined","error_description":"The user said no."}"""));

        var error = await Assert.ThrowsAsync<SignInException>(() => Auth(script).DeviceLoginAsync(_ => { }, CancellationToken.None));

        Assert.Contains("The user said no.", error.Message);
    }

    [Fact]
    public async Task A_refused_refresh_token_asks_for_a_new_sign_in()
    {
        var script = new Script((HttpStatusCode.BadRequest, """{"error":"invalid_grant","error_description":"expired"}"""));

        var error = await Assert.ThrowsAsync<SignInException>(() => Auth(script).RefreshAsync("old", CancellationToken.None));

        Assert.True(error.SignInAgain);
    }

    [Fact]
    public async Task A_sign_in_host_that_is_down_does_not_ask_for_a_new_sign_in()
    {
        var script = new Script((HttpStatusCode.BadGateway, "<html>bad gateway</html>"));

        var error = await Assert.ThrowsAsync<SignInException>(() => Auth(script).RefreshAsync("old", CancellationToken.None));

        Assert.False(error.SignInAgain);
    }

    /// <summary>Refuses the connection a set number of times, then answers.</summary>
    private sealed class Unreachable(int failures, HttpRequestError error = HttpRequestError.ConnectionError) : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel)
        {
            if (++Calls <= failures) throw new HttpRequestException(error, "No route to host");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}", Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task A_hub_that_cannot_be_reached_at_first_is_tried_again()
    {
        var handler = new Unreachable(failures: 2);
        var hub = new HubClient(new HttpClient(handler), "https://hub.example.org", "at", TimeSpan.Zero);

        await hub.LeaveAsync("id-1", CancellationToken.None);

        Assert.Equal(3, handler.Calls);
    }

    [Fact]
    public async Task A_hub_that_stays_unreachable_fails_after_three_tries()
    {
        var handler = new Unreachable(failures: 10);
        var hub = new HubClient(new HttpClient(handler), "https://hub.example.org", "at", TimeSpan.Zero);

        var error = await Assert.ThrowsAsync<HubException>(() => hub.LeaveAsync("id-1", CancellationToken.None));

        Assert.Contains("Could not reach https://hub.example.org", error.Message);
        Assert.Equal(3, handler.Calls);
    }

    [Fact]
    public async Task A_request_that_may_have_reached_the_hub_is_not_sent_again()
    {
        var handler = new Unreachable(failures: 1, HttpRequestError.ResponseEnded);
        var hub = new HubClient(new HttpClient(handler), "https://hub.example.org", "at", TimeSpan.Zero);

        await Assert.ThrowsAsync<HubException>(() => hub.LeaveAsync("id-1", CancellationToken.None));

        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("https://hub.example.org", true)]
    [InlineData("http://localhost:8081", true)]
    [InlineData("http://127.0.0.1:8081", true)]
    [InlineData("http://[::1]:8081", true)]
    [InlineData("http://hub.example.org", false)]
    [InlineData("http://10.0.0.5:8081", false)]
    [InlineData("ftp://hub.example.org", false)]
    [InlineData("hub.example.org", false)]
    public void A_sign_in_token_goes_only_over_https_or_to_this_machine(string url, bool safe)
    {
        Assert.Equal(safe, FleetCommands.InsecureUrl("hub", url) is null);
    }

    [Fact]
    public async Task Join_refuses_a_plain_http_hub_before_signing_in()
    {
        var directory = Path.Combine(Path.GetTempPath(), "forgitten-tests", Guid.NewGuid().ToString("N"));
        var script = new Script();
        var errors = new StringWriter();
        try
        {
            var fleet = new FleetCommands(new FleetStore(directory), new HttpClient(script), TextWriter.Null, errors);
            var options = new JoinOptions("http://hub.example.org", "t", "c", FleetCommands.DefaultAuthority, null, null, [Path.GetTempPath()], [], Agent: true, IntervalMinutes: null);

            Assert.Equal(2, await fleet.JoinAsync(options, CancellationToken.None));
            Assert.Contains("must use https", errors.ToString());
            Assert.Empty(script.Requests);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task Join_refuses_an_interval_under_a_minute_before_signing_in()
    {
        var script = new Script();
        var errors = new StringWriter();
        var fleet = new FleetCommands(new FleetStore(Path.Combine(Path.GetTempPath(), "forgitten-tests", Guid.NewGuid().ToString("N"))), new HttpClient(script), TextWriter.Null, errors);
        var options = new JoinOptions("https://hub.example.org", "t", "c", FleetCommands.DefaultAuthority, null, null, [Path.GetTempPath()], [], Agent: true, IntervalMinutes: 0);

        Assert.Equal(2, await fleet.JoinAsync(options, CancellationToken.None));
        Assert.Contains("--interval must be at least 1 minute", errors.ToString());
        Assert.Empty(script.Requests);
    }

    [Fact]
    public void Stored_sign_in_survives_a_round_trip_and_only_its_owner_can_read_it()
    {
        var directory = Path.Combine(Path.GetTempPath(), "forgitten-tests", Guid.NewGuid().ToString("N"));
        try
        {
            var store = new FleetStore(directory);
            var config = new FleetConfig("https://hub.example.org", "https://login.example.org", "t", "c", "s", "id-1", "laptop", ["/src"], ["tmp"], 15);

            store.Save(config);
            store.Save(new FleetCredentials("rt"));

            Assert.Equivalent(config, store.LoadConfig());
            Assert.Equal("rt", store.LoadCredentials()?.RefreshToken);
            if (!OperatingSystem.IsWindows())
                Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Path.Combine(directory, "credentials.json")));

            store.Clear();
            Assert.Null(store.LoadConfig());
            Assert.Null(store.LoadCredentials());
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void The_launchd_job_runs_the_report_as_the_installing_person_with_their_environment()
    {
        var plist = Schedule.LaunchdPlist("/opt/tools & more/forgitten", 15, "/tmp/agent.log", "com.forgitten.agent.dev", "dev", new Dictionary<string, string> { ["PATH"] = "/usr/bin:/opt/homebrew/bin", ["HOME"] = "/Users/dev" });

        Assert.Contains("<string>/opt/tools &amp; more/forgitten</string>", plist);
        Assert.Contains("<string>fleet</string>", plist);
        Assert.Contains("<string>report</string>", plist);
        Assert.Contains("<integer>900</integer>", plist);
        Assert.Contains("<string>/usr/bin:/opt/homebrew/bin</string>", plist);
        Assert.Contains("<string>/Users/dev</string>", plist);
        Assert.Matches(@"<key>UserName</key>\s*<string>dev</string>", plist);
        Assert.Contains("<string>com.forgitten.agent.dev</string>", plist);
    }

    [Fact]
    public void The_launchd_job_is_a_property_list_macos_accepts()
    {
        if (!OperatingSystem.IsMacOS()) return;

        var path = Path.Combine(Path.GetTempPath(), $"forgitten-{Guid.NewGuid():N}.plist");
        try
        {
            File.WriteAllText(path, Schedule.LaunchdPlist("/opt/tools & more/forgitten", 15, "/tmp/agent.log", "com.forgitten.agent.dev", "dev", new Dictionary<string, string> { ["PATH"] = "/usr/bin" }));
            using var lint = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("plutil", ["-lint", path]) { RedirectStandardOutput = true })!;
            lint.WaitForExit();
            Assert.True(lint.ExitCode == 0, lint.StandardOutput.ReadToEnd());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void A_custom_config_directory_gets_a_schedule_of_its_own()
    {
        Assert.Equal("forgitten", Schedule.NameFor(null));
        Assert.Equal("forgitten", Schedule.NameFor(""));
        Assert.StartsWith("forgitten-", Schedule.NameFor("/tmp/one"));
        Assert.Equal(Schedule.NameFor("/tmp/one"), Schedule.NameFor("/tmp/one"));
        Assert.NotEqual(Schedule.NameFor("/tmp/one"), Schedule.NameFor("/tmp/two"));
    }

    [Fact]
    public void The_systemd_units_quote_the_binary_and_fire_on_the_interval()
    {
        var service = Schedule.SystemdService("/home/me/my tools/forgitten", new Dictionary<string, string> { ["PATH"] = "/usr/bin" });
        var timer = Schedule.SystemdTimer(20);

        Assert.Contains("ExecStart=\"/home/me/my tools/forgitten\" fleet report", service);
        Assert.Contains("Environment=\"PATH=/usr/bin\"", service);
        Assert.Contains("OnUnitActiveSec=20min", timer);
    }
}
