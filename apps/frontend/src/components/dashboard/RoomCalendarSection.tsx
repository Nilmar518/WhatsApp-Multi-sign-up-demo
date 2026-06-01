import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import type { Reservation, ARIMonthSnapshot, StoredRoomType } from '../../channex/api/channexHubApi';
import type { ChannexThread } from '../../channex/hooks/useChannexThreads';
import DashboardCalendar from './DashboardCalendar';
import ReservationCard from './ReservationCard';
import { ChevronDown, Hotel } from 'lucide-react';

type CardStatus = 'checkin' | 'inprogress' | 'checkout' | 'cancelled';
const STATUS_ORDER: Record<CardStatus, number> = { checkin: 0, inprogress: 1, checkout: 2, cancelled: 3 };

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getCardStatus(r: Reservation, date: string): CardStatus {
  if (r.booking_status === 'booking_cancellation') return 'cancelled';
  if (r.check_in === date) return 'checkin';
  if (r.check_out === date) return 'checkout';
  return 'inprogress';
}

interface RoomCalendarSectionProps {
  roomType: StoredRoomType;
  bookings: Reservation[];
  tenantId: string;
  propertyId: string;
  propertyTitle: string;
  threads: ChannexThread[];
  onViewDetail: (r: Reservation) => void;
  onNoThread: (r: Reservation) => void;
  onOpenRestrictions: (from: string, to: string) => void;
  onCloseRestrictions: () => void;
}

export default function RoomCalendarSection({
  roomType, bookings, tenantId, propertyId,
  threads, onViewDetail, onNoThread,
  onOpenRestrictions, onCloseRestrictions,
}: RoomCalendarSectionProps) {
  const [selectedDate, setSelectedDate] = useState<string>(isoToday);
  const [calendarMode, setCalendarMode] = useState<'view' | 'edit'>('view');
  const [monthKey, setMonthKey] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [snapshot, setSnapshot] = useState<ARIMonthSnapshot>({});
  const [bookingsOpen, setBookingsOpen] = useState(true);

  // Firestore subscription to ARI snapshot
  useEffect(() => {
    if (!propertyId || !tenantId) { setSnapshot({}); return; }
    const ref = doc(db, 'channex_integrations', tenantId, 'properties', propertyId, 'ari_snapshots', monthKey);
    const unsub = onSnapshot(ref, snap => {
      setSnapshot(snap.exists() ? (snap.data() as ARIMonthSnapshot) : {});
    }, () => setSnapshot({}));
    return () => unsub();
  }, [tenantId, propertyId, monthKey]);

  // SS dates filtered by this room type's rate plans
  const ssDateSet = useMemo(() => {
    const ids = new Set(roomType.rate_plans.map(rp => rp.rate_plan_id));
    const ss = new Set<string>();
    for (const [date, day] of Object.entries(snapshot)) {
      for (const [rpId, rp] of Object.entries(day.ratePlans ?? {})) {
        if (ids.has(rpId) && rp.stopSell) ss.add(date);
      }
    }
    return ss;
  }, [snapshot, roomType]);

  // Bookings for the selected date
  const selectedDateBookings = useMemo(() =>
    bookings.filter(r => r.check_in <= selectedDate && r.check_out >= selectedDate),
    [bookings, selectedDate]);

  const sortedBookings = useMemo(() =>
    [...selectedDateBookings].sort((a, b) =>
      STATUS_ORDER[getCardStatus(a, selectedDate)] - STATUS_ORDER[getCardStatus(b, selectedDate)]),
    [selectedDateBookings, selectedDate]);

  const selectedDateLabel = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }, [selectedDate]);

  function handleModeChange(mode: 'view' | 'edit') {
    setCalendarMode(mode);
    if (mode === 'view') onCloseRestrictions();
  }

  function handleRangeComplete(from: string, to: string) {
    onOpenRestrictions(from, to);
  }

  function handleViewMonthChange(key: string) {
    setMonthKey(key);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Room header divider */}
      <div className="flex items-center gap-3 px-1">
        <span className="h-px flex-1 bg-edge" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-content-3">
          {roomType.title}
        </span>
        <span className="h-px flex-1 bg-edge" />
      </div>

      {/* Calendar */}
      <DashboardCalendar
        bookings={bookings}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
        mode={calendarMode}
        onModeChange={handleModeChange}
        onRangeComplete={handleRangeComplete}
        stopSellDates={ssDateSet}
        onViewMonthChange={handleViewMonthChange}
      />

      {/* Reservation cards */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setBookingsOpen((o) => !o)}
          className="flex items-center justify-between w-full text-left"
        >
          <h3 className="text-[13px] font-bold text-content capitalize">{selectedDateLabel}</h3>
          <div className="flex items-center gap-2">
            {sortedBookings.length > 0 && (
              <span className="text-[11px] text-content-3 font-medium">
                {sortedBookings.length} {sortedBookings.length === 1 ? 'reserva' : 'reservas'}
              </span>
            )}
            <ChevronDown
              size={14}
              className={`text-content-3 transition-transform duration-200 ${bookingsOpen ? '' : '-rotate-90'}`}
            />
          </div>
        </button>

        {bookingsOpen && (
          <>
            {sortedBookings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-10 h-10 rounded-xl bg-surface-subtle flex items-center justify-center mb-2">
                  <Hotel size={16} className="text-content-3" />
                </div>
                <p className="text-[12px] font-semibold text-content-2">Sin reservas este día</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {sortedBookings.map(r => (
                  <ReservationCard
                    key={r.id ?? r.channex_booking_id ?? r.reservation_id}
                    reservation={r}
                    selectedDate={selectedDate}
                    threads={threads}
                    onViewDetail={onViewDetail}
                    onNoThread={onNoThread}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}
