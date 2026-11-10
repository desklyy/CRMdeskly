"use client";

import React, { useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { RealtimeProvider, useRealtime } from "@/components/providers/realtime-provider";
import type { UserRole } from "@/types/database";

interface AppShellProps {
  profile: {
    full_name: string;
    email: string;
    avatar_initials: string;
    role: UserRole;
  };
  outlookAuthInvalid?: boolean;
  children: React.ReactNode;
}

function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { status } = useRealtime();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#E2E8F0] bg-white px-[30px]">
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex h-8 w-80 items-center justify-between rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-xs text-[#64748B] transition-colors hover:border-[#1658F5]/50 hover:bg-white"
      >
        <span className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-[#64748B]" />
          Buscar empresas, contactos, negocios...
        </span>
        <kbd className="rounded-[2px] border border-[#E2E8F0] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#64748B]">
          Ctrl K
        </kbd>
      </button>

      <div className="flex items-center gap-2 text-xs text-[#64748B]">
        <span
          className={
            status === "connected"
              ? "h-2 w-2 rounded-[2px] bg-[#1658F5]"
              : status === "error"
                ? "h-2 w-2 rounded-[2px] bg-red-600"
                : "h-2 w-2 rounded-[2px] bg-slate-300"
          }
        />
        <span>
          {status === "connected"
            ? "Realtime activo"
            : status === "connecting"
              ? "Conectando..."
              : "En espera"}
        </span>
      </div>
    </header>
  );
}

export function AppShell({
  profile,
  outlookAuthInvalid = false,
  children,
}: AppShellProps) {
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <RealtimeProvider>
      <div className="min-h-screen bg-[#F8FAFC] text-[#334155]">
        <Sidebar profile={profile} />
        <div className="pl-14">
          <TopBar onOpenSearch={() => setCommandOpen(true)} />
          {outlookAuthInvalid && (
            <a
              href="/api/outlook/connect"
              className="flex items-center justify-center gap-2 border-b border-[#E2E8F0] border-l-[3px] border-l-red-600 bg-[#F8FAFC] px-[30px] py-2.5 text-xs font-semibold text-[#0F172A] transition-colors hover:bg-white"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />
              <span>
                Conexión con Outlook pausada.{" "}
                <span className="text-[#1658F5] underline">
                  Haz clic aquí para volver a autenticarte.
                </span>
              </span>
            </a>
          )}
          <main className="p-[30px]">{children}</main>
        </div>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </div>
    </RealtimeProvider>
  );
}
