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
import type { Attachment, PageMeta } from '@/lib/api/types';
import { queryKeys, type TaskScope } from '@/lib/query/keys';

export const ATTACHMENTS_PAGE_SIZE = 50;
export const ATTACHMENT_ALREADY_DELETED_MESSAGE = 'That file was already deleted.';

type AttachmentPage = { items: Attachment[]; meta: PageMeta };
export type AttachmentListData = InfiniteData<AttachmentPage, number>;

/** A list's cache key: a task's files, or the project-level ones ('none'). */
export const attachmentListKey = (projectId: string, taskId: TaskScope) =>
    queryKeys.attachments.list(projectId, taskId, { limit: ATTACHMENTS_PAGE_SIZE });

const listKeyOf = (projectId: string, attachment: Pick<Attachment, 'taskId'>) =>
    attachmentListKey(projectId, attachment.taskId ?? 'none');

/**
 * One attachment list (GET /projects/{pid}/attachments?taskId=…), newest first as the API
 * returns it, 50 a page; "Load more" appends the next (older) page.
 */
export function useAttachments(projectId: string, taskId: TaskScope) {
    return useInfiniteQuery({
        queryKey: attachmentListKey(projectId, taskId),
        queryFn: ({ pageParam, signal }) =>
            unwrapPage(
                api.GET('/api/v1/projects/{projectId}/attachments', {
                    params: {
                        path: { projectId },
                        query: { taskId, page: pageParam, limit: ATTACHMENTS_PAGE_SIZE },
                    },
                    signal,
                }),
            ),
        initialPageParam: 1,
        getNextPageParam: (last: AttachmentPage) =>
            last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    });
}

/**
 * A file just uploaded (DESIGN.md §7 "Uploads"): it goes at the top of its list's cache (the
 * list is newest first) with meta.total up by one, the task's attachmentCount goes up in the
 * detail and any list row that carries it, and the list is refetched.
 */
export function addUploadedAttachment(
    queryClient: QueryClient,
    projectId: string,
    attachment: Attachment,
) {
    const key = listKeyOf(projectId, attachment);
    let added = false;
    queryClient.setQueryData<AttachmentListData>(key, (data) => {
        if (!data || data.pages.some((p) => p.items.some((a) => a.id === attachment.id))) {
            return data;
        }
        added = true;
        return {
            ...data,
            pages: data.pages.map((page, index) => ({
                items: index === 0 ? [attachment, ...page.items] : page.items,
                meta: { ...page.meta, total: page.meta.total + 1 },
            })),
        };
    });
    // A list that isn't cached (or already has it) still means one more file on the task.
    if (added || !queryClient.getQueryData(key)) {
        adjustTaskCount(queryClient, projectId, attachment.taskId, 'attachmentCount', 1);
    }
    void queryClient.invalidateQueries({ queryKey: key });
}

/**
 * DELETE /projects/{pid}/attachments/{aid}, uploader or ADMIN+. Not optimistic. On success —
 * or a 404, meaning it was already gone ("That file was already deleted.") — it leaves its
 * list's cache (meta.total too), the task's attachmentCount goes down, and the list is
 * refetched. Other errors toast and reject, so the confirm dialog stays open for a retry.
 */
export function useDeleteAttachment(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (attachment: Attachment): Promise<{ alreadyDeleted: boolean }> => {
            try {
                await unwrap(
                    api.DELETE('/api/v1/projects/{projectId}/attachments/{attachmentId}', {
                        params: { path: { projectId, attachmentId: attachment.id } },
                    }),
                );
                return { alreadyDeleted: false };
            } catch (error) {
                if (isApiError(error) && error.status === 404) return { alreadyDeleted: true };
                throw error;
            }
        },
        onSuccess: ({ alreadyDeleted }, attachment) => {
            const key = listKeyOf(projectId, attachment);
            let removed = false;
            queryClient.setQueryData<AttachmentListData>(key, (data) => {
                if (!data) return data;
                removed = data.pages.some((page) => page.items.some((a) => a.id === attachment.id));
                if (!removed) return data;
                return {
                    ...data,
                    pages: data.pages.map((page) => ({
                        items: page.items.filter((a) => a.id !== attachment.id),
                        meta: { ...page.meta, total: Math.max(0, page.meta.total - 1) },
                    })),
                };
            });
            // Counted once: a file already missing from the cache was counted out before.
            if (removed) {
                adjustTaskCount(queryClient, projectId, attachment.taskId, 'attachmentCount', -1);
            }
            if (alreadyDeleted) toast(ATTACHMENT_ALREADY_DELETED_MESSAGE);
            void queryClient.invalidateQueries({ queryKey: key });
        },
        onError: (error) => notifyError(error),
    });
}
