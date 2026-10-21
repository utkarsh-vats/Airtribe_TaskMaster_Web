import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Create account' };

// Placeholder — the real form comes in step 4.
export default function RegisterPage() {
    return (
        <>
            <h2 className="m-0">Start with a project</h2>
            <p className="text-muted m-0">Sign-up form coming soon.</p>
            <p className="m-0 text-sm">
                Already have an account? <Link href="/login">Sign in</Link>
            </p>
        </>
    );
}
