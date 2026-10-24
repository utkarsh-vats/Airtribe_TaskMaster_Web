'use client';

import {
    useInfiniteQuery,
    useMutation,
    useQueryClient,
    type InfiniteData,
} from '@tanstack/react-query';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import type { Comment, PageMeta } from '@/lib/api/types';
import { queryKeys, type TaskScope } from '@/lib/query/keys';

export const COMMENTS_PAGE_SIZE = 50;

type CommentPage = { items: Comment[]; meta: PageMeta };
export type CommentThreadData = InfiniteData<CommentPage, number>;

/** A thread's cache key: a task's comments, or the project-level ones ('none'). */
export const commentThreadKey = (projectId: string, taskId: TaskScope) =>
    queryKeys.comments.list(projectId, taskId, { limit: COMMENTS_PAGE_SIZE });

/**
 * One thread (GET /projects/{pid}/comments?taskId=…), oldest first as the API returns it, 50 a
 * page. "Load more" fetches the next page, whose (newer) comments go at the bottom.
 */
export function useComments(projectId: string, taskId: TaskScope) {
    return useInfiniteQuery({
        queryKey: commentThreadKey(projectId, taskId),
        queryFn: ({ pageParam, signal }) =>
            unwrapPage(
                api.GET('/api/v1/projects/{projectId}/comments', {
                    params: {
                        path: { projectId },
                        query: { taskId, page: pageParam, limit: COMMENTS_PAGE_SIZE },
                    },
                    signal,
                }),
            ),
        initialPageParam: 1,
        getNextPageParam: (last: CommentPage) =>
            last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    });
}

export type NewComment = { body: string; taskId: string | null };

/** Rows in a cached task list or detail. */
type Row = Record<string, unknown> & { id: string };
const hasItems = (data: unknown): data is { items: Row[] } =>
    typeof data === 'object' && data !== null && 'items' in data && Array.isArray(data.items);
const withCount = (row: Row): Row =>
    typeof row.commentCount === 'number' ? { ...row, commentCount: row.commentCount + 1 } : row;

/**
 * POST /projects/{pid}/comments ({ body, taskId? }). On success the comment goes at the end of
 * its thread's cache — when every page is loaded; otherwise it's on a page "Load more" will
 * fetch — the task's commentCount goes up in the detail and any list row that carries it, and
 * the thread is refetched. Errors are left to the caller (the composer).
 */
export function useCreateComment(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ body, taskId }: NewComment) =>
            unwrap(
                api.POST('/api/v1/projects/{projectId}/comments', {
                    params: { path: { projectId } },
                    body: taskId ? { body, taskId } : { body },
                }),
            ),
        onSuccess: (comment, { taskId }) => {
            const key = commentThreadKey(projectId, taskId ?? 'none');
            queryClient.setQueryData<CommentThreadData>(key, (data) => {
                if (!data) return data;
                const last = data.pages.at(-1);
                const complete = !last || last.meta.page >= last.meta.totalPages;
                const seen = data.pages.some((p) => p.items.some((c) => c.id === comment.id));
                return {
                    ...data,
                    pages: data.pages.map((page, index) => ({
                        items:
                            complete && !seen && index === data.pages.length - 1
                                ? [...page.items, comment]
                                : page.items,
                        meta: { ...page.meta, total: page.meta.total + (seen ? 0 : 1) },
                    })),
                };
            });

            if (taskId) {
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

            void queryClient.invalidateQueries({ queryKey: key });
        },
    });
}
