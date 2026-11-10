"use client";

import React, { useMemo, useState } from "react";
import { FileDown, Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { calculateQuoteTotals, type QuoteItemInput } from "@/lib/crm/quotes";
import { formatCurrencyEUR } from "@/lib/crm/custom-fields";
import {
  saveQuoteAction,
  updateQuoteStatusAction,
  type QuoteWithItems,
} from "@/app/(crm)/actions/deals-and-quotes";
import { sendDealEmailAction } from "@/app/(crm)/actions/outlook";
import type { QuoteStatus } from "@/types/database";

interface QuoteBuilderProps {
  dealId: string;
  companyId: string | null;
  contactId: string | null;
  contactEmail?: string | null;
  quotes: QuoteWithItems[];
  onQuotesChanged: (next: QuoteWithItems[]) => void;
  onDealAmountSynced?: (newAmount: number) => void;
}

const STATUS_BADGE: Record<
  QuoteStatus,
  { label: string; variant: "default" | "success" | "warning" | "destructive" }
> = {
  draft: { label: "Borrador", variant: "default" },
  sent: { label: "Enviado", variant: "warning" },
  accepted: { label: "Aceptado", variant: "success" },
  rejected: { label: "Rechazado", variant: "destructive" },
  expired: { label: "Caducado", variant: "default" },
};

const EMPTY_ITEM: QuoteItemInput = {
  concept: "",
  description: "",
  quantity: 1,
  unit_price: 0,
  discount_percent: 0,
  tax_rate: 21,
};

export function QuoteBuilder({
  dealId,
  companyId,
  contactId,
  contactEmail,
  quotes,
  onQuotesChanged,
  onDealAmountSynced,
}: QuoteBuilderProps) {
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(quotes.length === 0);
  const [validUntil, setValidUntil] = useState("");
  const [terms, setTerms] = useState("Pago a 30 días mediante transferencia bancaria.");
  const [items, setItems] = useState<QuoteItemInput[]>([{ ...EMPTY_ITEM }]);
  const [syncDealAmount, setSyncDealAmount] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const liveTotals = useMemo(() => calculateQuoteTotals(items), [items]);

  function startNewQuote() {
    setEditingQuoteId(null);
    setValidUntil("");
    setTerms("Pago a 30 días mediante transferencia bancaria.");
    setItems([{ ...EMPTY_ITEM }]);
    setError(null);
    setShowEditor(true);
  }

  function startEditQuote(q: QuoteWithItems) {
    setEditingQuoteId(q.id);
    setValidUntil(q.valid_until ?? "");
    setTerms(q.terms ?? "");
    setItems(
      q.items.length > 0
        ? q.items.map((it) => ({
            concept: it.concept,
            description: it.description ?? "",
            quantity: it.quantity,
            unit_price: it.unit_price,
            discount_percent: it.discount_percent,
            tax_rate: it.tax_rate,
          }))
        : [{ ...EMPTY_ITEM }]
    );
    setError(null);
    setShowEditor(true);
  }

  async function handleSaveQuote(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await saveQuoteAction({
        quoteId: editingQuoteId ?? undefined,
        dealId,
        companyId,
        contactId,
        validUntil: validUntil || null,
        terms: terms || null,
        items,
      });

      if (res.error || !res.data) {
        setError(res.error ?? "No se pudo guardar el presupuesto.");
        return;
      }

      const saved = res.data;
      const exists = quotes.some((q) => q.id === saved.id);
      const nextList = exists
        ? quotes.map((q) => (q.id === saved.id ? saved : q))
        : [saved, ...quotes];
      onQuotesChanged(nextList);
      setShowEditor(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeStatus(quoteId: string, status: QuoteStatus) {
    const res = await updateQuoteStatusAction({
      quoteId,
      status,
      syncDealAmount,
    });
    if (res.data) {
      onQuotesChanged(
        quotes.map((q) => (q.id === quoteId ? { ...q, ...res.data } : q))
      );
      if (typeof res.syncedAmount === "number") {
        onDealAmountSynced?.(res.syncedAmount);
      }
    }
  }

  async function handleSendByOutlook(q: QuoteWithItems) {
    setError(null);
    setSendFeedback(null);
    const targetEmail =
      contactEmail ||
      window.prompt("Email del destinatario para enviar el presupuesto:") ||
      "";
    if (!targetEmail.trim()) return;

    setSendingQuoteId(q.id);
    try {
      const res = await sendDealEmailAction({
        dealId,
        companyId,
        contactId,
        toEmail: targetEmail.trim(),
        subject: `Presupuesto ${q.quote_number}`,
        bodyText: `Hola,\n\nTe adjuntamos el presupuesto ${q.quote_number} por importe total de ${formatCurrencyEUR(q.total_amount)}.\n\nQuedamos a tu disposición para cualquier duda.`,
        quoteId: q.id,
      });

      if (res.error) {
        setError(res.error);
        return;
      }

      onQuotesChanged(
        quotes.map((row) =>
          row.id === q.id
            ? { ...row, status: "sent", sent_at: new Date().toISOString() }
            : row
        )
      );
      if (syncDealAmount && typeof res.syncedBaseAmount === "number") {
        onDealAmountSynced?.(res.syncedBaseAmount);
      }
      setSendFeedback(`Presupuesto ${q.quote_number} enviado por Outlook a ${targetEmail}.`);
    } finally {
      setSendingQuoteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Presupuestos ({quotes.length})
          </h3>
          <p className="text-[11px] text-slate-400">
            PDF generado al vuelo en memoria RAM (0 Storage).
          </p>
        </div>
        <Button type="button" size="sm" onClick={startNewQuote}>
          <Plus className="h-3.5 w-3.5" />
          Nuevo presupuesto
        </Button>
      </div>

      {/* Existing quotes list */}
      {sendFeedback && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700">
          {sendFeedback}
        </div>
      )}
      {error && !showEditor && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {error}
        </div>
      )}
      {quotes.length > 0 && (
        <div className="space-y-2">
          {quotes.map((q) => {
            const meta = STATUS_BADGE[q.status];
            return (
              <div
                key={q.id}
                className="rounded-md border border-slate-200 bg-white p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-slate-950">
                      {q.quote_number}
                    </span>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="font-semibold text-emerald-700">
                      {formatCurrencyEUR(q.total_amount)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <a
                      href={`/api/quotes/${q.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      PDF
                    </a>
                    <Button
                      type="button"
                      size="sm"
                      disabled={sendingQuoteId === q.id}
                      onClick={() => void handleSendByOutlook(q)}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {sendingQuoteId === q.id ? "Enviando..." : "Enviar por Outlook"}
                    </Button>
                    {q.status === "draft" && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startEditQuote(q)}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleChangeStatus(q.id, "sent")}
                        >
                          Marcar enviado
                        </Button>
                      </>
                    )}
                    {q.status === "sent" && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleChangeStatus(q.id, "accepted")}
                        >
                          Aceptado
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleChangeStatus(q.id, "rejected")}
                        >
                          Rechazado
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <label className="flex items-center gap-2 text-[11px] text-slate-500">
            <input
              type="checkbox"
              checked={syncDealAmount}
              onChange={(e) => setSyncDealAmount(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            Sincronizar importe del negocio (base imponible sin IVA) al enviar o aceptar.
          </label>
        </div>
      )}

      {/* Editor */}
      {showEditor && (
        <form
          onSubmit={handleSaveQuote}
          className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900">
              {editingQuoteId ? "Editar presupuesto" : "Nuevo presupuesto"}
            </h4>
            {quotes.length > 0 && (
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Cerrar editor
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Lines */}
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="space-y-2 rounded-md border border-slate-200 bg-white p-2.5"
              >
                <div className="flex items-center gap-2">
                  <Input
                    required
                    placeholder="Concepto / Servicio *"
                    value={item.concept}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((it, i) =>
                          i === idx ? { ...it, concept: e.target.value } : it
                        )
                      )
                    }
                    className="h-8 text-xs"
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setItems((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <Input
                  placeholder="Descripción breve (opcional)"
                  value={item.description ?? ""}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((it, i) =>
                        i === idx ? { ...it, description: e.target.value } : it
                      )
                    )
                  }
                  className="h-7 text-xs"
                />

                <div className="grid grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <label className="text-slate-500">Cant.</label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={item.quantity}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, quantity: Number(e.target.value) } : it
                          )
                        )
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-slate-500">Precio (€)</label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={item.unit_price}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, unit_price: Number(e.target.value) } : it
                          )
                        )
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-slate-500">Dto. %</label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      value={item.discount_percent}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) =>
                            i === idx
                              ? { ...it, discount_percent: Number(e.target.value) }
                              : it
                          )
                        )
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-slate-500">IVA %</label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={item.tax_rate}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((it, i) =>
                            i === idx ? { ...it, tax_rate: Number(e.target.value) } : it
                          )
                        )
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir línea
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Válido hasta</label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700">Condiciones</label>
              <Input
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Condiciones de pago..."
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
            <div className="space-y-0.5 text-slate-600">
              <p>
                Base imponible:{" "}
                <span className="font-medium text-slate-900">
                  {formatCurrencyEUR(liveTotals.net_base)}
                </span>{" "}
                · IVA:{" "}
                <span className="font-medium text-slate-900">
                  {formatCurrencyEUR(liveTotals.tax_total)}
                </span>
              </p>
              <p className="text-sm font-semibold text-slate-950">
                Total: {formatCurrencyEUR(liveTotals.total_amount)}
              </p>
            </div>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Guardando..." : "Guardar presupuesto"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

