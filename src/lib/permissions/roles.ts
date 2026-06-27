import type { UserRole } from "@/types/domain";

const writeRoles:    UserRole[] = ["super_admin", "admin", "engineer", "reviewer"];
const manageRoles:   UserRole[] = ["super_admin", "admin"];
const reviewRoles:   UserRole[] = ["super_admin", "admin", "engineer", "reviewer"];
const overviewRoles: UserRole[] = ["super_admin", "admin"];

export function canCreateProject(role: UserRole)         { return writeRoles.includes(role);    }
export function canUploadDocument(role: UserRole)        { return writeRoles.includes(role);    }
export function canRunReview(role: UserRole)             { return reviewRoles.includes(role);   }
export function canManageOrganization(role: UserRole)    { return manageRoles.includes(role);   }
export function canModifyHumanReview(role: UserRole)     { return reviewRoles.includes(role);   }

/** True for admins/super-admins who should see the organization-level Overview page. */
export function canSeeOverview(role: UserRole)           { return overviewRoles.includes(role); }

/** Default post-login destination based on role. */
export function defaultLandingPath(role: UserRole): string {
  return canSeeOverview(role) ? "/overview" : "/projects";
}
