import { useState, useEffect, useMemo } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { ChevronDown, Hotel } from 'lucide-react';
import { db } from '../../firebase/firebase';
import type { Reservation, ARIMonthSnapshot, StoredRoomType } from '../../channex/api/channexHubApi';
import { listRoomTypes } from '../../channex/api/channexHubApi';
import { useChannexProperties } from '../../channex/hooks/useChannexProperties';
import { useAllPropertyThreads } from '../../channex/hooks/useChannexThreads';
import DashboardCalendar from './DashboardCalendar';
import ReservationCard from './ReservationCard';
import NoConversationModal from './NoConversationModal';
import ReservationDetailModal from '../../channex/components/shared/ReservationDetailModal';
import ARIRestrictionDrawer from './ARIRestrictionDrawer';
import RoomCalendarSection from './RoomCalendarSection';
import { countActiveReservationDays, isActiveReservationOnDate } from './reservationUtils';

interface NewDashboardViewProps {
  businessId: string;
}

type CardStatus = 'checkin' | 'inprogress' | 'checkout' | 'cancelled';
const STATUS_ORDER: Record<CardStatus, number> = { checkin: 0, inprogress: 1, checkout: 2, cancelled: 3 };

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getCardStatus(reservation: Reservation, selectedDate: string): CardStatus {
  if (reservation.booking_status === 'booking_cancellation') return 'cancelled';
  if (reservation.check_in === selectedDate) return 'checkin';
  if (reservation.check_out === selectedDate) return 'checkout';
  return 'inprogress';
}

function mapFirestoreBooking(docId: string, data: Record<string, unknown>): Reservation {
  return {
    ...(data as unknown as Reservation),
    id: docId,
    channex_property_id: ((data.channex_property_id ?? data.propertyId ?? '') as string),
  };
}

function computeSSdates(snapshot: ARIMonthSnapshot, ratePlanIds: Set<string>): Set<string> {
  const ss = new Set<string>();
  for (const [date, day] of Object.entries(snapshot)) {
    for (const [rpId, rp] of Object.entries(day.ratePlans ?? {})) {
      if ((ratePlanIds.size === 0 || ratePlanIds.has(rpId)) && rp.stopSell) ss.add(date);
    }
  }
  return ss;
}

export default function NewDashboardView({ businessId }: NewDashboardViewProps) {
  const [selectedDate, setSelectedDate] = useState<string>(isoToday);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [allBookings, setAllBookings] = useState<Reservation[]>([]);
  const [detailReservation, setDetailReservation] = useState<Reservation | null>(null);
  const [noConvReservation, setNoConvReservation] = useState<Reservation | null>(null);
  const [calendarMode, setCalendarMode] = useState<'view' | 'edit'>('view');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDateFrom, setDrawerDateFrom] = useState('');
  const [drawerDateTo, setDrawerDateTo] = useState('');
  const [drawerRoomTypeId, setDrawerRoomTypeId] = useState<string | undefined>(undefined);
  const [calendarMonthKey, setCalendarMonthKey] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [roomTypes, setRoomTypes] = useState<StoredRoomType[]>([]);
  const [ariSnapshot, setAriSnapshot] = useState<ARIMonthSnapshot>({});
  const [loadingProperty, setLoadingProperty] = useState(false);
  const [propertyAccordions, setPropertyAccordions] = useState<Record<string, boolean>>({});

  const { properties } = useChannexProperties(businessId);
  const propertyIds = useMemo(() => properties.map((p) => p.channex_property_id), [properties]);
  const { threads } = useAllPropertyThreads(businessId, propertyIds);

  useEffect(() => {
    if (!businessId) return;
    const unsub = onSnapshot(
      collection(db, 'channex_integrations', businessId, 'bookings'),
      (snap) => {
        setAllBookings(
          snap.docs.map((d) => mapFirestoreBooking(d.id, d.data() as Record<string, unknown>)),
        );
      },
    );
    return () => unsub();
  }, [businessId]);

  useEffect(() => {
    if (!selectedPropertyId) { setRoomTypes([]); return; }
    setLoadingProperty(true);
    listRoomTypes(selectedPropertyId)
      .then(data => setRoomTypes(Array.isArray(data) ? data : []))
      .catch(() => setRoomTypes([]))
      .finally(() => setLoadingProperty(false));
  }, [selectedPropertyId]);

  useEffect(() => {
    if (!selectedPropertyId || !businessId) { setAriSnapshot({}); return; }
    const ref = doc(db, 'channex_integrations', businessId, 'properties',
      selectedPropertyId, 'ari_snapshots', calendarMonthKey);
    const unsub = onSnapshot(ref, snap => {
      setAriSnapshot(snap.exists() ? (snap.data() as ARIMonthSnapshot) : {});
    }, () => setAriSnapshot({}));
    return () => unsub();
  }, [selectedPropertyId, businessId, calendarMonthKey]);

  const filteredBookings = useMemo(
    () => selectedPropertyId
      ? allBookings.filter((b) => b.channex_property_id === selectedPropertyId)
      : allBookings,
    [allBookings, selectedPropertyId],
  );

  const allSSdates = useMemo(() => computeSSdates(ariSnapshot, new Set()), [ariSnapshot]);

  const unmappedBookings = useMemo(() => {
    if (!selectedPropertyId || roomTypes.length === 0) return [];
    const known = new Set(roomTypes.map(rt => rt.room_type_id));
    return filteredBookings.filter(b => !b.room_type_id || !known.has(b.room_type_id));
  }, [filteredBookings, roomTypes, selectedPropertyId]);

  // Count of active bookings per date — drives cell badges in aggregate calendar
  const bookingCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of filteredBookings) {
      countActiveReservationDays(b, map);
    }
    return map;
  }, [filteredBookings]);

  // Bookings active on selected date across all rooms — drives the summary card.
  const selectedDateAllBookings = useMemo(
    () => filteredBookings.filter((r) => isActiveReservationOnDate(r, selectedDate)),
    [filteredBookings, selectedDate],
  );

  // Breakdown by room type for the summary card
  const roomBreakdown = useMemo(
    () => roomTypes.map(rt => {
      const occupied = selectedDateAllBookings.filter(b => b.room_type_id === rt.room_type_id).length;
      const total = rt.count_of_rooms ?? 0;
      return { rt, occupied, available: Math.max(0, total - occupied), total };
    }),
    [roomTypes, selectedDateAllBookings],
  );

  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }, [selectedDate]);

  const selectedPropertyTitle = useMemo(
    () => properties.find(p => p.channex_property_id === selectedPropertyId)?.title ?? '',
    [properties, selectedPropertyId],
  );

  const propertySections = useMemo(() => {
    if (selectedPropertyId) return [];
    return properties
      .map(prop => {
        const forDate = allBookings.filter(
          b => b.channex_property_id === prop.channex_property_id &&
           b.check_in <= selectedDate && b.check_out >= selectedDate,
        );
        const sorted = [...forDate].sort(
          (a, b) => STATUS_ORDER[getCardStatus(a, selectedDate)] - STATUS_ORDER[getCardStatus(b, selectedDate)],
        );
        return { property: prop, bookings: sorted };
      })
      .filter(s => s.bookings.length > 0);
  }, [selectedPropertyId, properties, allBookings, selectedDate]);

  function handleOpenRestrictions(from: string, to: string, roomTypeId?: string) {
    setDrawerDateFrom(from);
    setDrawerDateTo(to);
    setDrawerRoomTypeId(roomTypeId);
    setDrawerOpen(true);
  }

  function handleRangeComplete(from: string, to: string) {
    handleOpenRestrictions(from, to, undefined);
  }

  function handleModeChange(mode: 'view' | 'edit') {
    setCalendarMode(mode);
    if (mode === 'view') setDrawerOpen(false);
  }

  function handleViewMonthChange(monthKey: string) {
    setCalendarMonthKey(monthKey);
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-6 max-w-4xl mx-auto w-full">

      {/* ── Property selector — TOP ── */}
      <div className="relative">
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
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* ── Summary card (selected date) — when property is selected ── */}
      {selectedPropertyId && (
        <div className="rounded-xl border border-edge bg-surface-raised shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-edge/50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-content-3 capitalize">
              {selectedDateLabel}
            </p>
          </div>
          <div className="flex min-h-[80px]">
            {/* Total */}
            <div className="flex flex-col items-center justify-start pt-4 px-6 pb-4 border-r border-edge min-w-[100px]">
              <span className="text-[42px] font-black leading-none text-content tabular-nums">
                {selectedDateAllBookings.length}
              </span>
              <span className="text-[11px] text-content-3 mt-1.5">
                {selectedDateAllBookings.length === 1 ? 'reserva' : 'reservas'}
              </span>
            </div>
            {/* Breakdown by room type */}
            <div className="flex-1 px-4 py-3 flex flex-col justify-start gap-2">
              {loadingProperty ? (
                <p className="text-[12px] text-content-3">Cargando habitaciones...</p>
              ) : roomBreakdown.length === 0 ? (
                <p className="text-[12px] text-content-3 italic">Sin habitaciones configuradas</p>
              ) : (
                <>
                  {/* Column labels */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-content-3 invisible">label</span>
                    <div className="flex items-center gap-1 shrink-0 text-[10px] font-semibold text-content-3">
                      <span className="min-w-[28px] text-center">ocup.</span>
                      <span className="min-w-[28px] text-center">disp.</span>
                      <span className="min-w-[28px] text-center">total</span>
                    </div>
                  </div>
                  {roomBreakdown.map(({ rt, occupied, available, total }) => (
                  <div key={rt.room_type_id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-content-2 truncate">{rt.title}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`inline-flex items-center justify-center gap-0.5 min-w-[28px] h-5 rounded px-1.5 text-[11px] font-bold ${
                          occupied > 0 ? 'bg-red-100 text-red-600' : 'bg-surface-subtle text-content-3'
                        }`}>
                          ✗{occupied}
                        </span>
                        <span className={`inline-flex items-center justify-center gap-0.5 min-w-[28px] h-5 rounded px-1.5 text-[11px] font-bold ${
                          available > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-subtle text-content-3'
                        }`}>
                          ✓{available}
                        </span>
                        {total > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[28px] h-5 rounded px-1.5 text-[11px] font-semibold bg-surface-subtle text-content-3">
                            /{total}
                          </span>
                        )}
                      </div>
                    </div>
                    {total > 0 && (
                      <div className="flex gap-[3px] flex-wrap">
                        {Array.from({ length: Math.min(total, 20) }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-[10px] h-[10px] rounded-[2px] ${
                              i < occupied ? 'bg-red-400' : 'bg-emerald-400/80'
                            }`}
                          />
                        ))}
                        {total > 20 && (
                          <span className="text-[10px] text-content-3 self-center ml-0.5">
                            +{total - 20}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Aggregate calendar divider ── */}
      {selectedPropertyId && (
        <div className="flex items-center gap-3 px-1">
          <span className="h-px flex-1 bg-edge" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-content-3">
            {selectedPropertyTitle}
          </span>
          <span className="h-px flex-1 bg-edge" />
        </div>
      )}

      {/* ── Aggregate calendar (all rooms of selected property, or all properties) ── */}
      <DashboardCalendar
        bookings={filteredBookings}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
        mode={calendarMode}
        onModeChange={handleModeChange}
        onRangeComplete={handleRangeComplete}
        stopSellDates={allSSdates}
        onViewMonthChange={handleViewMonthChange}
        bookingCountByDate={bookingCountByDate}
      />

      {/* ── No property selected: bookings by property for selected date ── */}
      {!selectedPropertyId && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[13px] font-bold text-content capitalize">{selectedDateLabel}</h3>
          {propertySections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 rounded-xl bg-surface-subtle flex items-center justify-center mb-3">
                <Hotel size={20} className="text-content-3" />
              </div>
              <p className="text-[13px] font-semibold text-content-2">Sin reservas este día</p>
              <p className="text-[12px] text-content-3 mt-1">Selecciona otra fecha en el calendario</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {propertySections.map(({ property, bookings }) => {
                const pid = property.channex_property_id;
                const open = propertyAccordions[pid] !== false;
                return (
                  <div key={pid} className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setPropertyAccordions(prev => ({ ...prev, [pid]: !open }))}
                      className="flex items-center gap-2 w-full"
                    >
                      <span className="h-px flex-1 bg-edge" />
                      <span className="text-[11px] font-bold uppercase tracking-widest text-content-3 shrink-0">
                        {property.title}
                      </span>
                      <span className="text-[11px] text-content-3 font-medium shrink-0">
                        · {bookings.length} {bookings.length === 1 ? 'reserva' : 'reservas'}
                      </span>
                      <ChevronDown
                        size={12}
                        className={`text-content-3 transition-transform duration-200 shrink-0 ${open ? '' : '-rotate-90'}`}
                      />
                      <span className="h-px flex-1 bg-edge" />
                    </button>
                    {open && (
                      <div className="flex flex-col gap-3">
                        {bookings.map(r => (
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
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Per-room calendars — ALL room types when property is selected ── */}
      {selectedPropertyId && roomTypes.map(rt => (
        <RoomCalendarSection
          key={rt.room_type_id}
          roomType={rt}
          bookings={filteredBookings.filter(b => b.room_type_id === rt.room_type_id)}
          tenantId={businessId}
          propertyId={selectedPropertyId}
          propertyTitle={selectedPropertyTitle}
          threads={threads}
          selectedDate={selectedDate}
          onSelectedDateChange={setSelectedDate}
          onViewDetail={setDetailReservation}
          onNoThread={setNoConvReservation}
          onOpenRestrictions={(from, to) => handleOpenRestrictions(from, to, rt.room_type_id)}
          onCloseRestrictions={() => setDrawerOpen(false)}
        />
      ))}

      {/* ── Unmapped bookings ── */}
      {selectedPropertyId && unmappedBookings.length > 0 && (() => {
        const unmappedForDate = unmappedBookings.filter(
          r => r.check_in <= selectedDate && r.check_out >= selectedDate,
        );
        return (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3 px-1">
                <span className="h-px flex-1 bg-caution/40" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-caution-text">
                  Sin habitacion mapeada
                </span>
                <span className="h-px flex-1 bg-caution/40" />
              </div>
              <p className="text-center text-[11px] text-content-3 px-2">
                Reservas sin habitacion especifica para <strong>{selectedPropertyTitle}</strong>.
                Por favor revisa cada reserva para asignar la habitacion correspondiente.
              </p>
            </div>
            {unmappedForDate.length > 0 ? (
              <div className="flex flex-col gap-3">
                {unmappedForDate.map(r => (
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
            ) : (
              <p className="text-center text-[11px] text-content-3 py-4">
                Sin reservas sin mapear para este dia
              </p>
            )}
          </div>
        );
      })()}

      {loadingProperty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/20">
          <div className="flex flex-col items-center gap-3 bg-surface-raised border border-edge rounded-2xl px-6 py-5 shadow-lg">
            <div className="w-7 h-7 rounded-full border-2 border-brand/30 border-t-brand animate-spin" />
            <p className="text-[12px] font-semibold text-content-2">Cargando propiedad...</p>
          </div>
        </div>
      )}

      {detailReservation && (
        <ReservationDetailModal
          reservation={detailReservation}
          tenantId={businessId}
          propertyChannelCode={null}
          onClose={() => setDetailReservation(null)}
        />
      )}

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

      {drawerDateFrom && (
        <ARIRestrictionDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          tenantId={businessId}
          dateFrom={drawerDateFrom}
          dateTo={drawerDateTo}
          initialPropertyId={selectedPropertyId || null}
          initialRoomTypeId={drawerRoomTypeId}
          properties={properties}
        />
      )}
    </div>
  );
}
