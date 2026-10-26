/*
 * Date display. UI copy is English, so formatting is fixed to en-US ("Oct 18") rather than the
 * browser locale; times are shown in the browser's time zone.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const sameYearFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const otherYearFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
});

// Date-only values ("2026-10-20") are calendar days, not instants: built and formatted in UTC
// so the day never shifts with the viewer's time zone.
const dayFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
});
const otherYearDayFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});
const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A date-only `YYYY-MM-DD` (e.g. a dueFrom / dueTo filter) as "Oct 20", or "Oct 20, 2025"
 * outside the current year; "" for anything else. The same day in every time zone — never
 * `new Date("2026-10-20")`, which is UTC midnight and shows as Oct 19 west of UTC.
 */
export function formatDay(day: string, now: Date = new Date()): string {
    const match = isoDay.exec(day);
    if (!match) return '';
    const [, y, m, d] = match.map(Number) as [number, number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
    return (y === now.getFullYear() ? dayFormat : otherYearDayFormat).format(date);
}

/** "Oct 18", or "Oct 18, 2025" when it isn't the current year. For instants (ISO date-times). */
export function shortDate(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    return (date.getFullYear() === now.getFullYear() ? sameYearFormat : otherYearFormat).format(
        date,
    );
}

/** Whole calendar days from `now`'s day to `date`'s (local time): 1 = tomorrow, -1 = yesterday. */
const calendarDays = (date: Date, now: Date) => {
    const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((day(date) - day(now)) / (24 * HOUR));
};

/**
 * For past events (comments, files, "Sent"): "just now" (under a minute), "5 min ago", "2 h
 * ago" (under a day), "Yesterday" (the previous calendar day), then shortDate(). Any future
 * instant is "just now": the server's clock may run ahead of the viewer's, and a past event
 * must never read "in 2 min". For deadlines, use timeUntil().
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    const elapsed = now.getTime() - date.getTime();
    if (Number.isNaN(elapsed)) return '';
    if (elapsed < MINUTE) return 'just now';
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
    if (elapsed < 24 * HOUR) return `${Math.floor(elapsed / HOUR)} h ago`;
    if (calendarDays(date, now) === -1) return 'Yesterday';
    return shortDate(iso, now);
}

/**
 * For future instants (an invitation's expiry): "in 5 min", "in 3 h" (under a day),
 * "Tomorrow", "in 5 days" (within a week), then shortDate(). Under a minute away — or already
 * past — is "in under a minute": whether it has lapsed ("Expired") is the caller's call.
 */
export function timeUntil(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    const ahead = date.getTime() - now.getTime();
    if (Number.isNaN(ahead)) return '';
    if (ahead < MINUTE) return 'in under a minute';
    if (ahead < HOUR) return `in ${Math.floor(ahead / MINUTE)} min`;
    if (ahead < 24 * HOUR) return `in ${Math.floor(ahead / HOUR)} h`;
    const days = calendarDays(date, now);
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `in ${days} days`;
    return shortDate(iso, now);
}

const fullFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short' });

/** "Wednesday, October 28, 2026 at 11:59 PM" — for title attributes. */
export function fullDateTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : fullFormat.format(date);
}
