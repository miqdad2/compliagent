import { Badge } from "@/components/ui/badge";

const STATE_LABELS: Record<string, string> = {
  discovered:  "Discovered",
  provisional: "Provisional",
  confirmed:   "Confirmed",
  rejected:    "Rejected",
  superseded:  "Superseded"
};

const STATE_TONES: Record<string, "default" | "green" | "amber" | "red" | "purple" | "blue" | "gray"> = {
  discovered:  "blue",
  provisional: "amber",
  confirmed:   "green",
  rejected:    "red",
  superseded:  "gray"
};

export function RequirementStateBadge({ state }: { state: string }) {
  const label = STATE_LABELS[state] ?? state;
  const tone  = STATE_TONES[state] ?? "default";
  return <Badge tone={tone}>{label}</Badge>;
}
