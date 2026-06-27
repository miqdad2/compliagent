"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle, Loader2 } from "lucide-react";

type RunAutomatedReviewResponse = {
  data?: {
    reviewId:         string;
    status:           string;
    redirectUrl:      string;
    enqueuedDocCount?: number;
    reused?:          boolean;
  };
  error?: string;
};

type Props = {
  projectId: string;
  label?:    string;
  variant?:  "primary" | "compact" | "full-width";
};

/**
 * One-click button that calls POST /api/projects/[projectId]/run-automated-review,
 * then navigates to the returned redirectUrl (the project-level progress page).
 *
 * Used in the project header, overview tab, review tab, and side panel.
 */
export function RunReviewButton({ projectId, label = "Run automated review", variant = "primary" }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/projects/${projectId}/run-automated-review`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" }
      });
      const json = await res.json() as RunAutomatedReviewResponse;
      if (!res.ok || !json.data?.redirectUrl) {
        setError(json.error ?? "Could not start the review. Please try again.");
        setLoading(false);
        return;
      }
      router.push(json.data.redirectUrl);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  const baseClass =
    variant === "full-width"
      ? "flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
      : variant === "compact"
        ? "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-60"
        : "inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60";

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={baseClass}
      >
        {loading
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          : <PlayCircle className="h-4 w-4" aria-hidden="true" />}
        {loading ? "Starting…" : label}
      </button>
      {error && (
        <p className="text-xs text-red-600 mt-1.5">{error}</p>
      )}
    </div>
  );
}
