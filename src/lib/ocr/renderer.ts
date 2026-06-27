/**
 * Document-page renderer interface.
 *
 * A renderer converts a source document page to a raster image that
 * can be used for OCR and future annotation preview. Rendered images
 * must never be exposed publicly and must reference a private storage
 * path or an in-memory buffer.
 *
 * No implementation is provided in this unit. The interface exists so
 * callers can depend on the abstraction rather than a specific renderer.
 */

export interface RenderPageInput {
  documentId: string;
  storagePath: string;
  pageNumber: number;
  mimeType: string;
  dpi?: number;
  sourceHash: string;
}

export interface RenderedPage {
  pageNumber: number;
  imageBuffer: Buffer;
  imageMimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  dpi: number;
  rotation: number;
  sourceHash: string;
  rendererVersion: string;
}

export interface DocumentPageRenderer {
  /** Returns true if this renderer can produce page images for the given MIME type. */
  supports(mimeType: string): boolean;

  /** Renders a single page to a raster image. */
  renderPage(input: RenderPageInput): Promise<RenderedPage>;
}
