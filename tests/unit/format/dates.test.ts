import { describe, expect, it } from 'vitest';

import { formatDay, relativeTime, shortDate } from '@/lib/format/dates';

import { inTimeZone } from '../../timeZone';

// Local time: these tests build dates from parts, so they hold in any time zone.
const NOW = new Date(2026, 9, 21, 15, 30, 0); // Oct 21 2026, 15:30
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('relativeTime', () => {
    it.each([
        ['just now', ago(0)],
        ['just now', ago(59_000)],
        ['just now', new Date(NOW.getTime() + 5 * MIN).toISOString()], // clock skew
        ['1 min ago', ago(MIN)],
        ['5 min ago', ago(5 * MIN + 20_000)],
        ['59 min ago', ago(59 * MIN)],
        ['1 h ago', ago(HOUR)],
        ['2 h ago', ago(2 * HOUR + 10 * MIN)],
        ['23 h ago', ago(23 * HOUR)],
    ])('%s', (expected, iso) => {
        expect(relativeTime(iso, NOW)).toBe(expected);
    });

    it('says Yesterday for the previous calendar day, past 24 h', () => {
        expect(relativeTime(new Date(2026, 9, 20, 9, 0).toISOString(), NOW)).toBe('Yesterday');
    });

    it('falls back to a short date', () => {
        expect(relativeTime(new Date(2026, 9, 18, 12, 0).toISOString(), NOW)).toBe('Oct 18');
        expect(relativeTime(new Date(2025, 9, 18, 12, 0).toISOString(), NOW)).toBe('Oct 18, 2025');
    });

    it('returns an empty string for an invalid date', () => {
        expect(relativeTime('not a date', NOW)).toBe('');
    });
});

describe('shortDate', () => {
    it('omits the year only for the current year', () => {
        expect(shortDate(new Date(2026, 0, 5).toISOString(), NOW)).toBe('Jan 5');
        expect(shortDate(new Date(2027, 11, 31).toISOString(), NOW)).toBe('Dec 31, 2027');
    });
});

// Date-only values are calendar days: the same text in every zone, east or west of UTC.
describe.each(['UTC', 'America/New_York', 'Asia/Kolkata'])('formatDay in %s', (tz) => {
    inTimeZone(tz);
    const now = new Date(2026, 9, 24, 12, 0);

    it('keeps the day (no shift to the day before or after)', () => {
        expect(formatDay('2026-10-20', now)).toBe('Oct 20');
        expect(formatDay('2026-01-01', now)).toBe('Jan 1');
        expect(formatDay('2026-12-31', now)).toBe('Dec 31');
        expect(formatDay('2026-11-01', now)).toBe('Nov 1'); // the day DST ends in New York
        expect(formatDay('2026-03-08', now)).toBe('Mar 8'); // the day it begins
    });

    it('adds the year outside the current one', () => {
        expect(formatDay('2025-10-20', now)).toBe('Oct 20, 2025');
        expect(formatDay('2027-01-01', now)).toBe('Jan 1, 2027');
    });

    it('returns "" for anything but a real YYYY-MM-DD day', () => {
        expect(formatDay('', now)).toBe('');
        expect(formatDay('2026-02-31', now)).toBe('');
        expect(formatDay('2026-10-20T00:00:00Z', now)).toBe('');
        expect(formatDay('20/10/2026', now)).toBe('');
    });
});
