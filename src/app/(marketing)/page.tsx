import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { HeroStatement } from '@/components/shell/HeroStatement';

export const metadata: Metadata = { title: 'Coming soon' };

// Temporary landing page — replaced by a real marketing page later (see DESIGN.md §12).
export default function LandingPage() {
    return (
        <section className="flex flex-1 flex-col justify-between gap-8 bg-accent p-6 text-bg md:p-8">
            <span className="tag self-start border border-bg text-bg">Coming soon</span>
            <HeroStatement>
                <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                        href="/register"
                        className="btn justify-between gap-6 bg-bg px-[14px] py-3 text-accent-700 hover:bg-surface"
                    >
                        Create account
                        <ArrowRight aria-hidden size={16} />
                    </Link>
                    <Link
                        href="/login"
                        className="btn border-bg px-[14px] py-3 text-bg hover:bg-bg/10"
                    >
                        Sign in
                    </Link>
                </div>
            </HeroStatement>
        </section>
    );
}
