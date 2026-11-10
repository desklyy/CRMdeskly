"use client";

import React, { useState } from "react";
import { TeamSettings } from "@/components/settings/team-settings";
import { PipelineBuilder } from "@/components/settings/pipeline-builder";
import { FieldsManager } from "@/components/settings/fields-manager";
import { IntegrationsSettings } from "@/components/settings/integrations-settings";
import {
  ApiKeysSettings,
  type ApiKeyPublicRow,
} from "@/components/settings/api-keys-settings";
import type { CustomFieldDefinition } from "@/lib/crm/custom-fields";
import type { PipelineRow, StageRow } from "@/lib/crm/deals";
import type { Database, UserRole } from "@/types/database";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type OAuthConnectionPublic = Pick<
  Database["public"]["Tables"]["oauth_connections"]["Row"],
  | "id"
  | "microsoft_email"
  | "is_auth_invalid"
  | "last_auth_error"
  | "subscription_expires_at"
  | "calendar_subscription_expires_at"
  | "updated_at"
>;

type SettingsTab = "team" | "pipelines" | "fields" | "integrations" | "api_keys";

interface SettingsViewProps {
  currentUserId: string;
  currentUserRole: UserRole;
  profiles: ProfileRow[];
  pipelines: PipelineRow[];
  stages: StageRow[];
  definitions: CustomFieldDefinition[];
  oauthConnection: OAuthConnectionPublic | null;
  apiKeys: ApiKeyPublicRow[];
  emailSignature: string | null;
  outlookStatus?: string;
  outlookReason?: string;
}

export function SettingsView({
  currentUserId,
  currentUserRole,
  profiles,
  pipelines,
  stages,
  definitions,
  oauthConnection,
  apiKeys,
  emailSignature,
  outlookStatus,
  outlookReason,
}: SettingsViewProps) {
  const isAdmin = currentUserRole === "admin";
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    outlookStatus ? "integrations" : isAdmin ? "team" : "integrations"
  );

  const tabs: { key: SettingsTab; label: string; adminOnly?: boolean }[] = [
    { key: "team", label: "Equipo", adminOnly: true },
    { key: "pipelines", label: "Embudos y Etapas", adminOnly: true },
    { key: "fields", label: "Variables / Propiedades" },
    { key: "integrations", label: "Integraciones (Outlook)" },
    { key: "api_keys", label: "API Keys (IA)", adminOnly: true },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">Settings</h1>
        <p className="text-xs text-slate-500">
          {isAdmin
            ? "Administración de equipo, embudos, variables del CRM, Outlook y claves de API."
            : "Conexión de tu cuenta Outlook y consulta/alta de propiedades del CRM."}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[#E2E8F0] pb-2">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === t.key
                ? "bg-[#1658F5] text-white"
                : "text-[#64748B] hover:bg-white hover:text-[#0F172A]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "team" && isAdmin && (
        <TeamSettings initialProfiles={profiles} currentUserId={currentUserId} />
      )}

      {activeTab === "pipelines" && isAdmin && (
        <PipelineBuilder initialPipelines={pipelines} initialStages={stages} />
      )}

      {activeTab === "fields" && (
        <FieldsManager
          initialDefinitions={definitions}
          currentUserRole={currentUserRole}
        />
      )}

      {activeTab === "integrations" && (
        <IntegrationsSettings
          connection={oauthConnection}
          emailSignature={emailSignature}
          outlookStatus={outlookStatus}
          outlookReason={outlookReason}
        />
      )}

      {activeTab === "api_keys" && isAdmin && (
        <ApiKeysSettings initialKeys={apiKeys} />
      )}
    </div>
  );
}

