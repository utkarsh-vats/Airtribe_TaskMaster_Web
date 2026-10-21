'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type LinkTab = {
    href: string;
    label: string;
    /** 'prefix' (default) also marks the tab active on nested routes. */
    match?: 'exact' | 'prefix';
};

type LinkTabsProps = {
    tabs: readonly LinkTab[];
    'aria-label': string;
    /** Path to treat as current; defaults to the router's pathname. */
    currentPath?: string;
    className?: string;
};

function isActive(tab: LinkTab, path: string) {
    if (path === tab.href) return true;
    return (tab.match ?? 'prefix') === 'prefix' && path.startsWith(`${tab.href}/`);
}

/**
 * Route tabs (project header): a nav of links, the current one marked aria-current="page" with
 * the prototype's accent underline. Not an ARIA tablist — each tab is a separate page.
 */
export function LinkTabs({ tabs, currentPath, className, 'aria-label': ariaLabel }: LinkTabsProps) {
    const pathname = usePathname();
    const path = currentPath ?? pathname;

    return (
        <nav aria-label={ariaLabel} className={clsx('tm-tabs', className)}>
            {tabs.map((tab) => (
                <Link
                    key={tab.href}
                    href={tab.href}
                    className="tm-tab"
                    aria-current={isActive(tab, path) ? 'page' : undefined}
                >
                    {tab.label}
                </Link>
            ))}
        </nav>
    );
}
