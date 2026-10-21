import type { NextRequest } from 'next/server';

import { backendPost } from '@/lib/auth/backend';
import { clearRefreshCookie, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { noContent, rejectForeignOrigin } from '@/lib/auth/http';

/** Sign out this browser: revoke the refresh token if we can, and always drop the cookie. */
export async function POST(request: NextRequest) {
    const foreign = rejectForeignOrigin(request);
    if (foreign) return foreign;

    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (refreshToken) {
        // Best effort: a failure here must not keep the user signed in locally.
        await backendPost('/api/v1/auth/logout', { incoming: request, body: { refreshToken } });
    }

    const response = noContent();
    clearRefreshCookie(response);
    return response;
}
