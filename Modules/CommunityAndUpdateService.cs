using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AiEducationalBook;

public sealed record UpdateCheckResult(
    bool Ok,
    bool UpdateAvailable,
    string CurrentVersion,
    string LatestTag,
    string ReleaseUrl,
    string? DownloadUrl,
    string ReleaseNotes,
    string Message);

public sealed record FeedbackBundleResult(
    bool Ok,
    string ZipPath,
    string StagingDir,
    string SummaryText,
    string Message);

public static class CommunityAndUpdateService
{
    public const string RepoUrl = "https://github.com/delight0517/ai-educational-book";
    public const string HomepageUrl = "https://delight0517.github.io/ai-educational-book/";
    public const string DiscordInviteUrl = "https://discord.gg/Ks78BjAhKK";
    public const string IssuesNewUrl = "https://github.com/delight0517/ai-educational-book/issues/new";
    public const string LatestReleaseApiUrl = "https://api.github.com/repos/delight0517/ai-educational-book/releases/latest";

    public static string GetCurrentVersion()
    {
        var ver = Assembly.GetExecutingAssembly().GetName().Version;
        return ver == null ? "1.0.0" : $"{ver.Major}.{ver.Minor}.{ver.Build}";
    }

    public static void OpenExternalUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            throw new ArgumentException("Only HTTP/HTTPS URLs are allowed.", nameof(url));
        }
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    public static async Task<UpdateCheckResult> CheckForUpdatesAsync()
    {
        var current = GetCurrentVersion();
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("AI-Educational-Book/" + current);
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

        try
        {
            using var response = await client.GetAsync(LatestReleaseApiUrl).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                return new UpdateCheckResult(false, false, current, current, RepoUrl + "/releases", null, "",
                    $"업데이트 확인 실패 (HTTP {(int)response.StatusCode})");
            }

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var tag = root.TryGetProperty("tag_name", out var tagProp) ? (tagProp.GetString() ?? current) : current;
            var htmlUrl = root.TryGetProperty("html_url", out var urlProp) ? (urlProp.GetString() ?? RepoUrl + "/releases") : RepoUrl + "/releases";
            var notes = root.TryGetProperty("body", out var bodyProp) ? (bodyProp.GetString() ?? "") : "";

            string? zipUrl = null;
            if (root.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
            {
                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.TryGetProperty("name", out var n) ? (n.GetString() ?? "") : "";
                    var dl = asset.TryGetProperty("browser_download_url", out var d) ? d.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(dl) && name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        zipUrl = dl;
                        break;
                    }
                }
            }

            var hasUpdate = IsNewerRelease(current, tag);
            var msg = hasUpdate
                ? $"새 버전({tag})이 있습니다! (현재: v{current})"
                : $"최신 버전을 사용 중입니다 (현재: v{current}, 최신: {tag}).";
            return new UpdateCheckResult(true, hasUpdate, current, tag, htmlUrl, zipUrl, notes, msg);
        }
        catch (Exception ex)
        {
            return new UpdateCheckResult(false, false, current, current, RepoUrl + "/releases", null, "",
                "업데이트 확인 중 오류: " + ex.Message);
        }
    }

    private static bool IsNewerRelease(string current, string latestTag)
    {
        var cleanCur = current.TrimStart('v', 'V').Split('-', '+')[0];
        var cleanLatest = latestTag.TrimStart('v', 'V').Replace("unified-", "", StringComparison.OrdinalIgnoreCase).Split('-', '+')[0];
        if (Version.TryParse(cleanCur, out var curV) && Version.TryParse(cleanLatest, out var latV))
        {
            return latV > curV && !latestTag.StartsWith("unified-", StringComparison.OrdinalIgnoreCase);
        }
        return !string.Equals(cleanCur, cleanLatest, StringComparison.OrdinalIgnoreCase);
    }

    public static FeedbackBundleResult CreateFeedbackBundle(string category, string userMessage, string appStatus, bool onlyChatConnected)
    {
        try
        {
            var rootDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AI Educational Book",
                "feedback");
            Directory.CreateDirectory(rootDir);

            var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            var stagingDir = Path.Combine(rootDir, $"feedback-{stamp}");
            Directory.CreateDirectory(stagingDir);

            var info = new
            {
                app = "AI Educational Book",
                version = GetCurrentVersion(),
                os = Environment.OSVersion.VersionString,
                dotnet = Environment.Version.ToString(),
                onlyChatConnected,
                appStatus,
                category,
                userMessage = userMessage.Trim(),
                createdAtUtc = DateTime.UtcNow.ToString("O")
            };

            var json = JsonSerializer.Serialize(info, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(Path.Combine(stagingDir, "feedback-diagnostics.json"), json, Encoding.UTF8);

            var summary = $"[AI Educational Book v{GetCurrentVersion()}] ({category})\n"
                        + $"OS: {Environment.OSVersion.VersionString} | OnlyChat: {(onlyChatConnected ? "Connected" : "Disconnected")}\n"
                        + $"Status: {appStatus}\n\n{userMessage.Trim()}";
            File.WriteAllText(Path.Combine(stagingDir, "summary.txt"), summary, Encoding.UTF8);

            var zipPath = Path.Combine(rootDir, $"aieb-feedback-{stamp}.zip");
            if (File.Exists(zipPath)) File.Delete(zipPath);
            ZipFile.CreateFromDirectory(stagingDir, zipPath);

            return new FeedbackBundleResult(true, zipPath, stagingDir, summary,
                $"피드백 로그 번들을 생성했습니다: {zipPath}");
        }
        catch (Exception ex)
        {
            return new FeedbackBundleResult(false, "", "", "", "피드백 번들 생성 실패: " + ex.Message);
        }
    }
}
