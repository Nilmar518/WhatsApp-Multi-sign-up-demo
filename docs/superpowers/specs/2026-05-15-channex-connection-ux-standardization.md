# Spec: Channex Connection UX Standardization

**Date:** 2026-05-15  
**Branch:** feat/messaging-inbox  
**Scope:** `AirbnbConnectionPanel`, `BookingConnectionPanel`, `ChannexOAuthIFrame`, `ChannexHub`

---

## Problem

Two inconsistencies exist in the Channex connection tabs:

1. **Booking.com opens a browser popup** for channel connection, while Airbnb embeds the Channex OAuth flow in an iframe directly in the tab. The correct, consistent approach is the inline iframe.
2. **Empty state (no Channex property found)** shows a plain text chip in both tabs: `"No Channex property found. Create one in the Properties tab first."` — with no visual guidance on what to do or how to proceed.

---

## Goals

- Booking.com connection panel uses an embedded iframe (same as Airbnb).
- Both tabs show an identical, visually guided empty state when no Channex property exists.
- The empty state navigates users to the Properties tab via a button.
- No changes to other tabs (Properties, Pools) or existing data flows.

---

## Design

### 1. `ChannexOAuthIFrame` — parameterized by channel

**File:** `apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx`

Refactor the component to accept channel and token-fetch as props instead of hardcoding Airbnb:

```ts
interface Props {
  propertyId: string;
  channel: 'ABB' | 'BDC';
  getToken: (propertyId: string) => Promise<string>;
  onConnected?: () => void;
}
```

Changes:
- Replace hardcoded `getAirbnbSessionToken(propertyId)` call with `getToken(propertyId)`.
- Replace hardcoded `channels: 'ABB'` in `buildIFrameUrl` with `channel` prop.
- Remove the `getAirbnbCopyLink` CSP fallback import and the `handleManualFallback` logic — it was Airbnb-specific. The "Open in new tab instead" escape-hatch button is removed from the component. Retry is the only fallback.
- All lifecycle states (IDLE → FETCHING → RENDERING → CONNECTED → ERROR), retry logic, and loading bar remain unchanged.

**Airbnb call site** (`AirbnbConnectionPanel`):
```tsx
<ChannexOAuthIFrame
  key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
  propertyId={baseProperty.channex_property_id}
  channel="ABB"
  getToken={getAirbnbSessionToken}
/>
```

**Booking.com call site** (`BookingConnectionPanel`):
```tsx
<ChannexOAuthIFrame
  key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
  propertyId={baseProperty.channex_property_id}
  channel="BDC"
  getToken={(id) => getBookingSessionToken(tenantId).then((r) => r.token)}
/>
```

`BookingConnectionPanel` obtains `baseProperty` from `useChannexProperties(tenantId)` (all properties, same as Airbnb), using `allProperties[0]`.

---

### 2. `BookingConnectionPanel` restructure

**File:** `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`

Remove:
- `buildPopupUrl()` helper function
- `openCenteredPopup()` helper function
- `getBookingSessionToken` import (replaced by inline usage in `getToken` prop)
- "Connect via Channex" button (connection is now via iframe)
- `connecting` state

Add:
- `allProperties` from `useChannexProperties(tenantId)` (no source filter) — same pattern as Airbnb
- `iframeReloadToken` state + "Reconnect Booking.com" link (mirrors Airbnb's "Reconnect Airbnb")
- `ChannexOAuthIFrame` embedded in the accordion body (same position as Airbnb)

Keep:
- Accordion header/collapse behavior
- "Sync Rooms & Rates" button (`handleSync`)
- "Disconnect" button (`handleDisconnect`)
- Error and synced banners
- Connected properties grid + MessagesInbox

Panel body layout (when `baseProperty` exists):
1. `ChannexOAuthIFrame` (embedded)
2. Error/sync banners
3. Bottom row: "Reconnect Booking.com" link (left) + "Sync Rooms & Rates" + "Disconnect" buttons (right)

---

### 3. `NoPropertyGuide` — shared empty state component

**File:** `apps/frontend/src/channex/components/connection/NoPropertyGuide.tsx` *(new)*

Renders a 3-step guide when no Channex property exists. Used identically in both connection panels.

```ts
interface Props {
  channel: 'airbnb' | 'booking';
  onNavigateToProperties: () => void;
}
```

**Layout:** vertical stack of 3 cards, `space-y-3`.

**Card anatomy:**
```
┌─────────────────────────────────────────────────────────┐
│  ① (circle)  │  Title (font-semibold)                   │
│              │  Description (text-content-2, text-sm)   │
│              │  [→ Ir a Properties]  ← only step 1      │
└─────────────────────────────────────────────────────────┘
```

- Card: `rounded-xl border border-edge bg-surface-raised px-4 py-4 flex items-start gap-4`
- Number circle: `flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white text-sm font-bold`
- Step 1 button: `mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity`

**Steps content:**

| # | Title | Description | Action |
|---|-------|-------------|--------|
| 1 | Crea tu primera propiedad | Ve a la pestaña **Properties** y completa el asistente de configuración para registrar tu propiedad en Channex. | Button: `→ Ir a Properties` → `onNavigateToProperties()` |
| 2 | Conecta tu cuenta de [Airbnb / Booking.com] | Regresa a esta pestaña y autoriza el acceso desde el panel de conexión que aparecerá aquí. | — |
| 3 | Sincroniza tus listings | Usa el botón **Sync Listings** (Airbnb) o **Sync Rooms & Rates** (Booking.com) para importar tus propiedades. | — |

Step 2 title and step 3 sync button label use the `channel` prop for channel-specific wording.

---

### 4. `ChannexHub` — prop drilling

**File:** `apps/frontend/src/channex/ChannexHub.tsx`

Pass `onNavigateToProperties` to both connection panels:

```tsx
{activeSubTab === 'airbnb' && (
  <AirbnbConnectionPanel
    tenantId={businessId}
    onNavigateToProperties={() => setActiveSubTab('properties')}
  />
)}
{activeSubTab === 'booking' && (
  <BookingConnectionPanel
    tenantId={businessId}
    onNavigateToProperties={() => setActiveSubTab('properties')}
  />
)}
```

Both panels pass this callback into `<NoPropertyGuide onNavigateToProperties={...} />`.

---

## File Inventory

| File | Change |
|------|--------|
| `components/connection/ChannexOAuthIFrame.tsx` | Refactor: add `channel` + `getToken` props, remove Airbnb-specific imports |
| `components/connection/AirbnbConnectionPanel.tsx` | Update `ChannexOAuthIFrame` call site; add `onNavigateToProperties` prop; replace plain empty state with `NoPropertyGuide` |
| `components/connection/BookingConnectionPanel.tsx` | Remove popup logic; add iframe; add `onNavigateToProperties` prop; replace plain empty state with `NoPropertyGuide` |
| `components/connection/NoPropertyGuide.tsx` | New shared component |
| `ChannexHub.tsx` | Pass `onNavigateToProperties` to both panels |

No backend changes required.

---

## Out of Scope

- The Airbnb CSP copy-link fallback (`getAirbnbCopyLink`, `handleManualFallback`, "Open in new tab instead" button) is removed entirely from `ChannexOAuthIFrame` as it was Airbnb-specific. Retry is the only recovery path in the generic component.
- Pools tab and Properties tab are untouched.
- No changes to API layer or Channex backend calls.
