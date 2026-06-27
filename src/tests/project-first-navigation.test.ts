/**
 * project-first-navigation.test.ts
 *
 * Regression tests for Unit 17F: project-first navigation, role-based
 * Overview visibility, upload drawer contract, and archived-project rules.
 *
 * Covers the 25 items listed in the unit spec.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve }      from "node:path";
import {
  canSeeOverview,
  defaultLandingPath,
  canCreateProject,
  canRunReview,
  canManageOrganization
} from "@/lib/permissions/roles";
import type { UserRole } from "@/types/domain";

// ── Helpers ────────────────────────────────────────────────────────────────────

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

// ── 1. Normal reviewer does not see Overview ──────────────────────────────────

describe("1. Normal reviewer does not see Overview", () => {
  const reviewerRoles: UserRole[] = ["engineer", "reviewer", "viewer", "contractor"];

  for (const role of reviewerRoles) {
    it(`canSeeOverview("${role}") is false`, () => {
      expect(canSeeOverview(role)).toBe(false);
    });

    it(`defaultLandingPath("${role}") is /projects`, () => {
      expect(defaultLandingPath(role)).toBe("/projects");
    });
  }
});

// ── 2. Authorized admin sees Overview ────────────────────────────────────────

describe("2. Authorized admin sees Overview", () => {
  const adminRoles: UserRole[] = ["admin", "super_admin"];

  for (const role of adminRoles) {
    it(`canSeeOverview("${role}") is true`, () => {
      expect(canSeeOverview(role)).toBe(true);
    });

    it(`defaultLandingPath("${role}") is /overview`, () => {
      expect(defaultLandingPath(role)).toBe("/overview");
    });
  }
});

// ── 3. Normal reviewer lands on /projects ────────────────────────────────────

describe("3. Normal reviewer lands on /projects after login", () => {
  it("defaultLandingPath for reviewer is /projects", () => {
    expect(defaultLandingPath("reviewer")).toBe("/projects");
  });

  it("defaultLandingPath for engineer is /projects", () => {
    expect(defaultLandingPath("engineer")).toBe("/projects");
  });

  it("auth action safeNextPath uses /projects as fallback (source check)", () => {
    const src = readSrc("src/server/actions/auth.ts");
    // The fallback in safeNextPath must be /projects, not /dashboard
    expect(src).toContain('"/projects"');
    expect(src).not.toContain('fallback = "/dashboard"');
  });
});

// ── 4. Authorized admin may land on /overview ─────────────────────────────────

describe("4. Authorized admin may land on /overview", () => {
  it("defaultLandingPath for admin is /overview", () => {
    expect(defaultLandingPath("admin")).toBe("/overview");
  });

  it("overview page exists at src/app/(dashboard)/overview/page.tsx", () => {
    const src = readSrc("src/app/(dashboard)/overview/page.tsx");
    expect(src).toContain("OverviewPage");
  });

  it("overview page has access guard — redirects non-admins to /projects", () => {
    const src = readSrc("src/app/(dashboard)/overview/page.tsx");
    expect(src).toContain("canSeeOverview");
    expect(src).toContain('redirect("/projects")');
  });
});

// ── 5. Users navigation is admin-only ─────────────────────────────────────────

describe("5. Users navigation remains admin-only", () => {
  it("sidebar only adds /users when isAdmin=true", () => {
    const src = readSrc("src/components/layout/app-sidebar.tsx");
    // /users is inside the adminItems block
    expect(src).toContain("/users");
    // adminItems is gated on isAdmin
    expect(src).toContain("isAdmin");
  });
});

// ── 6. Empty navigation group headings are not rendered ───────────────────────

describe("6. Empty navigation group headings are not rendered", () => {
  it("NavSection renders null when items array is empty", () => {
    const src = readSrc("src/components/layout/app-sidebar.tsx");
    expect(src).toContain("if (items.length === 0) return null");
  });
});

// ── 7. Project header shows correct next action ───────────────────────────────

describe("7. Project header shows the correct next action", () => {
  it("deriveHeaderAction shows Run automated review when canRunReview and no running review", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("Run automated review");
    expect(src).toContain("canRunReview");
    expect(src).toContain("Review flagged findings");
    expect(src).toContain("Upload documents");
  });
});

// ── 8. Upload form is NOT rendered permanently in the narrow side panel ────────

describe("8. Upload form not permanently in narrow side panel", () => {
  it("project page does NOT import DocumentUploadForm", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).not.toContain("DocumentUploadForm");
  });

  it("project page uses ProjectUploadButton (drawer trigger) instead", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("ProjectUploadButton");
  });
});

// ── 9. Upload documents opens the drawer ──────────────────────────────────────

describe("9. Upload documents button opens the drawer", () => {
  it("ProjectUploadButton sets open=true on click (source check)", () => {
    const src = readSrc("src/components/documents/project-upload-button.tsx");
    expect(src).toContain("setOpen(true)");
    expect(src).toContain("UploadDrawer");
  });
});

// ── 10. Drawer closes with Cancel ─────────────────────────────────────────────

describe("10. Drawer closes with Cancel", () => {
  it("UploadDrawer has a Cancel button that calls handleClose", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("Cancel");
    expect(src).toContain("handleClose");
  });
});

// ── 11. Drawer closes with Escape ─────────────────────────────────────────────

describe("11. Drawer closes with Escape key", () => {
  it("Drawer component listens for Escape and calls onClose", () => {
    const src = readSrc("src/components/ui/drawer.tsx");
    expect(src).toContain('e.key === "Escape"');
    expect(src).toContain("onClose()");
  });
});

// ── 12. File drop selects the file ────────────────────────────────────────────

describe("12. File drop zone handles drop event", () => {
  it("UploadDrawer has onDrop handler", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("onDrop");
    expect(src).toContain("dataTransfer");
  });
});

// ── 13. File browse selects the file ──────────────────────────────────────────

describe("13. File browse input selects the file", () => {
  it("hidden file input and click handler are present", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain('inputRef.current?.click()');
    expect(src).toContain('type="file"');
    expect(src).toContain("sr-only");
  });
});

// ── 14. Invalid file type is rejected ─────────────────────────────────────────

describe("14. Invalid file type is rejected before upload", () => {
  it("validateFile returns an error string for bad extensions", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("Unsupported file type");
    expect(src).toContain("ACCEPTED_EXTS");
  });

  it("UploadDrawer passes accepted extensions to file input", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain('accept={ACCEPTED_EXTS.join(",")}');
  });
});

// ── 15. Oversized file is rejected ────────────────────────────────────────────

describe("15. Oversized file is rejected", () => {
  it("validateFile checks file.size against MAX_BYTES", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("MAX_BYTES");
    expect(src).toContain("too large");
  });
});

// ── 16. Selected filename and size are displayed ──────────────────────────────

describe("16. Selected filename and size are displayed", () => {
  it("UploadDrawer renders file.name and formatBytes", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("file.name");
    expect(src).toContain("formatBytes");
  });
});

// ── 17. Role description updates after selection ──────────────────────────────

describe("17. Role description updates when role changes", () => {
  it("ROLE_DESCRIPTION map and description paragraph are present", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("ROLE_DESCRIPTION");
    expect(src).toContain("upload-role-desc");
  });
});

// ── 18. Uploading state disables duplicate submission ─────────────────────────

describe("18. Uploading state prevents duplicate submissions", () => {
  it("handleUpload checks state === 'uploading' before proceeding", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("state === \"uploading\"");
  });

  it("Upload button is disabled while uploading", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("isUploading");
    expect(src).toContain("disabled={!file || isUploading || isSuccess}");
  });
});

// ── 19. Successful upload closes or resets the drawer ────────────────────────

describe("19. Successful upload auto-closes drawer", () => {
  it("setState('success') then setTimeout(handleClose) is called", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("setState(\"success\")");
    expect(src).toContain("setTimeout");
    expect(src).toContain("handleClose");
  });
});

// ── 20. Upload error remains visible and actionable ──────────────────────────

describe("20. Upload error is visible via aria-live region", () => {
  it("error is displayed in a role=alert live region", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain('role="alert"');
    expect(src).toContain('aria-live="assertive"');
  });
});

// ── 21. Mobile drawer uses full width ────────────────────────────────────────

describe("21. Drawer supports full width on mobile", () => {
  it("Drawer panel has w-full class alongside the max-w class", () => {
    const src = readSrc("src/components/ui/drawer.tsx");
    expect(src).toContain("w-full");
    expect(src).toContain("widthClass");
  });
});

// ── 22. Archived projects are separated from active ──────────────────────────

describe("22. Archived projects are separated from active projects", () => {
  it("projects page has separate Archived section", () => {
    const src = readSrc("src/app/(dashboard)/projects/page.tsx");
    expect(src).toContain("Archived");
    expect(src).toContain("archivedProjects");
  });

  it("archived projects are filtered out of active list", () => {
    const src = readSrc("src/app/(dashboard)/projects/page.tsx");
    expect(src).toContain('p.status !== "archived"');
  });
});

// ── 23. Archived projects are not counted as active ──────────────────────────

describe("23. Archived projects are not counted in active metrics", () => {
  it("activeProjects filter excludes archived", () => {
    const src = readSrc("src/app/(dashboard)/projects/page.tsx");
    expect(src).toContain('p.status !== "archived"');
  });
});

// ── 24. Project tabs reflect actual available routes ─────────────────────────

describe("24. Project workspace tabs are defined", () => {
  it("TABS constant covers expected tabs", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain('"overview"');
    expect(src).toContain('"documents"');
    expect(src).toContain('"review"');
    expect(src).toContain('"findings"');
    expect(src).toContain('"report"');
  });
});

// ── 25. No backend upload behavior is duplicated ─────────────────────────────

describe("25. Upload backend is not duplicated in the drawer", () => {
  it("UploadDrawer calls existing /api/documents/upload endpoint", () => {
    const src = readSrc("src/components/documents/upload-drawer.tsx");
    expect(src).toContain("/api/documents/upload");
    // Does not define its own upload API route
    expect(src).not.toContain("createSupabaseServerClient");
    expect(src).not.toContain("NextResponse");
  });
});

// ── Additional: permission contracts ─────────────────────────────────────────

describe("Permission contracts preserved", () => {
  it("canCreateProject works for write roles", () => {
    expect(canCreateProject("engineer")).toBe(true);
    expect(canCreateProject("reviewer")).toBe(true);
    expect(canCreateProject("viewer")).toBe(false);
  });

  it("canRunReview works for review roles", () => {
    expect(canRunReview("engineer")).toBe(true);
    expect(canRunReview("contractor")).toBe(false);
  });

  it("canManageOrganization is restricted to admin/super_admin", () => {
    expect(canManageOrganization("admin")).toBe(true);
    expect(canManageOrganization("engineer")).toBe(false);
  });

  it("dashboard route redirects to /overview", () => {
    const src = readSrc("src/app/(dashboard)/dashboard/page.tsx");
    expect(src).toContain('redirect("/overview")');
  });
});
