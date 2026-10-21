import Link from 'next/link';
import type { ReactNode } from 'react';

import { HeroStatement } from '@/components/shell/HeroStatement';

// The prototype's split auth screen: accent panel left, form column right; stacks below 720px.
export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]">
            <div className="flex min-h-[280px] flex-col justify-between gap-8 bg-accent p-8 text-bg">
                <Link
                    href="/"
                    className="self-start font-heading text-[18px] font-extrabold text-bg no-underline hover:text-bg"
                >
                    TaskMaster
                </Link>
                <HeroStatement />
            </div>
            <main className="flex flex-col justify-center p-8">
                <div className="flex w-full max-w-[400px] flex-col gap-4">{children}</div>
            </main>
        </div>
    );
}
