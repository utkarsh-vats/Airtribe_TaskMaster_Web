'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { errorMessage } from '@/lib/api/messages';
import type { Notification } from '@/lib/api/types';
import { fullDateTime, relativeTime } from '@/lib/format/dates';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryView } from '@/lib/query/view';
import { isPlainClick } from '@/lib/react/plainClick';

import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../api';
import { notificationActor, notificationSentence } from '../sentence';

type Filter = 'all' | 'unread';

/** ?page (from 1; anything else is page 1). */
function parsePage(raw: string | null): number {
    const page = Number(raw);
    return Number.isInteger(page) && page > 1 ? page : 1;
}

/**
 * /dashboard/notifications (DESIGN.md §9): "Notifications" + the unread count, All | Unread
 * (?unread=1 — the API filters), Mark all as read, then my notifications newest first, 20 a
 * page. Each row is a link to what it's about; a plain click marks it read on the way.
 */
export function NotificationsView() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const unread = searchParams.get('unread') === '1';
    const page = parsePage(searchParams.get('page'));
    const notifications = useNotifications({ unread, page });
    const unreadCount = useUnreadCount();
    const markAll = useMarkAllRead();
    // The list's meta and the header's count are kept in step by the mark-read mutations.
    const unreadTotal = notifications.data?.meta.unreadCount ?? unreadCount.data;

    const urlFor = (next: { unread?: boolean; page?: number }) => {
        const params = new URLSearchParams(searchParams.toString());
        const nextUnread = next.unread ?? unread;
        if (nextUnread) params.set('unread', '1');
        else params.delete('unread');
        const nextPage = next.page ?? 1;
        if (nextPage > 1) params.set('page', String(nextPage));
        else params.delete('page');
        const query = params.toString();
        return query ? `${pathname}?${query}` : pathname;
    };

    let body;
    const view = queryView(notifications);
    if (view.status === 'loading') {
        body = (
            <div aria-busy="true" className="flex flex-col border-t-rule border-divider">
                <span className="sr-only">Loading notifications…</span>
                {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="flex items-center gap-3 border-b border-divider py-3">
                        <Skeleton width={32} height={32} />
                        <div className="flex flex-1 flex-col gap-1">
                            <Skeleton width="70%" height={14} />
                            <Skeleton width="20%" height={11} />
                        </div>
                    </div>
                ))}
            </div>
        );
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                title="Couldn't load notifications"
                message={errorMessage(view.error)}
                retrying={notifications.isRefetching}
                onRetry={() => void notifications.refetch()}
            />
        );
    } else if (view.data.items.length === 0) {
        body = unread ? (
            <EmptyState title="No unread notifications" body="You've read everything." />
        ) : page > 1 ? (
            <EmptyState
                title="Nothing on this page"
                body="There are fewer notifications than that."
                action={
                    <Button variant="secondary" onClick={() => shallowUrl.push(urlFor({}))}>
                        Go to the first page
                    </Button>
                }
            />
        ) : (
            <EmptyState
                title="You're all caught up"
                body="Notifications about your tasks, comments and invitations show up here."
            />
        );
    } else {
        body = (
            <>
                <ul
                    aria-label="Notifications"
                    aria-busy={notifications.isPlaceholderData || undefined}
                    className={clsx(
                        'm-0 list-none border-t-rule border-divider p-0 transition-opacity',
                        notifications.isPlaceholderData && 'opacity-60',
                    )}
                >
                    {view.data.items.map((notification) => (
                        <NotificationRow key={notification.id} notification={notification} />
                    ))}
                </ul>
                <Pagination
                    page={page}
                    totalPages={view.data.meta.totalPages}
                    onPageChange={(next) => shallowUrl.push(urlFor({ page: next }))}
                />
            </>
        );
    }

    return (
        <div className="flex max-w-[860px] flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-baseline gap-2">
                    <h2 className="m-0">Notifications</h2>
                    {unreadTotal !== undefined && (
                        <span className="text-muted" data-testid="unread-count">
                            {unreadTotal} unread
                        </span>
                    )}
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto"
                    disabled={!unreadTotal || markAll.isPending}
                    onClick={() => markAll.mutate()}
                >
                    Mark all as read
                </Button>
            </div>
            <Segmented<Filter>
                aria-label="Show"
                value={unread ? 'unread' : 'all'}
                onChange={(next) => shallowUrl.push(urlFor({ unread: next === 'unread' }))}
                options={[
                    { value: 'all', label: 'All' },
                    { value: 'unread', label: 'Unread' },
                ]}
            />
            {body}
        </div>
    );
}

/**
 * Unread dot, the actor's avatar, the sentence (names bold) and when. The whole row is a link:
 * a plain click marks it read (fire and forget) and goes there; a modified click (new tab) just
 * follows the link.
 */
function NotificationRow({ notification }: { notification: Notification }) {
    const router = useRouter();
    const markRead = useMarkRead();
    const { parts, href, text } = notificationSentence(notification);
    const actor = notificationActor(notification) ?? 'Someone';
    const isUnread = !notification.readAt;

    return (
        <li className="border-b border-divider" data-unread={isUnread || undefined}>
            <Link
                href={href}
                aria-label={`${isUnread ? 'Unread: ' : ''}${text}`}
                onClick={(event) => {
                    if (!isPlainClick(event)) return;
                    event.preventDefault();
                    if (isUnread) markRead.mutate(notification);
                    router.push(href);
                }}
                className="grid grid-cols-[10px_32px_minmax(0,1fr)] items-start gap-3 px-2 py-3 text-text no-underline hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)] hover:text-text focus-visible:[outline-offset:-2px] md:grid-cols-[10px_32px_minmax(0,1fr)_auto] md:items-center"
            >
                <span
                    aria-hidden
                    data-testid="unread-dot"
                    className={clsx(
                        'mt-[11px] size-2 rounded-full md:mt-0',
                        isUnread ? 'bg-accent' : 'bg-transparent',
                    )}
                />
                <Avatar name={actor} />
                <span
                    className={clsx(
                        'min-w-0 text-sm break-words',
                        !isUnread && 'text-[color-mix(in_srgb,var(--color-text)_75%,transparent)]',
                    )}
                >
                    {parts.map((part, i) =>
                        part.strong ? (
                            <strong key={i} className="font-semibold">
                                {part.text}
                            </strong>
                        ) : (
                            <span key={i}>{part.text}</span>
                        ),
                    )}
                    {/* Below 820px the time sits under the sentence. */}
                    <time
                        dateTime={notification.createdAt}
                        title={fullDateTime(notification.createdAt)}
                        className="text-muted mt-1 block text-[12px] md:hidden"
                    >
                        {relativeTime(notification.createdAt)}
                    </time>
                </span>
                <time
                    dateTime={notification.createdAt}
                    title={fullDateTime(notification.createdAt)}
                    className="text-muted hidden text-[12px] whitespace-nowrap md:block"
                >
                    {relativeTime(notification.createdAt)}
                </time>
            </Link>
        </li>
    );
}
