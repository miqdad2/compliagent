import { cn } from "@/lib/utils";

type BadgeTone = "default" | "green" | "amber" | "red" | "purple" | "gray";

const toneClasses: Record<BadgeTone, string> = {
  default: "bg-primary/10 text-primary",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  purple: "bg-purple-50 text-purple-700",
  gray: "bg-slate-100 text-slate-700"
};

export function Badge({
  className,
  tone = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-1 text-xs font-medium", toneClasses[tone], className)}
      {...props}
    />
  );
}
