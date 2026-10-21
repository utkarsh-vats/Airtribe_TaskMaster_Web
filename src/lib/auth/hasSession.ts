import 'server-only';

import { cookies } from 'next/headers';

/** httpOnly cookie holding the refresh token (set by the /api/auth/* route handlers, step 4). */
export const REFRESH_COOKIE = 'tm_refresh';

/**
 * Whether the request carries a refresh cookie. Presence only — the API decides whether the
 * session is still valid. Reading cookies makes the calling route dynamic.
 */
export async function hasSession(): Promise<boolean> {
    const cookieStore = await cookies();
    return cookieStore.has(REFRESH_COOKIE);
}
