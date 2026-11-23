using System.Text.Json;
using System.Text.Json.Serialization;

namespace Forgitten.Fleet;

public class SignInException(string message, bool signInAgain = false) : Exception(message)
{
    /// <summary>The stored sign-in is no longer accepted; only a new <c>fleet join</c> fixes it.</summary>
    public bool SignInAgain { get; } = signInAgain;
}

public record DeviceCodePrompt(string UserCode, string VerificationUri, string Message);

public record TokenSet(string AccessToken, string? RefreshToken);

/// <summary>
/// Signs a device in to Microsoft Entra with the device code flow and keeps
/// the sign-in alive with the refresh token. Plain OAuth 2.0 over HTTP.
/// </summary>
public class EntraAuth(HttpClient http, string authority, string tenantId, string clientId, string scope)
{
    private const string DeviceGrant = "urn:ietf:params:oauth:grant-type:device_code";

    private string Endpoint(string name) => $"{authority.TrimEnd('/')}/{tenantId}/oauth2/v2.0/{name}";

    // offline_access is what makes Entra return a refresh token.
    private string Scopes => $"{scope} offline_access";

    public async Task<TokenSet> DeviceLoginAsync(Action<DeviceCodePrompt> show, CancellationToken cancel)
    {
        var started = await PostAsync<DeviceCodeResponse>("devicecode", new() { ["client_id"] = clientId, ["scope"] = Scopes }, cancel);
        if (started.DeviceCode is null || started.UserCode is null || started.VerificationUri is null)
            throw new SignInException($"Sign-in could not start: {started.ErrorDescription ?? started.Error ?? "no device code returned"}");

        show(new DeviceCodePrompt(started.UserCode, started.VerificationUri, started.Message ?? $"Open {started.VerificationUri} and enter the code {started.UserCode}."));

        var interval = TimeSpan.FromSeconds(Math.Max(1, started.Interval ?? 5));
        var deadline = DateTimeOffset.UtcNow.AddSeconds(started.ExpiresIn ?? 900);

        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(interval, cancel);
            var token = await PostAsync<TokenResponse>("token", new() { ["grant_type"] = DeviceGrant, ["client_id"] = clientId, ["device_code"] = started.DeviceCode }, cancel);

            switch (token.Error)
            {
                case null when token.AccessToken is not null:
                    return new TokenSet(token.AccessToken, token.RefreshToken);
                case "authorization_pending":
                    continue;
                case "slow_down":
                    interval += TimeSpan.FromSeconds(5);
                    continue;
                default:
                    throw new SignInException($"Sign-in failed: {token.ErrorDescription ?? token.Error ?? "no token returned"}");
            }
        }

        throw new SignInException("Sign-in timed out before the code was entered.");
    }

    public async Task<TokenSet> RefreshAsync(string refreshToken, CancellationToken cancel)
    {
        var token = await PostAsync<TokenResponse>("token", new() { ["grant_type"] = "refresh_token", ["client_id"] = clientId, ["refresh_token"] = refreshToken, ["scope"] = Scopes }, cancel);
        if (token.AccessToken is not null) return new TokenSet(token.AccessToken, token.RefreshToken);

        // invalid_grant: the refresh token expired or was revoked. Anything else may pass on its own.
        throw new SignInException($"Sign-in could not be renewed: {token.ErrorDescription ?? token.Error ?? "no token returned"}", signInAgain: token.Error == "invalid_grant");
    }

    private async Task<T> PostAsync<T>(string endpoint, Dictionary<string, string> form, CancellationToken cancel)
    {
        using var response = await http.PostAsync(Endpoint(endpoint), new FormUrlEncodedContent(form), cancel);
        var body = await response.Content.ReadAsStringAsync(cancel);
        try
        {
            // Entra answers errors with the same JSON shape and a 400, so the status is not checked first.
            return JsonSerializer.Deserialize<T>(body) ?? throw new JsonException("empty body");
        }
        catch (JsonException)
        {
            throw new SignInException($"{Endpoint(endpoint)} answered {(int)response.StatusCode} with something that is not JSON.");
        }
    }

    private record DeviceCodeResponse(
        [property: JsonPropertyName("device_code")] string? DeviceCode,
        [property: JsonPropertyName("user_code")] string? UserCode,
        [property: JsonPropertyName("verification_uri")] string? VerificationUri,
        [property: JsonPropertyName("expires_in")] int? ExpiresIn,
        [property: JsonPropertyName("interval")] int? Interval,
        [property: JsonPropertyName("message")] string? Message,
        [property: JsonPropertyName("error")] string? Error,
        [property: JsonPropertyName("error_description")] string? ErrorDescription);

    private record TokenResponse(
        [property: JsonPropertyName("access_token")] string? AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("error")] string? Error,
        [property: JsonPropertyName("error_description")] string? ErrorDescription);
}
