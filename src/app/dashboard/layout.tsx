import type { ReactNode } from 'react';

import { DashboardHeader } from '@/components/shell/DashboardHeader';
import { SessionProvider } from '@/lib/auth/SessionProvider';

// SessionProvider restores the session (or redirects to /login) before any of it renders.
// The sidebar and mobile drawer are placeholders until step 5b.
export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <SessionProvider>
            <div className="flex min-h-screen flex-col">
                <DashboardHeader />
                <div className="grid flex-1 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
                    <aside
                        aria-label="Sidebar"
                        className="hidden border-r-rule border-divider p-4 md:block"
                    >
                        <h6 className="text-muted m-0">Projects</h6>
                    </aside>
                    <main className="min-w-0 p-6">{children}</main>
                </div>
            </div>
        </SessionProvider>
    );
}
