import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getStaticLoginUsername, staticAuthMissingEnvMessage } from "@/lib/auth/static-auth";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { signInAction } from "@/server/actions/auth";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const setupError = staticAuthMissingEnvMessage() ?? supabaseMissingEnvMessage({ requireServiceRole: true });
  const authError = params.error ? decodeURIComponent(params.error) : null;
  const nextPath = params.next ?? "/projects";
  const configuredUsername = getStaticLoginUsername();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FileCheck2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle>CompliAgent</CardTitle>
          <CardDescription>Sign in to review technical compliance documents.</CardDescription>
        </CardHeader>
        <CardContent>
          {setupError ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {setupError}
            </div>
          ) : null}
          {authError ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{authError}</div>
          ) : null}
          <form className="space-y-4">
            <input name="next" type="hidden" value={nextPath} />
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                defaultValue={configuredUsername}
                placeholder="Configured username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" />
            </div>
            <Button className="w-full" formAction={signInAction} type="submit">
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">Credentials are configured server-side in the environment.</p>
        </CardContent>
      </Card>
    </main>
  );
}
