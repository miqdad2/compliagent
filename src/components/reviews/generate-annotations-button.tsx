"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GenerateAnnotationsButton({ reviewId }: { reviewId: string; projectId: string }) {
  const router  = useRouter();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [result,  setResult]  = useState<{ generated: number; failed: number } | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/annotations`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" }
      });
      const json = await res.json() as { data?: { results?: Array<{ status: string }> }; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Generation failed.");
        return;
      }
      const results = json.data?.results ?? [];
      const generated = results.filter((r) => r.status === "generated").length;
      const failed    = results.filter((r) => r.status === "failed").length;
      setResult({ generated, failed });
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={() => void handleGenerate()}
        disabled={loading}
        className="gap-2"
      >
        <Layers className="h-4 w-4" />
        {loading ? "Generating annotated PDF…" : "Generate annotation draft"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <p className="text-sm text-green-700">
          {result.generated > 0 ? `${result.generated} annotated PDF(s) generated. ` : ""}
          {result.failed > 0 ? `${result.failed} document(s) failed (see warnings above).` : ""}
        </p>
      )}
    </div>
  );
}
