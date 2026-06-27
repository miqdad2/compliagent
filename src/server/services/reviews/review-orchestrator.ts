import { deriveParentFindingStatus, type ParentConditionEvaluation } from "@/lib/compliance/parent-finding";
import type { ConditionEvaluationStatus } from "@/lib/compliance/condition-schemas";
import type { CompliancePersistenceGateway } from "@/server/services/compliance/gateway";
import { ParentFindingService } from "@/server/services/compliance/parent-finding";
import { specificationRoles, submissionRoles } from "@/types/domain";
import type { DocumentRole } from "@/types/domain";
import type { AuthProfile } from "@/lib/permissions/server";
import type { ConfidenceFlag } from "@/lib/ai/review-schemas";
import {
  ok,
  fail,
  type ReviewServiceResult,
  type RunControlledReviewInput,
  type RunControlledReviewResult,
  type DiscoveredRequirement,
  type ConditionEvaluationDraft
} from "./types";
import type { ReviewPersistenceGateway } from "./gateway";
import { RequirementDiscoveryService } from "./requirement-discovery";
import { EvidenceRetrievalService } from "./evidence-retrieval";
import { ConditionComparisonService } from "./condition-comparison";
import { FindingVerifierService } from "./finding-verifier";
import { AiConditionComparisonService } from "./ai-condition-comparison";
import { AiFindingVerifierService } from "./ai-finding-verifier";
import { EvidenceRerankerService } from "./evidence-reranker";
import type { ControlledAiExecutionService } from "@/server/services/ai/controlled-execution";
import { ProvisionalRequirementService } from "./provisional-requirements";
import type { ProvisionalRequirementGateway } from "./provisional-requirements";
import { hasMandatoryLanguage } from "./requirement-discovery";

const REVIEW_AUDIT_ACTIONS = {
  REVIEW_STARTED:       "controlled_review.started",
  REVIEW_COMPLETED:     "controlled_review.completed_to_human_review",
  REVIEW_FAILED:        "controlled_review.failed",
  FINDING_CREATED:      "controlled_review.finding_created",
  CONDITION_EVALUATED:  "controlled_review.condition_evaluated",
  NO_REQUIREMENTS:      "controlled_review.no_requirements_found",
  IDEMPOTENT_SKIP:      "controlled_review.idempotent_skip"
} as const;

function deriveRiskLevel(avgConfidence: number): string {
  if (avgConfidence >= 85) return "low";
  if (avgConfidence >= 65) return "medium";
  if (avgConfidence >= 45) return "high";
  return "critical";
}

/**
 * Determines whether a discovered provisional requirement can be auto-confirmed
 * without requiring explicit human confirmation before it enters the pipeline.
 *
 * Auto-confirm criteria (all must pass):
 * 1. Has a clause number (it's clearly positioned in a normative structure)
 * 2. Has mandatory language ("shall", "must", "required", etc.)
 * 3. Has sufficient requirement text (>= 30 chars)
 * 4. Has reasonable discovery confidence (>= 0.6)
 */
function canAutoConfirm(p: Omit<DiscoveredRequirement, "requirementId">): boolean {
  if (!p.clauseNumber || p.clauseNumber.trim().length === 0) return false;
  if (!hasMandatoryLanguage(p.requirementText)) return false;
  if (p.requirementText.trim().length < 30) return false;
  if (p.extractionConfidence < 0.6) return false;
  return true;
}

/**
 * ReviewOrchestrator coordinates the full controlled technical review pipeline.
 *
 * Supports three execution modes:
 *   "deterministic" — no AI calls; comparison and verification use deterministic logic only.
 *   "mock"          — uses a mock ControlledAiExecutionService (no external calls).
 *   "controlled_live" — uses real AI with consent + credential checks.
 *
 * No review is ever auto-approved. All reviews hand off to AWAITING_HUMAN_REVIEW.
 */
export class ReviewOrchestrator {
  private readonly discovery    = new RequirementDiscoveryService();
  private readonly retrieval    = new EvidenceRetrievalService();
  private readonly detComparison = new ConditionComparisonService();
  private readonly detVerifier   = new FindingVerifierService();
  private readonly parentFindingService: ParentFindingService;
  private readonly aiComparison: AiConditionComparisonService;
  private readonly aiVerifier:   AiFindingVerifierService;
  private readonly aiReranker:   EvidenceRerankerService;

  constructor(
    private readonly reviewGateway:     ReviewPersistenceGateway,
    private readonly complianceGateway: CompliancePersistenceGateway,
    /** Optional: when provided, enables AI-assisted stages in "controlled_live" and "mock" modes. */
    private readonly aiExecutor: ControlledAiExecutionService | null = null,
    /** Optional: when provided, persists provisional requirements discovered from chunks. */
    private readonly provisionalGateway: ProvisionalRequirementGateway | null = null
  ) {
    this.parentFindingService  = new ParentFindingService(complianceGateway);
    this.aiComparison          = new AiConditionComparisonService(aiExecutor);
    this.aiVerifier            = new AiFindingVerifierService(aiExecutor);
    this.aiReranker            = new EvidenceRerankerService(aiExecutor);
    this.provisionalRequirements = provisionalGateway
      ? new ProvisionalRequirementService(provisionalGateway)
      : null;
  }

  private readonly provisionalRequirements: ProvisionalRequirementService | null;

  async runControlledReview(
    input: RunControlledReviewInput,
    actor?: AuthProfile
  ): Promise<ReviewServiceResult<RunControlledReviewResult>> {
    const { organizationId, projectId, reviewId, createdBy, reviewVersion,
            sourceHash, extractionVersion, promptVersion, executionMode } = input;

    // ── 1. Load and validate the review row ──────────────────────────────────
    const review = await this.reviewGateway.getReview(reviewId, organizationId);
    if (!review) {
      return fail("REVIEW_NOT_FOUND", "The compliance review was not found or is not accessible.");
    }
    if (review.project_id !== projectId) {
      return fail("PROJECT_ACCESS_DENIED", "The review does not belong to the specified project.");
    }

    // ── 2. Idempotency check ─────────────────────────────────────────────────
    if (
      review.status === "awaiting_human_review" &&
      review.source_hash === sourceHash &&
      review.extraction_version === extractionVersion &&
      review.prompt_version === promptVersion &&
      review.review_version === reviewVersion
    ) {
      await this.reviewGateway.writeAudit([{
        organizationId, projectId, userId: createdBy,
        action: REVIEW_AUDIT_ACTIONS.IDEMPOTENT_SKIP,
        entityType: "compliance_reviews", entityId: reviewId,
        metadata: { reviewVersion, sourceHash }
      }]);
      return ok({
        reviewId, status: "awaiting_human_review", executionMode,
        findingCount: 0, conditionCount: 0, requirementCount: 0,
        idempotentSkip: true, aiRunCount: 0, humanReviewRequiredCount: 0, flags: []
      });
    }

    // ── 3. Transition review to RUNNING ──────────────────────────────────────
    try {
      await this.reviewGateway.beginReview(
        organizationId, projectId, reviewId,
        reviewVersion, sourceHash, extractionVersion, promptVersion
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "begin_review failed";
      if (msg.includes("REVIEW_STATE_CONFLICT")) {
        return fail("REVIEW_STATE_CONFLICT", `Review cannot be started: ${msg}`, false);
      }
      return fail("REVIEW_STATE_CONFLICT", msg, true);
    }

    await this.reviewGateway.writeAudit([{
      organizationId, projectId, userId: createdBy,
      action: REVIEW_AUDIT_ACTIONS.REVIEW_STARTED,
      entityType: "compliance_reviews", entityId: reviewId,
      metadata: { reviewVersion, sourceHash, extractionVersion, promptVersion, executionMode }
    }]);

    try {
      const result = await this._runPipeline(input, actor ?? null);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unexpected orchestrator error.";
      await this._failReview(organizationId, reviewId, createdBy, projectId, "PIPELINE_ERROR", msg);
      return fail("PERSISTENCE_FAILED", msg, true);
    }
  }

  private async _runPipeline(
    input: RunControlledReviewInput,
    actor: AuthProfile | null
  ): Promise<ReviewServiceResult<RunControlledReviewResult>> {
    const { organizationId, projectId, reviewId, createdBy, executionMode } = input;

    // Whether AI stages are active.
    const useAi = (executionMode === "controlled_live" || executionMode === "mock") && this.aiExecutor !== null && actor !== null;

    // ── 4. Document role confirmation ────────────────────────────────────────
    const allDocs = await this.reviewGateway.listProjectDocuments(projectId, organizationId);
    const processedDocs = allDocs.filter((d) => d.processing_status === "completed");

    const specDocIds = processedDocs
      .filter((d) => specificationRoles.includes(d.document_role as DocumentRole))
      .map((d) => d.id);

    const submissionDocIds = processedDocs
      .filter((d) => submissionRoles.includes(d.document_role as DocumentRole))
      .map((d) => d.id);

    if (processedDocs.length === 0) {
      await this._failReview(organizationId, reviewId, createdBy, projectId, "NO_PROCESSED_DOCUMENTS", "No processed documents found.");
      return fail("NO_PROCESSED_DOCUMENTS", "No processed documents found for this project.");
    }

    // ── 5. Requirement discovery ─────────────────────────────────────────────
    const allRequirements = await this.reviewGateway.listRequirementsForProject(projectId, organizationId);
    const docsWithRequirements = new Set(allRequirements.map((r) => r.source_document_id));
    const specDocIdsWithoutRequirements = specDocIds.filter((id) => !docsWithRequirements.has(id));

    const discovered: DiscoveredRequirement[] = this.discovery.fromExtracted(allRequirements);

    if (specDocIdsWithoutRequirements.length > 0) {
      const allChunks = await this.reviewGateway.listChunksForDocuments(specDocIdsWithoutRequirements, projectId);
      const provisional = this.discovery.discoverFromChunks(allChunks, projectId, specDocIdsWithoutRequirements);

      for (const p of provisional) {
        if (this.provisionalRequirements) {
          const autoConfirm = canAutoConfirm(p);
          // Persist the provisional requirement so it gets a real DB ID.
          const persisted = await this.provisionalRequirements.persistDiscovered({
            organizationId:       organizationId,
            projectId,
            reviewId,
            sourceDocumentId:     p.sourceDocumentId,
            pageNumber:           p.pageNumber,
            clauseNumber:         p.clauseNumber,
            subClauseNumber:      p.subClauseNumber ?? null,
            sectionHeading:       null,
            requirementText:      p.requirementText,
            normalizedText:       p.requirementText,
            requirementType:      null,
            mandatoryLevel:       p.mandatoryLevel,
            requirementState:     autoConfirm ? "confirmed" : "provisional",
            discoveryConfidence:  p.extractionConfidence,
            refinementConfidence: null,
            aiRunId:              null,
            promptVersion:        null,
            humanReviewRequired:  !autoConfirm,
            humanReviewReasons:   autoConfirm
              ? []
              : ["Provisional — discovered from chunks, not yet confirmed"],
            createdBy
          });
          discovered.push({ ...p, requirementId: persisted.id });
        } else {
          // No gateway: fall back to the original synthetic-ID behavior (skipped below).
          discovered.push({ ...p, requirementId: `provisional-${p.pageNumber}-${Date.now()}` });
        }
      }
    }

    const checkable = this.discovery.filterCheckable(discovered);

    if (checkable.length === 0) {
      await this.reviewGateway.writeAudit([{
        organizationId, projectId, userId: createdBy,
        action: REVIEW_AUDIT_ACTIONS.NO_REQUIREMENTS,
        entityType: "compliance_reviews", entityId: reviewId,
        metadata: { specDocCount: specDocIds.length }
      }]);
      await this.reviewGateway.completeReviewToHumanReview(organizationId, reviewId, 0, 0);
      await this.reviewGateway.writeAudit([{
        organizationId, projectId, userId: createdBy,
        action: REVIEW_AUDIT_ACTIONS.REVIEW_COMPLETED,
        entityType: "compliance_reviews", entityId: reviewId,
        metadata: { findingCount: 0, conditionCount: 0, executionMode }
      }]);
      return ok({
        reviewId, status: "awaiting_human_review", executionMode,
        findingCount: 0, conditionCount: 0, requirementCount: 0,
        idempotentSkip: false, aiRunCount: 0, humanReviewRequiredCount: 0, flags: []
      });
    }

    // ── 6. Load submission evidence ──────────────────────────────────────────
    const submissionChunks = await this.reviewGateway.listChunksForDocuments(submissionDocIds, projectId);
    const evidenceRegions  = await this.reviewGateway.listEvidenceRegionsForDocuments(submissionDocIds, organizationId, projectId);

    // ── 7. Process each requirement ──────────────────────────────────────────
    let totalConditionCount    = 0;
    let totalAiRunCount        = 0;
    let humanReviewCount       = 0;
    const allFlags              = new Set<ConfidenceFlag>();
    const findingIds: string[] = [];

    for (const req of checkable) {
      // Skip only synthetic provisional IDs (no gateway was provided).
      if (req.requirementId.startsWith("provisional-")) continue;

      let conditions = await this.complianceGateway.listActiveConditionsByRequirement(req.requirementId);

      // Deterministic fallback: if no conditions have been decomposed yet, create a
      // single evidence-presence condition from the requirement text. This lets the
      // deterministic pipeline produce conservative findings without requiring AI
      // condition decomposition. Human reviewers can refine these later.
      if (conditions.length === 0 && executionMode === "deterministic") {
        conditions = await this.complianceGateway.insertConditions([{
          organization_id:         organizationId,
          project_id:              projectId,
          requirement_id:          req.requirementId,
          condition_order:         1,
          condition_key:           "auto_presence_check",
          condition_type:          "boolean",
          subject:                 "submission document",
          attribute:               req.requirementText.slice(0, 100),
          operator:                "exists",
          expected_text:           req.requirementText.slice(0, 200),
          expected_numeric_value:  null,
          expected_min_value:      null,
          expected_max_value:      null,
          expected_unit:           null,
          is_mandatory:            true,
          source_text:             req.requirementText.slice(0, 500),
          extraction_confidence:   60,
          is_active:               true,
          is_human_confirmed:      false
        }]);
      }

      if (conditions.length === 0) continue;

      // Provisional requirements always require human review.
      const isProvisional = req.mandatoryLevel === "provisional";
      const findingId = await this.reviewGateway.upsertFinding({
        organizationId, projectId, reviewId,
        requirementId:  req.requirementId,
        clauseNumber:   req.clauseNumber,
        subClauseNumber: req.subClauseNumber,
        requirementText: req.requirementText,
        status:         "not_proven",
        weightageScore: isProvisional ? 0.5 : 1,
        confidenceScore: isProvisional ? 40 : 0,
        reasoning:      isProvisional
          ? "Provisional requirement — evaluation requires human confirmation."
          : "Evaluation in progress.",
        riskLevel:      "high",
        createdBy
      });
      findingIds.push(findingId);

      await this.reviewGateway.writeAudit([{
        organizationId, projectId, userId: createdBy,
        action: REVIEW_AUDIT_ACTIONS.FINDING_CREATED,
        entityType: "compliance_findings", entityId: findingId,
        metadata: { requirementId: req.requirementId, conditionCount: conditions.length }
      }]);

      const conditionDrafts: ConditionEvaluationDraft[] = [];

      for (const condition of conditions) {
        // Evidence retrieval.
        let evidence = this.retrieval.retrieve(condition, submissionChunks, evidenceRegions, submissionDocIds);

        // Semantic reranking (AI if enabled).
        if (useAi && evidence.retrievalResults.length > 0) {
          const reranked = await this.aiReranker.rerank(
            condition, evidence,
            { actor: actor!, organizationId, projectId, reviewId, documentRole: "contractor_submission" }
          );
          evidence = reranked.evidence;
          if (reranked.aiRunId) totalAiRunCount++;
          reranked.flags.forEach((f) => allFlags.add(f));
        }

        // Comparison.
        let comparisonResult;
        if (useAi) {
          const outcome = await this.aiComparison.compare(
            condition, evidence,
            { actor: actor!, organizationId, projectId, reviewId }
          );
          comparisonResult = outcome.comparison;
          if (outcome.aiRunId) totalAiRunCount++;
          outcome.flags.forEach((f) => allFlags.add(f));
        } else {
          comparisonResult = this.detComparison.compare(condition, evidence);
          allFlags.add("DETERMINISTIC_FALLBACK_USED");
        }

        // Independent verification.
        let verificationResult;
        let verifierFlags: ConfidenceFlag[] = [];
        let disagreementDetected = false;
        let conservativeStatus: string | null = null;

        if (useAi) {
          const outcome = await this.aiVerifier.verify(
            condition, evidence, comparisonResult,
            { actor: actor!, organizationId, projectId, reviewId, findingId }
          );
          verificationResult = outcome.finalResult;
          if (outcome.aiRunId) totalAiRunCount++;
          verifierFlags = outcome.flags;
          disagreementDetected = outcome.disagreementDetected;
          conservativeStatus   = outcome.conservativeStatus;
          outcome.flags.forEach((f) => allFlags.add(f));
        } else {
          verificationResult = this.detVerifier.verify(findingId, condition, evidence, comparisonResult);
        }

        // Final status: verification failure takes precedence.
        let finalStatus: ConditionEvaluationStatus = comparisonResult.status as ConditionEvaluationStatus;
        let verificationFailureReason: string | null = null;

        if (!verificationResult.passed) {
          finalStatus = "not_verified";
          verificationFailureReason = verificationResult.verifierReasoning;
        }

        // On disagreement: use conservative status rather than comparison status.
        if (disagreementDetected && conservativeStatus) {
          finalStatus = conservativeStatus as ConditionEvaluationStatus;
          allFlags.add("VERIFIER_DISAGREEMENT");
        }

        const isHumanReviewRequired =
          comparisonResult.humanReviewRequired ||
          verificationResult.requiresHumanReview ||
          disagreementDetected;

        if (isHumanReviewRequired) humanReviewCount++;

        const evidenceSummary = evidence.primaryQuote
          ? `${evidence.sufficiency}: "${evidence.primaryQuote.slice(0, 200)}"`
          : null;

        const draft: ConditionEvaluationDraft = {
          condition,
          retrieval:    evidence,
          comparison:   comparisonResult,
          verification: verificationResult,
          finalStatus,
          evidenceSummary,
          reasoning:              comparisonResult.reasoning,
          contradictionReasoning: finalStatus === "not_complied" ? comparisonResult.reasoning : null,
          missingInformation:     comparisonResult.missingInformation,
          verificationFailureReason,
          contractorAction:       comparisonResult.contractorAction,
          confidenceScore:        comparisonResult.confidence,
          weightageScore:         1,
          isHumanReviewRequired
        };

        conditionDrafts.push(draft);
      }

      // Derive parent status.
      const parentInputs: ParentConditionEvaluation[] = conditionDrafts.map((d) => ({
        id:                   d.condition.id,
        status:               d.finalStatus as ConditionEvaluationStatus,
        humanStatus:          null,
        isMandatory:          d.condition.is_mandatory,
        isHumanReviewRequired: d.isHumanReviewRequired
      }));
      const parentDerivation = deriveParentFindingStatus(parentInputs);

      // Persist each condition evaluation via the existing atomic RPC.
      for (const draft of conditionDrafts) {
        const evidenceLinks = draft.retrieval.primaryRegionId
          ? [{ regionId: draft.retrieval.primaryRegionId, relationshipType: "supports" }]
          : [{ regionId: null, relationshipType: "missing_expected_region" }];

        const persistResult = await this.parentFindingService.persistEvaluationAndRefreshParent({
          organizationId, projectId, reviewId, findingId,
          requirementId:          req.requirementId,
          requirementConditionId: draft.condition.id,
          status:                 draft.finalStatus as ConditionEvaluationStatus,
          evidenceSummary:        draft.evidenceSummary,
          reasoning:              draft.reasoning,
          contradictionReasoning: draft.contradictionReasoning,
          missingInformation:     draft.missingInformation,
          verificationFailureReason: draft.verificationFailureReason,
          contractorAction:       draft.contractorAction,
          confidenceScore:        draft.confidenceScore,
          weightageScore:         draft.weightageScore,
          isHumanReviewRequired:  draft.isHumanReviewRequired,
          evidenceLinks,
          requestingUserId:       createdBy
        });

        if (!persistResult.success) {
          if (persistResult.errorCode === "HUMAN_APPROVAL_PROTECTED") continue;
          await this._failReview(organizationId, reviewId, createdBy, projectId, persistResult.errorCode, persistResult.message);
          return fail("PERSISTENCE_FAILED", persistResult.message, persistResult.retryable);
        }

        await this.reviewGateway.writeAudit([{
          organizationId, projectId, userId: createdBy,
          action: REVIEW_AUDIT_ACTIONS.CONDITION_EVALUATED,
          entityType: "condition_evaluations", entityId: persistResult.data.evaluationId,
          metadata: {
            conditionId:    draft.condition.id,
            finalStatus:    draft.finalStatus,
            parentStatus:   persistResult.data.parentStatus,
            revisionNumber: persistResult.data.revisionNumber,
            executionMode
          }
        }]);
      }

      totalConditionCount += conditionDrafts.length;

      const avgConfidence =
        conditionDrafts.length > 0
          ? conditionDrafts.reduce((s, d) => s + d.confidenceScore, 0) / conditionDrafts.length
          : 0;

      if (avgConfidence < 70) allFlags.add("LOW_COMPARISON_CONFIDENCE");

      await this.reviewGateway.updateFindingStatus(
        findingId, organizationId,
        parentDerivation.status,
        parentDerivation.status,
        parentDerivation.reasoning
      );
    }

    // ── 8. Human-review handoff (never auto-approve) ─────────────────────────
    await this.reviewGateway.completeReviewToHumanReview(
      organizationId, reviewId,
      findingIds.length, totalConditionCount
    );

    await this.reviewGateway.writeAudit([{
      organizationId, projectId, userId: createdBy,
      action: REVIEW_AUDIT_ACTIONS.REVIEW_COMPLETED,
      entityType: "compliance_reviews", entityId: reviewId,
      metadata: {
        findingCount:    findingIds.length,
        conditionCount:  totalConditionCount,
        requirementCount: checkable.length,
        executionMode,
        aiRunCount:      totalAiRunCount
      }
    }]);

    return ok({
      reviewId,
      status:           "awaiting_human_review",
      executionMode,
      findingCount:     findingIds.length,
      conditionCount:   totalConditionCount,
      requirementCount: checkable.length,
      idempotentSkip:   false,
      aiRunCount:       totalAiRunCount,
      humanReviewRequiredCount: humanReviewCount,
      flags:            [...allFlags]
    });
  }

  private async _failReview(
    organizationId: string, reviewId: string, userId: string,
    projectId: string, errorCode: string, safeMessage: string
  ): Promise<void> {
    try {
      await this.reviewGateway.failReview(organizationId, reviewId, errorCode, safeMessage.slice(0, 500));
      await this.reviewGateway.writeAudit([{
        organizationId, projectId, userId,
        action: REVIEW_AUDIT_ACTIONS.REVIEW_FAILED,
        entityType: "compliance_reviews", entityId: reviewId,
        metadata: { errorCode, messageLength: safeMessage.length }
      }]);
    } catch { /* Non-fatal */ }
  }
}
