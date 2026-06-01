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
  if (reservation.booking_status === 'booking_cancellation') return 'cancelled';
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
  const guests = (r.occ_adults ?? 0) + (r.occ_children ?? 0) + (r.occ_infants ?? 0) || 1;
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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <User size={13} className="text-content-3 flex-shrink-0" />
          <span className="text-[14px] font-semibold text-content truncate">{guestName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={13} className="text-content-3 flex-shrink-0" />
          <span className="text-[12px] text-content-2">
            {fmtDate(r.check_in)} → {fmtDate(r.check_out)}
            <span className="text-content-3 ml-1.5">
              · {nights} {nights === 1 ? 'noche' : 'noches'}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Users size={13} className="text-content-3 flex-shrink-0" />
          <span className="text-[12px] text-content-2">
            {guests} {guests === 1 ? 'persona' : 'personas'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-edge/50">
        <button
          type="button"
          onClick={handleMessages}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                     text-[12px] font-semibold text-content-2 bg-surface-subtle
                     hover:bg-notice/10 hover:text-notice transition-colors"
        >
          <MessageSquare size={13} />
          Ver mensajes
        </button>
        <button
          type="button"
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
