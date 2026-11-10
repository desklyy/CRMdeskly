import type { Database, Json } from "@/types/database";

type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

export interface QuoteItemInput {
  concept: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
}

export interface CalculatedQuoteItem extends QuoteItemInput {
  item_order: number;
  line_total: number;
}

export interface QuoteTotals {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total_amount: number;
  net_base: number;
  items: CalculatedQuoteItem[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula importes de líneas y totales del presupuesto redondeados a 2 decimales.
 */
export function calculateQuoteTotals(items: QuoteItemInput[]): QuoteTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;

  const calculatedItems: CalculatedQuoteItem[] = items.map((item, idx) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const unitPrice = Math.max(0, Number(item.unit_price) || 0);
    const discountPct = Math.min(100, Math.max(0, Number(item.discount_percent) || 0));
    const taxRate = Math.max(0, Number(item.tax_rate) || 0);

    const gross = qty * unitPrice;
    const discountAmt = gross * (discountPct / 100);
    const netLine = gross - discountAmt;
    const taxAmt = netLine * (taxRate / 100);

    subtotal += gross;
    discountTotal += discountAmt;
    taxTotal += taxAmt;

    return {
      concept: item.concept.trim(),
      description: item.description?.trim() || null,
      quantity: round2(qty),
      unit_price: round2(unitPrice),
      discount_percent: round2(discountPct),
      tax_rate: round2(taxRate),
      item_order: idx,
      line_total: round2(netLine),
    };
  });

  const roundedSubtotal = round2(subtotal);
  const roundedDiscount = round2(discountTotal);
  const roundedTax = round2(taxTotal);
  const netBase = round2(roundedSubtotal - roundedDiscount);
  const totalAmount = round2(netBase + roundedTax);

  return {
    subtotal: roundedSubtotal,
    discount_total: roundedDiscount,
    tax_total: roundedTax,
    total_amount: totalAmount,
    net_base: netBase,
    items: calculatedItems,
  };
}

export interface BillingSnapshot {
  company_name: string | null;
  tax_id: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
  country: string | null;
  contact_name: string | null;
  contact_email: string | null;
}

export function buildBillingSnapshot(
  company: Pick<
    CompanyRow,
    | "name"
    | "tax_id"
    | "billing_address"
    | "billing_city"
    | "billing_postal_code"
    | "country"
  > | null,
  contact: Pick<ContactRow, "first_name" | "last_name" | "email"> | null
): Record<string, Json> {
  const contactName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ")
    : null;

  return {
    company_name: company?.name ?? null,
    tax_id: company?.tax_id ?? null,
    billing_address: company?.billing_address ?? null,
    billing_city: company?.billing_city ?? null,
    billing_postal_code: company?.billing_postal_code ?? null,
    country: company?.country ?? "ES",
    contact_name: contactName,
    contact_email: contact?.email ?? null,
  };
}

