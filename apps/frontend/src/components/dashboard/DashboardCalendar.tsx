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

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDotsForDay(dateStr: string, bookings: Reservation[]): DotType[] {
  const types = new Set<DotType>();
  for (const b of bookings) {
    if (b.booking_status === 'cancelled' && dateStr >= b.check_in && dateStr <= b.check_out) {
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
  const today = new Date().toISOString().split('T')[0];
  const [viewDate, setViewDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  });

  const year = viewDate.getUTCFullYear();
  const month = viewDate.getUTCMonth();

  const prevMonth = () => setViewDate(new Date(Date.UTC(year, month - 1, 1)));
  const nextMonth = () => setViewDate(new Date(Date.UTC(year, month + 1, 1)));

  const cells = useMemo<(string | null)[]>(() => {
    const firstDayOfMonth = new Date(Date.UTC(year, month, 1));
    const startOffset = (firstDayOfMonth.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const result: (string | null)[] = [];
    for (let i = 0; i < startOffset; i++) result.push(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(isoDate(year, month, d));
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [year, month]);

  const dotsMap = useMemo<Map<string, DotType[]>>(() => {
    const map = new Map<string, DotType[]>();
    for (const cell of cells) {
      if (cell) map.set(cell, getDotsForDay(cell, bookings));
    }
    return map;
  }, [cells, bookings]);

  return (
    <div className="bg-surface-raised border border-edge rounded-xl shadow-sm overflow-hidden min-h-[55vh] md:min-h-[60vh] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge/60">
        <button
          type="button"
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
          type="button"
          onClick={nextMonth}
          className="p-2 rounded-lg text-content-2 hover:text-content hover:bg-surface-subtle transition-colors"
          aria-label="Mes siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>

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

      <div className="grid grid-cols-7 flex-1 px-2 pb-2 gap-y-0.5">
        {cells.map((cell, idx) => {
          if (!cell) return <div key={`empty-${idx}`} />;

          const dots = dotsMap.get(cell) ?? [];
          const isToday = cell === today;
          const isSelected = cell === selectedDate;

          return (
            <button
              key={cell}
              type="button"
              onClick={() => onDateSelect(cell)}
              className={[
                'relative flex flex-col items-center justify-start pt-1.5 pb-1 rounded-lg',
                'transition-colors duration-100 min-h-[44px] cursor-pointer',
                isSelected
                  ? 'bg-brand text-white'
                  : isToday
                  ? 'bg-brand/10 text-brand border border-brand'
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
