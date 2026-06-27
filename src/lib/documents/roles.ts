import type { DocumentRole } from "@/types/domain";

export const documentRoleLabels: Record<DocumentRole, string> = {
  // Legacy roles retained for backward compatibility.
  main_specification:  "Main Specification",
  proposed_product:    "Proposed Product / Contractor Submission",
  manual:              "Manual",
  compliance_statement: "Compliance Statement",
  // Current controlled-review roles.
  specification:        "Specification",
  reference_standard:   "Reference Standard",
  contractor_submission: "Contractor Submission",
  product_datasheet:    "Product Datasheet",
  certificate:          "Certificate",
  drawing:              "Drawing",
  calculation:          "Calculation",
  method_statement:     "Method Statement",
  test_report:          "Test Report",
  supporting_evidence:  "Supporting Evidence",
  correspondence:       "Correspondence",
  other:                "Other"
};
