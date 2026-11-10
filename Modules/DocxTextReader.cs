using System.IO.Compression;
using System.IO;
using System.Security;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace AiEducationalBook.Modules;

/// <summary>Reads paragraph text from DOCX without executing embedded macros or external relationships.</summary>
public static class DocxTextReader
{
    public static string ReadAsRtf(string path)
    {
        using var archive = ZipFile.OpenRead(path);
        var entry = archive.GetEntry("word/document.xml") ?? throw new InvalidDataException("This file has no Word document body.");
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, IgnoreComments = true });
        var xml = System.Xml.Linq.XDocument.Load(reader);
        XNamespace w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        var paragraphs = xml.Descendants(w + "p").Select(p => string.Concat(p.Descendants(w + "t").Select(t => t.Value))).ToList();
        var body = string.Join("\\par ", paragraphs.Select(EscapeRtf));
        return "{\\rtf1\\ansi\\deff0\\fs24 " + body + "}";
    }

    private static string EscapeRtf(string value)
    {
        var result = new StringBuilder();
        foreach (var c in value)
        {
            if (c is '\\' or '{' or '}') result.Append('\\').Append(c);
            else if (c <= 0x7f) result.Append(c);
            else result.Append("\\u").Append(unchecked((short)c)).Append('?');
        }
        return result.ToString();
    }
}
