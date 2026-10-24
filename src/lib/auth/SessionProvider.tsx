'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';

import { isSigningOut } from './actions';
import { currentPath, loginUrl } from './navigation';
import { refreshRetryAt, refreshSession } from './refresh';
import { sessionStore, type SessionState } from './store';

/** The current session (re-renders on change). */
export function useSession(): SessionState {
    return useSyncExternalStore(
        sessionStore.subscribe,
        sessionStore.get,
        sessionStore.getServerSnapshot,
    );
}

/** Why a restore couldn't finish: rate limited (retry at `retryAt`) or the API is unreachable. */
type Unavailable = { retryAt: number | null };

/**
 * Restore the session from the cookie. Resolves to null when that settled it (signed in, or
 * signed out), or to why it's still unknown (5xx / network, or a 429 with its retry time).
 */
async function restore(): Promise<Unavailable | null> {
    await refreshSession();
    if (sessionStore.get().status !== 'unknown') return null;
    return { retryAt: refreshRetryAt() };
}

/**
 * Gate for the signed-in app (mounted in src/app/dashboard/layout.tsx only, so marketing and
 * auth pages never rotate the refresh token). After a reload the store is 'unknown': restore
 * the session from the refresh cookie, show a skeleton meanwhile, and send the user to
 * /login?next=… if there's no session. If the API can't be reached, offer a retry instead of
 * signing out; if it's rate limiting, count down and retry by itself (Try again still works).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
    const session = useSession();
    const router = useRouter();
    const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
    const [retrying, setRetrying] = useState(false);

    const retry = useCallback(() => {
        setRetrying(true);
        void restore().then((result) => {
            setUnavailable(result);
            setRetrying(false);
        });
    }, []);

    useEffect(() => {
        if (sessionStore.get().status !== 'unknown') return;
        let active = true;
        // Strict Mode runs this twice; refreshSession() shares the one in-flight request.
        void restore().then((result) => {
            if (active) setUnavailable(result);
        });
        return () => {
            active = false;
        };
    }, []);

    // Rate limited: retry on our own once the wait is over.
    const retryAt = unavailable?.retryAt ?? null;
    useEffect(() => {
        if (retryAt === null) return;
        const id = setTimeout(retry, Math.max(0, retryAt - Date.now()));
        return () => clearTimeout(id);
    }, [retryAt, retry]);

    useEffect(() => {
        // A deliberate sign-out navigates by itself (to /login, without `next`).
        if (session.status === 'unauthenticated' && !isSigningOut()) {
            router.replace(loginUrl(currentPath()));
        }
    }, [session.status, router]);

    if (session.status === 'authenticated') return children;

    if (unavailable) {
        return (
            <div className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center p-6">
                <ErrorState
                    title="Can't reach TaskMaster"
                    message={
                        retryAt !== null ? (
                            <RetryCountdown retryAt={retryAt} />
                        ) : (
                            "We couldn't restore your session. Check your connection and try again."
                        )
                    }
                    retrying={retrying}
                    onRetry={retry}
                />
            </div>
        );
    }

    return <SessionSkeleton />;
}

/** "Too many requests — retrying in {n} s", ticking down each second (never below 1). */
function RetryCountdown({ retryAt }: { retryAt: number }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
    return <>Too many requests — retrying in {seconds} s</>;
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
