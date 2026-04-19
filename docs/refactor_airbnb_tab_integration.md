# Refactor Plan: Move Airbnb from Standalone Page to Unified Dashboard Tab

## Purpose
This document describes the refactor required to migrate the Airbnb integration UI from a standalone `/airbnb` page into the main Migo UIT dashboard as a fourth tab alongside WhatsApp, Messenger, and Instagram.

The current implementation is functionally correct, but the placement is architecturally inconsistent with the rest of the product. The dashboard already uses a tab-driven layout in [apps/frontend/src/App.tsx](../apps/frontend/src/App.tsx) and [apps/frontend/src/components/ChannelTabs/index.tsx](../apps/frontend/src/components/ChannelTabs/index.tsx). Airbnb should follow the same model and live inside the unified shell.

## Target Architecture
Airbnb becomes a first-class integration tab:

- WhatsApp
- Messenger
- Instagram
- Airbnb

The Airbnb tab will render inside the same dashboard container as the other integrations, while retaining its independent Channex-specific backend and frontend data flow.

## Current State
The current Airbnb implementation is split across:

- [apps/frontend/src/airbnb/AirbnbPage.tsx](../apps/frontend/src/airbnb/AirbnbPage.tsx)
- [apps/frontend/src/airbnb/api/channexApi.ts](../apps/frontend/src/airbnb/api/channexApi.ts)
- [apps/frontend/src/airbnb/components/*](../apps/frontend/src/airbnb/components)

It is currently mounted from [apps/frontend/src/main.tsx](../apps/frontend/src/main.tsx) through pathname routing for `/airbnb`.

That creates two problems:

1. It bypasses the existing dashboard shell and conversation layout.
2. It introduces a special-case route for one integration instead of using the shared tab system.

## Refactor Goals

1. Move all Airbnb UI code into the integrations folder pattern used by the rest of the application.
2. Add Airbnb as a peer tab in the existing dashboard tab strip.
3. Refactor the current Airbnb orchestrator into an integration tab component that renders inside the dashboard content area.
4. Keep Channex, SSE, BullMQ, and Firestore logic fully isolated from Meta/WhatsApp/Messenger/Instagram logic.
5. Remove the standalone `/airbnb` route from `main.tsx`.

---

## Phase 1: Directory Restructuring

### Proposed new structure
Move the Airbnb feature from `src/airbnb/` to `src/integrations/airbnb/`.

### Target file map
- [apps/frontend/src/airbnb/AirbnbPage.tsx](../apps/frontend/src/airbnb/AirbnbPage.tsx) -> [apps/frontend/src/integrations/airbnb/AirbnbIntegrationTab.tsx](../apps/frontend/src/integrations/airbnb/AirbnbIntegrationTab.tsx)
- [apps/frontend/src/airbnb/api/channexApi.ts](../apps/frontend/src/airbnb/api/channexApi.ts) -> [apps/frontend/src/integrations/airbnb/api/channexApi.ts](../apps/frontend/src/integrations/airbnb/api/channexApi.ts)
- [apps/frontend/src/airbnb/components/PropertyProvisioningForm.tsx](../apps/frontend/src/airbnb/components/PropertyProvisioningForm.tsx) -> [apps/frontend/src/integrations/airbnb/components/PropertyProvisioningForm.tsx](../apps/frontend/src/integrations/airbnb/components/PropertyProvisioningForm.tsx)
- [apps/frontend/src/airbnb/components/ConnectionStatusBadge.tsx](../apps/frontend/src/airbnb/components/ConnectionStatusBadge.tsx) -> [apps/frontend/src/integrations/airbnb/components/ConnectionStatusBadge.tsx](../apps/frontend/src/integrations/airbnb/components/ConnectionStatusBadge.tsx)
- [apps/frontend/src/airbnb/components/ARICalendar.tsx](../apps/frontend/src/airbnb/components/ARICalendar.tsx) -> [apps/frontend/src/integrations/airbnb/components/ARICalendar.tsx](../apps/frontend/src/integrations/airbnb/components/ARICalendar.tsx)
- [apps/frontend/src/airbnb/components/ReservationInbox.tsx](../apps/frontend/src/airbnb/components/ReservationInbox.tsx) -> [apps/frontend/src/integrations/airbnb/components/ReservationInbox.tsx](../apps/frontend/src/integrations/airbnb/components/ReservationInbox.tsx)
- [apps/frontend/src/airbnb/components/ChannexIFrame.tsx](../apps/frontend/src/airbnb/components/ChannexIFrame.tsx) -> [apps/frontend/src/integrations/airbnb/components/ChannexIFrame.tsx](../apps/frontend/src/integrations/airbnb/components/ChannexIFrame.tsx)
- [apps/frontend/src/airbnb/components/UnmappedRoomModal.tsx](../apps/frontend/src/airbnb/components/UnmappedRoomModal.tsx) -> [apps/frontend/src/integrations/airbnb/components/UnmappedRoomModal.tsx](../apps/frontend/src/integrations/airbnb/components/UnmappedRoomModal.tsx)

### New integration folder conventions
The `src/integrations/airbnb/` tree should mirror the existing modular style used elsewhere in the frontend:

- `api/` for backend wrappers
- `components/` for visual building blocks
- `hooks/` later if Airbnb-specific hooks are needed
- a top-level orchestrator component for tab rendering

This keeps the feature self-contained and makes future integrations easier to add without repeating the standalone-page pattern.

---

## Phase 2: Dashboard Tab Integration

### Current dashboard model
The dashboard currently selects between channels with state-driven tab selection:

- [apps/frontend/src/App.tsx](../apps/frontend/src/App.tsx) stores `activeChannel`
- [apps/frontend/src/components/ChannelTabs/index.tsx](../apps/frontend/src/components/ChannelTabs/index.tsx) renders the tab strip
- The content area below the tabs conditionally renders WhatsApp, Messenger, or Instagram

### Refactor approach
Add Airbnb as a fourth branch in the same selection flow.

### Required changes
1. Extend the `Channel` type to include `airbnb`.
2. Add a new tab definition for Airbnb in [ChannelTabs](../apps/frontend/src/components/ChannelTabs/index.tsx).
3. Update [App.tsx](../apps/frontend/src/App.tsx) to treat `activeChannel === 'airbnb'` as a peer branch.
4. Render the Airbnb integration inside the same dashboard container structure as the other tabs.

### Expected visual behavior
The Airbnb tab should sit beside the existing tabs in the same tab strip. When active, it should render a dashboard view that feels native to the product, not a separate application.

### Tab state model
The state selection mechanism can remain simple and explicit:

```ts
activeChannel === 'whatsapp'
activeChannel === 'messenger'
activeChannel === 'instagram'
activeChannel === 'airbnb'
```

This preserves the current style of the codebase and avoids introducing an external router or a heavier state abstraction.

---

## Phase 3: Orchestrator Refactor into `AirbnbIntegrationTab.tsx`

### Rename and reposition
`AirbnbPage.tsx` should be refactored into a dashboard tab component named `AirbnbIntegrationTab.tsx`.

### Role of the refactored orchestrator
This component will remain the top-level Airbnb integration controller, but it will no longer own page-level routing. Instead, it will render inside the main dashboard content area whenever the Airbnb tab is active.

### Responsibilities that remain inside the component
- 4-step wizard state:
  - `PROVISION`
  - `CONNECT`
  - `INVENTORY`
  - `BOOKINGS`
- SSE connection to Channex events
- Property provisioning flow
- Channex IFrame onboarding flow
- ARI scheduling controls
- Reservation inbox and guest messaging UI
- Blocking unmapped-room modal

### Layout adaptation
The component should be reworked to fit the dashboard shell instead of a standalone page.

Current standalone structure:
- page-wide container
- header
- step bar
- single-column content blocks

New dashboard-fit structure:
- render inside the existing dashboard content region
- use a nested left/right split when helpful
- align with the dashboard’s existing conversation-style layout
- avoid its own global page shell, outer min-height page framing, or separate route chrome

### Recommended internal layout
Because the dashboard already has a left sidebar for conversations/bookings and a right pane for chat or detail views, Airbnb should follow the same mental model:

- left area: property setup status, booking list, reservation metadata, onboarding step context
- right area: IFrame, ARI controls, chat drawer, or modal surfaces

The wizard can still exist, but it should be visually nested inside the tab content rather than presented as a separate application flow.

### Component naming recommendation
Use `AirbnbIntegrationTab` to make the intent explicit:

- it is an integration module
- it is tab-scoped
- it belongs under `src/integrations/airbnb/`

---

## Phase 4: Decoupling Meta vs. Channex

### Important boundary
Airbnb shares the UI shell with the other integrations, but its internals must remain fully separate from Meta and catalog logic.

### What must stay independent
- SSE stream handling for Channex events
- Channex API calls
- Firestore structures for `channex_integrations`
- BullMQ and webhook bridge logic on the backend
- Airbnb-specific guest linking and chat handoff

### What can be shared
- The dashboard shell
- The common tab strip
- Generic styling and layout primitives
- High-level pattern of state-based tab selection

### What should not be shared
- Meta/WhatsApp hooks
- Messenger or Instagram connection flows
- WhatsApp catalog logic
- Meta-specific Firestore integration resolution
- Meta-specific message send logic

The goal is architectural consistency, not logic convergence. Airbnb should feel native in the same UI shell without importing the Meta domain model.

---

## Phase 5: Main Route Cleanup

### Current issue
[apps/frontend/src/main.tsx](../apps/frontend/src/main.tsx) still contains a special-case `/airbnb` pathname branch.

That route should be removed after the tab refactor is complete.

### Cleanup steps
1. Remove the `AirbnbPage` import from [main.tsx](../apps/frontend/src/main.tsx).
2. Remove the `isAirbnb` pathname check.
3. Remove the conditional rendering branch that mounts the standalone page.
4. Let the normal dashboard app render as the default entry point.

### Result
The app will only route to the standard dashboard surface. Airbnb becomes available through the unified tab system, not through a separate page entry point.

---

## Phase 6: Suggested File-by-File Migration Scope

### Frontend files to move
- `src/airbnb/AirbnbPage.tsx`
- `src/airbnb/api/channexApi.ts`
- `src/airbnb/components/PropertyProvisioningForm.tsx`
- `src/airbnb/components/ConnectionStatusBadge.tsx`
- `src/airbnb/components/ARICalendar.tsx`
- `src/airbnb/components/ReservationInbox.tsx`
- `src/airbnb/components/ChannexIFrame.tsx`
- `src/airbnb/components/UnmappedRoomModal.tsx`

### Frontend files to update
- [apps/frontend/src/App.tsx](../apps/frontend/src/App.tsx)
- [apps/frontend/src/components/ChannelTabs/index.tsx](../apps/frontend/src/components/ChannelTabs/index.tsx)
- [apps/frontend/src/main.tsx](../apps/frontend/src/main.tsx)
- any relative imports inside the moved Airbnb files

### No backend logic changes required for this refactor
The Channex backend can remain as-is. This task is a frontend architecture cleanup, not a Channex API redesign.

---

## Phase 7: Implementation Order

Recommended execution sequence:

1. Create the new `src/integrations/airbnb/` directory structure.
2. Move the existing Airbnb files into the new location.
3. Refactor `AirbnbPage.tsx` into `AirbnbIntegrationTab.tsx`.
4. Update internal imports and relative paths.
5. Extend `ChannelTabs` with Airbnb.
6. Update `App.tsx` to render the Airbnb tab.
7. Remove the `/airbnb` route from `main.tsx`.
8. Validate layout in the unified dashboard shell.
9. Run type checks and visual verification.

---

## Phase 8: Risks and Watchouts

### Import path drift
Moving files under `src/integrations/airbnb/` will require systematic import updates. This is the main mechanical risk.

### Layout mismatch
The standalone Airbnb page currently assumes full-page space. After the move, some sections will need to be made more compact to fit the dashboard content region.

### Shared component assumptions
The current `ReservationInbox` and chat drawer behavior were built around standalone rendering. They may need minor layout adjustments when nested inside the dashboard’s existing container.

### Tab-state type changes
Adding Airbnb to the tab strip will require updating any `Channel` union types and related default state assumptions.

### Avoiding cross-domain leakage
Keep the new integration tab isolated from Meta-specific hooks and components. Only the shell is shared.

---

## Summary
Airbnb should no longer be treated as a separate page. It should become a 4th dashboard integration tab under `src/integrations/airbnb/`, with the current wizard preserved as an internal orchestrator component named `AirbnbIntegrationTab`.

The plan is to:

- move the Airbnb frontend feature into the integrations folder pattern,
- add Airbnb to the existing dashboard tab strip,
- refactor the standalone page into an embedded tab component,
- preserve Channex-specific logic as an isolated integration domain,
- and remove the `/airbnb` route from `main.tsx`.

Once approved, the next step is to generate the refactored code and update all import paths accordingly.
