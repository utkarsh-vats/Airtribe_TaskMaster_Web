import { toApiError } from '@/lib/api/errors';
import type { User } from '@/lib/api/types';

import { postAuth } from './authFetch';
import { endSession, readSession, startSession } from './refresh';

/**
 * Sign in through /api/auth/login. On success the session is in the store and its refresh is
 * scheduled; on failure throws the ApiError (INVALID_CREDENTIALS, VALIDATION_ERROR with
 * details for the form, RATE_LIMITED, NETWORK_ERROR…).
 */
export async function signIn(email: string, password: string): Promise<User> {
    const response = await postAuth('login', { body: { email, password } });
    if (!response.ok) throw await toApiError(response);
    const session = await readSession(response);
    if (!session) throw await toApiError(response, null);
    startSession(session);
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
    return { needsLogin: false, user: session.user };
}

/** Forget the session in this tab only (store + refresh timer). Step 4e adds the server calls. */
export function clearSession() {
    endSession();
}
