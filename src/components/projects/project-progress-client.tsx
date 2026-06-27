"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const STAGES = [
  "Checking documents",
  "Processing files",
  "Discovering requirements",
  "Searching evidence",
  "Evaluating compliance",
  "Preparing findings"
] as const;

const DOC_STAGE_COUNT = 2; // first two stages belong to document processing

type DocWorkerState = "active" | "queued" | "stalled" | null;

type ProcessingStatusResponse = {
  data?: {
    totalCount:      number;
    processingCount: number;
    completedCount:  number;
    failedCount:     number;
    allDocsReady:    boolean;
    queuedCount:     number;
    claimedCount:    number;
    stalledCount:    number;
  };
  error?: string;
};

type ExecuteResponse = {
  data?: { reviewId?: string; status?: string };
  error?: string;
  retryable?: boolean;
};

type ProjectProgressClientProps = {
  projectId:           string;
  reviewId:            string;
  reviewTitle:         string;
  initialReviewStatus: string;
  initialAllDocsReady: boolean;
};

export function ProjectProgressClient({
  projectId, reviewId, reviewTitle,
  initialReviewStatus, initialAllDocsReady
}: ProjectProgressClientProps) {
  const router = useRouter();
  const [stageIndex, setStageIndex]         = useState(initialAllDocsReady ? DOC_STAGE_COUNT : 0);
  const [error, setError]                   = useState<string | null>(null);
  const [retryable, setRetryable]           = useState(false);
  const [started, setStarted]               = useState(false);
  const [docWorkerState, setDocWorkerState] = useState<DocWorkerState>(null);
  const hasTriggered = useRef(false);

  // Advance stage label every 4 seconds while in the review execution phase.
  useEffect(() => {
    if (error) return;
    const interval = setInterval(() => {
      setStageIndex((i) => {
        if (i < DOC_STAGE_COUNT) return i; // managed by doc polling
        return i < STAGES.length - 1 ? i + 1 : i;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [error]);

  useEffect(() => {
    if (hasTriggered.current) return;
    hasTriggered.current = true;

    if (initialReviewStatus === "running") {
      void pollReviewCompletion();
      return;
    }

    if (initialAllDocsReady) {
      void executeReview();
    } else {
      void pollDocuments();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollDocuments() {
    setStarted(true);
    setStageIndex(1); // "Processing files"

    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      try {
        const res  = await fetch(`/api/projects/${projectId}/processing-status`);
        const json = await res.json() as ProcessingStatusResponse;

        if (json.data) {
          const { queuedCount = 0, claimedCount = 0, stalledCount = 0 } = json.data;

          if (stalledCount > 0) {
            setDocWorkerState("stalled");
          } else if (claimedCount > 0) {
            setDocWorkerState("active");
          } else if (queuedCount > 0) {
            setDocWorkerState("queued");
          } else {
            setDocWorkerState(null);
          }
        }

        if (json.data?.allDocsReady) {
          setStageIndex(DOC_STAGE_COUNT); // advance to review stages
          void executeReview();
          return;
        }
        // If all active processing finished but allDocsReady is still false
        // (e.g., both spec and submission not yet available), still try executing.
        if (json.data && json.data.processingCount === 0) {
          setStageIndex(DOC_STAGE_COUNT);
          void executeReview();
          return;
        }
      } catch {
        // ignore transient fetch errors while polling
      }
    }
    // Timed out waiting for documents.
    setError("Documents are taking too long to process. Please check the document status and retry.");
    setRetryable(true);
  }

  async function executeReview() {
    setStarted(true);
    setError(null);
    try {
      const res  = await fetch(`/api/reviews/${reviewId}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" }
      });
      const json = await res.json() as ExecuteResponse;
      if (!res.ok) {
        setError(json.error ?? "The review could not be started.");
        setRetryable(json.retryable ?? false);
        return;
      }
      // Navigate to the workspace once execution completes.
      router.replace(`/projects/${projectId}/reviews/${reviewId}`);
      router.refresh();
    } catch {
      setError("Network error while starting the review. The server may still be processing.");
      setRetryable(true);
    }
  }

  async function pollReviewCompletion() {
    setStarted(true);
    setStageIndex(DOC_STAGE_COUNT); // skip doc stages
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
      try {
        const res  = await fetch(`/api/reviews/${reviewId}`);
        const json = await res.json() as { data?: { status?: string } };
        const s    = json.data?.status;
        if (s && s !== "running" && s !== "draft") {
          router.replace(`/projects/${projectId}/reviews/${reviewId}`);
          router.refresh();
          return;
        }
      } catch {
        // ignore transient fetch errors while polling
      }
    }
    router.refresh();
  }

  function handleRetry() {
    hasTriggered.current = false;
    setError(null);
    setRetryable(false);
    setDocWorkerState(null);
    setStageIndex(initialAllDocsReady ? DOC_STAGE_COUNT : 0);
    if (initialAllDocsReady) {
      void executeReview();
    } else {
      void pollDocuments();
    }
  }

  function docPhaseHeading(): string {
    if (docWorkerState === "queued")  return "Waiting for the processing worker";
    if (docWorkerState === "stalled") return "Document processing may be stalled";
    return "Preparing documents for review";
  }

  function docPhaseDetail(): string {
    if (docWorkerState === "queued")  return "Jobs are queued. The review starts automatically once the worker processes them.";
    if (docWorkerState === "stalled") return "A worker may have stopped mid-job. Restart the worker to resume.";
    return "Documents are being processed. The review will start automatically.";
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl border shadow-sm p-8 max-w-md w-full space-y-6">

        <div>
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to project
          </Link>
          <h1 className="text-lg font-semibold">{reviewTitle}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Automated technical review</p>
        </div>

        {!error ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  {stageIndex < DOC_STAGE_COUNT
                    ? docPhaseHeading()
                    : "Running automated technical review"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {stageIndex < DOC_STAGE_COUNT
                    ? docPhaseDetail()
                    : "This checks each clause systematically and may take a minute."}
                </p>
              </div>
            </div>

            {/* Worker hint — shown when jobs are queued but no worker is claiming them */}
            {stageIndex < DOC_STAGE_COUNT && docWorkerState === "queued" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-xs font-medium text-amber-800 mb-1">
                  Start the document processing worker:
                </p>
                <code className="text-xs font-mono text-amber-900">
                  pnpm worker:documents:watch
                </code>
              </div>
            )}

            {/* Stalled-job warning */}
            {stageIndex < DOC_STAGE_COUNT && docWorkerState === "stalled" && (
              <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-orange-800">Processing stalled</p>
                  <p className="text-xs text-orange-700 mt-0.5">
                    Restart the worker to resume:{" "}
                    <code className="font-mono">pnpm worker:documents:watch</code>
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {STAGES.map((stage, i) => (
                <div
                  key={stage}
                  className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 transition-colors ${
                    i < stageIndex
                      ? "text-emerald-700 bg-emerald-50"
                      : i === stageIndex
                        ? "text-blue-700 bg-blue-50 font-medium"
                        : "text-muted-foreground"
                  }`}
                >
                  {i < stageIndex ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : i === stageIndex ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-slate-300 shrink-0" />
                  )}
                  {stage}
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              You can leave this page and return later. The review will complete in the background.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Review could not be started</p>
                <p className="text-xs text-red-700 mt-1">{error}</p>
              </div>
            </div>

            <div className="flex gap-2">
              {retryable && (
                <Button onClick={handleRetry} className="gap-2" disabled={started && !error}>
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              )}
              <Link
                href={`/projects/${projectId}`}
                className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Back to project
              </Link>
            </div>
          </div>
        )}

        {!error && started && (
          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground mb-2">If the page doesn&apos;t update automatically:</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.refresh()}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Check for results
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
