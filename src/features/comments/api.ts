'use client';

import {
    useInfiniteQuery,
    useMutation,
    useQueryClient,
    type InfiniteData,
    type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { adjustTaskCount } from '@/features/tasks/countCache';
import { api, unwrap, unwrapPage } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';
import type { Comment, PageMeta } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';
import { queryKeys, type TaskScope } from '@/lib/query/keys';

export const COMMENTS_PAGE_SIZE = 50;
export const COMMENT_ALREADY_DELETED_MESSAGE = 'That comment was already deleted.';

type CommentPage = { items: Comment[]; meta: PageMeta };
export type CommentThreadData = InfiniteData<CommentPage, number>;

/**
 * What every thread asks for: top-level comments only (replies hang off them, next step),
 * newest first. Part of the cache key, so pages cached under another order are never reused.
 */
const THREAD_QUERY = { parentId: 'none', order: 'desc', limit: COMMENTS_PAGE_SIZE } as const;

/** A thread's cache key: a task's comments, or the project-level ones ('none'). */
export const commentThreadKey = (projectId: string, taskId: TaskScope) =>
    queryKeys.comments.list(projectId, taskId, THREAD_QUERY);

const threadKeyOf = (projectId: string, comment: Pick<Comment, 'taskId'>) =>
    commentThreadKey(projectId, comment.taskId ?? 'none');

/**
 * One thread (GET /projects/{pid}/comments?taskId=…&parentId=none&order=desc): its top-level
 * comments, newest first, 50 a page. The next page holds older comments.
 */
export function useComments(projectId: string, taskId: TaskScope) {
    return useInfiniteQuery({
        queryKey: commentThreadKey(projectId, taskId),
        queryFn: ({ pageParam, signal }) =>
            unwrapPage(
                api.GET('/api/v1/projects/{projectId}/comments', {
                    params: {
                        path: { projectId },
                        query: { ...THREAD_QUERY, taskId, page: pageParam },
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

/** A comment shown before the server has it (posting): no actions until it's saved. */
export const isPendingComment = (comment: Pick<Comment, 'id'>) => comment.id.startsWith('pending-');

let pendingSeq = 0;
/** Saved comment id → the key it was shown under while pending. */
const pendingKeys = new Map<string, string>();

/**
 * A comment's React key: its id, or — once a comment posted here is saved — the key it had
 * while pending, so its row stays mounted instead of being replaced when the id changes.
 */
export const commentKey = (comment: Pick<Comment, 'id'>) =>
    pendingKeys.get(comment.id) ?? comment.id;

const hasComment = (data: CommentThreadData, id: string) =>
    data.pages.some((page) => page.items.some((c) => c.id === id));

/** `comment` at the top of the first page (the newest), meta.total up by one. */
function withAtTop(data: CommentThreadData, comment: Comment): CommentThreadData {
    return {
        ...data,
        pages: data.pages.map((page, index) => ({
            items: index === 0 ? [comment, ...page.items] : page.items,
            meta: { ...page.meta, total: page.meta.total + 1 },
        })),
    };
}

/** Without comment `id`, meta.total down by one (unchanged if it isn't there). */
function without(data: CommentThreadData, id: string): CommentThreadData {
    if (!hasComment(data, id)) return data;
    return {
        ...data,
        pages: data.pages.map((page) => ({
            items: page.items.filter((c) => c.id !== id),
            meta: { ...page.meta, total: Math.max(0, page.meta.total - 1) },
        })),
    };
}

/**
 * POST /projects/{pid}/comments ({ body, taskId? }) — a top-level comment. Optimistic: it shows
 * at once at the top of its thread (newest first) with meta.total up by one; the server's
 * comment replaces it, and an error takes it out again. On success the task's commentCount
 * goes up in the detail and any list row that carries it, and the thread is refetched. Errors
 * are left to the caller (the composer).
 */
export function useCreateComment(projectId: string) {
    const queryClient = useQueryClient();
    const { user } = useSession();

    return useMutation({
        mutationFn: ({ body, taskId }: NewComment) =>
            unwrap(
                api.POST('/api/v1/projects/{projectId}/comments', {
                    params: { path: { projectId } },
                    body: taskId ? { body, taskId } : { body },
                }),
            ),
        onMutate: async ({ body, taskId }) => {
            const key = commentThreadKey(projectId, taskId ?? 'none');
            // Don't let an in-flight refetch overwrite the optimistic comment.
            await queryClient.cancelQueries({ queryKey: key });
            pendingSeq += 1;
            const pending: Comment = {
                id: `pending-${pendingSeq}`,
                projectId,
                taskId,
                authorId: user?.id ?? '',
                parentId: null,
                body,
                editedAt: null,
                createdAt: new Date().toISOString(),
                author: { id: user?.id ?? '', name: user?.name ?? 'You' },
                replyCount: 0,
            };
            queryClient.setQueryData<CommentThreadData>(key, (data) =>
                data ? withAtTop(data, pending) : data,
            );
            return { key, pendingId: pending.id };
        },
        onError: (_error, _comment, context) => {
            if (!context) return;
            queryClient.setQueryData<CommentThreadData>(context.key, (data) =>
                data ? without(data, context.pendingId) : data,
            );
        },
        onSuccess: (comment, { taskId }, { key, pendingId }) => {
            pendingKeys.set(comment.id, pendingId);
            queryClient.setQueryData<CommentThreadData>(key, (data) => {
                if (!data) return data;
                const pendingShown = hasComment(data, pendingId);
                // A refetch may already have brought the saved one (or dropped the pending one).
                if (hasComment(data, comment.id))
                    return pendingShown ? without(data, pendingId) : data;
                if (!pendingShown) return withAtTop(data, comment);
                return {
                    ...data,
                    pages: data.pages.map((page) => ({
                        ...page,
                        items: page.items.map((c) => (c.id === pendingId ? comment : c)),
                    })),
                };
            });
            adjustTaskCount(queryClient, projectId, taskId, 'commentCount', 1);
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
                removed = hasComment(data, comment.id);
                return without(data, comment.id);
            });
            // Counted once: a comment already missing from the cache was counted out before.
            if (removed)
                adjustTaskCount(queryClient, projectId, comment.taskId, 'commentCount', -1);
            if (alreadyDeleted) toast(COMMENT_ALREADY_DELETED_MESSAGE);
            void queryClient.invalidateQueries({ queryKey: key });
        },
        onError: (error) => notifyError(error),
    });
}
