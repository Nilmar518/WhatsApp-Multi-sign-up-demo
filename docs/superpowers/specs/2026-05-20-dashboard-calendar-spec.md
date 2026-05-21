# Spec: Nuevo Dashboard — Calendario de Reservas

> Fecha: 2026-05-20  
> Estado: Aprobado — Listo para implementar

---

## Resumen

El dashboard (`/`) reemplaza las estadísticas actuales con un calendario de reservas general + cards de detalle para la fecha seleccionada. Las stats antiguas quedan documentadas en `docs/superpowers/plans/2026-05-20-bottom-nav-hidden-tabs.md`.

---

## Layout General

```
┌─────────────────────────────────────────────────────────┐
│  Header: "Dashboard"  +  BusinessToggle                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  DashboardCalendar                               │   │
│  │  ≥ 50% viewport height (60–65% en mobile)        │   │
│  │                                                   │   │
│  │  ◀  Mayo 2026  ▶                                 │   │
│  │  L   M   X   J   V   S   D                       │   │
│  │  ...  grid de días con dot markers  ...           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ─── Filtro por propiedad ───────────────────────────   │
│  [ Dropdown: Todas las propiedades ▼ ]                  │
│                                                         │
│  ─── Reservas para [fecha seleccionada] ─────────────   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ReservationCard (check-in)   — ancho completo  │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ReservationCard (en curso)   — ancho completo  │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ReservationCard (check-out)  — ancho completo  │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ReservationCard (cancelado)  — ancho completo  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Cards siempre en **una columna** (ancho completo), apiladas verticalmente tanto en mobile como en desktop.

---

## Componente 1: `DashboardCalendar`

**Archivo:** `src/components/dashboard/DashboardCalendar.tsx`

### Props
```typescript
interface DashboardCalendarProps {
  bookings: Reservation[];       // ya filtradas por propiedad (si aplica)
  selectedDate: string;          // ISO format: "YYYY-MM-DD"
  onDateSelect: (date: string) => void;
}
```

El componente recibe las reservas ya filtradas desde el padre (`NewDashboardView`) para que el filtro de propiedad afecte también al calendario.

### Comportamiento de navegación
- Un mes visible a la vez
- Botones `◀` / `▶` para mes anterior / siguiente
- Al montar: mes actual
- Click en día → `onDateSelect(isoDate)` + highlight visual del día seleccionado

### Dot markers por día

Cada día del grid analiza las reservas que tienen relación con esa fecha:

| Situación | Color | CSS var |
|-----------|-------|---------|
| Check-in (esa fecha = `check_in`) | Verde | `--ok` (#22c55e) |
| En curso (fecha entre `check_in` y `check_out`, exclusivo) | Azul | `--notice` (#0ea5e9) |
| Check-out (esa fecha = `check_out`) | Naranja/ámbar | `--caution` (#f59e0b) |
| Cancelado (`booking_status === 'cancelled'`) | Rojo | `--danger` (#ef4444) |

Reglas:
- Mostrar hasta 3 dots por día (uno por cada tipo presente, sin repetir)
- Orden visual: check-in > en curso > check-out > cancelado
- Reservas canceladas solo muestran dot rojo independientemente de fechas
- Días fuera del mes visible: sin dots, número en `text-content-3`

### Layout visual del calendario
```
◀          Mayo 2026          ▶
 L    M    X    J    V    S    D
                1    2    3    4
 5    6    7    8    9   10   11
       •         ●
12   13   14   15   16   17   18
```
- **Día de hoy:** círculo sutil de fondo brand al 10% opacidad + borde brand
- **Día seleccionado:** círculo sólido brand color, texto blanco
- **Dots:** fila de puntos de 6px debajo del número del día, centrados horizontalmente
- Altura mínima del componente: `min-h-[55vh]` en mobile, `min-h-[60vh]` en desktop

---

## Componente 2: Filtro de Propiedad (inline en `NewDashboardView`)

**Posición:** entre el calendario y la sección de cards.

### UI
```
[ 🏨  Todas las propiedades  ▼ ]
```
- Dropdown nativo `<select>` o custom dropdown
- Primera opción: "Todas las propiedades" (valor: `null` o `''`)
- Opciones restantes: nombre de cada propiedad del tenant
- Fuente de datos: `useChannexProperties(businessId)` (ya existe)

### Comportamiento
- Default al montar: "Todas las propiedades"
- Al cambiar: filtra `allBookings` → `filteredBookings` en `NewDashboardView`
- `filteredBookings` se pasa tanto a `DashboardCalendar` como al render de cards
- El calendario y los cards siempre muestran los mismos datos

---

## Componente 3: `ReservationCard`

**Archivo:** `src/components/dashboard/ReservationCard.tsx`  
**Reutilizable:** puede usarse en otras secciones del sistema.

### Props
```typescript
interface ReservationCardProps {
  reservation: Reservation;
  threads: ChannexThread[];        // threads precargados para lookup
  onViewDetail: (r: Reservation) => void;
  onNoThread: (r: Reservation) => void;
}
```

### Layout de la card (ancho completo)

```
┌──────────────────────────────────────────────────────┐
│  [● Check-in hoy]                    [Airbnb / BCom] │
│                                                       │
│  👤 Nombre del huésped                               │
│  📅 15 May 2026 → 17 May 2026  ·  2 noches          │
│  👥 1 persona                                        │
│                                                       │
│  ┌──────────────────┐   ┌─────────────────────────┐  │
│  │  💬 Ver mensajes │   │  🔍 Ver detalle reserva  │  │
│  └──────────────────┘   └─────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Status badge (basado en `selectedDate`, no en `today`)

El status se calcula respecto a la fecha seleccionada en el calendario (pasada desde el padre):

```typescript
function getCardStatus(
  reservation: Reservation,
  selectedDate: string
): 'checkin' | 'inprogress' | 'checkout' | 'cancelled' {
  if (reservation.booking_status === 'cancelled') return 'cancelled';
  if (reservation.check_in === selectedDate) return 'checkin';
  if (reservation.check_out === selectedDate) return 'checkout';
  return 'inprogress';
}
```

| Status | Label | Color dot |
|--------|-------|-----------|
| `checkin` | "Check-in" | Verde (`--ok`) |
| `inprogress` | "En curso" | Azul (`--notice`) |
| `checkout` | "Check-out" | Naranja (`--caution`) |
| `cancelled` | "Cancelado" | Rojo (`--danger`) |

### Ordenamiento de cards

En `NewDashboardView`, antes de renderizar:
```typescript
const STATUS_ORDER = { checkin: 0, inprogress: 1, checkout: 2, cancelled: 3 };
const sortedCards = [...selectedDateBookings].sort((a, b) =>
  STATUS_ORDER[getCardStatus(a, selectedDate)] - STATUS_ORDER[getCardStatus(b, selectedDate)]
);
```

### Campo de personas
```typescript
const guests = (r.occ_adults ?? 0) + (r.occ_children ?? 0) + (r.occ_infants ?? 0) || 1;
```

### Botón "Ver mensajes"
1. Buscar: `threads.find(t => t.bookingId === reservation.channex_booking_id)`
2. Si encontrado → navegar a `/channex/airbnb` o `/channex/booking` según `reservation.channel`
   - Sin `?threadId` por ahora (deep-link pendiente para fase posterior)
3. Si no encontrado → llamar `onNoThread(reservation)` → modal `NoConversationModal`

### Channel badge
```typescript
// reservation.channel puede ser: 'Airbnb', 'BookingCom', 'booking_com', 'direct', etc.
const isAirbnb = /airbnb/i.test(reservation.channel ?? '');
const isBooking = /booking/i.test(reservation.channel ?? '');
```

---

## Componente 4: `NoConversationModal`

**Archivo:** `src/components/dashboard/NoConversationModal.tsx`

### Props
```typescript
interface NoConversationModalProps {
  guestName: string;
  onClose: () => void;
}
```

### Contenido
```
┌──────────────────────────────────────────────┐
│  💬  Sin conversación directa                │
│                                              │
│  No se encontró un intercambio de mensajes   │
│  con [Nombre del huésped].                   │
│                                              │
│  Espera a que el huésped inicie o responda   │
│  un mensaje para acceder al hilo.            │
│                                              │
│                 [  Entendido  ]              │
└──────────────────────────────────────────────┘
```

---

## Componente 5: `NewDashboardView` (orquestador)

**Archivo:** `src/components/dashboard/NewDashboardView.tsx`

### Props
```typescript
interface NewDashboardViewProps {
  businessId: string;   // === tenantId para Channex
}
```

### State
```typescript
const [selectedDate, setSelectedDate] = useState<string>(isoToday);
const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
const [allBookings, setAllBookings] = useState<Reservation[]>([]);
const [allThreads, setAllThreads] = useState<ChannexThread[]>([]);
const [detailReservation, setDetailReservation] = useState<Reservation | null>(null);
const [noConvReservation, setNoConvReservation] = useState<Reservation | null>(null);
```

### Suscripciones Firestore (tiempo real)
```typescript
// Bookings — sin filtro de propiedad, todas las del tenant
collection(db, 'channex_integrations', businessId, 'bookings')

// Threads — sin filtro de propiedad
collection(db, 'channex_integrations', businessId, 'threads')
```

### Derivaciones con useMemo
```typescript
// 1. Filtrar por propiedad seleccionada
const filteredBookings = useMemo(() =>
  selectedPropertyId
    ? allBookings.filter(b => b.propertyId === selectedPropertyId)
    : allBookings,
  [allBookings, selectedPropertyId]);

// 2. Filtrar por fecha seleccionada
const selectedDateBookings = useMemo(() =>
  filteredBookings.filter(r =>
    r.check_in <= selectedDate && r.check_out >= selectedDate
  ), [filteredBookings, selectedDate]);

// 3. Ordenar por status
const sortedBookings = useMemo(() =>
  [...selectedDateBookings].sort((a, b) =>
    STATUS_ORDER[getCardStatus(a, selectedDate)] - STATUS_ORDER[getCardStatus(b, selectedDate)]
  ), [selectedDateBookings, selectedDate]);
```

### Hook de propiedades
```typescript
const { properties } = useChannexProperties(businessId);
// Para el dropdown del filtro
```

---

## Paleta de colores de dots y badges

| Estado | Color | Hex | Token |
|--------|-------|-----|-------|
| Check-in | Verde | #22c55e | `--ok` |
| En curso | Azul | #0ea5e9 | `--notice` |
| Check-out | Naranja | #f59e0b | `--caution` |
| Cancelado | Rojo | #ef4444 | `--danger` |

Funcionan en light y dark mode sin cambios adicionales.

---

## Archivos a crear / modificar

| Acción | Archivo |
|--------|---------|
| CREAR | `src/components/dashboard/DashboardCalendar.tsx` |
| CREAR | `src/components/dashboard/ReservationCard.tsx` |
| CREAR | `src/components/dashboard/NoConversationModal.tsx` |
| CREAR | `src/components/dashboard/NewDashboardView.tsx` |
| MODIFICAR | `src/App.tsx` — reemplazar `<DashboardView ...>` por `<NewDashboardView businessId={businessId} />` |
| MANTENER | `src/components/dashboard/DashboardView.tsx` — intacto (no eliminar) |

---

## Fuera de scope (fase posterior)

- Deep-link `?threadId=X` en `/channex/airbnb` y `/channex/booking` para pre-seleccionar hilo
- Re-integración de KPI cards y channel stats (ver `2026-05-20-bottom-nav-hidden-tabs.md`)
