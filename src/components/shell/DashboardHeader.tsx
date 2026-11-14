'use client';

import { Bell, Menu as MenuIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState, type Ref } from 'react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { staleLatestIfBehind, useUnreadCount } from '@/features/notifications/api';
import { NotificationsPanel } from '@/features/notifications/components/NotificationsPanel';

import { BrandMark } from './BrandMark';
import { HeaderSearch } from './HeaderSearch';
import { ProfileMenu } from './ProfileMenu';
import { ThemeSwitch } from './ThemeSwitch';

/** "99+" above 99. */
export const formatBadge = (count: number) => (count > 99 ? '99+' : String(count));

/**
 * The signed-in app's header bar (prototype `.nav`): menu button (below 820px), brand,
 * search (820px and up), theme switch, notifications with unread badge (the panel from
 * 820px, a link to the page below), profile menu.
 * Sticky, full width, 2px rule underneath. Below 480px the gaps and padding tighten and the
 * profile trigger drops the name, so the bar fits a 360px screen; only the brand can shrink.
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
        <header className="nav sticky top-0 z-30 h-[var(--tm-header-h)] gap-2 bg-bg px-3 min-[480px]:gap-3 min-[480px]:px-4 [&>*:not(.nav-brand)]:flex-none">
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

/** From 820px the panel; below, a link to the page. Both carry the badge; CSS shows one. */
function NotificationsButton() {
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const { data: unread = 0 } = useUnreadCount();
    const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
    // Open on the route it was opened on: navigating anywhere closes it.
    const [openOn, setOpenOn] = useState<string | null>(null);
    const open = openOn === pathname;
    const close = () => setOpenOn(null);

    // Narrowed below 820px while open: the trigger is hidden, so the panel goes too.
    useEffect(() => {
        const wide = window.matchMedia(WIDE);
        const onChange = (event: MediaQueryListEvent) => {
            if (!event.matches) setOpenOn(null);
        };
        wide.addEventListener('change', onChange);
        return () => wide.removeEventListener('change', onChange);
    }, []);

    const badge = unread > 0 && (
        <span
            aria-hidden
            data-testid="unread-badge"
            className="absolute -top-[6px] -right-[6px] grid h-[18px] min-w-[18px] place-items-center bg-accent px-1 text-[11px] leading-none font-extrabold text-bg"
        >
            {formatBadge(unread)}
        </span>
    );

    return (
        <>
            <ButtonLink
                href="/dashboard/notifications"
                variant="secondary"
                iconOnly
                aria-label={label}
                className="relative md:hidden"
            >
                <Bell aria-hidden size={18} />
                {badge}
            </ButtonLink>
            <Popover
                open={open}
                onOpenChange={(next) => {
                    if (next) staleLatestIfBehind(queryClient);
                    setOpenOn(next ? pathname : null);
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        variant="secondary"
                        iconOnly
                        aria-label={label}
                        className="relative hidden md:inline-flex"
                    >
                        <Bell aria-hidden size={18} />
                        {badge}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    aria-label="Notifications"
                    className="flex w-[380px] max-h-[min(480px,var(--radix-popover-content-available-height))] flex-col overflow-hidden p-0"
                >
                    <NotificationsPanel onClose={close} />
                </PopoverContent>
            </Popover>
        </>
    );
}

const WIDE = '(min-width: 820px)';
