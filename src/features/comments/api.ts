'use client';

import {
    useInfiniteQuery,
    useMutation,
    useQueryClient,
    type InfiniteData,
    type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';
import type { Comment, PageMeta } from '@/lib/api/types';
import { queryKeys, type TaskScope } from '@/lib/query/keys';

export const COMMENTS_PAGE_SIZE = 50;
export const COMMENT_ALREADY_DELETED_MESSAGE = 'That comment was already deleted.';

type CommentPage = { items: Comment[]; meta: PageMeta };
export type CommentThreadData = InfiniteData<CommentPage, number>;

/** A thread's cache key: a task's comments, or the project-level ones ('none'). */
export const commentThreadKey = (projectId: string, taskId: TaskScope) =>
    queryKeys.comments.list(projectId, taskId, { limit: COMMENTS_PAGE_SIZE });

const threadKeyOf = (projectId: string, comment: Pick<Comment, 'taskId'>) =>
    commentThreadKey(projectId, comment.taskId ?? 'none');

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

/** Add `delta` to a task's commentCount in its detail and any cached list row that carries it. */
function adjustCommentCount(
    queryClient: QueryClient,
    projectId: string,
    taskId: string | null,
    delta: number,
) {
    if (!taskId) return;
    const withCount = (row: Row): Row =>
        typeof row.commentCount === 'number'
            ? { ...row, commentCount: Math.max(0, row.commentCount + delta) }
            : row;
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

/** Replace one comment's fields in its thread's cache. */
function patchInThread(
    queryClient: QueryClient,
    projectId: string,
    comment: Comment,
    fields: Partial<Comment>,
) {
    queryClient.setQueryData<CommentThreadData>(threadKeyOf(projectId, comment), (data) =>
        data
            ? {
                  ...data,
                  pages: data.pages.map((page) => ({
                      ...page,
                      items: page.items.map((item) =>
                          item.id === comment.id ? { ...item, ...fields } : item,
                      ),
                  })),
              }
            : data,
    );
}

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
            adjustCommentCount(queryClient, projectId, taskId, 1);
            void queryClient.invalidateQueries({ queryKey: key });
        },
    });
}

export type CommentEdit = { comment: Comment; body: string };

/**
 * PATCH /projects/{pid}/comments/{cid} ({ body }), author only. Optimistic: the new body shows
 * at once; the server's comment (with editedAt) replaces it, and an error puts the old body
 * back. Errors are left to the caller (a 422 belongs under the editor).
 */
export function useUpdateComment(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ comment, body }: CommentEdit) =>
            unwrap(
                api.PATCH('/api/v1/projects/{projectId}/comments/{commentId}', {
                    params: { path: { projectId, commentId: comment.id } },
                    body: { body },
                }),
            ),
        onMutate: async ({ comment, body }) => {
            // Don't let an in-flight refetch overwrite the optimistic body.
            await queryClient.cancelQueries({ queryKey: threadKeyOf(projectId, comment) });
            patchInThread(queryClient, projectId, comment, { body });
        },
        onError: (_error, { comment }) => {
            patchInThread(queryClient, projectId, comment, {
                body: comment.body,
                editedAt: comment.editedAt,
            });
        },
        onSuccess: (saved, { comment }) => patchInThread(queryClient, projectId, comment, saved),
    });
}

/**
 * DELETE /projects/{pid}/comments/{cid}, author or ADMIN+. Not optimistic. On success — or a
 * 404, meaning it was already gone ("That comment was already deleted.") — it leaves its
 * thread's cache (meta.total too), the task's commentCount goes down, and the thread is
 * refetched. Other errors toast and reject, so a confirm dialog can stay open for a retry.
 */
export function useDeleteComment(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (comment: Comment): Promise<{ alreadyDeleted: boolean }> => {
            try {
                await unwrap(
                    api.DELETE('/api/v1/projects/{projectId}/comments/{commentId}', {
                        params: { path: { projectId, commentId: comment.id } },
                    }),
                );
                return { alreadyDeleted: false };
            } catch (error) {
                if (isApiError(error) && error.status === 404) return { alreadyDeleted: true };
                throw error;
            }
        },
        onSuccess: ({ alreadyDeleted }, comment) => {
            const key = threadKeyOf(projectId, comment);
            let removed = false;
            queryClient.setQueryData<CommentThreadData>(key, (data) => {
                if (!data) return data;
                removed = data.pages.some((page) => page.items.some((c) => c.id === comment.id));
                if (!removed) return data;
                return {
                    ...data,
                    pages: data.pages.map((page) => ({
                        items: page.items.filter((c) => c.id !== comment.id),
                        meta: { ...page.meta, total: Math.max(0, page.meta.total - 1) },
                    })),
                };
            });
            // Counted once: a comment already missing from the cache was counted out before.
            if (removed) adjustCommentCount(queryClient, projectId, comment.taskId, -1);
            if (alreadyDeleted) toast(COMMENT_ALREADY_DELETED_MESSAGE);
            void queryClient.invalidateQueries({ queryKey: key });
        },
        onError: (error) => notifyError(error),
    });
}
