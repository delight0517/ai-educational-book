using System.Windows.Documents;
using System.IO;
using System.Windows;

namespace AiEducationalBook.Modules;

public sealed record ModuleState(string DocumentRtf, int Page);
public sealed record ModuleDescriptor(string Id, int ApiVersion, string Version, string ContentHash);
public sealed record ModuleReloadResult(ModuleState State, string Status);
public sealed record Chapter(string Title, int Page, int CharacterOffset);

public interface IFeatureModule
{
    ModuleDescriptor Descriptor { get; }
    void Initialize(ModuleState state);
    ModuleState CaptureState();
    bool CanReload(out string reason);
    void Dispose();
}

public abstract class FeatureModuleBase : IFeatureModule
{
    protected ModuleState State = new("", 0);
    public abstract ModuleDescriptor Descriptor { get; }
    public virtual void Initialize(ModuleState state) => State = state;
    public virtual ModuleState CaptureState() => State;
    public virtual bool CanReload(out string reason) { reason = ""; return true; }
    public virtual void Dispose() { }
}

public sealed class EditorModule : FeatureModuleBase
{
    public override ModuleDescriptor Descriptor => new("editor", 1, "1.0.0", "builtin-editor-v1");
}

public sealed class ReaderModule : FeatureModuleBase
{
    public override ModuleDescriptor Descriptor => new("reader", 1, "1.0.0", "builtin-reader-v1");
}

public sealed class ModuleHost
{
    private readonly Dictionary<string, IFeatureModule> _modules = new();
    public string Status => string.Join(" · ", _modules.Values.Select(m => $"{m.Descriptor.Id} {m.Descriptor.Version} [{m.Descriptor.ContentHash[..Math.Min(12, m.Descriptor.ContentHash.Length)]}]")).Replace("editor", "edit").Replace("reader", "read");

    public void Register(IFeatureModule module)
    {
        if (module.Descriptor.ApiVersion != 1) throw new InvalidOperationException("Unsupported feature API version.");
        if (_modules.ContainsKey(module.Descriptor.Id)) throw new InvalidOperationException($"Feature already registered: {module.Descriptor.Id}");
        module.Initialize(new ModuleState("", 0));
        _modules.Add(module.Descriptor.Id, module);
    }

    public void InitializeAll() { }

    public ModuleReloadResult Reload(string id, ModuleState snapshot)
    {
        if (!_modules.TryGetValue(id, out var current)) throw new InvalidOperationException("Feature module is not loaded.");
        if (!current.CanReload(out var reason)) throw new InvalidOperationException($"Feature reload blocked: {reason}");
        var old = current.Descriptor;
        current.Dispose();
        try
        {
            IFeatureModule candidate = id switch { "editor" => new EditorModule(), "reader" => new ReaderModule(), _ => throw new InvalidOperationException("Unknown built-in module.") };
            if (candidate.Descriptor.ApiVersion != old.ApiVersion) throw new InvalidOperationException("Module API mismatch.");
            candidate.Initialize(snapshot);
            _modules[id] = candidate;
            return new ModuleReloadResult(candidate.CaptureState(), $"{id} {candidate.Descriptor.Version} · {candidate.Descriptor.ContentHash}");
        }
        catch
        {
            current.Initialize(snapshot);
            _modules[id] = current;
            throw;
        }
    }
}

public sealed class DocumentSession
{
    public string Rtf { get; private set; } = "{\\rtf1\\ansi }";
    public List<Chapter> Headings { get; } = new();
    public List<FlowDocument> Pages { get; } = new();
    public bool HasUnsavedChanges { get; private set; }
    public void LoadRtf(string rtf) { Rtf = rtf; HasUnsavedChanges = false; }
    public void LoadPlainText(string text)
    {
        var escaped = text.Replace("\\", "\\\\").Replace("{", "\\{").Replace("}", "\\}").Replace("\r\n", "\\par ").Replace("\n", "\\par ");
        LoadRtf("{\\rtf1\\ansi\\deff0\\fs24 " + escaped + "}");
    }
    public void UpdateFromEditor(FlowDocument document, bool markUnsaved = true)
    {
        using var ms = new MemoryStream();
        new TextRange(document.ContentStart, document.ContentEnd).Save(ms, DataFormats.Rtf);
        Rtf = System.Text.Encoding.UTF8.GetString(ms.ToArray());
        if (markUnsaved) HasUnsavedChanges = true;
        Headings.Clear(); Pages.Clear();
        var text = new TextRange(document.ContentStart, document.ContentEnd).Text;
        var blocks = document.Blocks.OfType<Paragraph>().ToList();
        var groups = blocks.Chunk(5).ToList();
        if (groups.Count == 0) groups.Add(new[] { new Paragraph(new Run("Start writing to build your book.")) });
        var offset = 0;
        for (var i = 0; i < groups.Count; i++)
        {
            var page = new FlowDocument { PagePadding = new System.Windows.Thickness(0), ColumnWidth = double.PositiveInfinity };
            foreach (var paragraph in groups[i])
            {
                var paraText = new TextRange(paragraph.ContentStart, paragraph.ContentEnd).Text.Trim();
                if (paraText.Length > 0 && (paragraph.FontSize >= 22 || paragraph.FontWeight == System.Windows.FontWeights.Bold))
                    Headings.Add(new Chapter(paraText, i, offset));
                page.Blocks.Add(paragraph);
                offset += paraText.Length + 1;
            }
            Pages.Add(page);
        }
        if (Headings.Count == 0) Headings.Add(new Chapter("Beginning", 0, 0));
    }
    public void MarkSaved() => HasUnsavedChanges = false;
}
