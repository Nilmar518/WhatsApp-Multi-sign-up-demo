# Native Airbnb Architecture Refactor

## Purpose

This document defines the structural refactor for the Channex.io x Airbnb integration so it matches the native Migo UIT integration architecture used by the Meta channels. The goal is not to relocate `AirbnbPage.tsx` into a different folder. The goal is to re-express Airbnb as a first-class integration that obeys the same page composition, state model, and interaction patterns already used by WhatsApp, Messenger, and Instagram.

The current Airbnb implementation is a standalone wizard. That is architecturally inconsistent with the rest of the dashboard. The refactor must remove that mismatch and align Airbnb with the native dashboard shell, while keeping Channex-specific behavior isolated from Meta-specific logic.

## What Was Observed in the Existing Meta Integration Pattern

The workspace does not currently contain a dedicated `src/integrations/` tree for Meta. The native integration pattern is distributed across the shared dashboard shell and the channel-specific components under `apps/frontend/src/components/` and `apps/frontend/src/hooks/`.

The pattern is consistent across the Meta channels:

- `App.tsx` owns the shared dashboard shell and the active channel state.
- `ChannelTabs` owns the top-level channel switcher.
- `ConnectionGateway` owns the WhatsApp onboarding modal flow and the transient setup-step state.
- `MessengerConnect` and `InstagramConnect` own channel-specific onboarding screens.
- `InstagramInbox` demonstrates the canonical native split-pane operational layout: a left navigation rail with grouped items and a right detail panel that changes based on the active selection.
- `StatusDisplay` is a compact status primitive, not a page-level layout decision.

The structural lesson is that Migo UIT does not use a wizard as the primary page model. It uses a dashboard shell with a channel tab, an onboarding gate when disconnected, and an operational two-pane surface when connected.

## Deduced Native Pattern

The native pattern can be described as follows:

1. The dashboard shell is stable and shared.
2. A tab chooses the active integration domain.
3. The integration itself exposes a small state machine with a disconnected state, an onboarding state, and a connected operational state.
4. Once connected, the integration should render a split-pane layout.
5. The left pane is used for navigation, queueing, summary, and grouped lists.
6. The right pane is used for the currently selected detail surface, editor, thread, or embedded action panel.
7. Status is shown as a compact inline indicator or a summary card, not as a wizard stepper.

For Airbnb, this means the four-step wizard is the wrong abstraction. It needs to be replaced with a native integration layout that behaves like the rest of the platform.

## Structural Mapping: Old Airbnb Concepts to Native Migo UIT Layout

### 1. Provisioning Form

Current role:

- Acts as step 1 of a standalone wizard.
- Creates the Channex property and advances the user into the connection flow.

Native role:

- Becomes the onboarding gate shown when the Airbnb integration is not yet provisioned.
- Should not own top-level navigation or wizard progression.
- Should be rendered as a channel-specific connect/setup surface, similar in importance to `MessengerConnect` or `InstagramConnect`.

Placement recommendation:

- If the property does not exist yet, show the provisioning form as the main onboarding surface.
- After provisioning, collapse it into a compact setup summary card in the left rail or a header summary block.
- Do not keep it as a numbered step in the public UI.

### 2. Connection Status Badge

Current role:

- Lives inside the standalone Airbnb wizard and polls the backend for the property state.

Native role:

- Should become a compact integration summary element, not a wizard step.
- Best placement is in the left sidebar header area, directly above the navigation sections.
- It should behave like a dashboard health indicator: current status, reconnect action, sync state, and optional last sync timestamp.

Placement recommendation:

- Put it in the left sidebar header or top utility strip.
- Keep it visible across all connected views.
- Use it as the decision point for reconnect, token refresh, and reauthorization flows.

### 3. Channex IFrame OAuth Flow

Current role:

- Occupies step 2 of the wizard and is launched after provisioning.
- Used to complete Airbnb authorization through Channex.

Native role:

- Becomes the connection content surface that appears when the integration is not yet linked or requires repair.
- This should be a right-pane detail surface, not an entire page with its own stepper.
- It should be launched from the integration shell, with the shell remaining intact.

Placement recommendation:

- Render in the right-hand content panel when the active view is `connect` or `repair`.
- Keep the left sidebar stable so the user still sees setup state and navigation context.
- The iframe should be treated as one detail mode among several, not as a page-level mode.

### 4. ARI Calendar

Current role:

- Serves as step 3 of the wizard.
- Pushes availability and restrictions through the Channex API.

Native role:

- Becomes the inventory editor surface inside the connected integration.
- It should be accessible from the left rail as an inventory section or settings-like section.
- It should not be gated by a wizard stepper.

Placement recommendation:

- Right pane content, selected from the left rail or a secondary section selector.
- This maps cleanly to the way Instagram shows a selected thread or comment detail while the list remains on the left.
- Keep ARI editing as a detail view, not a separate onboarding phase.

### 5. Reservation Inbox

Current role:

- Serves as step 4 of the wizard.
- Lists reservations in a Firestore-backed table, allows phone linking, and opens the chat drawer.

Native role:

- This is the strongest candidate for the main left-side navigation list in the native layout.
- It should become the reservation list / conversation list analog, not a wizard page.
- The right pane should hold the selected reservation detail, chat drawer anchor, or action panel.

Placement recommendation:

- Left sidebar: reservation list, status badges, unread markers, and linking state.
- Right panel: selected reservation detail, guest contact view, ChatConsole drawer trigger target, or unmapped booking remediation.
- This is the closest Airbnb equivalent to InstagramInbox's conversation and comment list model.

### 6. Unmapped Room Modal

Current role:

- Full-screen blocking modal triggered from SSE when a booking arrives without a room mapping.

Native role:

- Keep the blocking behavior, but make the modal an operational interrupt rather than a separate page mode.
- It should remain global and modal because it is a critical-risk state.

Placement recommendation:

- Overlay the integration shell and force the user back to the connection/repair detail mode.
- Do not demote it into the sidebar or a toast.

## Recommended Native Airbnb Layout Model

Airbnb should be refactored into the same broad composition model as the native Meta integrations:

### A. Integration Shell

A single `AirbnbIntegration` entry component should own:

- integration loading and readiness
- connected vs disconnected state
- active section selection
- compact status summary
- shell-level SSE state
- modal interrupts such as unmapped room recovery

This shell should not be a stepper.

### B. Left Sidebar

The left sidebar should aggregate all summary and list navigation concerns:

- property status summary
- provisioning / reconnect CTA
- connection health badge
- reservation list or inbox list
- sync and alert indicators
- inventory navigation shortcuts

The sidebar should remain stable while the right pane changes.

### C. Right Content Pane

The right pane should render exactly one primary detail surface at a time:

- provisioning setup when not yet onboarded
- Channex iframe when the user needs to connect or repair the Airbnb account
- ARI calendar when editing inventory and restrictions
- reservation detail or chat panel when a reservation is selected
- empty state when the selected section has no data

This aligns with InstagramInbox's selected-thread model and with the dashboard's general split-pane philosophy.

## State and Context Alignment

The current Airbnb page uses a four-step wizard state:

- `PROVISION`
- `CONNECT`
- `INVENTORY`
- `BOOKINGS`

That model must be removed.

The native dashboard model should instead use a small integration state machine that fits the existing pattern in `App.tsx` and the other connect components:

- `unprovisioned`
- `connecting`
- `connected`
- `repair_required`
- `syncing`
- `error`

Within the connected state, a second layer of local selection should determine which detail view is shown:

- `reservations`
- `inventory`
- `connection`
- `alerts`
- `reservation_detail`
- `chat`

This is the right abstraction because it separates lifecycle state from navigation state.

### Why the Wizard Must Go

The wizard is too rigid for a native integration shell.

It forces the user through a linear path even though the operational UI needs:

- direct access to reservations after onboarding
- fast repair flows when mapping fails
- persistent visibility into status and alerts
- non-linear switching between setup, inventory, and messaging

The Meta integrations already prove that the platform model is non-linear. Once an integration exists, users move between lists, details, and actions. Airbnb should follow the same rule.

## Technical Refactor Plan

### Phase 1: Extract the native shell boundary

Create a new integration entry component under `apps/frontend/src/integrations/airbnb/` that owns the shell-level state.

Responsibilities:

- read tenant and business context
- resolve the Airbnb integration document and connection status
- subscribe to SSE for booking and connection updates
- keep global modals and repair flows at shell level
- route the right pane based on the current view

The existing `AirbnbPage.tsx` should be treated as a temporary source file, not as the final architecture.

### Phase 2: Decompose the wizard into view primitives

Split the old wizard into native view primitives:

- provisioning setup card
- connection summary/status header
- connect/repair iframe view
- inventory editor view
- reservation list view
- reservation detail/chat view
- critical alert overlay

Each primitive should become a leaf view rendered by the shell, not a controller of the whole page.

### Phase 3: Rebuild the left rail

Replace the step bar with a native left navigation rail.

The left rail should contain:

- connection status
- property identity
- reservation queue summary
- alert badges
- inventory entry point
- action buttons for reconnect or repair

The rail should behave like the Instagram inbox sidebar rather than like a wizard progress tracker.

### Phase 4: Rebuild the right pane as a detail canvas

The right pane should change based on the selected native section.

Expected detail states:

- onboarding/provisioning
- connection iframe
- ARI calendar
- selected reservation detail
- empty state
- blocking repair state

The right pane should never be tied to a numbered step.

### Phase 5: Remove route special-casing

The current standalone `/airbnb` route should be removed from `main.tsx` once Airbnb is embedded into the dashboard tab architecture.

Airbnb should be selected from the same top-level channel switcher as the other integrations.

### Phase 6: Align top-level channel state

Extend the shared channel model so Airbnb participates as a first-class channel.

This includes:

- adding Airbnb to the tab strip
- adding the new integration shell to the channel switch logic
- preserving the existing dashboard layout contract
- avoiding any new Airbnb-specific global routing shortcuts

### Phase 7: Keep the domain boundary clean

Airbnb must remain isolated from Meta-specific behavior.

Do not move Meta login logic, Facebook SDK assumptions, or Instagram comment handling into the Airbnb integration tree.

The shared shell is the only shared surface. Domain logic stays domain-specific.

## File-Level Target Architecture

The final Airbnb integration should be organized around these conceptual surfaces:

- `AirbnbIntegration.tsx` as the native shell entry point
- `AirbnbSidebar.tsx` for status, summary, and list navigation
- `AirbnbDetailPane.tsx` for the active right-side content
- `AirbnbProvisioningCard.tsx` for first-run setup
- `AirbnbConnectionPanel.tsx` for iframe-based OAuth and repair
- `AirbnbInventoryPanel.tsx` for ARI operations
- `AirbnbReservationList.tsx` for the inbox/list view
- `AirbnbReservationDetail.tsx` or `AirbnbChatPanel.tsx` for the selected reservation
- `AirbnbCriticalAlert.tsx` for unmapped-room blocking states

Not all of these need separate files on day one, but the refactor should be designed around these responsibilities.

## Migration Risks

The main risks are architectural, not just mechanical.

- Replacing the wizard with a shell may expose assumptions in the current event flow.
- Firestore listeners may need to be re-scoped from page lifecycle to panel lifecycle.
- The existing chat drawer integration must continue to work when the reservation list becomes sidebar-based.
- The unmapped-room interrupt must still override the active view without causing stale UI state.
- The connection status badge must continue polling without forcing a full page refresh.

These risks are manageable if the refactor is done as a state model rewrite rather than a file move.

## Acceptance Criteria

The refactor is complete when:

- Airbnb renders as a native dashboard integration, not a standalone route.
- The UI uses the same shell and split-pane conventions as the other integrations.
- The four-step wizard is gone from the public interface.
- Provisioning, connection, inventory, and reservations are surfaced as shell-driven views.
- The reservation list behaves like a native left-rail list, not a full-page table.
- The iframe and ARI editor appear as detail views inside the integration shell.
- The unmapped-room modal still blocks the user and forces repair.
- The dashboard tab system can switch into Airbnb without route special-casing.

## Next Step

After this document is approved, the implementation should proceed by converting the standalone Airbnb tree into the native integration shell and then wiring it into the dashboard tab model.
