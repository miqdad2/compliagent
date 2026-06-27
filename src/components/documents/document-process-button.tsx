"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type DocumentProcessButtonProps = {
  documentId: string;
  label?:     string;
  disabled?:  boolean;
  hint?:      string;
};

/**
 * Process / Reprocess button scoped to a single document.
 *
 * Loading state is tracked with a local `isSubmitting` boolean rather than
 * React's useTransition so that only THIS button shows the pending state,
 * even if router.refresh() is called (which marks all useTransition instances
 * as pending simultaneously).
 */
export function DocumentProcessButton({
  documentId,
  label   = "Process",
  disabled = false,
  hint
}: DocumentProcessButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message,      setMessage]      = useState<string | null>(null);
  const router = useRouter();

  const isReprocess = label === "Reprocess";
  const Icon        = isReprocess ? RefreshCw : Play;

  async function handleClick() {
    if (isSubmitting || disabled) return;
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/documents/${documentId}/process`, {
        method: "POST"
      });

      const payload = await response.json().catch(() => ({})) as {
        error?:     string;
        retryable?: boolean;
        data?:      { message?: string };
      };

      if (response.ok) {
        // Best-effort: trigger the dev worker if available (no-op in production).
        fetch("/api/dev/processing/run-worker", { method: "POST" }).catch(() => {});
        setMessage("Queued for processing.");
        router.refresh();
      } else {
        const msg = payload.error ?? "Processing request failed.";
        setMessage(payload.retryable ? `${msg} You can try again.` : msg);
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || isSubmitting}
        onClick={() => void handleClick()}
      >
        <Icon
          className={`h-3.5 w-3.5 ${isSubmitting ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        {isSubmitting ? "Submitting…" : label}
      </Button>
      {(message ?? hint) ? (
        <p
          className="max-w-64 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {message ?? hint}
        </p>
      ) : null}
    </div>
  );
}
