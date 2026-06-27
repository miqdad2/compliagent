/**
 * Provider-neutral PDF annotation renderer interface.
 *
 * Implementations must:
 *   - Read the original PDF from private storage.
 *   - Create a NEW annotated output — never modify the original.
 *   - Preserve the original page count and dimensions.
 *   - Draw approved annotation elements (highlight, callout, connector).
 *   - Output a buffer to a new private storage path.
 *   - Record renderer version, output hash, and page-level warnings.
 */
import type { PreparedAnnotation } from "@/server/services/annotations/annotation-preparation";

export type PdfAnnotationRenderInput = {
  organizationId: string;
  projectId:      string;
  reviewId:       string;
  /** Path in private Supabase storage to the original source PDF. */
  sourceStoragePath: string;
  /** SHA-256 hash of the source PDF (checked before render). */
  sourceHash:     string;
  annotations:    PreparedAnnotation[];
  rendererVersion: string;
};

export type PageRenderWarning = {
  pageNumber: number;
  message:    string;
};

export type PdfAnnotationRenderResult = {
  /** Buffer containing the annotated PDF. */
  outputBuffer:    Uint8Array;
  /** SHA-256 hex of the output buffer. */
  outputHash:      string;
  /** Supabase storage path where the output has been saved. */
  outputStoragePath: string;
  /** Original page count (must match output). */
  pageCount:       number;
  /** Per-page placement warnings. */
  warnings:        PageRenderWarning[];
  /** Number of annotations drawn. */
  annotationCount: number;
  rendererVersion: string;
};

export interface PdfAnnotationRenderer {
  render(input: PdfAnnotationRenderInput): Promise<PdfAnnotationRenderResult>;
}
