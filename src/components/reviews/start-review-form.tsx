"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ExecutionMode = "deterministic" | "mock" | "controlled_live";

const MODES: Array<{
  value:       ExecutionMode;
  label:       string;
  description: string;
  available:   boolean;
  tone:        "green" | "blue" | "gray";
}> = [
  {
    value:       "deterministic",
    label:       "Deterministic",
    description: "Numeric and evidence-presence checks only. No external AI calls. Fast and fully auditable.",
    available:   true,
    tone:        "green"
  },
  {
    value:       "mock",
    label:       "Test review",
    description: "Runs the full pipeline with deterministic mock AI responses. No external network calls. For testing.",
    available:   true,
    tone:        "blue"
  },
  {
    value:       "controlled_live",
    label:       "AI-assisted review",
    description: "Uses a real AI provider with organization consent. Requires configured credentials.",
    available:   false,  // overridden by prop
    tone:        "gray"
  }
];

type StartReviewFormProps = {
  projectId:       string;
  canStart:        boolean;
  liveAiAvailable: boolean;
};

export function StartReviewForm({ projectId, canStart, liveAiAvailable }: StartReviewFormProps) {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState<ExecutionMode>("deterministic");
  const [title, setTitle] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modes = MODES.map((m) =>
    m.value === "controlled_live" ? { ...m, available: liveAiAvailable } : m
  );

  async function handleStart() {
    if (!canStart || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews/controlled", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          projectId,
          executionMode: selectedMode,
          reviewTitle:   title.trim() || undefined
        })
      });
      const json = await res.json() as {
        data?: { reviewId?: string; redirectUrl?: string; reused?: boolean };
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not start review. Please try again.");
        return;
      }
      const redirectUrl = json.data?.redirectUrl ?? `/projects/${projectId}`;
      // Navigate immediately — execution happens on the workspace progress page.
      router.push(redirectUrl);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {modes.map((mode) => (
          <label
            key={mode.value}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              !mode.available ? "opacity-50 cursor-not-allowed" : ""
            } ${selectedMode === mode.value ? "border-blue-300 bg-blue-50" : "hover:bg-slate-50"}`}
          >
            <input
              type="radio"
              name="executionMode"
              value={mode.value}
              checked={selectedMode === mode.value}
              onChange={() => mode.available && setSelectedMode(mode.value)}
              disabled={!mode.available}
              className="mt-0.5 h-4 w-4 accent-blue-600"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{mode.label}</span>
                {mode.available ? (
                  <Badge tone={mode.tone}>Available</Badge>
                ) : (
                  <Badge tone="gray">Unavailable</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{mode.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Review title (optional)</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Auto-generated if blank"
          maxLength={200}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        onClick={() => void handleStart()}
        disabled={!canStart || isStarting}
        className="w-full gap-2"
      >
        <PlayCircle className="h-4 w-4" />
        {isStarting ? "Creating review…" : "Run automated technical review"}
      </Button>

      <p className="text-xs text-muted-foreground">
        You will be taken to the review workspace. The automated check runs in the background and may take a minute.
      </p>
    </div>
  );
}
