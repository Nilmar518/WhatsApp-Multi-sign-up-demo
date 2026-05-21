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
    ...(data as unknown as Reservation),
    id: docId,
    channex_property_id: ((data.channex_property_id ?? data.propertyId ?? '') as string),
  };
}

export default function NewDashboardView({ businessId }: NewDashboardViewProps) {
  const [selectedDate, setSelectedDate] = useState<string>(isoToday);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [allBookings, setAllBookings] = useState<Reservation[]>([]);
  const [detailReservation, setDetailReservation] = useState<Reservation | null>(null);
  const [noConvReservation, setNoConvReservation] = useState<Reservation | null>(null);

  const { properties } = useChannexProperties(businessId);

  const propertyIds = useMemo(
    () => properties.map((p) => p.channex_property_id),
    [properties],
  );
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

  const filteredBookings = useMemo(
    () =>
      selectedPropertyId
        ? allBookings.filter((b) => b.channex_property_id === selectedPropertyId)
        : allBookings,
    [allBookings, selectedPropertyId],
  );

  const selectedDateBookings = useMemo(
    () => filteredBookings.filter((r) => r.check_in <= selectedDate && r.check_out >= selectedDate),
    [filteredBookings, selectedDate],
  );

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
      <DashboardCalendar
        bookings={filteredBookings}
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
      />

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
            <p className="text-[12px] text-content-3 mt-1">Selecciona otra fecha en el calendario</p>
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
    </div>
  );
}
