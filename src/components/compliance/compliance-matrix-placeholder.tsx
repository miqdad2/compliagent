import { ComplianceStatusBadge } from "./compliance-status-badge";

const placeholderStatuses = [
  "complied",
  "partially_complied",
  "not_complied",
  "ambiguous_not_proven",
  "not_applicable"
] as const;

export function ComplianceMatrixPlaceholder() {
  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {placeholderStatuses.map((status) => (
          <ComplianceStatusBadge key={status} status={status} />
        ))}
      </div>
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        Compliance matrix rows will be generated from source-backed requirements, extracted evidence, reviewer validation,
        and human review fields.
      </div>
    </div>
  );
}
