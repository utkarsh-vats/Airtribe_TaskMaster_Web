import { networkError } from '@/lib/api/errors';

/**
 * POST to this app's own /api/auth/* route handlers (same origin, so the httpOnly refresh
 * cookie rides along and the browser sends the Origin header the handlers check).
 * These calls never go through the API client's refresh-and-retry middleware.
 * Throws ApiError NETWORK_ERROR when there's no response.
 */
export async function postAuth(
    path: 'login' | 'register' | 'refresh' | 'logout' | 'logout-all',
    { body, accessToken }: { body?: unknown; accessToken?: string } = {},
): Promise<Response> {
    const headers = new Headers({ accept: 'application/json' });
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

    try {
        // Absolute URL: resolves the same in the browser and under test runners' fetch.
        return await fetch(new URL(`/api/auth/${path}`, window.location.origin), {
            method: 'POST',
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            credentials: 'same-origin',
            cache: 'no-store',
        });
    } catch (error) {
        throw networkError(error);
    }
}
