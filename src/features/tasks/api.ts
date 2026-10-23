'use client';

import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import type { Task, TaskListItem, TaskStatus } from '@/lib/api/types';
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

/** What the panel can show: the full task, or a list row standing in while it loads. */
export type TaskView = Task | TaskListItem;

/** Whether the detail-only fields (counts, contact details) are there. */
export const isFullTask = (task: TaskView): task is Task => 'commentCount' in task;

/** A row for this task in any cached task list (project lists, My tasks). */
function findCachedRow(
    queries: [readonly unknown[], unknown][],
    taskId: string,
): TaskListItem | undefined {
    for (const [, data] of queries) {
        if (typeof data !== 'object' || data === null || !('items' in data)) continue;
        const items = (data as { items: TaskListItem[] }).items;
        const row = items.find((item) => item.id === taskId);
        if (row) return row;
    }
    return undefined;
}

/**
 * One task (GET /projects/{pid}/tasks/{tid}). While it loads, a matching row from any cached
 * list stands in, so the panel shows the title and status at once.
 */
export function useTask(projectId: string, taskId: string) {
    const queryClient = useQueryClient();
    return useQuery<TaskView>({
        queryKey: queryKeys.tasks.detail(projectId, taskId),
        queryFn: ({ signal }) =>
            unwrap(
                api.GET('/api/v1/projects/{projectId}/tasks/{taskId}', {
                    params: { path: { projectId, taskId } },
                    signal,
                }),
            ),
        placeholderData: () =>
            findCachedRow(queryClient.getQueriesData({ queryKey: queryKeys.tasks.root() }), taskId),
    });
}
