'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { errorMessage } from '@/lib/api/messages';
import { queryView } from '@/lib/query/view';
import { isPlainClick } from '@/lib/react/plainClick';

import { useLatestNotifications, useMarkAllRead, useUnreadCount } from '../api';

import { NotificationRow } from './NotificationRow';

/**
 * The header's notifications panel (DESIGN.md §9), inside the Popover: "Notifications" + the
 * unread count and Mark all as read, my 10 newest notifications (the page's rows, compact) in
 * a scrolling list, and "View all notifications". A plain click on a row or on View all calls
 * `onClose`.
 */
export function NotificationsPanel({ onClose }: { onClose: () => void }) {
    const latest = useLatestNotifications();
    const unreadCount = useUnreadCount();
    const markAll = useMarkAllRead();
    const unreadTotal = latest.data?.meta.unreadCount ?? unreadCount.data;

    let body;
    const view = queryView(latest);
    if (view.status === 'loading') {
        body = (
            <div aria-busy="true" className="flex flex-col">
                <span className="sr-only">Loading notifications…</span>
                {Array.from({ length: 3 }, (_, i) => (
                    <div
                        key={i}
                        className="flex items-center gap-2 border-b border-divider px-3 py-2"
                    >
                        <Skeleton width={24} height={24} />
                        <div className="flex flex-1 flex-col gap-1">
                            <Skeleton width="80%" height={13} />
                            <Skeleton width="25%" height={10} />
                        </div>
                    </div>
                ))}
            </div>
        );
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                compact
                className="px-3"
                title="Couldn't load notifications"
                message={errorMessage(view.error)}
                retrying={latest.isRefetching}
                onRetry={() => void latest.refetch()}
            />
        );
    } else if (view.data.items.length === 0) {
        body = <p className="text-muted m-0 px-3 py-6 text-sm">You&apos;re all caught up</p>;
    } else {
        body = (
            <ul aria-label="Latest notifications" className="m-0 list-none p-0">
                {view.data.items.map((notification) => (
                    <NotificationRow
                        key={notification.id}
                        notification={notification}
                        compact
                        onNavigate={onClose}
                    />
                ))}
            </ul>
        );
    }

    return (
        <div className="flex max-h-[inherit] min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b-rule border-divider px-3 py-2">
                <h2 className="m-0 text-[15px]">Notifications</h2>
                {unreadTotal !== undefined && (
                    <span className="text-muted text-sm" data-testid="panel-unread-count">
                        {unreadTotal} unread
                    </span>
                )}
                <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={!unreadTotal || markAll.isPending}
                    onClick={() => markAll.mutate()}
                >
                    Mark all as read
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
            <Link
                href="/dashboard/notifications"
                onClick={(event) => {
                    if (isPlainClick(event)) onClose();
                }}
                className="border-t-rule border-divider px-3 py-2 text-sm font-semibold"
            >
                View all notifications
            </Link>
        </div>
    );
}
