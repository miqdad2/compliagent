/**
 * Coordinate-aware document model.
 *
 * These types extend the basic text extraction model to carry spatial
 * information — text block positions, table cell coordinates, visual
 * region markers, page dimensions, and extraction quality results.
 *
 * Coordinate availability varies by format:
 *   - PDF:   coordinate system declared; per-block boxes unavailable without pdfjs-direct adapter
 *   - DOCX:  logical structure (heading level, table row/col); no rendered coordinates
 *   - PPTX:  shape-level EMU coordinates converted to normalized on extraction
 *   - XLSX:  sheet + cell range; no pixel coordinates
 */

import type { BoundingBox } from "./coordinates";
import type { ExtractionMethod } from "./chunking";

// ============================================================
// Coordinate system
// ============================================================

export type DocumentCoordinateSystem =
  | "pdf_points"
  | "pixels"
  | "normalized"
  | "sheet_cells"
  | "slide_emu"
  | "unknown";

// ============================================================
// Text blocks
// ============================================================

export type TextBlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "table_cell"
  | "caption"
  | "header"
  | "footer"
  | "unknown";

export interface ExtractedTextBlock {
  id: string;
  text: string;
  normalizedText: string;
  pageNumber: number;
  blockType: TextBlockType;
  readingOrder: number;
  clauseNumber?: string;
  sectionHeading?: string;
  headingLevel?: number;
  boundingBox?: BoundingBox;
  normalizedBoundingBox?: BoundingBox;
  coordinateSystem?: DocumentCoordinateSystem;
  extractionConfidence: number;
}

// ============================================================
// Tables
// ============================================================

export interface ExtractedTableCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  boundingBox?: BoundingBox;
}

export interface ExtractedTableRow {
  rowIndex: number;
  cells: ExtractedTableCell[];
}

export interface ExtractedTable {
  pageNumber: number;
  tableIndex: number;
  coordinateSystem?: DocumentCoordinateSystem;
  boundingBox?: BoundingBox;
  rows: ExtractedTableRow[];
}

// ============================================================
// Visual regions (images, drawings, etc.)
// ============================================================

export type VisualRegionType =
  | "image"
  | "drawing"
  | "diagram"
  | "chart"
  | "signature"
  | "stamp"
  | "unknown";

export interface ExtractedVisualRegion {
  pageNumber: number;
  regionType: VisualRegionType;
  boundingBox?: BoundingBox;
  coordinateSystem?: DocumentCoordinateSystem;
  description?: string;
}

// ============================================================
// Coordinate-aware page
// ============================================================

export interface ExtractedPage {
  pageNumber: number;
  width?: number;
  height?: number;
  rotation?: number;
  coordinateSystem: DocumentCoordinateSystem;
  coordinatesAvailable: boolean;
  textBlocks: ExtractedTextBlock[];
  tables?: ExtractedTable[];
  visualRegions?: ExtractedVisualRegion[];
  extractionMethod: ExtractionMethod;
  extractionConfidence: number;
  warnings: string[];
  requiresOcr: boolean;
}

// ============================================================
// Extraction quality
// ============================================================

export type QualityClassification = "excellent" | "good" | "weak" | "unusable";

export interface PageQualityResult {
  pageNumber: number;
  score: number;
  classification: QualityClassification;
  requiresOcr: boolean;
  reasons: string[];
  charCount: number;
  wordCount: number;
  isEmpty: boolean;
  hasReplacementChars: boolean;
  hasControlChars: boolean;
}

export interface ExtractionQualityResult {
  score: number;
  classification: QualityClassification;
  requiresOcr: boolean;
  reasons: string[];
  pageResults: PageQualityResult[];
}
