-- Controlled technical review pipeline — Part 1: new enum values only.
--
-- PostgreSQL cannot use a newly-added enum label in the same transaction
-- that added it (error 55P04). This file adds the enum values and commits
-- them. All other schema changes are in 20260628000001_*.
--
-- Apply this file first, then apply 20260628000001_*.

-- ============================================================
-- 1. New document_role enum values
-- ============================================================
-- Additive: existing values remain valid for backward compatibility.

alter type public.document_role add value if not exists 'specification';
alter type public.document_role add value if not exists 'contractor_submission';
alter type public.document_role add value if not exists 'calculation';
alter type public.document_role add value if not exists 'method_statement';
alter type public.document_role add value if not exists 'test_report';
alter type public.document_role add value if not exists 'correspondence';

-- ============================================================
-- 2. New review_status enum values
-- ============================================================
-- Additive: existing values (draft, running, completed, failed,
-- human_review_pending, approved) remain valid.

alter type public.review_status add value if not exists 'ready';
alter type public.review_status add value if not exists 'awaiting_human_review';
alter type public.review_status add value if not exists 'cancelled';
alter type public.review_status add value if not exists 'superseded';
