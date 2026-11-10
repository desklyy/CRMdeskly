# Deskly CRM

CRM comercial interno de Deskly orientado 100% a variables y datos estructurados (sin cajas de texto libre), preparado para operación conjunta entre el equipo comercial y Agentes IA.

## Stack Tecnológico

- **Framework:** Next.js 15 (App Router, TypeScript, Server Actions + Route Handlers)
- **Estilos y UI:** Tailwind CSS, componentes estilo `shadcn/ui`, Lucide React, `cmdk` (`Ctrl + K` / `Cmd + K`), Recharts, `@hello-pangea/dnd`
- **Base de Datos, Auth & Realtime:** Supabase (PostgreSQL, Row Level Security `admin` / `sales`, Auth *invite-only*, Realtime centralizado en `RealtimeProvider`)
- **PDF al vuelo:** `@react-pdf/renderer` (renderizado en RAM sin Storage)
- **Integraciones:** Microsoft Graph API (Outlook Email + Calendario bidireccional), Webhooks de Leads (`ingest_new_lead`), API REST `/api/v1/*`

## Puesta en marcha local

1. **Variables de entorno:** copia `.env.local.example` a `.env.local` y configura al menos las claves de Supabase:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. **Migraciones SQL (en Supabase SQL Editor, por orden):**
   1. `supabase/migrations/0001_initial_schema.sql`
   2. `supabase/migrations/0002_auth_triggers_and_seed.sql`
   3. `supabase/migrations/0003_rls_policies.sql`
3. **Primer usuario Administrador:** crea o invita el usuario en **Supabase > Authentication > Users** y ejecuta en el SQL Editor:
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE email = 'tu-email@deskly.es';
   ```
4. **Instalar y arrancar:**
   ```bash
   npm install
   npm run dev
   ```

## Scripts disponibles

- `npm run dev`: servidor de desarrollo (`http://localhost:3000`)
- `npm run build`: build de producción Next.js
- `npm run typecheck`: comprobación de tipos (`tsc --noEmit`)
- `npm run lint`: verificación ESLint

## Rutas principales

- `/`: Dashboard KPIs, gráficos Recharts y Timeline Global en vivo
- `/companies`: Empresas, filtros, Slide-over 360° y propiedades dinámicas
- `/contacts`: Contactos, filtros, Slide-over 360° y propiedades dinámicas
- `/pipelines`: Tablero Kanban con Fractional Indexing, alertas de estancamiento y presupuestos PDF (`/api/quotes/[id]/pdf`)
- `/calendar`: Calendario directo bidireccional de Microsoft Outlook
- `/settings`: Equipo (*invite-only*), constructor de embudos/etapas, gestor de variables, Outlook OAuth2 y API Keys

## API para Agentes IA y Webhooks

- `GET /api/v1/schema` (cacheado con `unstable_cache` / etiqueta `crm-schema`)
- `GET | POST /api/v1/companies` y `GET | PATCH /api/v1/companies/:id`
- `GET | POST /api/v1/contacts` y `GET | PATCH /api/v1/contacts/:id`
- `GET | POST /api/v1/deals` y `GET | PATCH /api/v1/deals/:id`
- `GET | POST /api/v1/quotes` y `GET | PATCH /api/v1/quotes/:id`
- `GET | POST | PATCH | DELETE /api/v1/calendar/events`
- `GET /api/v1/emails` y `GET /api/v1/activities` (paginación por defecto `limit=10`, máx. `50`)
- `POST /api/webhooks/leads` (firma HMAC `Typeform-Signature` o secreto + RPC atómico `ingest_new_lead`)
- `POST /api/webhooks/microsoft-graph` y `GET /api/cron/daily` (programado en `vercel.json`)

