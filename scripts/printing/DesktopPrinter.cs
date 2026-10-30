// Standalone desktop helper; run under the signed-in Windows user, never as a service.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;

public static class CafeDesktopPrinter {
    private sealed class Run { public string Text; public string Style; public float Y; }
    private static PrintDocument document;
    private static List<List<Run>> pages;
    private static Font regular, bold;
    private static Dictionary<string, Font> fonts = new Dictionary<string, Font>();
    private static float pageWidth;
    private static int currentPage;
    private const float MmToPt = 72f / 25.4f;

    public static void Prepare(string queue, string title, string[][] sections, float points, float widthMm, float heightMm, string[][] styles, string layoutTitle) {
        if (!Environment.UserInteractive) throw new InvalidOperationException("Desktop session required");
        PrinterSettings settings = new PrinterSettings();
        settings.PrinterName = queue;
        settings.Copies = 1;
        settings.Collate = false;
        settings.PrintToFile = false;
        settings.PrintRange = PrintRange.AllPages;
        if (!settings.IsValid) throw new InvalidOperationException("Invalid printer");
        document = new PrintDocument();
        document.PrinterSettings = settings;
        document.DefaultPageSettings = new PageSettings(settings);
        document.DefaultPageSettings.Landscape = false;
        document.PrintController = new StandardPrintController();
        document.DocumentName = title;
        if (widthMm > 0) {
            // Select the actual driver form for THIS job. Never inherit the
            // POS80's observed 3276 mm default or a conflicting label default.
            PaperSize selected = null;
            foreach (PaperSize paper in settings.PaperSizes) {
                if (Math.Abs(paper.Width * 0.254f - widthMm) <= 1.5f && Math.Abs(paper.Height * 0.254f - heightMm) <= 1.5f) { selected = paper; break; }
            }
            if (selected == null) throw new InvalidOperationException("Confirmed driver form is not installed");
            document.DefaultPageSettings.PaperSize = selected;
            float driverWidth = document.DefaultPageSettings.PaperSize.Width * 0.254f;
            float driverHeight = document.DefaultPageSettings.PaperSize.Height * 0.254f;
            if (Math.Abs(driverWidth - widthMm) > 1.5f || Math.Abs(driverHeight - heightMm) > 1.5f)
                throw new InvalidOperationException("Driver stock does not match confirmed labels");
        }
        RectangleF area = document.DefaultPageSettings.PrintableArea;
        InitializeFonts(points);
        pageWidth = area.Width * 0.72f;
        using (Graphics g = settings.CreateMeasurementGraphics()) {
            g.PageUnit = GraphicsUnit.Point;
            pages = Layout(g, String.IsNullOrEmpty(layoutTitle) ? title : layoutTitle, sections, pageWidth, area.Height * 0.72f, styles);
        }
        currentPage = 0;
        document.PrintPage += DrawPage;
    }
    private static void InitializeFonts(float points) {
        regular = new Font("Arial", points, FontStyle.Regular, GraphicsUnit.Point);
        bold = new Font("Arial", points, FontStyle.Bold, GraphicsUnit.Point);
        fonts["brand"] = new Font("Arial", 13, FontStyle.Bold, GraphicsUnit.Point);
        fonts["heading"] = new Font("Arial", 10, FontStyle.Bold, GraphicsUnit.Point);
        fonts["mono"] = new Font("Courier New", 8.5f, FontStyle.Regular, GraphicsUnit.Point);
        fonts["total"] = new Font("Arial", 12, FontStyle.Bold, GraphicsUnit.Point);
        fonts["meta"] = new Font("Arial", 7.5f, FontStyle.Regular, GraphicsUnit.Point);
        fonts["name"] = new Font("Arial", 11, FontStyle.Bold, GraphicsUnit.Point);
        fonts["drink"] = new Font("Arial", 10, FontStyle.Bold, GraphicsUnit.Point);
        fonts["modifier"] = new Font("Arial", 9, FontStyle.Regular, GraphicsUnit.Point);
        fonts["note"] = new Font("Arial", 9, FontStyle.Bold, GraphicsUnit.Point);
        fonts["footer"] = new Font("Arial", 7.5f, FontStyle.Regular, GraphicsUnit.Point);
    }
    private static Font FontFor(string style) { return style == "legacy-bold" ? bold : (fonts.ContainsKey(style) ? fonts[style] : regular); }
    private static float LineHeight(string style) { return style.StartsWith("legacy") ? regular.SizeInPoints * 1.4f : FontFor(style).SizeInPoints * 1.22f + 0.5f; }
    private static List<List<Run>> Layout(Graphics g, string title, string[][] sections, float width, float height, string[][] styles) {
        float margin = 2 * MmToPt;
        float usable = width - 2 * margin;
        if (usable < 40 || height < margin * 2 + LineHeight("modifier") * 3) throw new InvalidOperationException("Printable stock too small");
        List<List<Run>> output = new List<List<Run>>();
        for (int sectionIndex = 0; sectionIndex < sections.Length; sectionIndex++) {
            string[] section = sections[sectionIndex];
            // A long note may span multiple physical labels. Reserve the cup
            // footer on EVERY label so detached instructions cannot be confused
            // with another drink in the same sale. Customer/legacy docs retain
            // their normal flowing layout.
            bool cupFooter = section.Length > 0 && styles != null && sectionIndex < styles.Length
                && styles[sectionIndex] != null && styles[sectionIndex].Length == section.Length
                && styles[sectionIndex][0] == "name" && styles[sectionIndex][section.Length - 1] == "footer";
            List<string> footer = new List<string>();
            if (cupFooter) footer.AddRange(Wrap(g, section[section.Length - 1], FontFor("footer"), usable));
            float footerHeight = footer.Count * LineHeight("footer");
            float contentBottom = height - margin - footerHeight;
            if (contentBottom < margin + LineHeight("modifier") * 2) throw new InvalidOperationException("Printable stock too small for cup identity");
            List<Run> page = new List<Run>(); output.Add(page);
            float y = margin;
            for (int index = 0; index < section.Length - (cupFooter ? 1 : 0); index++) {
                string style = styles != null && sectionIndex < styles.Length && styles[sectionIndex] != null && index < styles[sectionIndex].Length ? styles[sectionIndex][index] : (index == 0 ? "legacy-bold" : "legacy");
                float lineHeight = LineHeight(style);
                foreach (string segment in Wrap(g, section[index], FontFor(style), usable)) {
                    if (y + lineHeight > contentBottom) {
                        AppendFooter(page, footer, contentBottom);
                        page = new List<Run>(); output.Add(page); y = margin;
                        // Every continuation identifies its sale; never drop overflow text.
                        foreach (string heading in Wrap(g, title + " CONT.", FontFor("footer"), usable)) {
                            float headingHeight = LineHeight("footer");
                            if (y + headingHeight + lineHeight > contentBottom) break;
                            page.Add(new Run { Text = heading, Style = "footer", Y = y }); y += headingHeight;
                        }
                    }
                    page.Add(new Run { Text = segment, Style = style, Y = y }); y += lineHeight;
                }
            }
            AppendFooter(page, footer, contentBottom);
        }
        if (output.Count == 0 || output.Count > 10000) throw new InvalidOperationException("Invalid page count");
        return output;
    }
    private static void AppendFooter(List<Run> page, List<string> footer, float y) {
        foreach (string line in footer) {
            page.Add(new Run { Text = line, Style = "footer", Y = y }); y += LineHeight("footer");
        }
    }
    private static IEnumerable<string> Wrap(Graphics g, string text, Font font, float width) {
        if (String.IsNullOrEmpty(text)) { yield return ""; yield break; }
        while (text.Length > 0) {
            int low = 1, high = text.Length, fit = 0;
            while (low <= high) {
                int middle = (low + high) / 2;
                if (g.MeasureString(text.Substring(0, middle), font, Int32.MaxValue, StringFormat.GenericTypographic).Width <= width) { fit = middle; low = middle + 1; }
                else high = middle - 1;
            }
            if (fit == 0) throw new InvalidOperationException("Character does not fit");
            if (fit < text.Length) {
                int space = text.LastIndexOf(' ', fit - 1, fit);
                if (space > 0) fit = space;
                if (Char.IsHighSurrogate(text[fit - 1])) fit--;
            }
            if (fit == 0) throw new InvalidOperationException("Character does not fit");
            yield return text.Substring(0, fit).TrimEnd();
            text = text.Substring(fit).TrimStart();
        }
    }
    private static void DrawPage(object sender, PrintPageEventArgs e) {
        e.Graphics.PageUnit = GraphicsUnit.Point;
        DrawRuns(e.Graphics, pages[currentPage], pageWidth);
        currentPage++;
        e.HasMorePages = currentPage < pages.Count;
    }
    private static void DrawRuns(Graphics g, List<Run> page, float width) {
        float margin = 2 * MmToPt;
        foreach (Run run in page) {
            Font font = FontFor(run.Style);
            float x = margin;
            float measured = g.MeasureString(run.Text, font, Int32.MaxValue, StringFormat.GenericTypographic).Width;
            if (run.Style == "brand" || run.Style == "meta") x = Math.Max(margin, (width - measured) / 2);
            if (run.Style == "total") x = Math.Max(margin, width - margin - measured);
            g.DrawString(run.Text, font, Brushes.Black, x, run.Y, StringFormat.GenericTypographic);
        }
    }
    public static void Send() { document.Print(); }
    public static string[][] Preview(string title, string[][] sections, float points, float widthMm, float heightMm, string[][] styles, string outputDirectory) {
        InitializeFonts(points);
        using (Bitmap bitmap = new Bitmap(1, 1)) using (Graphics g = Graphics.FromImage(bitmap)) {
            bitmap.SetResolution(203, 203);
            g.PageUnit = GraphicsUnit.Point;
            List<List<Run>> layout = Layout(g, title, sections, widthMm * MmToPt, heightMm * MmToPt, styles);
            List<string[]> result = new List<string[]>();
            foreach (List<Run> page in layout) result.Add(page.ConvertAll(run => run.Text).ToArray());
            if (!String.IsNullOrEmpty(outputDirectory)) {
                System.IO.Directory.CreateDirectory(outputDirectory);
                for (int index = 0; index < layout.Count; index++) {
                    using (Bitmap image = new Bitmap((int)Math.Ceiling(widthMm / 25.4f * 203), (int)Math.Ceiling(heightMm / 25.4f * 203))) {
                        image.SetResolution(203, 203);
                        using (Graphics canvas = Graphics.FromImage(image)) { canvas.Clear(Color.White); canvas.PageUnit = GraphicsUnit.Point; DrawRuns(canvas, layout[index], widthMm * MmToPt); }
                        image.Save(System.IO.Path.Combine(outputDirectory, "page-" + (index + 1) + ".png"), System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
            }
            return result.ToArray();
        }
    }
    public static void Dispose() {
        if (document != null) document.Dispose();
        if (regular != null) regular.Dispose();
        if (bold != null) bold.Dispose();
        foreach (Font font in fonts.Values) font.Dispose();
        fonts.Clear();
    }
}
