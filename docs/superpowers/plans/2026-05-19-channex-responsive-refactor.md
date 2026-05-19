# Channex Responsive Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 6 Channex frontend components responsive across all viewports (320px–1440px) using surgical Tailwind responsive prefixes only.

**Architecture:** Option A — surgical per-component edits. Every change is a Tailwind class swap or addition in-place. No new components, no new files, no logic changes. MessagesInbox gets one new prop (`onBack`) to support the mobile stack-navigation pattern.

**Tech Stack:** React 18, Tailwind CSS, TypeScript. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-19-channex-responsive-refactor-design.md`

---

## Files Modified

| File | Change type |
|------|-------------|
| `apps/frontend/src/channex/ChannexHub.tsx` | Tailwind class edits |
| `apps/frontend/src/channex/components/shared/PropertyDetail.tsx` | Tailwind class edits |
| `apps/frontend/src/channex/components/shared/MessagesInbox.tsx` | Tailwind class edits + onBack prop |
| `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx` | Tailwind class edits |
| `apps/frontend/src/channex/components/shared/ARICalendar.tsx` | Tailwind class edits |
| `apps/frontend/src/channex/components/shared/RoomRateManager.tsx` | Tailwind class edits |

No files created. No files deleted.

---

## Task 1: ChannexHub.tsx — sub-tabs wrap + content padding

**Files:**
- Modify: `apps/frontend/src/channex/ChannexHub.tsx`

- [ ] **Step 1: Read the file to get current state**

  Read `apps/frontend/src/channex/ChannexHub.tsx` in full before making any edit.

- [ ] **Step 2: Fix the sub-tab bar (line ~70)**

  Find:
  ```tsx
  <div className="flex items-end gap-0 border-b border-edge px-6">
  ```
  Replace with:
  ```tsx
  <div className="flex flex-wrap items-end gap-0 border-b border-edge px-3 sm:px-6">
  ```

- [ ] **Step 3: Fix all content wrapper paddings**

  There are multiple `px-6 py-6` wrapper divs inside the `activeSubTab` content sections (the `flex-1 min-h-0 overflow-auto` container). Find every occurrence of:
  ```tsx
  <div className="px-6 py-6">
  ```
  Replace each with:
  ```tsx
  <div className="px-3 py-4 sm:px-6 sm:py-6">
  ```
  There are 6 of these in the file (one per sub-tab branch and its nested conditionals). Replace all of them.

- [ ] **Step 4: Verify no other layout changes were made**

  Check that no color tokens, font classes, border classes, or component logic were modified.

---

## Task 2: PropertyDetail.tsx — header stacks on mobile + inner tabs wrap

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/PropertyDetail.tsx`

- [ ] **Step 1: Read the file**

  Read `apps/frontend/src/channex/components/shared/PropertyDetail.tsx` in full.

- [ ] **Step 2: Fix the property header card inner flex row (line ~60)**

  Find the first `flex items-center justify-between` inside the header card's `rounded-2xl border border-edge` div:
  ```tsx
  <div className="flex items-center justify-between">
  ```
  Replace with:
  ```tsx
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  ```
  This makes the right side (currency/timezone text + status badge + sync button) drop below the property title on mobile and sit beside it on `sm:` and above.

- [ ] **Step 3: Fix the inner tabs bar (line ~127)**

  Find:
  ```tsx
  <div className="mb-4 flex gap-0 border-b border-edge">
  ```
  Replace with:
  ```tsx
  <div className="mb-4 flex flex-wrap gap-0 border-b border-edge">
  ```

- [ ] **Step 4: Verify**

  Confirm no other classes were changed. The health result panel, sync error div, and tab content sections are untouched.

---

## Task 3: MessagesInbox.tsx — mobile stack navigation

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/MessagesInbox.tsx`

This is the most structural change. Read the entire file carefully before editing.

- [ ] **Step 1: Read the file**

  Read `apps/frontend/src/channex/components/shared/MessagesInbox.tsx` in full.

- [ ] **Step 2: Add `onBack` prop to `ConversationPaneProps`**

  Find the interface:
  ```tsx
  interface ConversationPaneProps {
    tenantId: string;
    thread: ChannexThread;
  }
  ```
  Replace with:
  ```tsx
  interface ConversationPaneProps {
    tenantId: string;
    thread: ChannexThread;
    onBack: () => void;
  }
  ```

- [ ] **Step 3: Destructure `onBack` in `ConversationPane`**

  Find the function signature:
  ```tsx
  function ConversationPane({ tenantId, thread }: ConversationPaneProps) {
  ```
  Replace with:
  ```tsx
  function ConversationPane({ tenantId, thread, onBack }: ConversationPaneProps) {
  ```

- [ ] **Step 4: Add back button in the thread header**

  Inside `ConversationPane`, find the thread header section. It starts with:
  ```tsx
  <div className="shrink-0 border-b border-edge px-4 py-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-content truncate">{thread.guestName}</p>
  ```
  Replace the opening `<div className="min-w-0">` block so it gains a back button before the guest name:
  ```tsx
  <div className="shrink-0 border-b border-edge px-4 py-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="md:hidden shrink-0 text-sm text-content-2 hover:text-content"
        >
          ←
        </button>
        <p className="text-sm font-semibold text-content truncate">{thread.guestName}</p>
  ```
  Then close the `<div className="min-w-0 ...">` in the same place the original `<div className="min-w-0">` was closed (after the `listingName` paragraph).

  The full replacement for the `min-w-0` sub-tree (from open to close) is:
  ```tsx
  <div className="min-w-0 flex items-start gap-2">
    <button
      type="button"
      onClick={onBack}
      className="md:hidden shrink-0 mt-0.5 text-sm text-content-2 hover:text-content"
    >
      ←
    </button>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-content truncate">{thread.guestName}</p>
      {thread.isInquiry ? (
        <p className="text-xs text-notice-text mt-0.5">
          {t('channex.messages.inquiry')} · {thread.checkinDate ?? '—'} → {thread.checkoutDate ?? '—'}
        </p>
      ) : null}
      {thread.listingName && (
        <p className="text-xs text-content-3 mt-0.5 truncate">{thread.listingName}</p>
      )}
    </div>
  </div>
  ```

- [ ] **Step 5: Fix the outer container**

  Find:
  ```tsx
  <div className="flex h-[480px] overflow-hidden rounded-2xl border border-edge bg-surface-raised">
  ```
  Replace with:
  ```tsx
  <div className="flex flex-col md:flex-row md:h-[480px] overflow-hidden rounded-2xl border border-edge bg-surface-raised">
  ```

- [ ] **Step 6: Fix the thread list panel**

  Find:
  ```tsx
  <div className="w-64 shrink-0 overflow-y-auto border-r border-edge">
  ```
  Replace with:
  ```tsx
  <div className={[
    'shrink-0 overflow-y-auto border-b border-edge md:border-b-0 md:border-r',
    'w-full md:w-64',
    selectedThread ? 'hidden md:block' : 'block',
  ].join(' ')}>
  ```

- [ ] **Step 7: Fix the conversation pane**

  Find:
  ```tsx
  <div className="flex-1 min-w-0 overflow-hidden">
  ```
  Replace with:
  ```tsx
  <div className={[
    'flex-1 min-w-0 overflow-hidden',
    selectedThread ? 'block h-[480px] md:h-auto' : 'hidden md:flex',
  ].join(' ')}>
  ```

- [ ] **Step 8: Pass `onBack` to `ConversationPane`**

  Find the `ConversationPane` usage (inside the conversation pane div):
  ```tsx
  <ConversationPane
    key={`${selectedThread.propertyId}-${selectedThread.id}`}
    tenantId={tenantId}
    thread={selectedThread}
  />
  ```
  Replace with:
  ```tsx
  <ConversationPane
    key={`${selectedThread.propertyId}-${selectedThread.id}`}
    tenantId={tenantId}
    thread={selectedThread}
    onBack={() => setSelectedThread(null)}
  />
  ```

- [ ] **Step 9: Verify**

  Confirm that:
  - All existing state variables, effects, and handlers are untouched
  - The only new code is the `onBack` prop and the back `<button>`
  - The `← Volver` button is only visible at `< md:` (has `md:hidden`)

---

## Task 4: ReservationsPanel.tsx — header stacks on mobile

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx`

- [ ] **Step 1: Read the file**

  Read `apps/frontend/src/channex/components/shared/ReservationsPanel.tsx` in full.

- [ ] **Step 2: Fix the header row (line ~300)**

  Find the reservation count + buttons header:
  ```tsx
  <div className="mb-3 flex items-center justify-between">
  ```
  Replace with:
  ```tsx
  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  ```
  The inner `<div className="flex items-center gap-2">` that wraps the timestamp + buttons stays completely unchanged.

- [ ] **Step 3: Verify**

  No other changes. The reservation cards, empty state, import button, and modal are untouched.

---

## Task 5: ARICalendar.tsx — header wrap + calendar scroll + side-sheet width

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/ARICalendar.tsx`

This file is large (~1283 lines). Read it fully, then apply three targeted edits.

- [ ] **Step 1: Read the file**

  Read `apps/frontend/src/channex/components/shared/ARICalendar.tsx` in full.

- [ ] **Step 2: Fix the header bar (line ~501)**

  Find:
  ```tsx
  <div className="flex items-center justify-between">
    <div>
      <h3 className="text-base font-semibold text-content">{t('channex.ari.title')}</h3>
      <p className="text-xs text-content-2">{t('channex.ari.desc')}</p>
    </div>
    <div className="flex items-center gap-2">
  ```
  Replace only the outer div's classes:
  ```tsx
  <div className="flex flex-wrap items-start justify-between gap-y-2">
    <div>
      <h3 className="text-base font-semibold text-content">{t('channex.ari.title')}</h3>
      <p className="text-xs text-content-2">{t('channex.ari.desc')}</p>
    </div>
    <div className="flex items-center gap-2">
  ```

- [ ] **Step 3: Wrap the calendar grid for horizontal scroll on mobile**

  Find the calendar grid container (line ~640). It currently starts with:
  ```tsx
  {/* Calendar grid */}
  <div className="relative overflow-hidden rounded-2xl border border-edge bg-surface-raised select-none" onMouseDown={(e) => e.preventDefault()}>
  ```
  Wrap it in a scroll container by changing it to:
  ```tsx
  {/* Calendar grid */}
  <div className="overflow-x-auto">
    <div className="relative min-w-[420px] overflow-hidden rounded-2xl border border-edge bg-surface-raised select-none" onMouseDown={(e) => e.preventDefault()}>
  ```
  Then close the new outer `<div className="overflow-x-auto">` immediately after the closing tag of the original grid div (the `</div>` that closes the `rounded-2xl` div). Add one `</div>` after it.

  The closing region currently looks like:
  ```tsx
            </div>
          </div>
        </>
      )}
  ```
  After the edit it should look like:
  ```tsx
            </div>
          </div>
        </div>{/* end overflow-x-auto */}
        </>
      )}
  ```

- [ ] **Step 4: Fix the ARI side-sheet width (line ~737)**

  Find:
  ```tsx
  <div className="fixed inset-y-0 right-0 z-50 w-96 border-l border-edge bg-surface-raised p-6 shadow-2xl overflow-y-auto">
  ```
  Replace with:
  ```tsx
  <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 border-l border-edge bg-surface-raised p-6 shadow-2xl overflow-y-auto">
  ```

- [ ] **Step 5: Verify**

  Confirm:
  - The booking modal (`fixed inset-x-4 top-[8%] max-w-md`) is untouched
  - The full-sync modal (`fixed inset-x-4 top-[5%] max-w-lg`) is untouched
  - No state, effects, or handlers were modified

---

## Task 6: RoomRateManager.tsx — occupancy grid + rate form wrap

**Files:**
- Modify: `apps/frontend/src/channex/components/shared/RoomRateManager.tsx`

- [ ] **Step 1: Read the file**

  Read `apps/frontend/src/channex/components/shared/RoomRateManager.tsx` in full.

- [ ] **Step 2: Fix the occupancy 3-column grid (line ~95, inside `RoomFormFields`)**

  Find:
  ```tsx
  <div className="grid grid-cols-3 gap-3">
  ```
  Replace with:
  ```tsx
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
  ```
  On mobile: adults + children in row 1, infants in row 2 (spanning 1 col). At `sm:` all three are inline again.

- [ ] **Step 3: Fix the inline rate plan form (line ~339)**

  Find:
  ```tsx
  <div className="flex items-center gap-2 rounded-xl border border-brand-light bg-brand-subtle px-3 py-2">
  ```
  Replace with:
  ```tsx
  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-light bg-brand-subtle px-3 py-2">
  ```

- [ ] **Step 4: Verify**

  No other changes. The 2-column form grids (`grid-cols-2`) in `RoomFormFields` are already fine and stay untouched.

---

## Task 7: Final verification pass

- [ ] **Step 1: TypeScript check**

  Run from repo root:
  ```bash
  pnpm --filter @migo-uit/frontend tsc --noEmit
  ```
  Expected: zero errors. If errors appear, they will be in `MessagesInbox.tsx` around the `onBack` prop — fix them before proceeding.

- [ ] **Step 2: Manual visual check at 375px (iPhone SE)**

  Start the dev server:
  ```bash
  pnpm dev
  ```
  Open `https://localhost:5173` and navigate to the Channex section. In DevTools set width to 375px. Verify:
  - [ ] ChannexHub sub-tabs wrap to two lines without overflow
  - [ ] Content left/right padding is visibly reduced on mobile
  - [ ] PropertyDetail header stacks (buttons drop below title)
  - [ ] PropertyDetail inner tabs wrap
  - [ ] MessagesInbox shows full-width thread list on mobile
  - [ ] Tapping a thread shows only the conversation with `←` back button
  - [ ] Tapping `←` returns to thread list
  - [ ] ReservationsPanel header count + buttons stack vertically
  - [ ] ARICalendar header buttons wrap below title
  - [ ] ARICalendar is horizontally scrollable on mobile
  - [ ] ARI side-sheet opens full-width on mobile

- [ ] **Step 3: Manual visual check at 768px (tablet)**

  Set DevTools to 768px. Verify:
  - [ ] MessagesInbox shows two-column layout (thread list + conversation side by side)
  - [ ] Back button `←` in conversation header is hidden
  - [ ] All tabs display in a single row without overflow

- [ ] **Step 4: Manual visual check at 1280px (desktop)**

  Set DevTools to 1280px. Verify:
  - [ ] Everything looks identical to the pre-refactor state
  - [ ] No regressions in PropertiesList, PoolsList, or GlobalOverview

- [ ] **Step 5: Check no style regressions**

  Scan all 6 modified files and confirm that no semantic color tokens, font classes, border/shadow classes, or animation classes were added, removed, or changed.
