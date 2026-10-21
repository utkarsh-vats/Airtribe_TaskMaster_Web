import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sign in' };

// Placeholder — the real form comes in step 4.
export default function LoginPage() {
    return (
        <>
            <h2 className="m-0">Welcome back</h2>
            <p className="text-muted m-0">Sign-in form coming soon.</p>
            <p className="m-0 text-sm">
                New here? <Link href="/register">Create an account</Link>
            </p>
        </>
    );
}
