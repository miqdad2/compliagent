import Link from "next/link";
import { FileCheck2, FolderKanban, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { signOutAction } from "@/server/actions/auth";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/users", label: "Users", icon: Users }
];

export function AppSidebar() {
  return (
    <aside className="hidden min-h-screen w-64 border-r bg-white lg:block">
      <div className="flex h-16 items-center gap-3 border-b px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <FileCheck2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold">CompliAgent</p>
          <p className="text-xs text-muted-foreground">Technical review system</p>
        </div>
      </div>
      <nav className="space-y-1 p-3">
        {navItems.map((item) => (
          <Link
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            href={item.href}
            key={item.href}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <form action={signOutAction} className="p-3">
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </form>
    </aside>
  );
}
