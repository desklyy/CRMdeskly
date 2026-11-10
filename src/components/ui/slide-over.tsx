"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  headerActions,
  children,
}: SlideOverProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[#0F172A]/30"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-2xl flex-col border-l border-[#E2E8F0] bg-white"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-[30px] py-6">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold tracking-[-0.02em] text-[#0F172A]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-[#64748B]">{subtitle}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar panel"
              className="rounded-[4px] p-1.5 text-[#64748B] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-[30px] leading-relaxed">
          {children}
        </div>
      </section>
    </div>
  );
}
