import type { paths } from '@/lib/api/types';

/*
 * Query key factory (DESIGN.md §7). Every key is a readonly tuple that starts with its
 * resource, then its scope, with any filter object last — so a prefix invalidates everything
 * below it:
 *
 *     queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
 *     // → every list, detail and count for that project's tasks
 *
 * Filter objects are normalised (see normalizeFilters) so equivalent filters share one cache
 * entry however the UI built them.
 */

type QueryOf<P extends keyof paths> = paths[P] extends { get: { parameters: { query?: infer Q } } }
    ? NonNullable<Q>
    : never;

export type ProjectListFilters = QueryOf<'/api/v1/projects'>;
export type TaskListFilters = QueryOf<'/api/v1/projects/{projectId}/tasks'>;
export type MyTaskFilters = QueryOf<'/api/v1/users/me/tasks'>;
export type CommentListFilters = Omit<QueryOf<'/api/v1/projects/{projectId}/comments'>, 'taskId'>;
export type AttachmentListFilters = Omit<
    QueryOf<'/api/v1/projects/{projectId}/attachments'>,
    'taskId'
>;
export type InvitationListFilters = QueryOf<'/api/v1/projects/{projectId}/invitations'>;
export type NotificationListFilters = QueryOf<'/api/v1/notifications'>;

/** A task's id, or 'none' for project-level comments / attachments (the API's `taskId=none`). */
export type TaskScope = string | 'none';

type Normalized<T> = { readonly [K in keyof T]?: T[K] };

/**
 * Drop empty values (undefined, null, '', []) and sort array values, so e.g.
 * `{ priority: ['URGENT', 'HIGH'], q: '' }` and `{ priority: ['HIGH', 'URGENT'] }` give the same
 * key. Object key order doesn't need handling: TanStack hashes keys with sorted object keys.
 * Arrays are treated as sets, which holds for every array filter the API has (status, priority).
 */
export function normalizeFilters<T extends object>(filters?: T): Normalized<T> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filters ?? {})) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
            if (value.length === 0) continue;
            out[key] = [...value].map(String).sort();
        } else {
            out[key] = value;
        }
    }
    return out as Normalized<T>;
}

export const queryKeys = {
    me: () => ['me'] as const,

    projects: {
        all: () => ['projects'] as const,
        lists: () => [...queryKeys.projects.all(), 'list'] as const,
        list: (filters?: ProjectListFilters) =>
            [...queryKeys.projects.lists(), normalizeFilters(filters)] as const,
        detail: (projectId: string) => [...queryKeys.projects.all(), 'detail', projectId] as const,
    },

    tasks: {
        /** Every task query, including My tasks (e.g. after an SSE notification). */
        root: () => ['tasks'] as const,
        /** Everything for one project's tasks: lists, counts, details. */
        all: (projectId: string) => [...queryKeys.tasks.root(), 'project', projectId] as const,
        lists: (projectId: string) => [...queryKeys.tasks.all(projectId), 'list'] as const,
        list: (projectId: string, filters?: TaskListFilters) =>
            [...queryKeys.tasks.lists(projectId), normalizeFilters(filters)] as const,
        detail: (projectId: string, taskId: string) =>
            [...queryKeys.tasks.all(projectId), 'detail', taskId] as const,
        mine: (filters?: MyTaskFilters) =>
            [...queryKeys.tasks.root(), 'mine', normalizeFilters(filters)] as const,
    },

    comments: {
        all: (projectId: string) => ['comments', projectId] as const,
        list: (projectId: string, taskId: TaskScope, filters?: CommentListFilters) =>
            [
                ...queryKeys.comments.all(projectId),
                'list',
                taskId,
                normalizeFilters(filters),
            ] as const,
    },

    attachments: {
        all: (projectId: string) => ['attachments', projectId] as const,
        list: (projectId: string, taskId: TaskScope, filters?: AttachmentListFilters) =>
            [
                ...queryKeys.attachments.all(projectId),
                'list',
                taskId,
                normalizeFilters(filters),
            ] as const,
        /** One file's content, for the preview. */
        blob: (projectId: string, attachmentId: string) =>
            [...queryKeys.attachments.all(projectId), 'blob', attachmentId] as const,
    },

    members: {
        list: (projectId: string) => ['members', projectId] as const,
    },

    invitations: {
        all: () => ['invitations'] as const,
        project: (projectId: string, filters?: InvitationListFilters) =>
            [
                ...queryKeys.invitations.all(),
                'project',
                projectId,
                normalizeFilters(filters),
            ] as const,
        mine: () => [...queryKeys.invitations.all(), 'mine'] as const,
    },

    notifications: {
        all: () => ['notifications'] as const,
        list: (filters?: NotificationListFilters) =>
            [...queryKeys.notifications.all(), 'list', normalizeFilters(filters)] as const,
        /** The header badge's count (meta.unreadCount) — its own entry, not a list page. */
        unreadCount: () => [...queryKeys.notifications.all(), 'unread-count'] as const,
    },
} as const;
