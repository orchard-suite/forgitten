using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Forgitten.Model;

namespace Forgitten.Fleet;

public class HubException(string message, HttpStatusCode? status = null) : Exception(message)
{
    public HttpStatusCode? Status { get; } = status;
}

/// <summary>The hub's device API. Every call carries the Entra access token.</summary>
public class HubClient(HttpClient http, string hubUrl, string accessToken, TimeSpan? retryDelay = null)
{
    private const int Attempts = 3;

    private readonly string _base = hubUrl.TrimEnd('/') + "/ingest/v1";

    private readonly TimeSpan _retryDelay = retryDelay ?? TimeSpan.FromSeconds(5);

    public record Registered(string Id, string Name);

    public Task<Registered> RegisterAsync(DeviceRegistration device, CancellationToken cancel) =>
        ReadAsync<Registered>(HttpMethod.Post, "/devices", device, cancel);

    /// <summary>Refreshes a device the hub already knows. Throws with <see cref="HttpStatusCode.NotFound"/> when it was removed.</summary>
    public Task<Registered> UpdateAsync(string id, DeviceRegistration device, CancellationToken cancel) =>
        ReadAsync<Registered>(HttpMethod.Put, $"/devices/{id}", device, cancel);

    public async Task ReportAsync(string id, ScanReport report, CancellationToken cancel)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/devices/{id}/report", report, cancel);
    }

    public async Task LeaveAsync(string id, CancellationToken cancel)
    {
        using var response = await SendAsync(HttpMethod.Delete, $"/devices/{id}", null, cancel);
    }

    private async Task<T> ReadAsync<T>(HttpMethod method, string path, object body, CancellationToken cancel)
    {
        using var response = await SendAsync(method, path, body, cancel);
        return await response.Content.ReadFromJsonAsync<T>(Json.Wire, cancel) ?? throw new HubException("The hub sent an empty answer.");
    }

    /// <summary>Returns the response only when the hub accepted the call; throws <see cref="HubException"/> otherwise.</summary>
    /// <remarks>
    /// A connection that could not be made is tried again a few seconds later:
    /// the network may still be waking up, and macOS refuses the first local
    /// network connection from a binary it has not seen since an upgrade. Only
    /// a failed connect is retried, so a request the hub may have received is
    /// never sent twice.
    /// </remarks>
    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body, CancellationToken cancel)
    {
        HttpResponseMessage response;
        for (var attempt = 1; ; attempt++)
        {
            using var request = new HttpRequestMessage(method, _base + path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            if (body is not null) request.Content = JsonContent.Create(body, body.GetType(), options: Json.Wire);

            try
            {
                response = await http.SendAsync(request, cancel);
                break;
            }
            catch (HttpRequestException ex) when (ex.HttpRequestError == HttpRequestError.ConnectionError && attempt < Attempts)
            {
                Console.Error.WriteLine($"Could not reach {hubUrl} ({ex.Message}); trying again in {_retryDelay.TotalSeconds:0}s.");
                await Task.Delay(_retryDelay, cancel);
            }
            catch (HttpRequestException ex)
            {
                throw new HubException($"Could not reach {hubUrl}: {ex.Message}");
            }
        }

        if (response.IsSuccessStatusCode) return response;

        using (response)
        {
            throw new HubException($"The hub answered {(int)response.StatusCode}: {await ReadErrorAsync(response, cancel)}", response.StatusCode);
        }
    }

    private static async Task<string> ReadErrorAsync(HttpResponseMessage response, CancellationToken cancel)
    {
        try
        {
            var parsed = await response.Content.ReadFromJsonAsync<ErrorBody>(Json.Wire, cancel);
            if (!string.IsNullOrEmpty(parsed?.Error)) return parsed.Error;
        }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or NotSupportedException)
        {
            // Not the hub's own error shape: something in front of it answered instead.
        }

        return response.ReasonPhrase ?? "no reason given";
    }

    private record ErrorBody(string? Error);
}
