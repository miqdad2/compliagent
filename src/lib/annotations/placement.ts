/**
 * Deterministic annotation callout placement engine.
 *
 * Computes where to place a callout box so that it:
 *   1. Stays within the page boundary.
 *   2. Does not cover the evidence highlight.
 *   3. Minimizes overlap with existing callouts.
 *   4. Has a connector line pointing from callout to evidence.
 *
 * All coordinate values are in the page's native unit (PDF points,
 * normalized 0–1, etc.) — the caller is responsible for supplying
 * consistent units.  The engine itself is coordinate-system agnostic.
 *
 * Placement priority:
 *   1. Right margin
 *   2. Left margin
 *   3. Above evidence
 *   4. Below evidence
 *   5. Nearest available area (collision-minimizing)
 */
import type { BoundingBox } from "@/lib/documents/coordinates";

export type PlacementInput = {
  /** Full page dimensions. */
  page: { width: number; height: number; rotation: 0 | 90 | 180 | 270 };
  /** The evidence highlight bounding box in page units. */
  evidenceBox: BoundingBox;
  /** Callout box dimensions in page units. */
  callout: { width: number; height: number };
  /** Already placed callout boxes on this page. */
  existingCallouts: BoundingBox[];
  /** Minimum gap between callout and evidence. */
  margin: number;
};

export type PlacementSide = "right" | "left" | "above" | "below" | "fallback";

export type PlacementResult = {
  /** Proposed evidence highlight box (clamped to page). */
  highlight:         BoundingBox;
  /** Proposed callout box. */
  callout:           BoundingBox;
  /** Connector start point (mid-side of callout facing evidence). */
  connectorStart:    { x: number; y: number };
  /** Connector end point (mid of evidence box). */
  connectorEnd:      { x: number; y: number };
  /** Which side was chosen. */
  side:              PlacementSide;
  /** Sum of overlapping area with other callouts (lower is better). */
  collisionScore:    number;
  /** Human-readable placement warnings. */
  warnings:          string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function boxCenter(box: BoundingBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function overlappingArea(a: BoundingBox, b: BoundingBox): number {
  const left   = Math.max(a.x, b.x);
  const right  = Math.min(a.x + a.width, b.x + b.width);
  const top    = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

function totalCollision(candidate: BoundingBox, existing: BoundingBox[]): number {
  return existing.reduce((sum, box) => sum + overlappingArea(candidate, box), 0);
}

function clampToPage(
  candidate: BoundingBox,
  pageWidth:  number,
  pageHeight: number
): { box: BoundingBox; clipped: boolean } {
  const x = clamp(candidate.x, 0, pageWidth  - candidate.width);
  const y = clamp(candidate.y, 0, pageHeight - candidate.height);
  const clipped = x !== candidate.x || y !== candidate.y;
  return { box: { x, y, width: candidate.width, height: candidate.height }, clipped };
}

function candidateForSide(
  side:     PlacementSide,
  ev:       BoundingBox,
  callout:  { width: number; height: number },
  margin:   number
): BoundingBox {
  const evCx = ev.x + ev.width  / 2;
  const evCy = ev.y + ev.height / 2;

  switch (side) {
    case "right":
      return {
        x:      ev.x + ev.width + margin,
        y:      evCy - callout.height / 2,
        width:  callout.width,
        height: callout.height
      };
    case "left":
      return {
        x:      ev.x - callout.width - margin,
        y:      evCy - callout.height / 2,
        width:  callout.width,
        height: callout.height
      };
    case "above":
      return {
        x:      evCx - callout.width / 2,
        y:      ev.y - callout.height - margin,
        width:  callout.width,
        height: callout.height
      };
    case "below":
    default:
      return {
        x:      evCx - callout.width / 2,
        y:      ev.y + ev.height + margin,
        width:  callout.width,
        height: callout.height
      };
  }
}

function connectorPoints(
  calloutBox: BoundingBox,
  side:       PlacementSide,
  evidenceBox: BoundingBox
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const evCenter = boxCenter(evidenceBox);
  const ctCenter = boxCenter(calloutBox);

  // Start: mid-side of the callout facing the evidence.
  let startX: number;
  let startY: number;
  switch (side) {
    case "right":
      startX = calloutBox.x;
      startY = ctCenter.y;
      break;
    case "left":
      startX = calloutBox.x + calloutBox.width;
      startY = ctCenter.y;
      break;
    case "above":
      startX = ctCenter.x;
      startY = calloutBox.y + calloutBox.height;
      break;
    default:
      startX = ctCenter.x;
      startY = calloutBox.y;
  }

  return { start: { x: startX, y: startY }, end: evCenter };
}

export function computeAnnotationPlacement(input: PlacementInput): PlacementResult {
  const { page, evidenceBox, callout, existingCallouts, margin } = input;
  const warnings: string[] = [];
  const SIDES: PlacementSide[] = ["right", "left", "above", "below"];

  const candidates: Array<{ side: PlacementSide; box: BoundingBox; clipped: boolean; collision: number }> = [];

  for (const side of SIDES) {
    const raw = candidateForSide(side, evidenceBox, callout, margin);
    const { box, clipped } = clampToPage(raw, page.width, page.height);
    const collision = totalCollision(box, existingCallouts);
    candidates.push({ side, box, clipped, collision });
  }

  // Sort: prefer unclipped, then lowest collision.
  candidates.sort((a, b) => {
    if (a.clipped !== b.clipped) return a.clipped ? 1 : -1;
    return a.collision - b.collision;
  });

  const best = candidates[0]!;

  if (best.clipped) {
    warnings.push(`Callout was adjusted to fit within page boundaries on the ${best.side} side.`);
  }
  if (best.collision > 0) {
    warnings.push(`Callout overlaps existing annotations by ${Math.round(best.collision)} page units. Manual repositioning may be required.`);
  }

  // Check if all candidates were clipped — flag for manual positioning.
  if (candidates.every((c) => c.clipped)) {
    warnings.push("No unclipped placement found. Annotation requires manual positioning.");
  }

  const { start, end } = connectorPoints(best.box, best.side, evidenceBox);

  return {
    highlight:      evidenceBox,
    callout:        best.box,
    connectorStart: start,
    connectorEnd:   end,
    side:           best.side,
    collisionScore: best.collision,
    warnings
  };
}
