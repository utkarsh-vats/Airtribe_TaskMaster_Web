import { isApiError } from '@/lib/api/errors';

import { postAuth } from './authFetch';
import { sessionStore, validAccessToken, type SessionPayload } from './store';

/*
 * Session refresh (DESIGN.md §3). The backend treats a reused refresh token as theft and
 * revokes every session, so refreshes must never overlap:
 *   - within a tab, concurrent callers share one in-flight promise;
 *   - across tabs, the request runs under the Web Lock 'tm-refresh', so the next tab to get
 *     the lock sends the cookie the previous tab already rotated.
 */

const LOCK_NAME = 'tm-refresh';
/** Refresh this long before the access token expires (or halfway, for very short tokens). */
const REFRESH_LEAD_MS = 60_000;
/** After a failed proactive refresh (API down), try again this much later. */
const RETRY_AFTER_FAILURE_MS = 30_000;

let inFlight: Promise<string | null> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Get a fresh access token from the refresh cookie. Resolves to the new token, or null:
 *   - 401 / 4xx (session over) → store becomes unauthenticated;
 *   - 5xx / network (try later) → store unchanged — a user with a valid token stays signed
 *     in, and a session being restored stays 'unknown' (SessionProvider offers a retry).
 */
export function refreshSession(): Promise<string | null> {
    inFlight ??= withRefreshLock(requestRefresh).finally(() => {
        inFlight = null;
    });
    return inFlight;
}

async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? await locks.request(LOCK_NAME, task) : await task();
}

async function requestRefresh(): Promise<string | null> {
    let response: Response;
    try {
        response = await postAuth('refresh');
    } catch (error) {
        if (!isApiError(error)) throw error;
        return keepSessionForNow();
    }

    if (response.ok) {
        const payload = await readSession(response);
        if (payload) {
            startSession(payload);
            return payload.accessToken;
        }
        return keepSessionForNow();
    }
    if (response.status >= 400 && response.status < 500) {
        endSession();
        return null;
    }
    return keepSessionForNow();
}

/** A transient failure: change nothing; if signed in, try again shortly. */
function keepSessionForNow(): null {
    if (validAccessToken()) schedule(RETRY_AFTER_FAILURE_MS);
    return null;
}

/** Parse a session body from /api/auth/login, /register or /refresh. */
export async function readSession(response: Response): Promise<SessionPayload | null> {
    const body: unknown = await response.json().catch(() => null);
    if (typeof body !== 'object' || body === null || !('data' in body)) return null;
    const data = body.data;
    if (
        typeof data === 'object' &&
        data !== null &&
        'accessToken' in data &&
        typeof data.accessToken === 'string' &&
        'expiresIn' in data &&
        typeof data.expiresIn === 'number' &&
        'user' in data &&
        typeof data.user === 'object' &&
        data.user !== null
    ) {
        return data as SessionPayload;
    }
    return null;
}

/** Put a new session in the store and schedule its proactive refresh. */
export function startSession(payload: SessionPayload) {
    sessionStore.setAuthenticated(payload);
    const lead = Math.min(REFRESH_LEAD_MS, (payload.expiresIn * 1000) / 2);
    schedule(payload.expiresIn * 1000 - lead);
}

/** Forget the session locally (no server call) and cancel the scheduled refresh. */
export function endSession() {
    cancelScheduledRefresh();
    sessionStore.setUnauthenticated();
}

/** One timer at a time: each new session or retry replaces the previous one. */
function schedule(delayMs: number) {
    cancelScheduledRefresh();
    timer = setTimeout(
        () => {
            timer = undefined;
            void refreshSession();
        },
        Math.max(0, delayMs),
    );
}

export function cancelScheduledRefresh() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
}

/** Tests only: forget any in-flight refresh and the scheduled one. */
export function resetRefreshForTests() {
    inFlight = null;
    cancelScheduledRefresh();
}
