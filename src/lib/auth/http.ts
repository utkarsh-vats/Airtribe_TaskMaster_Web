import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { serverEnv } from '@/lib/env.server';

import type { BackendResult } from './backend';
import { setRefreshCookie } from './cookies';

/** Shared plumbing for the /api/auth/* route handlers (DESIGN.md §3). */

const NO_STORE = { 'cache-control': 'no-store' };

/** Rate-limit headers worth passing back to the browser on a forwarded error. */
const FORWARDED_HEADERS = ['retry-after', 'ratelimit', 'ratelimit-policy'];

export function json(status: number, body: unknown): NextResponse {
    return NextResponse.json(body, { status, headers: NO_STORE });
}

export function noContent(): NextResponse {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
}

/** An error in the API's own envelope, for failures that start in these handlers. */
export function errorResponse(status: number, code: ErrorCode, message: string): NextResponse {
    return json(status, { error: { code, message, requestId: crypto.randomUUID() } });
}

const envelopeSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/**
 * Relay a failed API response: same status and error body. When the API couldn't be reached
 * (status 0) or answered with something that isn't the envelope, send our own envelope.
 */
export function passThrough(result: BackendResult): NextResponse {
    if (result.status === 0) {
        return errorResponse(502, ERROR_CODES.INTERNAL_ERROR, "Couldn't reach the TaskMaster API.");
    }
    const response = envelopeSchema.safeParse(result.body).success
        ? json(result.status, result.body)
        : errorResponse(
              result.status,
              ERROR_CODES.INTERNAL_ERROR,
              'Unexpected response from the API.',
          );
    for (const name of FORWARDED_HEADERS) {
        const value = result.headers.get(name);
        if (value) response.headers.set(name, value);
    }
    return response;
}

/**
 * CSRF guard: these handlers act on a cookie, so only accept requests the app itself sent.
 * Browsers always send Origin on cross-origin and same-origin POSTs; a missing one is refused.
 */
export function rejectForeignOrigin(request: NextRequest): NextResponse | null {
    const origin = request.headers.get('origin');
    const expected = serverEnv.APP_ORIGIN
        ? new URL(serverEnv.APP_ORIGIN).origin
        : new URL(request.url).origin;
    if (origin && origin === expected) return null;
    return errorResponse(403, ERROR_CODES.FORBIDDEN, 'Cross-origin request refused.');
}

/**
 * Parse the request body for shape only (strings present). Real validation is the API's, so
 * its 422 details reach the forms. Returns the picked fields, or a 400 response.
 */
export async function readBody<S extends z.ZodType>(
    request: Request,
    schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
    const raw: unknown = await request.json().catch(() => undefined);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { ok: true, data: parsed.data };
    return {
        ok: false,
        response: errorResponse(400, ERROR_CODES.BAD_REQUEST, 'Invalid request body.'),
    };
}

export const loginResultSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
    user: z.looseObject({ id: z.string() }),
});

export const tokensSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
});

export const userSchema = z.looseObject({ id: z.string(), email: z.string(), name: z.string() });

/** The `data` of a successful API response, if it matches `schema`. */
export function dataOf<S extends z.ZodType>(result: BackendResult, schema: S): z.infer<S> | null {
    const envelope = z.object({ data: z.unknown() }).safeParse(result.body);
    if (!envelope.success) return null;
    const parsed = schema.safeParse(envelope.data.data);
    return parsed.success ? parsed.data : null;
}

/**
 * The session body the browser gets: `{ data: { accessToken, expiresIn, user } }`. The refresh
 * token goes only into the httpOnly cookie, never into a body.
 */
export function sessionResponse(
    status: number,
    session: { accessToken: string; refreshToken: string; expiresIn: number; user: unknown },
): NextResponse {
    const { accessToken, expiresIn, user } = session;
    const response = json(status, { data: { accessToken, expiresIn, user } });
    setRefreshCookie(response, session.refreshToken);
    return response;
}
