import { isServer, QueryClient } from '@tanstack/react-query';

import { ERROR_CODES, isApiError } from '@/lib/api/errors';

/** Retries after the first failure: 2 → at most 3 attempts. */
export const MAX_QUERY_RETRIES = 2;

/**
 * Whether a failed query is worth retrying: only when the request never got an answer
 * (NETWORK_ERROR) or the server failed (5xx). 4xx answers won't change on retry, and
 * TOKEN_EXPIRED is handled by the client's refresh middleware (step 4b), not here.
 */
export function isRetryableError(error: unknown): boolean {
    if (!isApiError(error)) return false;
    return error.code === ERROR_CODES.NETWORK_ERROR || error.status >= 500;
}

/** TanStack's `retry` callback: `failureCount` is the number of failures before this one. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    return failureCount < MAX_QUERY_RETRIES && isRetryableError(error);
}

export function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                // Above 0 so data rendered on the server isn't refetched straight away.
                staleTime: 30_000,
                refetchOnWindowFocus: true,
                retry: shouldRetryQuery,
            },
            mutations: {
                // Mutations aren't idempotent; a failed one surfaces to the user instead.
                retry: 0,
            },
        },
    });
}

let browserQueryClient: QueryClient | undefined;

/**
 * App Router pattern: a fresh client per server request (so users never share a cache), and one
 * client for the whole browser session (so it survives re-renders and suspense).
 */
export function getQueryClient() {
    if (isServer) return makeQueryClient();
    browserQueryClient ??= makeQueryClient();
    return browserQueryClient;
}
