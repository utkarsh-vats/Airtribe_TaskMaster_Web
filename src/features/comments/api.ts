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
import { errorMessage } from '@/lib/api/messages';
import { notifyError } from '@/lib/api/notify';
import type { Comment, PageMeta } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';
import { queryKeys, type TaskScope } from '@/lib/query/keys';

export const COMMENTS_PAGE_SIZE = 50;
export const REPLIES_PAGE_SIZE = 20;
export const COMMENT_ALREADY_DELETED_MESSAGE = 'That comment was already deleted.';
export const PARENT_DELETED_MESSAGE = 'That comment was deleted';

type CommentPage = { items: Comment[]; meta: PageMeta };
export type CommentThreadData = InfiniteData<CommentPage, number>;

/**
 * What every thread asks for: top-level comments only (replies hang off them), newest first.
 * Part of the cache key, so pages cached under another order are never reused.
 */
const THREAD_QUERY = { parentId: 'none', order: 'desc', limit: COMMENTS_PAGE_SIZE } as const;

/** A thread's cache key: a task's comments, or the project-level ones ('none'). */
export const commentThreadKey = (projectId: string, taskId: TaskScope) =>
    queryKeys.comments.list(projectId, taskId, THREAD_QUERY);

const threadKeyOf = (projectId: string, comment: Pick<Comment, 'taskId'>) =>
    commentThreadKey(projectId, comment.taskId ?? 'none');

/** Replies, oldest first, 20 a page (part of the cache key, like the thread's query). */
const REPLIES_QUERY = { order: 'asc', limit: REPLIES_PAGE_SIZE } as const;

/** A top-level comment's replies. */
export const repliesKey = (projectId: string, commentId: string) =>
    queryKeys.comments.replies(projectId, commentId, REPLIES_QUERY);

/** The list a comment lives in: its parent's replies, or its thread for a top-level one. */
const listKeyOf = (projectId: string, comment: Pick<Comment, 'taskId' | 'parentId'>) =>
    comment.parentId ? repliesKey(projectId, comment.parentId) : threadKeyOf(projectId, comment);

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

/**
 * A top-level comment's replies (GET /projects/{pid}/comments/{cid}/replies), oldest first, 20
 * a page; the next page holds newer ones. `enabled` false until they're first shown.
 */
export function useReplies(
    projectId: string,
    commentId: string,
    { enabled }: { enabled: boolean },
) {
    return useInfiniteQuery({
        queryKey: repliesKey(projectId, commentId),
        queryFn: ({ pageParam, signal }) =>
            unwrapPage(
                api.GET('/api/v1/projects/{projectId}/comments/{commentId}/replies', {
                    params: {
                        path: { projectId, commentId },
                        query: { ...REPLIES_QUERY, page: pageParam },
                    },
                    signal,
                }),
            ),
        initialPageParam: 1,
        getNextPageParam: (last: CommentPage) =>
            last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
        enabled,
    });
}

export type NewComment = { body: string; taskId: string | null };

/** Replace one comment's fields in its list's cache (its thread, or its parent's replies). */
function patchInThread(
    queryClient: QueryClient,
    projectId: string,
    comment: Pick<Comment, 'id' | 'taskId' | 'parentId'>,
    fields: Partial<Comment>,
) {
    queryClient.setQueryData<CommentThreadData>(listKeyOf(projectId, comment), (data) =>
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

/** `comment` at the end of the last page (replies are oldest first), meta.total up by one. */
function withAtEnd(data: CommentThreadData, comment: Comment): CommentThreadData {
    const last = data.pages.length - 1;
    return {
        ...data,
        pages: data.pages.map((page, index) => ({
            items: index === last ? [...page.items, comment] : page.items,
            meta: { ...page.meta, total: page.meta.total + 1 },
        })),
    };
}

/** Add `delta` to a top-level comment's replyCount in its thread's cache. */
function adjustReplyCount(
    queryClient: QueryClient,
    projectId: string,
    reply: Pick<Comment, 'taskId' | 'parentId'>,
    delta: number,
) {
    if (!reply.parentId) return;
    const parentId = reply.parentId;
    queryClient.setQueryData<CommentThreadData>(threadKeyOf(projectId, reply), (data) =>
        data
            ? {
                  ...data,
                  pages: data.pages.map((page) => ({
                      ...page,
                      items: page.items.map((item) =>
                          item.id === parentId
                              ? { ...item, replyCount: Math.max(0, item.replyCount + delta) }
                              : item,
                      ),
                  })),
              }
            : data,
    );
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
            await queryClient.cancelQueries({ queryKey: listKeyOf(projectId, comment) });
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
 * DELETE /projects/{pid}/comments/{cid}, author or ADMIN+ — a comment or a reply. Not
 * optimistic: the confirm waits, so a failure leaves everything as it was. On success — or a
 * 404, meaning it was already gone ("That comment was already deleted.") — it leaves its list's
 * cache (meta.total too) and the list is refetched. A reply takes its parent's replyCount down
 * by one; a top-level comment takes the task's commentCount down, and its replies (deleted with
 * it) leave the cache. Other errors toast and reject, so a confirm dialog can stay open.
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
            const key = listKeyOf(projectId, comment);
            let removed = false;
            queryClient.setQueryData<CommentThreadData>(key, (data) => {
                if (!data) return data;
                removed = hasComment(data, comment.id);
                return without(data, comment.id);
            });
            if (comment.parentId) {
                // Counted once: a reply already missing from the cache was counted out before.
                if (removed) adjustReplyCount(queryClient, projectId, comment, -1);
            } else {
                if (removed) {
                    adjustTaskCount(queryClient, projectId, comment.taskId, 'commentCount', -1);
                }
                // Its replies were deleted with it.
                queryClient.removeQueries({ queryKey: repliesKey(projectId, comment.id) });
            }
            if (alreadyDeleted) toast(COMMENT_ALREADY_DELETED_MESSAGE);
            void queryClient.invalidateQueries({ queryKey: key });
        },
        onError: (error) => notifyError(error),
    });
}

export type NewReply = { parent: Comment; body: string };

/**
 * POST /projects/{pid}/comments ({ body, parentId }) — a reply; it takes its parent's taskId, so
 * none is sent. Optimistic: it shows at once at the end of the parent's replies (creating that
 * cache entry if they weren't loaded yet) and the parent's replyCount goes up; an error undoes
 * both. Afterwards the replies are refetched. Errors toast here: a 404 means the parent was
 * deleted meanwhile ("That comment was deleted", and the thread is refetched); a 422 or anything
 * else, its message. The composer only puts the text back.
 */
export function useCreateReply(projectId: string) {
    const queryClient = useQueryClient();
    const { user } = useSession();

    return useMutation({
        mutationFn: ({ parent, body }: NewReply) =>
            unwrap(
                api.POST('/api/v1/projects/{projectId}/comments', {
                    params: { path: { projectId } },
                    body: { body, parentId: parent.id },
                }),
            ),
        onMutate: async ({ parent, body }) => {
            const key = repliesKey(projectId, parent.id);
            await queryClient.cancelQueries({ queryKey: key });
            pendingSeq += 1;
            const pending: Comment = {
                id: `pending-${pendingSeq}`,
                projectId,
                taskId: parent.taskId,
                authorId: user?.id ?? '',
                parentId: parent.id,
                body,
                editedAt: null,
                createdAt: new Date().toISOString(),
                author: { id: user?.id ?? '', name: user?.name ?? 'You' },
                replyCount: 0,
            };
            const created = queryClient.getQueryData(key) === undefined;
            queryClient.setQueryData<CommentThreadData>(key, (data) =>
                data
                    ? withAtEnd(data, pending)
                    : {
                          pages: [
                              {
                                  items: [pending],
                                  meta: {
                                      page: 1,
                                      limit: REPLIES_PAGE_SIZE,
                                      total: 1,
                                      totalPages: 1,
                                  },
                              },
                          ],
                          pageParams: [1],
                      },
            );
            adjustReplyCount(queryClient, projectId, pending, 1);
            return { key, pendingId: pending.id, created };
        },
        onError: (error, { parent }, context) => {
            if (context) {
                if (context.created) {
                    queryClient.removeQueries({ queryKey: context.key, exact: true });
                } else {
                    queryClient.setQueryData<CommentThreadData>(context.key, (data) =>
                        data ? without(data, context.pendingId) : data,
                    );
                }
                adjustReplyCount(
                    queryClient,
                    projectId,
                    { taskId: parent.taskId, parentId: parent.id },
                    -1,
                );
            }
            if (isApiError(error) && error.status === 404) {
                toast.error(PARENT_DELETED_MESSAGE);
                void queryClient.invalidateQueries({ queryKey: threadKeyOf(projectId, parent) });
            } else if (isApiError(error) && error.status === 422) {
                toast.error(errorMessage(error));
            } else {
                notifyError(error);
            }
        },
        onSuccess: (reply, _variables, { key, pendingId }) => {
            pendingKeys.set(reply.id, pendingId);
            queryClient.setQueryData<CommentThreadData>(key, (data) => {
                if (!data) return data;
                const pendingShown = hasComment(data, pendingId);
                // A refetch may already have brought the saved one (or dropped the pending one).
                if (hasComment(data, reply.id)) {
                    return pendingShown ? without(data, pendingId) : data;
                }
                if (!pendingShown) return withAtEnd(data, reply);
                return {
                    ...data,
                    pages: data.pages.map((page) => ({
                        ...page,
                        items: page.items.map((c) => (c.id === pendingId ? reply : c)),
                    })),
                };
            });
            void queryClient.invalidateQueries({ queryKey: key });
        },
    });
}
