import type { ComplianceStatus, DocumentRole, ProcessingStatus, ProjectStatus, RiskLevel, UserRole } from "./domain";

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
      compliance_reviews: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          review_scope: string | null;
          status: "draft" | "running" | "completed" | "failed" | "human_review_pending" | "approved";
          ai_model: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          title: string;
          review_scope?: string | null;
          status?: "draft" | "running" | "completed" | "failed" | "human_review_pending" | "approved";
          ai_model?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["compliance_reviews"]["Insert"]>;
      };
      compliance_findings: {
        Row: {
          id: string;
          review_id: string;
          project_id: string;
          requirement_id: string | null;
          evidence_id: string | null;
          clause_number: string | null;
          sub_clause_number: string | null;
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
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          review_id: string;
          project_id: string;
          requirement_id?: string | null;
          evidence_id?: string | null;
          clause_number?: string | null;
          sub_clause_number?: string | null;
          requirement_text: string;
          evidence_text?: string | null;
          status: ComplianceStatus;
          weightage_score: number;
          confidence_score: number;
          reasoning: string;
          missing_information?: string | null;
          contractor_action?: string | null;
          risk_level: RiskLevel;
          human_override_status?: ComplianceStatus | null;
          human_comment?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
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
            | "table_extraction"
            | "embedding_generation"
            | "requirement_extraction"
            | "evidence_extraction"
            | "standards_applicability"
            | "compliance_review"
            | "reviewer_check"
            | "report_generation";
          status: ProcessingStatus;
          progress: number;
          error_message: string | null;
          metadata: Json;
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
            | "table_extraction"
            | "embedding_generation"
            | "requirement_extraction"
            | "evidence_extraction"
            | "standards_applicability"
            | "compliance_review"
            | "reviewer_check"
            | "report_generation";
          status?: ProcessingStatus;
          progress?: number;
          error_message?: string | null;
          metadata?: Json;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
