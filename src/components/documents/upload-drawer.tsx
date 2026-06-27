"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, UploadCloud, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { documentRoleLabels } from "@/lib/documents/roles";
import { documentRoles } from "@/types/domain";

// ── Accepted file types ───────────────────────────────────────────────────────

const ACCEPTED_MIME: Record<string, string> = {
  "application/pdf":                                                                            ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":                   ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":                        ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":                ".pptx"
};
const ACCEPTED_EXTS = Object.values(ACCEPTED_MIME); // [".pdf", ".docx", ".xlsx", ".pptx"]
const MAX_MB        = 50;
const MAX_BYTES     = MAX_MB * 1024 * 1024;

// ── Role descriptions ─────────────────────────────────────────────────────────

const ROLE_DESCRIPTION: Partial<Record<string, string>> = {
  main_specification:   "Primary source of technical and contractual requirements.",
  specification:        "Primary source of technical requirements.",
  reference_standard:   "External standard or regulation referenced by the specification.",
  proposed_product:     "Contractor's proposed product or system submission.",
  contractor_submission:"Contractor's formal submission document.",
  product_datasheet:    "Technical datasheet describing the proposed product.",
  certificate:          "Third-party test certificate or certification.",
  drawing:              "Technical drawing, diagram, or layout.",
  calculation:          "Engineering calculation sheet or analysis.",
  method_statement:     "Method statement from the contractor.",
  test_report:          "Test report or measured performance data.",
  supporting_evidence:  "Additional supporting documentation.",
  correspondence:       "Email, letter, or written communication.",
  manual:               "Installation, operation, or maintenance manual.",
  compliance_statement: "Formal compliance statement.",
  other:                "Other project documentation."
};

// User-friendly labels for the selector (hides internal enum values).
const FRIENDLY_LABELS: Partial<Record<string, string>> = {
  main_specification:   "Main Specification",
  specification:        "Specification",
  reference_standard:   "Reference Standard",
  compliance_statement: "Compliance Statement",
  contractor_submission:"Contractor Submission",
  proposed_product:     "Proposed Product",
  product_datasheet:    "Product Datasheet",
  certificate:          "Certificate",
  drawing:              "Drawing",
  calculation:          "Calculation",
  method_statement:     "Method Statement",
  test_report:          "Test Report",
  supporting_evidence:  "Supporting Evidence",
  correspondence:       "Correspondence",
  manual:               "Manual",
  other:                "Other"
};

function formatBytes(n: number): string {
  if (n < 1024)             return `${n} B`;
  if (n < 1024 * 1024)      return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ACCEPTED_EXTS.includes(ext) && !Object.keys(ACCEPTED_MIME).includes(file.type)) {
    return `Unsupported file type. Upload a PDF, DOCX, XLSX, or PPTX file.`;
  }
  if (file.size > MAX_BYTES) {
    return `File is too large (${formatBytes(file.size)}). Maximum size is ${MAX_MB} MB.`;
  }
  return null;
}

// ── Props / public API ────────────────────────────────────────────────────────

type UploadDrawerProps = {
  projectId: string;
  open:      boolean;
  onClose:   () => void;
};

type UploadState = "idle" | "selected" | "uploading" | "success" | "error";

export function UploadDrawer({ projectId, open, onClose }: UploadDrawerProps) {
  const router       = useRouter();
  const inputRef     = useRef<HTMLInputElement>(null);
  const [file,        setFile]        = useState<File | null>(null);
  const [role,        setRole]        = useState("main_specification");
  const [state,       setState]       = useState<UploadState>("idle");
  const [error,       setError]       = useState<string | null>(null);
  const [isDragOver,  setIsDragOver]  = useState(false);

  // ── File selection ──────────────────────────────────────────────────────────

  function pickFile(incoming: File) {
    const err = validateFile(incoming);
    if (err) { setError(err); setFile(null); setState("idle"); return; }
    setFile(incoming);
    setError(null);
    setState("selected");
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) pickFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  function clearFile() {
    setFile(null);
    setState("idle");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  async function handleUpload() {
    if (!file || state === "uploading") return;

    setState("uploading");
    setError(null);

    const formData = new FormData();
    formData.set("file",         file);
    formData.set("documentRole", role);
    formData.set("projectId",    projectId);

    try {
      const res     = await fetch("/api/documents/upload", { method: "POST", body: formData });
      const payload = await res.json().catch(() => ({})) as { error?: string };

      if (res.ok) {
        setState("success");
        router.refresh();
        // Close after a short delay so the user sees the success state.
        setTimeout(() => { handleClose(); }, 1200);
      } else {
        setError(payload.error ?? "Upload failed. Please try again.");
        setState("error");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setState("error");
    }
  }

  function handleClose() {
    clearFile();
    setState("idle");
    setError(null);
    onClose();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isUploading = state === "uploading";
  const isSuccess   = state === "success";

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Upload project document"
      widthClass="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" type="button" onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleUpload()}
            disabled={!file || isUploading || isSuccess}
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            {isUploading ? "Uploading…" : isSuccess ? "Uploaded ✓" : "Upload document"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Assign a review role so extraction and comparison agents understand the document&apos;s purpose.
        </p>

        {/* ── Drop zone ──────────────────────────────────────────────────────── */}
        <div>
          <Label className="mb-2 block text-sm font-medium">File</Label>

          {file ? (
            /* Selected file preview */
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
              <FileText className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground break-all">{file.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={clearFile}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100"
                aria-label="Remove selected file"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            /* Drop zone */
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop zone. Click or drag a file here to upload."
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isDragOver
                  ? "border-primary/60 bg-primary/5"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
              }`}
            >
              <UploadCloud
                className={`h-8 w-8 ${isDragOver ? "text-primary" : "text-muted-foreground/50"}`}
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isDragOver ? "Release to select" : "Drag and drop or click to browse"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, DOCX, XLSX, PPTX · Maximum {MAX_MB} MB
                </p>
              </div>
            </div>
          )}

          {/* Visually-hidden real file input */}
          <input
            ref={inputRef}
            id="upload-file-input"
            name="file"
            type="file"
            accept={ACCEPTED_EXTS.join(",")}
            onChange={onInputChange}
            className="sr-only"
            aria-label="Choose a file to upload"
          />
        </div>

        {/* ── Document role ───────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor="upload-role" className="text-sm font-medium">Document role</Label>
          <Select
            id="upload-role"
            name="documentRole"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-describedby="upload-role-desc"
          >
            {documentRoles.map((r) => (
              <option key={r} value={r}>
                {FRIENDLY_LABELS[r] ?? documentRoleLabels[r]}
              </option>
            ))}
          </Select>
          {ROLE_DESCRIPTION[role] && (
            <p id="upload-role-desc" className="text-xs text-muted-foreground">
              {ROLE_DESCRIPTION[role]}
            </p>
          )}
        </div>

        {/* ── Error message ────────────────────────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* ── Success ──────────────────────────────────────────────────────────── */}
        {isSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          >
            Document uploaded and queued for processing.
          </div>
        )}
      </div>
    </Drawer>
  );
}
