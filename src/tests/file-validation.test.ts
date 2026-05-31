import { describe, expect, it } from "vitest";
import { sanitizeFileName, validateUploadFile } from "@/lib/security/file-validation";

describe("validateUploadFile", () => {
  it("accepts supported document formats", () => {
    expect(
      validateUploadFile({
        fileName: "technical-specification.pdf",
        mimeType: "application/pdf",
        fileSize: 1024
      }).valid
    ).toBe(true);
  });

  it("rejects unsupported extensions", () => {
    expect(
      validateUploadFile({
        fileName: "script.exe",
        mimeType: "application/octet-stream",
        fileSize: 1024
      }).valid
    ).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("removes unsafe characters and normalizes spaces", () => {
    expect(sanitizeFileName("Tender Spec #1 (Final).pdf")).toBe("Tender-Spec-1-Final.pdf");
  });
});
