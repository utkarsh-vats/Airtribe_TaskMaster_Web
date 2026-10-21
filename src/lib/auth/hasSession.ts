import 'server-only';

import { cookies } from 'next/headers';

import { REFRESH_COOKIE } from './constants';

export { REFRESH_COOKIE };

/**
 * Whether the request carries a refresh cookie. Presence only — the API decides whether the
 * session is still valid. Reading cookies makes the calling route dynamic. Same rule as the
 * route guard (src/proxy.ts): an empty value counts as no cookie.
 */
export async function hasSession(): Promise<boolean> {
    const cookieStore = await cookies();
    return Boolean(cookieStore.get(REFRESH_COOKIE)?.value);
}
