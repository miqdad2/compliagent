import { Check, Circle } from "lucide-react";

export type StepStatus = "complete" | "current" | "pending" | "blocked";

export type WorkflowStep = {
  id:     string;
  label:  string;
  status: StepStatus;
};

type WorkflowStepperProps = {
  steps: WorkflowStep[];
};

const stepColor: Record<StepStatus, string> = {
  complete: "bg-emerald-500 text-white border-emerald-500",
  current:  "bg-primary text-primary-foreground border-primary",
  pending:  "bg-white text-slate-400 border-slate-200",
  blocked:  "bg-white text-red-400 border-red-200"
};

const labelColor: Record<StepStatus, string> = {
  complete: "text-emerald-700",
  current:  "text-primary font-semibold",
  pending:  "text-muted-foreground",
  blocked:  "text-red-600"
};

const lineColor: Record<StepStatus, string> = {
  complete: "bg-emerald-300",
  current:  "bg-slate-200",
  pending:  "bg-slate-200",
  blocked:  "bg-slate-200"
};

export function WorkflowStepper({ steps }: WorkflowStepperProps) {
  return (
    <nav aria-label="Review workflow progress">
      <ol className="flex items-center gap-0">
        {steps.map((step, idx) => (
          <li key={step.id} className="flex items-center min-w-0">
            {/* Step node */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${stepColor[step.status]}`}
                aria-label={`Step ${idx + 1}: ${step.label} — ${step.status}`}
              >
                {step.status === "complete" ? (
                  <Check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Circle className="h-2 w-2 fill-current" aria-hidden="true" />
                )}
              </div>
              <span className={`mt-1 text-[10px] whitespace-nowrap hidden sm:block ${labelColor[step.status]}`}>
                {step.label}
              </span>
            </div>
            {/* Connector line */}
            {idx < steps.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 sm:mx-2 ${lineColor[step.status]}`} aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
