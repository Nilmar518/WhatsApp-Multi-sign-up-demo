# Channex Responsive Refactor — Design Spec

**Date:** 2026-05-19  
**Scope:** `apps/frontend/src/channex/` — layout responsiveness only  
**Strategy:** Option A — surgical per-component Tailwind responsive fixes  
**Target viewports:** 320px → 1440px+ (mobile, tablet, desktop)

---

## 1. Absolute Constraints — Do NOT touch

The frontend-design skill (or any implementer) **must not** modify any of the following:

### Visual identity (frozen)
- Semantic color tokens: `text-content`, `text-content-2`, `text-content-3`, `bg-surface`, `bg-surface-raised`, `bg-surface-subtle`, `border-edge`, `text-brand`, `bg-brand`, `text-ok-text`, `bg-ok-bg`, `text-danger-text`, `bg-danger-bg`, `text-caution-text`, `bg-caution-bg`, `text-notice-text`, `bg-notice-bg`, `bg-brand-subtle`, `text-brand-subtle`
- Font sizes, weights, tracking, leading: `text-xs`, `text-sm`, `text-base`, `text-lg`, `font-medium`, `font-semibold`, `font-bold`, `uppercase`, `tracking-*`, `leading-*`
- Border radius: `rounded-*`
- Borders: `border`, `border-*`
- Shadows: `shadow-*`
- Animations: `animate-spin`, `animate-fade-in`, `animate-pulse`
- Opacity utilities: `opacity-*`, `disabled:opacity-50`

### Code (frozen)
- All React state, hooks, handlers, effects
- All i18n calls (`t(...)`)
- All prop interfaces and types
- Import statements (no new deps)
- Component logic, conditionals, data flow

### Already-responsive components (do not regress)
- `PropertiesList.tsx` — already uses `sm:grid-cols-2 lg:grid-cols-3` ✅
- `PoolsList.tsx` — same grid pattern ✅
- `GlobalOverview.tsx` — accordion layout already works ✅
- All modals with `inset-x-4 max-w-*` — already responsive ✅

---

## 2. Breakpoint Convention

| Prefix | Min-width | Context |
|--------|-----------|---------|
| _(none)_ | 0px | Mobile base |
| `sm:` | 640px | Small tablet |
| `md:` | 768px | Tablet |
| `lg:` | 1024px | Desktop |

---

## 3. Component-by-Component Changes

### 3.1 `ChannexHub.tsx`

**File:** `apps/frontend/src/channex/ChannexHub.tsx`

#### Problem A — Content padding too large on mobile
```
// Before (line ~60, ~93, ~104, ~123, ~158, ~163, ~176)
<div className="px-6 py-6">

// After
<div className="px-3 py-4 sm:px-6 sm:py-6">
```
All `px-6 py-6` wrappers inside `activeSubTab` content sections get this treatment.

#### Problem B — Sub-tab bar overflows on small screens
```
// Before (line ~70)
<div className="flex items-end gap-0 border-b border-edge px-6">

// After
<div className="flex flex-wrap items-end gap-0 border-b border-edge px-3 sm:px-6">
```
Add `flex-wrap` so tabs wrap to a second line on mobile. Reduce horizontal padding to match content areas.

---

### 3.2 `PropertyDetail.tsx`

**File:** `apps/frontend/src/channex/components/shared/PropertyDetail.tsx`

#### Problem A — Property header card overflows
The `flex items-center justify-between` at line ~60 puts the right side (currency/timezone + status badge + Sync button) next to the title. On narrow screens this overflows.

```
// Before (line ~60)
<div className="flex items-center justify-between">

// After
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
```

The right sub-div (containing currency text + status badge + button) already uses `flex items-center gap-3`, which stays unchanged. On mobile it flows below the title.

#### Problem B — Inner tabs overflow
```
// Before (line ~127)
<div className="mb-4 flex gap-0 border-b border-edge">

// After
<div className="mb-4 flex flex-wrap gap-0 border-b border-edge">
```

---

### 3.3 `MessagesInbox.tsx`

**File:** `apps/frontend/src/channex/components/shared/MessagesInbox.tsx`

This is the highest-severity issue. The layout is a fixed `h-[480px]` container with a `w-64 shrink-0` thread list side by side with the conversation pane.

#### Behavior on mobile (< `md:`):
- Show **only the thread list** when no thread is selected
- Show **only the conversation pane** (with a back button) when a thread is selected
- At `md:` and above, restore the current two-column layout

#### Changes to the outer container (line ~250):
```
// Before
<div className="flex h-[480px] overflow-hidden rounded-2xl border border-edge bg-surface-raised">

// After
<div className="flex flex-col md:flex-row md:h-[480px] overflow-hidden rounded-2xl border border-edge bg-surface-raised">
```

#### Thread list panel (line ~252):
```
// Before
<div className="w-64 shrink-0 overflow-y-auto border-r border-edge">

// After
<div className={[
  'shrink-0 overflow-y-auto border-b border-edge md:border-b-0 md:border-r',
  'w-full md:w-64',
  selectedThread ? 'hidden md:block' : 'block',
].join(' ')}>
```

#### Conversation pane (line ~287):
```
// Before
<div className="flex-1 min-w-0 overflow-hidden">

// After
<div className={[
  'flex-1 min-w-0 overflow-hidden',
  selectedThread ? 'block h-[480px] md:h-auto' : 'hidden md:flex',
].join(' ')}>
```

#### Back button inside ConversationPane thread header (line ~94):
Add a back button visible only on mobile, inside the thread header `shrink-0` div:
```tsx
// Add before the guest name paragraph, mobile-only
<button
  type="button"
  onClick={() => {/* caller must pass an onBack prop */}}
  className="mr-2 text-xs text-content-2 hover:text-content md:hidden"
>
  ←
</button>
```

Since `ConversationPane` doesn't receive an `onBack` prop today, `MessagesInbox` needs to pass `onBack={() => setSelectedThread(null)}` as a new prop to `ConversationPane`. This is a minimal interface change — no logic change.

---

### 3.4 `ReservationsPanel.tsx`

**File:** `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx`

#### Problem — Header row overflows on mobile
The header has: count text + [updated-at timestamp] + [↻ button] + [Sync button]. On mobile these overflow.

```
// Before (line ~300)
<div className="mb-3 flex items-center justify-between">

// After
<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
```

The right sub-div with buttons can stay as `flex items-center gap-2` — it will naturally become its own row on mobile.

---

### 3.5 `ARICalendar.tsx`

**File:** `apps/frontend/src/channex/components/shared/ARICalendar.tsx`

#### Problem A — Header bar buttons overflow
The header has title + [Glossary button] + [Refresh button] + [Full Sync button].

```
// Before (line ~501)
<div className="flex items-center justify-between">

// After
<div className="flex flex-wrap items-start justify-between gap-y-2">
```

The right `<div className="flex items-center gap-2">` stays unchanged — it will naturally wrap below the title on narrow screens.

#### Problem B — Calendar grid cells too narrow on mobile
The `grid-cols-7` calendar is inherently 7 columns. On screens < 400px the cells become ~45px wide, making the rate/availability text unreadable.

Wrap the calendar grid in a horizontal scroll container:
```
// Before (line ~640)
<div className="relative overflow-hidden rounded-2xl border border-edge bg-surface-raised select-none" ...>

// After
<div className="overflow-x-auto">
  <div className="relative min-w-[420px] overflow-hidden rounded-2xl border border-edge bg-surface-raised select-none" ...>
  </div>
</div>
```
This preserves the calendar exactly as designed at 420px+, and lets mobile users scroll horizontally to see it.

#### Problem C — ARI side-sheet (control panel) fills entire mobile screen
```
// Before (line ~737)
<div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-edge bg-surface-raised p-6 shadow-2xl overflow-y-auto">

// After
<div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 border-l border-edge bg-surface-raised p-6 shadow-2xl overflow-y-auto">
```
On mobile it becomes a full-screen panel (still scrollable). At `sm:` it restores to the 384px side-sheet.

---

### 3.6 `RoomRateManager.tsx`

**File:** `apps/frontend/src/channex/components/shared/RoomRateManager.tsx`

#### Problem A — 3-column occupancy grid too tight on mobile
```
// Before (line ~95)
<div className="grid grid-cols-3 gap-3">

// After
<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
```
On mobile: 2 columns (adults + children). Third field (infants) wraps to next row. At `sm:` all 3 in one row.

#### Problem B — Rate plan inline form wraps awkwardly on mobile
```
// Before (line ~339)
<div className="flex items-center gap-2 rounded-xl border border-brand-light bg-brand-subtle px-3 py-2">

// After
<div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-light bg-brand-subtle px-3 py-2">
```

---

## 4. Components with No Changes Required

| Component | Reason |
|-----------|--------|
| `PropertiesList.tsx` | Already uses `sm:grid-cols-2 lg:grid-cols-3` |
| `PoolsList.tsx` | Same responsive grid |
| `GlobalOverview.tsx` | Accordion pattern already responsive |
| `PropertyCard.tsx` | Card content is single-column |
| `PoolDetail.tsx` | Form-based, single column already |
| `PoolCreateForm.tsx` | Form-based, single column already |
| `PoolEditModal.tsx` | Modal with `inset-x-4 max-w-*` already responsive |
| `PoolAriPanel.tsx` | Inherits ARICalendar fix |
| `BookingConnectionPanel.tsx` | Form layout already stacks |
| `AirbnbConnectionPanel.tsx` | Composed of already-responsive parts |
| `ReservationDetailModal.tsx` | Modal with `inset-x-4 max-w-*` |
| `NoShowConfirmModal.tsx` | Small modal, already responsive |
| `PropertySetupWizard.tsx` | Form steps, single-column |
| `ChannexOAuthIFrame.tsx` | iframe, no layout change needed |

---

## 5. Instructions for frontend-design skill

When using the `frontend-design` skill to implement this spec:

1. **Read this file first.** All changes are defined here. Do not infer or add changes beyond what is listed.
2. **Use only Tailwind responsive prefixes.** No inline styles, no new CSS files, no new utility classes.
3. **One file at a time.** Complete and verify each file before moving to the next.
4. **Do not refactor logic.** If a change requires restructuring state or adding new props beyond `onBack` in `MessagesInbox`, stop and flag it.
5. **Preserve all class names that are not layout-related.** When in doubt, leave it alone.
6. **The `onBack` prop in `MessagesInbox`** is the only interface addition permitted. `ConversationPaneProps` gets `onBack: () => void` and `MessagesInbox` passes `() => setSelectedThread(null)`.
7. **Do not add comments** to the code.
8. **Do not create new components** — all changes are in-place edits.

---

## 6. Verification Checklist

After implementation, verify at each breakpoint (320px, 640px, 768px, 1024px):

- [ ] ChannexHub sub-tabs wrap and don't overflow
- [ ] ChannexHub content padding reduces on mobile
- [ ] PropertyDetail header stacks vertically on mobile
- [ ] PropertyDetail inner tabs wrap on mobile
- [ ] MessagesInbox shows only thread list when no thread selected on mobile
- [ ] MessagesInbox shows conversation + back button on mobile when thread selected
- [ ] MessagesInbox shows two-column layout at `md:` and above
- [ ] ReservationsPanel header stacks on mobile
- [ ] ARICalendar header buttons wrap/don't overflow
- [ ] ARICalendar grid is horizontally scrollable on mobile (min-width 420px)
- [ ] ARI side-sheet is full-width on mobile, 384px at `sm:`
- [ ] RoomRateManager occupancy grid is 2-col on mobile, 3-col at `sm:`
- [ ] No color, font, border, shadow, or animation changes anywhere
- [ ] No regressions in PropertiesList, PoolsList, or GlobalOverview
