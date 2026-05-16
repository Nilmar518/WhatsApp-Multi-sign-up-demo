# Unified Properties Flow — Design Spec

**Date:** 2026-05-14  
**Branch:** feat/ui-design-system  
**Status:** Approved

---

## Problem

The frontend currently has three separate, divergent implementations for what is fundamentally the same domain: Channex properties with rooms/rates, ARI calendar, and reservations.

| Area | Entry point | Key components |
|------|-------------|----------------|
| Manual | `channex/` Properties tab | `PropertySetupWizard`, `ARICalendarFull`, `ReservationsPanel`, `RoomRateManager` |
| Airbnb | `airbnb/AirbnbPage.tsx` | `MultiCalendarView`, `ReservationInbox`, `PropertyProvisioningForm`, `MappingReviewModal` |
| Booking.com | `integrations/booking/BookingIntegrationView.tsx` | `BookingInbox`, `BookingReservations` |

All three write to the same Firestore collection (`channex_integrations/{tenantId}/properties`) and use the same Channex API. The divergence is purely in the UI layer and produces duplicated components that drift independently.

---

## Goal

Consolidate the three flows into a single shared component and API surface. The ChannexHub tabs (Properties, Airbnb, Booking, Pools) remain as navigation entry points, but all tabs consume the same components, the same hook, and the same API client.

The Airbnb and Booking.com tabs become lightweight: they handle only channel connection (OAuth + sync). Once a property is synced, it appears in Firestore with the same structure as a manually created property and is fully managed via the shared components.

---

## Architecture

### Folder structure (target state)

```
apps/frontend/src/channex/
  components/
    shared/                         ← canonical shared components
      PropertyCard.tsx
      PropertyDetail.tsx
      ARICalendar.tsx
      ReservationsPanel.tsx
      RoomRateManager.tsx           (moved from components/)
    connection/                     ← OTA-specific connection UIs only
      AirbnbConnectionPanel.tsx
      BookingConnectionPanel.tsx
    pools/                          ← unchanged
  hooks/
    useChannexProperties.ts         (extended with source filter)
  api/
    channexHubApi.ts                (absorbs airbnb + booking API methods)
```

```
apps/frontend/src/airbnb/           ← deleted entirely
apps/frontend/src/integrations/     ← deleted entirely
```

---

## Component Design

### `shared/PropertyDetail.tsx`

The central detail component. Receives a `ChannexProperty` and renders three tabs regardless of origin:

- **Rooms & Rates** → `RoomRateManager`
- **ARI Calendar** → `ARICalendar`
- **Reservations** → `ReservationsPanel`

This component has no knowledge of whether the property came from a manual flow, Airbnb, or Booking.com. Source is irrelevant to its rendering.

### `shared/PropertyCard.tsx`

Unified card for property listing grids. Replaces `ExistingPropertyCard` (Airbnb) and the inline card rendering in `PropertiesList`. Displays: title, connection status badge, `connected_channels` platform indicators, and click-through to `PropertyDetail`.

### `shared/ARICalendar.tsx`

Canonical ARI calendar. Absorbs `ARICalendarFull` (channex) and `MultiCalendarView` (airbnb). Handles availability, rates, and restrictions push for any property.

### `shared/ReservationsPanel.tsx`

Canonical reservations view. Absorbs `ReservationsPanel` (channex) and `ReservationInbox` (airbnb) and `BookingReservations` (booking). Renders incoming reservations from Firestore for any property.

### `connection/AirbnbConnectionPanel.tsx`

Contains only:
1. Connection status badge for Airbnb channel
2. "Connect via Channex" button → opens Channex OAuth iframe
3. "Sync Listings" button → calls `syncAirbnbListings()`, writes property to Firestore in standard structure
4. Filtered property list: `useChannexProperties(tenantId, { source: 'airbnb' })` + `PropertyCard` + `PropertyDetail`

### `connection/BookingConnectionPanel.tsx`

Same shape as `AirbnbConnectionPanel` but for Booking.com. Uses `getBookingSessionToken()` and `syncBookingListings()`.

---

## Data Model

### Single Firestore structure for all origins

```
channex_integrations/{tenantId}/properties/{channex_property_id}
  title: string
  currency: string
  timezone: string
  property_type: string
  connection_status: 'pending' | 'active' | 'token_expired' | 'error'
  connected_channels: ('airbnb' | 'booking')[]   ← indicates OTA origin(s)
  room_types: StoredRoomType[]
  channex_webhook_id: string
  tenant_id: string
  migo_property_id: string
  channex_group_id: string
  last_sync_timestamp: string
  created_at: string
  updated_at: string
```

OTA sync writes exactly this structure using listing and mapping endpoints already available. No OTA-specific fields. The `connected_channels` array serves as the only indicator of origin and is used for filtering.

### `StoredRoomType` (unchanged)

```typescript
{
  room_type_id: string;
  title: string;
  count_of_rooms: number;
  default_occupancy: number;
  occ_adults: number;
  occ_children: number;
  occ_infants: number;
  rate_plans: StoredRatePlan[];
}
```

---

## Hook

### `useChannexProperties(tenantId, options?)`

Extended with an optional `source` filter:

```typescript
interface UseChannexPropertiesOptions {
  source?: 'airbnb' | 'booking';
}

// Properties tab — all properties
useChannexProperties(tenantId)

// Airbnb tab — only Airbnb-connected
useChannexProperties(tenantId, { source: 'airbnb' })

// Booking tab — only Booking-connected
useChannexProperties(tenantId, { source: 'booking' })
```

Filter applied client-side on `connected_channels` array. The Firestore subscription remains a single query per tenant.

---

## API Client

### `channexHubApi.ts` (unified)

Existing methods (manual flow) stay as-is. New methods absorbed from OTA modules:

```typescript
// Airbnb — from airbnb/api/channexApi.ts
getAirbnbSessionToken(tenantId: string): Promise<{ token: string }>
syncAirbnbListings(tenantId: string, propertyId: string): Promise<void>

// Booking.com — from integrations/booking/api/bookingApi.ts
getBookingSessionToken(tenantId: string): Promise<{ token: string; propertyId: string }>
syncBookingListings(tenantId: string): Promise<void>
disconnectBooking(tenantId: string): Promise<void>
```

---

## ChannexHub Tab Responsibilities (final)

| Tab | Responsibility |
|-----|---------------|
| **Properties** | All properties (manual + OTA). `PropertySetupWizard` for manual creation. `PropertyCard` + `PropertyDetail` (shared) for all. |
| **Airbnb** | `AirbnbConnectionPanel` only. Filtered list of Airbnb properties via shared components. |
| **Booking** | `BookingConnectionPanel` only. Filtered list of Booking properties via shared components. |
| **Pools** | No changes. |

---

## Files Deleted

| File | Replaced by |
|------|-------------|
| `airbnb/AirbnbPage.tsx` | `AirbnbConnectionPanel` + shared components |
| `airbnb/components/MultiCalendarView.tsx` | `shared/ARICalendar.tsx` |
| `airbnb/components/ReservationInbox.tsx` | `shared/ReservationsPanel.tsx` |
| `airbnb/components/PropertyProvisioningForm.tsx` | `PropertySetupWizard` in Properties tab |
| `airbnb/components/MappingReviewModal.tsx` | inline in `AirbnbConnectionPanel` |
| `airbnb/components/ExistingPropertyCard.tsx` | `shared/PropertyCard.tsx` |
| `airbnb/components/ConnectionStatusBadge.tsx` | inline in `AirbnbConnectionPanel` |
| `airbnb/components/ChannexIFrame.tsx` | inline in connection panels |
| `airbnb/api/channexApi.ts` | methods merged into `channexHubApi.ts` |
| `integrations/booking/BookingIntegrationView.tsx` | `BookingConnectionPanel` + shared components |
| `integrations/booking/BookingInbox.tsx` | `shared/ReservationsPanel.tsx` |
| `integrations/booking/BookingReservations.tsx` | `shared/ReservationsPanel.tsx` |
| `integrations/booking/api/bookingApi.ts` | methods merged into `channexHubApi.ts` |

---

## Backend

No structural changes required. The existing endpoints for listing discovery and mapping are consumed as-is by the new connection panels. The sync operations must verify that the written Firestore structure matches the standard `room_types[]` shape defined by the manual flow. If any field diverges, it is corrected in the sync service — not by adding OTA-specific fields.

Backend modules affected (verification only, not refactor):
- `channex-sync.service.ts` — Airbnb listing/mapping writes
- `booking/booking.service.ts` — Booking.com sync writes

---

## Success Criteria

1. Properties tab shows all properties (manual + OTA) using shared components
2. Airbnb tab shows only OAuth + sync UI + filtered Airbnb property list
3. Booking tab shows only OAuth + sync UI + filtered Booking property list
4. No duplicate ARI calendar, reservations, or room/rate manager components exist
5. A single `channexHubApi.ts` import covers all property operations
6. OTA-synced properties have the same Firestore structure as manual properties
7. `airbnb/` and `integrations/booking/` directories are deleted
