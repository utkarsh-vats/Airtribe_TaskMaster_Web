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

/** "Oct 18", or "Oct 18, 2025" when it isn't the current year. */
export function shortDate(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    return (date.getFullYear() === now.getFullYear() ? sameYearFormat : otherYearFormat).format(
        date,
    );
}

const isYesterday = (date: Date, now: Date) => {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return date.toDateString() === yesterday.toDateString();
};

/**
 * "just now" (under a minute, or in the future), "5 min ago", "2 h ago" (under a day),
 * "Yesterday" (the previous calendar day), then shortDate().
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
    const date = new Date(iso);
    const elapsed = now.getTime() - date.getTime();
    if (Number.isNaN(elapsed)) return '';
    if (elapsed < MINUTE) return 'just now';
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
    if (elapsed < 24 * HOUR) return `${Math.floor(elapsed / HOUR)} h ago`;
    if (isYesterday(date, now)) return 'Yesterday';
    return shortDate(iso, now);
}

const fullFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short' });

/** "Wednesday, October 28, 2026 at 11:59 PM" — for title attributes. */
export function fullDateTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : fullFormat.format(date);
}
