"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocumentRoleSelect } from "./document-role-select";

type DocumentUploadFormProps = {
  projectId: string;
  embedded?: boolean;
};

export function DocumentUploadForm({ projectId, embedded = false }: DocumentUploadFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const formData = new FormData(formElement);
        formData.set("projectId", projectId);
        setMessage(null);

        startTransition(async () => {
          try {
            const response = await fetch("/api/documents/upload", {
              method: "POST",
              body: formData
            });
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            setMessage(response.ok ? "Document uploaded and queued for processing." : payload.error ?? "Upload failed.");
            if (response.ok) {
              formElement.reset();
              router.refresh();
            }
          } catch {
            setMessage("Upload failed because the server could not be reached.");
          }
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="space-y-2">
          <Label htmlFor="file">Document</Label>
          <Input id="file" name="file" required type="file" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="documentRole">Document role</Label>
          <DocumentRoleSelect />
        </div>
      </div>
      <Button className="w-full sm:w-auto" disabled={isPending} type="submit">
        <UploadCloud className="h-4 w-4" aria-hidden="true" />
        {isPending ? "Uploading..." : "Upload document"}
      </Button>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </form>
  );

  if (embedded) {
    return form;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload documents</CardTitle>
        <CardDescription>Assign each file a role so extraction and review agents understand its purpose.</CardDescription>
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  );
}
