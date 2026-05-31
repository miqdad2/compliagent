import type { UserRole } from "@/types/domain";

const writeRoles: UserRole[] = ["super_admin", "admin", "engineer", "reviewer"];
const manageRoles: UserRole[] = ["super_admin", "admin"];
const reviewRoles: UserRole[] = ["super_admin", "admin", "engineer", "reviewer"];

export function canCreateProject(role: UserRole) {
  return writeRoles.includes(role);
}

export function canUploadDocument(role: UserRole) {
  return writeRoles.includes(role);
}

export function canRunReview(role: UserRole) {
  return reviewRoles.includes(role);
}

export function canManageOrganization(role: UserRole) {
  return manageRoles.includes(role);
}

export function canModifyHumanReview(role: UserRole) {
  return reviewRoles.includes(role);
}
