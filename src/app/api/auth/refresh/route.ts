import type { NextRequest } from 'next/server';

import { ERROR_CODES } from '@/lib/api/errors';
import { backendGet, backendPost } from '@/lib/auth/backend';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from '@/lib/auth/cookies';
import {
    dataOf,
    errorResponse,
    passThrough,
    rejectForeignOrigin,
    sessionResponse,
    tokensSchema,
    userSchema,
} from '@/lib/auth/http';

/**
 * Exchange the refresh cookie for a new access token (the API rotates the refresh token) and
 * return the session with the current user.
 *
 * The cookie is cleared when the session is over — no cookie, or the API rejects the token
 * (4xx). When the API is down, failing or rate limiting (0 / 5xx / 429) the cookie is kept, so
 * a blip doesn't sign the user out; a 429 passes through with its Retry-After and RateLimit
 * headers, and the client retries later.
 */
export async function POST(request: NextRequest) {
    const foreign = rejectForeignOrigin(request);
    if (foreign) return foreign;

    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) {
        const response = errorResponse(401, ERROR_CODES.UNAUTHORIZED, 'Not signed in.');
        clearRefreshCookie(response);
        return response;
    }

    const refreshed = await backendPost('/api/v1/auth/refresh', {
        incoming: request,
        body: { refreshToken },
    });
    const tokens = refreshed.status === 200 ? dataOf(refreshed, tokensSchema) : null;
    if (!tokens) {
        const response = passThrough(refreshed);
        if (isSessionEnded(refreshed.status)) clearRefreshCookie(response);
        return response;
    }

    const me = await backendGet('/api/v1/users/me', {
        incoming: request,
        accessToken: tokens.accessToken,
    });
    const user = me.status === 200 ? dataOf(me, userSchema) : null;
    if (user) return sessionResponse(200, { ...tokens, user });

    // The old refresh token is spent; keep the rotated one unless the API says it's no good.
    const response = passThrough(me);
    if (isSessionEnded(me.status)) clearRefreshCookie(response);
    else setRefreshCookie(response, tokens.refreshToken);
    return response;
}

/** A 4xx means the token or session is unusable; 0 / 5xx / 429 means try again later. */
function isSessionEnded(status: number) {
    return status >= 400 && status < 500 && status !== 429;
}
