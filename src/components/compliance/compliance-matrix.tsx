"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ComplianceStatusBadge } from "@/components/compliance/compliance-status-badge";
import { complianceStatusLabels } from "@/lib/compliance/status";
import type { ComplianceStatus, RiskLevel } from "@/types/domain";

export type ComplianceMatrixRow = {
  id: string;
  clauseNumber: string | null;
  requirementText: string;
  evidenceText: string | null;
  status: ComplianceStatus;
  weightageScore: number;
  confidenceScore: number;
  riskLevel: RiskLevel;
  reasoning: string;
  missingInformation: string | null;
  contractorAction: string | null;
  humanComment: string | null;
  humanOverrideStatus: ComplianceStatus | null;
};

type ComplianceMatrixProps = {
  rows: ComplianceMatrixRow[];
};

const statusOptions: Array<ComplianceStatus | "all"> = [
  "all",
  "complied",
  "partially_complied",
  "not_complied",
  "ambiguous_not_proven",
  "not_applicable",
  "not_verified"
];

const riskOptions: Array<RiskLevel | "all"> = ["all", "critical", "high", "medium", "low"];
type ConfidenceFilter = "all" | "below70" | "70to89" | "90plus";

export function ComplianceMatrix({ rows }: ComplianceMatrixProps) {
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("all");
  const [riskFilter, setRiskFilter] = useState<(typeof riskOptions)[number]>("all");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [query, setQuery] = useState("");

  const documentOptions = useMemo(() => {
    const documents = rows.flatMap((row) => [extractDocumentName(row.requirementText), extractDocumentName(row.evidenceText ?? "")]);
    return Array.from(new Set(documents.filter((documentName): documentName is string => Boolean(documentName)))).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      const matchesRisk = riskFilter === "all" || row.riskLevel === riskFilter;
      const documents = [extractDocumentName(row.requirementText), extractDocumentName(row.evidenceText ?? "")];
      const matchesDocument = documentFilter === "all" || documents.includes(documentFilter);
      const matchesConfidence =
        confidenceFilter === "all" ||
        (confidenceFilter === "below70" && row.confidenceScore < 70) ||
        (confidenceFilter === "70to89" && row.confidenceScore >= 70 && row.confidenceScore < 90) ||
        (confidenceFilter === "90plus" && row.confidenceScore >= 90);
      const searchable = [
        row.clauseNumber,
        row.requirementText,
        row.evidenceText,
        row.reasoning,
        row.missingInformation,
        row.contractorAction
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        matchesStatus &&
        matchesRisk &&
        matchesDocument &&
        matchesConfidence &&
        (!normalizedQuery || searchable.includes(normalizedQuery))
      );
    });
  }, [confidenceFilter, documentFilter, query, riskFilter, rows, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px_180px_190px]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search clause, requirement, evidence, or action"
        />
        <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All statuses" : complianceStatusLabels[status]}
            </option>
          ))}
        </Select>
        <Select value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}>
          <option value="all">All documents</option>
          {documentOptions.map((documentName) => (
            <option key={documentName} value={documentName}>
              {documentName}
            </option>
          ))}
        </Select>
        <Select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as typeof riskFilter)}>
          {riskOptions.map((risk) => (
            <option key={risk} value={risk}>
              {risk === "all" ? "All risks" : `${risk.charAt(0).toUpperCase()}${risk.slice(1)} risk`}
            </option>
          ))}
        </Select>
        <Select
          value={confidenceFilter}
          onChange={(event) => setConfidenceFilter(event.target.value as typeof confidenceFilter)}
        >
          <option value="all">All confidence</option>
          <option value="below70">Below 70%</option>
          <option value="70to89">70-89%</option>
          <option value="90plus">90%+</option>
        </Select>
      </div>

      {filteredRows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No findings match the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => {
            const requirement = parseSourceBlock(row.requirementText);
            const evidence = parseSourceBlock(row.evidenceText ?? "");

            return (
              <article key={row.id} className="rounded-md border bg-white p-4">
                <div className="flex flex-col gap-3 border-b pb-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="gray">{extractAssessmentScope(row.requirementText)}</Badge>
                      <Badge tone="gray">Clause {row.clauseNumber ?? "not identified"}</Badge>
                      <span className="text-xs text-muted-foreground capitalize">{row.riskLevel} risk</span>
                    </div>
                    <p className="text-sm font-medium leading-6">{requirement.quote || trimText(row.requirementText, 220)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                    <ComplianceStatusBadge status={row.humanOverrideStatus ?? row.status} />
                    <Badge tone={row.confidenceScore < 70 ? "gray" : "green"}>{row.confidenceScore}% confidence</Badge>
                    <Badge tone={row.weightageScore >= 8 ? "green" : row.weightageScore >= 5 ? "amber" : "red"}>
                      {row.weightageScore}/10
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-4 py-4 lg:grid-cols-2">
                  <SourcePanel title="Requirement source" source={requirement} fallback="No requirement source parsed." />
                  <SourcePanel title="Evidence source" source={evidence} fallback="No matching evidence found." />
                </div>

                <div className="grid gap-4 border-t pt-3 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Reviewer reasoning</p>
                    <p className="mt-1 text-sm leading-6">{row.reasoning}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Contractor action</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {row.contractorAction ?? row.humanComment ?? "No contractor action required."}
                    </p>
                    {row.confidenceScore < 70 ? (
                      <Badge className="mt-2" tone="gray">
                        Requires human review
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function extractAssessmentScope(text: string) {
  return text.match(/^Assessment:\s*(.+)$/m)?.[1] ?? "Technical review";
}

function extractDocumentName(text: string) {
  return text.match(/^Document:\s*(.+)$/m)?.[1] ?? null;
}

function extractPageNumber(text: string) {
  return text.match(/^Page:\s*(.+)$/m)?.[1] ?? null;
}

function extractClause(text: string) {
  return text.match(/^Clause(?:\/Table\/Figure)?:\s*(.+)$/m)?.[1] ?? null;
}

function extractQuote(text: string) {
  return text.match(/Quote:\s*"([^"]+)"/m)?.[1] ?? null;
}

function parseSourceBlock(text: string) {
  return {
    documentName: extractDocumentName(text),
    pageNumber: extractPageNumber(text),
    clauseNumber: extractClause(text),
    quote: extractQuote(text)
  };
}

function SourcePanel({
  title,
  source,
  fallback
}: {
  title: string;
  source: ReturnType<typeof parseSourceBlock>;
  fallback: string;
}) {
  const hasSource = Boolean(source.documentName || source.pageNumber || source.quote);

  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      {hasSource ? (
        <div className="mt-2 space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            {source.documentName ? <Badge tone="gray">{source.documentName}</Badge> : null}
            {source.pageNumber ? <Badge tone="gray">Page {source.pageNumber}</Badge> : null}
            {source.clauseNumber ? <Badge tone="gray">Clause {source.clauseNumber}</Badge> : null}
          </div>
          <p className="leading-6 text-muted-foreground">{source.quote ? trimText(source.quote, 320) : "Quote not available."}</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{fallback}</p>
      )}
    </div>
  );
}

function trimText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
