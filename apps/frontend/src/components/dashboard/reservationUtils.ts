import type { Reservation } from '../../channex/api/channexHubApi';

export function isActiveReservationOnDate(reservation: Reservation, date: string): boolean {
  if (reservation.booking_status === 'booking_cancellation') return false;
  return reservation.check_in <= date && reservation.check_out > date;
}

export function countActiveReservationDays(reservation: Reservation, counts: Map<string, number>): void {
  if (reservation.booking_status === 'booking_cancellation') return;

  let current = new Date(`${reservation.check_in}T00:00:00Z`);
  const end = new Date(`${reservation.check_out}T00:00:00Z`);

  while (current < end) {
    const dayKey = current.toISOString().slice(0, 10);
    counts.set(dayKey, (counts.get(dayKey) ?? 0) + 1);
    current = new Date(current.getTime() + 86_400_000);
  }
}