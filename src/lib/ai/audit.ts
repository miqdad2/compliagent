export const AI_AUDIT_ACTIONS = {
  SETTINGS_UPDATED: "ai.settings.updated",
  RUN_REQUESTED: "ai.run.requested",
  RUN_BLOCKED_BY_CONSENT: "ai.run.blocked_by_consent",
  RUN_STARTED: "ai.run.started",
  RUN_COMPLETED: "ai.run.completed",
  RUN_FAILED: "ai.run.failed",
  OUTPUT_VALIDATION_FAILED: "ai.output.validation_failed",
  MOCK_REPAIR_ATTEMPTED: "ai.mock.repair_attempted",
  REVIEWER_OVERRIDE: "ai.review.reviewer_override"
} as const;

export type AiAuditAction = (typeof AI_AUDIT_ACTIONS)[keyof typeof AI_AUDIT_ACTIONS];
