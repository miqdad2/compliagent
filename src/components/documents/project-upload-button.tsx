"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { UploadDrawer } from "./upload-drawer";

type ProjectUploadButtonProps = {
  projectId:  string;
  label?:     string;
  variant?:   "default" | "outline";
  fullWidth?: boolean;
};

/**
 * Compact button that opens the UploadDrawer.
 * Safe to place in any server-rendered component by importing as a client boundary.
 */
export function ProjectUploadButton({
  projectId,
  label     = "Upload document",
  variant   = "outline",
  fullWidth = false
}: ProjectUploadButtonProps) {
  const [open, setOpen] = useState(false);

  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const sizeClass  = "px-3.5 py-2";
  const widthClass = fullWidth ? "w-full" : "";
  const colorClass =
    variant === "default"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border border-slate-200 bg-white hover:bg-slate-50 text-foreground";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${base} ${sizeClass} ${widthClass} ${colorClass}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>

      <UploadDrawer
        projectId={projectId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
