import { NextResponse } from "next/server";
import { complianceStatusLabels } from "@/lib/compliance/status";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ComplianceStatus, RiskLevel } from "@/types/domain";

export const runtime = "nodejs";

type ChatRequest = {
  projectId?: string;
  question?: string;
};

type ChunkRow = {
  page_number: number;
  clause_number: string | null;
  chunk_text: string;
  normalized_text: string;
  documents: { file_name: string } | { file_name: string }[] | null;
};

type FindingRow = {
  id: string;
  clause_number: string | null;
  requirement_text: string;
  evidence_text: string | null;
  status: ComplianceStatus;
  weightage_score: number;
  confidence_score: number;
  reasoning: string;
  missing_information: string | null;
  contractor_action: string | null;
  risk_level: RiskLevel;
  human_override_status: ComplianceStatus | null;
  human_comment: string | null;
};

type ClarificationRow = {
  id: string;
  clause_number: string | null;
  issue: string;
  why_it_matters: string;
  required_action: string;
  required_document: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  status: string;
};

type Source = {
  documentName: string;
  pageNumber: number;
  clauseNumber: string | null;
  quote: string;
};

const stopWords = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "are",
  "based",
  "be",
  "for",
  "from",
  "give",
  "in",
  "is",
  "it",
  "list",
  "me",
  "of",
  "on",
  "or",
  "show",
  "the",
  "this",
  "to",
  "what",
  "which",
  "why",
  "with"
]);

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase is not configured." }, { status: 500 });
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load user profile." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as ChatRequest;
  const projectId = payload.projectId;
  const question = payload.question?.trim() ?? "";

  if (!projectId || question.length < 3) {
    return NextResponse.json({ error: "A project and question are required." }, { status: 400 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project was not found or is not accessible." }, { status: 404 });
  }

  if (project.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this project." }, { status: 403 });
  }

  const { data: reviews, error: reviewsError } = await supabase
    .from("compliance_reviews")
    .select("id, review_scope, status")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (reviewsError) {
    return NextResponse.json({ error: reviewsError.message }, { status: 400 });
  }

  const latestReview = reviews?.[0] ?? null;
  const [{ data: findingData, error: findingsError }, { data: clarificationData, error: clarificationsError }, { data: chunkData, error: chunksError }] =
    await Promise.all([
      latestReview
        ? supabase
            .from("compliance_findings")
            .select(
              "id, clause_number, requirement_text, evidence_text, status, weightage_score, confidence_score, reasoning, missing_information, contractor_action, risk_level, human_override_status, human_comment"
            )
            .eq("review_id", latestReview.id)
        : Promise.resolve({ data: [], error: null }),
      latestReview
        ? supabase
            .from("contractor_clarifications")
            .select("id, clause_number, issue, why_it_matters, required_action, required_document, priority, status")
            .eq("review_id", latestReview.id)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("document_chunks")
        .select(
          `
            page_number,
            clause_number,
            chunk_text,
            normalized_text,
            documents (
              file_name
            )
          `
        )
        .eq("project_id", projectId)
        .limit(500)
    ]);

  if (findingsError || clarificationsError || chunksError) {
    return NextResponse.json(
      { error: findingsError?.message ?? clarificationsError?.message ?? chunksError?.message ?? "Project chat failed." },
      { status: 400 }
    );
  }

  const findings = (findingData ?? []) as FindingRow[];
  const clarifications = (clarificationData ?? []) as ClarificationRow[];
  const chunks = (chunkData ?? []) as ChunkRow[];
  const terms = extractTerms(question);
  const intent = inferIntent(question);

  if (findings.length > 0 && intent === "summary") {
    return NextResponse.json({
      data: buildSummaryAnswer(question, findings, clarifications, latestReview?.review_scope ?? null)
    });
  }

  if (findings.length > 0 && intent === "clarifications") {
    return NextResponse.json({
      data: buildClarificationAnswer(question, clarifications, findings)
    });
  }

  if (findings.length > 0 && intent === "status") {
    return NextResponse.json({
      data: buildStatusAnswer(question, findings, terms)
    });
  }

  const findingMatches = scoreFindings(findings, terms).slice(0, 5);
  if (findingMatches.length > 0) {
    return NextResponse.json({
      data: buildFindingSearchAnswer(question, findingMatches.map((match) => match.finding))
    });
  }

  const chunkMatches = scoreChunks(chunks, terms).slice(0, 5);
  if (chunkMatches.length === 0) {
    return NextResponse.json({
      data: {
        answer:
          "I could not find direct evidence in the processed project documents for that question.\n\nVerification: Not Found. Treat this as Requires Human Review until the reviewer locates a source or asks the contractor for clarification.",
        verificationStatus: "not_found",
        sources: []
      }
    });
  }

  return NextResponse.json({
    data: buildChunkAnswer(question, chunkMatches.map((match) => match.chunk))
  });
}

function inferIntent(question: string) {
  const normalized = question.toLowerCase();

  if (/\b(summary|summarize|recommendation|decision|accepted|rejected|why)\b/.test(normalized)) {
    return "summary";
  }

  if (/\b(clarification|contractor|missing|action|provide|submit|resubmission)\b/.test(normalized)) {
    return "clarifications";
  }

  if (/\b(not complied|non complied|not-complied|partial|partially|ambiguous|not proven|not verified|human review|critical|highest risk|risk)\b/.test(normalized)) {
    return "status";
  }

  return "search";
}

function buildSummaryAnswer(
  question: string,
  findings: FindingRow[],
  clarifications: ClarificationRow[],
  reviewScope: string | null
) {
  const counts = countStatuses(findings);
  const recommendation = reviewScope?.match(/Recommendation:\s*([^\n]+)/)?.[1] ?? inferRecommendation(findings);
  const topOpen = findings
    .filter((finding) => !["complied", "exceeds_requirement", "not_applicable"].includes(finding.status))
    .sort(compareFindingPriority)
    .slice(0, 4);
  const sources = uniqueSources(topOpen.flatMap(sourcesForFinding));

  return {
    answer: [
      `Answer: ${recommendation}.`,
      `Why: ${counts.not_complied} not complied, ${counts.partially_complied} partially complied, ${counts.ambiguous + counts.not_proven + counts.ambiguous_not_proven + counts.not_verified} ambiguous/not proven/not verified, and ${clarifications.length} contractor clarification item(s) remain open.`,
      topOpen.length > 0
        ? [
            "Highest-priority open items:",
            ...topOpen.map(
              (finding, index) =>
                `${index + 1}. ${statusLabel(finding)} - ${finding.missing_information ?? finding.reasoning} Clause: ${
                  finding.clause_number ?? "not identified"
                }.`
            )
          ].join("\n")
        : "No open compliance items were found in the latest review.",
      "Verification: Verified from stored compliance findings and their cited sources. Final approval still requires the responsible engineer."
    ].join("\n\n"),
    verificationStatus: sources.length > 0 ? "verified_review" : "review_summary",
    sources,
    interpretedQuestion: question
  };
}

function buildClarificationAnswer(question: string, clarifications: ClarificationRow[], findings: FindingRow[]) {
  const terms = extractTerms(question);
  const matchedClarifications = clarifications
    .map((clarification) => ({
      clarification,
      score: scoreText(
        [clarification.issue, clarification.why_it_matters, clarification.required_action, clarification.required_document].join(" "),
        terms
      )
    }))
    .filter((match) => match.score > 0 || terms.length === 0)
    .sort((left, right) => right.score - left.score || priorityRank(left.clarification.priority) - priorityRank(right.clarification.priority))
    .slice(0, 6);
  const selected = matchedClarifications.length > 0 ? matchedClarifications.map((match) => match.clarification) : clarifications.slice(0, 6);
  const relatedFindings = findings
    .filter((finding) => selected.some((clarification) => clarification.clause_number && clarification.clause_number === finding.clause_number))
    .slice(0, 6);
  const sources = uniqueSources(relatedFindings.flatMap(sourcesForFinding));

  if (selected.length === 0) {
    return {
      answer:
        "No contractor clarification items were found in the latest review.\n\nVerification: Verified from the stored clarification list.",
      verificationStatus: "verified_review",
      sources: []
    };
  }

  return {
    answer: [
      `Answer: ${selected.length} contractor clarification item(s) match this question.`,
      ...selected.map(
        (clarification, index) =>
          `${index + 1}. ${clarification.priority} priority - Clause ${
            clarification.clause_number ?? "not identified"
          }\nIssue: ${clarification.issue}\nRequired action: ${clarification.required_action}\nRequired evidence: ${
            clarification.required_document
          }`
      ),
      "Verification: Verified from the latest contractor clarification list. Source snippets below come from related findings when available."
    ].join("\n\n"),
    verificationStatus: "verified_review",
    sources
  };
}

function buildStatusAnswer(question: string, findings: FindingRow[], terms: string[]) {
  const normalized = question.toLowerCase();
  let selected = findings;

  if (normalized.includes("not complied") || normalized.includes("non complied")) {
    selected = findings.filter((finding) => finding.status === "not_complied");
  } else if (normalized.includes("partial")) {
    selected = findings.filter((finding) => finding.status === "partially_complied");
  } else if (normalized.includes("ambiguous") || normalized.includes("not proven") || normalized.includes("not verified")) {
    selected = findings.filter((finding) =>
      ["ambiguous", "not_proven", "ambiguous_not_proven", "not_verified"].includes(finding.status)
    );
  } else if (normalized.includes("human review")) {
    selected = findings.filter((finding) => finding.confidence_score < 70 || finding.status !== "complied");
  } else if (normalized.includes("critical") || normalized.includes("highest risk") || normalized.includes("risk")) {
    selected = findings.filter((finding) => ["critical", "high"].includes(finding.risk_level));
  }

  const scored = scoreFindings(selected, terms);
  const topFindings = (scored.length > 0 ? scored.map((match) => match.finding) : selected.sort(compareFindingPriority)).slice(0, 6);
  const sources = uniqueSources(topFindings.flatMap(sourcesForFinding));

  if (topFindings.length === 0) {
    return {
      answer:
        "I did not find any findings in that category.\n\nVerification: Verified from the latest stored compliance findings.",
      verificationStatus: "verified_review",
      sources: []
    };
  }

  return {
    answer: [
      `Answer: ${topFindings.length} finding(s) are most relevant.`,
      ...topFindings.map(formatFindingLine),
      "Verification: Verified from stored compliance findings. Any finding below 70% confidence or without direct evidence remains for human review."
    ].join("\n\n"),
    verificationStatus: "verified_review",
    sources
  };
}

function buildFindingSearchAnswer(question: string, findings: FindingRow[]) {
  return {
    answer: [
      `Answer: I found ${findings.length} relevant reviewed finding(s) for: "${question}".`,
      ...findings.map(formatFindingLine),
      "Verification: Verified from stored compliance findings and cited requirement/evidence snippets."
    ].join("\n\n"),
    verificationStatus: "verified_review",
    sources: uniqueSources(findings.flatMap(sourcesForFinding))
  };
}

function buildChunkAnswer(question: string, chunks: ChunkRow[]) {
  const sources = chunks.map((chunk) => ({
    documentName: documentNameForChunk(chunk),
    pageNumber: chunk.page_number,
    clauseNumber: chunk.clause_number,
    quote: excerpt(chunk.chunk_text)
  }));

  return {
    answer: [
      `Answer: I found ${sources.length} direct document snippet(s) for: "${question}".`,
      ...sources.map(
        (source, index) =>
          `${index + 1}. ${source.quote} [${source.documentName}, page ${source.pageNumber}${
            source.clauseNumber ? `, clause ${source.clauseNumber}` : ""
          }]`
      ),
      "Verification: Direct document evidence only. This is not a compliance conclusion unless it is also supported by a reviewed finding."
    ].join("\n\n"),
    verificationStatus: "verified_source",
    sources
  };
}

function scoreFindings(findings: FindingRow[], terms: string[]) {
  if (terms.length === 0) {
    return findings.sort(compareFindingPriority).map((finding) => ({ finding, score: 1 }));
  }

  return findings
    .map((finding) => ({
      finding,
      score: scoreText(
        [
          finding.clause_number,
          finding.requirement_text,
          finding.evidence_text,
          finding.reasoning,
          finding.missing_information,
          finding.contractor_action,
          finding.risk_level,
          finding.status
        ]
          .filter(Boolean)
          .join(" "),
        terms
      )
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || compareFindingPriority(left.finding, right.finding));
}

function scoreChunks(chunks: ChunkRow[], terms: string[]) {
  if (terms.length === 0) {
    return [];
  }

  return chunks
    .map((chunk) => ({ chunk, score: scoreText(`${chunk.normalized_text} ${chunk.chunk_text}`, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

function scoreText(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.reduce((total, term) => total + (normalized.includes(term) ? keywordWeight(term) : 0), 0);
}

function extractTerms(question: string) {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9.\-/ ]/g, " ")
        .replace(/[-/]/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !stopWords.has(term))
    )
  );
}

function keywordWeight(term: string) {
  if (/\d/.test(term)) {
    return 4;
  }

  if (["certificate", "standard", "power", "supply", "speaker", "fault", "monitoring", "risk", "critical"].includes(term)) {
    return 3;
  }

  return 1;
}

function countStatuses(findings: FindingRow[]) {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.status] += 1;
      return counts;
    },
    {
      complied: 0,
      partially_complied: 0,
      not_complied: 0,
      ambiguous: 0,
      not_proven: 0,
      exceeds_requirement: 0,
      ambiguous_not_proven: 0,
      not_applicable: 0,
      not_verified: 0
    } satisfies Record<ComplianceStatus, number>
  );
}

function inferRecommendation(findings: FindingRow[]) {
  const hasCriticalOpen = findings.some(
    (finding) =>
      finding.risk_level === "critical" &&
      ["not_complied", "ambiguous", "not_proven", "ambiguous_not_proven", "not_verified", "partially_complied"].includes(
        finding.status
      )
  );
  const hasNotComplied = findings.some((finding) => finding.status === "not_complied");
  const hasOpen = findings.some((finding) =>
    ["partially_complied", "ambiguous", "not_proven", "ambiguous_not_proven", "not_verified"].includes(finding.status)
  );

  if (hasCriticalOpen || hasNotComplied) {
    return "Rejected / Not Technically Accepted";
  }

  return hasOpen ? "Accepted with Conditions" : "Technically Accepted";
}

function compareFindingPriority(left: FindingRow, right: FindingRow) {
  return (
    riskRank(left.risk_level) - riskRank(right.risk_level) ||
    statusRank(left.status) - statusRank(right.status) ||
    left.confidence_score - right.confidence_score
  );
}

function riskRank(risk: RiskLevel) {
  switch (risk) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
  }
}

function statusRank(status: ComplianceStatus) {
  switch (status) {
    case "not_complied":
      return 0;
    case "not_verified":
      return 1;
    case "not_proven":
      return 2;
    case "ambiguous":
    case "ambiguous_not_proven":
      return 3;
    case "partially_complied":
      return 4;
    case "not_applicable":
      return 5;
    case "exceeds_requirement":
      return 6;
    case "complied":
      return 7;
  }
}

function priorityRank(priority: ClarificationRow["priority"]) {
  switch (priority) {
    case "Critical":
      return 0;
    case "High":
      return 1;
    case "Medium":
      return 2;
    case "Low":
      return 3;
  }
}

function statusLabel(finding: FindingRow) {
  return complianceStatusLabels[finding.human_override_status ?? finding.status];
}

function formatFindingLine(finding: FindingRow, index = 0) {
  return `${index + 1}. ${statusLabel(finding)} - Clause ${
    finding.clause_number ?? "not identified"
  } - ${finding.confidence_score}% confidence - ${finding.reasoning}${
    finding.contractor_action ? `\nRequired action: ${finding.contractor_action}` : ""
  }`;
}

function sourcesForFinding(finding: FindingRow) {
  return uniqueSources([parseSource(finding.requirement_text), parseSource(finding.evidence_text ?? "")].filter(isSource));
}

function parseSource(text: string): Source | null {
  const documentName = text.match(/^Document:\s*(.+)$/m)?.[1]?.trim();
  const pageNumberText = text.match(/^Page:\s*(\d+)/m)?.[1];
  const clauseNumber = text.match(/^Clause(?:\/Table\/Figure)?:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const quote = text.match(/Quote:\s*"([^"]+)"/m)?.[1]?.trim();

  if (!documentName || !pageNumberText || !quote) {
    return null;
  }

  return {
    documentName,
    pageNumber: Number(pageNumberText),
    clauseNumber,
    quote
  };
}

function isSource(source: Source | null): source is Source {
  return Boolean(source);
}

function uniqueSources(sources: Source[]) {
  const seen = new Set<string>();
  const unique: Source[] = [];

  for (const source of sources) {
    const key = `${source.documentName}|${source.pageNumber}|${source.clauseNumber ?? ""}|${source.quote}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(source);
    }
  }

  return unique.slice(0, 8);
}

function documentNameForChunk(chunk: ChunkRow) {
  if (Array.isArray(chunk.documents)) {
    return chunk.documents[0]?.file_name ?? "Unknown document";
  }

  return chunk.documents?.file_name ?? "Unknown document";
}

function excerpt(text: string, maxLength = 520) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
