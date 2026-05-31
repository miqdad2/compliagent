import type { ComplianceStatus } from "@/types/domain";

export const complianceStatusLabels: Record<ComplianceStatus, string> = {
  complied: "Complied",
  partially_complied: "Partially Complied",
  not_complied: "Not Complied",
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
    case "ambiguous_not_proven":
      return "purple";
    case "not_applicable":
    case "not_verified":
      return "gray";
  }
}
