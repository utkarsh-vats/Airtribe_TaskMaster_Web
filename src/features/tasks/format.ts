import type { TaskStatus } from '@/lib/api/types';
import { shortDate } from '@/lib/format/dates';

export type DueLabel = { label: string; overdue: boolean };

/**
 * Due date for lists (DESIGN.md §5): "No date", "Oct 18" (year added outside the current
 * year), or "Overdue · Oct 18" when it has passed and the task isn't done. A completed task is
 * never overdue.
 */
export function formatDue(
    dueDate: string | null,
    status: TaskStatus,
    now: Date = new Date(),
): DueLabel {
    if (!dueDate) return { label: 'No date', overdue: false };
    const date = shortDate(dueDate, now);
    const overdue = status !== 'COMPLETED' && new Date(dueDate).getTime() < now.getTime();
    return { label: overdue ? `Overdue · ${date}` : date, overdue };
}
