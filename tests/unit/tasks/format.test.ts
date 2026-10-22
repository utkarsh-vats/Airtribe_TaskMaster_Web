import { describe, expect, it } from 'vitest';

import { formatDue } from '@/features/tasks/format';

const NOW = new Date(2026, 9, 21, 15, 30); // Oct 21 2026, 15:30 local
const at = (...parts: [number, number, number, number?, number?]) =>
    new Date(...parts).toISOString();

describe('formatDue', () => {
    it('says "No date" without a due date', () => {
        expect(formatDue(null, 'OPEN', NOW)).toEqual({ label: 'No date', overdue: false });
    });

    it('shows an upcoming date', () => {
        expect(formatDue(at(2026, 9, 28, 23, 59), 'OPEN', NOW)).toEqual({
            label: 'Oct 28',
            overdue: false,
        });
    });

    it('adds the year outside the current year', () => {
        expect(formatDue(at(2027, 0, 15), 'IN_PROGRESS', NOW).label).toBe('Jan 15, 2027');
    });

    it('marks a past due date on an open task as overdue', () => {
        expect(formatDue(at(2026, 9, 18, 23, 59), 'OPEN', NOW)).toEqual({
            label: 'Overdue · Oct 18',
            overdue: true,
        });
        expect(formatDue(at(2026, 9, 21, 15, 0), 'IN_PROGRESS', NOW).overdue).toBe(true);
        expect(formatDue(at(2025, 9, 18), 'OPEN', NOW).label).toBe('Overdue · Oct 18, 2025');
    });

    it('never marks a completed task overdue', () => {
        expect(formatDue(at(2026, 9, 18, 23, 59), 'COMPLETED', NOW)).toEqual({
            label: 'Oct 18',
            overdue: false,
        });
    });

    it('is not overdue later on the due day (due at end of day)', () => {
        expect(formatDue(at(2026, 9, 21, 23, 59), 'OPEN', NOW)).toEqual({
            label: 'Oct 21',
            overdue: false,
        });
    });
});
