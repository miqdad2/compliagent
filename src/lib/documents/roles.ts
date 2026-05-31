import type { DocumentRole } from "@/types/domain";

export const documentRoleLabels: Record<DocumentRole, string> = {
  main_specification: "Main Specification",
  reference_standard: "Reference Standard",
  proposed_product: "Proposed Product / Contractor Submission",
  product_datasheet: "Product Datasheet",
  certificate: "Certificate",
  drawing: "Drawing",
  manual: "Manual",
  compliance_statement: "Compliance Statement",
  supporting_evidence: "Supporting Evidence",
  other: "Other"
};
