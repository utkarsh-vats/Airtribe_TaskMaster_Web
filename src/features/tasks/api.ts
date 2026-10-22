'use client';

import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';

import { api, unwrapPage } from '@/lib/api/client';
import type { TaskStatus } from '@/lib/api/types';
import { TASK_STATUSES } from '@/lib/domain';
import { queryKeys } from '@/lib/query/keys';

import { toQueryParams, type TaskFilters } from './filters';

export const TASKS_PAGE_SIZE = 25;

function fetchTasks(projectId: string, query: Record<string, unknown>, signal: AbortSignal) {
    return unwrapPage(
        api.GET('/api/v1/projects/{projectId}/tasks', {
            params: { path: { projectId }, query },
            signal,
        }),
    );
}

/**
 * A project's tasks (GET /projects/{id}/tasks) for the given filters, in the API's default
 * order. While another page or filter loads, the previous result stays on screen.
 */
export function useTasks(projectId: string, filters: TaskFilters, limit = TASKS_PAGE_SIZE) {
    const query = { ...toQueryParams(filters), page: filters.page, limit };
    return useQuery({
        queryKey: queryKeys.tasks.list(projectId, query),
        queryFn: ({ signal }) => fetchTasks(projectId, query, signal),
        placeholderData: keepPreviousData,
    });
}

export type StatusCounts = Record<'ALL' | TaskStatus, number | undefined>;

/**
 * Counts for the status segmented control: four `limit=1` requests with the current filters
 * except status, reading meta.total (DESIGN.md §5). Undefined while loading.
 */
export function useTaskStatusCounts(projectId: string, filters: TaskFilters): StatusCounts {
    // Every filter but status; sort/order don't change a count, so they don't split the cache.
    const {
        sort: _sort,
        order: _order,
        ...base
    } = toQueryParams({ ...filters, status: undefined });
    const variants: ('ALL' | TaskStatus)[] = ['ALL', ...TASK_STATUSES];
    const results = useQueries({
        queries: variants.map((variant) => {
            const query = {
                ...base,
                ...(variant === 'ALL' ? {} : { status: [variant] }),
                limit: 1,
            };
            return {
                queryKey: queryKeys.tasks.list(projectId, query),
                queryFn: ({ signal }: { signal: AbortSignal }) =>
                    fetchTasks(projectId, query, signal),
                select: (page: Awaited<ReturnType<typeof fetchTasks>>) => page.meta.total,
            };
        }),
    });
    return Object.fromEntries(
        variants.map((variant, i) => [variant, results[i]?.data]),
    ) as StatusCounts;
}
