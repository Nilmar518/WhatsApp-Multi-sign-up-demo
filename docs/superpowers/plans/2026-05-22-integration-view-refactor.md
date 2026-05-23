# Integration View Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Airbnb and Booking.com integration views from "channel management first" to four flat tabs — Propiedades | Reservas | Mensajes | Configuración.

**Architecture:** A new `IntegrationView` component replaces both `AirbnbConnectionPanel` and `BookingConnectionPanel` as the top-level orchestrator. It shares data hooks (properties, threads) across its four tabs. The existing panels are kept but gain a `configOnly` prop so their OAuth/channel-management accordion can be reused inside the Configuración tab without re-rendering the property grid or messages.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, existing channex hooks and API helpers.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/frontend/src/i18n/es.ts` | Add 8 new translation keys (source of truth for `TranslationKey` type) |
| Modify | `apps/frontend/src/i18n/en.ts` | Mirror the same 8 keys in English |
| Create | `apps/frontend/src/channex/components/shared/AggregatedReservationsPanel.tsx` | Multi-property reservations list with date-range + property filters |
| Modify | `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx` | Add `configOnly?: boolean` prop; hide property grid + messages when true |
| Modify | `apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx` | Same `configOnly` treatment |
| Create | `apps/frontend/src/channex/components/IntegrationView.tsx` | 4-tab orchestrator |
| Modify | `apps/frontend/src/channex/ChannexHub.tsx` | Swap connection panel imports for `IntegrationView` |

---

## Task 1: Add i18n keys

**Files:**
- Modify: `apps/frontend/src/i18n/es.ts`
- Modify: `apps/frontend/src/i18n/en.ts`

- [ ] **Step 1: Add keys to `es.ts`**

Find the `// Channex` section (around line 257). Add after `'channex.tab.pools'`:

```typescript
  // IntegrationView tabs & filters
  'channex.integration.tab.properties':    'Propiedades',
  'channex.integration.tab.reservations':  'Reservas',
  'channex.integration.tab.messages':      'Mensajes',
  'channex.integration.tab.settings':      'Configuración',
  'channex.integration.filter.property':   'Propiedad',
  'channex.integration.filter.allProps':   'Todas las propiedades',
  'channex.integration.filter.from':       'Desde',
  'channex.integration.filter.to':         'Hasta',
  'channex.integration.filter.clear':      'Limpiar filtros',
```

- [ ] **Step 2: Add keys to `en.ts`**

Find the same `// Channex` section. Add after `'channex.tab.pools'`:

```typescript
  // IntegrationView tabs & filters
  'channex.integration.tab.properties':    'Properties',
  'channex.integration.tab.reservations':  'Reservations',
  'channex.integration.tab.messages':      'Messages',
  'channex.integration.tab.settings':      'Configuration',
  'channex.integration.filter.property':   'Property',
  'channex.integration.filter.allProps':   'All properties',
  'channex.integration.filter.from':       'From',
  'channex.integration.filter.to':         'To',
  'channex.integration.filter.clear':      'Clear filters',
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors related to missing `TranslationKey` entries.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/i18n/en.ts apps/frontend/src/i18n/es.ts
git commit -m "feat(i18n): add integration view tab and filter keys"
```

---

## Task 2: Create `AggregatedReservationsPanel`

**Files:**
- Create: `apps/frontend/src/channex/components/shared/AggregatedReservationsPanel.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState, useEffect } from 'react';
import { getPropertyBookings, type Reservation } from '../../api/channexHubApi';
import type { ChannexProperty } from '../../hooks/useChannexProperties';
import ReservationDetailModal from './ReservationDetailModal';
import { useLanguage } from '../../../context/LanguageContext';

type EnrichedReservation = Reservation & { propertyTitle: string };

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-ok-bg text-ok-text',
  booking_new: 'bg-ok-bg text-ok-text',
  confirmed: 'bg-ok-bg text-ok-text',
  modified: 'bg-caution-bg text-caution-text',
  booking_modification: 'bg-caution-bg text-caution-text',
  cancelled: 'bg-danger-bg text-danger-text',
  booking_cancellation: 'bg-danger-bg text-danger-text',
};

function statusStyle(s: string): string {
  return STATUS_STYLES[s] ?? 'bg-surface-subtle text-content-2';
}

function statusLabel(s: string): string {
  return s.replace(/^booking_/, '').replace(/_/g, ' ');
}

function nights(checkIn: string, checkOut: string): number | null {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

interface Props {
  tenantId: string;
  properties: ChannexProperty[];
}

export default function AggregatedReservationsPanel({ tenantId, properties }: Props) {
  const { t } = useLanguage();
  const [reservations, setReservations] = useState<EnrichedReservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EnrichedReservation | null>(null);
  const [filterPropertyId, setFilterPropertyId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  useEffect(() => {
    if (properties.length === 0) {
      setReservations([]);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all(
      properties.map(async (p) => {
        const { bookings } = await getPropertyBookings(p.channex_property_id, tenantId, 100);
        return bookings.map((r) => ({ ...r, propertyTitle: p.title }));
      }),
    )
      .then((results) => {
        const merged = results
          .flat()
          .sort((a, b) => new Date(b.check_in).getTime() - new Date(a.check_in).getTime());
        setReservations(merged);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Error loading reservations'))
      .finally(() => setLoading(false));
  }, [properties, tenantId]);

  const filtered = reservations.filter((r) => {
    if (filterPropertyId && r.channex_property_id !== filterPropertyId) return false;
    if (filterFrom && r.check_in < filterFrom) return false;
    if (filterTo && r.check_in > filterTo) return false;
    return true;
  });

  const hasFilters = filterPropertyId || filterFrom || filterTo;

  return (
    <div className="flex flex-col">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-6 border-b border-edge">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-content-2 uppercase tracking-wider">
            {t('channex.integration.filter.property')}
          </span>
          <select
            value={filterPropertyId}
            onChange={(e) => setFilterPropertyId(e.target.value)}
            className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
          >
            <option value="">{t('channex.integration.filter.allProps')}</option>
            {properties.map((p) => (
              <option key={p.channex_property_id} value={p.channex_property_id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-content-2 uppercase tracking-wider">
            {t('channex.integration.filter.from')}
          </span>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
          />
          <span className="text-xs text-content-2">→</span>
          <span className="text-xs font-medium text-content-2 uppercase tracking-wider">
            {t('channex.integration.filter.to')}
          </span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
          />
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => { setFilterPropertyId(''); setFilterFrom(''); setFilterTo(''); }}
            className="text-xs text-brand hover:underline"
          >
            {t('channex.integration.filter.clear')}
          </button>
        )}
      </div>

      {/* List */}
      <div className="px-3 py-4 sm:px-6 sm:py-6">
        {loading && <p className="text-sm text-content-2">Loading reservations…</p>}
        {error && <p className="text-sm text-danger-text">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm text-content-2">No reservations found.</p>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-content-2 mb-3">{filtered.length} reservations</p>
            {filtered.map((r, i) => {
              const n = nights(r.check_in, r.check_out);
              const guest =
                [r.guest_first_name, r.guest_last_name].filter(Boolean).join(' ') || 'Guest';
              return (
                <div
                  key={r.channex_booking_id ?? `${r.channex_property_id}-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(r)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(r)}
                  className="flex items-center gap-3 px-3 py-3 bg-surface border border-edge rounded-xl cursor-pointer hover:border-brand transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-content truncate">
                      {guest}
                      <span className="ml-2 text-xs font-normal text-brand bg-brand-subtle/20 px-2 py-0.5 rounded-full">
                        {r.propertyTitle}
                      </span>
                    </p>
                    <p className="text-xs text-content-2 mt-0.5">
                      {r.check_in} – {r.check_out}
                      {n !== null && ` · ${n} night${n !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle(r.booking_status)}`}
                  >
                    {statusLabel(r.booking_status)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <ReservationDetailModal
          reservation={selected}
          tenantId={tenantId}
          propertyTitle={selected.propertyTitle}
          propertyChannelCode={null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/channex/components/shared/AggregatedReservationsPanel.tsx
git commit -m "feat(channex): add AggregatedReservationsPanel with date and property filters"
```

---

## Task 3: Add `configOnly` prop to connection panels

**Files:**
- Modify: `apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx`
- Modify: `apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx`

### BookingConnectionPanel

- [ ] **Step 1: Add `configOnly` to the Props interface**

Find:
```typescript
interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
}
```

Replace with:
```typescript
interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
  configOnly?: boolean;
}
```

- [ ] **Step 2: Receive `configOnly` in the function signature**

Find:
```typescript
export default function BookingConnectionPanel({ tenantId, onNavigateToProperties }: Props) {
```

Replace with:
```typescript
export default function BookingConnectionPanel({ tenantId, onNavigateToProperties, configOnly = false }: Props) {
```

- [ ] **Step 3: Guard the `selectedProperty` drill-in branch**

Find:
```typescript
  if (selectedProperty) {
    return (
```

Replace with:
```typescript
  if (!configOnly && selectedProperty) {
    return (
```

- [ ] **Step 4: Wrap the property-cards and messages section**

After the closing tag of the channel-management accordion `</div>` (the one that ends `className="rounded-2xl border border-edge..."` block), locate the property-cards grid and the messages inbox section. Wrap them both with `{!configOnly && ( ... )}`.

The section to wrap starts immediately after the accordion `</div>` (which ends the `grid grid-cols-1 xl:grid-cols-2` block) and ends at the closing `</div>` of the main `space-y-6` wrapper — but BEFORE the modal renders (`{syncStep === 'channelSelect' && ...}`).

Concretely, find the line:
```tsx
      </div>

      {syncStep === 'channelSelect' && (
```

Everything between the accordion `</div>` and that `{syncStep` line is the property-cards + messages. Wrap it:

```tsx
      {!configOnly && (
        <>
          {/* existing property cards + messages JSX */}
        </>
      )}

      {syncStep === 'channelSelect' && (
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/frontend && pnpm tsc --noEmit
```

### AirbnbConnectionPanel

- [ ] **Step 6: Add `configOnly` to the Props interface**

Find:
```typescript
interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
}
```

Replace with:
```typescript
interface Props {
  tenantId: string;
  onNavigateToProperties: () => void;
  configOnly?: boolean;
}
```

- [ ] **Step 7: Receive `configOnly` in the function signature**

Find:
```typescript
export default function AirbnbConnectionPanel({ tenantId, onNavigateToProperties }: Props) {
```

Replace with:
```typescript
export default function AirbnbConnectionPanel({ tenantId, onNavigateToProperties, configOnly = false }: Props) {
```

- [ ] **Step 8: Guard the `selectedProperty` drill-in branch**

Find:
```typescript
  if (selectedProperty) {
    return (
```

Replace with:
```typescript
  if (!configOnly && selectedProperty) {
    return (
```

- [ ] **Step 9: Wrap property-cards and messages**

Same pattern as Step 4 above. After the accordion closing `</div>`, wrap everything up to (but not including) the sync-step modals in `{!configOnly && ( <> ... </> )}`.

- [ ] **Step 10: Verify TypeScript and commit**

```bash
cd apps/frontend && pnpm tsc --noEmit
git add apps/frontend/src/channex/components/connection/BookingConnectionPanel.tsx \
        apps/frontend/src/channex/components/connection/AirbnbConnectionPanel.tsx
git commit -m "feat(channex): add configOnly prop to connection panels"
```

---

## Task 4: Create `IntegrationView`

**Files:**
- Create: `apps/frontend/src/channex/components/IntegrationView.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from 'react';
import { useChannexProperties } from '../hooks/useChannexProperties';
import { useAllPropertyThreads } from '../hooks/useChannexThreads';
import PropertiesList from './PropertiesList';
import PropertyDetail from './shared/PropertyDetail';
import AggregatedReservationsPanel from './shared/AggregatedReservationsPanel';
import MessagesInbox from './shared/MessagesInbox';
import BookingConnectionPanel from './connection/BookingConnectionPanel';
import AirbnbConnectionPanel from './connection/AirbnbConnectionPanel';
import type { ChannexProperty } from '../hooks/useChannexProperties';
import { useLanguage } from '../../context/LanguageContext';
import Button from '../../components/ui/Button';

type IntegrationTab = 'properties' | 'reservations' | 'messages' | 'settings';

interface Props {
  tenantId: string;
  source: 'airbnb' | 'booking';
  onNavigateToProperties: () => void;
}

export default function IntegrationView({ tenantId, source, onNavigateToProperties }: Props) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<IntegrationTab>('properties');
  const [selectedProperty, setSelectedProperty] = useState<ChannexProperty | null>(null);
  const [threadPropertyFilter, setThreadPropertyFilter] = useState('');

  const { properties, loading: propsLoading, error: propsError } =
    useChannexProperties(tenantId, { source });
  const propertyIds = properties.map((p) => p.channex_property_id);
  const { threads, loading: threadsLoading } = useAllPropertyThreads(tenantId, propertyIds);

  const TABS: { id: IntegrationTab; label: string }[] = [
    { id: 'properties',   label: t('channex.integration.tab.properties') },
    { id: 'reservations', label: t('channex.integration.tab.reservations') },
    { id: 'messages',     label: t('channex.integration.tab.messages') },
    { id: 'settings',     label: t('channex.integration.tab.settings') },
  ];

  const filteredThreads = threadPropertyFilter
    ? threads.filter((th) => th.propertyId === threadPropertyFilter)
    : threads;

  function handleTabChange(tab: IntegrationTab) {
    setActiveTab(tab);
    setSelectedProperty(null);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-sm">
      {/* Tab bar */}
      <div className="flex items-end gap-0 border-b border-edge px-3 sm:px-6 overflow-x-auto whitespace-nowrap">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-brand-light text-brand bg-surface-raised'
                : 'border-transparent text-content-2 hover:text-content hover:border-edge',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* Tab 1 — Propiedades */}
        {activeTab === 'properties' && (
          <div className="px-3 py-4 sm:px-6 sm:py-6">
            {selectedProperty ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setSelectedProperty(null)}
                  className="mb-4"
                >
                  {t('channex.hub.backToProps')}
                </Button>
                <PropertyDetail property={selectedProperty} tenantId={tenantId} />
              </>
            ) : (
              <>
                {propsLoading && (
                  <p className="text-sm text-content-2">{t('channex.hub.loadingProps')}</p>
                )}
                {propsError && <p className="text-sm text-danger-text">{propsError}</p>}
                {!propsLoading && !propsError && (
                  <PropertiesList
                    properties={properties}
                    onSelect={setSelectedProperty}
                    onNew={() => {}}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 2 — Reservas */}
        {activeTab === 'reservations' && (
          <AggregatedReservationsPanel tenantId={tenantId} properties={properties} />
        )}

        {/* Tab 3 — Mensajes */}
        {activeTab === 'messages' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-3 py-3 sm:px-6 border-b border-edge">
              <span className="text-xs font-medium text-content-2 uppercase tracking-wider">
                {t('channex.integration.filter.property')}
              </span>
              <select
                value={threadPropertyFilter}
                onChange={(e) => setThreadPropertyFilter(e.target.value)}
                className="bg-surface border border-edge rounded-md text-sm text-content px-2 py-1 outline-none focus:border-brand"
              >
                <option value="">{t('channex.integration.filter.allProps')}</option>
                {properties.map((p) => (
                  <option key={p.channex_property_id} value={p.channex_property_id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-3 py-4 sm:px-6">
              <MessagesInbox
                tenantId={tenantId}
                threads={filteredThreads}
                loading={threadsLoading}
              />
            </div>
          </div>
        )}

        {/* Tab 4 — Configuración */}
        {activeTab === 'settings' && (
          <div className="px-3 py-4 sm:px-6 sm:py-6">
            {source === 'booking' ? (
              <BookingConnectionPanel
                tenantId={tenantId}
                onNavigateToProperties={onNavigateToProperties}
                configOnly
              />
            ) : (
              <AirbnbConnectionPanel
                tenantId={tenantId}
                onNavigateToProperties={onNavigateToProperties}
                configOnly
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/channex/components/IntegrationView.tsx
git commit -m "feat(channex): add IntegrationView with 4-tab structure"
```

---

## Task 5: Wire `IntegrationView` into `ChannexHub`

**Files:**
- Modify: `apps/frontend/src/channex/ChannexHub.tsx`

- [ ] **Step 1: Replace imports**

Find:
```typescript
import AirbnbConnectionPanel from './components/connection/AirbnbConnectionPanel';
import BookingConnectionPanel from './components/connection/BookingConnectionPanel';
```

Replace with:
```typescript
import IntegrationView from './components/IntegrationView';
```

- [ ] **Step 2: Replace `airbnb` tab content**

Find:
```tsx
        {activeSubTab === 'airbnb' && (
          <div className="px-3 py-4 sm:px-6 sm:py-6">
            <AirbnbConnectionPanel
              tenantId={businessId}
              onNavigateToProperties={() => setActiveSubTab('properties')}
            />
          </div>
        )}
```

Replace with:
```tsx
        {activeSubTab === 'airbnb' && (
          <IntegrationView
            tenantId={businessId}
            source="airbnb"
            onNavigateToProperties={() => setActiveSubTab('properties')}
          />
        )}
```

- [ ] **Step 3: Replace `booking` tab content**

Find:
```tsx
        {activeSubTab === 'booking' && (
          <div className="px-3 py-4 sm:px-6 sm:py-6">
            <BookingConnectionPanel
              tenantId={businessId}
              onNavigateToProperties={() => setActiveSubTab('properties')}
            />
          </div>
        )}
```

Replace with:
```tsx
        {activeSubTab === 'booking' && (
          <IntegrationView
            tenantId={businessId}
            source="booking"
            onNavigateToProperties={() => setActiveSubTab('properties')}
          />
        )}
```

- [ ] **Step 4: Verify TypeScript and build**

```bash
cd apps/frontend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Start the dev server:
```bash
pnpm dev
```

Open `https://localhost:5173/channex/booking` and verify:
1. Tab bar shows: Propiedades | Reservas | Mensajes | Configuración
2. Default tab is Propiedades — property list appears
3. Clicking a property drills into PropertyDetail; back button returns to list
4. Reservas tab shows all booking properties' reservations with filter bar
5. Filtering by property shows only that property's reservations
6. Filtering by date range narrows the list; "Limpiar filtros" resets
7. Mensajes tab shows thread list; property dropdown filters threads
8. Configuración tab shows the channel management accordion + OAuth section (no property cards or message threads)

Repeat for `https://localhost:5173/channex/airbnb`.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/channex/ChannexHub.tsx
git commit -m "feat(channex): wire IntegrationView into ChannexHub for airbnb and booking tabs"
```
