'use client';

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';

import { api, unwrapPage } from '@/lib/api/client';
import type { Attachment, PageMeta } from '@/lib/api/types';
import { queryKeys, type TaskScope } from '@/lib/query/keys';

export const ATTACHMENTS_PAGE_SIZE = 50;

type AttachmentPage = { items: Attachment[]; meta: PageMeta };
export type AttachmentListData = InfiniteData<AttachmentPage, number>;

/** A list's cache key: a task's files, or the project-level ones ('none'). */
export const attachmentListKey = (projectId: string, taskId: TaskScope) =>
    queryKeys.attachments.list(projectId, taskId, { limit: ATTACHMENTS_PAGE_SIZE });

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
