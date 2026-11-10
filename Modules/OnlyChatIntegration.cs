using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace AiEducationalBook.Modules;

public sealed record OnlyChatConnection(bool Connected, string Message, string? BaseUrl = null);

/// <summary>Local-only companion client for the user's installed Only Chat app.</summary>
public sealed class OnlyChatIntegration : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(12) };
    private string? _baseUrl;
    private string? _sessionId;
    private static string DataRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OnlyChat");
    private static string EndpointPath => Path.Combine(DataRoot, "runtime", "endpoint.json");
    private static string ExecutablePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "OnlyChat-Electron-1.0.5", "Only Chat.exe");

    public async Task<OnlyChatConnection> ConnectAsync(bool openAppIfOffline, CancellationToken cancellationToken = default)
    {
        var endpoint = ReadVerifiedEndpoint();
        if (endpoint is null)
        {
            if (File.Exists(EndpointPath)) return new(false, "Only Chat's runtime record exists but failed identity checks. Reopen Only Chat from its normal shortcut.");
            if (openAppIfOffline && File.Exists(ExecutablePath))
            {
                Process.Start(new ProcessStartInfo(ExecutablePath) { UseShellExecute = true });
                for (var attempt = 0; attempt < 30 && endpoint is null; attempt++)
                {
                    await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
                    endpoint = ReadVerifiedEndpoint();
                }
            }
            if (endpoint is null) return new(false, File.Exists(ExecutablePath)
                ? "Only Chat did not publish its local endpoint within 30 seconds. Wait for its window to finish loading, then press Connect again."
                : $"Only Chat isn't installed at its known location. Expected: {ExecutablePath}");
        }

        try
        {
            using var response = await _http.GetAsync($"{endpoint.Url}/api/health", cancellationToken);
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var root = json.RootElement;
            if (root.GetProperty("status").GetString() != "ok" || root.GetProperty("pid").GetInt32() != endpoint.Pid || root.GetProperty("port").GetInt32() != endpoint.Port)
                return new(false, "The Only Chat endpoint and its owner process did not match.");
            _baseUrl = endpoint.Url;
            return new(true, $"Connected to Only Chat {endpoint.Version ?? ""}. Messages stay on this PC until you send them; Only Chat then uses its selected provider.", endpoint.Url);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException)
        {
            return new(false, "Only Chat's local API is not ready. Open Only Chat normally, then reconnect.");
        }
    }

    public async Task<string> SendAsync(string prompt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_baseUrl)) throw new InvalidOperationException("Connect to Only Chat first.");
        if (string.IsNullOrWhiteSpace(prompt) || prompt.Length > 20000) throw new ArgumentException("Write a message under 20,000 characters.", nameof(prompt));
        if (_sessionId is null)
        {
            using var created = await PostJsonAsync("/api/sessions/new", new { }, cancellationToken);
            using var json = JsonDocument.Parse(await created.Content.ReadAsStringAsync(cancellationToken));
            _sessionId = json.RootElement.GetProperty("session").GetProperty("sessionId").GetString();
            if (string.IsNullOrWhiteSpace(_sessionId)) throw new InvalidDataException("Only Chat did not return a new conversation ID.");
        }

        var body = JsonSerializer.Serialize(new { sessionId = _sessionId, prompt, managerMode = false, sandboxPolicy = "read-only" });
        using var request = CreateRequest("/api/turn", body);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(3));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync(timeout.Token);
            throw new InvalidOperationException(ExtractError(detail, (int)response.StatusCode));
        }
        using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(stream);
        var answer = new StringBuilder();
        while (await reader.ReadLineAsync(timeout.Token) is { } line)
        {
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var data = line[5..].Trim();
            if (data.Length == 0) continue;
            using var evt = JsonDocument.Parse(data);
            var root = evt.RootElement;
            var type = root.TryGetProperty("type", out var typeValue) ? typeValue.GetString() : null;
            if (type == "message_delta" && root.TryGetProperty("delta", out var delta)) answer.Append(delta.GetString());
            else if (type == "error" || type == "turn_interrupted")
                throw new InvalidOperationException(root.TryGetProperty("message", out var message) ? message.GetString() : "Only Chat could not finish the reply.");
            else if (type == "turn_complete") break;
        }
        return answer.Length > 0 ? answer.ToString() : "Only Chat finished without a text reply.";
    }

    private async Task<HttpResponseMessage> PostJsonAsync(string path, object value, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(value);
        using var request = CreateRequest(path, json);
        var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var status = (int)response.StatusCode;
            var detail = await response.Content.ReadAsStringAsync(cancellationToken);
            var error = ExtractError(detail, status);
            response.Dispose();
            throw new InvalidOperationException(error);
        }
        return response;
    }

    private HttpRequestMessage CreateRequest(string path, string json)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, new Uri(_baseUrl! + path));
        request.Headers.TryAddWithoutValidation("Origin", _baseUrl);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        return request;
    }

    private static string ExtractError(string payload, int status)
    {
        try
        {
            using var json = JsonDocument.Parse(payload);
            if (json.RootElement.TryGetProperty("error", out var error)) return error.GetString() ?? $"Only Chat returned HTTP {status}.";
        }
        catch (JsonException) { }
        return $"Only Chat returned HTTP {status}.";
    }

    private static Endpoint? ReadVerifiedEndpoint()
    {
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(EndpointPath));
            var root = json.RootElement;
            if (root.GetProperty("schemaVersion").GetInt32() != 1) return null;
            var pid = root.GetProperty("pid").GetInt32();
            var port = root.GetProperty("port").GetInt32();
            var host = root.GetProperty("host").GetString();
            var url = root.GetProperty("url").GetString();
            var dataDir = Path.GetFullPath(root.GetProperty("dataDir").GetString()!);
            if (pid < 1 || port is < 1 or > 65535 || host is not ("127.0.0.1" or "localhost") || url != $"http://{host}:{port}" ||
                !string.Equals(dataDir, Path.GetFullPath(DataRoot), StringComparison.OrdinalIgnoreCase)) return null;
            using var process = Process.GetProcessById(pid);
            var imagePath = process.MainModule?.FileName;
            if (string.IsNullOrWhiteSpace(imagePath) || !string.Equals(Path.GetFullPath(imagePath), Path.GetFullPath(ExecutablePath), StringComparison.OrdinalIgnoreCase)) return null;
            return new Endpoint(pid, port, url, root.TryGetProperty("version", out var version) ? version.GetString() : null);
        }
        catch (Exception ex) when (ex is IOException or JsonException or KeyNotFoundException or InvalidOperationException or ArgumentException or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    public void Dispose() => _http.Dispose();
    private sealed record Endpoint(int Pid, int Port, string Url, string? Version);
}
