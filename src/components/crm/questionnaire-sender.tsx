"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendQuestionnaireEmailAction } from "@/app/(crm)/actions/outlook";
import type { ActivityEntityType, Database } from "@/types/database";

type EmailRow = Database["public"]["Tables"]["emails"]["Row"];

export interface QuestionnaireRecipientOption {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  company_id?: string | null;
}

interface UseSendQuestionnaireOptions {
  entityType: Extract<ActivityEntityType, "deal" | "company" | "contact">;
  entityId: string;
  recipients: QuestionnaireRecipientOption[];
  preferredContactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  onSent?: (result: { emailRow: EmailRow | null; toEmail: string }) => void;
}

export function useSendQuestionnaire({
  entityType,
  entityId,
  recipients,
  preferredContactId,
  companyId,
  dealId,
  onSent,
}: UseSendQuestionnaireOptions) {
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    setFeedback(null);
    setPickerOpen(false);
    setSelectedContactId("");
  }, [entityId]);

  const validRecipients = recipients.filter((r) => Boolean(r.email?.trim()));

  async function dispatchTo(contactId: string) {
    setSending(true);
    setFeedback(null);
    try {
      const res = await sendQuestionnaireEmailAction({
        contactId,
        companyId: companyId ?? null,
        dealId: dealId ?? null,
        entityType,
        entityId,
      });

      if (res.error) {
        setFeedback({ type: "error", text: res.error });
        return;
      }

      const saludo = res.greetingName ? `Hola ${res.greetingName},` : "Hola,";
      setPickerOpen(false);
      setFeedback({
        type: "success",
        text: `Cuestionario enviado por Outlook a ${res.toEmail} (${saludo}).`,
      });
      onSent?.({
        emailRow: (res.data as EmailRow | null) ?? null,
        toEmail: res.toEmail ?? "",
      });
    } finally {
      setSending(false);
    }
  }

  function trigger() {
    setFeedback(null);

    if (validRecipients.length === 0) {
      setFeedback({
        type: "error",
        text: "No hay ningún contacto con dirección de email asignada para enviar el cuestionario.",
      });
      return;
    }

    if (preferredContactId) {
      const preferred = validRecipients.find((r) => r.id === preferredContactId);
      if (preferred) {
        void dispatchTo(preferred.id);
        return;
      }
    }

    if (validRecipients.length === 1) {
      void dispatchTo(validRecipients[0].id);
      return;
    }

    setSelectedContactId(validRecipients[0].id);
    setPickerOpen(true);
  }

  function confirmPicked() {
    if (!selectedContactId) return;
    void dispatchTo(selectedContactId);
  }

  return {
    sending,
    pickerOpen,
    setPickerOpen,
    selectedContactId,
    setSelectedContactId,
    validRecipients,
    feedback,
    setFeedback,
    trigger,
    confirmPicked,
  };
}

export function SendQuestionnaireButton({
  sending,
  onClick,
}: {
  sending: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      disabled={sending}
      onClick={onClick}
      className="bg-[#1658F5] text-white hover:bg-[#1246C8]"
    >
      <Send className="h-3.5 w-3.5" />
      {sending ? "Enviando..." : "Enviar cuestionario"}
    </Button>
  );
}

export function QuestionnaireFeedbackArea({
  state,
}: {
  state: ReturnType<typeof useSendQuestionnaire>;
}) {
  if (!state.pickerOpen && !state.feedback) return null;

  return (
    <div className="mb-4 space-y-2">
      {state.pickerOpen && (
        <div className="rounded-[4px] border border-[#E2E8F0] border-l-[3px] border-l-[#1658F5] bg-[#F8FAFC] p-3 text-xs">
          <p className="font-semibold text-[#0F172A]">
            Selecciona el contacto destinatario del cuestionario:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={state.selectedContactId}
              onChange={(e) => state.setSelectedContactId(e.target.value)}
              className="h-8 flex-1 min-w-[200px] rounded-[4px] border border-[#E2E8F0] bg-white px-2 text-xs text-[#0F172A]"
            >
              {state.validRecipients.map((c) => {
                const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ");
                return (
                  <option key={c.id} value={c.id}>
                    {fullName} ({c.email})
                  </option>
                );
              })}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={state.sending}
              onClick={state.confirmPicked}
              className="bg-[#1658F5] text-white hover:bg-[#1246C8]"
            >
              {state.sending ? "Enviando..." : "Confirmar envío"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => state.setPickerOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {state.feedback && (
        <div
          className={`flex items-start justify-between gap-2 rounded-[4px] border border-[#E2E8F0] border-l-[3px] bg-[#F8FAFC] p-3 text-xs ${
            state.feedback.type === "error"
              ? "border-l-red-600 text-red-700"
              : "border-l-emerald-600 text-[#0F172A]"
          }`}
        >
          <div className="flex items-start gap-2">
            {state.feedback.type === "error" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            )}
            <span>{state.feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => state.setFeedback(null)}
            className="text-[#64748B] hover:text-[#0F172A]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
