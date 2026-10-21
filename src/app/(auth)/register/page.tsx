import type { Metadata } from 'next';

import { RegisterForm } from '@/features/auth/components/RegisterForm';

export const metadata: Metadata = { title: 'Create account' };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function RegisterPage({ searchParams }: PageProps<'/register'>) {
    const next = first((await searchParams).next);
    return <RegisterForm next={next} />;
}
