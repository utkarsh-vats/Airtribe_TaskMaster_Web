import type { ReactNode } from 'react';

import { BrandMark } from '@/components/shell/BrandMark';
import { ThemeSwitch } from '@/components/shell/ThemeSwitch';

// Placeholder shell — the real header, sidebar and mobile drawer come in step 5.
export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col">
            <header className="nav gap-3">
                <BrandMark href="/dashboard" />
                <ThemeSwitch />
            </header>
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
    );
}
