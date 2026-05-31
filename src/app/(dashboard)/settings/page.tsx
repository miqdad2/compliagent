import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Organization settings, AI provider transparency, and OCR provider configuration.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Provider configuration is driven by server-side environment variables and organization policy.
      </CardContent>
    </Card>
  );
}
