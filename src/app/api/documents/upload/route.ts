import { NextResponse } from "next/server";
import { documentMetadataSchema } from "@/lib/db/schemas";
import { documentRoleLabels } from "@/lib/documents/roles";
import { canUploadDocument } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { sanitizeFileName, validateUploadFile } from "@/lib/security/file-validation";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { documentRoles } from "@/types/domain";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase is not configured." }, { status: 500 });
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load user profile." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required before uploading documents." }, { status: 401 });
  }

  if (!canUploadDocument(profile.role)) {
    return NextResponse.json({ error: "You do not have permission to upload documents." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const projectId = String(formData.get("projectId") ?? "");
  const documentRole = String(formData.get("documentRole") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was provided." }, { status: 400 });
  }

  if (!documentRoles.includes(documentRole as (typeof documentRoles)[number])) {
    return NextResponse.json({ error: "A valid document role is required." }, { status: 400 });
  }

  const parsedMetadata = documentMetadataSchema.safeParse({
    projectId,
    documentRole,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size
  });

  if (!parsedMetadata.success) {
    return NextResponse.json({ error: "Document metadata is invalid." }, { status: 400 });
  }

  const validation = validateUploadFile({
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size
  });

  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project was not found or is not accessible." }, { status: 404 });
  }

  if (project.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this project." }, { status: 403 });
  }

  const documentId = crypto.randomUUID();
  const safeName = sanitizeFileName(file.name);
  const storagePath = `organizations/${profile.organization_id}/projects/${projectId}/documents/${documentId}/original/${safeName}`;
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET_DOCUMENTS || "documents";

  const { error: uploadError } = await supabase.storage.from(bucketName).upload(storagePath, file, {
    contentType: file.type,
    upsert: false
  });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      id: documentId,
      project_id: projectId,
      organization_id: profile.organization_id,
      file_name: safeName,
      storage_path: storagePath,
      mime_type: file.type,
      file_size: file.size,
      document_role: parsedMetadata.data.documentRole,
      created_by: profile.id,
      processing_status: "queued"
    })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from(bucketName).remove([storagePath]);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await supabase.from("audit_logs").insert({
    organization_id: profile.organization_id,
    project_id: projectId,
    user_id: profile.id,
    action: "document_uploaded",
    entity_type: "document",
    entity_id: documentId,
    metadata: { fileName: safeName, documentRoleLabel: documentRoleLabels[parsedMetadata.data.documentRole] }
  });

  return NextResponse.json({ data }, { status: 201 });
}
