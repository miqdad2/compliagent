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
    <>
      <header className="border-b bg-white lg:hidden">
        <div className="flex h-16 items-center justify-between gap-3 px-4">
          <Link className="flex min-w-0 items-center gap-3" href="/dashboard">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <FileCheck2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">CompliAgent</p>
              <p className="truncate text-xs text-muted-foreground">Technical review system</p>
            </div>
          </Link>
          <form action={signOutAction}>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-md border text-muted-foreground"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
        <nav className="flex gap-2 overflow-x-auto border-t px-3 py-2">
          {navItems.map((item) => (
            <Link
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              href={item.href}
              key={item.href}
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <aside className="hidden min-h-screen w-64 shrink-0 border-r bg-white lg:block">
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
    </>
  );
}
