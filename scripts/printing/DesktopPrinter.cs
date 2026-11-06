// Standalone desktop helper; run under the signed-in Windows user, never as a service.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;

public static class CafeDesktopPrinter {
    private sealed class Run { public string Text; public string Style; public float Y; public string[] Cells; public float? X; public float RuleWidth; public int PreparationGroup; public bool PreparationName; public string PreparationContext; }
    private static PrintDocument document;
    private static List<List<Run>> pages;
    private static Font regular, bold;
    private static Dictionary<string, Font> fonts = new Dictionary<string, Font>();
    private static float pageWidth;
    private static float physicalPageWidth;
    private static bool rotateLabel;
    private static Image receiptLogo;
    private static string receiptLogoData;
    private static string[] qrRows;
    private static readonly Rectangle LogoCrop = new Rectangle(185, 280, 820, 640);
    private const float LogoWidth = 43f * MmToPt;
    private const float LogoHeight = LogoWidth * 640f / 820f;
    // Five whole 203-dpi dots per module, including the four-module quiet zone.
    private const float QrModule = 5f * 72f / 203f;
    private static int currentPage;
    private const float MmToPt = 72f / 25.4f;

    public static void ConfigureBranding(string logoPath, string[] rows) {
        if (rows == null || rows.Length < 21 || rows.Length > 177) throw new InvalidOperationException("Invalid receipt QR");
        foreach (string row in rows) if (row.Length != rows.Length || !System.Text.RegularExpressions.Regex.IsMatch(row, "^[01]+$")) throw new InvalidOperationException("Invalid receipt QR row");
        receiptLogo = Image.FromFile(logoPath);
        receiptLogoData = Convert.ToBase64String(System.IO.File.ReadAllBytes(logoPath));
        qrRows = rows;
    }

    public static void Prepare(string queue, string title, string[][] sections, float points, float widthMm, float heightMm, string[][] styles, string layoutTitle, bool verticalLabel, string[][] referenceLabels) {
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
        // Rotate the logical 32 x 57 mm artwork inside the installed 57 x 32 mm form.
        rotateLabel = verticalLabel;
        physicalPageWidth = area.Width * 0.72f;
        pageWidth = (rotateLabel ? area.Height : area.Width) * 0.72f;
        using (Graphics g = settings.CreateMeasurementGraphics()) {
            g.PageUnit = GraphicsUnit.Point;
            pages = Layout(g, String.IsNullOrEmpty(layoutTitle) ? title : layoutTitle, sections, pageWidth, (rotateLabel ? area.Width : area.Height) * 0.72f, styles, referenceLabels);
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
        fonts["issuer"] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
        fonts["phone"] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
        fonts["receipt-heading"] = new Font("Arial", 14, FontStyle.Bold, GraphicsUnit.Point);
        fonts["receipt-total"] = new Font("Arial", 15, FontStyle.Bold, GraphicsUnit.Point);
        fonts["quote"] = new Font("Times New Roman", 10, FontStyle.Bold | FontStyle.Italic, GraphicsUnit.Point);
        fonts["social"] = new Font("Arial", 11, FontStyle.Bold, GraphicsUnit.Point);
        fonts["ref-name"] = new Font("Arial", 9, FontStyle.Bold, GraphicsUnit.Point);
        fonts["ref-drink"] = new Font("Arial", 12, FontStyle.Bold, GraphicsUnit.Point);
        fonts["ref-body"] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
        fonts["ref-note"] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
        fonts["ref-meta"] = new Font("Arial", 7, FontStyle.Bold, GraphicsUnit.Point);
        fonts["ref-service"] = new Font("Arial", 8, FontStyle.Bold, GraphicsUnit.Point);
        foreach (string style in new [] { "name", "drink", "modifier", "note", "footer" })
            fonts[style] = new Font("Arial", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
    }
    private static Font FontFor(string style) { return style == "legacy-bold" ? bold : (fonts.ContainsKey(style) ? fonts[style] : regular); }
    private static float LineHeight(string style) {
        if (style == "logo") return LogoHeight + 4;
        if (style == "qr") { if (qrRows == null) throw new InvalidOperationException("Missing receipt QR"); return qrRows.Length * QrModule + 4; }
        if (style == "separator") return 7;
        return style.StartsWith("legacy") ? regular.SizeInPoints * 1.4f : FontFor(style).SizeInPoints * 1.22f + 0.5f;
    }
    private static List<List<Run>> Layout(Graphics g, string title, string[][] sections, float width, float height, string[][] styles, string[][] referenceLabels) {
        float margin = 2 * MmToPt;
        float usable = width - 2 * margin;
        if (usable < 40 || height < margin * 2 + LineHeight("modifier") * 3) throw new InvalidOperationException("Printable stock too small");
        List<List<Run>> output = new List<List<Run>>();
        for (int sectionIndex = 0; sectionIndex < sections.Length; sectionIndex++) {
            string[] section = sections[sectionIndex];
            if (referenceLabels != null) {
                if (sectionIndex >= referenceLabels.Length || referenceLabels[sectionIndex].Length != 5 || section.Length < 3)
                    throw new InvalidOperationException("Incomplete reference label");
                LayoutReferenceLabel(g, section, styles == null ? null : styles[sectionIndex], referenceLabels[sectionIndex], width, height, output);
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
                if (style == "logo" || style == "qr" || style == "separator") {
                    if ((style == "logo" || style == "qr") && receiptLogo == null) throw new InvalidOperationException("Missing receipt assets");
                    if (lineHeight > contentBottom - margin) throw new InvalidOperationException("Receipt graphic does not fit stock");
                    float keepHeight = lineHeight;
                    // Keep the QR, its caption and closing message together.
                    if (style == "qr") for (int tail = index + 1; tail < section.Length; tail++) {
                        string tailStyle = styles[sectionIndex][tail];
                        if (tailStyle == "separator") keepHeight += LineHeight(tailStyle);
                        else foreach (string ignored in Wrap(g, section[tail], FontFor(tailStyle), usable)) keepHeight += LineHeight(tailStyle);
                    }
                    if (keepHeight > contentBottom - margin) throw new InvalidOperationException("Receipt closing block does not fit stock");
                    if (y + keepHeight > contentBottom) {
                        page = new List<Run>(); output.Add(page); y = margin;
                        page.Add(new Run { Text = title + " CONT.", Style = "footer", Y = y }); y += LineHeight("footer");
                    }
                    page.Add(new Run { Text = section[index], Style = style, Y = y }); y += lineHeight;
                    continue;
                }
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
    private static float MeasuredWidth(Graphics g, string text, string style) {
        return g.MeasureString(text, FontFor(style), Int32.MaxValue, StringFormat.GenericTypographic).Width;
    }
    private static void LayoutReferenceLabel(Graphics g, string[] section, string[] styles, string[] identity, float width, float height, List<List<Run>> output) {
        float margin = 2 * MmToPt, usable = width - 2 * margin;
        float dateWidth = Math.Max(MeasuredWidth(g, identity[3], "ref-meta"), MeasuredWidth(g, identity[4], "ref-meta"));
        List<string> service = new List<string>(Wrap(g, identity[2], FontFor("ref-service"), usable - dateWidth - 4));
        float footerHeight = Math.Max(service.Count * LineHeight("ref-service"), 2 * LineHeight("ref-meta")) + 5;
        float footerTop = height - margin - footerHeight, bottom = footerTop - 3;
        List<string> drink = new List<string>(Wrap(g, section[1], FontFor("ref-drink"), usable));
        List<Run> body = new List<Run>();
        int preparationGroup = 0, nextPreparationGroup = 0;
        string preparationContext = null;
        for (int i = 2; i < section.Length - 1; i++) {
            bool note = styles != null && i < styles.Length && styles[i] == "note";
            bool preparationName = styles != null && i < styles.Length && styles[i] == "preparation-item";
            if (preparationName) { preparationGroup = ++nextPreparationGroup; preparationContext = section[i]; }
            if (note && section[i].StartsWith("ORDEN:", StringComparison.Ordinal)) { preparationGroup = 0; preparationContext = null; }
            string style = note ? "ref-note" : "ref-body";
            string value = note ? section[i] : "- " + section[i];
            foreach (string line in Wrap(g, value, FontFor(style), usable)) body.Add(new Run { Text = line, Style = style,
                PreparationGroup = preparationGroup, PreparationName = preparationName, PreparationContext = preparationContext });
        }
        int next = 0, part = 0;
        do {
            List<Run> page = new List<Run>(); output.Add(page);
            List<string> ids = new List<string>(Wrap(g, identity[0], FontFor("ref-meta"), usable * 0.45f));
            ids.AddRange(Wrap(g, identity[1] + (part++ > 0 ? " CONT." : ""), FontFor("ref-meta"), usable * 0.45f));
            float idWidth = 0;
            foreach (string id in ids) idWidth = Math.Max(idWidth, MeasuredWidth(g, id, "ref-meta"));
            List<string> names = new List<string>(Wrap(g, section[0], FontFor("ref-name"), usable - idWidth - 4));
            float y = margin;
            foreach (string name in names) { page.Add(new Run {Text=name,Style="ref-name",X=margin,Y=y}); y += LineHeight("ref-name"); }
            float idY = margin;
            foreach (string id in ids) { page.Add(new Run {Text=id,Style="ref-meta",X=width-margin-MeasuredWidth(g,id,"ref-meta"),Y=idY}); idY += LineHeight("ref-meta"); }
            y = Math.Max(y,idY) + 2;
            page.Add(new Run {Text="",Style="label-rule",X=margin,Y=y,RuleWidth=usable}); y += 4;
            float required = drink.Count * LineHeight("ref-drink") + 3 + (body.Count > 0 ? LineHeight("ref-body") : 0);
            if (y + required > bottom) throw new InvalidOperationException("Customer/drink identity leaves no room for label instructions");
            foreach (string line in drink) { page.Add(new Run {Text=line,Style="ref-drink",X=margin,Y=y}); y += LineHeight("ref-drink"); }
            y += 3;
            float freshCapacity = bottom - y;
            if (next < body.Count && body[next].PreparationGroup > 0 && !body[next].PreparationName) {
                List<string> context = new List<string>(Wrap(g, "- " + body[next].PreparationContext, FontFor("ref-body"), usable));
                if (context.Count * LineHeight("ref-body") + LineHeight(body[next].Style) > freshCapacity)
                    context = new List<string>(Wrap(g, "POSTRE " + body[next].PreparationGroup + " CONT.", FontFor("ref-body"), usable));
                foreach (string line in context) {
                    if (y + LineHeight("ref-body") + LineHeight(body[next].Style) > bottom) break;
                    page.Add(new Run {Text=line,Style="ref-body",X=margin,Y=y}); y += LineHeight("ref-body");
                }
            }
            int first = next;
            while (next < body.Count && y + LineHeight(body[next].Style) <= bottom) {
                if (body[next].PreparationName && (next == 0 || !body[next - 1].PreparationName
                    || body[next - 1].PreparationGroup != body[next].PreparationGroup)) {
                    float nameHeight = 0, groupHeight = 0;
                    for (int row = next; row < body.Count && body[row].PreparationGroup == body[next].PreparationGroup; row++) {
                        groupHeight += LineHeight(body[row].Style);
                        if (body[row].PreparationName) nameHeight += LineHeight(body[row].Style);
                    }
                    float keepHeight = groupHeight <= freshCapacity ? groupHeight : nameHeight;
                    // New grouped-dessert rows stay together when they fit a fresh
                    // label. Oversized names/notes still advance without dropping text.
                    if (keepHeight <= freshCapacity && y + keepHeight > bottom) break;
                }
                Run line = body[next++]; page.Add(new Run {Text=line.Text,Style=line.Style,X=margin,Y=y}); y += LineHeight(line.Style);
            }
            if (first == next && next < body.Count) throw new InvalidOperationException("No instruction fits label");
            page.Add(new Run {Text="",Style="label-rule",X=margin,Y=footerTop,RuleWidth=usable});
            float serviceY = footerTop + 4;
            foreach (string line in service) { page.Add(new Run {Text=line,Style="ref-service",X=margin,Y=serviceY}); serviceY += LineHeight("ref-service"); }
            page.Add(new Run {Text=identity[3],Style="ref-meta",X=width-margin-MeasuredWidth(g,identity[3],"ref-meta"),Y=footerTop+4});
            page.Add(new Run {Text=identity[4],Style="ref-meta",X=width-margin-MeasuredWidth(g,identity[4],"ref-meta"),Y=footerTop+4+LineHeight("ref-meta")});
        } while (next < body.Count);
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
        if (run.Style == "brand" || run.Style == "meta" || run.Style == "issuer" || run.Style == "phone" || run.Style == "receipt-heading" || run.Style == "receipt-total" || run.Style == "quote" || run.Style == "social") x = Math.Max(margin, (width - measured) / 2);
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
            if (run.Style == "label-rule") { using (Pen pen = new Pen(Color.Black, 0.65f)) g.DrawLine(pen, run.X.Value, run.Y, run.X.Value + run.RuleWidth, run.Y); continue; }
            if (run.Style == "logo") {
                using (var attributes = new System.Drawing.Imaging.ImageAttributes()) {
                    attributes.SetThreshold(0.85f);
                    g.DrawImage(receiptLogo, Rectangle.Round(new RectangleF((width - LogoWidth) / 2, run.Y, LogoWidth, LogoHeight)), LogoCrop.X, LogoCrop.Y, LogoCrop.Width, LogoCrop.Height, GraphicsUnit.Pixel, attributes);
                }
                continue;
            }
            if (run.Style == "qr") {
                float start = (width - qrRows.Length * QrModule) / 2;
                for (int row = 0; row < qrRows.Length; row++) for (int col = 0; col < qrRows.Length; col++)
                    if (qrRows[row][col] == '1') g.FillRectangle(Brushes.Black, start + col * QrModule, run.Y + row * QrModule, QrModule, QrModule);
                continue;
            }
            if (run.Style == "separator") { g.DrawLine(Pens.Black, margin, run.Y + 3, width - margin, run.Y + 3); continue; }
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
    public static string[][] Preview(string title, string[][] sections, float points, float widthMm, float heightMm, string[][] styles, string outputDirectory, bool verticalLabel, string[][] referenceLabels, bool transparentBackground) {
        InitializeFonts(points);
        using (Bitmap bitmap = new Bitmap(1, 1)) using (Graphics g = Graphics.FromImage(bitmap)) {
            bitmap.SetResolution(203, 203);
            g.PageUnit = GraphicsUnit.Point;
            float logicalWidth = (verticalLabel ? heightMm : widthMm) * MmToPt;
            float logicalHeight = (verticalLabel ? widthMm : heightMm) * MmToPt;
            List<List<Run>> layout = Layout(g, title, sections, logicalWidth, logicalHeight, styles, referenceLabels);
            List<string[]> result = new List<string[]>();
            foreach (List<Run> page in layout) result.Add(page.ConvertAll(run => run.Text).ToArray());
            if (!String.IsNullOrEmpty(outputDirectory)) {
                System.IO.Directory.CreateDirectory(outputDirectory);
                for (int index = 0; index < layout.Count; index++) {
                    using (Bitmap image = new Bitmap((int)Math.Ceiling(widthMm / 25.4f * 203), (int)Math.Ceiling(heightMm / 25.4f * 203))) {
                        image.SetResolution(203, 203);
                        using (Graphics canvas = Graphics.FromImage(image)) { canvas.Clear(transparentBackground ? Color.Transparent : Color.White); canvas.PageUnit = GraphicsUnit.Point; DrawPhysicalPage(canvas, layout[index], widthMm * MmToPt, logicalWidth, verticalLabel); }
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
            if (run.Style == "label-rule") { svg.Append("<path d=\"M" + Number(run.X.Value) + " " + Number(run.Y) + "h" + Number(run.RuleWidth) + "\" stroke=\"black\" stroke-width=\"0.65\"/>"); continue; }
            if (run.Style == "logo") {
                svg.Append("<svg x=\"" + Number((logicalWidth - LogoWidth) / 2) + "\" y=\"" + Number(run.Y) + "\" width=\"" + Number(LogoWidth) + "\" height=\"" + Number(LogoHeight) + "\" viewBox=\"185 280 820 640\"><image width=\"1200\" height=\"1200\" href=\"data:image/jpeg;base64," + receiptLogoData + "\"/></svg>"); continue;
            }
            if (run.Style == "qr") {
                float start = (logicalWidth - qrRows.Length * QrModule) / 2;
                svg.Append("<g shape-rendering=\"crispEdges\">");
                for (int row = 0; row < qrRows.Length; row++) for (int col = 0; col < qrRows.Length; col++)
                    if (qrRows[row][col] == '1') svg.Append("<rect x=\"" + Number(start + col * QrModule) + "\" y=\"" + Number(run.Y + row * QrModule) + "\" width=\"" + Number(QrModule) + "\" height=\"" + Number(QrModule) + "\"/>");
                svg.Append("</g>"); continue;
            }
            if (run.Style == "separator") { svg.Append("<path d=\"M" + Number(2 * MmToPt) + " " + Number(run.Y + 3) + "h" + Number(logicalWidth - 4 * MmToPt) + "\" stroke=\"black\"/>"); continue; }
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
        if (receiptLogo != null) receiptLogo.Dispose();
        receiptLogo = null; qrRows = null; receiptLogoData = null;
        if (document != null) document.Dispose();
        if (regular != null) regular.Dispose();
        if (bold != null) bold.Dispose();
        foreach (Font font in fonts.Values) font.Dispose();
        fonts.Clear();
    }
}
