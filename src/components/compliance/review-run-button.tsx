"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ReviewRunButtonProps = {
  projectId: string;
  disabled?: boolean;
  defaultReviewBrief?: string;
};

export function ReviewRunButton({ projectId, disabled = false, defaultReviewBrief = "" }: ReviewRunButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [reviewBrief, setReviewBrief] = useState(defaultReviewBrief);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-3">
      <Button
        disabled={disabled || isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            try {
              const response = await fetch("/api/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId, reviewBrief })
              });
              const payload = (await response.json().catch(() => ({}))) as {
                error?: string;
                data?: { findingCount?: number; recommendation?: string; reviewEngine?: string; aiEnabled?: boolean };
              };

              if (!response.ok) {
                setMessage(payload.error ?? "Review generation failed.");
                return;
              }

              setMessage(
                `Generated ${payload.data?.findingCount ?? 0} finding${payload.data?.findingCount === 1 ? "" : "s"} using ${
                  payload.data?.reviewEngine ?? "the configured review engine"
                }.`
              );
              router.refresh();
            } catch {
              setMessage("Review generation failed because the server could not be reached.");
            }
          });
        }}
      >
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        {isPending ? "Running review" : "Run evidence review"}
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      <details className="rounded-md border bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium">Review scope</summary>
        <Textarea
          className="mt-3"
          value={reviewBrief}
          onChange={(event) => setReviewBrief(event.target.value)}
          rows={7}
          placeholder="Paste the reviewer/client requirements for this project."
        />
      </details>
    </div>
  );
}
