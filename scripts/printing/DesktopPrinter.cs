// Standalone desktop helper; run under the signed-in Windows user, never as a service.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;

public static class CafeDesktopPrinter {
    private sealed class Run { public string Text; public string Style; public float Y; public float? X; public float RuleWidth; public string[] Cells; }
    private static PrintDocument document;
    private static List<List<Run>> pages;
    private static Font regular, bold;
    private static Dictionary<string, Font> fonts = new Dictionary<string, Font>();
    private static float pageWidth;
    private static float physicalPageWidth;
    private static bool rotateLabel;
    private static int currentPage;
    private const float MmToPt = 72f / 25.4f;

    public static void Prepare(string queue, string title, string[][] sections, float points, float widthMm, float heightMm, string[][] styles, string layoutTitle, string[][] cupLabels, bool verticalLabel) {
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
        // Keep the installed 57 x 32 mm form; rotate the logical 32 x 57 mm
        // artwork inside that page, as physically accepted on October 31.
        rotateLabel = verticalLabel;
        physicalPageWidth = area.Width * 0.72f;
        pageWidth = (rotateLabel ? area.Height : area.Width) * 0.72f;
        using (Graphics g = settings.CreateMeasurementGraphics()) {
            g.PageUnit = GraphicsUnit.Point;
            pages = Layout(g, String.IsNullOrEmpty(layoutTitle) ? title : layoutTitle, sections, pageWidth, (rotateLabel ? area.Width : area.Height) * 0.72f, styles, cupLabels);
        }
        currentPage = 0;
        document.PrintPage += DrawPage;
    }
    private static void InitializeFonts(float points) {
        regular = new Font("Arial", points, FontStyle.Regular, GraphicsUnit.Point);
        bold = new Font("Arial", points, FontStyle.Bold, GraphicsUnit.Point);
        fonts["brand"] = new Font("Arial", 12, FontStyle.Bold, GraphicsUnit.Point);
        fonts["heading"] = new Font("Arial", 10, FontStyle.Bold, GraphicsUnit.Point);
        fonts["mono"] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
        fonts["total"] = new Font("Arial", 11, FontStyle.Bold, GraphicsUnit.Point);
        fonts["meta"] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
        foreach (string style in new [] { "name", "drink", "modifier", "note", "footer", "cup-name", "cup-drink", "cup-modifier", "cup-note", "cup-meta", "cup-service" })
            fonts[style] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
    }
    private static Font FontFor(string style) { return style == "legacy-bold" ? bold : (fonts.ContainsKey(style) ? fonts[style] : regular); }
    private static float LineHeight(string style) { return style.StartsWith("legacy") ? regular.SizeInPoints * 1.4f : FontFor(style).SizeInPoints * 1.22f + 0.5f; }
    private static List<List<Run>> Layout(Graphics g, string title, string[][] sections, float width, float height, string[][] styles, string[][] cupLabels) {
        float margin = 2 * MmToPt;
        float usable = width - 2 * margin;
        if (usable < 40 || height < margin * 2 + LineHeight("modifier") * 3) throw new InvalidOperationException("Printable stock too small");
        List<List<Run>> output = new List<List<Run>>();
        for (int sectionIndex = 0; sectionIndex < sections.Length; sectionIndex++) {
            string[] section = sections[sectionIndex];
            // New cup documents carry explicit header/footer fields. Older journal
            // snapshots continue through their original flowing layout below.
            if (cupLabels != null && sectionIndex < cupLabels.Length && cupLabels[sectionIndex].Length == 4) {
                LayoutCup(g, section, styles != null && sectionIndex < styles.Length ? styles[sectionIndex] : null, cupLabels[sectionIndex], width, height, output);
                continue;
            }
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
                string[] cells = style == "mono" ? ReceiptCells(section[index]) : null;
                if (cells != null) {
                    ValidateCells(g, cells, FontFor(style), usable);
                    if (y + lineHeight > contentBottom) {
                        page = new List<Run>(); output.Add(page); y = margin;
                        foreach (string heading in Wrap(g, title + " CONT.", FontFor("footer"), usable)) {
                            if (y + LineHeight("footer") + lineHeight > contentBottom) break;
                            page.Add(new Run { Text = heading, Style = "footer", Y = y }); y += LineHeight("footer");
                        }
                    }
                    page.Add(new Run { Text = section[index], Style = style, Y = y, Cells = cells }); y += lineHeight;
                    continue;
                }
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
    private static void LayoutCup(Graphics g, string[] section, string[] styles, string[] details, float width, float height, List<List<Run>> output) {
        float margin = 1.5f * MmToPt, usable = width - 2 * margin;
        float lineHeight = LineHeight("cup-modifier");
        List<string> service = new List<string>(Wrap(g, details[1], FontFor("cup-service"), usable));
        List<string> dates = new List<string>(Wrap(g, details[2] + " " + details[3], FontFor("cup-meta"), usable));
        float footerTop = height - margin - (service.Count + dates.Count) * lineHeight - 3, bottom = footerTop - 2;
        if (usable < 40 || bottom < margin + lineHeight * 4) throw new InvalidOperationException("Printable label too small for cup layout");
        List<Run> content = new List<Run>();
        for (int i = 1; i < section.Length - 1; i++) {
            string sourceStyle = styles != null && i < styles.Length ? styles[i] : "modifier";
            string style = sourceStyle == "drink" ? "cup-drink" : sourceStyle == "note" ? "cup-note" : "cup-modifier";
            string value = style == "cup-drink" ? section[i] : "- " + section[i];
            foreach (string line in Wrap(g, value, FontFor(style), usable)) content.Add(new Run { Text = line, Style = style });
        }
        int next = 0, part = 0;
        do {
            List<Run> page = new List<Run>(); output.Add(page);
            string identity = details[0] + (part++ > 0 ? " CONT." : "");
            // The accepted vertical stock is narrow. Stack the complete name
            // and identity instead of squeezing them into conflicting columns.
            List<string> names = new List<string>(Wrap(g, section[0], FontFor("cup-name"), usable));
            float nameY = margin;
            foreach (string name in names) {
                page.Add(new Run { Text = name, Style = "cup-name", X = margin, Y = nameY }); nameY += lineHeight;
            }
            foreach (string id in Wrap(g, identity, FontFor("cup-meta"), usable)) {
                page.Add(new Run { Text = id, Style = "cup-meta", X = margin, Y = nameY }); nameY += lineHeight;
            }
            float ruleY = nameY + 1, y = ruleY + 3;
            if (y + lineHeight > bottom) throw new InvalidOperationException("Customer identity leaves no room for preparation text");
            page.Add(new Run { Text = "", Style = "rule", X = margin, Y = ruleY, RuleWidth = usable });
            int first = next;
            while (next < content.Count) {
                Run line = content[next];
                if (y + lineHeight > bottom) break;
                page.Add(new Run { Text = line.Text, Style = line.Style, X = margin, Y = y }); y += lineHeight; next++;
            }
            if (next == first && next < content.Count) throw new InvalidOperationException("No preparation line fits the label");
            page.Add(new Run { Text = "", Style = "rule", X = margin, Y = footerTop, RuleWidth = usable });
            float footerY = footerTop + 3;
            foreach (string value in service) { page.Add(new Run { Text = value, Style = "cup-service", X = margin, Y = footerY }); footerY += lineHeight; }
            foreach (string value in dates) { page.Add(new Run { Text = value, Style = "cup-meta", X = margin, Y = footerY }); footerY += lineHeight; }
        } while (next < content.Count);
    }
    private static void AppendFooter(List<Run> page, List<string> footer, float y) {
        foreach (string line in footer) {
            page.Add(new Run { Text = line, Style = "footer", Y = y }); y += LineHeight("footer");
        }
    }
    private static string[] ReceiptCells(string text) {
        string[] cells = System.Text.RegularExpressions.Regex.Split(text.Trim(), @"\s{2,}");
        if (cells.Length != 3) return null;
        bool header = cells[0] == "CANT." && cells[1] == "P.UNITARIO" && cells[2] == "IMPORTE";
        bool amounts = System.Text.RegularExpressions.Regex.IsMatch(cells[0], @"^\d+$")
            && System.Text.RegularExpressions.Regex.IsMatch(cells[1], @"^\$-?\d+\.\d{2}$")
            && System.Text.RegularExpressions.Regex.IsMatch(cells[2], @"^\$-?\d+\.\d{2}$");
        return header || amounts ? cells : null;
    }
    private static void ValidateCells(Graphics g, string[] cells, Font font, float usable) {
        float first = g.MeasureString(cells[0], font, Int32.MaxValue, StringFormat.GenericTypographic).Width;
        float middle = g.MeasureString(cells[1], font, Int32.MaxValue, StringFormat.GenericTypographic).Width;
        float last = g.MeasureString(cells[2], font, Int32.MaxValue, StringFormat.GenericTypographic).Width;
        if (first + 4 > usable * 0.52f - middle / 2 || usable * 0.52f + middle / 2 + 4 > usable - last)
            throw new InvalidOperationException("Receipt amount does not fit its column");
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
        DrawPhysicalPage(e.Graphics, pages[currentPage], physicalPageWidth, pageWidth, rotateLabel);
        currentPage++;
        e.HasMorePages = currentPage < pages.Count;
    }
    private static void DrawPhysicalPage(Graphics g, List<Run> page, float physicalWidth, float logicalWidth, bool verticalLabel) {
        var saved = g.Save();
        if (verticalLabel) { g.TranslateTransform(physicalWidth, 0); g.RotateTransform(90); }
        DrawRuns(g, page, logicalWidth);
        g.Restore(saved);
    }
    private static float TextX(Graphics g, Run run, Font font, float width) {
        float margin = 2 * MmToPt, x = run.X ?? margin;
        float measured = g.MeasureString(run.Text, font, Int32.MaxValue, StringFormat.GenericTypographic).Width;
        if (run.Style == "brand" || run.Style == "meta") x = Math.Max(margin, (width - measured) / 2);
        if (run.Style == "total") x = Math.Max(margin, width - margin - measured);
        return x;
    }
    private static float CellX(Graphics g, string[] cells, int index, Font font, float width) {
        float margin = 2 * MmToPt, usable = width - 2 * margin;
        float measured = g.MeasureString(cells[index], font, Int32.MaxValue, StringFormat.GenericTypographic).Width;
        return index == 0 ? margin : index == 1 ? margin + usable * 0.52f - measured / 2 : width - margin - measured;
    }
    private static void DrawRuns(Graphics g, List<Run> page, float width) {
        float margin = 2 * MmToPt;
        foreach (Run run in page) {
            if (run.Style == "rule") { using (Pen pen = new Pen(Color.Black, 0.7f)) g.DrawLine(pen, run.X.Value, run.Y, run.X.Value + run.RuleWidth, run.Y); continue; }
            Font font = FontFor(run.Style);
            if (run.Style == "mono" && System.Text.RegularExpressions.Regex.IsMatch(run.Text, @"^-{3,}$")) {
                g.DrawLine(Pens.Black, margin, run.Y + font.SizeInPoints * 0.55f, width - margin, run.Y + font.SizeInPoints * 0.55f); continue;
            }
            if (run.Cells != null) {
                for (int i = 0; i < 3; i++) g.DrawString(run.Cells[i], font, Brushes.Black, CellX(g, run.Cells, i, font, width), run.Y, StringFormat.GenericTypographic);
                continue;
            }
            g.DrawString(run.Text, font, Brushes.Black, TextX(g, run, font, width), run.Y, StringFormat.GenericTypographic);
        }
    }
    public static void Send() { document.Print(); }
    public static string[][] Preview(string title, string[][] sections, float points, float widthMm, float heightMm, string[][] styles, string outputDirectory, string[][] cupLabels, bool verticalLabel) {
        InitializeFonts(points);
        using (Bitmap bitmap = new Bitmap(1, 1)) using (Graphics g = Graphics.FromImage(bitmap)) {
            bitmap.SetResolution(203, 203);
            g.PageUnit = GraphicsUnit.Point;
            float logicalWidth = (verticalLabel ? heightMm : widthMm) * MmToPt;
            float logicalHeight = (verticalLabel ? widthMm : heightMm) * MmToPt;
            List<List<Run>> layout = Layout(g, title, sections, logicalWidth, logicalHeight, styles, cupLabels);
            List<string[]> result = new List<string[]>();
            foreach (List<Run> page in layout) result.Add(page.ConvertAll(run => run.Text).ToArray());
            if (!String.IsNullOrEmpty(outputDirectory)) {
                System.IO.Directory.CreateDirectory(outputDirectory);
                for (int index = 0; index < layout.Count; index++) {
                    using (Bitmap image = new Bitmap((int)Math.Ceiling(widthMm / 25.4f * 203), (int)Math.Ceiling(heightMm / 25.4f * 203))) {
                        image.SetResolution(203, 203);
                        using (Graphics canvas = Graphics.FromImage(image)) { canvas.Clear(Color.White); canvas.PageUnit = GraphicsUnit.Point; DrawPhysicalPage(canvas, layout[index], widthMm * MmToPt, logicalWidth, verticalLabel); }
                        image.Save(System.IO.Path.Combine(outputDirectory, "page-" + (index + 1) + ".png"), System.Drawing.Imaging.ImageFormat.Png);
                    }
                    WriteSvg(g, layout[index], widthMm, heightMm, logicalWidth, verticalLabel, System.IO.Path.Combine(outputDirectory, "page-" + (index + 1) + ".svg"));
                }
            }
            return result.ToArray();
        }
    }
    private static string Number(float value) { return value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture); }
    private static void SvgText(System.Text.StringBuilder svg, string text, Font font, float x, float y) {
        float ascent = font.SizeInPoints * font.FontFamily.GetCellAscent(font.Style) / font.FontFamily.GetEmHeight(font.Style);
        svg.Append("<text x=\"" + Number(x) + "\" y=\"" + Number(y + ascent) + "\" font-family=\"" + font.Name + "\" font-size=\"" + Number(font.SizeInPoints) + "\" font-weight=\"" + (font.Bold ? "700" : "400") + "\">" + System.Security.SecurityElement.Escape(text) + "</text>");
    }
    private static void WriteSvg(Graphics g, List<Run> page, float widthMm, float heightMm, float logicalWidth, bool verticalLabel, string filename) {
        System.Text.StringBuilder svg = new System.Text.StringBuilder();
        svg.Append("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + Number(widthMm) + "mm\" height=\"" + Number(heightMm) + "mm\" viewBox=\"0 0 " + Number(widthMm * MmToPt) + " " + Number(heightMm * MmToPt) + "\"><title>Barista label</title>");
        if (verticalLabel) svg.Append("<g transform=\"translate(" + Number(widthMm * MmToPt) + " 0) rotate(90)\">");
        foreach (Run run in page) {
            float x = run.X ?? 2 * MmToPt;
            if (run.Style == "rule") {
                svg.Append("<path d=\"M" + Number(x) + " " + Number(run.Y) + "h" + Number(run.RuleWidth) + "\" stroke=\"black\" stroke-width=\"0.7\"/>"); continue;
            }
            Font font = FontFor(run.Style);
            if (run.Style == "mono" && System.Text.RegularExpressions.Regex.IsMatch(run.Text, @"^-{3,}$")) {
                svg.Append("<path d=\"M" + Number(2 * MmToPt) + " " + Number(run.Y + font.SizeInPoints * 0.55f) + "h" + Number(logicalWidth - 4 * MmToPt) + "\" stroke=\"black\"/>"); continue;
            }
            if (run.Cells != null) {
                for (int i = 0; i < 3; i++) SvgText(svg, run.Cells[i], font, CellX(g, run.Cells, i, font, logicalWidth), run.Y);
            } else SvgText(svg, run.Text, font, TextX(g, run, font, logicalWidth), run.Y);
        }
        if (verticalLabel) svg.Append("</g>");
        svg.Append("</svg>"); System.IO.File.WriteAllText(filename, svg.ToString(), new System.Text.UTF8Encoding(false));
    }
    public static void Dispose() {
        if (document != null) document.Dispose();
        if (regular != null) regular.Dispose();
        if (bold != null) bold.Dispose();
        foreach (Font font in fonts.Values) font.Dispose();
        fonts.Clear();
    }
}
