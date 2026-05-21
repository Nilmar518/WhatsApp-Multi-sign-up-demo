# Plan: Dashboard Stats Desplazadas + Bottom Nav Hidden Tabs

> Creado: 2026-05-20
> Estado: Pendiente de re-aplicar

---

## Contexto

El dashboard original (`src/components/dashboard/DashboardView.tsx`) fue desplazado para dar paso al nuevo diseño centrado en el calendario de reservas. Los componentes estadísticos deben re-integrarse en una fase posterior, posiblemente como una sección secundaria o en una vista "Analytics".

---

## Bottom Nav — Tabs Ocultos

Ver también: `.planning/bottom-nav-hidden-tabs.md`

Tabs eliminados temporalmente de `src/layout/BottomNav.tsx`:
- **Mensajes** → `/mensajes`
- **Inventario** → `/inventory`
- **WhatsApp** → `/mensajes?channel=whatsapp`
- **Messenger** → `/mensajes?channel=messenger`
- **Instagram** → `/mensajes?channel=instagram`

---

## Dashboard Stats — Componentes a Re-integrar

### 1. `KpiCard` (líneas 37–62 de DashboardView.tsx)

```tsx
interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  iconBg: string;       // Tailwind class, e.g. 'bg-brand/10'
  valueColor: string;   // Tailwind class, e.g. 'text-brand'
}
```

**Instancias que se usaban (4 cards en fila):**
| Label key | Value | Icon |
|-----------|-------|------|
| `dash.kpi.msgsToday` | count mensajes hoy | `MessageSquare` |
| `dash.kpi.activeConvs` | total conversaciones | `Users` |
| `dash.kpi.channels` | `{n}/3` conectados | `Wifi` |
| `dash.kpi.products` | total productos | `Package` |

**Datos:** `waMessages`, `msgrMessages`, `igMessages` (de `useMessages` hooks), `waCatalog.products.length`.

---

### 2. `ChannelCard` (líneas 64–145 de DashboardView.tsx)

```tsx
interface ChannelCardProps {
  channel: 'whatsapp' | 'messenger' | 'instagram';
  isConnected: boolean;
  messagesToday: number;
  conversations: number;
}
```

**3 instancias** (WhatsApp, Messenger, Instagram). Cada card tiene:
- Color top-border por canal (`--ch-wa`, `--ch-ms`, `--ch-ig`)
- Stats: mensajes hoy + conversaciones activas
- CTA: "Ver Conversaciones" → `navigate('/mensajes?channel=X')`

---

### 3. `RecentConversations` (líneas 147–201 de DashboardView.tsx)

```tsx
type ChannelContact = Contact & { channel: 'whatsapp' | 'messenger' | 'instagram' };
// items: top 7 conversaciones combinadas, ordenadas por timestamp
```

Avatares generados por `avatarBg(waId)` (hash → paleta de 8 colores brand).

---

### 4. `CatalogCard` (líneas 203–290 de DashboardView.tsx)

Props: `businessId`, `catalog`, `activeCatalogId`, `catalogIntegrationId`, `catalogStatus`, `onCatalogLinked`.

Muestra: nombre del catálogo, ID, breakdown de productos (total / in-stock / out-of-stock). Link → `/inventory`.

---

### 5. Properties Card (líneas 292–381 de DashboardView.tsx)

Hook: `useChannexProperties(businessId)` — top 3 propiedades con badges de Airbnb/Booking.com. Link → `/channex`.

---

### 6. Props de DashboardView (entrada de datos)

```typescript
interface DashboardViewProps {
  businessId: string;
  // WhatsApp
  isWaActive: boolean;
  waMessages: Message[];
  waConversations: Contact[];
  waCatalog: CatalogData | null;
  activeCatalogId: string | undefined;
  catalogIntegrationId: string | null;
  catalogStatus: IntegrationStatus;
  onCatalogLinked: () => void;
  // Messenger
  isMsgrConnected: boolean;
  msgrMessages: Message[];
  msgrConversations: Contact[];
  // Instagram
  isIgConnected: boolean;
  igMessages: Message[];
  igConversations: Contact[];
}
```

Todos los datos vienen de `App.tsx` via hooks: `useMessages(integrationId)`, `useConversations(messages)`.

---

## Dónde Volver a Integrar

Cuando se reactive, las stats pueden ir:
- **Opción A:** Sección colapsable debajo del calendario en el dashboard
- **Opción B:** Ruta separada `/analytics` en el menú lateral
- **Opción C:** Segunda tab dentro del dashboard (tab "Reservas" + tab "Mensajes")

El código fuente de `DashboardView.tsx` se mantiene intacto — solo cambia qué renderiza la ruta `/`.
