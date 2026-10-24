import createClient, { removeTrailingSlash, type Middleware } from 'openapi-fetch';

import { sessionEnded } from '@/lib/auth/sessionEnded';
import { refreshSession } from '@/lib/auth/refresh';
import { sessionStore, validAccessToken } from '@/lib/auth/store';
import { env } from '@/lib/env';

import { ERROR_CODES, isApiError, networkError, toApiError } from './errors';
import type { PageMeta, paths } from './types';

/** Returns the current access token, or null when signed out. */
export type AccessTokenGetter = () => string | null | Promise<string | null>;

type ApiClientOptions = {
    /** API origin, e.g. http://localhost:3000. The spec's paths already start with /api/v1. */
    baseUrl: string;
    getAccessToken: AccessTokenGetter;
    /**
     * Called on 401 TOKEN_EXPIRED with the token the request was sent with. Resolve to a token
     * to retry with, or null to give up. Omit to disable refresh-and-retry.
     */
    onTokenExpired?: (staleToken: string | null) => Promise<string | null>;
    /** Called when a 401 can't be recovered: the session is over. */
    onUnauthorized?: () => void;
    /**
     * After onTokenExpired gave no token: whether that ended the session (the refresh was
     * rejected). If not (rate limited, API down), the request just fails and the user stays
     * signed in. Omit to treat every failed refresh as the end of the session.
     */
    isSessionOver?: () => boolean;
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** This app's own auth route handlers — never refreshed or retried (they *are* the refresh). */
const isAuthRoute = (url: string) => new URL(url).pathname.startsWith('/api/auth/');

/** Typed openapi-fetch client for the TaskMaster API. */
export function createApiClient({
    baseUrl,
    getAccessToken,
    onTokenExpired,
    onUnauthorized,
    isSessionOver,
}: ApiClientOptions) {
    const client = createClient<paths>({
        baseUrl: removeTrailingSlash(baseUrl),
        // Look fetch up per request (openapi-fetch otherwise captures it once at creation),
        // so test interceptors and polyfills installed later still apply.
        fetch: (request) => globalThis.fetch(request),
        // The spec declares array query params (status, priority) as `style: form,
        // explode: false` — `priority=URGENT,HIGH`. openapi-fetch's default repeats the key,
        // which the API rejects with a 422.
        querySerializer: { array: { style: 'form', explode: false } },
    });

    /**
     * Per request (by openapi-fetch's request id): an unsent copy — fetch consumes the
     * original's body, so a POST/PATCH can only be retried from a clone — and the token used.
     */
    const pending = new Map<string, { retry: Request; token: string | null }>();

    const auth: Middleware = {
        async onRequest({ request, id }) {
            let token: string | null = null;
            if (!request.headers.has('Authorization')) {
                token = await getAccessToken();
                if (token) request.headers.set('Authorization', `Bearer ${token}`);
            }
            if (onTokenExpired && !isAuthRoute(request.url)) {
                pending.set(id, { retry: request.clone(), token });
            }
            return request;
        },

        // Refresh-and-retry (DESIGN.md §3).
        async onResponse({ request, response, id }) {
            const entry = pending.get(id);
            pending.delete(id);
            if (response.status !== 401 || !entry || isAuthRoute(request.url)) return undefined;

            const error = await toApiError(response.clone());
            if (error.code === ERROR_CODES.TOKEN_EXPIRED && onTokenExpired) {
                const token = await onTokenExpired(entry.token);
                if (token) {
                    entry.retry.headers.set('Authorization', `Bearer ${token}`);
                    // Sent with fetch directly, not through this middleware: a retry is never
                    // retried again.
                    const retried = await globalThis.fetch(entry.retry);
                    if (retried.status === 401) onUnauthorized?.();
                    return retried;
                }
                // No token: over if the refresh was rejected; a 429 or an outage isn't the end
                // of the session, so this request just fails with its 401.
                if (!isSessionOver || isSessionOver()) onUnauthorized?.();
                return undefined;
            }

            // Any other 401: the session is over.
            onUnauthorized?.();
            return undefined;
        },

        onError({ error, id }) {
            pending.delete(id);
            // fetch() rejected: no response at all. Cancellations stay as they are so
            // TanStack Query can recognise them.
            if (isAbort(error)) return undefined;
            return networkError(error);
        },
    };

    client.use(auth);
    return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

const storeToken: AccessTokenGetter = () => sessionStore.get().accessToken;
let accessTokenGetter: AccessTokenGetter = storeToken;

/** Replace the token source (tests). Defaults to the session store's in-memory token. */
export function setAccessTokenGetter(getter: AccessTokenGetter = storeToken) {
    accessTokenGetter = getter;
}

/** The app's API client, wired to the session: bearer token, refresh-and-retry, sign-out. */
export const api = createApiClient({
    baseUrl: env.NEXT_PUBLIC_API_URL,
    getAccessToken: () => accessTokenGetter(),
    async onTokenExpired(staleToken) {
        // Another request may already have refreshed while this one was in flight.
        const current = validAccessToken();
        if (current && current !== staleToken) return current;
        return refreshSession();
    },
    onUnauthorized: sessionEnded,
    // refresh.ts ends the session only when the refresh is rejected (401 / 4xx, not 429).
    isSessionOver: () => sessionStore.get().status === 'unauthenticated',
});

// ── result helpers ─────────────────────────────────────────────────────────────────────

/** What every openapi-fetch call resolves to. */
type FetchResult<D> =
    | { data: D; error?: never; response: Response }
    | { data?: never; error: unknown; response: Response };

// openapi-fetch types a successful `data` as `Body | undefined` (it can't know the body isn't
// empty); NonNullable strips that so the helpers see the response body itself.

/** The payload inside the API's `{ data }` envelope; undefined for bodiless (204) responses. */
type Payload<D> = [NonNullable<D>] extends [never]
    ? undefined
    : NonNullable<D> extends { data: infer P }
      ? P
      : undefined;

/**
 * Await an API call and return the payload of its `{ data }` envelope (undefined for 204).
 * Throws ApiError for error responses, and for fetch failures (status 0, NETWORK_ERROR).
 *
 *     const project = await unwrap(api.GET('/api/v1/projects/{projectId}', { params }));
 */
export async function unwrap<D>(
    request: Promise<FetchResult<D>> | FetchResult<D>,
): Promise<Payload<D>> {
    const result = await settle(request);
    if (!result.response.ok) throw await toApiError(result.response, result.error);
    const body: unknown = result.data;
    return (isEnvelope(body) ? body.data : undefined) as Payload<D>;
}

type Page<D> =
    NonNullable<D> extends { data: (infer Item)[]; meta: infer Meta }
        ? { items: Item[]; meta: Meta }
        : never;

/**
 * Await a paginated list call and return `{ items, meta }`. Only accepts endpoints whose
 * response has `data: T[]` and `meta` (PageMeta, or NotificationPageMeta with unreadCount).
 *
 *     const { items, meta } = await unwrapPage(api.GET('/api/v1/projects', { params }));
 */
export async function unwrapPage<D extends { data: unknown[]; meta: PageMeta } | undefined>(
    request: Promise<FetchResult<D>> | FetchResult<D>,
): Promise<Page<D>> {
    const result = await settle(request);
    const body = result.data;
    if (!result.response.ok || !body) {
        throw await toApiError(result.response, result.error);
    }
    return { items: body.data, meta: body.meta } as Page<D>;
}

async function settle<R>(request: Promise<R> | R): Promise<R> {
    try {
        return await request;
    } catch (error) {
        // The client's onError already maps fetch failures; this covers other clients.
        if (isApiError(error) || isAbort(error)) throw error;
        throw networkError(error);
    }
}

function isEnvelope(body: unknown): body is { data: unknown } {
    return typeof body === 'object' && body !== null && 'data' in body;
}
