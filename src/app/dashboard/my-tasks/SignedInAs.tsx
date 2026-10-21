'use client';

import { useSession } from '@/lib/auth/SessionProvider';

// Placeholder until the real header (step 5a) shows the user.
export function SignedInAs() {
    const { user } = useSession();
    if (!user) return null;
    return (
        <p className="text-muted m-0">
            Signed in as <strong className="text-text">{user.name}</strong>
        </p>
    );
}
