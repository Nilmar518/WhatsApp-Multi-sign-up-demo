# Calendar SS Overlay + Property in Booking Detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a diagonal ✕ SVG overlay on Stop Sell calendar cells, and show the property name inside the booking detail modal.

**Architecture:** Two fully independent UI changes. Feature 1 is self-contained in `ARICalendar.tsx`. Feature 2 threads a new `propertyTitle` prop down from `PropertyDetail` → `ReservationsPanel` → `ReservationDetailModal`, plus two i18n key additions.

**Tech Stack:** React 18, TypeScript, Tailwind CSS. No backend changes. No test framework present — verification is manual via the dev server.

---

## File Map

| File | Role |
|---|---|
| `apps/frontend/src/channex/components/shared/ARICalendar.tsx` | Add `relative` to cell div; add SVG overlay when SS active |
| `apps/frontend/src/i18n/en.ts` | Add `channex.reservDetail.property` English key |
| `apps/frontend/src/i18n/es.ts` | Add `channex.reservDetail.property` Spanish key |
| `apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx` | Accept and render `propertyTitle?` prop |
| `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx` | Accept `propertyTitle?` prop; pass to modal |
| `apps/frontend/src/channex/components/shared/PropertyDetail.tsx` | Pass `property.title` to `ReservationsPanel` |

---

## Task 1: Add diagonal X overlay on SS calendar cells

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/ARICalendar.tsx` (lines 688–726)

- [ ] **Step 1: Add `relative` to the cell div className**

In `ARICalendar.tsx`, find the cell `<div>` inside `weekDates.map` (around line 688). Its current `className` expression starts with:
```
'flex flex-col items-start p-1.5 border border-edge cursor-pointer min-h-[56px] transition-colors',
```

Add `relative` so the SVG overlay can be positioned inside it. The updated className array should be:

```tsx
className={[
  'relative flex flex-col items-start p-1.5 border border-edge cursor-pointer min-h-[56px] transition-colors',
  sel ? 'bg-brand-subtle ring-2 ring-inset ring-brand-light z-10' : `hover:bg-surface-subtle ${cellBg}`,
  !inMonth ? 'bg-surface-subtle/70' : '',
  isPopup && !sel ? 'ring-2 ring-inset ring-brand-light z-10' : '',
].join(' ')}
```

- [ ] **Step 2: Add the SVG overlay after the date number span**

Inside that same cell `<div>`, after the date number `<span>`:

```tsx
<span className={`text-sm font-medium ${inMonth ? 'text-content' : 'text-content-3'}`}>
  {date.getUTCDate()}
</span>
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

- [ ] **Step 3: Verify in the browser**

Start the dev server from the repo root:
```bash
pnpm dev
```

Navigate to a property detail page → ARI tab. Find a date with Stop Sell active (red background + "SS" badge). Confirm:
- A subtle diagonal ✕ is visible across the cell
- The date number, rate, availability, and "SS" badge are still readable underneath
- Non-SS cells are unaffected

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/channex/components/shared/ARICalendar.tsx
git commit -m "feat(ari): add diagonal X overlay on Stop Sell calendar cells"
```

---

## Task 2: Add i18n key for property label

**Files:**
- Modify: `apps/frontend/src/i18n/en.ts` (after line 752, the `channex.reservDetail.bookingInfo` entry)
- Modify: `apps/frontend/src/i18n/es.ts` (after line 750, the `channex.reservDetail.bookingInfo` entry)

- [ ] **Step 1: Add key to `en.ts`**

In `apps/frontend/src/i18n/en.ts`, find the line:
```ts
  'channex.reservDetail.bookingInfo':  'Booking info',
```

Add the property key immediately after it:
```ts
  'channex.reservDetail.bookingInfo':  'Booking info',
  'channex.reservDetail.property':     'Property',
```

- [ ] **Step 2: Add key to `es.ts`**

In `apps/frontend/src/i18n/es.ts`, find the line:
```ts
  'channex.reservDetail.bookingInfo':  'Información de reserva',
```

Add the property key immediately after it:
```ts
  'channex.reservDetail.bookingInfo':  'Información de reserva',
  'channex.reservDetail.property':     'Propiedad',
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/i18n/en.ts apps/frontend/src/i18n/es.ts
git commit -m "feat(i18n): add property label key for reservation detail modal"
```

---

## Task 3: Show property name in ReservationDetailModal

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx`

- [ ] **Step 1: Add `propertyTitle` to the props interface**

Find the `ReservationDetailModalProps` interface (around line 67):
```ts
export interface ReservationDetailModalProps {
  reservation: Reservation | null;
  tenantId: string;
  /** OTA channel code from the property (e.g. "BDC", "ABB"). Used to determine No Show eligibility. */
  propertyChannelCode: string | null;
  onClose: () => void;
  /** Called after a successful No Show report — use to refresh the reservations list. */
  onNoShowComplete?: () => void;
}
```

Add `propertyTitle?: string`:
```ts
export interface ReservationDetailModalProps {
  reservation: Reservation | null;
  tenantId: string;
  propertyTitle?: string;
  /** OTA channel code from the property (e.g. "BDC", "ABB"). Used to determine No Show eligibility. */
  propertyChannelCode: string | null;
  onClose: () => void;
  /** Called after a successful No Show report — use to refresh the reservations list. */
  onNoShowComplete?: () => void;
}
```

- [ ] **Step 2: Destructure the new prop in the function signature**

Find the function signature (around line 77):
```ts
export default function ReservationDetailModal({
  reservation: r,
  tenantId,
  propertyChannelCode,
  onClose,
  onNoShowComplete,
}: ReservationDetailModalProps) {
```

Add `propertyTitle`:
```ts
export default function ReservationDetailModal({
  reservation: r,
  tenantId,
  propertyTitle,
  propertyChannelCode,
  onClose,
  onNoShowComplete,
}: ReservationDetailModalProps) {
```

- [ ] **Step 3: Render the property InfoRow as the first item in the Booking Info section**

Find the "Booking Info" section (around line 225). It currently starts with:
```tsx
{/* Booking refs */}
<SectionTitle>{t('channex.reservDetail.bookingInfo')}</SectionTitle>
<div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
  {r.ota_unique_id && <InfoRow label={t('channex.reservDetail.otaId')} value={r.ota_unique_id} />}
```

Add the property row as the first `InfoRow` inside that `<div>`:
```tsx
{/* Booking refs */}
<SectionTitle>{t('channex.reservDetail.bookingInfo')}</SectionTitle>
<div className="rounded-xl border border-edge bg-surface-subtle px-4 py-1">
  {propertyTitle && (
    <InfoRow label={t('channex.reservDetail.property')} value={propertyTitle} />
  )}
  {r.ota_unique_id && <InfoRow label={t('channex.reservDetail.otaId')} value={r.ota_unique_id} />}
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/channex/components/shared/ReservationDetailModal.tsx
git commit -m "feat(reservations): show property name in booking detail modal"
```

---

## Task 4: Thread propertyTitle through ReservationsPanel and PropertyDetail

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx`
- Modify: `apps/frontend/src/channex/components/shared/PropertyDetail.tsx`

- [ ] **Step 1: Add `propertyTitle` to ReservationsPanelProps**

In `ReservationsPanel.tsx`, find the `ReservationsPanelProps` interface (around line 172):
```ts
export interface ReservationsPanelProps {
  propertyId: string;
  tenantId: string;
  /** Optional filter — show only bookings from these channel keys ('airbnb', 'booking_com', …). All shown when empty. */
  channels?: string[];
  /** Polling interval in ms. Default 30 000. Pass 0 to disable. */
  pollInterval?: number;
  /** If set, auto-opens the detail modal for this channex_booking_id once bookings load. */
  initialBookingId?: string;
}
```

Add `propertyTitle?: string`:
```ts
export interface ReservationsPanelProps {
  propertyId: string;
  tenantId: string;
  propertyTitle?: string;
  /** Optional filter — show only bookings from these channel keys ('airbnb', 'booking_com', …). All shown when empty. */
  channels?: string[];
  /** Polling interval in ms. Default 30 000. Pass 0 to disable. */
  pollInterval?: number;
  /** If set, auto-opens the detail modal for this channex_booking_id once bookings load. */
  initialBookingId?: string;
}
```

- [ ] **Step 2: Destructure `propertyTitle` in ReservationsPanel function signature**

Find the function signature (around line 183):
```ts
export default function ReservationsPanel({
  propertyId,
  tenantId,
  channels,
  pollInterval = 30_000,
  initialBookingId,
}: ReservationsPanelProps) {
```

Add `propertyTitle`:
```ts
export default function ReservationsPanel({
  propertyId,
  tenantId,
  propertyTitle,
  channels,
  pollInterval = 30_000,
  initialBookingId,
}: ReservationsPanelProps) {
```

- [ ] **Step 3: Pass propertyTitle to ReservationDetailModal in ReservationsPanel**

Find the `<ReservationDetailModal>` render at the bottom of `ReservationsPanel` (around line 405):
```tsx
<ReservationDetailModal
  reservation={selectedReservation}
  tenantId={tenantId}
  propertyChannelCode={propertyChannelCode}
  onClose={() => setSelectedReservation(null)}
  onNoShowComplete={() => {
    setSelectedReservation(null);
    void load(true);
  }}
/>
```

Add `propertyTitle`:
```tsx
<ReservationDetailModal
  reservation={selectedReservation}
  tenantId={tenantId}
  propertyTitle={propertyTitle}
  propertyChannelCode={propertyChannelCode}
  onClose={() => setSelectedReservation(null)}
  onNoShowComplete={() => {
    setSelectedReservation(null);
    void load(true);
  }}
/>
```

- [ ] **Step 4: Pass property.title from PropertyDetail to ReservationsPanel**

In `PropertyDetail.tsx`, find the `<ReservationsPanel>` usage (around line 166):
```tsx
{innerTab === 'reservations' && (
  <ReservationsPanel
    propertyId={property.channex_property_id}
    tenantId={tenantId}
    initialBookingId={initialBookingId}
  />
```

Add `propertyTitle`:
```tsx
{innerTab === 'reservations' && (
  <ReservationsPanel
    propertyId={property.channex_property_id}
    tenantId={tenantId}
    propertyTitle={property.title}
    initialBookingId={initialBookingId}
  />
```

- [ ] **Step 5: Verify in the browser**

With the dev server running, navigate to a property → Reservations tab → click any booking to open the detail modal. Confirm:

- The "Booking info" section now shows a "Propiedad" / "Property" row with the property's name as the first item
- From the GlobalOverview, clicking a booking (which navigates to PropertyDetail with the booking pre-opened) also shows the property name in the modal
- The property name renders correctly in both Spanish and English (toggle language if a switcher exists)
- No TypeScript errors in the terminal output

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/channex/components/shared/ReservationsPanel.tsx apps/frontend/src/channex/components/shared/PropertyDetail.tsx
git commit -m "feat(reservations): thread propertyTitle to booking detail modal"
```
