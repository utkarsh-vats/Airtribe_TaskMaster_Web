import { z } from 'zod';

import type { TaskStatus } from '@/lib/api/types';
import { TASK_STATUSES } from '@/lib/domain';

/*
 * Task list filters in the URL (DESIGN.md §4, §5). Parsing never throws: an invalid or unknown
 * value is dropped on its own, so a hand-edited or stale link still shows a sensible list.
 * Shared by a project's task list and My tasks; step 6c adds more fields.
 */

export type TaskFilters = {
    /** Canonical order, no duplicates. Absent = all statuses. */
    status?: TaskStatus[];
    q?: string;
    page: number;
};

/** The filter params, in the order they're written to the URL. */
export const FILTER_PARAMS = ['status', 'q', 'page'] as const;

type ParamSource = { get(name: string): string | null; getAll(name: string): string[] };

const statusSchema = z.enum(TASK_STATUSES);
const qSchema = z.string().trim().min(1).max(200);
const pageSchema = z.coerce.number().int().positive();

/** `status=OPEN,IN_PROGRESS` or repeated `status=` keys; unknown values ignored. */
function parseStatus(params: ParamSource): TaskStatus[] | undefined {
    const values = new Set(
        params
            .getAll('status')
            .flatMap((raw) => raw.split(','))
            .map((value) => statusSchema.safeParse(value.trim()))
            .flatMap((result) => (result.success ? [result.data] : [])),
    );
    const status = TASK_STATUSES.filter((value) => values.has(value));
    return status.length ? status : undefined;
}

export function parseTaskFilters(params: ParamSource): TaskFilters {
    const filters: TaskFilters = { page: 1 };

    const status = parseStatus(params);
    if (status) filters.status = status;

    const q = qSchema.safeParse(params.get('q') ?? '');
    if (q.success) filters.q = q.data;

    const page = pageSchema.safeParse(params.get('page') ?? undefined);
    if (page.success) filters.page = page.data;

    return filters;
}

/** Whether anything narrows the list (page doesn't). */
export const hasActiveFilters = (filters: TaskFilters) =>
    Boolean(filters.status?.length || filters.q);

/**
 * Apply changes to the current filters. Changing any filter goes back to page 1; only an
 * explicit `page` change keeps (sets) the page.
 */
export function updateFilters(current: TaskFilters, changes: Partial<TaskFilters>): TaskFilters {
    const merged: TaskFilters = { ...current, ...changes };
    const next: TaskFilters = { page: 'page' in changes ? merged.page : 1 };
    if (merged.status?.length) next.status = merged.status;
    if (merged.q) next.q = merged.q;
    return next;
}

/** The API's query object (GET …/tasks), without paging. */
export function toQueryParams(filters: Omit<TaskFilters, 'page'> & { page?: number }) {
    return {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.q ? { q: filters.q } : {}),
    };
}

/**
 * URL search string for `filters`, keeping every non-filter param (task, new, view, …) after
 * them in its current order. Filters always come out in the same order, so equal filters give
 * equal URLs; page 1 is omitted.
 */
export function filtersToSearch(
    filters: TaskFilters,
    current: ParamSource & Iterable<[string, string]>,
) {
    const params = new URLSearchParams();
    if (filters.status?.length) params.set('status', filters.status.join(','));
    if (filters.q) params.set('q', filters.q);
    if (filters.page > 1) params.set('page', String(filters.page));
    for (const [key, value] of current) {
        if (!(FILTER_PARAMS as readonly string[]).includes(key)) params.append(key, value);
    }
    return params.toString();
}
