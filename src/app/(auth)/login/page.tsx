import type { Metadata } from 'next';

import { LoginForm } from '@/features/auth/components/LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

/** First value of a search param that may repeat. */
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
    // Raw `next`: carried through the switch as-is; LoginForm only ever navigates to safeNext(next).
    const next = first((await searchParams).next);
    return <LoginForm next={next} />;
}
