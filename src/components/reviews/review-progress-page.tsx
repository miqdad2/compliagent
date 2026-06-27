"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const MODE_LABEL: Record<string, string> = {
  deterministic:   "Deterministic review",
  mock:            "Test review",
  controlled_live: "AI-assisted review"
};

const STAGES = [
  "Preparing documents",
  "Discovering requirements",
  "Checking evidence",
  "Evaluating compliance",
  "Preparing findings"
] as const;

type ReviewProgressPageProps = {
  reviewId:      string;
  projectId:     string;
  reviewTitle:   string;
  reviewStatus:  string;
  executionMode: string;
};

export function ReviewProgressPage({
  reviewId, projectId, reviewTitle, reviewStatus, executionMode
}: ReviewProgressPageProps) {
  const router = useRouter();
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError]           = useState<string | null>(null);
  const [retryable, setRetryable]   = useState(false);
  const [started, setStarted]       = useState(false);
  const hasTriggered = useRef(false);

  // Cycle through stage labels every few seconds while running.
  useEffect(() => {
    if (error) return;
    const interval = setInterval(() => {
      setStageIndex((i) => (i < STAGES.length - 1 ? i + 1 : i));
    }, 4000);
    return () => clearInterval(interval);
  }, [error]);

  // Auto-trigger execution on mount. Only fire once per render cycle.
  useEffect(() => {
    if (hasTriggered.current) return;
    hasTriggered.current = true;

    // If status is already "running" (page refreshed mid-execution), poll for completion.
    if (reviewStatus === "running") {
      void pollForCompletion();
      return;
    }

    // Status is "draft" — trigger execution now.
    void executeReview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function executeReview() {
    setStarted(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" }
      });
      const json = await res.json() as {
        data?: { reviewId?: string; status?: string; alreadyRunning?: boolean; complete?: boolean };
        error?: string;
        retryable?: boolean;
      };
      if (!res.ok) {
        setError(json.error ?? "The review could not be started.");
        setRetryable(json.retryable ?? false);
        return;
      }
      // Success — navigate to the workspace.
      router.replace(`/projects/${projectId}/reviews/${reviewId}`);
      router.refresh();
    } catch {
      setError("Network error while starting the review. The server may still be processing.");
      setRetryable(true);
    }
  }

  async function pollForCompletion() {
    setStarted(true);
    // Poll the review status every 5 seconds until it leaves "running".
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
    // Timed out — refresh the page so server re-evaluates status.
    router.refresh();
  }

  function handleRetry() {
    hasTriggered.current = false;
    setError(null);
    setRetryable(false);
    setStageIndex(0);
    void executeReview();
  }

  const modeLabel = MODE_LABEL[executionMode] ?? executionMode.replace(/_/g, " ");

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
          <p className="text-xs text-muted-foreground mt-0.5">{modeLabel}</p>
        </div>

        {!error ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
              <div>
                <p className="text-sm font-medium">Running automated technical review</p>
                <p className="text-xs text-muted-foreground">This checks each clause systematically and may take a minute.</p>
              </div>
            </div>

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
                <Button
                  onClick={handleRetry}
                  className="gap-2"
                  disabled={started && !error}
                >
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
