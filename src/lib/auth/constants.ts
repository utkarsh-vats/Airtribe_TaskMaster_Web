/**
 * Name of the httpOnly cookie holding the refresh token (set by /api/auth/*). Plain module, no
 * `server-only`, so the route guard (src/proxy.ts) can import it too.
 */
export const REFRESH_COOKIE = 'tm_refresh';
