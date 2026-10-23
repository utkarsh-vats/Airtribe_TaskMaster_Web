import { afterEach, describe, expect, it } from 'vitest';

import { fromDueInstant, toDueInstant } from '@/features/tasks/due';

const originalTz = process.env.TZ;
afterEach(() => {
    process.env.TZ = originalTz;
});

describe('toDueInstant', () => {
    it('Asia/Kolkata: end of the day with +05:30', () => {
        process.env.TZ = 'Asia/Kolkata';
        expect(toDueInstant('2026-10-28')).toBe('2026-10-28T23:59:59+05:30');
        expect(new Date(toDueInstant('2026-10-28')).toISOString()).toBe('2026-10-28T18:29:59.000Z');
    });

    it('America/New_York: the offset follows DST on that day', () => {
        process.env.TZ = 'America/New_York';
        expect(toDueInstant('2026-10-31')).toBe('2026-10-31T23:59:59-04:00'); // EDT
        expect(toDueInstant('2026-11-01')).toBe('2026-11-01T23:59:59-05:00'); // DST ended that morning
        expect(toDueInstant('2026-03-08')).toBe('2026-03-08T23:59:59-04:00'); // DST began that morning
    });

    it('UTC uses +00:00', () => {
        process.env.TZ = 'UTC';
        expect(toDueInstant('2026-01-05')).toBe('2026-01-05T23:59:59+00:00');
    });
});

describe('fromDueInstant', () => {
    it('gives the local day of an instant', () => {
        process.env.TZ = 'Asia/Kolkata';
        expect(fromDueInstant('2026-10-28T18:29:59.000Z')).toBe('2026-10-28');
        expect(fromDueInstant('2026-10-28T18:30:00.000Z')).toBe('2026-10-29'); // past local midnight
        process.env.TZ = 'America/New_York';
        expect(fromDueInstant('2026-10-28T18:29:59.000Z')).toBe('2026-10-28');
        expect(fromDueInstant('2026-10-29T02:00:00.000Z')).toBe('2026-10-28'); // still the 28th in NY
    });

    it('round-trips in any zone', () => {
        for (const tz of ['Asia/Kolkata', 'America/New_York', 'Pacific/Auckland']) {
            process.env.TZ = tz;
            for (const day of ['2026-03-08', '2026-11-01', '2026-12-31']) {
                expect(fromDueInstant(toDueInstant(day))).toBe(day);
            }
        }
    });

    it('returns "" for junk', () => {
        expect(fromDueInstant('nope')).toBe('');
    });
});
