import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { invalidateTaskQueries } from '@/features/tasks/api';
import type { Notification } from '@/lib/api/types';
import { queryKeys } from '@/lib/query/keys';

/** Just the ids, for when the top-level ones are missing (as in sentence.ts). */
const ids = z.object({
    project: z.object({ id: z.string() }).optional(),
    task: z.object({ id: z.string() }).optional(),
});

/** What a notification is about: its own projectId / taskId win over the payload's. */
export function notificationTarget(n: Notification): {
    projectId: string | null;
    taskId: string | null;
} {
    const payload = ids.safeParse(n.payload);
    const fromPayload = payload.success ? payload.data : {};
    return {
        projectId: n.projectId ?? fromPayload.project?.id ?? null,
        taskId: n.taskId ?? fromPayload.task?.id ?? null,
    };
}

/**
 * A new live notification (DESIGN.md §9): refetch what it's about — invalidate, never patch
 * (the payload is a snapshot of names, not the current data). Only queries on screen refetch;
 * the rest just go stale. A type this client doesn't know invalidates nothing.
 */
export function invalidateForNotification(queryClient: QueryClient, n: Notification) {
    const { projectId, taskId } = notificationTarget(n);
    switch (n.type) {
        case 'TASK_ASSIGNED':
        case 'TASK_UPDATED':
        case 'TASK_COMPLETED':
            // The project's lists, counts and task details, and every My tasks query.
            if (projectId) void invalidateTaskQueries(queryClient, projectId);
            return;
        case 'COMMENT_ADDED':
        case 'COMMENT_REPLY':
            if (!projectId) return;
            // Thread lists and replies; the task's detail carries its comment count.
            void queryClient.invalidateQueries({ queryKey: queryKeys.comments.all(projectId) });
            if (taskId) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.tasks.detail(projectId, taskId),
                });
            }
            return;
        case 'PROJECT_INVITATION':
            // The inbox and the sidebar's Invitations badge.
            void queryClient.invalidateQueries({ queryKey: queryKeys.invitations.mine() });
            return;
        default:
            return;
    }
}

/**
 * Reconnected after a drop or a hidden tab: events missed meanwhile invalidated nothing, so
 * refetch the notifications and everything they could have been about (cheap — only what's
 * on screen refetches).
 */
export function catchUpAfterReconnect(queryClient: QueryClient) {
    for (const queryKey of [
        queryKeys.notifications.all(),
        queryKeys.tasks.root(),
        queryKeys.comments.root(),
        queryKeys.invitations.mine(),
    ]) {
        void queryClient.invalidateQueries({ queryKey });
    }
}
