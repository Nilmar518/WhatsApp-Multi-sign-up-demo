# Channex Connection UX Standardization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the Airbnb and Booking.com connection panels so both embed the Channex OAuth flow inline (iframe), and both show a guided 3-step empty state when no Channex property exists.

**Architecture:** Create a shared `NoPropertyGuide` component; parameterize `ChannexOAuthIFrame` with `channel` + `getToken` props; refactor `BookingConnectionPanel` to remove the popup and use the iframe; pass `onNavigateToProperties` from `ChannexHub` down to both panels.

**Tech Stack:** React 18, TypeScript, Tailwind CSS (design token classes like `bg-brand`, `text-content-2`, `border-edge`), Vite

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/frontend/src/channex/components/connection/NoPropertyGuide.tsx` | Create | Shared 3-step guide rendered when no Channex property exists |
| `apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx` | Modify | Generic iframe — accepts `channel` + `getToken` props instead of hardcoding Airbnb |
| `apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx` | Modify | Add `onNavigateToProperties` prop; update iframe call site; swap empty state |
| `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx` | Modify | Remove popup; add iframe; add `onNavigateToProperties` prop; swap empty state |
| `apps/frontend/src/channex/ChannexHub.tsx` | Modify | Pass `onNavigateToProperties={() => setActiveSubTab('properties')}` to both panels |

> **No backend changes required.**

---

## Task 1: Create `NoPropertyGuide` shared component

**Files:**
- Create: `apps/frontend/src/channex/components/connection/NoPropertyGuide.tsx`

- [ ] **Step 1.1: Create the file with the full component**

```tsx
// apps/frontend/src/channex/components/connection/NoPropertyGuide.tsx

interface Props {
  channel: 'airbnb' | 'booking';
  onNavigateToProperties: () => void;
}

const CHANNEL_LABELS: Record<Props['channel'], string> = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
};

const SYNC_LABELS: Record<Props['channel'], string> = {
  airbnb: 'Sync Listings',
  booking: 'Sync Rooms & Rates',
};

export default function NoPropertyGuide({ channel, onNavigateToProperties }: Props) {
  const steps = [
    {
      title: 'Crea tu primera propiedad',
      description:
        'Ve a la pestaña Properties y completa el asistente de configuración para registrar tu propiedad en Channex.',
      action: (
        <button
          type="button"
          onClick={onNavigateToProperties}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          → Ir a Properties
        </button>
      ),
    },
    {
      title: `Conecta tu cuenta de ${CHANNEL_LABELS[channel]}`,
      description:
        'Regresa a esta pestaña y autoriza el acceso desde el panel de conexión que aparecerá aquí.',
      action: null,
    },
    {
      title: 'Sincroniza tus listings',
      description: `Una vez conectado, usa el botón "${SYNC_LABELS[channel]}" para importar tus propiedades.`,
      action: null,
    },
  ];

  return (
    <div className="space-y-3">
      <p className="mb-4 text-sm text-content-2">
        Todavía no tienes una propiedad en Channex. Sigue estos pasos para comenzar:
      </p>
      {steps.map((step, index) => (
        <div
          key={index}
          className="flex items-start gap-4 rounded-xl border border-edge bg-surface-raised px-4 py-4"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
            {index + 1}
          </div>
          <div>
            <p className="text-sm font-semibold text-content">{step.title}</p>
            <p className="mt-0.5 text-sm text-content-2">{step.description}</p>
            {step.action}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 1.2: Verify TypeScript compiles**

Run from repo root:
```bash
pnpm --filter @migo-uit/frontend exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 1.3: Commit**

```bash
git add apps/frontend/src/channex/components/connection/NoPropertyGuide.tsx
git commit -m "feat(channex): add NoPropertyGuide shared empty state component"
```

---

## Task 2: Parameterize `ChannexOAuthIFrame`

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx`

**Context:** The current file imports `getAirbnbSessionToken` and `getAirbnbCopyLink` directly and hardcodes `channels: 'ABB'`. We replace the whole file with a generic version.

- [ ] **Step 2.1: Replace the file contents**

```tsx
// apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx

import { useState, useEffect, useRef, useCallback } from 'react';

type IFrameStatus = 'IDLE' | 'FETCHING' | 'RENDERING' | 'CONNECTED' | 'ERROR';

interface Props {
  propertyId: string;
  channel: 'ABB' | 'BDC';
  getToken: (propertyId: string) => Promise<string>;
  onConnected?: () => void;
}

function buildIFrameUrl(token: string, propertyId: string, channel: 'ABB' | 'BDC'): string {
  const base =
    import.meta.env.VITE_CHANNEX_IFRAME_BASE_URL ?? 'https://staging.channex.io';
  const params = new URLSearchParams({
    oauth_session_key: token,
    app_mode: 'headless',
    redirect_to: '/channels',
    property_id: propertyId,
    channels: channel,
  });
  return `${base}/auth/exchange?${params.toString()}`;
}

export default function ChannexOAuthIFrame({ propertyId, channel, getToken, onConnected }: Props) {
  const [status, setStatus] = useState<IFrameStatus>('IDLE');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchToken = useCallback(async () => {
    if (!mountedRef.current) return;
    setStatus('FETCHING');
    setToken(null);
    setError(null);
    try {
      const t = await getToken(propertyId);
      if (!mountedRef.current) return;
      setToken(t);
      setStatus('RENDERING');
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to get session token.');
      setStatus('ERROR');
    }
  }, [propertyId, getToken]);

  useEffect(() => {
    void fetchToken();
  }, [fetchToken, iframeKey]);

  const handleIFrameError = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('ERROR');
    setError('The embedded panel failed to load. This may be caused by a browser security policy.');
  }, []);

  const handleIFrameLoad = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus('CONNECTED');
    onConnected?.();
  }, [onConnected]);

  const handleRetry = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const iframeUrl = token ? buildIFrameUrl(token, propertyId, channel) : null;

  return (
    <div className="w-full h-full min-h-[600px] flex flex-col">

      {(status === 'IDLE' || status === 'FETCHING') && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 text-content-3">
          <div
            className="w-8 h-8 border-2 border-edge border-t-notice-text rounded-full animate-spin"
            aria-label="Loading"
          />
          <p className="text-sm">Preparing secure connection panel...</p>
        </div>
      )}

      {status === 'ERROR' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12 px-6">
          <div className="max-w-md w-full bg-danger-bg border border-danger-text/20 rounded-xl px-5 py-4 text-sm text-danger-text">
            <p className="font-semibold mb-1">Connection panel unavailable</p>
            <p>{error ?? 'An unexpected error occurred.'}</p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="text-sm font-medium px-4 py-2 bg-notice-bg text-notice-text rounded-lg hover:opacity-80 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {iframeUrl && (status === 'RENDERING' || status === 'CONNECTED') && (
        <div className="relative flex-1 flex flex-col">
          {status === 'RENDERING' && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-notice-bg overflow-hidden z-10">
              <div className="h-full bg-notice-text animate-pulse w-2/3" />
            </div>
          )}
          <iframe
            key={iframeKey}
            src={iframeUrl}
            title="Connect your account"
            className="w-full h-full min-h-[600px] border-none rounded-lg shadow-sm flex-1"
            onLoad={handleIFrameLoad}
            onError={handleIFrameError}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
pnpm --filter @migo-uit/frontend exec tsc --noEmit
```

Expected: errors on `AirbnbConnectionPanel.tsx` only (its `ChannexOAuthIFrame` call site is now missing required props). This is expected — Task 3 fixes it.

- [ ] **Step 2.3: Commit**

```bash
git add apps/frontend/src/channex/components/connection/ChannexOAuthIFrame.tsx
git commit -m "refactor(channex): make ChannexOAuthIFrame channel-agnostic"
```

---

## Task 3: Update `AirbnbConnectionPanel`

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx`

**Changes needed:**
1. Add `onNavigateToProperties: () => void` to `Props`
2. Import `NoPropertyGuide`
3. Update `<ChannexOAuthIFrame>` call site with the two new required props
4. Replace the plain empty-state `<div>` with `<NoPropertyGuide>`

- [ ] **Step 3.1: Add the `onNavigateToProperties` prop to the interface**

Find:
```tsx
interface Props {
  tenantId: string;
}
```
Replace with:
```tsx
interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
}
```

- [ ] **Step 3.2: Destructure the new prop**

Find:
```tsx
export default function AirbnbConnectionPanel({ tenantId }: Props) {
```
Replace with:
```tsx
export default function AirbnbConnectionPanel({ tenantId, onNavigateToProperties }: Props) {
```

- [ ] **Step 3.3: Add the `NoPropertyGuide` import**

Add after the existing imports (after the `ChannexOAuthIFrame` import line):
```tsx
import NoPropertyGuide from './NoPropertyGuide';
```

- [ ] **Step 3.4: Fix the `ChannexOAuthIFrame` call site**

Find:
```tsx
<ChannexOAuthIFrame
  key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
  propertyId={baseProperty.channex_property_id}
/>
```
Replace with:
```tsx
<ChannexOAuthIFrame
  key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
  propertyId={baseProperty.channex_property_id}
  channel="ABB"
  getToken={getAirbnbSessionToken}
/>
```

- [ ] **Step 3.5: Replace the plain empty state with `NoPropertyGuide`**

Find:
```tsx
{!loading && !baseProperty && (
  <div className="rounded-xl border border-edge bg-surface-subtle px-4 py-3 text-sm text-content-2">
    No Channex property found. Create one in the <strong>Properties</strong> tab first.
  </div>
)}
```
Replace with:
```tsx
{!loading && !baseProperty && (
  <NoPropertyGuide channel="airbnb" onNavigateToProperties={onNavigateToProperties} />
)}
```

- [ ] **Step 3.6: Verify TypeScript compiles clean**

```bash
pnpm --filter @migo-uit/frontend exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3.7: Commit**

```bash
git add apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx
git commit -m "feat(channex): update AirbnbConnectionPanel — generic iframe call site + NoPropertyGuide"
```

---

## Task 4: Refactor `BookingConnectionPanel`

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`

**Context:** Currently the panel opens a browser popup (`openCenteredPopup`) for channel connection. We remove that and embed a `ChannexOAuthIFrame` instead, mirroring the Airbnb panel layout exactly.

- [ ] **Step 4.1: Replace the file contents entirely**

```tsx
// apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx

import { useState, useCallback, useEffect, useRef } from 'react';
import { useChannexProperties } from '../../hooks/useChannexProperties';
import {
  getBookingSessionToken,
  syncBookingListings,
  disconnectBookingChannel,
} from '../../api/channexHubApi';
import { useAllPropertyThreads } from '../../hooks/useChannexThreads';
import PropertyCard from '../shared/PropertyCard';
import PropertyDetail from '../shared/PropertyDetail';
import MessagesInbox from '../shared/MessagesInbox';
import ChannexOAuthIFrame from './ChannexOAuthIFrame';
import NoPropertyGuide from './NoPropertyGuide';
import type { ChannexProperty } from '../../hooks/useChannexProperties';

interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
}

export default function BookingConnectionPanel({ tenantId, onNavigateToProperties }: Props) {
  const { properties: allProperties, loading } = useChannexProperties(tenantId);
  const { properties: bookingProperties } = useChannexProperties(tenantId, { source: 'booking' });
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [iframeReloadToken, setIframeReloadToken] = useState(0);
  const hasAutoCollapsed = useRef(false);

  const baseProperty = allProperties[0] ?? null;
  const isLocked = syncing || disconnecting;
  const bookingPropertyIds = bookingProperties.map((p) => p.channex_property_id);
  const { threads: allThreads, loading: threadsLoading } = useAllPropertyThreads(tenantId, bookingPropertyIds);

  useEffect(() => {
    if (!loading && bookingProperties.length > 0 && !hasAutoCollapsed.current) {
      setIsOpen(false);
      hasAutoCollapsed.current = true;
    }
  }, [loading, bookingProperties.length]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setSynced(false);
    try {
      await syncBookingListings(tenantId);
      setSynced(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [tenantId]);

  const handleDisconnect = useCallback(async () => {
    if (!window.confirm('Disconnect Booking.com? This will remove the channel from Channex.')) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectBookingChannel(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  }, [tenantId]);

  const handleReconnect = useCallback(() => {
    setError(null);
    setSynced(false);
    setIframeReloadToken((t) => t + 1);
  }, []);

  if (selectedProperty) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelectedProperty(null)}
          className="mb-4 text-sm text-content-2 hover:text-content"
        >
          ← Back to Booking.com
        </button>
        <PropertyDetail property={selectedProperty} tenantId={tenantId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-edge bg-surface-raised overflow-hidden">
        {/* Accordion header */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-surface-subtle transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-notice-bg">
              <span className="text-xs font-bold text-notice-text">B</span>
            </div>
            <div>
              <h2 className="text-base font-semibold text-content">Booking.com Connection</h2>
              <p className="text-xs text-content-2">
                {bookingProperties.length > 0
                  ? `${bookingProperties.length} propert${bookingProperties.length === 1 ? 'y' : 'ies'} connected`
                  : 'Connect your Booking.com account and sync rooms via Channex.'}
              </p>
            </div>
          </div>
          <svg
            className={[
              'h-4 w-4 shrink-0 text-content-2 transition-transform duration-200',
              isOpen ? 'rotate-180' : '',
            ].join(' ')}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {/* Collapsible body */}
        {isOpen && (
          <div className="border-t border-edge px-6 pb-6 pt-4">
            {loading && <p className="text-sm text-content-2">Loading properties…</p>}

            {!loading && !baseProperty && (
              <NoPropertyGuide channel="booking" onNavigateToProperties={onNavigateToProperties} />
            )}

            {!loading && baseProperty && (
              <>
                <ChannexOAuthIFrame
                  key={`${baseProperty.channex_property_id}-${iframeReloadToken}`}
                  propertyId={baseProperty.channex_property_id}
                  channel="BDC"
                  getToken={() => getBookingSessionToken(tenantId).then((r) => r.token)}
                />

                {error && (
                  <div className="mt-3 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-3 text-sm text-danger-text">
                    <span className="font-semibold">Error: </span>{error}
                  </div>
                )}

                {synced && (
                  <div className="mt-3 rounded-xl border border-ok-text/20 bg-ok-bg px-4 py-3 text-sm font-medium text-ok-text">
                    Sync complete — rooms and rates imported from Booking.com.
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-edge pt-4">
                  <button
                    type="button"
                    onClick={handleReconnect}
                    className="text-sm text-content-3 underline hover:no-underline"
                  >
                    Reconnect Booking.com
                  </button>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void handleSync()}
                      className={[
                        'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                        isLocked
                          ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                          : 'bg-brand text-white hover:opacity-80',
                      ].join(' ')}
                    >
                      {syncing ? (
                        <>
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                          Syncing…
                        </>
                      ) : (
                        'Sync Rooms & Rates'
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void handleDisconnect()}
                      className={[
                        'inline-flex items-center rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                        isLocked
                          ? 'cursor-not-allowed bg-surface-subtle text-content-3'
                          : 'bg-danger-bg text-danger-text hover:opacity-80',
                      ].join(' ')}
                    >
                      {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {bookingProperties.length > 0 && (
        <>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-content">Messages</h3>
            <MessagesInbox
              tenantId={tenantId}
              threads={allThreads}
              loading={threadsLoading}
            />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-content">
              Connected Booking.com Properties
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bookingProperties.map((property) => (
                <PropertyCard
                  key={property.firestoreDocId}
                  property={property}
                  onClick={setSelectedProperty}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4.2: Verify TypeScript compiles**

```bash
pnpm --filter @migo-uit/frontend exec tsc --noEmit
```
Expected: error on `ChannexHub.tsx` only (it hasn't passed `onNavigateToProperties` yet). Task 5 fixes it.

- [ ] **Step 4.3: Commit**

```bash
git add apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx
git commit -m "feat(channex): refactor BookingConnectionPanel — inline iframe + NoPropertyGuide"
```

---

## Task 5: Update `ChannexHub` — prop drilling

**Files:**
- Modify: `apps/frontend/src/channex/ChannexHub.tsx`

- [ ] **Step 5.1: Pass `onNavigateToProperties` to `AirbnbConnectionPanel`**

Find:
```tsx
{activeSubTab === 'airbnb' && (
  <div className="px-6 py-6">
    <AirbnbConnectionPanel tenantId={businessId} />
  </div>
)}
```
Replace with:
```tsx
{activeSubTab === 'airbnb' && (
  <div className="px-6 py-6">
    <AirbnbConnectionPanel
      tenantId={businessId}
      onNavigateToProperties={() => setActiveSubTab('properties')}
    />
  </div>
)}
```

- [ ] **Step 5.2: Pass `onNavigateToProperties` to `BookingConnectionPanel`**

Find:
```tsx
{activeSubTab === 'booking' && (
  <div className="px-6 py-6">
    <BookingConnectionPanel tenantId={businessId} />
  </div>
)}
```
Replace with:
```tsx
{activeSubTab === 'booking' && (
  <div className="px-6 py-6">
    <BookingConnectionPanel
      tenantId={businessId}
      onNavigateToProperties={() => setActiveSubTab('properties')}
    />
  </div>
)}
```

- [ ] **Step 5.3: Verify TypeScript compiles clean**

```bash
pnpm --filter @migo-uit/frontend exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5.4: Commit**

```bash
git add apps/frontend/src/channex/ChannexHub.tsx
git commit -m "feat(channex): wire onNavigateToProperties from ChannexHub to connection panels"
```

---

## Task 6: Manual verification

- [ ] **Step 6.1: Start dev server**

```bash
pnpm dev
```

Navigate to `https://localhost:5173` (accept the self-signed cert).

- [ ] **Step 6.2: Verify empty state — Airbnb tab**

With a tenant that has no Channex property:
- Open the Channex hub → click the **Airbnb** tab
- Expected: 3 step cards appear inside the accordion body
  - Card 1: "Crea tu primera propiedad" with a "→ Ir a Properties" button
  - Card 2: "Conecta tu cuenta de Airbnb"
  - Card 3: "Sincroniza tus listings" mentioning "Sync Listings"
- Click "→ Ir a Properties" — expected: tab switches to **Properties**

- [ ] **Step 6.3: Verify empty state — Booking.com tab**

- Open the **Booking.com** tab with same tenant
- Expected: identical 3-step layout, but card 2 says "Booking.com" and card 3 mentions "Sync Rooms & Rates"
- Click "→ Ir a Properties" — expected: tab switches to **Properties**

- [ ] **Step 6.4: Verify Booking.com connection flow (with a Channex property)**

With a tenant that has a Channex property:
- Open the **Booking.com** tab
- Expected: iframe loads inline (not a popup window), same loading/error/retry states as Airbnb
- Bottom bar shows: "Reconnect Booking.com" link (left) + "Sync Rooms & Rates" + "Disconnect" buttons (right)

- [ ] **Step 6.5: Verify Airbnb connection flow unchanged**

- Open the **Airbnb** tab with the same tenant
- Expected: iframe still loads, "Reconnect Airbnb" link still visible, "Sync Listings" button still works

- [ ] **Step 6.6: Final commit (if any lint/formatting fixes needed)**

```bash
git add -p  # stage only relevant files
git commit -m "fix(channex): post-verification cleanup"
```

If nothing to fix, skip this step.
