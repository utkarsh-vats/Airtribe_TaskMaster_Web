'use client';

import { Bell, Menu as MenuIcon } from 'lucide-react';
import { Suspense, type Ref } from 'react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { useUnreadCount } from '@/features/notifications/api';

import { BrandMark } from './BrandMark';
import { HeaderSearch } from './HeaderSearch';
import { ProfileMenu } from './ProfileMenu';
import { ThemeSwitch } from './ThemeSwitch';

/** "99+" above 99. */
export const formatBadge = (count: number) => (count > 99 ? '99+' : String(count));

/**
 * The signed-in app's header bar (prototype `.nav`): menu button (below 820px), brand,
 * search (820px and up), theme switch, notifications with unread badge, profile menu.
 * Sticky, full width, 2px rule underneath.
 */
export function DashboardHeader({
    onOpenNav,
    menuButtonRef,
}: {
    onOpenNav?: () => void;
    /** The "Open navigation" button, so the drawer can return focus to it. */
    menuButtonRef?: Ref<HTMLButtonElement>;
}) {
    return (
        <header className="nav sticky top-0 z-30 h-[var(--tm-header-h)] gap-3 bg-bg">
            <Button
                variant="secondary"
                iconOnly
                aria-label="Open navigation"
                ref={menuButtonRef}
                className="md:hidden"
                onClick={onOpenNav}
            >
                <MenuIcon aria-hidden size={18} />
            </Button>
            <BrandMark href="/dashboard" />
            {/* useSearchParams needs a Suspense boundary on statically rendered pages. */}
            <Suspense fallback={<div aria-hidden className="hidden w-[260px] md:block" />}>
                <HeaderSearch />
            </Suspense>
            <ThemeSwitch />
            <NotificationsButton />
            <ProfileMenu />
        </header>
    );
}

function NotificationsButton() {
    const { data: unread = 0 } = useUnreadCount();
    const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

    return (
        <ButtonLink
            href="/dashboard/notifications"
            variant="secondary"
            iconOnly
            aria-label={label}
            className="relative"
        >
            <Bell aria-hidden size={18} />
            {unread > 0 && (
                <span
                    aria-hidden
                    data-testid="unread-badge"
                    className="absolute -top-[6px] -right-[6px] grid h-[18px] min-w-[18px] place-items-center bg-accent px-1 text-[11px] leading-none font-extrabold text-bg"
                >
                    {formatBadge(unread)}
                </span>
            )}
        </ButtonLink>
    );
}
