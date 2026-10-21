import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandMark } from '@/components/shell/BrandMark';
import { ThemeSwitch } from '@/components/shell/ThemeSwitch';
import { hasSession } from '@/lib/auth/hasSession';

export default async function MarketingLayout({ children }: { children: ReactNode }) {
    const signedIn = await hasSession();

    return (
        <div className="flex min-h-screen flex-col">
            <header className="nav flex-wrap gap-3">
                <BrandMark href="/" />
                <ThemeSwitch />
                <nav aria-label="Account" className="flex items-center gap-2">
                    {signedIn ? (
                        <Link href="/dashboard" className="btn btn-primary">
                            <span className="max-[479px]:hidden">Go to dashboard</span>
                            <span className="min-[480px]:hidden">Dashboard</span>
                        </Link>
                    ) : (
                        <>
                            <Link href="/login" className="btn btn-ghost">
                                Sign in
                            </Link>
                            {/* Below 480px the hero's CTA covers this; keeps the bar on one row. */}
                            <Link href="/register" className="btn btn-primary max-[479px]:hidden">
                                Create account
                            </Link>
                        </>
                    )}
                </nav>
            </header>

            <main className="flex flex-1 flex-col">{children}</main>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t-rule border-divider px-4 py-3 text-sm">
                <span className="text-muted">© {new Date().getFullYear()} TaskMaster</span>
                <a href="https://github.com/utkarsh-vats/Airtribe_TaskMaster">GitHub</a>
            </footer>
        </div>
    );
}
