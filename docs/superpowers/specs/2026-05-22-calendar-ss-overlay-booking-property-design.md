# Design Spec: Calendar SS Overlay + Property in Booking Detail

**Date:** 2026-05-22
**Status:** Approved

---

## Overview

Two independent UI improvements to the Channex property management interface:

1. **Calendar SS Overlay** — render a diagonal ✕ SVG over calendar cells that have Stop Sell active, making the blocked state immediately obvious at a glance.
2. **Property in Booking Detail** — show the property name in `ReservationDetailModal` so the user always knows which property a booking belongs to, regardless of where the modal was opened from.

---

## Feature 1 — Diagonal X Overlay on Stop Sell Calendar Cells

### Context

`ARICalendar.tsx` already computes `anyStopSell` per date cell by aggregating across all rate plans in the ARI snapshot. When true, the cell receives a red background (`bg-danger-bg`) and a small `SS` text badge. The request is to add a prominent diagonal ✕ overlay so the blocked state is unmistakable even at a glance.

### Design

**Where:** Inside each calendar cell `<div>` in `ARICalendar.tsx` (the `weeks.map` render loop, roughly lines 688–726).

**What to render:** When `anyStopSell && inMonth`, add an absolutely-positioned SVG inside the cell:

```tsx
{inMonth && anyStopSell && (
  <svg
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 h-full w-full text-danger-text opacity-30"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
  >
    <line x1="5" y1="5" x2="95" y2="95" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <line x1="95" y1="5" x2="5" y2="95" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
  </svg>
)}
```

**Cell container change:** The cell `<div>` must have `relative` added to its className (currently uses flex but `relative` is not set, which is required for the `absolute inset-0` SVG to be scoped to the cell).

**Opacity:** `opacity-30` and `text-danger-text` are on the `<svg>` element — the `<line>` elements inherit `currentColor` from it. This keeps the rate and availability text readable beneath the overlay.

**The existing `SS` badge** below the date number is kept — it provides text confirmation and is part of the existing glossary system.

### Visual result

- Cell background: red (`bg-danger-bg`) — unchanged
- Overlay: two diagonal red lines crossing the full cell, subtle opacity
- Date number, rate, availability, `SS` badge: all still visible underneath

---

## Feature 2 — Property Name in Reservation Detail Modal

### Context

`ReservationDetailModal` is rendered by `ReservationsPanel`, which in turn is rendered by `PropertyDetail`. `PropertyDetail` receives a `ChannexProperty` object that includes `property.title`. Currently, none of that context flows into the modal. Even from `GlobalOverview`, the booking modal is always opened via `PropertyDetail` (through `onOpenBooking` → navigate to `PropertyDetail` with `initialBookingId`), so `PropertyDetail` is always in the call chain.

### Design

**Prop chain:** Add `propertyTitle?: string` at each layer:

| Component | Change |
|---|---|
| `ReservationDetailModal` | Accept `propertyTitle?: string` prop; render as `InfoRow` in "Booking Info" section |
| `ReservationsPanel` | Accept `propertyTitle?: string` prop; pass to `ReservationDetailModal` |
| `PropertyDetail` | Pass `property.title` to `ReservationsPanel` as `propertyTitle` |

**Where in the modal:** Inside the existing "Booking Info" `<div>` block (currently shows OTA ID, reservation ID, channel, PMS booking ID). The property row is added as the **first** `InfoRow` in that section so it's immediately visible.

```tsx
{propertyTitle && (
  <InfoRow label={t('channex.reservDetail.property')} value={propertyTitle} />
)}
```

**i18n keys needed:**
- `channex.reservDetail.property` → `"Propiedad"` (es) / `"Property"` (en)

### Visual result

Booking Info section now shows:
```
Propiedad     Casa del Sol
Canal OTA     Airbnb
ID OTA        HM-12345
...
```

---

## Files to Change

| File | Change |
|---|---|
| `apps/frontend/src/channex/components/shared/ARICalendar.tsx` | Add `relative` to cell div; add SVG overlay when `anyStopSell && inMonth` |
| `apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx` | Add `propertyTitle?` prop; render InfoRow in Booking Info section |
| `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx` | Add `propertyTitle?` prop; pass to `ReservationDetailModal` |
| `apps/frontend/src/channex/components/shared/PropertyDetail.tsx` | Pass `property.title` to `ReservationsPanel` as `propertyTitle` |
| `apps/frontend/src/i18n/en.ts` | Add `channex.reservDetail.property: 'Property'` |
| `apps/frontend/src/i18n/es.ts` | Add `channex.reservDetail.property: 'Propiedad'` |

---

## Out of Scope

- No changes to `GlobalOverview.tsx` (booking modal always routes through `PropertyDetail`)
- No changes to the `Reservation` type or backend
- No changes to the ARI snapshot data model
- CTA / CTD cells do not get the X overlay (only SS)
