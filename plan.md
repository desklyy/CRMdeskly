# Plan Director de Producto: Deskly CRM (Uso Interno)

## 1. Visión General y Stack Tecnológico

Plataforma CRM hiper-optimizada para la gestión comercial y operativa interna de Deskly. Diseño flat/ortogonal B2B enfocado en la productividad, sin fricciones, **basado en datos y variables estructuradas** (con soporte controlado de eventos acotados `call_summary`/`meeting_summary` y **notas internas** `internal_note` en el Timeline), sincronizado con el **Cuestionario Operativo** de `desklyy.com/cuestionario` y preparado para ser operado tanto por el equipo humano como por los agentes de IA de Deskly.

- **Frontend & Backend:** Next.js 15 (App Router, TypeScript) + React (Server Actions para mutaciones UI + Route Handlers Node/Serverless para `/api/quotes/*`, `/api/v1/*` y `/api/webhooks/*`), alojado en **Vercel (Plan Hobby / Gratis)**.
- **Base de Datos, Auth, 2FA & Realtime:** **Supabase (Plan Free)** — PostgreSQL, Row Level Security estricto, Supabase Auth *invite-only* (`disable_signup: true`), **doble factor obligatorio (2FA TOTP AAL2 con App Authenticator)** en login/middleware y **Supabase Realtime (WebSockets)** centralizado en un único `RealtimeProvider` en el layout sobre `deals`, `activities` y `custom_field_definitions` (compartiendo socket por pestaña y limpiando canales al desmontar para cuidar el límite de 200 conexiones concurrentes).
- **Optimización Free-Tier (Vercel Hobby + Supabase Free 500 MB):**
  - Caché agresiva con `unstable_cache` / `cacheTag` + `revalidateTag('crm-schema')` en `GET /api/v1/schema` para no saturar lecturas de Postgres con llamadas repetidas de los Agentes IA.
  - Los correos guardan solo metadatos y `body_preview` en Postgres (sin HTML pesado/base64), cargando el cuerpo completo bajo demanda desde Microsoft Graph API por `ms_graph_id`.
  - PDFs de presupuestos generados **al vuelo en servidor** (`@react-pdf/renderer` con `serverExternalPackages` y `outputFileTracingIncludes` en `next.config.ts` para incluir las fuentes estándar de `pdfkit` en Vercel Serverless), sin ocupar Supabase Storage ni BD.
  - **Cron diario compatible con Vercel Hobby** (1 ejecución/día en `vercel.json`, protegido con `CRON_SECRET`, ejecución en paralelo con `Promise.allSettled` + renovación oportunista al abrir el CRM si quedan `<48h`) que renueva las suscripciones de Microsoft Graph y mantiene activo Supabase Free (evitando pausa tras 7 días sin actividad).
- **Privacidad y No-Indexación:** Aplicación estrictamente privada (`src/app/robots.ts` con `Disallow: /`, meta `robots: noindex, nofollow` en `layout.tsx` y cabecera HTTP global `X-Robots-Tag` en `next.config.ts`).
- **Estilos y UI:** Tailwind CSS, `shadcn/ui`, Lucide React, `cmdk` (Command Palette `Cmd/Ctrl + K`), Recharts (gráfica fluida continua de evolución comercial y embudo de conversión).
- **Interacciones complejas:** `@hello-pangea/dnd` para el Kanban y constructor de etapas, **Slide-overs** (paneles laterales 360° con navegación directa 1-clic Negocio ↔ Empresa ↔ Contacto y panel operativo estructurado `OperationalProjectPanel`).
- **Emails Corporativos, Plantillas y PDF:** Renderizado al vuelo de PDFs para descarga (`GET /api/quotes/[id]/pdf`) y envío con adjunto vía Route Handler Node dedicado (`POST /api/quotes/[id]/send`), plantilla HTML oficial unificada (`wrapWithDesklyEmailShell` para presupuestos con vista previa previa al envío y para cuestionario operativo) y **firma personal enriquecida** por usuario con conversión automática de imágenes embebidas a adjuntos inline `CID`.
- **Integraciones:** Microsoft Graph API (Outlook Email `Inbox + SentItems` + Calendario bidireccional + renovación automática de suscripciones vía Cron diario), Webhook `/api/webhooks/leads` (ingesta estándar y sincronización `mode = 'questionnaire'` desde `desklyy.com/cuestionario`), REST API `/api/v1/*` para Agentes IA.

---

## 2. Arquitectura de Base de Datos (PostgreSQL / Supabase)

Modelo relacional diseñado para embudos dinámicos, variables tipadas orientadas a API, presupuestos completos y trazabilidad automática de eventos.

```sql
-- 1. USUARIOS Y ROLES (sincronizado con auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT NOT NULL,
  avatar_initials TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales' CHECK (role IN ('admin', 'sales')),
  email_signature TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. DEFINICIÓN DE VARIABLES Y PROPIEDADES PERSONALIZADAS (API-First)
CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'contact', 'deal')),
  key TEXT NOT NULL, -- auto-generada en snake_case, ej. 'mrr_estimado', 'tipo_servicio' (inmutable tras crearse para no romper API)
  label TEXT NOT NULL,
  description TEXT, -- ayuda contextual para usuarios y Agentes IA en /api/v1/schema
  section TEXT NOT NULL DEFAULT 'Propiedades personalizadas', -- agrupación visual en Slide-overs
  field_type TEXT NOT NULL CHECK (
    field_type IN ('text', 'number', 'currency', 'select', 'multi_select', 'date', 'boolean', 'url')
  ),
  options JSONB DEFAULT '[]'::jsonb, -- opciones válidas cuando field_type es select/multi_select
  default_value JSONB, -- valor por defecto opcional
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  field_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, key)
);

-- 3. EMPRESAS Y CONTACTOS
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE, -- clave para deduplicación de leads
  website TEXT,
  tax_id TEXT, -- CIF / NIF para presupuestos y contratos
  billing_address TEXT,
  billing_city TEXT,
  billing_postal_code TEXT,
  country TEXT DEFAULT 'ES',
  industry TEXT,
  company_size TEXT, -- ej. '1-10', '11-50', '51-200', '200+'
  linkedin_url TEXT,
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  job_title TEXT,
  department TEXT, -- Ventas, IT, RRHH, Finanzas, Administración, Operaciones, Marketing, Compras o personalizado (Otro)
  lead_status TEXT NOT NULL DEFAULT 'Nuevo' CHECK (lead_status IN ('Nuevo', 'Contactado', 'En Conversación', 'Finalizado', 'Negocio Abierto', 'Sin Calificar')),
  linkedin_url TEXT,
  lead_source TEXT, -- ej. 'typeform', 'linkedin', 'referral', 'outbound'
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. PIPELINES DINÁMICOS (EMBUDOS)
CREATE TABLE pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  stale_days_default INTEGER NOT NULL DEFAULT 7, -- umbral global de negocio atascado
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT, -- evita borrados accidentales en cascada
  name TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  color_code TEXT NOT NULL DEFAULT '#64748b',
  stale_days_override INTEGER, -- opcional: sobrescribe stale_days_default para esta etapa
  probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  is_won_stage BOOLEAN NOT NULL DEFAULT FALSE,
  is_lost_stage BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, -- borrado lógico para no perder históricos
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pipeline_id, id) -- habilita FK compuesta desde deals para garantizar coherencia pipeline <-> etapa
);

-- 5. NEGOCIOS (DEALS) Y MULTI-CONTACTO
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  position DOUBLE PRECISION NOT NULL DEFAULT 1000, -- fractional indexing: reordena actualizando 1 sola fila sin cascadas Realtime
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  lead_source TEXT,
  probability INTEGER CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  lost_reason TEXT, -- motivo estructurado si status = 'lost'
  next_action TEXT, -- siguiente paso estructurado (sin texto libre largo)
  next_action_date DATE,
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (pipeline_id, stage_id) REFERENCES pipeline_stages(pipeline_id, id) ON DELETE RESTRICT
);

CREATE TABLE deal_contacts (
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role_in_deal TEXT, -- ej. 'Decisor', 'Técnico', 'Facturación'
  PRIMARY KEY (deal_id, contact_id)
);

-- 6. PRESUPUESTOS Y LÍNEAS DE CONCEPTO
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT UNIQUE NOT NULL, -- ej. 'DESK-2026-0001'
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  valid_until DATE,
  terms TEXT,
  billing_snapshot JSONB, -- snapshot fiscal del cliente (razón social, CIF/NIF, dirección) al enviarse, para re-renderizar el PDF exacto meses después
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_order INTEGER NOT NULL DEFAULT 0,
  concept TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  line_total NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- 7. INTEGRACIÓN MICROSOFT OUTLOOK (EMAILS Y CALENDARIO)
CREATE TABLE oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'microsoft',
  microsoft_email TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  graph_subscription_id TEXT, -- suscripción Inbox (/messages)
  subscription_expires_at TIMESTAMPTZ,
  calendar_subscription_id TEXT, -- suscripción Calendario (/events)
  calendar_subscription_expires_at TIMESTAMPTZ,
  is_auth_invalid BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE si Microsoft devuelve 401/403 al refrescar (revocado/cambio de clave)
  last_auth_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ms_graph_id TEXT NOT NULL,
  internet_message_id TEXT UNIQUE, -- RFC 5322 Message-ID para deduplicar correos recibidos/enviados en múltiples buzones internos
  ms_conversation_id TEXT,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  to_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT,
  body_preview TEXT, -- solo preview ligero para no saturar los 500 MB de Supabase Free; cuerpo completo bajo demanda vía Graph
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, ms_graph_id)
);

-- Puente ligero opcional para asociar eventos de Outlook a un Negocio/Empresa/Contacto sin duplicar datos ni crear variables de calendario (toda la información del evento vive directamente en Outlook Calendar)
CREATE TABLE calendar_event_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ms_event_id TEXT NOT NULL, -- ID nativo del evento en Microsoft Graph (/me/events) en el buzón de user_id
  ical_uid TEXT, -- identificador iCalendar compartido entre asistentes para deduplicar actividades en Timeline
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ms_event_id)
);

-- 8. TIMELINE GLOBAL DE EVENTOS ESTRUCTURADOS (AUDITORÍA)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'ai_agent', 'webhook', 'system')),
  actor_id UUID, -- profile.id o api_key.id
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'contact', 'deal', 'quote', 'calendar_event')),
  entity_id UUID NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'stage_changed', 'variable_updated', 'quote_sent', 'email_received', 'email_sent', 'meeting_scheduled', 'meeting_updated', 'meeting_cancelled', 'call_summary', 'meeting_summary', 'internal_note', 'lead_ingested', 'questionnaire_completed', etc.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- para call_summary/meeting_summary: { outcome, objections[], summary_one_liner }; para internal_note: { text }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. PORTAL API PARA AGENTES IA
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL, -- ej. 'dsk_live_9f2a' para mostrar en UI
  key_hash TEXT NOT NULL UNIQUE, -- SHA-256 de la clave completa
  permissions TEXT NOT NULL DEFAULT 'read_write' CHECK (permissions IN ('read', 'read_write')),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ÍNDICES RECOMENDADOS
CREATE INDEX idx_deals_pipeline_stage ON deals(pipeline_id, stage_id, position);
CREATE INDEX idx_deals_company ON deals(company_id);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_emails_contact_sent ON emails(contact_id, sent_at DESC);
CREATE INDEX idx_emails_deal_sent ON emails(deal_id, sent_at DESC);
CREATE INDEX idx_calendar_links_deal ON calendar_event_links(deal_id);
CREATE INDEX idx_calendar_links_company ON calendar_event_links(company_id);
CREATE INDEX idx_calendar_links_contact ON calendar_event_links(contact_id);
CREATE INDEX idx_calendar_links_user ON calendar_event_links(user_id);
CREATE INDEX idx_calendar_links_ical_uid ON calendar_event_links(ical_uid);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_activities_deal ON activities(deal_id, created_at DESC);
CREATE INDEX idx_companies_custom_fields ON companies USING GIN (custom_fields);
CREATE INDEX idx_contacts_custom_fields ON contacts USING GIN (custom_fields);
CREATE INDEX idx_deals_custom_fields ON deals USING GIN (custom_fields);

-- SUPABASE REALTIME (WebSockets para ver cambios de IA y equipo en vivo)
ALTER PUBLICATION supabase_realtime ADD TABLE deals, activities, custom_field_definitions;

-- RPCs ATÓMICAS Y SEGURIDAD DE ESCRITURA (Stored Procedures)
-- 1) ingest_new_lead(payload JSONB) -> Ejecuta deduplicación + INSERT/UPDATE en companies, contacts, deals y activities en una única transacción atómica (incluyendo mode = 'questionnaire' para desklyy.com/cuestionario).
-- 2) append_custom_field_option(field_id UUID, new_option JSONB) -> SECURITY DEFINER para que el rol 'sales' añada opciones a campos select/multi_select sin otorgar UPDATE directo en RLS sobre custom_field_definitions.
-- 3) update_my_email_signature(signature_html TEXT) -> Permite a cualquier usuario autenticado actualizar su propia firma HTML en profiles.email_signature.
```

---

## 3. Estética y UI/UX (El «Look & Feel»)

Interfaz B2B **flat / ortogonal** de alta densidad informativa, tipografía nativa del sistema, atajos de teclado y edición instantánea sin recargas:

- **Sistema Visual y Marca:** Fondo de trabajo `#F8FAFC`, tarjetas blancas `#FFFFFF`, bordes finos `#E2E8F0`, acento corporativo `#1658F5`, textos `#0F172A` / `#334155` / `#64748B`, radios máximos de `4px`, cero sombras o degradados, padding interno amplio (`30px` en contenedores principales), alertas con borde izquierdo `3px` y logotipo oficial (`DesklyLogo` + `public/logo-deskly.jpg` + `src/app/icon.jpg`).
- **Sidebar Izquierdo:** Minimalista y oscuro (`bg-slate-950`). Solo iconos por defecto (`Dashboard` `/`, `Empresas` `/companies`, `Contactos` `/contacts`, `Pipelines` `/pipelines`, `Calendario` `/calendar`, `Settings` `/settings`) y expansible al hover.
- **Navegación sin recargas y enlace directo 1-clic (Slide-overs 360°):** Al pulsar en cualquier empresa, contacto o negocio se abre un panel lateral derecho (`Slide-over`) con edición inline de todas las variables y navegación cruzada directa 1-clic **Negocio ↔ Empresa ↔ Contacto** (via query params `?deal=` / `?id=`). Al cerrarlo se conserva el estado exacto del listado o Kanban.
- **Command Palette (`Cmd + K` / `Ctrl + K`):** Buscador global conectado a datos reales de empresas, contactos, negocios y acciones rápidas.
- **Fichas 360° Estructuradas + Cuestionario Operativo + Notas Internas:**
  - Los datos principales se organizan en **bloques de variables y propiedades estructuradas** agrupadas por sección (campos core + `custom_fields` dinámicos editables al clic: selects, multi-selects, importes, fechas, toggles, URLs), con soporte multilínea para propiedades técnicas del **Cuestionario Operativo**.
  - **Creación de propiedades al vuelo (`+ Nueva propiedad`):** Disponible desde cualquier Slide-over (`Empresa`, `Contacto`, `Negocio`) para crear variables nuevas al instante (nombre, tipo, sección, opciones y descripción), propagándose vía Realtime y `revalidateTag('crm-schema')`.
  - **Panel de Proyecto Operativo (`OperationalProjectPanel`):** Vista estructurada con sub-pestañas (`Departamentos`, `Stack y Red`, `Operativa`) y edición/alta individual por tarjeta sincronizada bidireccionalmente con las 12 propiedades de `Cuestionario Operativo`, acompañada del botón **Enviar cuestionario** desde Negocios, Empresas y Contactos.
  - **Registro de contexto y notas internas en Timeline (`ActivityMiniList`):** Eventos estructurados (`call_summary`, `meeting_summary`), hitos automáticos (`questionnaire_completed`, `quote_sent`, `stage_changed`, etc.) y **notas internas rápidas** (`internal_note`) directamente en el Timeline de cada ficha.
  - **Pestañas por ficha:**
    - *Negocio (`DealSlideOver`):* `Variables y Detalle`, `Proyecto`, `Presupuestos`, `Emails` (con etiquetas `Entrante`/`Saliente` y firma personal), `Reuniones`, `Timeline`.
    - *Empresa (`CompanySlideOver`):* `Ficha`, `Proyecto y Cuestionario`, `Negocios y Contactos`, `Actividad`.
    - *Contacto (`ContactSlideOver`):* Pestañas ordenadas con datos core (`department` + `lead_status`), `Proyecto`/empresa vinculada, negocios asociados y actividad.

---

## 4. Módulos Funcionales

### A. Dashboard y Analítica

- **Tarjetas KPI:** Leads captados este mes, Valor del Pipeline abierto (€), Tasa de Cierre (Won / Cerrados), Ticket Medio.
- **Gráfica Fluida de Evolución Comercial (Recharts + Zoom/Pan continuo):** Comparativa **Pipeline creado vs Ganado** sobre una ventana temporal continua (por defecto últimos 180 días hasta hoy, configurable entre 7 y 730 días):
  - **Zoom continuo con rueda del ratón** centrado en la posición del cursor, cambiando automáticamente la resolución entre **Por meses** (`> 150` días), **Por semanas** (`46–150` días) y **Por días** (`<= 45` días).
  - **Arrastre horizontal con ratón / trackpad** y barra de controles accesibles (**`+`**, **`-`**, **`<`**, **`>`** y **`Hoy`**) para desplazarse o hacer zoom sin ratón, mostrando rango exacto y totales EUR de la ventana visible.
- **Embudo de Conversión:** Gráfico de barras por etapa del pipeline activo.
- **Próximas Acciones Pendientes:** Listado accionable con los próximos pasos (`deals.next_action` y `next_action_date`), estados de vencimiento y salto directo al negocio correspondiente.
- **Timeline Global en Vivo:** Muro a la derecha alimentado por `activities` vía **Supabase Realtime (WebSockets)** (movimientos de etapa, actualizaciones de IA, emails, presupuestos, citas, cuestionarios completados y notas internas).

### B. Módulo de Pipelines (Tablero Kanban), Empresas y Presupuestos

- **Vista Principal y Filtros Operativos:** Selector de pipeline activo + columnas configurables por etapa (`is_active = TRUE`) con total acumulado (€) y contador de negocios. Tanto en el tablero **Kanban** como en el listado de **Empresas** se muestran badges y filtros de **`Cuestionario ✓`** y **ERP** principal.
- **Drag & Drop (`@hello-pangea/dnd`) + Supabase Realtime:** Actualización optimista en UI al arrastrar y persistencia inmediata en Supabase usando **Fractional Indexing** (`position DOUBLE PRECISION`, actualizando una única fila por movimiento sin cascadas Realtime) junto con `stage_id`, `stage_changed_at`, `last_activity_at` y registro en `activities`. Suscripción Realtime centralizada en `RealtimeProvider` sobre `deals` (con reconciliación durante el drag para evitar parpadeos) para que cualquier cambio realizado por otro comercial o por un Agente IA en segundo plano mueva la tarjeta en pantalla sin refrescar.
- **Regla de Negocio Atascado:** Alerta visual en la tarjeta cuando los días transcurridos desde `GREATEST(stage_changed_at, last_activity_at)` superan `COALESCE(stage.stale_days_override, pipeline.stale_days_default)`.
- **Tarjetas de Negocio:** Título, empresa, importe en verde (`€`), badge de prioridad, badge `Cuestionario ✓` / ERP cuando aplica, iniciales del propietario (`owner_id`) e icono de alerta si está atascado.
- **Cierre estructurado:** Si se mueve a una etapa perdida (`is_lost_stage`) o se marca `lost`, solicita seleccionar `lost_reason`.
- **Creador de Presupuestos, Vista Previa HTML y PDF In-Memory sin Storage:** Integrado en `QuoteBuilder` dentro del Slide-over del negocio:
  - Líneas dinámicas con `concepto`, `cantidad`, `precio unitario`, `% descuento` y `% IVA`.
  - Cálculo automático de `subtotal`, `discount_total`, `tax_total` y `total_amount`. Al pasar un presupuesto a `sent` o `accepted`, el CRM ofrece/sincroniza `deals.amount` con la base imponible (`subtotal - discount_total`, sin IVA).
  - **Plantilla HTML Oficial + Firma + Vista Previa:** Antes de enviar, el comercial puede abrir una **Vista previa** fiel del correo final (shell oficial ortogonal de Deskly, saludo personalizado `Hola <first_name>,`, tabla desglosada de líneas, resumen fiscal de subtotal/descuentos/base imponible/IVA/total y **firma personal** incluida por defecto y desactivable por envío).
  - **Generación al vuelo en RAM (cero Storage) vía `POST /api/quotes/[id]/send`:** Al pulsar **Enviar por Outlook**, el cliente llama al Route Handler Node (`outbound-mail.ts`), que lee PostgreSQL, renderiza el PDF en RAM como `Buffer` con `@react-pdf/renderer` (con `formatMoney` seguro y fuentes `pdfkit` trazadas en `next.config.ts` para Vercel Serverless), extrae las imágenes inline `CID` de la firma, adjunta el PDF en Base64 en Microsoft Graph `/me/sendMail`, guarda `billing_snapshot` en `quotes`, pasa el estado a `sent` y registra en `emails` y `activities`.
  - **Re-renderizado histórico exacto:** `GET /api/quotes/[id]/pdf` regenera al vuelo el PDF exacto a partir de `billing_snapshot`, `quote_items` y los totales inmutables almacenados en `quotes`.

### C. Configuración (Settings), Roles y Seguridad (2FA)

#### Matriz de Roles (Supabase RLS)

| Capacidad | Admin | Ventas |
| :--- | :---: | :---: |
| Ver y editar Empresas, Contactos, Negocios y Presupuestos del equipo | Sí | Sí |
| Crear nuevas variables/propiedades y añadir opciones desde el CRM | Sí | Sí *(alta vía `INSERT`; opciones vía RPC `append_custom_field_option`)* |
| Editar orden/etiqueta/sección o eliminar definiciones de propiedades (`DELETE`) | Sí | **No** (sin `UPDATE`/`DELETE` directo en RLS; `key` inmutable) |
| Eliminar registros de negocio/empresa/contacto (`DELETE`) | Sí | **No** (bloqueado por RLS) |
| Exportación masiva de datos (CSV/JSON) | Sí | **No** |
| Invitar / editar / desactivar usuarios (`Settings > Equipo`) | Sí | **No** |
| Constructor de Pipelines y Etapas (crear, editar y archivar) | Sí | **No** |
| Crear / revocar API Keys para Agentes IA | Sí | **No** |
| Vincular su propio Outlook y editar su firma personal HTML (`Settings > Integraciones`) | Sí | Sí |
| Configurar y verificar su propio 2FA TOTP (`Settings > Seguridad (2FA)`) | Sí | Sí |

#### Submódulos de Settings

1. **Equipo (Invite-Only):** Alta de usuarios mediante invitación por email desde Supabase Auth Admin API con campos separados `first_name` / `last_name` y cálculo automático de iniciales, además de edición de perfil/rol/estado.
2. **Constructor de Embudo (`PipelineBuilder`):** Crear y **editar en línea** pipelines existentes (nombre, días de estancamiento por defecto) y etapas existentes (nombre, color, probabilidad %, `stale_days_override`, flags ganado/perdido), reordenar etapas con drag & drop y archivar con **borrado lógico (`is_active = FALSE`)** y asistente de migración si hay deals activos (`ON DELETE RESTRICT`).
3. **Gestor Central de Variables y Propiedades:** Vista global para organizar las propiedades de Empresas, Contactos y Negocios por sección, reordenarlas, editarlas, archivarlas o eliminarlas, invalidando `revalidateTag('crm-schema')`. *(La creación rápida funciona además directamente desde cualquier Slide-over del CRM).*
4. **Integraciones y Firma de Email:** Conexión OAuth2 de Microsoft Outlook por usuario (con soporte de query params `?outlook=missing_config|connected|error`) y **Editor de Firma Personal (`SignatureEditor`)** visual + HTML con negrita, cursiva, subrayado, tamaño, color, enlaces e imágenes por URL/archivo saneadas frente a XSS (`sanitizeSignatureHtml`).
5. **Seguridad (2FA / MFA TOTP):** Alta/gestión de App Authenticator (QR y secreto manual en `MfaSettings`) exigiendo verificación **AAL2** en el paso 2 de `/login`, en `middleware.ts` y en `CrmLayout`.
6. **API Keys:** Generación y revocación de claves para los agentes IA de Deskly (la clave completa se muestra una sola vez al crearse).

---

## 5. Integraciones Críticas y API

### A. Microsoft Outlook (Email + Calendario Bidireccional)

- **OAuth2, Seguridad y Degradación Controlada (Graceful Degradation):** Flujo Microsoft Entra ID con scopes `User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`, `offline_access`. Los tokens se cifran (`AES-256-GCM`) en servidor antes de guardarse en `oauth_connections`.
  - Si al refrescar el token (en una acción o en el Cron diario) Microsoft devuelve `401`/`403` (revocación, cambio de contraseña o alerta de Azure), el backend marca `is_auth_invalid = TRUE` en `oauth_connections` (evitando bucles de reintento) y muestra un **banner rojo persistente** en el CRM a ese usuario: *"Conexión con Outlook pausada. Haz clic aquí para volver a autenticarte"*. Al reconectar OAuth2, el flag vuelve a `FALSE`.
- **Outbound (Envío de Emails, Cuestionario, Firma Personal y Presupuestos):**
  - Desde la ficha del negocio (`sendDealEmailAction`), cualquier ficha 360° (`sendQuestionnaireEmailAction` con la plantilla oficial `Cuestionario Operativo Deskly`) o mediante `POST /api/quotes/[id]/send` (`outbound-mail.ts` para presupuestos con PDF adjunto), el backend refresca el token si expiró, añade la **firma personal** del usuario (con extracción de imágenes embebidas a adjuntos inline `CID` vía `extractInlineImagesForGraph` si el toggle `includeSignature` está activo) y envía por `/me/sendMail`, registrando el correo en `emails` y actualizando `deals.last_activity_at` y `activities`.
- **Inbound y Sync de SentItems (Recepción, Respuestas Externas y Conciliación CRM):** Suscripción Webhook de Microsoft Graph (`/subscriptions` sobre `me/messages` cubriendo tanto `Inbox` como `SentItems` para capturar respuestas enviadas desde Outlook web/móvil).
  - Endpoint receptor (`/api/webhooks/microsoft-graph`) valida `GRAPH_WEBHOOK_CLIENT_STATE` (*fail-closed* con `crypto.timingSafeEqual`) y consulta el correo entrante/saliente.
  - Cuando `SentItems` notifica un correo recién enviado desde el propio CRM, `processMailNotification` concilia y actualiza el registro temporal `crm-sent-*` con el `ms_graph_id` e `internet_message_id` reales sin duplicar fila ni actividad.
  - Si el remitente/destinatario externo coincide con un registro en `contacts`, deduplica por `internet_message_id` (evitando duplicados si el correo entra en varios buzones internos), guarda el email en `emails` con `direction` (`inbound`/`outbound`), lo vincula al `deal` abierto más reciente de ese contacto/empresa (si existe), actualiza `last_activity_at` y registra en `activities`.
- **Calendario Outlook en Tiempo Real (Conexión Directa y Bidireccional):**
  - **Fuente única de verdad (sin duplicar datos ni variables de calendario):** El CRM no replica los campos de tus eventos ni crea variables para el calendario; lee, crea, edita y cancela directamente contra tu calendario real de Outlook vía Microsoft Graph API (`/me/calendarView` con `$top=250` y `/me/events`).
  - **Vista Agenda (`/calendar`):** Soporta selector de vista **Semana | Mes**, cuadrícula mensual, detalle modal por evento y alta rápida por día, reflejando en vivo tanto reuniones comerciales como eventos personales de Outlook.
  - **Asociación a Empresas, Contactos y Negocios (Automática y Manual):**
    - *Automática:* Al agendar desde una ficha (o al recibir por webhook un evento creado en Outlook cuyos asistentes coincidan con un `contact.email`), se asocia al Contacto, su Empresa y/o el Negocio en `calendar_event_links` guardando `ical_uid` y `(user_id, ms_event_id)`.
    - *Manual desde `/calendar`:* Al hacer clic en cualquier evento existente de Outlook (incluso eventos previos o sin asistentes del CRM), puedes vincularlo o desvincularlo en un clic a cualquier **Empresa**, **Contacto** o **Negocio** del CRM, apareciendo desde ese momento en su pestaña `Reuniones`.
  - **CRM → Outlook (`POST` / `PATCH` / `DELETE /me/events`):** Desde la pestaña `Reuniones` de una ficha o desde `/calendar`, ves tus huecos libres/ocupados y agendas, editas o cancelas la reunión con asistentes y enlace automático de Microsoft Teams (`isOnlineMeeting: true`). Outlook envía las invitaciones por email; el CRM guarda solo el puente mínimo (`calendar_event_links`).
  - **Outlook → CRM (Webhook `/me/events` + matching por asistentes y deduplicación por `ical_uid`):** Si agendas, modificas o cancelas una reunión directamente desde Outlook fuera del CRM y uno de los asistentes coincide con un `contact.email` (o el evento está en `calendar_event_links`), el CRM detecta el cambio, deduplica por `ical_uid` si varios usuarios internos asisten a la misma reunión (evitando duplicar registros en el Timeline), actualiza `deals.last_activity_at` y registra el evento en `activities` (`meeting_scheduled`, `meeting_updated`, `meeting_cancelled`).
- **Renovación de Suscripciones (Compatible Vercel Hobby + Anti-pausa Supabase Free):** Job diario en `vercel.json` (1 ejecución/día, límite del plan Hobby) protegido con `Authorization: Bearer ${CRON_SECRET}` que renueva en paralelo (`Promise.allSettled`) las suscripciones Graph (Mail y Calendar, cuyo máximo en Graph es ~4230 min / <3 días) y mantiene activo Supabase Free. Adicionalmente, al entrar un usuario al CRM se ejecuta una renovación oportunista en segundo plano si su suscripción vence en `<48h`.

### B. Ingesta de Leads y Cuestionario Operativo (`/api/webhooks/leads` vía RPC Atómico)

- **Seguridad:** Validación obligatoria de firma HMAC (`Typeform-Signature`) o secret header (`x-webhook-secret` validado contra `LEADS_WEBHOOK_SECRET`).
- **Transacción Atómica (`supabase.rpc('ingest_new_lead', ...)`):** Para evitar datos huérfanos si falla una llamada intermedia de red/timeout, toda la ingesta se ejecuta en **una única transacción atómica** dentro de una función PL/pgSQL (`ingest_new_lead(payload JSONB)`), soportando tanto captura estándar de leads como **`mode = 'questionnaire'`** desde `desklyy.com/cuestionario`:
  1. Deduplica y reutiliza o crea la empresa en `companies` por `domain` o nombre exacto (priorizando siempre el `company_id` ya vinculado al contacto existente para no duplicar empresas, e ignorando dominios genéricos como `gmail.com`, `outlook.com`, `hotmail.com`).
  2. Deduplica y reutiliza o crea el contacto en `contacts` por `email` (normalizado en minúsculas, con `first_name`, `last_name` y `phone`), rellenando solo campos vacíos si ya existía y promocionando `lead_status` a `'En Conversación'` en cuestionarios recibidos.
  3. Reutiliza el `deal` abierto existente cuando corresponde al cuestionario (fusionando las 12 propiedades de `Cuestionario Operativo` sin alterar etapa ni importe) o crea uno nuevo en la primera etapa del pipeline por defecto.
  4. Registra el evento (`lead_ingested` o `questionnaire_completed`) en `activities` y ejecuta `revalidatePath` sobre `/`, `/companies`, `/contacts` y `/pipelines`. Si cualquier paso falla, Postgres revierte toda la operación.

### C. Portal API para Agentes IA (`/api/v1/*`)

- **Autenticación:** Cabecera `Authorization: Bearer dsk_live_...`. El middleware verifica el hash SHA-256 contra `api_keys` activas, actualiza `last_used_at` y etiqueta cada cambio en `activities` con `actor_type = 'ai_agent'`.
- **Permisos:** Respeta estrictamente `api_keys.permissions` (`read` permite solo `GET`; `read_write` habilita `GET`, `POST`, `PATCH` y `DELETE` únicamente en `/api/v1/calendar/events` para cancelar reuniones) para que los agentes operen el CRM de forma segura y autónoma.
- **Endpoints principales:**
  - `GET /api/v1/schema`: Devuelve la estructura viva de pipelines/etapas y `custom_field_definitions` para que el agente conozca todas las variables y opciones válidas sin hardcodearlas. **Cacheado agresivamente** en servidor con `unstable_cache` / `cacheTag` (sin cookies de usuario, consultando con el cliente de servicio) e invalidado bajo demanda mediante `revalidateTag('crm-schema')` cada vez que se crea/edita una propiedad o etapa, evitando saturar las lecturas de Supabase Free.
  - `GET | POST /api/v1/companies` y `GET | PATCH /api/v1/companies/:id`
  - `GET | POST /api/v1/contacts` y `GET | PATCH /api/v1/contacts/:id`
  - `GET | POST /api/v1/deals` y `GET | PATCH /api/v1/deals/:id` (incluye filtrado por etapa/status/empresa, cambio de etapa con registro en `activities` y actualización de `custom_fields`)
  - `GET | POST /api/v1/quotes` y `GET | PATCH /api/v1/quotes/:id` (creación/consulta de presupuestos y sus líneas)
  - `GET | POST | PATCH | DELETE /api/v1/calendar/events` (proxy directo al calendario Outlook vía Graph: requiere `user_id` o lo infiere de `deal.owner_id`, verifica `permissions = 'read_write'` en mutaciones/borrados, y permite consultar disponibilidad/reuniones, agendar, mover o cancelar vinculando el `ms_event_id` e `ical_uid` al deal)
  - `GET /api/v1/emails`: Histórico de correos filtrable por `deal_id` o `contact_id` (paginación estricta obligatoria).
  - `GET /api/v1/activities`: Historial de eventos estructurados filtrable por `deal_id`, `company_id` o fecha (paginación estricta obligatoria).
- **Protección de Ventana de Contexto de IA (Paginación estricta + `pgvector` futuro):**
  - Todos los endpoints de listado e historial aplican **paginación estricta por defecto** (`limit=10` máximo por defecto en `/api/v1/activities` y `/api/v1/emails`; `limit=25` en entidades, tope máximo `limit=50`) devolviendo `{ data, pagination: { total, limit, offset, has_more } }`, evitando desbordar el contexto de tokens de los Agentes IA.
  - **Roadmap Semántico (`pgvector`):** Se prevé habilitar la extensión `pgvector` en Supabase (disponible en Free Tier) para indexar resúmenes/embeddings y permitir que los Agentes IA hagan búsqueda semántica sobre correos e históricos cuando el volumen crezca.

---

## 6. Plan de Ejecución por Fases

1. **Fase 1: Infraestructura, SQL, Auth y Privacidad.**
   - Inicializar Next.js 15 + TypeScript + Tailwind + `shadcn/ui`.
   - Desplegar esquema SQL completo en Supabase, políticas RLS (`admin` vs `sales`) y trigger de creación de `profiles`.
   - Login *invite-only* (`disable_signup: true`), **2FA TOTP AAL2 obligatorio**, política de no-indexación (`/robots.txt`, `noindex, nofollow`, `X-Robots-Tag`) y layout principal (`Sidebar` oscuro colapsable `bg-slate-950`, área `#F8FAFC` ortogonal B2B, Command Palette).
2. **Fase 2: Motor de Datos Estructurado (Empresas, Contactos y Proyecto Operativo).**
   - Listados densos con búsqueda, filtros (incluyendo `Cuestionario ✓` / ERP en Empresas y `department` / `lead_status` en Contactos) y creación rápida.
   - Slide-overs 360° con navegación directa 1-clic, edición inline de variables core + motor dinámico de `custom_fields`, botón **`+ Nueva propiedad`** y conexión real de `Cmd/Ctrl + K`.
3. **Fase 3: Pipelines Kanban, Presupuestos HTML/PDF y Timeline.**
   - Tablero Kanban con `@hello-pangea/dnd`, actualización optimista + **Supabase Realtime** sobre `deals` (con reconciliación durante el drag), filtros `Cuestionario ✓`/ERP, cálculo de negocio atascado y modal de motivo de pérdida.
   - Slide-over completo del Negocio (`Variables y Detalle`, `Proyecto` con `OperationalProjectPanel`, multi-contacto, presupuestos con **Vista previa HTML** oficial + firma + envío por `POST /api/quotes/[id]/send` con PDF en RAM, emails `Entrante`/`Saliente`, reuniones y Timeline con notas internas `internal_note`).
4. **Fase 4: Panel de Administración (Settings).**
   - Gestión de equipo (`first_name`/`last_name` e invitaciones Supabase), Constructor de Pipelines y Etapas (creación, edición inline, drag & drop, reglas `stale_days`, borrado lógico `is_active = FALSE` y migración segura), Gestor Central de Variables/Propiedades (`revalidateTag('crm-schema')`), Integraciones Outlook + Firma Personal HTML, Seguridad 2FA (TOTP) y API Keys.
5. **Fase 5: Sincronización Bidireccional Outlook (Email + Calendario Directo).**
   - Flujo OAuth2 con cifrado de tokens (`Mail` + `Calendars.ReadWrite`), envío de correos, cuestionarios (`Cuestionario Operativo Deskly`) y presupuestos con firma HTML + imágenes inline `CID` y PDF adjunto en RAM (`/me/sendMail`), receptor webhook inbound/`SentItems` con conciliación `crm-sent-*` y verificación *timing-safe* (`body_preview` ligero en Postgres).
   - Graceful degradation con `is_auth_invalid` y banner rojo persistente de reconexión si Microsoft revoca el token.
   - Conexión directa y bidireccional con Outlook Calendar (`/me/calendarView`, `POST/PATCH/DELETE /me/events`), vista `/calendar` (`Semana | Mes`, detalle modal y alta rápida por día), tabla puente `calendar_event_links`, webhook `/me/events` para cambios hechos fuera del CRM y Cron diario en Vercel Hobby (`vercel.json`) de renovación de suscripciones Graph.
6. **Fase 6: Dashboard Fluido, Webhook de Leads/Cuestionario y API IA.**
   - KPIs, **gráfica fluida continua** Recharts (zoom por rueda del ratón + arrastre horizontal + botones `+`/`-`/`<`/`>`/`Hoy`), embudo por etapa, panel **Próximas acciones pendientes** y Timeline Global en vivo con **Supabase Realtime** (`activities`).
   - Endpoint `/api/webhooks/leads` con firma HMAC/secret y **RPC atómico `ingest_new_lead()`** (captura estándar y `mode = 'questionnaire'` desde `desklyy.com/cuestionario` con 12 variables fijas en `0007`).
   - Suite `/api/v1/*` completa con paginación estricta (`limit=10` por defecto en `/activities` y `/emails`), `/api/v1/schema` cacheado (`unstable_cache`) y `/api/v1/calendar/events` (previendo `pgvector` futuro para búsqueda semántica).

---

## 7. Control de Avance, Base de Datos y Registro de Cambios

> **Regla de trabajo:** Cada vez que se cree, modifique o elimine un archivo, migración SQL, tabla, política RLS o endpoint durante el desarrollo, se actualizará obligatoriamente esta sección en `plan.md` (marcando los checkboxes, actualizando el estado de la BD y añadiendo una línea al registro cronológico).

### A. Desglose y Checklist de Ejecución

#### Fase 1: Infraestructura, Base de Datos, Auth y Layout Base
- [x] **1.1 Inicialización del proyecto:** Crear app Next.js (App Router + TypeScript + Tailwind CSS), configurar `shadcn/ui`, `lucide-react`, `cmdk` y estructura de carpetas (`src/app`, `src/components`, `src/lib`, `src/types`, `supabase/migrations`).
- [x] **1.2 Variables de entorno y clientes Supabase:** Configurado `.env.local` con el proyecto Supabase y clientes separados (`browser`, `server` SSR y `admin`) + `middleware.ts`.
- [x] **1.3 Migración SQL Base (`0001_initial_schema.sql`):** Aplicada en Supabase con las 15 tablas, FK compuesta `(pipeline_id, stage_id)`, `position DOUBLE PRECISION`, índices GIN/btree, triggers y Realtime.
- [x] **1.4 Triggers, RPCs y Seed Inicial (`0002_auth_triggers_and_seed.sql`):** Aplicada en Supabase (`handle_new_user`, `ingest_new_lead`, `append_custom_field_option` y seed *"Ventas Deskly"* con 6 etapas verificado vía API).
- [x] **1.5 Seguridad RLS (`0003_rls_policies.sql`):** Aplicada en Supabase con RLS activado en las 15 tablas y políticas `admin` vs `sales`.
- [x] **1.6 Tipos TypeScript generados:** Tipado completo `src/types/database.ts` alineado con las 15 tablas y RPCs de `0001`–`0002` (regenerar tras desplegar en Supabase si aplica).
- [x] **1.7 Autenticación Invite-Only:** Pantalla de `/login` minimalista, callback `/auth/callback` para enlaces de invitación/primer acceso y flujo `/auth/update-password`.
- [x] **1.8 App Shell (Look & Feel Linear/Vercel):**
  - Sidebar izquierdo oscuro (`bg-slate-950`) colapsado por iconos y expansible al hover (`Dashboard`, `Empresas`, `Contactos`, `Pipelines`, `Calendario`, `Settings` adaptado por rol, + perfil/logout).
  - Área de trabajo `bg-slate-50` con bordes `border-slate-200` y `RealtimeProvider` único.
  - Command Palette (`Cmd + K` / `Ctrl + K`) base funcionando para navegación rápida entre secciones.

#### Fases Siguientes y Evolución Operativa (Resumen de Control)
- [x] **Fase 2:** Listados densos + Slide-overs 360° (navegación 1-clic Negocio ↔ Empresa ↔ Contacto) + Motor dinámico de `custom_fields` + Botón `+ Nueva propiedad` in-app (con `revalidateTag('crm-schema')` y Realtime) + Búsqueda real en `Cmd/Ctrl + K` + `department` y `lead_status` en Contactos.
- [x] **Fase 3:** Tablero Kanban (`@hello-pangea/dnd` + Fractional Indexing `DOUBLE PRECISION` + `RealtimeProvider` único) + Alertas de estancamiento + Filtros `Cuestionario ✓` / ERP + Multi-contacto + Panel `OperationalProjectPanel` + Creador de Presupuestos con Vista Previa HTML y envío PDF al vuelo vía `POST /api/quotes/[id]/send` (`outputFileTracingIncludes` en `next.config.ts`).
- [x] **Fase 4:** Settings (Equipo invite-only con nombre/apellidos, Constructor de Pipelines con edición inline y borrado lógico `is_active`, Gestor Central de Variables/Propiedades, Integraciones Outlook + Firma Personal HTML `SignatureEditor`, Seguridad 2FA TOTP `MfaSettings`, API Keys).
- [x] **Fase 5:** OAuth2 Microsoft Outlook (Mail `Inbox + SentItems` + Calendario directo) + Conciliación `SentItems` (`crm-sent-*`) y deduplicación multi-buzón (`internet_message_id` e `ical_uid`) + Graceful degradation (`is_auth_invalid` + banner) + Firma personal con imágenes `CID` + Plantilla oficial `Cuestionario Operativo Deskly` + Vista `/calendar` (`Semana | Mes`) + Cron diario (`CRON_SECRET`, `Promise.allSettled`) + renovación oportunista `<48h`.
- [x] **Fase 6:** Dashboard KPIs + Gráfica fluida continua (zoom por rueda del ratón, arrastre y controles `+`/`-`/`<`/`>`/`Hoy`) + Embudo de conversión + Próximas acciones pendientes + Timeline Global Realtime (`activities` con notas internas `internal_note`) + `/api/webhooks/leads` (RPC atómico `ingest_new_lead` + `mode = 'questionnaire'`) + Suite `/api/v1/*` paginada + `/api/v1/schema` cacheado + No-indexación global (`robots.txt`, `noindex`, `X-Robots-Tag`) y 2FA AAL2 obligatorio.

### B. Estado de Base de Datos (Supabase)

| Elemento / Tabla | Estado | Migración | RLS Activo | Notas |
| :--- | :---: | :---: | :---: | :--- |
| `profiles` | Desplegado | `0001`/`0004`/`0006` | Sí | Sincronizada con `auth.users` (`first_name`, `last_name`, `full_name`, `avatar_initials`, `email_signature`) |
| `custom_field_definitions` | Desplegado | `0001`/`0007` | Sí | Creación por usuarios + 12 variables fijas bajo sección `Cuestionario Operativo`; `key` inmutable; Realtime activo |
| `companies` | Desplegado | `0001` | Sí | Incluye `tax_id`, `domain`, `custom_fields` |
| `contacts` | Desplegado | `0001`/`0005` | Sí | Incluye `email UNIQUE`, `department`, `lead_status`, `custom_fields` + índices GIN/btree |
| `pipelines` | Desplegado | `0001` | Sí | Incluye `stale_days_default`, `is_active` |
| `pipeline_stages` | Desplegado | `0001` | Sí | `ON DELETE RESTRICT`, `UNIQUE (pipeline_id, id)`, borrado lógico `is_active`, `stale_days_override` |
| `deals` | Desplegado | `0001` | Sí | FK compuesta `(pipeline_id, stage_id)`, `position DOUBLE PRECISION`, `stage_changed_at`, Realtime activo |
| `deal_contacts` | Desplegado | `0001` | Sí | Relación N:M con rol en negocio |
| `quotes` | Desplegado | `0001` | Sí | Cabecera presupuesto + `billing_snapshot` (PDF in-memory al vuelo) |
| `quote_items` | Desplegado | `0001` | Sí | Líneas con descuento e IVA |
| `oauth_connections` | Desplegado | `0001` | Sí | Tokens Outlook cifrados + `is_auth_invalid` + suscripciones Mail y Calendar |
| `emails` | Desplegado | `0001` | Sí | Solo `body_preview` ligero + `internet_message_id` para deduplicación multi-buzón |
| `calendar_event_links` | Desplegado | `0001` | Sí | Puente mínimo `UNIQUE (user_id, ms_event_id)` + `ical_uid` para deduplicar Timeline |
| `activities` | Desplegado | `0001` | Sí | Timeline estructurado (`call_summary`/`meeting_summary`, `internal_note`, `questionnaire_completed`); Realtime activo |
| `api_keys` | Desplegado | `0001` | Sí | Claves SHA-256 para Agentes IA |
| Triggers (`updated_at`, `on_auth_user_created`) | Desplegado | `0001`/`0002` | N/A | Automatización base + inmutabilidad `key` |
| RPC `ingest_new_lead(JSONB)` | Desplegado | `0002`/`0005`/`0007` | N/A | Transacción atómica todo-o-nada para webhook de leads y `mode = 'questionnaire'` |
| RPC `append_custom_field_option(UUID, JSONB)` | Desplegado | `0002` | N/A | `SECURITY DEFINER` para que `sales` añada opciones sin `UPDATE` directo en RLS |
| RPC `update_my_email_signature(TEXT)` | Desplegado | `0006` | N/A | Actualización segura de la firma HTML personal en `profiles.email_signature` |
| Publicación Realtime (`deals`, `activities`, `custom_field_definitions`) | Desplegado | `0001` | N/A | WebSockets centralizados en `RealtimeProvider` (respetando límite Free 200 conexiones) |
| Seed Pipeline inicial | Desplegado | `0002` | N/A | Pipeline *"Ventas Deskly"* y 6 etapas iniciales verificados en BD |

#### Reglas de Sincronización del Cuestionario Operativo (`desklyy.com/cuestionario` → `POST /api/webhooks/leads`)

1. **Campos y mapeo exacto:**
   * **Contacto (`contacts`):** El cuestionario solicita `Nombre` (`first_name`) y `Apellidos` (`last_name`) por separado, además de `email` y `phone` (coincidiendo exactamente con la ficha de Contacto del CRM).
   * **Empresa (`companies`):** `name`, `industry`, `company_size` (normalizando `+200` → `200+`, igual que el selector del CRM `1-10` / `11-50` / `51-200` / `200+`), `domain` automático salvo dominios genéricos (`gmail.com`, `outlook.com`, `hotmail.com`, `yahoo.*`, `icloud.com`, etc.) y las 9 variables fijas de `Cuestionario Operativo` (`departamentos_empresa`, `procedimientos_por_departamento`, `erp_principal`, `alojamiento_erp`, `crm_actual`, `correo_ofimatica`, `almacen_archivos`, `privacidad_estricta`, `red_local_minipc`).
   * **Negocio (`deals`):** `volumen_mensual`, `tareas_manuales`, `cuestionario_completado`.
2. **Casuística de deduplicación y actualización en `ingest_new_lead` (`mode = 'questionnaire'`):**
   * **Nada registrado (ni empresa ni contacto):** Crea empresa nueva, crea contacto vinculado (`lead_source = 'cuestionario'`, `lead_status = 'En Conversación'`), crea negocio nuevo en la 1.ª etapa del pipeline por defecto (`<Empresa> — Cuestionario`) y registra actividad `questionnaire_completed`.
   * **Solo contacto existente (sin `company_id`):** Busca empresa por `domain` o nombre exacto; si no existe la crea y la asigna al contacto (`COALESCE(company_id, v_company_id)`). Completa `first_name`/`last_name`/`phone` solo si estaban vacíos y sube `lead_status` a `'En Conversación'` si estaba en `'Nuevo'`, `'Contactado'` o `'Sin Calificar'`. Si tenía negocio abierto lo reutiliza; si no, crea uno.
   * **Solo empresa existente (contacto nuevo de esa empresa):** Localiza la empresa por dominio corporativo o nombre exacto, conserva el nombre ya guardado en el CRM, enriquece su stack/variables, crea al nuevo contacto dentro de esa empresa y, si la empresa ya tenía un negocio `open`, lo reutiliza añadiendo al nuevo contacto en `deal_contacts` sin duplicar deal.
   * **Contacto y empresa ya existentes (aunque escriba otro nombre comercial o use correo genérico):** Al comprobar primero `contacts.company_id` (`v_existing_company_id`), prioriza la empresa ya vinculada al contacto en el CRM (evitando crear empresas duplicadas), conserva su nombre y datos de contacto ya registrados, y actualiza las respuestas técnicas del cuestionario.
   * **Negocios abiertos vs. cerrados y reenvíos:** Nunca duplica un negocio con `status = 'open'` ni altera su etapa/título/importe; solo fusiona las variables operativas del cuestionario y actualiza `last_activity_at`. Si sus negocios anteriores estaban `won` o `lost`, sí crea un negocio nuevo para la nueva oportunidad. Si el cliente reenvía el cuestionario, sobrescribe con los últimos datos técnicos sobre la misma empresa/contacto/negocio abierto y añade un nuevo evento `questionnaire_completed`.
   * **Autenticación webhook entre proyectos:** `desklyweb` (`CRM_WEBHOOK_SECRET`) envía `x-webhook-secret` validado contra `LEADS_WEBHOOK_SECRET` en `CRMdeskly`.

### C. Registro Cronológico de Cambios (Changelog)

| Fecha | Fase | Acción / Cambio realizado | Archivos / Migraciones afectadas |
| :--- | :---: | :--- | :--- |
| 2026-11-10 | Planificación | Creación del Plan Director y definición de arquitectura SQL, variables, RLS, presupuestos, Outlook y API IA | `plan.md` |
| 2026-11-10 | Planificación | Añadida Sección 7 (Control de avance, estado de BD y changelog) y habilitada creación de variables/propiedades desde cualquier ficha del CRM por los usuarios | `plan.md` |
| 2026-11-10 | Repo / Setup | Inicialización de Git (rama `main`), creación de `.gitignore` y subida del repositorio privado `desklyy-admin/CRMdeskly` a GitHub | `.gitignore`, `plan.md` |
| 2026-11-10 | Planificación | Integrado Calendario de Outlook bidireccional directo (`/me/calendarView`, `/me/events`, webhook `/me/events`, tabla puente `calendar_event_links` sin duplicar datos ni variables, asociación automática/manual a Empresas/Contactos/Negocios y `/api/v1/calendar/events`) | `plan.md` |
| 2026-11-10 | Planificación | Añadido `ON DELETE RESTRICT` + `is_active` en etapas, caché `unstable_cache`/`revalidateTag` en `/api/v1/schema`, Supabase Realtime (`deals`, `activities`, `custom_field_definitions`) y optimizaciones para Vercel Hobby + Supabase Free | `plan.md` |
| 2026-11-10 | Planificación | Añadido RPC atómico `ingest_new_lead()`, paginación estricta (`limit=10`) + roadmap `pgvector` en `/api/v1/*`, flag `is_auth_invalid` + banner de reconexión Outlook y flujo PDF in-memory con `billing_snapshot` en `quotes` | `plan.md` |
| 2026-11-10 | Planificación | Endurecimiento técnico pre-Fase 1: suscripción `me/messages` (`Inbox + SentItems`), deduplicación multi-buzón (`internet_message_id` / `ical_uid`), RPC `append_custom_field_option` para RLS de `sales`, `DOUBLE PRECISION` (fractional indexing) en `deals.position`, FK compuesta `(pipeline_id, stage_id)`, índice GIN en `contacts`, `CRON_SECRET` + renovación oportunista `<48h`, `RealtimeProvider` único, `user_id` + control `permissions` en `/api/v1/calendar/events` y eventos `call_summary`/`meeting_summary` | `plan.md` |
| 2026-11-10 | Fase 1 | Migraciones SQL `0001`–`0003` listas en local; inicializada app Next.js 15 + TypeScript + Tailwind + `shadcn/ui` base + clientes Supabase + `middleware.ts` + Auth invite-only (`/login`, `/auth/callback`, `/auth/update-password`) + App Shell (`Sidebar` `bg-slate-950`, `CommandPalette`, `RealtimeProvider`) y verificados `typecheck` + `build` | `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `.env.local.example`, `supabase/migrations/0001_initial_schema.sql`, `0002_auth_triggers_and_seed.sql`, `0003_rls_policies.sql`, `src/**/*`, `plan.md` |
| 2026-11-10 | Fase 2 | Configurado `.env.local` de Supabase; implementados listados densos y filtros de Empresas (`/companies`) y Contactos (`/contacts`), Slide-overs 360° con edición inline, motor dinámico de los 8 tipos en `custom_fields`, botón `+ Nueva propiedad` (con `revalidateTag('crm-schema')` y Realtime) + RPC `append_custom_field_option` y búsqueda real en `Ctrl + K` | `.env.local`, `src/lib/crm/*`, `src/app/(crm)/actions/crm-entities.ts`, `src/components/ui/slide-over.tsx`, `src/components/crm/*`, `src/components/layout/command-palette.tsx`, `src/app/(crm)/companies/page.tsx`, `src/app/(crm)/contacts/page.tsx`, `plan.md` |
| 2026-11-10 | Fase 3 | Instalados `@hello-pangea/dnd` y `@react-pdf/renderer`; implementado tablero Kanban (`/pipelines`) con Fractional Indexing (`DOUBLE PRECISION`), reconciliación Realtime en drag, alertas de estancamiento y modal de motivo de pérdida; Slide-over de Negocio de 5 pestañas (variables, multi-contacto, presupuestos, emails, reuniones, timeline con `call_summary`/`meeting_summary`); creador de presupuestos y renderizado PDF in-memory en `GET /api/quotes/[id]/pdf` | `package.json`, `src/lib/crm/deals.ts`, `src/lib/crm/quotes.ts`, `src/lib/pdf/quote-pdf.tsx`, `src/app/api/quotes/[id]/pdf/route.ts`, `src/app/(crm)/actions/deals-and-quotes.ts`, `src/components/crm/kanban-board.tsx`, `src/components/crm/deal-slide-over.tsx`, `src/components/crm/quote-builder.tsx`, `src/app/(crm)/pipelines/page.tsx`, `src/app/not-found.tsx`, `plan.md` |
| 2026-11-10 | Fase 4 | Verificado despliegue SQL `0001`–`0003` en Supabase; implementado módulo Settings (`/settings`) con Equipo invite-only, Constructor de Pipelines/Etapas (drag & drop + migración de negocios al archivar), Gestor Central de Variables (`revalidateTag('crm-schema')`), Integraciones Outlook y API Keys SHA-256 con clave de un solo uso | `src/app/(crm)/actions/settings.ts`, `src/components/settings/*`, `src/app/(crm)/settings/page.tsx`, `plan.md` |
| 2026-11-10 | Fase 5 | Implementada integración bidireccional Microsoft Outlook (OAuth2 AES-256-GCM, refresco automático + graceful degradation con banner rojo en `AppShell`, envío `/me/sendMail` con PDF adjunto en RAM y lectura bajo demanda en `/api/emails/[id]/body`), vista en vivo `/calendar` con vínculo 1-clic (`calendar_event_links`), receptor webhook Graph (`me/messages` Inbox+SentItems y `me/events` deduplicados por `internet_message_id` e `ical_uid`) y Cron diario Vercel Hobby (`vercel.json` + `/api/cron/daily`) con renovación oportunista `<48h` | `vercel.json`, `src/lib/security/crypto.ts`, `src/lib/microsoft/graph.ts`, `src/app/api/outlook/*`, `src/app/api/emails/[id]/body/route.ts`, `src/app/api/webhooks/microsoft-graph/route.ts`, `src/app/api/cron/daily/route.ts`, `src/app/(crm)/actions/outlook.ts`, `src/components/crm/calendar-view.tsx`, `src/app/(crm)/calendar/page.tsx`, `src/components/layout/app-shell.tsx`, `src/app/(crm)/layout.tsx`, `src/components/settings/integrations-settings.tsx`, `src/components/crm/quote-builder.tsx`, `src/components/crm/deal-slide-over.tsx`, `plan.md` |
| 2026-11-10 | Fase 6 | Instalado `recharts`; implementado Dashboard (`/` con 4 KPIs, LineChart evolución mensual, BarChart embudo por etapa y Timeline Global en vivo vía Realtime); webhook `/api/webhooks/leads` con firma HMAC/secret y RPC atómico `ingest_new_lead()`; suite completa `/api/v1/*` (`schema` con `unstable_cache`, `companies`, `contacts`, `deals`, `quotes`, `calendar/events`, `emails`, `activities`) con auth SHA-256, control `permissions` y paginación estricta | `package.json`, `src/lib/api/v1-auth.ts`, `src/app/api/webhooks/leads/route.ts`, `src/app/api/v1/**`, `src/components/crm/dashboard-view.tsx`, `src/app/(crm)/page.tsx`, `plan.md` |
| 2026-11-10 | UI / Marca | Aplicado sistema de diseño flat/ortogonal B2B (`#F8FAFC`, `#FFFFFF`, `#1658F5`, `#0F172A`, `#334155`, `#64748B`, `#E2E8F0`), fuentes nativas del sistema, radios máx. `4px`, cero sombras/degradados, padding `30px` en contenedores, alertas con borde izquierdo `3px`, logotipo oficial (`DesklyLogo` SVG + `icon.svg` + `public/logo-deskly.jpg`) y alineado el PDF de presupuestos | `public/logo-deskly.jpg`, `src/app/icon.svg`, `src/components/brand/deskly-logo.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `tailwind.config.ts`, `src/components/**`, `src/lib/pdf/quote-pdf.tsx`, `plan.md` |
| 2026-11-10 | BD / Equipo | Añadidas columnas `first_name` y `last_name` en `profiles` (`0004_profile_names.sql`), actualizado trigger `handle_new_user()` para calcular iniciales (`1ª letra nombre + 1ª letra apellido`), normalizado el perfil inicial de administración con nombre/apellidos/iniciales e integrados campos separados en invitaciones, edición de equipo y `/auth/update-password` | `supabase/migrations/0004_profile_names.sql`, `src/lib/crm/profiles.ts`, `src/types/database.ts`, `src/app/(crm)/actions/settings.ts`, `src/components/settings/team-settings.tsx`, `src/app/auth/update-password/page.tsx`, `src/app/(crm)/layout.tsx`, `plan.md` |
| 2026-11-10 | BD / Contactos | Añadidas columnas base `department` (selector `Ventas`, `IT`, `RRHH`, `Finanzas`, `Administración`, `Operaciones`, `Marketing`, `Compras` + `Otro` editable) y `lead_status` (`Nuevo`, `Contactado`, `En Conversación`, `Finalizado`, `Negocio Abierto`, `Sin Calificar`) en `contacts` (`0005_contact_department_lead_status.sql`), actualizado `ingest_new_lead()`, API `/api/v1/contacts`, formulario de creación, tabla, filtros y Slide-over 360° | `supabase/migrations/0005_contact_department_lead_status.sql`, `src/lib/crm/contacts.ts`, `src/types/database.ts`, `src/app/(crm)/actions/crm-entities.ts`, `src/app/api/v1/contacts/**`, `src/app/api/webhooks/leads/route.ts`, `src/components/crm/contacts-view.tsx`, `src/components/crm/contact-slide-over.tsx`, `plan.md` |
| 2026-11-10 | UI / Config | Sustituido `DesklyLogo` y favicon por la imagen original adjunta (`public/logo-deskly.jpg` y `src/app/icon.jpg`) y corregido import ESM en `tailwind.config.ts` | `src/components/brand/deskly-logo.tsx`, `src/app/icon.jpg`, `public/logo-deskly.jpg`, `tailwind.config.ts`, `plan.md` |
| 2026-11-10 | Outlook OAuth | Añadido manejo de query params `?outlook=missing_config|connected|error` en Settings (pestaña `Integraciones` automática y alertas de estado), unificado el CTA **"Iniciar sesión con Outlook"** en Settings y Calendario, y configurados `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY` (32 bytes) y secretos de cron/webhooks en `.env.local` | `.env.local`, `src/app/(crm)/settings/page.tsx`, `src/components/settings/settings-view.tsx`, `src/components/settings/integrations-settings.tsx`, `src/components/crm/calendar-view.tsx`, `plan.md` |
| 2026-11-10 | Seguridad | Endurecimiento pre-publicación/despliegue: validación *fail-closed* con `crypto.timingSafeEqual` en `GRAPH_WEBHOOK_CLIENT_STATE` (`/api/webhooks/microsoft-graph`) y bloqueo de *open redirect* (`//`, `/\`) en `/auth/callback` y `/login` | `src/app/api/webhooks/microsoft-graph/route.ts`, `src/app/auth/callback/route.ts`, `src/app/login/page.tsx`, `plan.md` |
| 2026-11-10 | Settings / Pipelines | Añadida edición completa en línea de pipelines (nombre, días de estancamiento por defecto) y de etapas existentes (nombre, color, probabilidad %, días de estancamiento y flags ganado/perdido) en `PipelineBuilder`, con saneado/validación en `updatePipelineAction` y `updateStageAction` | `src/components/settings/pipeline-builder.tsx`, `src/app/(crm)/actions/settings.ts`, `plan.md` |
| 2026-11-10 | Automatizaciones / Outlook | Añadido botón **Enviar cuestionario** en las fichas 360° de Negocios, Empresas y Contactos (`DealSlideOver`, `CompanySlideOver`, `ContactSlideOver`), plantilla HTML oficial `Cuestionario Operativo Deskly` con saludo personalizado `Hola <first_name>,` (`buildOperationalQuestionnaireEmail`), envío por Outlook y registro en `emails` y `activities` (`sendQuestionnaireEmailAction`) | `src/lib/email/templates.ts`, `src/app/(crm)/actions/outlook.ts`, `src/components/crm/questionnaire-sender.tsx`, `src/components/crm/deal-slide-over.tsx`, `src/components/crm/company-slide-over.tsx`, `src/components/crm/contact-slide-over.tsx`, `plan.md` |
| 2026-11-10 | Privacidad / No-Indexación | Bloqueada la indexación en buscadores: `robots.txt` con `Disallow: /` accesible sin login (`middleware.ts`), metadatos `robots: noindex, nofollow` en `layout.tsx` y cabecera global `X-Robots-Tag` en `next.config.ts` | `src/app/robots.ts`, `src/app/layout.tsx`, `next.config.ts`, `src/middleware.ts`, `plan.md` |
| 2026-11-10 | Calendario | Añadido selector de vista **Semana \| Mes** en `/calendar` (`CalendarView`) con cuadrícula mensual, detalle modal por evento, alta rápida por día, corrección de clave de fecha local (`toLocalDateKey`) y límite ampliado `$top=250` en `listCalendarView` | `src/components/crm/calendar-view.tsx`, `src/lib/microsoft/graph.ts`, `plan.md` |
| 2026-11-10 | Email / Firma | Añadida firma personal enriquecida por usuario (`0006_profile_email_signature.sql`, columna `profiles.email_signature` + RPC `update_my_email_signature`), editor visual + HTML en Settings (`SignatureEditor`: negrita, cursiva, subrayado, tamaño de letra, color, enlaces e imágenes por URL/archivo), saneado XSS (`sanitizeSignatureHtml`), conversión automática a adjuntos inline CID (`extractInlineImagesForGraph`) e inyección al pie en `sendDealEmailAction` | `supabase/migrations/0006_profile_email_signature.sql`, `src/types/database.ts`, `src/lib/email/templates.ts`, `src/lib/microsoft/graph.ts`, `src/app/(crm)/actions/outlook.ts`, `src/components/settings/signature-editor.tsx`, `src/components/settings/integrations-settings.tsx`, `src/components/settings/settings-view.tsx`, `src/app/(crm)/settings/page.tsx`, `plan.md` |
| 2026-11-10 | Email / Firma UI | Mostrada la firma personal ya agregada por defecto dentro del redactor de emails (`DealSlideOver`) y envíos de presupuesto (`QuoteBuilder`), con opción por envío para quitarla o volver a incluirla (`includeSignature`, `getMyEmailSignatureAction`) | `src/app/(crm)/actions/outlook.ts`, `src/components/crm/deal-slide-over.tsx`, `src/components/crm/quote-builder.tsx`, `plan.md` |
| 2026-11-10 | Outlook / Bugfix | Corregida duplicación de emails salientes en el historial cuando el webhook de Microsoft Graph (`SentItems`) notifica un correo recién enviado desde el CRM: `processMailNotification` ahora concilia y actualiza el registro `crm-sent-*` con el `ms_graph_id` e `internet_message_id` reales sin duplicar fila ni actividad | `src/app/api/webhooks/microsoft-graph/route.ts`, `plan.md` |
| 2026-11-10 | UI / Emails | Cambiadas etiquetas de dirección en el historial de correos (`DealSlideOver`) de `inbound`/`outbound` a **Entrante** (verde `success`) y **Saliente** (azul `brand`) | `src/components/crm/deal-slide-over.tsx`, `plan.md` |
| 2026-11-11 | Seguridad / 2FA | Configurado `disable_signup: true` (invite-only estricto) y verificado TOTP MFA en Supabase Auth; implementado flujo completo de doble verificación con App Authenticator (`MfaSettings` con QR/secreto en `Settings > Seguridad (2FA)`, paso 2 en `/login` y verificación obligatoria AAL2 en `middleware.ts` y `CrmLayout`) | `src/components/settings/mfa-settings.tsx`, `src/components/settings/settings-view.tsx`, `src/app/login/page.tsx`, `src/middleware.ts`, `src/app/(crm)/layout.tsx`, `plan.md` |
| 2026-11-11 | Cuestionario / Webhook | Creadas 12 propiedades fijas bajo la sección `Cuestionario Operativo` (`0007_questionnaire_sync.sql`), ampliado `ingest_new_lead` para soportar `mode = 'questionnaire'` (priorizando la empresa ya vinculada del contacto, enriquecimiento y reutilización de negocio abierto sin duplicar), revalidación automática en `/api/webhooks/leads`, visualización multilínea en `CustomFieldsPanel` y etiqueta `questionnaire_completed` en `ActivityMiniList` | `supabase/migrations/0007_questionnaire_sync.sql`, `src/app/api/webhooks/leads/route.ts`, `src/components/crm/custom-fields-panel.tsx`, `src/components/crm/activity-mini-list.tsx`, `plan.md` |
| 2026-11-11 | UI / Fichas de Proyecto | Reorganizados `CompanySlideOver` (pestañas `Ficha`, `Proyecto y Cuestionario`, `Negocios y Contactos`, `Actividad`) y `DealSlideOver` (nueva pestaña `Proyecto`) mediante el panel estructurado `OperationalProjectPanel` con sub-vistas (`Departamentos`, `Stack y Red`, `Operativa`), carga de `deals` en `getCompanyRelationsAction` y de empresa vinculada en `getDealDetailsAction` | `src/components/crm/operational-project-panel.tsx`, `src/components/crm/company-slide-over.tsx`, `src/components/crm/deal-slide-over.tsx`, `src/components/crm/custom-fields-panel.tsx`, `src/app/(crm)/actions/crm-entities.ts`, `src/app/(crm)/actions/deals-and-quotes.ts`, `plan.md` |
| 2026-11-11 | UX / Productividad | Añadida navegación directa 1-clic Negocio ↔ Empresa ↔ Contacto (`?deal=` / `?id=`), badges y filtros de `Cuestionario ✓` / ERP en Kanban (`KanbanBoard`) y Empresas (`CompaniesView`), pestañas ordenadas en `ContactSlideOver`, edición/alta individual por tarjeta en `OperationalProjectPanel`, notas internas en Timeline (`internal_note`) y panel **Próximas acciones pendientes** en Dashboard | `src/components/crm/operational-project-panel.tsx`, `src/components/crm/company-slide-over.tsx`, `src/components/crm/deal-slide-over.tsx`, `src/components/crm/contact-slide-over.tsx`, `src/components/crm/kanban-board.tsx`, `src/components/crm/companies-view.tsx`, `src/components/crm/activity-mini-list.tsx`, `src/components/crm/dashboard-view.tsx`, `src/app/(crm)/page.tsx`, `src/app/(crm)/actions/deals-and-quotes.ts`, `plan.md` |
| 2026-11-11 | Email / Presupuestos | Unificada la plantilla HTML oficial de Deskly (`wrapWithDesklyEmailShell` y `buildQuoteEmailHtml`: logo, marco ortogonal, tipografía, azul `#1658F5`, saludo personalizado `Hola <first_name>,`, tabla desglosada por concepto/cantidad/precio/importe, desglose de subtotal/descuentos/base imponible/IVA/total y firma) en los envíos de presupuestos por Outlook, añadida **Vista previa** en `QuoteBuilder`, trasladado el envío con PDF adjunto a `POST /api/quotes/[id]/send` (`runtime = "nodejs"` vía `outbound-mail.ts` y `formatMoney` seguro en `quote-pdf.tsx`) e incluidas las fuentes estándar de `pdfkit` (`outputFileTracingIncludes` en `next.config.ts`) para Vercel Serverless | `next.config.ts`, `src/lib/email/templates.ts`, `src/lib/crm/outbound-mail.ts`, `src/lib/pdf/quote-pdf.tsx`, `src/app/api/quotes/[id]/send/route.ts`, `src/app/(crm)/actions/outlook.ts`, `src/components/crm/quote-builder.tsx`, `src/components/crm/deal-slide-over.tsx`, `plan.md` |
| 2026-11-11 | Dashboard / Gráfica | Reemplazada la gráfica estática por navegación fluida con rueda del ratón (zoom continuo centrado en el cursor entre resolución mensual, semanal y diaria) y arrastre horizontal en `DashboardView` (`buildFluidEvolutionSeries`, controles `+`/`-`/`<`/`>`/`Hoy` y totales EUR del rango) alimentada desde `page.tsx`; actualizada además toda la descripción general y técnica del CRM en `plan.md` (Secciones 1–7) al estado actual | `src/components/crm/dashboard-view.tsx`, `src/app/(crm)/page.tsx`, `plan.md` |

