import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Reservation } from '../../channex/api/channexHubApi';

interface DashboardCalendarProps {
  bookings: Reservation[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
  mode?: 'view' | 'edit';
  onModeChange?: (mode: 'view' | 'edit') => void;
  onRangeComplete?: (from: string, to: string) => void;
  stopSellDates?: Set<string>;
  onViewMonthChange?: (monthKey: string) => void;
  bookingCountByDate?: Map<string, number>;
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
    if (b.booking_status === 'booking_cancellation' && dateStr >= b.check_in && dateStr <= b.check_out) {
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
  mode = 'view',
  onModeChange,
  onRangeComplete,
  stopSellDates,
  onViewMonthChange,
  bookingCountByDate,
}: DashboardCalendarProps) {
  const today = new Date().toISOString().split('T')[0];
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  });

  const year = viewDate.getUTCFullYear();
  const month = viewDate.getUTCMonth();

  const prevMonth = () => {
    const d = new Date(Date.UTC(year, month - 1, 1));
    setViewDate(d); setRangeStart(null);
    onViewMonthChange?.(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const d = new Date(Date.UTC(year, month + 1, 1));
    setViewDate(d); setRangeStart(null);
    onViewMonthChange?.(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };

  useEffect(() => {
    if (mode === 'view') setRangeStart(null);
  }, [mode]);

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
      <div className={[
        'flex items-center justify-between px-4 py-3 border-b border-edge/60',
        mode === 'edit' ? 'bg-caution-bg/40' : '',
      ].join(' ')}>
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
        {onModeChange && (
          <button
            type="button"
            onClick={() => {
              const next = mode === 'view' ? 'edit' : 'view';
              onModeChange(next);
            }}
            className={[
              'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
              mode === 'edit'
                ? 'bg-caution text-white'
                : 'bg-surface-subtle text-content-2 hover:text-content hover:bg-surface-raised border border-edge',
            ].join(' ')}
          >
            {mode === 'edit' ? 'Salir de edición' : 'Gestionar calendario'}
          </button>
        )}
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
          const isRangeStart = mode === 'edit' && rangeStart === cell;
          const isStopSell = stopSellDates?.has(cell) ?? false;

          return (
            <button
              key={cell}
              type="button"
              onClick={() => {
                if (mode === 'view') {
                  onDateSelect(cell);
                  return;
                }
                // modo edit — selección de rango
                if (!rangeStart) {
                  setRangeStart(cell);
                  return;
                }
                if (cell === rangeStart) {
                  onRangeComplete?.(cell, cell);
                  setRangeStart(null);
                  return;
                }
                if (cell >= rangeStart) {
                  onRangeComplete?.(rangeStart, cell);
                  setRangeStart(null);
                } else {
                  setRangeStart(cell);
                }
              }}
              className={[
                'relative flex flex-col items-center justify-start pt-1.5 pb-1 rounded-lg',
                'transition-colors duration-100 min-h-[44px] cursor-pointer',
                isRangeStart
                  ? 'bg-brand/20 border border-brand text-brand'
                  : isSelected
                  ? 'bg-brand text-white'
                  : isToday
                  ? 'bg-brand/10 text-brand border border-brand'
                  : isStopSell
                  ? 'bg-danger-bg/60 hover:bg-danger-bg/80 text-content'
                  : 'hover:bg-surface-subtle text-content',
              ].join(' ')}
            >
              <span className={`text-[13px] font-semibold leading-none ${isSelected ? 'text-white' : ''}`}>
                {parseInt(cell.split('-')[2], 10)}
              </span>
              {!isSelected && (bookingCountByDate?.get(cell) ?? 0) > 0 && (
                <span className="absolute bottom-1 right-1 text-[9px] font-bold leading-none tabular-nums text-content-2">
                  {bookingCountByDate!.get(cell)}
                </span>
              )}
              {isStopSell && !isSelected && (
                <>
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 h-full w-full text-danger-text opacity-30"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <line x1="5" y1="5" x2="95" y2="95" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                    <line x1="95" y1="5" x2="5" y2="95" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                  </svg>
                  <span className="text-[8px] font-bold leading-none text-danger-text mt-0.5">SS</span>
                </>
              )}
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

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 border-t border-edge/40">
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
        {stopSellDates && stopSellDates.size > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm flex-shrink-0 bg-danger-bg/80" />
            <span className="text-[10px] font-medium text-content-3">Cierre ventas</span>
          </div>
        )}
      </div>
    </div>
  );
}
