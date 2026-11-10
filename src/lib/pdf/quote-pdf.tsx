import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  Document,
  Image as PdfImage,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { BillingSnapshot } from "@/lib/crm/quotes";
import type { Database } from "@/types/database";

type QuoteRow = Database["public"]["Tables"]["quotes"]["Row"];
type QuoteItemRow = Database["public"]["Tables"]["quote_items"]["Row"];

interface QuotePdfProps {
  quote: QuoteRow;
  items: QuoteItemRow[];
  dealTitle: string;
  billing: BillingSnapshot;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#334155",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "#1658F5",
    paddingBottom: 16,
    marginBottom: 20,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoImage: {
    width: 44,
    height: 44,
    borderRadius: 2,
  },
  brand: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0F172A",
  },
  brandAccent: {
    color: "#1658F5",
  },
  brandSub: {
    fontSize: 9,
    color: "#64748B",
    marginTop: 3,
  },
  metaRight: {
    textAlign: "right",
  },
  quoteNumber: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#0F172A",
  },
  metaText: {
    fontSize: 9,
    color: "#64748B",
    marginTop: 2,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 22,
    gap: 16,
  },
  box: {
    flex: 1,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 2,
    backgroundColor: "#F8FAFC",
  },
  boxTitle: {
    fontSize: 8,
    textTransform: "uppercase",
    color: "#64748B",
    marginBottom: 4,
    fontWeight: "bold",
  },
  boxLine: {
    fontSize: 9.5,
    marginBottom: 2,
    color: "#0F172A",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#0F172A",
    color: "#ffffff",
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontSize: 8.5,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontSize: 9,
  },
  colConcept: { flex: 3.4 },
  colQty: { flex: 0.8, textAlign: "right" },
  colPrice: { flex: 1.1, textAlign: "right" },
  colDto: { flex: 0.8, textAlign: "right" },
  colIva: { flex: 0.8, textAlign: "right" },
  colTotal: { flex: 1.2, textAlign: "right", fontWeight: "bold", color: "#0F172A" },
  itemDesc: {
    fontSize: 8,
    color: "#64748B",
    marginTop: 2,
  },
  totalsContainer: {
    marginTop: 18,
    alignItems: "flex-end",
  },
  totalsBox: {
    width: 230,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 2,
    padding: 12,
    backgroundColor: "#F8FAFC",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
    fontSize: 9.5,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 6,
    marginTop: 4,
    fontSize: 12,
    fontWeight: "bold",
    color: "#1658F5",
  },
  termsBox: {
    marginTop: 26,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#1658F5",
  },
  termsTitle: {
    fontSize: 8.5,
    fontWeight: "bold",
    textTransform: "uppercase",
    color: "#0F172A",
    marginBottom: 4,
  },
  termsText: {
    fontSize: 8.5,
    color: "#334155",
    lineHeight: 1.5,
  },
});

function formatMoney(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}

function getLogoDataUri(): string | null {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-deskly.jpg");
    const buf = fs.readFileSync(logoPath);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export function QuotePdfDocument({
  quote,
  items,
  dealTitle,
  billing,
}: QuotePdfProps) {
  const issuedDate = new Date(quote.sent_at ?? quote.created_at).toLocaleDateString("es-ES");
  const validDate = quote.valid_until
    ? new Date(quote.valid_until).toLocaleDateString("es-ES")
    : "30 días";
  const logoSrc = getLogoDataUri();

  return (
    <Document title={`Presupuesto ${quote.quote_number}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            {logoSrc && <PdfImage src={logoSrc} style={styles.logoImage} />}
            <View>
              <Text style={styles.brand}>Deskly CRM</Text>
              <Text style={styles.brandSub}>Propuesta Comercial · {dealTitle}</Text>
            </View>
          </View>
          <View style={styles.metaRight}>
            <Text style={styles.quoteNumber}>{quote.quote_number}</Text>
            <Text style={styles.metaText}>Fecha: {issuedDate}</Text>
            <Text style={styles.metaText}>Válido hasta: {validDate}</Text>
          </View>
        </View>

        {/* Client Info */}
        <View style={styles.sectionRow}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Cliente / Datos Fiscales</Text>
            <Text style={styles.boxLine}>
              {billing.company_name ?? billing.contact_name ?? "Cliente"}
            </Text>
            {billing.tax_id && <Text style={styles.boxLine}>CIF/NIF: {billing.tax_id}</Text>}
            {billing.billing_address && (
              <Text style={styles.boxLine}>{billing.billing_address}</Text>
            )}
            {(billing.billing_postal_code || billing.billing_city) && (
              <Text style={styles.boxLine}>
                {[billing.billing_postal_code, billing.billing_city, billing.country]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </View>

          <View style={styles.box}>
            <Text style={styles.boxTitle}>Contacto Principal</Text>
            <Text style={styles.boxLine}>{billing.contact_name ?? "—"}</Text>
            {billing.contact_email && (
              <Text style={styles.boxLine}>{billing.contact_email}</Text>
            )}
            <Text style={styles.boxLine}>Estado: {quote.status.toUpperCase()}</Text>
          </View>
        </View>

        {/* Table Header */}
        <View style={styles.tableHeader}>
          <Text style={styles.colConcept}>Concepto</Text>
          <Text style={styles.colQty}>Cant.</Text>
          <Text style={styles.colPrice}>Precio</Text>
          <Text style={styles.colDto}>Dto.</Text>
          <Text style={styles.colIva}>IVA</Text>
          <Text style={styles.colTotal}>Base Neta</Text>
        </View>

        {/* Table Rows */}
        {items.map((item) => (
          <View key={item.id} style={styles.tableRow}>
            <View style={styles.colConcept}>
              <Text>{item.concept}</Text>
              {item.description && (
                <Text style={styles.itemDesc}>{item.description}</Text>
              )}
            </View>
            <Text style={styles.colQty}>{item.quantity}</Text>
            <Text style={styles.colPrice}>{formatMoney(item.unit_price)}</Text>
            <Text style={styles.colDto}>{item.discount_percent}%</Text>
            <Text style={styles.colIva}>{item.tax_rate}%</Text>
            <Text style={styles.colTotal}>{formatMoney(item.line_total)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsContainer}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text>Subtotal bruto</Text>
              <Text>{formatMoney(quote.subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>Descuentos</Text>
              <Text>-{formatMoney(quote.discount_total)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>IVA</Text>
              <Text>{formatMoney(quote.tax_total)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text>TOTAL</Text>
              <Text>{formatMoney(quote.total_amount)}</Text>
            </View>
          </View>
        </View>

        {/* Terms */}
        {quote.terms && (
          <View style={styles.termsBox}>
            <Text style={styles.termsTitle}>Condiciones y forma de pago</Text>
            <Text style={styles.termsText}>{quote.terms}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderQuotePdfBuffer(props: QuotePdfProps): Promise<Buffer> {
  return renderToBuffer(<QuotePdfDocument {...props} />);
}
