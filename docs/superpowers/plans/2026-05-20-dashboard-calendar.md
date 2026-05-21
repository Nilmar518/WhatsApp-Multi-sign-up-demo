# Dashboard Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el dashboard actual (`/`) con un calendario de reservas general + cards de detalle para la fecha seleccionada, con filtro por propiedad.

**Architecture:** `NewDashboardView` orquestra tres suscripciones Firestore (propiedades, bookings, threads) y deriva los datos filtrados/ordenados en `useMemo`. El calendario recibe `bookings` pre-filtradas como prop. Las cards se renderizan en columna única, ordenadas por status (check-in → en curso → check-out → cancelado).

**Tech Stack:** React + TypeScript, Firebase Firestore (`onSnapshot`), Tailwind CSS, Lucide React, hooks existentes (`useChannexProperties`, `useAllPropertyThreads`).

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| CREAR | `src/components/dashboard/NoConversationModal.tsx` | Modal "sin hilo de mensajes" |
| CREAR | `src/components/dashboard/DashboardCalendar.tsx` | Grid mensual con dot markers |
| CREAR | `src/components/dashboard/ReservationCard.tsx` | Card de reserva individual (reutilizable) |
| CREAR | `src/components/dashboard/NewDashboardView.tsx` | Orquestador: Firestore + filtros + layout |
| MODIFICAR | `src/App.tsx` líneas ~265–295 | Swap `<DashboardView>` → `<NewDashboardView>` |
| NO TOCAR | `src/components/dashboard/DashboardView.tsx` | Conservar intacto (documentado en plan) |

---

## Types y helpers compartidos (referencia rápida)

```typescript
// src/channex/api/channexHubApi.ts
interface Reservation {
  id?: string;
  channex_booking_id: string | null;
  booking_status: string;          // 'booking_new' | 'modified' | 'cancelled' | ...
  channel: string;                 // 'Airbnb' | 'BookingCom' | 'booking_com' | ...
  channex_property_id: string;     // ID de la propiedad en Channex
  check_in: string;                // "YYYY-MM-DD"
  check_out: string;               // "YYYY-MM-DD"
  occ_adults: number;
  occ_children: number;
  occ_infants: number;
  guest_first_name: string | null;
  guest_last_name: string | null;
  customer_name?: string | null;
  // ... resto de campos
}

// src/channex/hooks/useChannexThreads.ts
interface ChannexThread {
  id: string;
  propertyId: string;
  bookingId: string | null;   // === reservation.channex_booking_id
  guestName: string;
  // ...
}

// src/channex/hooks/useChannexProperties.ts
interface ChannexProperty {
  channex_property_id: string;
  title: string;
  // ...
}
```

**Nota sobre Firestore bookings:** Los documentos en `channex_integrations/{tenantId}/bookings` tienen un campo `propertyId` (Firestore) que corresponde a `channex_property_id` en la interfaz TypeScript. Al mapear con `onSnapshot`, normalizar ambos:
```typescript
const raw = d.data() as Record<string, unknown>;
const channex_property_id =
  (raw.channex_property_id ?? raw.propertyId ?? '') as string;
```

---

## Task 1: `NoConversationModal`

**Archivos:**
- Crear: `src/components/dashboard/NoConversationModal.tsx`

- [ ] **Crear el componente modal**

```tsx
// src/components/dashboard/NoConversationModal.tsx
import { MessageSquare, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface NoConversationModalProps {
  guestName: string;
  onClose: () => void;
}

export default function NoConversationModal({ guestName, onClose }: NoConversationModalProps) {
  const { t } = useLanguage();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-edge rounded-xl shadow-lg w-full max-w-sm p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-notice-bg flex items-center justify-center flex-shrink-0">
              <MessageSquare size={18} className="text-notice" />
            </div>
            <p className="text-[15px] font-bold text-content leading-tight">
              Sin conversación directa
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-content-3 hover:text-content hover:bg-surface-subtle transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <p className="text-[13px] text-content-2 leading-relaxed">
          No se encontró un intercambio de mensajes con{' '}
          <span className="font-semibold text-content">{guestName}</span>.
        </p>
        <p className="text-[13px] text-content-2 leading-relaxed">
          Espera a que el huésped inicie o responda un mensaje para poder acceder
          al hilo de conversación.
        </p>

        {/* CTA */}
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg bg-brand text-white text-[13px] font-semibold
                     hover:bg-brand-hover transition-colors"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Verificar que compila sin errores**

```bash
# En apps/frontend:
npx tsc --noEmit
```

---

## Task 2: `DashboardCalendar`

**Archivos:**
- Crear: `src/components/dashboard/DashboardCalendar.tsx`

- [ ] **Crear el componente de calendario**

```tsx
// src/components/dashboard/DashboardCalendar.tsx
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Reservation } from '../../channex/api/channexHubApi';

interface DashboardCalendarProps {
  bookings: Reservation[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
}

type DotType = 'checkin' | 'inprogress' | 'checkout' | 'cancelled';

const DOT_COLORS: Record<DotType, string> = {
  checkin:    'bg-ok',
  inprogress: 'bg-notice',
  checkout:   'bg-caution',
  cancelled:  'bg-danger',
};

const DOT_ORDER: DotType[] = ['checkin', 'inprogress', 'checkout', 'cancelled'];

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Week starts on Monday (ES locale)
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDotsForDay(dateStr: string, bookings: Reservation[]): DotType[] {
  const types = new Set<DotType>();
  for (const b of bookings) {
    if (b.booking_status === 'cancelled') {
      types.add('cancelled');
    } else if (b.check_in === dateStr) {
      types.add('checkin');
    } else if (b.check_out === dateStr) {
      types.add('checkout');
    } else if (dateStr > b.check_in && dateStr < b.check_out) {
      types.add('inprogress');
    }
  }
  return DOT_ORDER.filter((t) => types.has(t));
}

export default function DashboardCalendar({
  bookings,
  selectedDate,
  onDateSelect,
}: DashboardCalendarProps) {
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [viewDate, setViewDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  });

  const year = viewDate.getUTCFullYear();
  const month = viewDate.getUTCMonth(); // 0-indexed

  const prevMonth = () =>
    setViewDate(new Date(Date.UTC(year, month - 1, 1)));
  const nextMonth = () =>
    setViewDate(new Date(Date.UTC(year, month + 1, 1)));

  // Build calendar cells (null = empty padding cell)
  const cells = useMemo<(string | null)[]>(() => {
    const firstDayOfMonth = new Date(Date.UTC(year, month, 1));
    // getUTCDay: 0=Sun…6=Sat → convert to Monday-first: (day+6)%7
    const startOffset = (firstDayOfMonth.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const result: (string | null)[] = [];
    for (let i = 0; i < startOffset; i++) result.push(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(isoDate(year, month, d));
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [year, month]);

  // Pre-compute dots for each date in this month to avoid re-computing in render
  const dotsMap = useMemo<Map<string, DotType[]>>(() => {
    const map = new Map<string, DotType[]>();
    for (const cell of cells) {
      if (cell) map.set(cell, getDotsForDay(cell, bookings));
    }
    return map;
  }, [cells, bookings]);

  return (
    <div className="bg-surface-raised border border-edge rounded-xl shadow-sm overflow-hidden min-h-[55vh] md:min-h-[60vh] flex flex-col">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge/60">
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg text-content-2 hover:text-content hover:bg-surface-subtle transition-colors"
          aria-label="Mes anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-[15px] font-bold text-content tracking-tight">
          {MONTH_NAMES[month]} {year}
        </h2>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg text-content-2 hover:text-content hover:bg-surface-subtle transition-colors"
          aria-label="Mes siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 px-2 pt-2">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-bold text-content-3 uppercase tracking-wider py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 flex-1 px-2 pb-2 gap-y-0.5">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`empty-${idx}`} />;

          const dots = dotsMap.get(cell) ?? [];
          const isToday = cell === today;
          const isSelected = cell === selectedDate;

          return (
            <button
              key={cell}
              onClick={() => onDateSelect(cell)}
              className={[
                'relative flex flex-col items-center justify-start pt-1.5 pb-1 rounded-lg',
                'transition-colors duration-100 min-h-[44px] cursor-pointer',
                isSelected
                  ? 'bg-brand text-white'
                  : isToday
                  ? 'bg-brand/10 text-brand border border-brand/30'
                  : 'hover:bg-surface-subtle text-content',
              ].join(' ')}
            >
              <span className={`text-[13px] font-semibold leading-none ${isSelected ? 'text-white' : ''}`}>
                {parseInt(cell.split('-')[2], 10)}
              </span>
              {dots.length > 0 && (
                <div className="flex items-center gap-0.5 mt-1">
                  {dots.slice(0, 3).map((dot) => (
                    <span
                      key={dot}
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-white/80' : DOT_COLORS[dot]
                      }`}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Dot legend */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 border-t border-edge/40">
        {([
          ['checkin',    'Check-in'],
          ['inprogress', 'En curso'],
          ['checkout',   'Check-out'],
          ['cancelled',  'Cancelado'],
        ] as [DotType, string][]).map(([type, label]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT_COLORS[type]}`} />
            <span className="text-[10px] font-medium text-content-3">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Verificar que compila sin errores**

```bash
npx tsc --noEmit
```

---

## Task 3: `ReservationCard`

**Archivos:**
- Crear: `src/components/dashboard/ReservationCard.tsx`

- [ ] **Crear el componente de card**

```tsx
// src/components/dashboard/ReservationCard.tsx
import { MessageSquare, Search, User, Calendar, Users } from 'lucide-react';
import type { Reservation } from '../../channex/api/channexHubApi';
import type { ChannexThread } from '../../channex/hooks/useChannexThreads';
import { navigate } from '../../lib/navigate';

interface ReservationCardProps {
  reservation: Reservation;
  selectedDate: string;
  threads: ChannexThread[];
  onViewDetail: (r: Reservation) => void;
  onNoThread: (r: Reservation) => void;
}

type CardStatus = 'checkin' | 'inprogress' | 'checkout' | 'cancelled';

const STATUS_CONFIG: Record<CardStatus, { label: string; dot: string; badge: string }> = {
  checkin:    { label: 'Check-in',  dot: 'bg-ok',      badge: 'bg-ok/10 text-ok-text border-ok/20' },
  inprogress: { label: 'En curso',  dot: 'bg-notice',  badge: 'bg-notice/10 text-notice-text border-notice/20' },
  checkout:   { label: 'Check-out', dot: 'bg-caution', badge: 'bg-caution/10 text-caution-text border-caution/20' },
  cancelled:  { label: 'Cancelado', dot: 'bg-danger',  badge: 'bg-danger/10 text-danger-text border-danger/20' },
};

function getCardStatus(reservation: Reservation, selectedDate: string): CardStatus {
  if (reservation.booking_status === 'cancelled') return 'cancelled';
  if (reservation.check_in === selectedDate) return 'checkin';
  if (reservation.check_out === selectedDate) return 'checkout';
  return 'inprogress';
}

function guestDisplayName(r: Reservation): string {
  if (r.customer_name?.trim()) return r.customer_name.trim();
  const parts = [r.guest_first_name, r.guest_last_name].filter(Boolean);
  return parts.join(' ') || 'Huésped desconocido';
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
  });
}

function countNights(checkIn: string, checkOut: string): number {
  if (typeof checkIn !== 'string' || typeof checkOut !== 'string') return 0;
  const a = new Date(checkIn + 'T00:00:00');
  const b = new Date(checkOut + 'T00:00:00');
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function isAirbnbChannel(channel: string): boolean {
  return /airbnb/i.test(channel);
}

export default function ReservationCard({
  reservation: r,
  selectedDate,
  threads,
  onViewDetail,
  onNoThread,
}: ReservationCardProps) {
  const status = getCardStatus(r, selectedDate);
  const cfg = STATUS_CONFIG[status];
  const guestName = guestDisplayName(r);
  const guests =
    (r.occ_adults ?? 0) + (r.occ_children ?? 0) + (r.occ_infants ?? 0) || 1;
  const nights = r.count_of_nights ?? countNights(r.check_in, r.check_out);
  const channelLabel = isAirbnbChannel(r.channel) ? 'Airbnb' : 'Booking.com';
  const channelRoute = isAirbnbChannel(r.channel) ? '/channex/airbnb' : '/channex/booking';

  const handleMessages = (e: React.MouseEvent) => {
    e.stopPropagation();
    const thread = threads.find((t) => t.bookingId === r.channex_booking_id);
    if (thread) {
      navigate(channelRoute);
    } else {
      onNoThread(r);
    }
  };

  const handleDetail = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewDetail(r);
  };

  return (
    <div
      className="bg-surface-raised border border-edge rounded-xl shadow-sm p-4 flex flex-col gap-3 cursor-pointer hover:border-brand/30 transition-colors"
      onClick={() => onViewDetail(r)}
    >
      {/* Top row: status badge + channel */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cfg.badge}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
          {cfg.label}
        </span>
        <span className="text-[11px] font-medium text-content-3 bg-surface-subtle px-2 py-0.5 rounded-full">
          {channelLabel}
        </span>
      </div>

      {/* Guest info */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <User size={13} className="text-content-3 flex-shrink-0" />
          <span className="text-[14px] font-semibold text-content truncate">{guestName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={13} className="text-content-3 flex-shrink-0" />
          <span className="text-[12px] text-content-2">
            {fmtDate(r.check_in)} → {fmtDate(r.check_out)}
            <span className="text-content-3 ml-1.5">· {nights} {nights === 1 ? 'noche' : 'noches'}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Users size={13} className="text-content-3 flex-shrink-0" />
          <span className="text-[12px] text-content-2">
            {guests} {guests === 1 ? 'persona' : 'personas'}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1 border-t border-edge/50">
        <button
          onClick={handleMessages}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                     text-[12px] font-semibold text-content-2 bg-surface-subtle
                     hover:bg-notice/10 hover:text-notice transition-colors"
        >
          <MessageSquare size={13} />
          Ver mensajes
        </button>
        <button
          onClick={handleDetail}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                     text-[12px] font-semibold text-content-2 bg-surface-subtle
                     hover:bg-brand/10 hover:text-brand transition-colors"
        >
          <Search size={13} />
          Ver reserva
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Verificar que compila sin errores**

```bash
npx tsc --noEmit
```

---

## Task 4: `NewDashboardView`

**Archivos:**
- Crear: `src/components/dashboard/NewDashboardView.tsx`

**Dependencias de datos:**
- `useChannexProperties(businessId)` → lista de propiedades para el dropdown
- `useAllPropertyThreads(businessId, propertyIds)` → threads para el lookup de mensajes
- `onSnapshot(collection(db, 'channex_integrations', businessId, 'bookings'))` → todas las reservas

- [ ] **Crear el orquestador `NewDashboardView`**

```tsx
// src/components/dashboard/NewDashboardView.tsx
import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Hotel } from 'lucide-react';
import { db } from '../../firebase/firebase';
import type { Reservation } from '../../channex/api/channexHubApi';
import { useChannexProperties } from '../../channex/hooks/useChannexProperties';
import { useAllPropertyThreads } from '../../channex/hooks/useChannexThreads';
import DashboardCalendar from './DashboardCalendar';
import ReservationCard from './ReservationCard';
import NoConversationModal from './NoConversationModal';
import ReservationDetailModal from '../../channex/components/shared/ReservationDetailModal';

interface NewDashboardViewProps {
  businessId: string;
}

type CardStatus = 'checkin' | 'inprogress' | 'checkout' | 'cancelled';
const STATUS_ORDER: Record<CardStatus, number> = { checkin: 0, inprogress: 1, checkout: 2, cancelled: 3 };

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getCardStatus(reservation: Reservation, selectedDate: string): CardStatus {
  if (reservation.booking_status === 'cancelled') return 'cancelled';
  if (reservation.check_in === selectedDate) return 'checkin';
  if (reservation.check_out === selectedDate) return 'checkout';
  return 'inprogress';
}

function mapFirestoreBooking(docId: string, data: Record<string, unknown>): Reservation {
  return {
    ...(data as Reservation),
    id: docId,
    // Normalise property ID: Firestore may store it as 'propertyId' OR 'channex_property_id'
    channex_property_id:
      ((data.channex_property_id ?? data.propertyId ?? '') as string),
  };
}

export default function NewDashboardView({ businessId }: NewDashboardViewProps) {
  const [selectedDate, setSelectedDate] = useState<string>(isoToday);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [allBookings, setAllBookings] = useState<Reservation[]>([]);
  const [detailReservation, setDetailReservation] = useState<Reservation | null>(null);
  const [noConvReservation, setNoConvReservation] = useState<Reservation | null>(null);

  // Properties for the dropdown filter
  const { properties } = useChannexProperties(businessId);

  // Thread lookup for message button
  const propertyIds = useMemo(
    () => properties.map((p) => p.channex_property_id),
    [properties],
  );
  const { threads } = useAllPropertyThreads(businessId, propertyIds);

  // Real-time bookings subscription (all properties)
  useEffect(() => {
    if (!businessId) return;
    const unsub = onSnapshot(
      collection(db, 'channex_integrations', businessId, 'bookings'),
      (snap) => {
        setAllBookings(
          snap.docs.map((d) =>
            mapFirestoreBooking(d.id, d.data() as Record<string, unknown>),
          ),
        );
      },
    );
    return () => unsub();
  }, [businessId]);

  // 1. Filter by property
  const filteredBookings = useMemo(
    () =>
      selectedPropertyId
        ? allBookings.filter((b) => b.channex_property_id === selectedPropertyId)
        : allBookings,
    [allBookings, selectedPropertyId],
  );

  // 2. Filter by selected date
  const selectedDateBookings = useMemo(
    () =>
      filteredBookings.filter(
        (r) => r.check_in <= selectedDate && r.check_out >= selectedDate,
      ),
    [filteredBookings, selectedDate],
  );

  // 3. Sort by status order
  const sortedBookings = useMemo(
    () =>
      [...selectedDateBookings].sort(
        (a, b) =>
          STATUS_ORDER[getCardStatus(a, selectedDate)] -
          STATUS_ORDER[getCardStatus(b, selectedDate)],
      ),
    [selectedDateBookings, selectedDate],
  );

  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }, [selectedDate]);

  return (
    <div className="flex flex-col gap-4 p-4 pb-6 max-w-4xl mx-auto w-full">
      {/* Calendar */}
      <DashboardCalendar
        bookings={filteredBookings}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
      />

      {/* Property filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-content-3 pointer-events-none">
            <Hotel size={14} />
          </div>
          <select
            value={selectedPropertyId}
            onChange={(e) => setSelectedPropertyId(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-edge bg-surface-raised
                       text-[13px] font-medium text-content appearance-none cursor-pointer
                       focus:outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20
                       transition-colors"
          >
            <option value="">Todas las propiedades</option>
            {properties.map((p) => (
              <option key={p.channex_property_id} value={p.channex_property_id}>
                {p.title}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-content-3 pointer-events-none">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Reservations section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold text-content capitalize">{selectedDateLabel}</h3>
          {sortedBookings.length > 0 && (
            <span className="text-[11px] text-content-3 font-medium">
              {sortedBookings.length} {sortedBookings.length === 1 ? 'reserva' : 'reservas'}
            </span>
          )}
        </div>

        {sortedBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-surface-subtle flex items-center justify-center mb-3">
              <Hotel size={20} className="text-content-3" />
            </div>
            <p className="text-[13px] font-semibold text-content-2">Sin reservas este día</p>
            <p className="text-[12px] text-content-3 mt-1">
              Selecciona otra fecha en el calendario
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sortedBookings.map((r) => (
              <ReservationCard
                key={r.id ?? r.channex_booking_id ?? r.reservation_id}
                reservation={r}
                selectedDate={selectedDate}
                threads={threads}
                onViewDetail={setDetailReservation}
                onNoThread={setNoConvReservation}
              />
            ))}
          </div>
        )}
      </div>

      {/* Reservation detail modal */}
      {detailReservation && (
        <ReservationDetailModal
          reservation={detailReservation}
          tenantId={businessId}
          propertyChannelCode={null}
          onClose={() => setDetailReservation(null)}
        />
      )}

      {/* No conversation modal */}
      {noConvReservation && (
        <NoConversationModal
          guestName={
            noConvReservation.customer_name?.trim() ||
            [noConvReservation.guest_first_name, noConvReservation.guest_last_name]
              .filter(Boolean)
              .join(' ') ||
            'Huésped desconocido'
          }
          onClose={() => setNoConvReservation(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Verificar que compila sin errores**

```bash
npx tsc --noEmit
```

---

## Task 5: Wiring en `App.tsx`

**Archivos:**
- Modificar: `src/App.tsx` — importar `NewDashboardView`, reemplazar el bloque DASHBOARD VIEW

- [ ] **Añadir el import de `NewDashboardView`** (cerca de línea 19 donde está el import de `DashboardView`)

```typescript
// Añadir esta línea junto a los otros imports de components/dashboard
import NewDashboardView from './components/dashboard/NewDashboardView';
```

- [ ] **Reemplazar el bloque DASHBOARD VIEW** (cerca de líneas 265–295)

Buscar este bloque:
```tsx
  /* ── DASHBOARD VIEW ───────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col min-h-screen bg-surface">
      {header}
      <DashboardView
        businessId={businessId}
        isWaActive={isWaActive}
        waMessages={waMessages}
        waConversations={waConversations}
        isMsgrConnected={isMsgrConnected}
        msgrMessages={msgrMessages}
        msgrConversations={msgrConversations}
        isIgConnected={isIgConnected}
        igMessages={igMessages}
        igConversations={igConversations}
        catalog={waCatalog}
        activeCatalogId={activeCatalogId}
        catalogIntegrationId={waIntegrationId ?? msgrIntegrationId}
        catalogStatus={waStatus ?? msgrStatus ?? 'IDLE'}
        onCatalogLinked={() => setIntegrationsRefreshNonce((prev) => prev + 1)}
      />
    </div>
  );
```

Reemplazar por:
```tsx
  /* ── DASHBOARD VIEW ───────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col min-h-screen bg-surface">
      {header}
      <NewDashboardView businessId={businessId} />
    </div>
  );
```

- [ ] **Verificar que compila sin errores**

```bash
npx tsc --noEmit
```

- [ ] **Verificar en navegador (dev server)**

```bash
pnpm dev
```

Checklist manual:
1. Ruta `/` muestra el calendario centrado, ocupa >50% de la pantalla
2. El mes actual aparece al cargar
3. Botones `◀` / `▶` navegan entre meses sin error de consola
4. El día de hoy tiene borde violeta sutil
5. Clicar un día lo selecciona (fondo violeta sólido)
6. Si existen reservas en Firestore: aparecen dots en los días correspondientes
7. Los dots de la leyenda muestran los 4 tipos
8. El dropdown "Todas las propiedades" lista las propiedades del tenant
9. Seleccionar una propiedad filtra calendario + cards simultáneamente
10. Cards apiladas verticalmente, ancho completo
11. Orden: check-in → en curso → check-out → cancelado
12. Botón "Ver mensajes": si no hay thread → modal `NoConversationModal`
13. Botón "Ver reserva" → `ReservationDetailModal` se abre
14. Click fuera de `NoConversationModal` la cierra
15. En mobile (<768px): bottom nav visible, sin superposición con las cards

---

## Self-Review

**Spec coverage:**

| Req | Task que lo implementa |
|-----|------------------------|
| Calendario un mes a la vez + flechas | Task 2 `DashboardCalendar` |
| Dots: check-in verde, en-curso azul, check-out naranja, cancelado rojo | Task 2 `DOT_COLORS` |
| Hasta 3 dots por día, sin repetir | Task 2 `getDotsForDay` + `slice(0,3)` |
| Dots blancos cuando día seleccionado | Task 2 `isSelected ? 'bg-white/80' : DOT_COLORS[dot]` |
| Leyenda de dots | Task 2 sección legend |
| Filtro propiedad filtra ambos (calendario + cards) | Task 4: `filteredBookings` pasa a ambos |
| Filtro entre calendario y cards | Task 4 layout: `<DashboardCalendar>` → `<select>` → cards |
| Cards ancho completo, columna única | Task 3 `flex flex-col gap-3`, sin grid |
| Orden: check-in → en-curso → check-out → cancelado | Task 4 `sortedBookings` + `STATUS_ORDER` |
| Status badge basado en `selectedDate` | Task 3/4 `getCardStatus(r, selectedDate)` |
| Guest name: `customer_name` o first+last | Task 3 `guestDisplayName` |
| Noches calculadas | Task 3 `countNights` o `count_of_nights` |
| Personas: sum adults+children+infants, min 1 | Task 3 `(occ_adults ?? 0) + ... || 1` |
| Botón mensajes: lookup por `channex_booking_id` | Task 3 `threads.find(t => t.bookingId === r.channex_booking_id)` |
| Sin thread → `NoConversationModal` | Task 3 `onNoThread(r)` → Task 4 `setNoConvReservation` |
| Con thread → navega a `/channex/airbnb` o `/channex/booking` | Task 3 `navigate(channelRoute)` |
| Click card → `ReservationDetailModal` | Task 3 `onClick={() => onViewDetail(r)}` → Task 4 modal |
| `NoConversationModal` con nombre huésped | Task 1 prop `guestName` |
| Empty state si no hay reservas | Task 4 empty state con ícono Hotel |
| `DashboardView` original intacto | No se modifica el archivo |
| Suscripción Firestore tiempo real todas las propiedades | Task 4 `onSnapshot(collection(..., 'bookings'))` |
| Normalización `channex_property_id` / `propertyId` | Task 4 `mapFirestoreBooking` |

**Placeholders:** ninguno encontrado.

**Type consistency:** `getCardStatus` definida en Task 3 y re-definida (idéntica) en Task 4 como función local — ambas usan `Reservation` y `string`, retornan el mismo `CardStatus`. Las keys de `STATUS_ORDER` en Task 4 coinciden con los valores de `CardStatus`.

**Nota:** `ReservationDetailModal` acepta `propertyChannelCode: string | null` — se pasa `null` desde el dashboard ya que no tenemos ese dato sin una llamada adicional a la API. El modal lo usa solo para mostrar el botón "No Show" de Booking.com, que seguirá visible/invisible según la lógica interna del modal.
