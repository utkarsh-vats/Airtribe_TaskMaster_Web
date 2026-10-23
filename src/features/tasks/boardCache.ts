import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { TaskListItem, TaskStatus } from '@/lib/api/types';

/*
 * Board moves in the query cache (DESIGN.md §7). A card moving to another status leaves its
 * source column's cached page and goes to the top of the target column's, with both
 * meta.total values adjusted; a failed move puts both pages back exactly as they were.
 */

export type TaskPage = {
    items: TaskListItem[];
    meta: { page: number; limit: number; total: number; totalPages: number };
};

/** The cache keys of the column a card leaves and the column it joins. */
export type ColumnMove = { from: QueryKey; to: QueryKey };

/** Both columns' pages as they were before a move (undefined = not cached). */
export type ColumnSnapshot = [key: QueryKey, page: TaskPage | undefined][];

const totalPages = (total: number, limit: number) => Math.ceil(total / limit);

/**
 * Move `taskId` from `source` to the top of `target` with its status set to `status`. The
 * target keeps at most `limit` items (a full column drops its last card; it's still counted in
 * meta.total). Pages that aren't cached stay undefined; a task that isn't in `source` changes
 * nothing.
 */
export function moveCard(
    source: TaskPage | undefined,
    target: TaskPage | undefined,
    taskId: string,
    status: TaskStatus,
): { source: TaskPage | undefined; target: TaskPage | undefined } {
    const card = source?.items.find((item) => item.id === taskId);
    if (!source || !card) return { source, target };

    const sourceTotal = Math.max(0, source.meta.total - 1);
    const nextSource: TaskPage = {
        items: source.items.filter((item) => item.id !== taskId),
        meta: {
            ...source.meta,
            total: sourceTotal,
            totalPages: totalPages(sourceTotal, source.meta.limit),
        },
    };
    if (!target) return { source: nextSource, target };

    const targetTotal = target.meta.total + 1;
    const nextTarget: TaskPage = {
        items: [{ ...card, status }, ...target.items.filter((item) => item.id !== taskId)].slice(
            0,
            target.meta.limit,
        ),
        meta: {
            ...target.meta,
            total: targetTotal,
            totalPages: totalPages(targetTotal, target.meta.limit),
        },
    };
    return { source: nextSource, target: nextTarget };
}

/** Apply a move to the cached columns; returns what to restore if the update fails. */
export function moveInColumnCaches(
    queryClient: QueryClient,
    { from, to }: ColumnMove,
    taskId: string,
    status: TaskStatus,
): ColumnSnapshot {
    const source = queryClient.getQueryData<TaskPage>(from);
    const target = queryClient.getQueryData<TaskPage>(to);
    const next = moveCard(source, target, taskId, status);
    if (next.source) queryClient.setQueryData(from, next.source);
    if (next.target) queryClient.setQueryData(to, next.target);
    return [
        [from, source],
        [to, target],
    ];
}

/** Put both columns back exactly as they were. */
export function restoreColumnCaches(queryClient: QueryClient, snapshot: ColumnSnapshot) {
    for (const [key, page] of snapshot) {
        if (page) queryClient.setQueryData(key, page);
    }
}
