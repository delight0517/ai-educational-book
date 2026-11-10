using System.IO;
using System.Text.Json;
using System.Windows;

namespace AiEducationalBook;

public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var args = e.Args;
        var smokeIndex = Array.IndexOf(args, "--smoke-test");
        if (smokeIndex >= 0)
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var reportPath = GetArgument(args, "--smoke-report") ?? Path.Combine(Path.GetTempPath(), "ai-educational-book-smoke.json");
            var docxPath = GetArgument(args, "--smoke-docx");
            MainWindow? window = null;
            try
            {
                window = new MainWindow();
                var report = await window.RunSmokeChecksAsync(docxPath);
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(reportPath))!);
                File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
                window.Close();
                Shutdown(report.Passed ? 0 : 1);
            }
            catch (Exception ex)
            {
                try { window?.Close(); } catch { }
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(reportPath))!);
                File.WriteAllText(reportPath, JsonSerializer.Serialize(new { passed = false, error = ex.GetType().Name, message = ex.Message }, new JsonSerializerOptions { WriteIndented = true }));
                Shutdown(1);
            }
            return;
        }

        var main = new MainWindow();
        MainWindow = main;
        main.Show();
    }

    private static string? GetArgument(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
