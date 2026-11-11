"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  Calendar,
  CheckSquare,
  Kanban,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { DesklyLogo } from "@/components/brand/deskly-logo";
import type { UserRole } from "@/types/database";

interface SidebarProps {
  profile: {
    full_name: string;
    email: string;
    avatar_initials: string;
    role: UserRole;
  };
}

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tareas", icon: CheckSquare },
  { href: "/companies", label: "Empresas", icon: Building2 },
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/pipelines", label: "Pipelines", icon: Kanban },
  { href: "/calendar", label: "Calendario", icon: Calendar },
];

export function Sidebar({ profile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      aria-label="Navegación principal"
      className="group/sidebar fixed inset-y-0 left-0 z-30 flex w-14 flex-col justify-between overflow-hidden border-r border-[#1E293B] bg-[#0F172A] text-slate-300 transition-[width] duration-200 ease-out hover:w-56"
    >
      <div>
        {/* Brand */}
        <div className="flex h-14 items-center border-b border-[#1E293B] px-2.5">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <DesklyLogo size="md" />
            <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-slate-400 opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
              CRM
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mt-3 flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-[4px] px-2.5 text-sm font-semibold transition-colors",
                  isActive
                    ? "border-l-[3px] border-[#1658F5] bg-[#1E293B] text-white"
                    : "text-slate-400 hover:bg-[#1E293B]/60 hover:text-white"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive ? "text-[#1658F5]" : ""
                  )}
                />
                <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom section */}
      <div className="flex flex-col gap-1 border-t border-[#1E293B] p-2">
        <Link
          href="/settings"
          className={cn(
            "flex h-9 items-center gap-3 rounded-[4px] px-2.5 text-sm font-semibold transition-colors",
            pathname.startsWith("/settings")
              ? "border-l-[3px] border-[#1658F5] bg-[#1E293B] text-white"
              : "text-slate-400 hover:bg-[#1E293B]/60 hover:text-white"
          )}
        >
          <Settings
            className={cn(
              "h-4 w-4 shrink-0",
              pathname.startsWith("/settings") ? "text-[#1658F5]" : ""
            )}
          />
          <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
            {profile.role === "admin" ? "Settings" : "Integraciones"}
          </span>
        </Link>

        <div className="mt-1 flex items-center justify-between gap-2 rounded-[4px] px-1.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-[#1658F5] text-[11px] font-bold text-white">
              {profile.avatar_initials}
            </div>
            <div className="min-w-0 opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100">
              <p className="truncate text-xs font-semibold text-white">
                {profile.full_name}
              </p>
              <p className="truncate text-[10px] uppercase tracking-wider text-slate-400">
                {profile.role}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            title="Cerrar sesión"
            className="shrink-0 rounded-[4px] p-1 text-slate-400 opacity-0 transition-opacity hover:bg-[#1E293B] hover:text-white group-hover/sidebar:opacity-100"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
