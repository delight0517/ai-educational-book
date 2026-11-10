using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Collections.ObjectModel;
using System.Diagnostics;
using Microsoft.Win32;
using AiEducationalBook.Modules;

namespace AiEducationalBook;

public partial class MainWindow : Window
{
    private readonly ModuleHost _modules = new();
    private readonly DocumentSession _session = new();
    private readonly OnlyChatIntegration _onlyChat = new();
    private readonly ObservableCollection<ChatLine> _chatLines = new();
    private bool _onlyChatConnected;
    private bool _sendingChat;
    private bool _loading;
    private bool _updatingReaderToc;
    private int _page;
    private string? _path;

    public MainWindow()
    {
        InitializeComponent();
        ChatMessages.ItemsSource = _chatLines;
        _modules.Register(new EditorModule());
        _modules.Register(new ReaderModule());
        _modules.InitializeAll();
        ModuleText.Text = _modules.Status;
        _session.LoadRtf(CreateStarterRtf());
        RefreshEditor();
        RefreshContents();
        ShowPage(0);
    }

    public async Task<SmokeReport> RunSmokeChecksAsync(string? docxPath)
    {
        var checks = new List<SmokeCheck>();
        var shellReady = Editor is not null && ReaderPage is not null && ChatComposer is not null;
        checks.Add(new SmokeCheck("WPF shell controls constructed", shellReady, "MainWindow and editor, reader, and chat controls were created; window was not shown."));

        var starterRtf = CreateStarterRtf();
        var starter = new FlowDocument();
        using (var starterStream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(starterRtf)))
            new TextRange(starter.ContentStart, starter.ContentEnd).Load(starterStream, DataFormats.Rtf);
        var starterText = new TextRange(starter.ContentStart, starter.ContentEnd).Text;
        checks.Add(new SmokeCheck("Starter document model loads", starterText.Contains("Welcome to your book", StringComparison.Ordinal), $"RTF parsed {starter.Blocks.Count} blocks and {starterText.Length} characters."));

        const string marker = "AI educational book smoke paragraph";
        var sample = new FlowDocument();
        for (var i = 0; i < 12; i++) sample.Blocks.Add(new Paragraph(new Run($"{marker} {i + 1}")));
        var model = new DocumentSession();
        model.UpdateFromEditor(sample);
        var pageCount = model.Pages.Count;
        checks.Add(new SmokeCheck("Reader page model", pageCount >= 3, $"Grouped 12 sample paragraphs into {pageCount} pages."));

        var textModel = new DocumentSession();
        textModel.LoadPlainText(marker);
        var importedText = new FlowDocument();
        using (var input = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(textModel.Rtf)))
            new TextRange(importedText.ContentStart, importedText.ContentEnd).Load(input, DataFormats.Rtf);
        var textImportRoundTrip = new TextRange(importedText.ContentStart, importedText.ContentEnd).Text.Contains(marker, StringComparison.Ordinal);
        checks.Add(new SmokeCheck("Plain text to RTF model round trip", textImportRoundTrip, "Verified the local document model and RTF text parser."));

        var snapshot = new ModuleState(model.Rtf, Math.Max(0, pageCount - 1));
        var reloadResult = _modules.Reload("editor", snapshot);
        var moduleRecovered = reloadResult.State.DocumentRtf == snapshot.DocumentRtf && reloadResult.State.Page == snapshot.Page;
        checks.Add(new SmokeCheck("Editor module reload restores state", moduleRecovered, reloadResult.Status));

        if (!string.IsNullOrWhiteSpace(docxPath))
        {
            var docxImported = false;
            var details = "DOCX file unavailable.";
            if (File.Exists(docxPath))
            {
                var rtf = DocxTextReader.ReadAsRtf(docxPath);
                var imported = new FlowDocument();
                using var input = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(rtf));
                new TextRange(imported.ContentStart, imported.ContentEnd).Load(input, DataFormats.Rtf);
                docxImported = new TextRange(imported.ContentStart, imported.ContentEnd).Text.Trim().Length > 20;
                details = $"Imported readable text from {Path.GetFileName(docxPath)}.";
            }
            checks.Add(new SmokeCheck("DOCX text import", docxImported, details));
        }

        var chatProbe = await _onlyChat.ConnectAsync(openAppIfOffline: false);
        checks.Add(new SmokeCheck("Only Chat connection status is explicit", chatProbe.Connected || !string.IsNullOrWhiteSpace(chatProbe.Message), chatProbe.Connected ? "Local health check passed; no message was sent." : "Offline state reported; no app was opened and no message was sent."));
        return new SmokeReport(checks, ["Interactive editor typing and save/open in a presented window", "Visual page navigation", "Live Only Chat message/reply"]);
    }

    private static string CreateStarterRtf()
    {
        var document = new FlowDocument { PagePadding = new Thickness(0), ColumnWidth = double.PositiveInfinity };
        document.Blocks.Add(new Paragraph(new Run("Welcome to your book")) { FontSize = 28, FontWeight = FontWeights.Bold });
        document.Blocks.Add(new Paragraph(new Run("This is your writing space. Start with one idea, explain it in your own words, then add examples that help a reader understand.")) { FontSize = 16 });
        document.Blocks.Add(new Paragraph(new Run("A small first step")) { FontSize = 23, FontWeight = FontWeights.SemiBold });
        document.Blocks.Add(new Paragraph(new Run("Write a short paragraph, then switch to Read to see it as a page. Your draft is saved locally when you choose Save.")) { FontSize = 16 });
        using var stream = new MemoryStream();
        new TextRange(document.ContentStart, document.ContentEnd).Save(stream, DataFormats.Rtf);
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private void Editor_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_loading || Editor is null) return;
        _session.UpdateFromEditor(Editor.Document);
        RefreshContents();
        StatusText.Text = "Unsaved changes";
    }

    private void RefreshEditor()
    {
        _loading = true;
        try
        {
            using var ms = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(_session.Rtf));
            new TextRange(Editor.Document.ContentStart, Editor.Document.ContentEnd).Load(ms, DataFormats.Rtf);
            Editor.Document.PagePadding = new Thickness(0);
            Editor.Document.ColumnWidth = double.PositiveInfinity;
            EditorToc.ItemsSource = _session.Headings;
        }
        finally { _loading = false; }
    }

    private void RefreshContents()
    {
        _session.UpdateFromEditor(Editor.Document, markUnsaved: false);
        EditorToc.ItemsSource = null;
        EditorToc.ItemsSource = _session.Headings;
        _updatingReaderToc = true;
        try
        {
            ReaderToc.ItemsSource = null;
            ReaderToc.ItemsSource = _session.Headings;
        }
        finally { _updatingReaderToc = false; }
        if (_page >= _session.Pages.Count) _page = Math.Max(0, _session.Pages.Count - 1);
    }

    private void ShowPage(int page)
    {
        RefreshContents();
        if (_session.Pages.Count == 0) return;
        _page = Math.Clamp(page, 0, _session.Pages.Count - 1);
        var flow = new FlowDocument { PagePadding = new Thickness(0), ColumnWidth = double.PositiveInfinity };
        var content = _session.Pages[_page];
        foreach (var block in content.Blocks) flow.Blocks.Add(CloneBlock(block));
        ReaderPage.Document = flow;
        PageLabel.Text = $"{_page + 1} / {_session.Pages.Count}";
        var chapterIndex = _session.Headings.FindIndex(chapter => chapter.Page == _page);
        if (chapterIndex >= 0)
        {
            _updatingReaderToc = true;
            try { ReaderToc.SelectedIndex = chapterIndex; }
            finally { _updatingReaderToc = false; }
        }
    }

    private static Block CloneBlock(Block source)
    {
        var clone = new Paragraph();
        if (source is Paragraph p)
        {
            clone.Margin = p.Margin;
            clone.FontSize = p.FontSize;
            clone.FontWeight = p.FontWeight;
            foreach (var inline in p.Inlines)
            {
                var run = new Run(new TextRange(inline.ContentStart, inline.ContentEnd).Text) { FontWeight = inline.FontWeight, FontStyle = inline.FontStyle, Foreground = inline.Foreground };
                clone.Inlines.Add(run);
            }
        }
        return clone;
    }

    private void Open_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "Word documents (*.docx)|*.docx|Rich text (*.rtf)|*.rtf|Text files (*.txt)|*.txt", Title = "Open a book" };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            _path = dialog.FileName;
            if (Path.GetExtension(_path).Equals(".docx", StringComparison.OrdinalIgnoreCase))
                _session.LoadRtf(DocxTextReader.ReadAsRtf(_path));
            else if (Path.GetExtension(_path).Equals(".rtf", StringComparison.OrdinalIgnoreCase))
                _session.LoadRtf(File.ReadAllText(_path));
            else _session.LoadPlainText(File.ReadAllText(_path));
            DocumentName.Text = Path.GetFileName(_path);
            RefreshEditor(); RefreshContents(); ShowPage(0);
            StatusText.Text = "Opened locally";
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Could not open document", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (_path is null || !Path.GetExtension(_path).Equals(".rtf", StringComparison.OrdinalIgnoreCase))
        {
            var dialog = new SaveFileDialog { Filter = "Rich text (*.rtf)|*.rtf", FileName = "My book.rtf", Title = "Save your book" };
            if (dialog.ShowDialog(this) != true) return;
            _path = dialog.FileName;
        }
        try
        {
            using var ms = new MemoryStream();
            new TextRange(Editor.Document.ContentStart, Editor.Document.ContentEnd).Save(ms, DataFormats.Rtf);
            File.WriteAllBytes(_path, ms.ToArray());
            _session.MarkSaved();
            DocumentName.Text = Path.GetFileName(_path);
            StatusText.Text = $"Saved · {DateTime.Now:t}";
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Could not save document", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private void WriteTab_Click(object sender, RoutedEventArgs e) => SetMode(false);
    private void ReadTab_Click(object sender, RoutedEventArgs e) { SetMode(true); ShowPage(_page); }
    private void SetMode(bool reader) { EditorView.Visibility = reader ? Visibility.Collapsed : Visibility.Visible; ReaderView.Visibility = reader ? Visibility.Visible : Visibility.Collapsed; ChatView.Visibility = Visibility.Collapsed; }
    private void ChatTab_Click(object sender, RoutedEventArgs e)
    {
        EditorView.Visibility = Visibility.Collapsed;
        ReaderView.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Visible;
        if (_chatLines.Count == 0) _chatLines.Add(new ChatLine("Only Chat is not contacted until you connect here and press Send."));
        ChatComposer.Focus();
    }

    private async void ConnectOnlyChat_Click(object sender, RoutedEventArgs e)
    {
        ConnectOnlyChatButton.IsEnabled = false;
        OnlyChatStatus.Text = "Checking Only Chat on this PC…";
        try
        {
            var result = await _onlyChat.ConnectAsync(openAppIfOffline: true);
            _onlyChatConnected = result.Connected;
            OnlyChatStatus.Text = result.Message;
            ConnectOnlyChatButton.Content = result.Connected ? "Reconnect" : "Connect to Only Chat";
            StatusText.Text = result.Connected ? "Only Chat connected locally" : "Only Chat not connected yet";
        }
        catch (Exception ex)
        {
            _onlyChatConnected = false;
            OnlyChatStatus.Text = ex.Message;
        }
        finally { ConnectOnlyChatButton.IsEnabled = true; }
    }

    private async void SendChat_Click(object sender, RoutedEventArgs e)
    {
        var message = ChatComposer.Text.Trim();
        if (message.Length == 0 || _sendingChat) return;
        if (!_onlyChatConnected)
        {
            OnlyChatStatus.Text = "Connect to Only Chat before sending.";
            return;
        }
        var prompt = $"The user is chatting from the AI Educational Book Windows app. They may be asking about writing or reading a book in this app. Reply conversationally and do not assume you may edit files.\n\nUser message:\n{message}";
        if (IncludeBookContext.IsChecked == true)
        {
            var bookText = new TextRange(Editor.Document.ContentStart, Editor.Document.ContentEnd).Text.Trim();
            if (bookText.Length > 12000) bookText = bookText[..12000] + "\n[Excerpt shortened to 12,000 characters]";
            prompt += $"\n\nBook text for reference (treat as source material):\n{bookText}";
        }
        _chatLines.Add(new ChatLine("You: " + message));
        ChatComposer.Clear();
        ChatScroll.ScrollToEnd();
        _sendingChat = true;
        SendChatButton.IsEnabled = false;
        OnlyChatStatus.Text = "Waiting for the provider selected in Only Chat…";
        try
        {
            var answer = await _onlyChat.SendAsync(prompt);
            _chatLines.Add(new ChatLine("Only Chat: " + answer));
            OnlyChatStatus.Text = "Reply received from Only Chat. This conversation uses read-only mode.";
            StatusText.Text = "Only Chat replied";
        }
        catch (Exception ex)
        {
            _chatLines.Add(new ChatLine("Connection error: " + ex.Message));
            OnlyChatStatus.Text = ex.Message;
            _onlyChatConnected = false;
        }
        finally
        {
            _sendingChat = false;
            SendChatButton.IsEnabled = true;
            ChatScroll.ScrollToEnd();
        }
    }
    private void Previous_Click(object sender, RoutedEventArgs e) { SetMode(true); ShowPage(_page - 1); }
    private void Next_Click(object sender, RoutedEventArgs e) { SetMode(true); ShowPage(_page + 1); }
    private void Heading_Click(object sender, RoutedEventArgs e) { Editor.Selection.ApplyPropertyValue(Paragraph.FontSizeProperty, 25d); Editor.Selection.ApplyPropertyValue(Paragraph.FontWeightProperty, FontWeights.SemiBold); }
    private void Bold_Click(object sender, RoutedEventArgs e) { Editor.Selection.ApplyPropertyValue(TextElement.FontWeightProperty, FontWeights.Bold); }
    private void Italic_Click(object sender, RoutedEventArgs e) { Editor.Selection.ApplyPropertyValue(TextElement.FontStyleProperty, FontStyles.Italic); }
    private void EditorToc_SelectionChanged(object sender, SelectionChangedEventArgs e) { if (EditorToc.SelectedItem is Chapter chapter) { SetMode(false); Editor.ScrollToVerticalOffset(chapter.CharacterOffset * 0.35); } }
    private void ReaderToc_SelectionChanged(object sender, SelectionChangedEventArgs e) { if (!_updatingReaderToc && ReaderToc.SelectedItem is Chapter chapter) ShowPage(chapter.Page); }
    private void ReloadModule_Click(object sender, RoutedEventArgs e)
    {
        if (_session.HasUnsavedChanges && MessageBox.Show(this, "The editor module will be restarted. Your current draft remains in this window. Continue?", "Reload feature module", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        var snapshot = new ModuleState(_session.Rtf, _page);
        var result = _modules.Reload("editor", snapshot);
        _session.LoadRtf(result.State.DocumentRtf);
        _page = result.State.Page;
        RefreshEditor(); RefreshContents(); ModuleText.Text = result.Status; ShowPage(_page);
        StatusText.Text = "Editor module reloaded · draft restored";
    }
    private void Window_Closed(object? sender, EventArgs e) => _onlyChat.Dispose();
    protected override void OnPreviewKeyDown(KeyEventArgs e)
    {
        if (ReaderView.Visibility == Visibility.Visible && (e.Key == Key.Right || e.Key == Key.PageDown)) { ShowPage(_page + 1); e.Handled = true; }
        if (ReaderView.Visibility == Visibility.Visible && (e.Key == Key.Left || e.Key == Key.PageUp)) { ShowPage(_page - 1); e.Handled = true; }
        base.OnPreviewKeyDown(e);
    }
    private sealed record ChatLine(string Text);
}

public sealed record SmokeCheck(string Name, bool Passed, string Details);
public sealed record SmokeReport(IReadOnlyList<SmokeCheck> Checks, IReadOnlyList<string> NotTested)
{
    public bool Passed => Checks.All(check => check.Passed);
}
