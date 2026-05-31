import { Badge } from "@/components/ui/badge";
import { complianceStatusLabels, complianceStatusTone } from "@/lib/compliance/status";
import type { ComplianceStatus } from "@/types/domain";

export function ComplianceStatusBadge({ status }: { status: ComplianceStatus }) {
  return <Badge tone={complianceStatusTone(status)}>{complianceStatusLabels[status]}</Badge>;
}
