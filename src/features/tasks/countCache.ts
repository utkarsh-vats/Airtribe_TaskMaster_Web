import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/keys';

/** Rows in a cached task list or detail. */
type Row = Record<string, unknown> & { id: string };
const hasItems = (data: unknown): data is { items: Row[] } =>
    typeof data === 'object' && data !== null && 'items' in data && Array.isArray(data.items);

/**
 * Add `delta` to a task's commentCount or attachmentCount in its cached detail and any cached
 * list row that carries it (after a comment or file is added or deleted). Never below 0.
 */
export function adjustTaskCount(
    queryClient: QueryClient,
    projectId: string,
    taskId: string | null,
    field: 'commentCount' | 'attachmentCount',
    delta: number,
) {
    if (!taskId) return;
    const withCount = (row: Row): Row => {
        const count = row[field];
        return typeof count === 'number' ? { ...row, [field]: Math.max(0, count + delta) } : row;
    };
    const detailKey = queryKeys.tasks.detail(projectId, taskId);
    const detail = queryClient.getQueryData<Row>(detailKey);
    if (detail) queryClient.setQueryData(detailKey, withCount(detail));
    for (const [listKey, data] of queryClient.getQueriesData({
        queryKey: queryKeys.tasks.root(),
    })) {
        if (!hasItems(data) || !data.items.some((row) => row.id === taskId)) continue;
        queryClient.setQueryData(listKey, {
            ...data,
            items: data.items.map((row) => (row.id === taskId ? withCount(row) : row)),
        });
    }
}
