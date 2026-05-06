# Sidebar Navigation Design

**Date:** 2026-05-06

## Goal

Add a collapsible left sidebar that is visible only in the main app route (`/`), not in `/inventory` or `/catalog-manager`. The sidebar contains a Users tab (placeholder — implementation deferred) and a logout button at the bottom. This is the primary driver: giving users a persistent, accessible sign-out action.

## Architecture

Two new components + one minimal change to `main.tsx`:

- `src/layout/SideNav.tsx` — the sidebar (self-contained, owns collapsed state)
- `src/layout/MainLayout.tsx` — flex wrapper `[SideNav | children]`
- `src/main.tsx` — wraps `<App>` with `<MainLayout>` for the default route only

`App.tsx` is **not modified**.

## Components

### `SideNav`

**Collapsed state** (~56px wide): icons only, toggle button `›` at top-right.  
**Expanded state** (~200px wide): icons + labels, toggle button `‹` at top-right.  
Transition: `transition-all duration-200 ease-in-out` on width.  
Collapsed preference persists in `localStorage` key `sidenav_collapsed`.

**Tabs section (grows to fill space):**

| Tab | Icon | Behavior |
|-----|------|----------|
| Users | 👤 | Shows inline "Próximamente" message with fade-in animation next to the sidebar. No navigation. |

"Próximamente" message: absolutely positioned panel that appears to the right of the sidebar when Users is the active tab. Dismissed by clicking the tab again or anywhere outside.

**Bottom section (pinned):**

| Item | Icon | Behavior |
|------|------|----------|
| Cerrar sesión | →exit icon | Calls `signOut(auth)` from `../firebase/firebase`. On success Firebase `onAuthStateChanged` in `AuthGate` redirects to `LoginPage` automatically. |

### `MainLayout`

```tsx
<div className="flex min-h-screen">
  <SideNav />
  <div className="flex-1 min-w-0">{children}</div>
</div>
```

No state, no logic. Pure layout wrapper.

### `main.tsx` change

```tsx
{isInventory ? (
  <InventoryPage />
) : isCatalogManager ? (
  <CatalogManagerApp />
) : (
  <MainLayout>
    <App />
  </MainLayout>
)}
```

## Data Flow

- `SideNav` reads/writes `localStorage` for collapsed preference — no prop drilling needed.
- Logout: `signOut(auth)` → Firebase triggers `onAuthStateChanged(null)` → `AuthGate` renders `<LoginPage />` automatically. No extra state management required.
- "Próximamente" panel: local `activeTab` state in `SideNav`, set on tab click, cleared on second click or outside click.

## Visual Design

- Background: `bg-slate-900` (dark sidebar, contrasts with the light `App` background)
- Text/icons: `text-slate-300`, active tab: `text-white bg-slate-700`
- Logout button: `text-red-400 hover:text-red-300`
- Collapsed width: `w-14` (56px)
- Expanded width: `w-48` (192px)
- "Próximamente" panel: `bg-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2` with `animate-fade-in`

## What is NOT in scope

- Users list/CRUD UI (deferred)
- Route-level navigation (sidebar does not change the URL or App's active channel)
- Mobile/responsive collapsing (out of scope for now)
