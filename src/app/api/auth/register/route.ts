import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { backendPost } from '@/lib/auth/backend';
import {
    dataOf,
    json,
    loginResultSchema,
    passThrough,
    readBody,
    rejectForeignOrigin,
    sessionResponse,
    userSchema,
} from '@/lib/auth/http';

const bodySchema = z.object({ email: z.string(), password: z.string(), name: z.string() });

/**
 * Create an account, then sign straight in with the same credentials. 201 with a session like
 * /login; if that login fails, 201 `{ user, accessToken: null }` so the client sends the user
 * to /login.
 */
export async function POST(request: NextRequest) {
    const foreign = rejectForeignOrigin(request);
    if (foreign) return foreign;

    const body = await readBody(request, bodySchema);
    if (!body.ok) return body.response;

    const registered = await backendPost('/api/v1/auth/register', {
        incoming: request,
        body: body.data,
    });
    const user = registered.status === 201 ? dataOf(registered, userSchema) : null;
    if (!user) return passThrough(registered);

    const { email, password } = body.data;
    const login = await backendPost('/api/v1/auth/login', {
        incoming: request,
        body: { email, password },
    });
    const session = login.status === 200 ? dataOf(login, loginResultSchema) : null;
    if (session) return sessionResponse(201, session);

    return json(201, { data: { user, accessToken: null } });
}
