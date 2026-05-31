import { decideCompliance } from "@/lib/compliance/scoring";
import type { ComplianceStatus, DocumentRole, RiskLevel, SourceReference } from "@/types/domain";

export type ReviewDocument = {
  id: string;
  fileName: string;
  documentRole: DocumentRole;
  chunks: ReviewChunk[];
};

export type ReviewChunk = {
  pageNumber: number;
  clauseNumber: string | null;
  chunkText: string;
  normalizedText: string;
};

export type GeneratedFinding = {
  comparisonScope: string;
  clauseNumber: string | null;
  subClauseNumber: string | null;
  requirementText: string;
  evidenceText: string | null;
  status: ComplianceStatus;
  weightageScore: number;
  confidenceScore: number;
  reasoning: string;
  missingInformation: string | null;
  contractorAction: string | null;
  riskLevel: RiskLevel;
  requiresHumanReview: boolean;
};

export type GeneratedClarification = {
  clauseNumber: string | null;
  issue: string;
  whyItMatters: string;
  requiredAction: string;
  requiredDocument: string;
  priority: "Critical" | "High" | "Medium" | "Low";
};

export type GeneratedReview = {
  title: string;
  scope: string;
  findings: GeneratedFinding[];
  clarifications: GeneratedClarification[];
  recommendation: "Technically Accepted" | "Accepted with Conditions" | "Rejected / Not Technically Accepted";
  recommendationReasoning: string;
};

export type ReviewGenerationOptions = {
  reviewBrief?: string | null;
};

type RequirementCandidate = {
  document: ReviewDocument;
  chunk: ReviewChunk;
  comparisonScope: string;
  applicabilityReason: string | null;
  source: SourceReference;
  keywords: string[];
  riskLevel: RiskLevel;
};

type EvidenceMatch = {
  document: ReviewDocument;
  chunk: ReviewChunk;
  source: SourceReference;
  score: number;
  matchedTerms: string[];
};

const requirementRoles: DocumentRole[] = ["main_specification", "reference_standard", "compliance_statement"];
const evidenceRoles: DocumentRole[] = [
  "proposed_product",
  "product_datasheet",
  "certificate",
  "drawing",
  "manual",
  "supporting_evidence",
  "other"
];

const clientMinimumScopes = [
  {
    label: "Doc. 4 vs Doc. 1 - specification compliance",
    requirementDoc: "doc1",
    evidenceDoc: "doc4",
    scope:
      "Compare Doc. 4, the proposed speaker, with Doc. 1 Specifications across technical and functional requirements."
  },
  {
    label: "Doc. 4 vs Doc. 2 - applicable standards and functions",
    requirementDoc: "doc2",
    evidenceDoc: "doc4",
    scope:
      "Identify applicable Doc. 2 technical, functional, and standards clauses for active speakers, then compare Doc. 4."
  },
  {
    label: "Doc. 4 vs Doc. 3 - power supply technicality",
    requirementDoc: "doc3",
    evidenceDoc: "doc4",
    scope:
      "Compare the proposed speaker power supply technicality against the relevant Doc. 3 technical and functional requirements."
  }
] as const;

const activeSpeakerApplicabilityTerms = [
  "active speaker",
  "speaker",
  "loudspeaker",
  "voice alarm",
  "evacuation",
  "audibility",
  "sound pressure",
  "spl",
  "frequency",
  "amplifier",
  "line array",
  "monitoring",
  "fault",
  "en54",
  "bs5839"
];

const powerSupplyTerms = [
  "power supply",
  "power",
  "supply",
  "mains",
  "battery",
  "backup",
  "standby",
  "charger",
  "voltage",
  "current",
  "fault",
  "monitoring",
  "en54-4",
  "en 54-4"
];

const mandatoryTerms = [
  "shall",
  "must",
  "required",
  "requires",
  "comply",
  "complies",
  "compliance",
  "in accordance with",
  "to be provided",
  "submit",
  "provide"
];

const criticalTerms = [
  "life safety",
  "fire",
  "emergency",
  "evacuation",
  "certification",
  "certificate",
  "standard",
  "backup",
  "battery",
  "fault",
  "monitoring",
  "safety"
];

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "shall",
  "should",
  "the",
  "this",
  "to",
  "with",
  "must",
  "required",
  "provide",
  "submit",
  "comply"
]);

export function generateTechnicalReview(documents: ReviewDocument[], options: ReviewGenerationOptions = {}): GeneratedReview {
  const minimumPackage = buildClientMinimumPackage(documents);
  const requirementDocuments = documents.filter((document) => isRequirementDocument(document));
  const evidenceDocuments = documents.filter((document) => isEvidenceDocument(document));

  if (requirementDocuments.length === 0) {
    throw new Error("At least one specification, reference standard, or compliance statement document is required.");
  }

  if (evidenceDocuments.length === 0) {
    throw new Error("At least one proposed product, datasheet, certificate, manual, drawing, or evidence document is required.");
  }

  const requirements = minimumPackage
    ? extractClientMinimumRequirementCandidates(minimumPackage)
    : extractRequirementCandidates(requirementDocuments, "Technical compliance assessment");

  if (requirements.length === 0) {
    throw new Error("No source-backed mandatory requirements were found in the processed requirement documents.");
  }

  const findings = requirements.map((requirement) => {
    const scopedEvidenceDocuments = minimumPackage ? minimumPackage.evidenceDocuments : evidenceDocuments;
    return buildFinding(requirement, scopedEvidenceDocuments);
  });
  const clarifications = findings
    .filter((finding) => finding.status !== "complied" && finding.status !== "not_applicable")
    .map(createClarification);
  const recommendation = summarizeRecommendation(findings);

  return {
    title: minimumPackage ? "Doc. 4 proposed speaker technical compliance review" : "Technical compliance review",
    scope: [
      options.reviewBrief?.trim() ? `Reviewer requirements:\n${options.reviewBrief.trim()}` : null,
      minimumPackage
        ? [
          "Client minimum assessment:",
          "1. Doc. 4 vs Doc. 1 Specifications with clause/sub-clause source references and contractor missing-information actions.",
          "2. Weightage from 1-10 for partially complied, ambiguous, and not-proven items.",
          "3. Applicable Doc. 2 technical, functional, and standards requirements compared against Doc. 4.",
          "4. Doc. 4 speaker power supply technicality compared with relevant Doc. 3 sections.",
          "5. Conservative conclusion: technically accepted, accepted with conditions, or rejected; includes cost-effectiveness note when evidence shows significant over-specification."
        ].join("\n")
        : `Compared ${requirementDocuments.length} requirement document${requirementDocuments.length === 1 ? "" : "s"} against ${evidenceDocuments.length} evidence document${evidenceDocuments.length === 1 ? "" : "s"}.`
    ]
      .filter(Boolean)
      .join("\n\n"),
    findings,
    clarifications,
    recommendation: recommendation.recommendation,
    recommendationReasoning: `${recommendation.reasoning} Cost-effectiveness note: if Doc. 4 materially exceeds specified performance, the reviewer should request the contractor to confirm whether a more cost-effective compliant model can meet the tender requirements without reducing quality, certification, or life-safety suitability.`
  };
}

export function summarizeRecommendation(findings: Pick<GeneratedFinding, "status" | "riskLevel">[]) {
  const criticalOpen = findings.some(
    (finding) =>
      finding.riskLevel === "critical" &&
      ["not_complied", "ambiguous_not_proven", "not_verified", "partially_complied"].includes(finding.status)
  );
  const notComplied = findings.some((finding) => finding.status === "not_complied");
  const unresolved = findings.some((finding) =>
    ["partially_complied", "ambiguous_not_proven", "not_verified"].includes(finding.status)
  );

  if (notComplied || criticalOpen) {
    return {
      recommendation: "Rejected / Not Technically Accepted" as const,
      reasoning:
        "Critical or unresolved technical requirements remain open. The AI recommendation is conservative until contractor clarification and human engineering review are complete."
    };
  }

  if (unresolved) {
    return {
      recommendation: "Accepted with Conditions" as const,
      reasoning:
        "Some requirements have partial, indirect, or incomplete evidence and require contractor clarification before final approval."
    };
  }

  return {
    recommendation: "Technically Accepted" as const,
    reasoning:
      "All reviewed requirements have direct source-backed evidence. Final approval still requires responsible human reviewer sign-off."
  };
}

function extractRequirementCandidates(documents: ReviewDocument[], comparisonScope: string) {
  const candidates: RequirementCandidate[] = [];

  for (const document of documents) {
    for (const chunk of document.chunks) {
      const text = chunk.normalizedText.toLowerCase();
      if (!mandatoryTerms.some((term) => text.includes(term))) {
        continue;
      }

      candidates.push({
        document,
        chunk,
        comparisonScope,
        applicabilityReason: null,
        source: toSourceReference(document.fileName, chunk),
        keywords: extractKeywords(chunk.normalizedText),
        riskLevel: inferRiskLevel(text)
      });
    }
  }

  return candidates.slice(0, 40);
}

function buildFinding(requirement: RequirementCandidate, evidenceDocuments: ReviewDocument[]): GeneratedFinding {
  const evidence = findBestEvidence(requirement, evidenceDocuments);
  const missingTechnicalTokens = evidence ? missingRequiredTechnicalTokens(requirement.chunk.normalizedText, evidence.chunk.normalizedText) : [];
  const contradictionFound = evidence ? hasTechnicalContradiction(requirement.chunk.normalizedText, evidence.chunk.normalizedText) : false;
  const directMatch = Boolean(
    evidence && !contradictionFound && missingTechnicalTokens.length === 0 && (evidence.score >= 0.28 || evidence.matchedTerms.length >= 4)
  );
  const partiallySupported = Boolean(
    evidence && !contradictionFound && !directMatch && (evidence.score >= 0.08 || evidence.matchedTerms.length >= 2)
  );
  const confidenceScore = evidence
    ? directMatch
      ? Math.round(Math.min(94, Math.max(76, 60 + evidence.score * 40 + evidence.matchedTerms.length * 4)))
      : contradictionFound
        ? Math.round(Math.min(88, Math.max(65, 52 + evidence.score * 80)))
        : Math.round(Math.min(68, Math.max(42, evidence.score * 160 - missingTechnicalTokens.length * 4)))
    : 20;
  const decision = decideCompliance({
    requirementSource: requirement.source,
    evidenceSource: evidence?.source ?? null,
    directMatch,
    contradictionFound,
    missingEvidence: !evidence,
    partiallySupported,
    notApplicable: false,
    confidenceScore,
    criticality: requirement.riskLevel
  });

  return {
    comparisonScope: requirement.comparisonScope,
    clauseNumber: requirement.chunk.clauseNumber,
    subClauseNumber: inferSubClauseNumber(requirement.chunk.clauseNumber, requirement.chunk.chunkText),
    requirementText: [
      `Assessment: ${requirement.comparisonScope}`,
      requirement.applicabilityReason ? `Applicability: ${requirement.applicabilityReason}` : null,
      formatRequirementSource(requirement.source)
    ]
      .filter(Boolean)
      .join("\n"),
    evidenceText: evidence ? formatEvidenceSource(evidence.source) : null,
    status: decision.status,
    weightageScore: decision.weightageScore,
    confidenceScore: decision.confidenceScore,
    reasoning: enrichReasoning(decision.reasoning, requirement, evidence, missingTechnicalTokens),
    missingInformation:
      decision.status === "complied" ? null : missingInformationFor(decision.status, missingTechnicalTokens),
    contractorAction:
      decision.status === "complied" ? null : contractorActionFor(decision.status, requirement.comparisonScope),
    riskLevel: requirement.riskLevel,
    requiresHumanReview: decision.requiresHumanReview
  };
}

function buildClientMinimumPackage(documents: ReviewDocument[]) {
  const doc1 = documents.find((document) => inferDocumentNumber(document.fileName) === 1);
  const doc2 = documents.find((document) => inferDocumentNumber(document.fileName) === 2);
  const doc3 = documents.find((document) => inferDocumentNumber(document.fileName) === 3);
  const doc4 = documents.find((document) => inferDocumentNumber(document.fileName) === 4 || isEvidenceDocument(document));

  if (!doc1 || !doc2 || !doc3 || !doc4) {
    return null;
  }

  return {
    doc1,
    doc2,
    doc3,
    doc4,
    evidenceDocuments: [doc4]
  };
}

function extractClientMinimumRequirementCandidates(packageDocuments: NonNullable<ReturnType<typeof buildClientMinimumPackage>>) {
  const candidates: RequirementCandidate[] = [];
  const doc1Scope = clientMinimumScopes[0];
  const doc2Scope = clientMinimumScopes[1];
  const doc3Scope = clientMinimumScopes[2];

  candidates.push(
    ...extractRequirementCandidates([packageDocuments.doc1], doc1Scope.label)
      .map((candidate) => ({
        ...candidate,
        comparisonScope: doc1Scope.label
      }))
      .slice(0, 28)
  );

  candidates.push(
    ...extractRequirementCandidates([packageDocuments.doc2], doc2Scope.label)
      .filter((candidate) => isApplicableActiveSpeakerClause(candidate.chunk.normalizedText))
      .map((candidate) => ({
        ...candidate,
        comparisonScope: doc2Scope.label,
        applicabilityReason:
          "Clause contains active-speaker, loudspeaker, voice-alarm, audibility, monitoring, fault, or related standard terms relevant to the proposed speaker."
      }))
      .slice(0, 18)
  );

  candidates.push(
    ...extractRequirementCandidates([packageDocuments.doc3], doc3Scope.label)
      .filter((candidate) => isPowerSupplyClause(candidate.chunk.normalizedText))
      .map((candidate) => ({
        ...candidate,
        comparisonScope: doc3Scope.label,
        applicabilityReason:
          "Clause is relevant to proposed speaker power supply technicality, including mains supply, standby battery, charging, fault reporting, voltage, current, or monitoring."
      }))
      .slice(0, 18)
  );

  return candidates.slice(0, 56);
}

function isRequirementDocument(document: ReviewDocument) {
  const number = inferDocumentNumber(document.fileName);
  return number === 1 || number === 2 || number === 3 || requirementRoles.includes(document.documentRole);
}

function isEvidenceDocument(document: ReviewDocument) {
  const name = document.fileName.toLowerCase();
  const number = inferDocumentNumber(document.fileName);
  return number === 4 || name.includes("proposed") || evidenceRoles.includes(document.documentRole);
}

function inferDocumentNumber(fileName: string) {
  const normalized = fileName.toLowerCase();
  const match = normalized.match(/\bdoc(?:ument)?\.?\s*-?\s*(\d+)\b/) ?? normalized.match(/\bdoc\.-?(\d+)\b/);
  return match?.[1] ? Number(match[1]) : null;
}

function isApplicableActiveSpeakerClause(text: string) {
  const normalized = text.toLowerCase();
  return activeSpeakerApplicabilityTerms.some((term) => normalized.includes(term));
}

function isPowerSupplyClause(text: string) {
  const normalized = text.toLowerCase();
  return powerSupplyTerms.some((term) => normalized.includes(term));
}

function findBestEvidence(requirement: RequirementCandidate, evidenceDocuments: ReviewDocument[]) {
  let best: EvidenceMatch | null = null;

  for (const document of evidenceDocuments) {
    for (const chunk of document.chunks) {
      const evidenceKeywords = extractKeywords(chunk.normalizedText);
      const match = similarity(requirement.keywords, evidenceKeywords);

      if (match.score > 0 && (!best || match.score > best.score)) {
        best = {
          document,
          chunk,
          source: toSourceReference(document.fileName, chunk),
          score: match.score,
          matchedTerms: match.matchedTerms
        };
      }
    }
  }

  if (!best) {
    return null;
  }

  const hasEnoughSignal = best.score >= 0.08 || best.matchedTerms.length >= 2;
  return hasEnoughSignal ? best : null;
}

function similarity(requirementKeywords: string[], evidenceKeywords: string[]) {
  if (requirementKeywords.length === 0 || evidenceKeywords.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const evidenceSet = new Set(evidenceKeywords);
  const salientRequirementKeywords = requirementKeywords.slice(0, 28);
  const matchedTerms = salientRequirementKeywords.filter((keyword) => evidenceSet.has(keyword));
  const matchedWeight = matchedTerms.reduce((total, keyword) => total + keywordWeight(keyword), 0);
  const totalWeight = salientRequirementKeywords.reduce((total, keyword) => total + keywordWeight(keyword), 0);

  return {
    score: totalWeight === 0 ? 0 : matchedWeight / totalWeight,
    matchedTerms
  };
}

function extractKeywords(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9.\-/ ]/g, " ")
    .replace(/[-/]/g, " ")
    .split(/\s+/)
    .map((word) => normalizeKeyword(word.trim()))
    .filter((word) => word.length >= 3 && !stopWords.has(word));

  return Array.from(new Set(words))
    .sort((left, right) => keywordWeight(right) - keywordWeight(left))
    .slice(0, 80);
}

function normalizeKeyword(word: string) {
  if (/^\d+(?:\.\d+)?$/.test(word) || /\d/.test(word)) {
    return word;
  }

  if (word.length > 4 && word.endsWith("ies")) {
    return `${word.slice(0, -3)}y`;
  }

  if (word.length > 4 && word.endsWith("s")) {
    return word.slice(0, -1);
  }

  return word;
}

function keywordWeight(keyword: string) {
  if (/\d/.test(keyword)) {
    return 5;
  }

  if (
    [
      "active",
      "speaker",
      "loudspeaker",
      "array",
      "beam",
      "power",
      "supply",
      "fault",
      "monitoring",
      "backup",
      "battery",
      "certificate",
      "standard",
      "voice",
      "alarm",
      "evacuation",
      "spl",
      "frequency",
      "ip54",
      "ip55",
      "en54",
      "bs5839"
    ].includes(keyword)
  ) {
    return 4;
  }

  return keyword.length >= 8 ? 2 : 1;
}

function inferSubClauseNumber(clauseNumber: string | null, text: string) {
  if (clauseNumber && clauseNumber.split(".").length > 2) {
    return clauseNumber;
  }

  const lettered = text.match(/\b([a-z]\)|\([a-z]\)|[ivx]+\)|\([ivx]+\))\b/i);
  return lettered?.[1] ?? null;
}

function requiredTechnicalTokens(text: string) {
  const normalized = text.toLowerCase();
  const tokens = [
    ...normalized.matchAll(/\b(?:ip|ik)\s?-?\d{2}\b/g),
    ...normalized.matchAll(/\b(?:en|bs|iec|iso|nfpa|ul)\s?-?\d+(?:-\d+)*(?::\d+)?\b/g),
    ...normalized.matchAll(/\b\d+(?:\.\d+)?\s?(?:v|vac|vdc|a|ma|w|kw|db|dbspl|hz|khz|mm|cm|m|degc|c|%)\b/g)
  ].map((match) => match[0].replace(/\s+/g, ""));

  return Array.from(new Set(tokens));
}

function missingRequiredTechnicalTokens(requirementText: string, evidenceText: string) {
  const evidence = evidenceText.toLowerCase().replace(/\s+/g, "");
  return requiredTechnicalTokens(requirementText).filter((token) => !evidence.includes(token));
}

function hasTechnicalContradiction(requirementText: string, evidenceText: string) {
  return hasLowerIpRating(requirementText, evidenceText) || hasNarrowerFrequencyRange(requirementText, evidenceText);
}

function hasLowerIpRating(requirementText: string, evidenceText: string) {
  const required = requirementText.toLowerCase().match(/\bip\s?-?(\d)(\d)\b/);
  const proposed = evidenceText.toLowerCase().match(/\bip\s?-?(\d)(\d)\b/);

  if (!required || !proposed) {
    return false;
  }

  return Number(proposed[1]) < Number(required[1]) || Number(proposed[2]) < Number(required[2]);
}

function hasNarrowerFrequencyRange(requirementText: string, evidenceText: string) {
  const required = extractFrequencyRange(requirementText);
  const proposed = extractFrequencyRange(evidenceText);

  if (!required || !proposed) {
    return false;
  }

  return proposed.minHz > required.minHz || proposed.maxHz < required.maxHz;
}

function extractFrequencyRange(text: string) {
  const normalized = text.toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s?(hz|khz)\s?(?:-|to|–)\s?(\d+(?:\.\d+)?)\s?(hz|khz)/);

  if (!match) {
    return null;
  }

  const minHz = toHz(Number(match[1]), match[2]);
  const maxHz = toHz(Number(match[3]), match[4]);
  return { minHz, maxHz };
}

function toHz(value: number, unit: string) {
  return unit === "khz" ? value * 1000 : value;
}

function enrichReasoning(
  baseReasoning: string,
  requirement: RequirementCandidate,
  evidence: EvidenceMatch | null,
  missingTechnicalTokens: string[]
) {
  const details: string[] = [baseReasoning];

  if (requirement.applicabilityReason) {
    details.push(requirement.applicabilityReason);
  }

  if (evidence) {
    details.push(
      `Best evidence match came from ${evidence.source.documentName}, page ${evidence.source.pageNumber}, with matched terms: ${
        evidence.matchedTerms.slice(0, 8).join(", ") || "limited direct terms"
      }.`
    );
  }

  if (missingTechnicalTokens.length > 0) {
    details.push(`The evidence does not directly prove required technical value(s): ${missingTechnicalTokens.slice(0, 8).join(", ")}.`);
  }

  return details.join(" ");
}

function inferRiskLevel(text: string): RiskLevel {
  if (criticalTerms.some((term) => text.includes(term))) {
    return "critical";
  }

  if (/\b(ip\d+|en\s?\d+|bs\s?\d+|iec\s?\d+|iso\s?\d+)\b/i.test(text)) {
    return "high";
  }

  if (/\b\d+(?:\.\d+)?\s?(v|a|w|kw|db|hz|khz|mm|m|c|deg|%)\b/i.test(text)) {
    return "medium";
  }

  return "medium";
}

function toSourceReference(documentName: string, chunk: ReviewChunk): SourceReference {
  return {
    documentName,
    pageNumber: chunk.pageNumber,
    clauseNumber: chunk.clauseNumber ?? undefined,
    quote: excerpt(chunk.chunkText)
  };
}

function formatRequirementSource(source: SourceReference) {
  const clause = source.clauseNumber ? `\nClause: ${source.clauseNumber}` : "\nClause: Not identified";
  return `Requirement Source:\nDocument: ${source.documentName}\nPage: ${source.pageNumber}${clause}\nQuote: "${source.quote}"`;
}

function formatEvidenceSource(source: SourceReference) {
  const clause = source.clauseNumber ? `\nClause/Table/Figure: ${source.clauseNumber}` : "\nClause/Table/Figure: Not identified";
  return `Evidence Source:\nDocument: ${source.documentName}\nPage: ${source.pageNumber}${clause}\nQuote: "${source.quote}"`;
}

function missingInformationFor(status: ComplianceStatus, missingTechnicalTokens: string[] = []) {
  if (missingTechnicalTokens.length > 0) {
    return `Direct evidence is missing for required technical value(s): ${missingTechnicalTokens.slice(0, 8).join(", ")}.`;
  }

  if (status === "not_verified") {
    return "A required source reference or matching evidence source is missing.";
  }

  if (status === "partially_complied") {
    return "Evidence exists but does not fully prove every requirement condition.";
  }

  if (status === "not_complied") {
    return "Submitted evidence appears to contradict the requirement.";
  }

  return "Evidence is missing, indirect, unclear, or not safely comparable.";
}

function contractorActionFor(status: ComplianceStatus, comparisonScope: string) {
  if (status === "not_verified") {
    return "Provide a source-backed document reference proving compliance with this requirement.";
  }

  if (status === "partially_complied") {
    if (comparisonScope.includes("Doc. 2")) {
      return "Provide the applicable standard clause evidence, certificate, test report, or manufacturer statement proving this requirement for the proposed speaker.";
    }

    if (comparisonScope.includes("Doc. 3")) {
      return "Provide speaker power supply datasheet details, standby/charger data, fault monitoring evidence, or certified calculation needed to close this condition.";
    }

    return "Provide the missing datasheet, certificate, calculation, drawing, or written confirmation needed to close the condition.";
  }

  if (status === "not_complied") {
    return "Submit a revised proposal or formal technical deviation for human reviewer assessment.";
  }

  return "Clarify the requirement with direct evidence and exact document, page, and clause references.";
}

function createClarification(finding: GeneratedFinding): GeneratedClarification {
  const priority = finding.riskLevel === "critical" ? "Critical" : finding.riskLevel === "high" ? "High" : "Medium";

  return {
    clauseNumber: finding.clauseNumber,
    issue: finding.missingInformation ?? "Compliance is not proven.",
    whyItMatters: "The final report cannot confirm compliance without direct source-backed evidence.",
    requiredAction: finding.contractorAction ?? "Provide direct supporting evidence.",
    requiredDocument: "Manufacturer datasheet, certificate, drawing, calculation, or formal compliance statement.",
    priority
  };
}

function excerpt(text: string, maxLength = 360) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
