'use client';

import {
    keepPreviousData,
    useMutation,
    useQueries,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import { ERROR_CODES, hasCode, isApiError } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';
import type { Task, TaskListItem, TaskPriority, TaskStatus } from '@/lib/api/types';
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

/** One field's change: PATCH sends exactly this. */
export type TaskPatch =
    | { title: string }
    | { description: string | null }
    | { status: TaskStatus }
    | { priority: TaskPriority }
    | { assigneeId: string | null }
    | { dueDate: string | null };

export type TaskUpdate = {
    patch: TaskPatch;
    /** For assigneeId: the person to show until the server answers (null = Unassigned). */
    assignee?: { id: string; name: string } | null;
};

export const TASK_STATUS_CONFLICT_MESSAGE = "Someone else changed this task's status — refreshed.";

type Row = Record<string, unknown> & { id: string };

/** The cached-object fields a patch touches (assigneeId shows up as `assignee`). */
function patchedFields({ patch, assignee }: TaskUpdate): Record<string, unknown> {
    if ('assigneeId' in patch) return { assignee: assignee ?? null };
    return { ...patch };
}

/** Rows in a cached page or list that belong to this task. */
const hasItems = (data: unknown): data is { items: Row[] } =>
    typeof data === 'object' && data !== null && 'items' in data && Array.isArray(data.items);

/**
 * Edit one field of a task (PATCH /projects/{pid}/tasks/{tid}, DESIGN.md §7).
 *   - Optimistic: the detail and every cached list row (project lists, My tasks) change at once.
 *   - Rollback restores only the fields this update touched, so a failed title save can't undo
 *     a status change made meanwhile.
 *   - 409 (the API's concurrent-status check) → toast + refetch the detail; 422 → rejected to
 *     the caller, which shows the message under the field; anything else → error toast.
 *   - Afterwards the project's lists and status counts, and My tasks, are refetched.
 */
export function useUpdateTask(projectId: string, taskId: string) {
    const queryClient = useQueryClient();
    const detailKey = queryKeys.tasks.detail(projectId, taskId);

    /** Merge `fields` into the detail and every list row of this task; return the old values. */
    const apply = (fields: Record<string, unknown>) => {
        const previous: { key: readonly unknown[]; values: Record<string, unknown> }[] = [];
        const pick = (row: Row) =>
            Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]));

        const detail = queryClient.getQueryData<Row>(detailKey);
        if (detail) {
            previous.push({ key: detailKey, values: pick(detail) });
            queryClient.setQueryData<Row>(detailKey, { ...detail, ...fields });
        }
        for (const [key, data] of queryClient.getQueriesData({
            queryKey: queryKeys.tasks.root(),
        })) {
            if (!hasItems(data)) continue;
            const row = data.items.find((item) => item.id === taskId);
            if (!row) continue;
            previous.push({ key, values: pick(row) });
            queryClient.setQueryData(key, {
                ...data,
                items: data.items.map((item) =>
                    item.id === taskId ? { ...item, ...fields } : item,
                ),
            });
        }
        return previous;
    };

    /** Put back the old values of just these fields. */
    const restore = (previous: { key: readonly unknown[]; values: Record<string, unknown> }[]) => {
        for (const { key, values } of previous) {
            queryClient.setQueryData<unknown>(key, (data: unknown) => {
                if (hasItems(data)) {
                    return {
                        ...data,
                        items: data.items.map((item) =>
                            item.id === taskId ? { ...item, ...values } : item,
                        ),
                    };
                }
                return typeof data === 'object' && data !== null ? { ...data, ...values } : data;
            });
        }
    };

    return useMutation({
        mutationFn: ({ patch }: TaskUpdate) =>
            unwrap(
                api.PATCH('/api/v1/projects/{projectId}/tasks/{taskId}', {
                    params: { path: { projectId, taskId } },
                    body: patch,
                }),
            ),
        onMutate: async (update) => {
            // Don't let an in-flight refetch overwrite the optimistic values.
            await queryClient.cancelQueries({ queryKey: queryKeys.tasks.root() });
            return { previous: apply(patchedFields(update)) };
        },
        onError: (error, _update, context) => {
            if (context) restore(context.previous);
            if (isApiError(error) && error.status === 409) {
                toast(TASK_STATUS_CONFLICT_MESSAGE);
                void queryClient.invalidateQueries({ queryKey: detailKey });
                return;
            }
            if (hasCode(error, ERROR_CODES.VALIDATION_ERROR)) return; // the field shows it
            notifyError(error);
        },
        onSuccess: (task) => {
            // The server's version wins (completedAt, updatedAt, …).
            queryClient.setQueryData(detailKey, task);
            apply({
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                dueDate: task.dueDate,
                completedAt: task.completedAt,
                updatedAt: task.updatedAt,
                assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
            });
        },
        onSettled: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) }),
                queryClient.invalidateQueries({ queryKey: [...queryKeys.tasks.root(), 'mine'] }),
            ]),
    });
}
