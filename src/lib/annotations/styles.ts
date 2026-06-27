/**
 * Status-specific annotation styles for approved compliance findings.
 *
 * Defines the visual appearance of each annotation element based on the
 * compliance status of the finding it represents.  All values are
 * dimension-less ratios or named style tokens — coordinates are resolved
 * at render time from the evidence bounding box.
 */
import type { ComplianceStatus } from "@/types/domain";

export type AnnotationStyleVersion = "v1.0";

export type RGB = { r: number; g: number; b: number };

export type AnnotationColors = {
  /** Outline / border color for the evidence highlight. */
  highlightBorder:  RGB;
  /** Fill color for the evidence highlight (with opacity). */
  highlightFill:    RGB;
  highlightOpacity: number;
  /** Callout box border color. */
  calloutBorder:    RGB;
  /** Callout box fill. */
  calloutFill:      RGB;
  /** Connector line color. */
  connectorColor:   RGB;
  /** Status label text color. */
  labelText:        RGB;
  /** Status label background. */
  labelBackground:  RGB;
};

export type AnnotationStyleMeta = {
  version:        AnnotationStyleVersion;
  status:         ComplianceStatus;
  colors:         AnnotationColors;
  highlightShape: "rectangle" | "cloud";
  connectorDash:  boolean;
};

function rgb(r: number, g: number, b: number): RGB { return { r, g, b }; }

const STATUS_STYLES: Record<ComplianceStatus, AnnotationStyleMeta> = {
  complied: {
    version:        "v1.0",
    status:         "complied",
    highlightShape: "rectangle",
    connectorDash:  false,
    colors: {
      highlightBorder:  rgb(21, 128, 61),
      highlightFill:    rgb(220, 252, 231),
      highlightOpacity: 0.4,
      calloutBorder:    rgb(21, 128, 61),
      calloutFill:      rgb(240, 253, 244),
      connectorColor:   rgb(21, 128, 61),
      labelText:        rgb(21, 128, 61),
      labelBackground:  rgb(220, 252, 231)
    }
  },
  exceeds_requirement: {
    version:        "v1.0",
    status:         "exceeds_requirement",
    highlightShape: "rectangle",
    connectorDash:  false,
    colors: {
      highlightBorder:  rgb(3, 105, 161),
      highlightFill:    rgb(224, 242, 254),
      highlightOpacity: 0.4,
      calloutBorder:    rgb(3, 105, 161),
      calloutFill:      rgb(240, 249, 255),
      connectorColor:   rgb(3, 105, 161),
      labelText:        rgb(3, 105, 161),
      labelBackground:  rgb(224, 242, 254)
    }
  },
  partially_complied: {
    version:        "v1.0",
    status:         "partially_complied",
    highlightShape: "cloud",
    connectorDash:  false,
    colors: {
      highlightBorder:  rgb(180, 83, 9),
      highlightFill:    rgb(254, 243, 199),
      highlightOpacity: 0.35,
      calloutBorder:    rgb(180, 83, 9),
      calloutFill:      rgb(255, 251, 235),
      connectorColor:   rgb(180, 83, 9),
      labelText:        rgb(180, 83, 9),
      labelBackground:  rgb(254, 243, 199)
    }
  },
  not_complied: {
    version:        "v1.0",
    status:         "not_complied",
    highlightShape: "cloud",
    connectorDash:  false,
    colors: {
      highlightBorder:  rgb(185, 28, 28),
      highlightFill:    rgb(254, 226, 226),
      highlightOpacity: 0.35,
      calloutBorder:    rgb(185, 28, 28),
      calloutFill:      rgb(255, 241, 242),
      connectorColor:   rgb(185, 28, 28),
      labelText:        rgb(185, 28, 28),
      labelBackground:  rgb(254, 226, 226)
    }
  },
  ambiguous: {
    version:        "v1.0",
    status:         "ambiguous",
    highlightShape: "cloud",
    connectorDash:  true,
    colors: {
      highlightBorder:  rgb(126, 34, 206),
      highlightFill:    rgb(243, 232, 255),
      highlightOpacity: 0.3,
      calloutBorder:    rgb(126, 34, 206),
      calloutFill:      rgb(250, 245, 255),
      connectorColor:   rgb(126, 34, 206),
      labelText:        rgb(126, 34, 206),
      labelBackground:  rgb(243, 232, 255)
    }
  },
  not_proven: {
    version:        "v1.0",
    status:         "not_proven",
    highlightShape: "cloud",
    connectorDash:  true,
    colors: {
      highlightBorder:  rgb(100, 116, 139),
      highlightFill:    rgb(241, 245, 249),
      highlightOpacity: 0.25,
      calloutBorder:    rgb(100, 116, 139),
      calloutFill:      rgb(248, 250, 252),
      connectorColor:   rgb(100, 116, 139),
      labelText:        rgb(71, 85, 105),
      labelBackground:  rgb(226, 232, 240)
    }
  },
  not_applicable: {
    version:        "v1.0",
    status:         "not_applicable",
    highlightShape: "rectangle",
    connectorDash:  true,
    colors: {
      highlightBorder:  rgb(148, 163, 184),
      highlightFill:    rgb(248, 250, 252),
      highlightOpacity: 0.2,
      calloutBorder:    rgb(148, 163, 184),
      calloutFill:      rgb(248, 250, 252),
      connectorColor:   rgb(148, 163, 184),
      labelText:        rgb(100, 116, 139),
      labelBackground:  rgb(226, 232, 240)
    }
  },
  not_verified: {
    version:        "v1.0",
    status:         "not_verified",
    highlightShape: "cloud",
    connectorDash:  true,
    colors: {
      highlightBorder:  rgb(113, 63, 18),
      highlightFill:    rgb(254, 243, 199),
      highlightOpacity: 0.2,
      calloutBorder:    rgb(113, 63, 18),
      calloutFill:      rgb(255, 251, 235),
      connectorColor:   rgb(113, 63, 18),
      labelText:        rgb(113, 63, 18),
      labelBackground:  rgb(254, 243, 199)
    }
  },
  ambiguous_not_proven: {
    version:        "v1.0",
    status:         "ambiguous_not_proven",
    highlightShape: "cloud",
    connectorDash:  true,
    colors: {
      highlightBorder:  rgb(126, 34, 206),
      highlightFill:    rgb(243, 232, 255),
      highlightOpacity: 0.3,
      calloutBorder:    rgb(126, 34, 206),
      calloutFill:      rgb(250, 245, 255),
      connectorColor:   rgb(126, 34, 206),
      labelText:        rgb(126, 34, 206),
      labelBackground:  rgb(243, 232, 255)
    }
  }
};

export function getAnnotationStyle(status: ComplianceStatus): AnnotationStyleMeta {
  return STATUS_STYLES[status] ?? STATUS_STYLES.not_proven;
}

// Keep RGB re-export for renderer usage.
export type { RGB as AnnotationRGB };
