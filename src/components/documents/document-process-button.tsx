"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";

type DocumentProcessButtonProps = {
  documentId: string;
  label?: string;
};

export function DocumentProcessButton({ documentId, label = "Process" }: DocumentProcessButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            try {
              const response = await fetch(`/api/documents/${documentId}/process`, { method: "POST" });
              const payload = (await response.json().catch(() => ({}))) as { error?: string; data?: { message?: string } };
              setMessage(response.ok ? payload.data?.message ?? "Processing completed." : payload.error ?? "Processing failed.");
              router.refresh();
            } catch {
              setMessage("Processing failed because the server could not be reached.");
            }
          });
        }}
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        {isPending ? "Processing" : label}
      </Button>
      {message ? <p className="max-w-48 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
