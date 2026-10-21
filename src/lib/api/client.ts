import createClient, { removeTrailingSlash, type Middleware } from 'openapi-fetch';

import { env } from '@/lib/env';

import { isApiError, networkError, toApiError } from './errors';
import type { PageMeta, paths } from './types';

/** Returns the current access token, or null when signed out. */
export type AccessTokenGetter = () => string | null | Promise<string | null>;

type ApiClientOptions = {
    /** API origin, e.g. http://localhost:3000. The spec's paths already start with /api/v1. */
    baseUrl: string;
    getAccessToken: AccessTokenGetter;
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Typed openapi-fetch client for the TaskMaster API. */
export function createApiClient({ baseUrl, getAccessToken }: ApiClientOptions) {
    const client = createClient<paths>({
        baseUrl: removeTrailingSlash(baseUrl),
        // Look fetch up per request (openapi-fetch otherwise captures it once at creation),
        // so test interceptors and polyfills installed later still apply.
        fetch: (request) => globalThis.fetch(request),
    });

    const auth: Middleware = {
        async onRequest({ request }) {
            if (request.headers.has('Authorization')) return request;
            const token = await getAccessToken();
            if (token) request.headers.set('Authorization', `Bearer ${token}`);
            return request;
        },

        // ── Extension point (step 4b, DESIGN.md §3) ─────────────────────────────────────
        // async onResponse({ request, response }) {
        //   On 401 with code TOKEN_EXPIRED: await the single-flight refresh (shared by
        //   concurrent 401s in this tab, Web Locks across tabs), then retry `request` once
        //   with the new token and return that response. Any other 401, or a failed
        //   refresh → clear the session and redirect to /login?next=<path>.
        // },
        // ────────────────────────────────────────────────────────────────────────────────

        onError({ error }) {
            // fetch() rejected: no response at all. Cancellations stay as they are so
            // TanStack Query can recognise them.
            if (isAbort(error)) return;
            return networkError(error);
        },
    };

    client.use(auth);
    return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

let accessTokenGetter: AccessTokenGetter = () => null;

/** Plug in the session's token source (step 4b). Until then requests go out unauthenticated. */
export function setAccessTokenGetter(getter: AccessTokenGetter) {
    accessTokenGetter = getter;
}

/** The app's API client. */
export const api = createApiClient({
    baseUrl: env.NEXT_PUBLIC_API_URL,
    getAccessToken: () => accessTokenGetter(),
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
