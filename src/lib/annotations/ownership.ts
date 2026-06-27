export type OrganizationOwned = {
  organizationId: string;
};

export function belongsToOrganization(record: OrganizationOwned, organizationId: string) {
  return record.organizationId === organizationId;
}

export function assertOrganizationOwnership(record: OrganizationOwned, organizationId: string) {
  if (!belongsToOrganization(record, organizationId)) {
    throw new Error("The annotation resource does not belong to the active organization.");
  }
}
