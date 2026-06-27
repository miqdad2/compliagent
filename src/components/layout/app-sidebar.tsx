"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, ChevronRight, FileCheck2, FolderKanban,
  LogOut, Settings, Stethoscope, Users
} from "lucide-react";
import { signOutAction } from "@/server/actions/auth";
import type { AuthProfile } from "@/lib/permissions/server";

type NavItem = { href: string; label: string; icon: React.ElementType };

// DEV tools: only when NODE_ENV !== 'production' AND flag is set.
const devItems: NavItem[] =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === "true"
    ? [{ href: "/dev/system-readiness", label: "System readiness", icon: Stethoscope }]
    : [];

type AppSidebarProps = {
  profile?: AuthProfile | null;
  isAdmin?: boolean;
};

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const exact   = item.href === "/overview" || item.href === "/projects";
  const isActive = exact
    ? pathname === item.href || pathname.startsWith(item.href + "/")
    : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-slate-100 hover:text-foreground"
      }`}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
      {isActive && <ChevronRight className="ml-auto h-3 w-3 opacity-40" aria-hidden="true" />}
    </Link>
  );
}

function NavSection({
  label, items, pathname
}: { label: string; items: NavItem[]; pathname: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      {items.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}
    </div>
  );
}

export function AppSidebar({ profile, isAdmin = false }: AppSidebarProps) {
  const pathname = usePathname();

  // ── Navigation structure (role-based) ───────────────────────────────────────
  const workspaceItems: NavItem[] = [
    ...(isAdmin ? [{ href: "/overview", label: "Overview", icon: BarChart3 }] : []),
    { href: "/projects", label: "Projects", icon: FolderKanban }
  ];

  const adminItems: NavItem[] = isAdmin
    ? [
        { href: "/users",    label: "Users",    icon: Users    },
        { href: "/settings", label: "Settings", icon: Settings }
      ]
    : [];

  const accountItems: NavItem[] = !isAdmin
    ? [{ href: "/settings", label: "Settings", icon: Settings }]
    : [];

  // ── Display ─────────────────────────────────────────────────────────────────
  const displayName = profile?.full_name ?? "Reviewer";
  const displayRole = isAdmin ? "Administrator" : "Reviewer";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2) || "R";

  // ── Mobile: flat item list visible to this role ──────────────────────────────
  const mobileItems = [...workspaceItems, ...adminItems, ...accountItems];

  return (
    <>
      {/* ── Mobile header ──────────────────────────────────────────────────────── */}
      <header className="border-b bg-white lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/projects" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <span className="text-sm font-semibold">CompliAgent</span>
          </Link>
          <form action={signOutAction}>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-slate-50"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
        <nav
          aria-label="Primary navigation"
          className="flex gap-1 overflow-x-auto border-t px-2 py-1.5"
        >
          {mobileItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                pathname.startsWith(item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-slate-50"
              }`}
            >
              <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* ── Desktop sidebar ─────────────────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-white lg:flex min-h-screen">
        {/* Brand */}
        <div className="flex h-14 items-center gap-3 border-b px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none">CompliAgent</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground leading-none">Technical review platform</p>
          </div>
        </div>

        {/* Navigation */}
        <nav aria-label="Primary navigation" className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          <NavSection label="Workspace"       items={workspaceItems} pathname={pathname} />
          <NavSection label="Administration"  items={adminItems}     pathname={pathname} />
          <NavSection label="Account"         items={accountItems}   pathname={pathname} />
          {devItems.length > 0 && (
            <div className="space-y-0.5">
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500">Dev</p>
              {devItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          )}
        </nav>

        {/* User profile + sign out */}
        <div className="border-t p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600"
              aria-hidden="true"
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{displayName}</p>
              <p className="truncate text-[10px] text-muted-foreground">{displayRole}</p>
            </div>
            <form action={signOutAction}>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-slate-100"
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
