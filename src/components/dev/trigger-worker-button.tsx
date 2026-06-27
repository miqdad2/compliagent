"use client";

import { useState, useTransition } from "react";

type WorkerResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export function TriggerWorkerButton() {
  const [result, setResult] = useState<WorkerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function trigger() {
    setResult(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/dev/processing/run-worker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: 10 })
        });
        const json = (await res.json().catch(() => ({}))) as {
          data?: WorkerResult;
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? `Worker returned ${res.status}.`);
          return;
        }
        setResult(json.data ?? { processed: 0, succeeded: 0, failed: 0, skipped: 0 });
      } catch {
        setError("Network error. Could not reach the worker endpoint.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <button
        onClick={trigger}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? (
          <>
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-hidden="true" />
            Running…
          </>
        ) : (
          "Trigger document processing"
        )}
      </button>

      {result && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p className="font-medium">Worker completed</p>
          <ul className="mt-1 list-disc list-inside text-green-800 space-y-0.5">
            <li>Processed: {result.processed}</li>
            <li>Succeeded: {result.succeeded}</li>
            <li>Failed: {result.failed}</li>
            <li>Skipped: {result.skipped}</li>
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
