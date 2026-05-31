"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ProjectDeleteButtonProps = {
  projectId: string;
  projectName: string;
};

export function ProjectDeleteButton({ projectId, projectName }: ProjectDeleteButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={isPending}
        onClick={() => {
          const confirmed = window.confirm(
            `Delete "${projectName}" from the active project register? This archives the project and keeps audit records.`
          );

          if (!confirmed) {
            return;
          }

          setMessage(null);
          startTransition(async () => {
            try {
              const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
              const payload = (await response.json().catch(() => ({}))) as { error?: string };

              if (!response.ok) {
                setMessage(payload.error ?? "Project could not be deleted.");
                return;
              }

              router.refresh();
            } catch {
              setMessage("Project could not be deleted because the server could not be reached.");
            }
          });
        }}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {isPending ? "Deleting" : "Delete"}
      </Button>
      {message ? <p className="max-w-56 text-xs text-red-700">{message}</p> : null}
    </div>
  );
}
