'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';

import { currentPath, loginUrl } from './navigation';
import { refreshSession } from './refresh';
import { sessionStore, type SessionState } from './store';

/** The current session (re-renders on change). */
export function useSession(): SessionState {
    return useSyncExternalStore(
        sessionStore.subscribe,
        sessionStore.get,
        sessionStore.getServerSnapshot,
    );
}

/**
 * Gate for the signed-in app (mounted in src/app/dashboard/layout.tsx only, so marketing and
 * auth pages never rotate the refresh token). After a reload the store is 'unknown': restore
 * the session from the refresh cookie, show a skeleton meanwhile, and send the user to
 * /login?next=… if there's no session. If the API can't be reached, offer a retry instead of
 * signing out.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
    const session = useSession();
    const router = useRouter();
    const [unavailable, setUnavailable] = useState(false);
    const [retrying, setRetrying] = useState(false);

    // Still 'unknown' after a refresh means 5xx / network, not "signed out".
    const restore = () => refreshSession().then(() => sessionStore.get().status === 'unknown');

    useEffect(() => {
        if (sessionStore.get().status !== 'unknown') return;
        let active = true;
        // Strict Mode runs this twice; refreshSession() shares the one in-flight request.
        void restore().then((failed) => {
            if (active) setUnavailable(failed);
        });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (session.status === 'unauthenticated') router.replace(loginUrl(currentPath()));
    }, [session.status, router]);

    if (session.status === 'authenticated') return children;

    if (unavailable) {
        return (
            <div className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center p-6">
                <ErrorState
                    title="Can't reach TaskMaster"
                    message="We couldn't restore your session. Check your connection and try again."
                    retrying={retrying}
                    onRetry={() => {
                        setRetrying(true);
                        void restore().then((failed) => {
                            setUnavailable(failed);
                            setRetrying(false);
                        });
                    }}
                />
            </div>
        );
    }

    return <SessionSkeleton />;
}

function SessionSkeleton() {
    return (
        <div aria-busy="true" className="flex min-h-screen flex-col">
            <span role="status" className="sr-only">
                Loading your session…
            </span>
            <div className="flex items-center gap-3 border-b-rule border-divider px-4 py-3">
                <Skeleton width={120} height={18} />
                <Skeleton width={60} height={30} className="ml-auto" />
            </div>
            <div className="grid flex-1 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
                <div className="hidden flex-col gap-3 border-r-rule border-divider p-4 md:flex">
                    <Skeleton width="50%" />
                    <Skeleton />
                    <Skeleton width="80%" />
                </div>
                <div className="flex flex-col gap-4 p-6">
                    <Skeleton width={240} height={32} />
                    <Skeleton />
                    <Skeleton width="70%" />
                </div>
            </div>
        </div>
    );
}
