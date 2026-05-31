const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/tiff"
]);

const allowedExtensions = new Set(["pdf", "docx", "xlsx", "pptx", "png", "jpg", "jpeg", "tif", "tiff"]);
const maxFileSizeBytes = 100 * 1024 * 1024;

export type FileValidationInput = {
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 180);
}

export function validateUploadFile({ fileName, mimeType, fileSize }: FileValidationInput) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (!allowedExtensions.has(extension)) {
    return { valid: false, reason: "This file type is not supported yet." };
  }

  if (!allowedMimeTypes.has(mimeType)) {
    return { valid: false, reason: "The file MIME type is not supported." };
  }

  if (fileSize > maxFileSizeBytes) {
    return { valid: false, reason: "The file exceeds the 100 MB upload limit." };
  }

  return { valid: true, reason: null };
}
