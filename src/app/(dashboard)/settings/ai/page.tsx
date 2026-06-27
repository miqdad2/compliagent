import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile } from "@/lib/permissions/server";
import { canManageOrganization } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mapOrganizationAiSettings } from "@/server/services/ai/organization-settings";
import { resolveAnthropicKey } from "@/server/services/ai/anthropic-provider";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

/**
 * /settings/ai — AI provider settings transparency page.
 *
 * Admin-only (viewer access shows a blocked message).
 * Never displays API key values.
 * Shows credential status as "configured" or "missing".
 */
export default async function AiSettingsPage() {
  let profile;
  try {
    profile = await getCurrentProfile();
  } catch {
    return <p className="text-sm text-muted-foreground p-4">Authentication required.</p>;
  }

  if (!profile) return <p className="text-sm text-muted-foreground p-4">Authentication required.</p>;

  const isAdmin = canManageOrganization(profile.role);
  const admin   = createSupabaseAdminClient();

  // Load org AI settings.
  let settings = null;
  if (admin) {
    const { data } = await admin
      .from("organization_ai_settings")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .maybeSingle();
    settings = data ? mapOrganizationAiSettings(data) : null;
  }

  // Check credential availability (server-only, never exposed to client).
  const credentialStatus: Record<string, boolean> = {
    anthropic:   !!resolveAnthropicKey(),
    openai:      !!(process.env.OPENAI_API_KEY?.trim()),
    gemini:      !!(process.env.GOOGLE_API_KEY?.trim()),
    mistral:     !!(process.env.MISTRAL_API_KEY?.trim()),
    openrouter:  !!(process.env.OPENROUTER_API_KEY?.trim())
  };

  function CredentialRow({ provider, available }: { provider: string; available: boolean }) {
    return (
      <div className="flex items-center justify-between py-2 border-b last:border-0">
        <span className="text-sm capitalize">{provider}</span>
        <div className="flex items-center gap-1.5">
          {available ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-700 font-medium">Configured in server environment</span>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-slate-400" />
              <span className="text-xs text-muted-foreground">Credential missing</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">AI Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Organization AI configuration and provider transparency.
        </p>
      </div>

      {!isAdmin && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-amber-700 text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>Administrator access is required to manage AI settings.</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Organization AI Status</CardTitle>
          <CardDescription>Current AI configuration for your organization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {settings ? (
            <>
              <div className="flex items-center justify-between">
                <span>AI enabled</span>
                <Badge tone={settings.aiEnabled ? "green" : "gray"}>
                  {settings.aiEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Consent recorded</span>
                <Badge tone={settings.consentGranted ? "green" : "red"}>
                  {settings.consentGranted ? `Yes — v${settings.consentVersion ?? "?"}` : "Not recorded"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Default provider</span>
                <Badge tone="blue">{settings.defaultProvider ?? "Not configured"}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>External transmission</span>
                <Badge tone={settings.externalDocumentTransmissionAllowed ? "amber" : "gray"}>
                  {settings.externalDocumentTransmissionAllowed ? "Allowed" : "Blocked"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Allowed task types</span>
                <span className="text-muted-foreground text-xs">
                  {settings.allowedTaskTypes.length > 0
                    ? settings.allowedTaskTypes.join(", ")
                    : "None configured"}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              No AI settings have been configured for this organization. AI features are disabled by default.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider Credentials</CardTitle>
          <CardDescription>
            API keys are configured as server environment variables and are never stored in the database or displayed here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.entries(credentialStatus).map(([provider, available]) => (
            <CredentialRow key={provider} provider={provider} available={available} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live Provider Verification</CardTitle>
          <CardDescription>
            Send a predefined non-confidential test payload to verify provider connectivity. No client documents are transmitted.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {isAdmin ? (
            <p>
              To verify live Anthropic connectivity, use{" "}
              <code className="bg-slate-100 px-1 rounded text-xs">POST /api/admin/ai-verify</code> with admin authentication.
              This endpoint is disabled in production unless <code className="bg-slate-100 px-1 rounded text-xs">ENABLE_PRODUCTION_DEV_WORKER=true</code> is set.
            </p>
          ) : (
            <p>Administrator access is required to run provider verification.</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Update AI Settings</CardTitle>
            <CardDescription>
              AI settings can be updated via the admin API. All changes are audited.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Use <code className="bg-slate-100 px-1 rounded text-xs">PATCH /api/admin/ai-settings</code> to update enablement, consent,
              provider allowlist, task allowlist, and model routes. API keys are never accepted in the request body.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
