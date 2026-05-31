import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function UsersPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>User management</CardTitle>
        <CardDescription>Role-based access control for admins, engineers, reviewers, viewers, and contractors.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Supabase Auth profiles and server-side role checks are initialized for this module.
      </CardContent>
    </Card>
  );
}
