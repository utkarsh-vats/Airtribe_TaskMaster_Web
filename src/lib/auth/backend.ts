import 'server-only';

import { serverEnv } from '@/lib/env.server';

/**
 * Server-side calls from the auth route handlers to the TaskMaster API (API_URL).
 * Nothing here logs: request bodies and responses carry passwords and tokens.
 */

export type BackendResult = {
    /** HTTP status, or 0 when the API couldn't be reached. */
    status: number;
    /** Parsed JSON body; undefined when empty or not JSON. */
    body: unknown;
    headers: Headers;
};

type BackendOptions = {
    /** The browser's request to our handler: used for the client IP. */
    incoming: Request;
    body?: unknown;
    accessToken?: string;
    /** Forwarded as-is (logout-all); takes precedence over accessToken. */
    authorization?: string;
};

const TIMEOUT_MS = 10_000;

/** First address of the incoming X-Forwarded-For (the original client), if any. */
function clientIp(incoming: Request): string | undefined {
    const first = incoming.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return first || undefined;
}

/** POST to the API. Never throws: network failures come back as status 0. */
export async function backendPost(path: string, options: BackendOptions): Promise<BackendResult> {
    return backendFetch('POST', path, options);
}

export async function backendGet(path: string, options: BackendOptions): Promise<BackendResult> {
    return backendFetch('GET', path, options);
}

async function backendFetch(
    method: 'GET' | 'POST',
    path: string,
    { incoming, body, accessToken, authorization }: BackendOptions,
): Promise<BackendResult> {
    const headers = new Headers({ accept: 'application/json' });
    if (body !== undefined) headers.set('content-type', 'application/json');
    const auth = authorization ?? (accessToken ? `Bearer ${accessToken}` : undefined);
    if (auth) headers.set('authorization', auth);
    // So the API's rate limiter sees the user, not this server (DESIGN.md §3).
    const ip = clientIp(incoming);
    if (ip) headers.set('x-forwarded-for', ip);

    let response: Response;
    try {
        response = await fetch(new URL(path, serverEnv.API_URL), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        return { status: 0, body: undefined, headers: new Headers() };
    }

    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    } catch {
        parsed = undefined;
    }
    return { status: response.status, body: parsed, headers: response.headers };
}
