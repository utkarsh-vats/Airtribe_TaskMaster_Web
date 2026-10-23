/*
 * Due dates (DESIGN.md §5): the UI picks a day; the API stores an instant. A day means "by the
 * end of it" in the user's own time zone, so a task due Oct 28 in Kolkata is sent as
 * 2026-10-28T23:59:59+05:30 — the offset makes the intent visible in the API too.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-28" → end of that day, local time, ISO 8601 with offset. */
export function toDueInstant(day: string): string {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    const end = new Date(y, m - 1, d, 23, 59, 59);
    // getTimezoneOffset is minutes *behind* UTC, for that date (so DST is right).
    const offset = -end.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hh = pad(Math.floor(Math.abs(offset) / 60));
    const mm = pad(Math.abs(offset) % 60);
    return `${y}-${pad(m)}-${pad(d)}T23:59:59${sign}${hh}:${mm}`;
}

/** An instant → the local day it falls on, for <input type="date">. */
export function fromDueInstant(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
