'use client';

import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient,
    type QueryKey,
} from '@tanstack/react-query';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import type { Notification } from '@/lib/api/types';
import { queryKeys } from '@/lib/query/keys';

const UNREAD_POLL_MS = 60_000;
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * Unread notification count for the header badge: GET /notifications?unread=true&limit=1,
 * reading meta.unreadCount. Polls every 60 s while the tab is visible (TanStack pauses the
 * interval in background tabs); step 12c adds live updates over SSE. Marking read updates it
 * in place (useMarkRead / useMarkAllRead).
 */
export function useUnreadCount() {
    return useQuery({
        queryKey: queryKeys.notifications.unreadCount(),
        queryFn: async ({ signal }) => {
            const { meta } = await unwrapPage(
                api.GET('/api/v1/notifications', {
                    params: { query: { unread: 'true', limit: 1 } },
                    signal,
                }),
            );
            return meta.unreadCount;
        },
        refetchInterval: UNREAD_POLL_MS,
        refetchIntervalInBackground: false,
    });
}

export type NotificationFilters = { unread: boolean; page: number };

type NotificationPage = Awaited<ReturnType<typeof fetchNotifications>>;

function fetchNotifications(query: NotificationQuery, signal: AbortSignal) {
    return unwrapPage(api.GET('/api/v1/notifications', { params: { query }, signal }));
}

type NotificationQuery = { page: number; limit: number; unread?: 'true' };

const toQuery = ({ unread, page }: NotificationFilters): NotificationQuery => ({
    page,
    limit: NOTIFICATIONS_PAGE_SIZE,
    ...(unread ? { unread: 'true' as const } : {}),
});

/**
 * My notifications (GET /notifications), newest first, 20 a page; `unread` for unread only (the
 * API filters). meta.unreadCount counts every unread one, whatever the filter. While another
 * page or filter loads, the previous result stays on screen.
 */
export function useNotifications(filters: NotificationFilters) {
    const query = toQuery(filters);
    return useQuery({
        queryKey: queryKeys.notifications.list(query),
        queryFn: ({ signal }) => fetchNotifications(query, signal),
        placeholderData: keepPreviousData,
    });
}

// ── marking read (optimistic) ────────────────────────────────────────────────────────

type Snapshot = [QueryKey, unknown][];

const isPage = (data: unknown): data is NotificationPage =>
    typeof data === 'object' && data !== null && 'items' in data && 'meta' in data;

/** Every cached notifications query, to put back if marking read fails. */
function snapshot(queryClient: QueryClient): Snapshot {
    return queryClient.getQueriesData({ queryKey: queryKeys.notifications.all() });
}

function restore(queryClient: QueryClient, saved: Snapshot) {
    for (const [key, data] of saved) queryClient.setQueryData(key, data);
}

/**
 * Mark `which` read in every cached list (and set its readAt), and take the unread count —
 * each list's meta.unreadCount and the header's count — down by `fewer` (to 0 for 'all').
 */
function markReadInCache(queryClient: QueryClient, which: { id: string } | 'all', fewer: number) {
    const now = new Date().toISOString();
    const lower = (count: number) => (which === 'all' ? 0 : Math.max(0, count - fewer));
    for (const [key, data] of queryClient.getQueriesData({
        queryKey: [...queryKeys.notifications.all(), 'list'],
    })) {
        if (!isPage(data)) continue;
        queryClient.setQueryData(key, {
            ...data,
            items: data.items.map((item) =>
                !item.readAt && (which === 'all' || item.id === which.id)
                    ? { ...item, readAt: now }
                    : item,
            ),
            meta: { ...data.meta, unreadCount: lower(data.meta.unreadCount) },
        });
    }
    queryClient.setQueryData<number>(queryKeys.notifications.unreadCount(), (count) =>
        count === undefined ? count : lower(count),
    );
}

/**
 * PATCH /notifications/{id}/read. Optimistic: it shows read at once in every list and the
 * unread counts go down (only if it was unread); a failure puts everything back and toasts.
 * Afterwards the notifications are refetched (an Unread list drops it then).
 */
export function useMarkRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (notification: Notification) =>
            unwrap(
                api.PATCH('/api/v1/notifications/{notificationId}/read', {
                    params: { path: { notificationId: notification.id } },
                }),
            ),
        onMutate: async (notification) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all() });
            const saved = snapshot(queryClient);
            markReadInCache(queryClient, { id: notification.id }, notification.readAt ? 0 : 1);
            return saved;
        },
        onError: (error, _notification, saved) => {
            if (saved) restore(queryClient, saved);
            notifyError(error);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() }),
    });
}

/** POST /notifications/read-all. Optimistic, like useMarkRead: everything read, counts 0. */
export function useMarkAllRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => unwrap(api.POST('/api/v1/notifications/read-all')),
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all() });
            const saved = snapshot(queryClient);
            markReadInCache(queryClient, 'all', 0);
            return saved;
        },
        onError: (error, _variables, saved) => {
            if (saved) restore(queryClient, saved);
            notifyError(error);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() }),
    });
}
