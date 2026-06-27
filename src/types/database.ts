import type { ComplianceStatus, DocumentRole, ProcessingStatus, ProjectStatus, RiskLevel, UserRole } from "./domain";
import type {
  AnnotationApprovalStatus,
  AnnotationStatus,
  AnnotationType,
  CoordinateSystem,
  EvidenceRegionType,
  FindingEvidenceRelationshipType
} from "@/lib/annotations/schemas";
import type {
  ConditionEvaluationStatus,
  ConditionEvidenceRelationship,
  ConditionOperator,
  RequirementConditionType
} from "@/lib/compliance/condition-schemas";
import type { AiProvider } from "@/lib/ai/provider";
import type {
  AiRunStatus,
  AiValidationStatus,
  AiVerificationStatus
} from "@/lib/ai/schemas";
import type { AiTaskType } from "@/lib/ai/tasks";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
      };
      profiles: {
        Row: {
          id: string;
          user_id: string;
          organization_id: string;
          full_name: string | null;
          role: UserRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          organization_id: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          client_name: string;
          discipline: string;
          review_type: string;
          description: string | null;
          status: ProjectStatus;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          client_name: string;
          discipline: string;
          review_type: string;
          description?: string | null;
          status?: ProjectStatus;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
      };
      documents: {
        Row: {
          id: string;
          project_id: string;
          organization_id: string;
          file_name: string;
          storage_path: string;
          mime_type: string;
          file_size: number;
          document_role: DocumentRole;
          version: number;
          page_count: number | null;
          processing_status: ProcessingStatus;
          ocr_required: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          organization_id: string;
          file_name: string;
          storage_path: string;
          mime_type: string;
          file_size: number;
          document_role: DocumentRole;
          version?: number;
          page_count?: number | null;
          processing_status?: ProcessingStatus;
          ocr_required?: boolean;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
      };
      document_pages: {
        Row: {
          id: string;
          document_id: string;
          organization_id: string;
          project_id: string;
          page_number: number;
          extracted_text: string | null;
          normalized_text: string | null;
          extraction_method: string;
          confidence: number;
          ocr_required: boolean;
          source_hash: string | null;
          source_label: string | null;
          page_width: number | null;
          page_height: number | null;
          page_rotation: number | null;
          coordinate_system: string | null;
          image_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          organization_id: string;
          project_id: string;
          page_number: number;
          extracted_text?: string | null;
          normalized_text?: string | null;
          extraction_method: string;
          confidence?: number;
          ocr_required?: boolean;
          source_hash?: string | null;
          source_label?: string | null;
          page_width?: number | null;
          page_height?: number | null;
          page_rotation?: number | null;
          coordinate_system?: string | null;
          image_path?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["document_pages"]["Insert"]>;
      };
      document_chunks: {
        Row: {
          id: string;
          document_id: string;
          project_id: string;
          page_number: number;
          clause_number: string | null;
          section_heading: string | null;
          chunk_text: string;
          normalized_text: string;
          embedding: unknown | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          project_id: string;
          page_number: number;
          clause_number?: string | null;
          section_heading?: string | null;
          chunk_text: string;
          normalized_text: string;
          embedding?: unknown | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["document_chunks"]["Insert"]>;
      };
      extracted_requirements: {
        Row: {
          id: string;
          organization_id: string | null;
          project_id: string;
          review_id: string | null;
          source_document_id: string;
          page_number: number;
          clause_number: string | null;
          sub_clause_number: string | null;
          section_heading: string | null;
          requirement_text: string;
          normalized_text: string | null;
          requirement_type: string | null;
          requirement_state: string;
          discipline: string | null;
          mandatory_level: string | null;
          numeric_value: number | null;
          unit: string | null;
          standard_reference: string | null;
          acceptance_criteria: string | null;
          extraction_confidence: number;
          discovery_confidence: number | null;
          refinement_confidence: number | null;
          ai_run_id: string | null;
          prompt_version: string | null;
          human_review_required: boolean;
          human_review_reasons: Json | null;
          is_active: boolean;
          superseded_at: string | null;
          superseded_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          project_id: string;
          review_id?: string | null;
          source_document_id: string;
          page_number: number;
          clause_number?: string | null;
          sub_clause_number?: string | null;
          section_heading?: string | null;
          requirement_text: string;
          normalized_text?: string | null;
          requirement_type?: string | null;
          requirement_state?: string;
          discipline?: string | null;
          mandatory_level?: string | null;
          numeric_value?: number | null;
          unit?: string | null;
          standard_reference?: string | null;
          acceptance_criteria?: string | null;
          extraction_confidence: number;
          discovery_confidence?: number | null;
          refinement_confidence?: number | null;
          ai_run_id?: string | null;
          prompt_version?: string | null;
          human_review_required?: boolean;
          human_review_reasons?: Json | null;
          is_active?: boolean;
          superseded_at?: string | null;
          superseded_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["extracted_requirements"]["Insert"]>;
      };
      extracted_evidence: {
        Row: {
          id: string;
          project_id: string;
          source_document_id: string;
          page_number: number;
          clause_number: string | null;
          evidence_text: string;
          evidence_type: string | null;
          product_model: string | null;
          manufacturer: string | null;
          numeric_value: number | null;
          unit: string | null;
          standard_reference: string | null;
          extraction_confidence: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          source_document_id: string;
          page_number: number;
          clause_number?: string | null;
          evidence_text: string;
          evidence_type?: string | null;
          product_model?: string | null;
          manufacturer?: string | null;
          numeric_value?: number | null;
          unit?: string | null;
          standard_reference?: string | null;
          extraction_confidence: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["extracted_evidence"]["Insert"]>;
      };
      requirement_conditions: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string;
          requirement_id: string;
          condition_order: number;
          condition_key: string;
          condition_type: RequirementConditionType;
          subject: string;
          attribute: string;
          operator: ConditionOperator;
          expected_text: string | null;
          expected_numeric_value: number | null;
          expected_min_value: number | null;
          expected_max_value: number | null;
          expected_unit: string | null;
          is_mandatory: boolean;
          source_text: string;
          extraction_confidence: number;
          is_active: boolean;
          is_human_confirmed: boolean;
          superseded_at: string | null;
          superseded_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id: string;
          requirement_id: string;
          condition_order: number;
          condition_key: string;
          condition_type: RequirementConditionType;
          subject: string;
          attribute: string;
          operator: ConditionOperator;
          expected_text?: string | null;
          expected_numeric_value?: number | null;
          expected_min_value?: number | null;
          expected_max_value?: number | null;
          expected_unit?: string | null;
          is_mandatory?: boolean;
          source_text: string;
          extraction_confidence: number;
          is_active?: boolean;
          is_human_confirmed?: boolean;
          superseded_at?: string | null;
          superseded_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["requirement_conditions"]["Insert"]>;
      };
      condition_evaluations: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string;
          review_id: string;
          finding_id: string;
          requirement_id: string;
          requirement_condition_id: string;
          status: ConditionEvaluationStatus;
          evidence_summary: string | null;
          reasoning: string;
          contradiction_reasoning: string | null;
          missing_information: string | null;
          verification_failure_reason: string | null;
          contractor_action: string | null;
          confidence_score: number;
          weightage_score: number;
          is_human_review_required: boolean;
          human_status: ConditionEvaluationStatus | null;
          human_comment: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          is_active: boolean;
          revision_number: number;
          superseded_at: string | null;
          superseded_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id: string;
          review_id: string;
          finding_id: string;
          requirement_id: string;
          requirement_condition_id: string;
          status: ConditionEvaluationStatus;
          evidence_summary?: string | null;
          reasoning: string;
          contradiction_reasoning?: string | null;
          missing_information?: string | null;
          verification_failure_reason?: string | null;
          contractor_action?: string | null;
          confidence_score: number;
          weightage_score: number;
          is_human_review_required?: boolean;
          human_status?: ConditionEvaluationStatus | null;
          human_comment?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          is_active?: boolean;
          revision_number?: number;
          superseded_at?: string | null;
          superseded_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["condition_evaluations"]["Insert"]>;
      };
      condition_evidence_regions: {
        Row: {
          id: string;
          condition_evaluation_id: string;
          evidence_region_id: string | null;
          organization_id: string;
          project_id: string;
          relationship_type: ConditionEvidenceRelationship;
          created_at: string;
        };
        Insert: {
          id?: string;
          condition_evaluation_id: string;
          evidence_region_id?: string | null;
          organization_id: string;
          project_id: string;
          relationship_type: ConditionEvidenceRelationship;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["condition_evidence_regions"]["Insert"]>;
      };
      compliance_reviews: {
        Row: {
          id: string;
          organization_id: string | null;
          project_id: string;
          title: string;
          review_scope: string | null;
          status:
            | "draft"
            | "ready"
            | "running"
            | "completed"
            | "failed"
            | "human_review_pending"
            | "awaiting_human_review"
            | "approved"
            | "cancelled"
            | "superseded";
          ai_model: string | null;
          review_version: number;
          source_hash: string | null;
          extraction_version: string | null;
          prompt_version: string | null;
          started_at: string | null;
          completed_at: string | null;
          failed_at: string | null;
          annotation_ready: boolean;
          annotation_ready_at: string | null;
          annotation_ready_by: string | null;
          annotation_blockers: Json | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          project_id: string;
          title: string;
          review_scope?: string | null;
          status?:
            | "draft"
            | "ready"
            | "running"
            | "completed"
            | "failed"
            | "human_review_pending"
            | "awaiting_human_review"
            | "approved"
            | "cancelled"
            | "superseded";
          ai_model?: string | null;
          review_version?: number;
          source_hash?: string | null;
          extraction_version?: string | null;
          prompt_version?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          failed_at?: string | null;
          annotation_ready?: boolean;
          annotation_ready_at?: string | null;
          annotation_ready_by?: string | null;
          annotation_blockers?: Json | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["compliance_reviews"]["Insert"]>;
      };
      compliance_findings: {
        Row: {
          id: string;
          organization_id: string | null;
          review_id: string;
          project_id: string;
          requirement_id: string | null;
          evidence_id: string | null;
          clause_number: string | null;
          sub_clause_number: string | null;
          requirement_text: string;
          evidence_text: string | null;
          status: ComplianceStatus;
          ai_derived_status: ComplianceStatus | null;
          deterministic_derived_status: ComplianceStatus | null;
          weightage_score: number;
          confidence_score: number;
          reasoning: string;
          missing_information: string | null;
          contractor_action: string | null;
          risk_level: RiskLevel;
          human_override_status: ComplianceStatus | null;
          human_comment: string | null;
          reviewer_comment: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          annotation_ready: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          review_id: string;
          project_id: string;
          requirement_id?: string | null;
          evidence_id?: string | null;
          clause_number?: string | null;
          sub_clause_number?: string | null;
          requirement_text: string;
          evidence_text?: string | null;
          status: ComplianceStatus;
          ai_derived_status?: ComplianceStatus | null;
          deterministic_derived_status?: ComplianceStatus | null;
          weightage_score: number;
          confidence_score: number;
          reasoning: string;
          missing_information?: string | null;
          contractor_action?: string | null;
          risk_level: RiskLevel;
          human_override_status?: ComplianceStatus | null;
          human_comment?: string | null;
          reviewer_comment?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          annotation_ready?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["compliance_findings"]["Insert"]>;
      };
      contractor_clarifications: {
        Row: {
          id: string;
          review_id: string;
          project_id: string;
          finding_id: string | null;
          clause_number: string | null;
          issue: string;
          why_it_matters: string;
          required_action: string;
          required_document: string;
          priority: "Critical" | "High" | "Medium" | "Low";
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          review_id: string;
          project_id: string;
          finding_id?: string | null;
          clause_number?: string | null;
          issue: string;
          why_it_matters: string;
          required_action: string;
          required_document: string;
          priority: "Critical" | "High" | "Medium" | "Low";
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["contractor_clarifications"]["Insert"]>;
      };
      evidence_regions: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string;
          document_id: string;
          page_number: number | null;
          slide_number: number | null;
          sheet_name: string | null;
          cell_range: string | null;
          region_type: EvidenceRegionType;
          x: number | null;
          y: number | null;
          width: number | null;
          height: number | null;
          normalized_x: number | null;
          normalized_y: number | null;
          normalized_width: number | null;
          normalized_height: number | null;
          coordinate_system: CoordinateSystem;
          extracted_text: string | null;
          extraction_confidence: number;
          extraction_method: string | null;
          job_id: string | null;
          extraction_version: string | null;
          source_hash: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id: string;
          document_id: string;
          page_number?: number | null;
          slide_number?: number | null;
          sheet_name?: string | null;
          cell_range?: string | null;
          region_type: EvidenceRegionType;
          x?: number | null;
          y?: number | null;
          width?: number | null;
          height?: number | null;
          normalized_x?: number | null;
          normalized_y?: number | null;
          normalized_width?: number | null;
          normalized_height?: number | null;
          coordinate_system: CoordinateSystem;
          extracted_text?: string | null;
          extraction_confidence: number;
          extraction_method?: string | null;
          job_id?: string | null;
          extraction_version?: string | null;
          source_hash: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["evidence_regions"]["Insert"]>;
      };
      finding_evidence_regions: {
        Row: {
          finding_id: string;
          evidence_region_id: string;
          organization_id: string;
          project_id: string;
          relationship_type: FindingEvidenceRelationshipType;
          created_at: string;
        };
        Insert: {
          finding_id: string;
          evidence_region_id: string;
          organization_id: string;
          project_id: string;
          relationship_type?: FindingEvidenceRelationshipType;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["finding_evidence_regions"]["Insert"]>;
      };
      document_annotations: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string;
          review_id: string;
          finding_id: string;
          document_id: string;
          evidence_region_id: string;
          source_requirement_document_id: string | null;
          requirement_condition_id: string | null;
          condition_evaluation_id: string | null;
          page_number: number;
          annotation_type: AnnotationType;
          status: AnnotationStatus;
          label: string;
          comment: string | null;
          source_reference: string;
          clause_number: string | null;
          sub_clause_number: string | null;
          compliance_status: ComplianceStatus;
          matched_condition: string | null;
          exact_evidence_text: string | null;
          concise_result: string | null;
          reasoning: string;
          missing_information: string | null;
          contractor_action: string | null;
          x: number;
          y: number;
          width: number;
          height: number;
          coordinate_system: CoordinateSystem;
          connector_target_region_id: string | null;
          style_metadata: Json;
          is_ai_generated: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id: string;
          review_id: string;
          finding_id: string;
          document_id: string;
          evidence_region_id: string;
          source_requirement_document_id?: string | null;
          requirement_condition_id?: string | null;
          condition_evaluation_id?: string | null;
          page_number: number;
          annotation_type: AnnotationType;
          status?: AnnotationStatus;
          label: string;
          comment?: string | null;
          source_reference: string;
          clause_number?: string | null;
          sub_clause_number?: string | null;
          compliance_status: ComplianceStatus;
          matched_condition?: string | null;
          exact_evidence_text?: string | null;
          concise_result?: string | null;
          reasoning: string;
          missing_information?: string | null;
          contractor_action?: string | null;
          x: number;
          y: number;
          width: number;
          height: number;
          coordinate_system?: CoordinateSystem;
          connector_target_region_id?: string | null;
          style_metadata?: Json;
          is_ai_generated?: boolean;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["document_annotations"]["Insert"]>;
      };
      annotation_revisions: {
        Row: {
          id: string;
          annotation_id: string;
          organization_id: string;
          project_id: string;
          revision_number: number;
          previous_payload: Json;
          new_payload: Json;
          changed_by: string;
          changed_at: string;
        };
        Insert: {
          id?: string;
          annotation_id: string;
          organization_id: string;
          project_id: string;
          revision_number: number;
          previous_payload: Json;
          new_payload: Json;
          changed_by: string;
          changed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["annotation_revisions"]["Insert"]>;
      };
      annotation_approvals: {
        Row: {
          id: string;
          annotation_id: string;
          organization_id: string;
          project_id: string;
          approval_status: AnnotationApprovalStatus;
          reviewer_id: string | null;
          reviewer_comment: string | null;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          annotation_id: string;
          organization_id: string;
          project_id: string;
          approval_status?: AnnotationApprovalStatus;
          reviewer_id?: string | null;
          reviewer_comment?: string | null;
          reviewed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["annotation_approvals"]["Insert"]>;
      };
      organization_ai_settings: {
        Row: {
          organization_id: string;
          ai_enabled: boolean;
          consent_granted_at: string | null;
          consent_granted_by: string | null;
          consent_document_version: string | null;
          default_provider: AiProvider | null;
          enabled_providers: AiProvider[];
          model_routes: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          ai_enabled?: boolean;
          consent_granted_at?: string | null;
          consent_granted_by?: string | null;
          consent_document_version?: string | null;
          default_provider?: AiProvider | null;
          enabled_providers?: AiProvider[];
          model_routes?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organization_ai_settings"]["Insert"]>;
      };
      ai_runs: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string;
          review_id: string | null;
          document_id: string | null;
          task_type: AiTaskType;
          provider: AiProvider;
          model: string;
          prompt_version: string;
          provider_run_id: string | null;
          input_hash: string;
          status: AiRunStatus;
          started_at: string | null;
          completed_at: string | null;
          latency_ms: number | null;
          input_tokens: number | null;
          output_tokens: number | null;
          estimated_cost: number | null;
          validation_status: AiValidationStatus;
          verification_status: AiVerificationStatus;
          error_code: string | null;
          error_message: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id: string;
          review_id?: string | null;
          document_id?: string | null;
          task_type: AiTaskType;
          provider: AiProvider;
          model: string;
          prompt_version: string;
          provider_run_id?: string | null;
          input_hash: string;
          status?: AiRunStatus;
          started_at?: string | null;
          completed_at?: string | null;
          latency_ms?: number | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          estimated_cost?: number | null;
          validation_status?: AiValidationStatus;
          verification_status?: AiVerificationStatus;
          error_code?: string | null;
          error_message?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_runs"]["Insert"]>;
      };
      processing_jobs: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string | null;
          document_id: string | null;
          review_id: string | null;
          job_type:
            | "document_extraction"
            | "ocr"
            | "page_rendering"
            | "table_extraction"
            | "image_region_detection"
            | "embedding_generation"
            | "requirement_extraction"
            | "requirement_decomposition"
            | "evidence_extraction"
            | "condition_evidence_retrieval"
            | "condition_evaluation"
            | "parent_finding_derivation"
            | "standards_applicability"
            | "compliance_review"
            | "reviewer_check"
            | "evidence_region_mapping"
            | "annotation_generation"
            | "annotation_comment_generation"
            | "report_generation";
          status: ProcessingStatus;
          progress: number;
          error_message: string | null;
          metadata: Json;
          priority: number;
          attempts: number;
          maximum_attempts: number;
          available_at: string;
          locked_at: string | null;
          locked_by: string | null;
          worker_id: string | null;
          heartbeat_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          failed_at: string | null;
          last_error_code: string | null;
          safe_error_message: string | null;
          extraction_version: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id?: string | null;
          document_id?: string | null;
          review_id?: string | null;
          job_type:
            | "document_extraction"
            | "ocr"
            | "page_rendering"
            | "table_extraction"
            | "image_region_detection"
            | "embedding_generation"
            | "requirement_extraction"
            | "requirement_decomposition"
            | "evidence_extraction"
            | "condition_evidence_retrieval"
            | "condition_evaluation"
            | "parent_finding_derivation"
            | "standards_applicability"
            | "compliance_review"
            | "reviewer_check"
            | "evidence_region_mapping"
            | "annotation_generation"
            | "annotation_comment_generation"
            | "report_generation";
          status?: ProcessingStatus;
          progress?: number;
          error_message?: string | null;
          metadata?: Json;
          priority?: number;
          attempts?: number;
          maximum_attempts?: number;
          available_at?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          worker_id?: string | null;
          heartbeat_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          failed_at?: string | null;
          last_error_code?: string | null;
          safe_error_message?: string | null;
          extraction_version?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["processing_jobs"]["Insert"]>;
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string | null;
          user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id?: string | null;
          user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Insert"]>;
      };
      annotation_outputs: {
        Row: {
          id: string;
          organization_id: string;
          project_id: string;
          review_id: string;
          source_document_id: string;
          source_hash: string;
          output_storage_path: string;
          output_hash: string;
          page_count: number;
          annotation_count: number;
          renderer_version: string;
          contract_version: string;
          draft_status: "draft" | "approved" | "superseded";
          finding_ids: Json;
          warnings: Json;
          approved_by: string | null;
          approved_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          project_id: string;
          review_id: string;
          source_document_id: string;
          source_hash: string;
          output_storage_path: string;
          output_hash: string;
          page_count: number;
          annotation_count?: number;
          renderer_version: string;
          contract_version: string;
          draft_status?: "draft" | "approved" | "superseded";
          finding_ids?: Json;
          warnings?: Json;
          approved_by?: string | null;
          approved_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["annotation_outputs"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
