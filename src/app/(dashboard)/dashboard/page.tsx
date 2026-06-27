// The organization-level overview has moved to /overview.
// Redirect any existing bookmarks or links transparently.
import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/overview");
}
