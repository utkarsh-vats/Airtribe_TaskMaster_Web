'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent } from 'react';
import { toast } from 'sonner';

import type { Notification } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';
import { startNotificationStream } from '@/lib/realtime/notificationStream';

import { addNotificationToCache, cachedNotification, useMarkRead } from './api';
import { catchUpAfterReconnect, invalidateForNotification } from './invalidate';
import { notificationSentence } from './sentence';

/**
 * The live notification stream for the signed-in user (DESIGN.md §9): started on sign-in,
 * aborted on sign-out (here or in another tab — both end the session in the store). Each new
 * notification goes into the cache (badge, panel, page) and shows a toast with Open, unless
 * the cache (or this stream) already had it, and what it's about (task, comments, my
 * invitations) is refetched. A reconnect refetches all of that to catch up.
 */
export function useNotificationStream() {
    const session = useSession();
    const userId = session.status === 'authenticated' ? session.user.id : null;
    const queryClient = useQueryClient();
    const router = useRouter();
    const markRead = useMarkRead();

    const onNotification = useEffectEvent((notification: Notification) => {
        if (!addNotificationToCache(queryClient, notification)) return;
        invalidateForNotification(queryClient, notification);
        const { text, href } = notificationSentence(notification);
        toast(text, {
            id: `notification-${notification.id}`,
            action: {
                label: 'Open',
                // As a row click: mark it read (unless it's been read since), then go there.
                onClick: () => {
                    const current = cachedNotification(queryClient, notification.id);
                    if (!(current ?? notification).readAt) markRead.mutate(current ?? notification);
                    router.push(href);
                },
            },
        });
    });

    useEffect(() => {
        if (!userId) return;
        // Ids this stream has delivered: a repeat counts once even when no list is cached.
        const seen = new Set<string>();
        return startNotificationStream({
            onNotification: (notification) => {
                if (seen.has(notification.id)) return;
                seen.add(notification.id);
                onNotification(notification);
            },
            onReconnected: () => catchUpAfterReconnect(queryClient),
        });
    }, [userId, queryClient]);
}

/** Mounts the stream; rendered once inside SessionProvider in the dashboard layout. */
export function NotificationStream() {
    useNotificationStream();
    return null;
}
