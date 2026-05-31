"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, FileQuestion, FileSearch, Send, ShieldCheck, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ProjectDocumentChatProps = {
  projectId: string;
  disabled?: boolean;
};

type ChatPayload = {
  error?: string;
  data?: {
    answer: string;
    verificationStatus: "verified_review" | "review_summary" | "verified_source" | "not_found";
    interpretedQuestion?: string;
    sources: Array<{
      documentName: string;
      pageNumber: number;
      clauseNumber: string | null;
      quote: string;
    }>;
  };
};

const suggestedQuestions = [
  {
    label: "Decision",
    question: "Why is the recommendation rejected?",
    icon: AlertCircle
  },
  {
    label: "Contractor actions",
    question: "Show critical contractor clarifications.",
    icon: ClipboardList
  },
  {
    label: "Open issues",
    question: "List not complied items.",
    icon: FileQuestion
  },
  {
    label: "Human review",
    question: "Which findings need human review?",
    icon: UserCheck
  }
];

export function ProjectDocumentChat({ projectId, disabled = false }: ProjectDocumentChatProps) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ChatPayload["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const answerParts = result ? splitAnswer(result.answer) : null;

  function askDocuments(nextQuestion = question) {
    const trimmed = nextQuestion.trim();

    if (trimmed.length < 3) {
      return;
    }

    setQuestion(trimmed);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/chat/project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, question: trimmed })
        });
        const payload = (await response.json().catch(() => ({}))) as ChatPayload;
        setResult(response.ok ? payload.data ?? null : null);
        setError(response.ok ? null : payload.error ?? "Chat failed.");
      } catch {
        setResult(null);
        setError("Chat failed because the server could not be reached.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {suggestedQuestions.map((suggestion) => {
          const Icon = suggestion.icon;

          return (
          <Button
            key={suggestion.label}
            type="button"
            size="sm"
            variant="outline"
            className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
            disabled={disabled || isPending}
            onClick={() => askDocuments(suggestion.question)}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{suggestion.label}</span>
          </Button>
          );
        })}
      </div>

      <div className="rounded-md border bg-white p-2">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
          className="min-h-24 resize-none border-0 p-2 shadow-none focus-visible:ring-0"
          placeholder="Ask about a clause, missing evidence, contractor action, or approval risk."
          disabled={disabled || isPending}
        />
        <div className="flex items-center justify-between border-t pt-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Evidence-only
          </div>
          <Button size="sm" disabled={disabled || isPending || question.trim().length < 3} onClick={() => askDocuments()}>
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {isPending ? "Verifying" : "Ask"}
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {result && answerParts ? (
        <section className="overflow-hidden rounded-md border bg-white">
          <div className="border-b bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <VerificationBadge status={result.verificationStatus} />
              <span className="text-xs text-muted-foreground">
                {result.sources.length} cited source{result.sources.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto p-3">
            <p className="text-sm font-medium leading-6">{answerParts.lead}</p>
            {answerParts.detail ? <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{answerParts.detail}</div> : null}
          </div>
          {result.sources.length > 0 ? (
            <details className="border-t">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Evidence sources</summary>
              <div className="space-y-3 px-3 pb-3">
                {result.sources.map((source, index) => (
                  <div key={`${source.documentName}-${source.pageNumber}-${index}`} className="border-l-2 border-slate-300 pl-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone="gray">{source.documentName}</Badge>
                      <Badge tone="gray">Page {source.pageNumber}</Badge>
                      {source.clauseNumber ? <Badge tone="gray">Clause {source.clauseNumber}</Badge> : null}
                    </div>
                    <p className="mt-2 leading-6 text-muted-foreground">{source.quote}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>
      ) : (
        <div className="rounded-md border border-dashed bg-slate-50/70 p-3 text-sm text-muted-foreground">
          <div className="flex gap-2 leading-6">
            <FileSearch className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>Ask a review question and every answer will return with verification status and cited sources.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function VerificationBadge({ status }: { status: NonNullable<ChatPayload["data"]>["verificationStatus"] }) {
  switch (status) {
    case "verified_review":
      return (
        <Badge tone="green">
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Verified from review
        </Badge>
      );
    case "review_summary":
      return <Badge tone="green">Verified summary</Badge>;
    case "verified_source":
      return <Badge tone="amber">Direct source only</Badge>;
    case "not_found":
      return <Badge tone="gray">Not found</Badge>;
  }
}

function splitAnswer(answer: string) {
  const [lead = "", ...rest] = answer.split(/\n\n+/);

  return {
    lead,
    detail: rest.join("\n\n")
  };
}
