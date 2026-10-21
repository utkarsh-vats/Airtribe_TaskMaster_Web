'use client';

import { useQuery } from '@tanstack/react-query';

import { api, unwrapPage } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';

const UNREAD_POLL_MS = 60_000;

/**
 * Unread notification count for the header badge: GET /notifications?unread=true&limit=1,
 * reading meta.unreadCount. Polls every 60 s while the tab is visible (TanStack pauses the
 * interval in background tabs); step 12c adds live updates over SSE.
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
