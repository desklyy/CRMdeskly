"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type RealtimeTable = "deals" | "activities" | "custom_field_definitions";
type ChangeHandler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;

interface RealtimeContextValue {
  status: "idle" | "connecting" | "connected" | "error";
  subscribe: (table: RealtimeTable, handler: ChangeHandler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  status: "idle",
  subscribe: () => () => {},
});

/**
 * Proveedor único de Supabase Realtime en el layout para reutilizar un solo canal
 * por pestaña y limpiar la suscripción al desmontar (protege el límite Free de 200 conexiones).
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<RealtimeContextValue["status"]>("idle");
  const listenersRef = useRef<Record<RealtimeTable, Set<ChangeHandler>>>({
    deals: new Set(),
    activities: new Set(),
    custom_field_definitions: new Set(),
  });

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    const supabase = createClient();
    setStatus("connecting");

    const dispatch = (
      table: RealtimeTable,
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      listenersRef.current[table].forEach((handler) => {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[RealtimeProvider] Error in ${table} listener:`, err);
        }
      });
    };

    const channel = supabase
      .channel("deskly-crm-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals" },
        (payload) => dispatch("deals", payload as RealtimePostgresChangesPayload<Record<string, unknown>>)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activities" },
        (payload) => dispatch("activities", payload as RealtimePostgresChangesPayload<Record<string, unknown>>)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "custom_field_definitions" },
        (payload) =>
          dispatch(
            "custom_field_definitions",
            payload as RealtimePostgresChangesPayload<Record<string, unknown>>
          )
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") {
          setStatus("connected");
        } else if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        ) {
          setStatus("error");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      setStatus("idle");
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      subscribe: (table, handler) => {
        listenersRef.current[table].add(handler);
        return () => {
          listenersRef.current[table].delete(handler);
        };
      },
    }),
    [status]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

