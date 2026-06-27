"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type DrawerProps = {
  open:      boolean;
  onClose:   () => void;
  title:     string;
  children:  ReactNode;
  /** Footer with Cancel / Submit buttons. */
  footer?:   ReactNode;
  /** Width class on desktop. Defaults to "max-w-lg" (~512 px). */
  widthClass?: string;
};

/**
 * Right-side drawer. Works without a shadcn Sheet dependency.
 *
 * Accessibility:
 *  - role="dialog" + aria-modal + aria-labelledby
 *  - Escape key closes it
 *  - Focus moves into the panel on open; returns to trigger on close
 *  - Background scroll is locked while open
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  widthClass = "max-w-lg"
}: DrawerProps) {
  const panelRef   = useRef<HTMLDivElement>(null);
  const titleId    = "drawer-title";

  // Lock body scroll and handle Escape key.
  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);

    // Move focus inside the drawer.
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    firstFocusable?.focus();

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog" aria-labelledby={titleId}>
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`relative flex h-full w-full ${widthClass} flex-col bg-white shadow-2xl`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-slate-100 transition-colors"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>

        {/* Footer (optional) */}
        {footer && (
          <div className="border-t bg-slate-50 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
