import { z } from 'zod';

import type { TaskPriority, TaskStatus } from '@/lib/api/types';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/domain';

/*
 * Task list filters in the URL (DESIGN.md §4, §5, §7 "Task list query"). Parsing never throws:
 * an invalid or unknown value is dropped on its own, so a hand-edited or stale link still shows
 * a sensible list. Shared by a project's task list and My tasks.
 */

export const TASK_SORTS = ['dueDate', 'createdAt', 'updatedAt', 'priority', 'title'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

/** The API's sort when none is given, and each field's direction when `order` is omitted. */
export const DEFAULT_SORT: TaskSort = 'createdAt';
export const DEFAULT_ORDER: Record<TaskSort, SortOrder> = {
    dueDate: 'asc',
    createdAt: 'desc',
    updatedAt: 'desc',
    priority: 'desc',
    title: 'asc',
};

export type TaskFilters = {
    /** Canonical order, no duplicates. Absent = all. */
    status?: TaskStatus[];
    q?: string;
    /** Urgent → Low order, no duplicates. */
    priority?: TaskPriority[];
    /** 'me', 'unassigned' or a user id. */
    assignee?: string;
    /** 'me' or a user id. */
    createdBy?: string;
    /** Inclusive local dates, YYYY-MM-DD. */
    dueFrom?: string;
    dueTo?: string;
    overdue?: true;
    sort?: TaskSort;
    /** Absent = the sort field's default direction. */
    order?: SortOrder;
    page: number;
};

/** Every filter param, in the order they're written to the URL. */
export const FILTER_PARAMS = [
    'status',
    'q',
    'priority',
    'assignee',
    'createdBy',
    'dueFrom',
    'dueTo',
    'overdue',
    'sort',
    'order',
    'page',
] as const;

type ParamSource = { get(name: string): string | null; getAll(name: string): string[] };

const qSchema = z.string().trim().min(1).max(200);
const pageSchema = z.coerce.number().int().positive();
const userIdSchema = z.uuid();
const sortSchema = z.enum(TASK_SORTS);
const orderSchema = z.enum(['asc', 'desc']);
const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Comma lists and repeated keys; unknown values ignored; result in `order`, deduplicated. */
function parseList<T extends string>(params: ParamSource, name: string, order: readonly T[]) {
    const seen = new Set(
        params
            .getAll(name)
            .flatMap((raw) => raw.split(','))
            .map((value) => value.trim()),
    );
    const list = order.filter((value) => seen.has(value));
    return list.length ? list : undefined;
}

/** A real calendar day in YYYY-MM-DD (rejects 2026-02-31). */
function parseDay(raw: string | null): string | undefined {
    const match = raw ? isoDay.exec(raw) : null;
    if (!match) return undefined;
    const [, y, m, d] = match.map(Number) as [number, number, number, number];
    const date = new Date(y, m - 1, d);
    const valid = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    return valid ? (raw ?? undefined) : undefined;
}

function parseUser(raw: string | null, allowUnassigned: boolean): string | undefined {
    if (!raw) return undefined;
    if (raw === 'me' || (allowUnassigned && raw === 'unassigned')) return raw;
    return userIdSchema.safeParse(raw).success ? raw : undefined;
}

export function parseTaskFilters(params: ParamSource): TaskFilters {
    const filters: TaskFilters = { page: 1 };

    const status = parseList(params, 'status', TASK_STATUSES);
    if (status) filters.status = status;

    const q = qSchema.safeParse(params.get('q') ?? '');
    if (q.success) filters.q = q.data;

    const priority = parseList(params, 'priority', TASK_PRIORITIES);
    if (priority) filters.priority = priority;

    const assignee = parseUser(params.get('assignee'), true);
    if (assignee) filters.assignee = assignee;

    const createdBy = parseUser(params.get('createdBy'), false);
    if (createdBy) filters.createdBy = createdBy;

    const dueFrom = parseDay(params.get('dueFrom'));
    const dueTo = parseDay(params.get('dueTo'));
    // An impossible range is dropped entirely rather than half-applied.
    if (!(dueFrom && dueTo && dueFrom > dueTo)) {
        if (dueFrom) filters.dueFrom = dueFrom;
        if (dueTo) filters.dueTo = dueTo;
    }

    if (params.get('overdue') === 'true') filters.overdue = true;

    const sort = sortSchema.safeParse(params.get('sort'));
    if (sort.success) filters.sort = sort.data;

    const order = orderSchema.safeParse(params.get('order'));
    if (order.success) filters.order = order.data;

    const page = pageSchema.safeParse(params.get('page') ?? undefined);
    if (page.success) filters.page = page.data;

    return filters;
}

/** Whether anything narrows the list (sort and page don't). */
export const hasActiveFilters = (filters: TaskFilters) =>
    Boolean(
        filters.status?.length ||
        filters.q ||
        filters.priority?.length ||
        filters.assignee ||
        filters.createdBy ||
        filters.dueFrom ||
        filters.dueTo ||
        filters.overdue,
    );

/** Whether "Clear filters" has anything to clear: any filter, or a non-default sort. */
export const hasAnyListParams = (filters: TaskFilters) =>
    hasActiveFilters(filters) || Boolean(filters.sort || filters.order);

/** Active filters in the filter bar (what the mobile "Filters" badge counts). */
export function countBarFilters(filters: TaskFilters): number {
    return [
        filters.priority?.length,
        filters.assignee,
        filters.createdBy,
        filters.dueFrom || filters.dueTo,
        filters.overdue,
    ].filter(Boolean).length;
}

/** The direction actually in effect: the explicit order, else the field's default. */
export const effectiveOrder = (filters: Pick<TaskFilters, 'sort' | 'order'>): SortOrder =>
    filters.order ?? DEFAULT_ORDER[filters.sort ?? DEFAULT_SORT];

/**
 * Apply changes to the current filters, dropping cleared ones. Changing anything but the page
 * goes back to page 1.
 */
export function updateFilters(current: TaskFilters, changes: Partial<TaskFilters>): TaskFilters {
    const m: TaskFilters = { ...current, ...changes };
    const next: TaskFilters = { page: 'page' in changes ? m.page : 1 };
    if (m.status?.length) next.status = m.status;
    if (m.q) next.q = m.q;
    if (m.priority?.length) next.priority = m.priority;
    if (m.assignee) next.assignee = m.assignee;
    if (m.createdBy) next.createdBy = m.createdBy;
    if (m.dueFrom) next.dueFrom = m.dueFrom;
    if (m.dueTo) next.dueTo = m.dueTo;
    if (m.overdue) next.overdue = true;
    if (m.sort) next.sort = m.sort;
    if (m.order) next.order = m.order;
    return next;
}

/** Local midnight of a YYYY-MM-DD day, `offsetDays` later. */
function startOfDay(day: string, offsetDays = 0): Date {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d + offsetDays);
}

/**
 * The API's query object (GET …/tasks), without paging. The inclusive local days in the URL
 * become the API's exclusive instants in the user's time zone:
 *   dueFrom D → dueAfter = start of D − 1 ms;   dueTo D → dueBefore = start of D + 1 day.
 */
export function toQueryParams(filters: Partial<TaskFilters>) {
    return {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.priority ? { priority: filters.priority } : {}),
        ...(filters.assignee ? { assignee: filters.assignee } : {}),
        ...(filters.createdBy ? { createdBy: filters.createdBy } : {}),
        ...(filters.dueFrom
            ? { dueAfter: new Date(startOfDay(filters.dueFrom).getTime() - 1).toISOString() }
            : {}),
        ...(filters.dueTo ? { dueBefore: startOfDay(filters.dueTo, 1).toISOString() } : {}),
        ...(filters.overdue ? { overdue: 'true' as const } : {}),
        ...(filters.sort ? { sort: filters.sort } : {}),
        ...(filters.order ? { order: filters.order } : {}),
    };
}

/**
 * ?column=<status>: the board column the New task dialog adds to (8c). Not a filter — it's
 * kept as it is by filtersToSearch and removed together with ?new. Absent or junk → OPEN.
 */
export function parseNewTaskColumn(params: { get(name: string): string | null }): TaskStatus {
    const column = params.get('column');
    return TASK_STATUSES.find((status) => status === column) ?? 'OPEN';
}

/**
 * URL search string for `filters`: filter params in FILTER_PARAMS order (equal filters give
 * equal URLs; page 1 omitted), then every other param (task, new, column, view, …) as it was.
 */
export function filtersToSearch(
    filters: TaskFilters,
    current: ParamSource & Iterable<[string, string]>,
) {
    const params = new URLSearchParams();
    if (filters.status?.length) params.set('status', filters.status.join(','));
    if (filters.q) params.set('q', filters.q);
    if (filters.priority?.length) params.set('priority', filters.priority.join(','));
    if (filters.assignee) params.set('assignee', filters.assignee);
    if (filters.createdBy) params.set('createdBy', filters.createdBy);
    if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
    if (filters.dueTo) params.set('dueTo', filters.dueTo);
    if (filters.overdue) params.set('overdue', 'true');
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.order) params.set('order', filters.order);
    if (filters.page > 1) params.set('page', String(filters.page));
    for (const [key, value] of current) {
        if (!(FILTER_PARAMS as readonly string[]).includes(key)) params.append(key, value);
    }
    return params.toString();
}
