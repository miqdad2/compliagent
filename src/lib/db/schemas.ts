import { z } from "zod";
import { documentRoles, projectStatuses } from "@/types/domain";

export const projectInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  clientName: z.string().trim().min(2).max(160),
  discipline: z.string().trim().min(2).max(120),
  reviewType: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal(""))
});

export const projectUpdateSchema = projectInputSchema.partial().extend({
  status: z.enum(projectStatuses).optional()
});

export const documentMetadataSchema = z.object({
  projectId: z.string().uuid(),
  documentRole: z.enum(documentRoles),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  fileSize: z.number().int().positive(),
  version: z.number().int().positive().default(1)
});

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type DocumentMetadataInput = z.infer<typeof documentMetadataSchema>;
