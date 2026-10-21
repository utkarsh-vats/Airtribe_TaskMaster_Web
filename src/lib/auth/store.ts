import type { User } from '@/lib/api/types';

/*
 * The browser's session (DESIGN.md §3): a tiny module-level store read with
 * useSyncExternalStore. The access token lives only here, in memory — never in localStorage,
 * sessionStorage or a readable cookie. A reload loses it; SessionProvider restores it from the
 * httpOnly refresh cookie.
 */

export type SessionStatus = 'unknown' | 'authenticated' | 'unauthenticated';

export type SessionState =
    | { status: 'unknown'; user: null; accessToken: null; expiresAt: null }
    | { status: 'authenticated'; user: User; accessToken: string; expiresAt: number }
    | { status: 'unauthenticated'; user: null; accessToken: null; expiresAt: null };

/** What /api/auth/login, /register and /refresh return. */
export type SessionPayload = { accessToken: string; expiresIn: number; user: User };

const UNKNOWN: SessionState = { status: 'unknown', user: null, accessToken: null, expiresAt: null };
const SIGNED_OUT: SessionState = {
    status: 'unauthenticated',
    user: null,
    accessToken: null,
    expiresAt: null,
};

let state: SessionState = UNKNOWN;
const listeners = new Set<() => void>();

function set(next: SessionState) {
    state = next;
    for (const listener of listeners) listener();
}

export const sessionStore = {
    get: (): SessionState => state,
    /** The server never knows the session (the token is browser memory). */
    getServerSnapshot: (): SessionState => UNKNOWN,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    setAuthenticated(payload: SessionPayload, now = Date.now()) {
        set({
            status: 'authenticated',
            user: payload.user,
            accessToken: payload.accessToken,
            expiresAt: now + payload.expiresIn * 1000,
        });
    },
    setUnauthenticated() {
        set(SIGNED_OUT);
    },
    /** Back to "not checked yet". Tests and full resets only. */
    reset() {
        set(UNKNOWN);
    },
};

/** The current access token, if the store holds one that hasn't expired yet. */
export function validAccessToken(now = Date.now()): string | null {
    return state.status === 'authenticated' && state.expiresAt > now ? state.accessToken : null;
}
