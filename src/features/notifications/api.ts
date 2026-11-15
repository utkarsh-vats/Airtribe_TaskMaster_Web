'use client';

import {
    keepPreviousData,
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient,
    type QueryKey,
} from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import type { Notification } from '@/lib/api/types';
import { queryKeys, type NotificationListFilters } from '@/lib/query/keys';
import { streamState } from '@/lib/realtime/notificationStream';

const UNREAD_POLL_MS = 60_000;
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * Unread notification count for the header badge: GET /notifications?unread=true&limit=1,
 * reading meta.unreadCount. Polls every 60 s while the tab is visible (TanStack pauses the
 * interval in background tabs) and the live stream isn't open — while it is, new
 * notifications arrive over it (addNotificationToCache). Marking read updates it in place
 * (useMarkRead / useMarkAllRead).
 */
export function useUnreadCount() {
    const live = useSyncExternalStore(
        streamState.subscribe,
        () => streamState.get() === 'open',
        () => false,
    );
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
        refetchInterval: live ? false : UNREAD_POLL_MS,
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

export const LATEST_NOTIFICATIONS_LIMIT = 10;
/** The header panel reuses its list for this long; opening it after that refetches. */
const LATEST_STALE_MS = 30_000;

const LATEST_QUERY: NotificationQuery = { page: 1, limit: LATEST_NOTIFICATIONS_LIMIT };
export const latestNotificationsKey = () => queryKeys.notifications.list(LATEST_QUERY);

/**
 * The header panel's list: my 10 newest notifications, read or not (page 1, limit 10). The
 * panel mounts it on open, so opening refetches only when it's stale (30 s, or invalidated —
 * marking read anywhere does that).
 */
export function useLatestNotifications() {
    return useQuery({
        queryKey: latestNotificationsKey(),
        queryFn: ({ signal }) => fetchNotifications(LATEST_QUERY, signal),
        staleTime: LATEST_STALE_MS,
    });
}

/**
 * Before the panel opens: if the badge's count no longer matches the cached list's (the 60 s
 * poll saw something new), mark the list stale so opening refetches it.
 */
export function staleLatestIfBehind(queryClient: QueryClient) {
    const unread = queryClient.getQueryData<number>(queryKeys.notifications.unreadCount());
    const latest = queryClient.getQueryData<NotificationPage>(latestNotificationsKey());
    if (unread === undefined || !latest || latest.meta.unreadCount === unread) return;
    void queryClient.invalidateQueries({ queryKey: latestNotificationsKey(), exact: true });
}

// ── live notifications ───────────────────────────────────────────────────────────────

const listsOf = (queryClient: QueryClient) =>
    queryClient.getQueriesData({ queryKey: [...queryKeys.notifications.all(), 'list'] });

/** The cached copy of a notification (the newest state, e.g. read since), if any list has it. */
export function cachedNotification(queryClient: QueryClient, id: string): Notification | null {
    for (const [, data] of listsOf(queryClient)) {
        const found = isPage(data) ? data.items.find((item) => item.id === id) : undefined;
        if (found) return found;
    }
    return null;
}

/**
 * A notification from the live stream. Returns false (and changes nothing) if a cached list
 * already has it. Otherwise: prepended to every cached page 1 it belongs on — the panel's
 * latest, the page's All and (unread) Unread — trimmed to the page size, with meta.total;
 * meta.unreadCount and the header's count go up by one (for an unread one) everywhere; later
 * pages keep their rows but go stale, so they refetch when visited.
 */
export function addNotificationToCache(queryClient: QueryClient, notification: Notification) {
    if (cachedNotification(queryClient, notification.id)) return false;
    const unread = !notification.readAt;
    for (const [key, data] of listsOf(queryClient)) {
        if (!isPage(data)) continue;
        const filters = (key[2] ?? {}) as NotificationListFilters;
        const meta = { ...data.meta, unreadCount: data.meta.unreadCount + (unread ? 1 : 0) };
        const belongs =
            filters.unread === undefined || filters.unread === (unread ? 'true' : 'false');
        if ((filters.page ?? 1) !== 1 || !belongs) {
            queryClient.setQueryData(key, { ...data, meta });
            if (belongs)
                void queryClient.invalidateQueries({
                    queryKey: key,
                    exact: true,
                    refetchType: 'none',
                });
            continue;
        }
        const total = data.meta.total + 1;
        queryClient.setQueryData(key, {
            ...data,
            items: [notification, ...data.items].slice(0, data.meta.limit),
            meta: { ...meta, total, totalPages: Math.ceil(total / data.meta.limit) },
        });
    }
    if (unread) {
        queryClient.setQueryData<number>(queryKeys.notifications.unreadCount(), (count) =>
            count === undefined ? count : count + 1,
        );
    }
    return true;
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
    for (const [key, data] of listsOf(queryClient)) {
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
