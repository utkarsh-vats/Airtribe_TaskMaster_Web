import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { backendPost } from '@/lib/auth/backend';
import {
    dataOf,
    loginResultSchema,
    passThrough,
    readBody,
    rejectForeignOrigin,
    sessionResponse,
} from '@/lib/auth/http';

const bodySchema = z.object({ email: z.string(), password: z.string() });

/** Sign in: the API's tokens become `{ accessToken, expiresIn, user }` plus the refresh cookie. */
export async function POST(request: NextRequest) {
    const foreign = rejectForeignOrigin(request);
    if (foreign) return foreign;

    const body = await readBody(request, bodySchema);
    if (!body.ok) return body.response;

    const result = await backendPost('/api/v1/auth/login', { incoming: request, body: body.data });
    const session = result.status === 200 ? dataOf(result, loginResultSchema) : null;
    return session ? sessionResponse(200, session) : passThrough(result);
}
