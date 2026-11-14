'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Avatar } from '@/components/ui/Avatar';
import type { Notification } from '@/lib/api/types';
import { fullDateTime, relativeTime } from '@/lib/format/dates';
import { isPlainClick } from '@/lib/react/plainClick';

import { useMarkRead } from '../api';
import { notificationActor, notificationSentence } from '../sentence';

type NotificationRowProps = {
    notification: Notification;
    /** Header panel density: smaller avatar and padding, the time always under the sentence. */
    compact?: boolean;
    /** After a plain click has marked it read and started the navigation (the panel closes). */
    onNavigate?: () => void;
};

/**
 * Unread dot, the actor's avatar, the sentence (names bold) and when. The whole row is a link:
 * a plain click marks it read (fire and forget) and goes there; a modified click (new tab) just
 * follows the link. Used by the notifications page and the header panel.
 */
export function NotificationRow({
    notification,
    compact = false,
    onNavigate,
}: NotificationRowProps) {
    const router = useRouter();
    const markRead = useMarkRead();
    const { parts, href, text } = notificationSentence(notification);
    const actor = notificationActor(notification) ?? 'Someone';
    const isUnread = !notification.readAt;

    const time = (className: string) => (
        <time
            dateTime={notification.createdAt}
            title={fullDateTime(notification.createdAt)}
            className={clsx('text-muted text-[12px]', className)}
        >
            {relativeTime(notification.createdAt)}
        </time>
    );

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
                    onNavigate?.();
                }}
                className={clsx(
                    'grid items-start text-text no-underline hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)] hover:text-text focus-visible:[outline-offset:-2px]',
                    compact
                        ? 'grid-cols-[8px_24px_minmax(0,1fr)] gap-2 px-3 py-2'
                        : 'grid-cols-[10px_32px_minmax(0,1fr)] gap-3 px-2 py-3 md:grid-cols-[10px_32px_minmax(0,1fr)_auto] md:items-center',
                )}
            >
                <span
                    aria-hidden
                    data-testid="unread-dot"
                    className={clsx(
                        'size-2 rounded-full',
                        compact ? 'mt-[8px]' : 'mt-[11px] md:mt-0',
                        isUnread ? 'bg-accent' : 'bg-transparent',
                    )}
                />
                <Avatar name={actor} size={compact ? 'sm' : 'md'} />
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
                    {/* Compact, and below 820px on the page, the time sits under the sentence. */}
                    {time(clsx('mt-1 block', !compact && 'md:hidden'))}
                </span>
                {!compact && time('hidden whitespace-nowrap md:block')}
            </Link>
        </li>
    );
}
