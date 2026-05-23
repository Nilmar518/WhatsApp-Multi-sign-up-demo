# Integration View Refactor — Design Spec

**Date:** 2026-05-22  
**Scope:** Visual/structural refactor of the Airbnb and Booking.com integration views inside `ChannexHub`

---

## Overview

Currently, when a user navigates to the Airbnb or Booking.com sub-tab in `ChannexHub`, the first thing they see is channel connection/management UI (`ChannelManagementPanel` + OAuth flow). The primary content — properties, reservations, messages — is buried.

This refactor reorganizes each integration view into **4 flat tabs**, making properties, reservations, and messages the primary content and moving channel/connection configuration to a dedicated "Configuración" tab.

---

## New Tab Structure (per integration)

Each integration view (Airbnb, Booking.com) exposes these 4 tabs in order:

| # | Tab | Content |
|---|-----|---------|
| 1 | **Propiedades** | List of properties linked to this OTA. Click → drill into `PropertyDetail` (rooms, ARI, etc.) |
| 2 | **Reservas** | Aggregated reservations from all properties of this OTA, with date-range + property filters |
| 3 | **Mensajes** | Aggregated message threads from all properties of this OTA, with property filter |
| 4 | **Configuración** | Channel management (`ChannelManagementPanel`) + OAuth/connection flow |

The default tab when entering an integration is **Propiedades**.

---

## Component Architecture

### New component: `IntegrationView`

A shared component used by both Airbnb and Booking.com. Replaces `AirbnbConnectionPanel` and `BookingConnectionPanel` as the top-level orchestrator.

```
IntegrationView
  props:
    tenantId: string
    source: 'airbnb' | 'booking'
    onNavigateToProperties: () => void   (kept for back-compat)
```

Internal state: `activeTab: 'properties' | 'reservations' | 'messages' | 'settings'`

### Tab 1 — Propiedades

Reuses the existing `PropertiesList` filtered by `source` (already works via `useChannexProperties(tenantId, { source })`). Clicking a property drills into `PropertyDetail` (existing component, unchanged).

### Tab 2 — Reservas

New component: `AggregatedReservationsPanel`

- Accepts `propertyIds: string[]` and `tenantId: string`
- Fetches reservations for each property (calls `getPropertyBookings` per property)
- Merges results into a single list sorted by check-in date descending
- Shows a property name chip on each row (needs `properties: ChannexProperty[]` prop to resolve names)
- **Filters (UI-only, client-side):**
  - **Property filter:** `<select>` with "Todas" + one option per property name
  - **Date range:** two `<input type="date">` fields (from / to) filtering by check-in date
  - **Clear filters** link resets both to default
- Clicking a reservation opens the existing `ReservationDetailModal`

> `ReservationsPanel` currently accepts a single `propertyId`. `AggregatedReservationsPanel` is a new wrapper — it does NOT modify `ReservationsPanel`.

### Tab 3 — Mensajes

Reuses the existing `MessagesInbox` component unchanged.

- `MessagesInbox` already accepts `threads: ChannexThread[]` (multi-property capable)
- Threads are already fetched via `useAllPropertyThreads(tenantId, propertyIds)` in the existing panels
- **New: property filter** — a `<select>` above `MessagesInbox` that filters `threads` before passing them down
- Filter is UI-only (client-side), no hook changes needed

### Tab 4 — Configuración

Contains the existing connection/OAuth content currently shown as the primary view:

- `ChannelManagementPanel` (channel activate/deactivate)
- OAuth IFrame / BDC sync flow (currently the first thing shown in `BookingConnectionPanel` / `AirbnbConnectionPanel`)
- The `NoPropertyGuide` prompt (shown when no properties exist yet)

---

## Changes to `ChannexHub`

`ChannexHub` currently renders `AirbnbConnectionPanel` and `BookingConnectionPanel` for the `airbnb` and `booking` sub-tabs. After the refactor:

- Both are replaced by `<IntegrationView source="airbnb" ... />` and `<IntegrationView source="booking" ... />`
- The `properties` and `pools` sub-tabs in `ChannexHub` are **unchanged**
- The `SubTab` type and routing in `main.tsx` are **unchanged** (`/channex/airbnb`, `/channex/booking` still work)

---

## Filter Behavior

### Reservas — Date range filter
- Default: no filter (show all)
- Filters on `check_in` date: shows reservations where `check_in >= from` AND `check_in <= to`
- Both fields are optional: filling only "from" filters from that date onwards; filling only "to" filters up to that date

### Reservas — Property filter
- Default: "Todas"
- Shows only reservations belonging to the selected property

### Mensajes — Property filter
- Default: "Todas"
- Filters `threads` array by `thread.propertyId` before passing to `MessagesInbox`

---

## i18n Keys Needed

Add to `en.ts` and `es.ts`:

```
channex.integration.tab.properties    → "Properties" / "Propiedades"
channex.integration.tab.reservations  → "Reservations" / "Reservas"
channex.integration.tab.messages      → "Messages" / "Mensajes"
channex.integration.tab.settings      → "Configuration" / "Configuración"
channex.integration.filter.allProps   → "All properties" / "Todas las propiedades"
channex.integration.filter.from       → "From" / "Desde"
channex.integration.filter.to         → "To" / "Hasta"
channex.integration.filter.clear      → "Clear filters" / "Limpiar filtros"
```

---

## Out of Scope

- The global `properties` and `pools` tabs in `ChannexHub` — no changes
- `PropertyDetail` internal tabs (rooms, ARI, reservations, messages per-property) — no changes
- Backend changes — all filtering is client-side
- `ReservationsPanel` component — not modified, `AggregatedReservationsPanel` wraps the API calls independently
- Mobile/responsive layout — follows existing patterns

---

## Files Affected

| File | Change |
|------|--------|
| `src/channex/components/connection/BookingConnectionPanel.tsx` | Replaced by `IntegrationView` |
| `src/channex/components/connection/AirbnbConnectionPanel.tsx` | Replaced by `IntegrationView` |
| `src/channex/ChannexHub.tsx` | Swap panel imports for `IntegrationView` |
| `src/channex/components/IntegrationView.tsx` | **New** — 4-tab orchestrator |
| `src/channex/components/shared/AggregatedReservationsPanel.tsx` | **New** — multi-property reservations with filters |
| `src/i18n/en.ts` / `es.ts` | Add 8 new keys |
