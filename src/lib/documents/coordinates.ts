/**
 * Deterministic coordinate utilities for document evidence regions.
 *
 * Supports conversion between coordinate systems, page-boundary clamping,
 * normalization with rotation handling, and overlap/containment checks.
 * All math is pure — no I/O, no side effects.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CoordinateSystem = "pdf_points" | "pixels" | "normalized" | "sheet_cells" | "slide_emu";

export interface ConversionContext {
  sourceSystem: CoordinateSystem;
  pageWidth: number;
  pageHeight: number;
  rotation?: 0 | 90 | 180 | 270;
}

// ============================================================
// Validation
// ============================================================

export function validateBoundingBox(box: BoundingBox): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(box.x)) errors.push("x must be finite");
  if (!Number.isFinite(box.y)) errors.push("y must be finite");
  if (!Number.isFinite(box.width)) errors.push("width must be finite");
  if (!Number.isFinite(box.height)) errors.push("height must be finite");
  if (Number.isFinite(box.width) && box.width <= 0) errors.push("width must be positive");
  if (Number.isFinite(box.height) && box.height <= 0) errors.push("height must be positive");
  return errors;
}

export function validateNormalizedBox(box: BoundingBox): string[] {
  const errors = validateBoundingBox(box);
  if (Number.isFinite(box.x) && (box.x < 0 || box.x > 1))
    errors.push("normalized x must be between 0 and 1");
  if (Number.isFinite(box.y) && (box.y < 0 || box.y > 1))
    errors.push("normalized y must be between 0 and 1");
  if (
    Number.isFinite(box.x) &&
    Number.isFinite(box.width) &&
    box.x + box.width > 1 + Number.EPSILON
  )
    errors.push("normalized box extends beyond right page boundary");
  if (
    Number.isFinite(box.y) &&
    Number.isFinite(box.height) &&
    box.y + box.height > 1 + Number.EPSILON
  )
    errors.push("normalized box extends beyond bottom page boundary");
  return errors;
}

// ============================================================
// Clamping
// ============================================================

export function clampToPageBoundary(
  box: BoundingBox,
  pageWidth: number,
  pageHeight: number
): BoundingBox {
  const x = Math.max(0, Math.min(box.x, pageWidth));
  const y = Math.max(0, Math.min(box.y, pageHeight));
  const width = Math.max(0, Math.min(box.width, pageWidth - x));
  const height = Math.max(0, Math.min(box.height, pageHeight - y));
  return { x, y, width, height };
}

// ============================================================
// Normalization — converts source coordinates to 0–1 space
// ============================================================

export function normalizeBox(box: BoundingBox, ctx: ConversionContext): BoundingBox {
  const clamped = clampToPageBoundary(box, ctx.pageWidth, ctx.pageHeight);

  let x = clamped.x / ctx.pageWidth;
  let y = clamped.y / ctx.pageHeight;
  let w = clamped.width / ctx.pageWidth;
  let h = clamped.height / ctx.pageHeight;

  // Rotate coordinate system so 0,0 is always top-left after rotation.
  // PDF rotation describes how the page is displayed — we reverse that
  // to get layout-neutral normalized coordinates.
  const rotation = ctx.rotation ?? 0;
  if (rotation === 90) {
    [x, y, w, h] = [1 - y - h, x, h, w];
  } else if (rotation === 180) {
    x = 1 - x - w;
    y = 1 - y - h;
  } else if (rotation === 270) {
    [x, y, w, h] = [y, 1 - x - w, h, w];
  }

  return {
    x: Math.max(0, Math.min(x, 1)),
    y: Math.max(0, Math.min(y, 1)),
    width: Math.max(0, Math.min(w, 1)),
    height: Math.max(0, Math.min(h, 1)),
  };
}

// ============================================================
// Spatial queries
// ============================================================

export function overlappingArea(a: BoundingBox, b: BoundingBox): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

export function containsPoint(box: BoundingBox, px: number, py: number): boolean {
  return px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
}
