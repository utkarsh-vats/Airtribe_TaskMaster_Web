import { toast } from 'sonner';

import { toApiError } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';
import type { User } from '@/lib/api/types';
import { getQueryClient } from '@/lib/query/client';

import { postAuth } from './authFetch';
import { broadcastAuth } from './broadcast';
import { authNavigation, type Navigate } from './navigation';
import { endSession, readSession, refreshSession, startSession } from './refresh';
import { validAccessToken } from './store';

/**
 * Sign in through /api/auth/login. On success the session is in the store, its refresh is
 * scheduled and other tabs are told; on failure throws the ApiError (INVALID_CREDENTIALS,
 * VALIDATION_ERROR with details for the form, RATE_LIMITED, NETWORK_ERROR…).
 */
export async function signIn(email: string, password: string): Promise<User> {
    const response = await postAuth('login', { body: { email, password } });
    if (!response.ok) throw await toApiError(response);
    const session = await readSession(response);
    if (!session) throw await toApiError(response, null);
    startSession(session);
    broadcastAuth('signed-in');
    return session.user;
}

export type RegisterResult = { needsLogin: false; user: User } | { needsLogin: true };

/**
 * Create an account through /api/auth/register, which also signs in. `needsLogin` means the
 * account exists but the automatic sign-in failed: send the user to /login.
 */
export async function register(
    name: string,
    email: string,
    password: string,
): Promise<RegisterResult> {
    const response = await postAuth('register', { body: { name, email, password } });
    if (!response.ok) throw await toApiError(response);
    const session = await readSession(response);
    if (!session) return { needsLogin: true };
    startSession(session);
    broadcastAuth('signed-in');
    return { needsLogin: false, user: session.user };
}

/** Forget the session in this tab only (store + refresh timer). */
export function clearSession() {
    endSession();
}

// ── sign out ──────────────────────────────────────────────────────────────────────────

const fullPageLoad: Navigate = (path) => authNavigation.assign(path);

let leaving = false;
let signingOut: Promise<void> | null = null;

/**
 * True once this tab is deliberately signing out, so SessionProvider doesn't also redirect to
 * /login?next=… when the store turns unauthenticated.
 */
export function isSigningOut() {
    return leaving;
}

/** Local half of every sign-out: session, cached data (it belongs to that user), /login. */
export function endLocalSession(navigate: Navigate = fullPageLoad) {
    leaving = true;
    clearSession();
    getQueryClient().clear();
    navigate('/login');
}

type SignOutOptions = {
    /** Defaults to a full page load. Pass router.replace to keep toasts on screen. */
    navigate?: Navigate;
};

/**
 * Sign out of this browser: /api/auth/logout revokes the refresh token and clears the cookie
 * (failures ignored — the route clears the cookie either way), then the local sign-out, and
 * other tabs are told. Calling it again while it runs returns the same promise.
 */
export function signOut({ navigate }: SignOutOptions = {}): Promise<void> {
    signingOut ??= (async () => {
        try {
            await postAuth('logout');
        } catch {
            // Best effort: the user is signed out locally regardless.
        }
        broadcastAuth('signed-out');
        endLocalSession(navigate);
    })();
    return signingOut;
}

export const SIGNED_OUT_EVERYWHERE = 'Signed out on all devices.';
export const SIGNED_OUT_HERE_ONLY =
    'Signed out on this device. Sign in again to sign out everywhere.';

/** An access token that stays valid this long is used as is; otherwise refresh first. */
const FRESH_FOR_MS = 30_000;

export type SignOutEverywhereResult = 'everywhere' | 'this-device' | 'failed';

/**
 * Revoke every session of this user (/api/auth/logout-all, which needs the access token).
 * The token is refreshed first if it's missing or about to expire, so the call doesn't fail
 * with a 401 halfway:
 *   204                → signed out everywhere (toast)
 *   401 / no token     → signed out on this device only (toast explains)
 *   network / 5xx      → nothing happened server-side: stay signed in, error toast
 */
export async function signOutEverywhere({
    navigate,
}: SignOutOptions = {}): Promise<SignOutEverywhereResult> {
    const token = validAccessToken(Date.now() + FRESH_FOR_MS) ?? (await refreshSession());
    if (!token) {
        await signOut({ navigate });
        toast(SIGNED_OUT_HERE_ONLY);
        return 'this-device';
    }

    let response: Response;
    try {
        response = await postAuth('logout-all', { accessToken: token });
    } catch (error) {
        notifyError(error);
        return 'failed';
    }

    if (response.status === 204 || response.status === 401) {
        // The route has cleared the cookie in both cases.
        broadcastAuth('signed-out');
        endLocalSession(navigate);
        if (response.status === 204) toast.success(SIGNED_OUT_EVERYWHERE);
        else toast(SIGNED_OUT_HERE_ONLY);
        return response.status === 204 ? 'everywhere' : 'this-device';
    }

    notifyError(await toApiError(response));
    return 'failed';
}

/** Tests only. */
export function resetSignOutForTests() {
    leaving = false;
    signingOut = null;
}
