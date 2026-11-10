import type { LeadStatus } from "@/types/database";

export const CONTACT_DEPARTMENTS = [
  "Ventas",
  "IT",
  "RRHH",
  "Finanzas",
  "Administración",
  "Operaciones",
  "Marketing",
  "Compras",
] as const;

export const CONTACT_LEAD_STATUSES: readonly LeadStatus[] = [
  "Nuevo",
  "Contactado",
  "En Conversación",
  "Finalizado",
  "Negocio Abierto",
  "Sin Calificar",
] as const;

export const LEAD_STATUS_BADGE: Record<
  LeadStatus,
  "brand" | "default" | "warning" | "success" | "destructive"
> = {
  Nuevo: "brand",
  Contactado: "default",
  "En Conversación": "warning",
  Finalizado: "default",
  "Negocio Abierto": "success",
  "Sin Calificar": "destructive",
};

