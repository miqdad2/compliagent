/**
 * pdf-lib annotation renderer.
 *
 * Implements PdfAnnotationRenderer using the server-only pdf-lib library.
 *
 * Rendering process:
 *   1. Download the original PDF from Supabase private storage.
 *   2. Verify its SHA-256 hash matches the stored source hash.
 *   3. Load with PDFDocument (pdf-lib).
 *   4. For each approved annotation on each page:
 *      a. Convert normalized (0–1) bounding box to PDF points.
 *      b. Draw evidence highlight (rectangle or cloud outline).
 *      c. Compute callout placement (deterministic placement engine).
 *      d. Draw callout box with clause + status + reasoning text.
 *      e. Draw connector line from callout to evidence center.
 *   5. Serialize the modified PDFDocument to a buffer.
 *   6. Compute SHA-256 of the output buffer.
 *   7. Upload to a new private storage path (never overwriting the source).
 *   8. Return result with output hash, path, warnings, and page count.
 *
 * The original storage object is NEVER modified.
 */
import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts, LineCapStyle } from "pdf-lib";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { computeAnnotationPlacement } from "@/lib/annotations/placement";
import type { PdfAnnotationRenderer, PdfAnnotationRenderInput, PdfAnnotationRenderResult, PageRenderWarning } from "@/lib/annotations/pdf-renderer";
import type { PreparedAnnotation } from "@/server/services/annotations/annotation-preparation";
import type { BoundingBox } from "@/lib/documents/coordinates";

export const PDF_LIB_RENDERER_VERSION = "pdf-lib:1.0";

const CALLOUT_WIDTH_PTS  = 160;
const CALLOUT_HEIGHT_PTS = 90;
const MARGIN_PTS         = 12;
const FONT_SIZE_HEADER   = 7;
const FONT_SIZE_BODY     = 6;

function sha256hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function buildOutputPath(organizationId: string, projectId: string, reviewId: string): string {
  const ts = Date.now();
  return `${organizationId}/${projectId}/${reviewId}/annotated-${ts}.pdf`;
}

/** Word-wrap text to fit within maxChars per line. */
function wrapWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word.length > maxChars ? word.slice(0, maxChars - 1) + "…" : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Convert normalized [0–1] box to PDF points, accounting for PDF's bottom-left origin. */
function normToPoints(
  norm: BoundingBox,
  pageWidth:  number,
  pageHeight: number
): BoundingBox {
  return {
    x:      norm.x * pageWidth,
    y:      (1 - norm.y - norm.height) * pageHeight,   // PDF y is from bottom
    width:  norm.width  * pageWidth,
    height: norm.height * pageHeight
  };
}

export class PdfLibAnnotationRenderer implements PdfAnnotationRenderer {
  constructor(
    private readonly db = createSupabaseAdminClient()
  ) {}

  async render(input: PdfAnnotationRenderInput): Promise<PdfAnnotationRenderResult> {
    const { organizationId, projectId, reviewId, sourceStoragePath, sourceHash, annotations } = input;

    if (!this.db) throw new Error("Database client is not available.");

    // ── 1. Download original PDF ─────────────────────────────────────────────
    const { data: fileData, error: downloadError } = await this.db.storage
      .from("documents")
      .download(sourceStoragePath);

    if (downloadError || !fileData) {
      throw new Error(`Could not download source PDF: ${downloadError?.message ?? "not found"}`);
    }

    const sourceBuffer = new Uint8Array(await fileData.arrayBuffer());

    // ── 2. Verify source hash ─────────────────────────────────────────────────
    const actualHash = sha256hex(sourceBuffer);
    if (actualHash !== sourceHash) {
      throw new Error(
        `Source document hash mismatch. The document may have been replaced. Rerun the review before annotating.`
      );
    }

    // ── 3. Load PDF ───────────────────────────────────────────────────────────
    const pdfDoc = await PDFDocument.load(sourceBuffer, { ignoreEncryption: true });
    const pages  = pdfDoc.getPages();
    const originalPageCount = pages.length;

    const font  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const warnings:    PageRenderWarning[]  = [];
    let   annotCount   = 0;

    // Group annotations by page.
    const byPage = new Map<number, PreparedAnnotation[]>();
    for (const ann of annotations) {
      const list = byPage.get(ann.pageNumber) ?? [];
      list.push(ann);
      byPage.set(ann.pageNumber, list);
    }

    // ── 4. Draw annotations ───────────────────────────────────────────────────
    for (const [pageNum, pageAnns] of byPage) {
      const pageIndex = pageNum - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) {
        warnings.push({ pageNumber: pageNum, message: `Page ${pageNum} does not exist in this PDF (${pages.length} pages). Annotation skipped.` });
        continue;
      }

      const page = pages[pageIndex]!;
      const { width: pageW, height: pageH } = page.getSize();

      const existingCallouts: BoundingBox[] = [];

      for (const ann of pageAnns) {
        if (!ann.input.normalizedBox) {
          warnings.push({ pageNumber: pageNum, message: `Finding ${ann.input.findingId}: no normalized bounding box. Callout placed at default position.` });
        }

        // Convert normalized box to PDF points (bottom-left origin).
        const evidenceNorm: BoundingBox = ann.input.normalizedBox ?? { x: 0.05, y: 0.05, width: 0.4, height: 0.04 };
        const evidencePts  = normToPoints(evidenceNorm, pageW, pageH);

        // Compute callout placement.
        const placement = computeAnnotationPlacement({
          page:             { width: pageW, height: pageH, rotation: 0 },
          evidenceBox:      evidencePts,
          callout:          { width: CALLOUT_WIDTH_PTS, height: CALLOUT_HEIGHT_PTS },
          existingCallouts,
          margin:           MARGIN_PTS
        });

        if (placement.warnings.length > 0) {
          placement.warnings.forEach((w) => warnings.push({ pageNumber: pageNum, message: `Finding ${ann.input.findingId}: ${w}` }));
        }

        existingCallouts.push(placement.callout);
        const c = ann.style.colors;
        const hlColor = rgb(c.highlightBorder.r / 255, c.highlightBorder.g / 255, c.highlightBorder.b / 255);
        const ctColor = rgb(c.calloutBorder.r   / 255, c.calloutBorder.g   / 255, c.calloutBorder.b   / 255);
        const bgColor = rgb(c.calloutFill.r     / 255, c.calloutFill.g     / 255, c.calloutFill.b     / 255);
        const txColor = rgb(c.labelText.r       / 255, c.labelText.g       / 255, c.labelText.b       / 255);

        // Draw evidence highlight rectangle.
        page.drawRectangle({
          x:            evidencePts.x,
          y:            evidencePts.y,
          width:        evidencePts.width,
          height:       evidencePts.height,
          borderColor:  hlColor,
          borderWidth:  1.5,
          color:        rgb(c.highlightFill.r / 255, c.highlightFill.g / 255, c.highlightFill.b / 255),
          opacity:      c.highlightOpacity
        });

        // Draw connector line.
        page.drawLine({
          start:       { x: placement.connectorStart.x, y: placement.connectorStart.y },
          end:         { x: placement.connectorEnd.x,   y: placement.connectorEnd.y },
          color:       ctColor,
          thickness:   1.0,
          lineCap:     LineCapStyle.Round
        });

        // Draw callout box (filled rectangle).
        const ct = placement.callout;
        page.drawRectangle({
          x:           ct.x,
          y:           ct.y,
          width:       ct.width,
          height:      ct.height,
          color:       bgColor,
          borderColor: ctColor,
          borderWidth: 1.2,
          opacity:     0.95
        });

        // Draw callout text (header line + word-wrapped body).
        const headerText = `${ann.text.clauseLabel} — ${ann.text.statusLabel}`;
        const rawBodyLines = ann.text.calloutText
          .split("\n")
          .filter((l) => l !== headerText && l.trim().length > 0);

        // Word-wrap each body line to fit callout width (~30 chars @ 6pt in 160pt box).
        const wrappedBodyLines: string[] = [];
        for (const rawLine of rawBodyLines) {
          for (const wrapped of wrapWords(rawLine, 30)) {
            wrappedBodyLines.push(wrapped);
          }
        }

        const textPad  = 4;
        const textTopY = ct.y + ct.height - textPad - FONT_SIZE_HEADER;

        // Header line (truncate to fit).
        page.drawText(headerText.slice(0, 32), {
          x:        ct.x + textPad,
          y:        textTopY,
          size:     FONT_SIZE_HEADER,
          font:     font,
          color:    txColor,
          maxWidth: ct.width - textPad * 2
        });

        // Body lines (word-wrapped, capped at available vertical space).
        let lineY = textTopY - FONT_SIZE_BODY - 3;
        for (const line of wrappedBodyLines) {
          if (lineY < ct.y + textPad + FONT_SIZE_BODY) break;
          page.drawText(line, {
            x:        ct.x + textPad,
            y:        lineY,
            size:     FONT_SIZE_BODY,
            font:     fontR,
            color:    rgb(0.15, 0.2, 0.27),
            maxWidth: ct.width - textPad * 2
          });
          lineY -= FONT_SIZE_BODY + 2;
        }
        if (lineY >= ct.y + textPad + FONT_SIZE_BODY && wrappedBodyLines.length > 0) {
          // All lines fit — no overflow.
        } else if (wrappedBodyLines.length > 0) {
          // Overflow: draw ellipsis indicator at bottom.
          const remainY = ct.y + textPad + 1;
          if (remainY > ct.y) {
            page.drawText("…", {
              x: ct.x + ct.width - textPad - 6,
              y: remainY,
              size: FONT_SIZE_BODY,
              font: fontR,
              color: rgb(0.5, 0.5, 0.5)
            });
          }
        }

        annotCount++;
      }
    }

    // ── 5. Serialize ──────────────────────────────────────────────────────────
    const outputBytes = await pdfDoc.save();
    const outputBuffer = new Uint8Array(outputBytes);

    // ── 6. Hash ───────────────────────────────────────────────────────────────
    const outputHash = sha256hex(outputBuffer);

    // ── 7. Upload to new storage path (never overwrite original) ─────────────
    const outputPath = buildOutputPath(organizationId, projectId, reviewId);
    const { error: uploadError } = await this.db.storage
      .from("exports")
      .upload(outputPath, outputBuffer, {
        contentType: "application/pdf",
        upsert:      false
      });

    if (uploadError) {
      throw new Error(`Could not upload annotated PDF: ${uploadError.message}`);
    }

    return {
      outputBuffer,
      outputHash,
      outputStoragePath: outputPath,
      pageCount:    originalPageCount,
      warnings,
      annotationCount: annotCount,
      rendererVersion: PDF_LIB_RENDERER_VERSION
    };
  }
}
