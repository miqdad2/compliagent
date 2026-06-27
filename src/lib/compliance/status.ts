import type { ComplianceStatus } from "@/types/domain";

export const complianceStatusLabels: Record<ComplianceStatus, string> = {
  complied: "Complied",
  partially_complied: "Partially Complied",
  not_complied: "Not Complied",
  ambiguous: "Ambiguous",
  not_proven: "Not Proven",
  exceeds_requirement: "Exceeds Requirement",
  ambiguous_not_proven: "Ambiguous / Not Proven",
  not_applicable: "Not Applicable",
  not_verified: "Not Verified"
};

export function complianceStatusTone(status: ComplianceStatus) {
  switch (status) {
    case "complied":
      return "green";
    case "partially_complied":
      return "amber";
    case "not_complied":
      return "red";
    case "ambiguous":
    case "not_proven":
    case "ambiguous_not_proven":
      return "purple";
    case "exceeds_requirement":
      return "blue";
    case "not_applicable":
    case "not_verified":
      return "gray";
  }
}
