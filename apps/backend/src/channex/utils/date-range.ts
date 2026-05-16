/** Expands [dateFrom, dateTo) to an array of ISO date strings. dateTo is exclusive. */
export function expandDateRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
