import { Badge } from "@/components/ui/badge";
import type { ProjectStatus } from "@/types/domain";

const labels: Record<ProjectStatus, string> = {
  draft: "Draft",
  documents_uploaded: "Documents Uploaded",
  processing: "Processing",
  ready_for_review: "Ready for Review",
  ai_review_running: "AI Review Running",
  ai_review_completed: "AI Review Completed",
  human_review_pending: "Human Review Pending",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived"
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tone = status === "approved" ? "green" : status === "rejected" ? "red" : status === "archived" ? "gray" : "default";
  return <Badge tone={tone}>{labels[status]}</Badge>;
}
