import type { ReactNode } from "react";

type EmptyStateProps = {
  icon?:    ReactNode;
  title:    string;
  detail?:  string;
  action?:  ReactNode;
};

export function EmptyState({ icon, title, detail, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 mb-4 text-muted-foreground/50">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {detail && (
        <p className="mt-1 text-xs text-muted-foreground/70 max-w-xs">{detail}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
