import type { NextRequest } from 'next/server';

import { ERROR_CODES } from '@/lib/api/errors';
import { backendPost } from '@/lib/auth/backend';
import { clearRefreshCookie } from '@/lib/auth/cookies';
import { errorResponse, noContent, passThrough, rejectForeignOrigin } from '@/lib/auth/http';

/**
 * Sign out everywhere: the API revokes every refresh token of the user identified by the
 * access token. Needs the client's Authorization header; the cookie is dropped either way.
 */
export async function POST(request: NextRequest) {
    const foreign = rejectForeignOrigin(request);
    if (foreign) return foreign;

    const authorization = request.headers.get('authorization');
    if (!authorization) {
        return errorResponse(401, ERROR_CODES.UNAUTHORIZED, 'Missing access token.');
    }

    const result = await backendPost('/api/v1/auth/logout-all', {
        incoming: request,
        authorization,
    });

    const response = result.status === 204 ? noContent() : passThrough(result);
    clearRefreshCookie(response);
    return response;
}
