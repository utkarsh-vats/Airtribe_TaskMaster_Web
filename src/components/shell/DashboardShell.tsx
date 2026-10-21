'use client';

import { usePathname } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';

import { Drawer } from '@/components/ui/Sheet';

import { DashboardHeader } from './DashboardHeader';
import { SidebarNav } from './SidebarNav';

/**
 * The signed-in app's frame (DESIGN.md §6): sticky header, a sidebar from 820px, the same
 * navigation in a drawer below that, and the page.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    // The drawer is open for the path it was opened on, so any navigation closes it.
    const [drawerPath, setDrawerPath] = useState<string | null>(null);
    const drawerOpen = drawerPath === pathname;
    const closeDrawer = () => setDrawerPath(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);

    return (
        <div className="flex min-h-screen flex-col">
            <DashboardHeader
                onOpenNav={() => setDrawerPath(pathname)}
                menuButtonRef={menuButtonRef}
            />
            <div className="grid flex-1 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
                <aside
                    aria-label="Sidebar"
                    className="sticky top-[var(--tm-header-h)] hidden h-[calc(100dvh-var(--tm-header-h))] overflow-y-auto border-r-rule border-divider p-4 md:block"
                >
                    <SidebarNav />
                </aside>
                <main className="min-w-0 p-6">{children}</main>
            </div>
            <Drawer
                open={drawerOpen}
                onOpenChange={(open) => (open ? setDrawerPath(pathname) : closeDrawer())}
                title="Navigation"
                returnFocusTo={menuButtonRef}
            >
                <SidebarNav onNavigate={closeDrawer} />
            </Drawer>
        </div>
    );
}
