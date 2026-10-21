import { describe, expect, it } from 'vitest';

import { ApiError, ERROR_CODES, networkError } from '@/lib/api/errors';
import { makeQueryClient, shouldRetryQuery } from '@/lib/query/client';

const httpError = (status: number, code: string) => new ApiError({ status, code, message: code });

/** Run a query whose fn always throws `error`; return how many times it was called. */
async function attempts(error: unknown) {
    const client = makeQueryClient();
    let calls = 0;
    await client
        .fetchQuery({
            queryKey: ['retry-test'],
            queryFn: () => {
                calls += 1;
                throw error;
            },
            // Keep the defaults' `retry`, but don't wait between attempts.
            retryDelay: 0,
        })
        .catch(() => undefined);
    client.clear();
    return calls;
}

describe('query retry policy', () => {
    it('retries NETWORK_ERROR twice (3 attempts)', async () => {
        expect(await attempts(networkError(new TypeError('fetch failed')))).toBe(3);
    });

    it('retries a 500 twice (3 attempts)', async () => {
        expect(await attempts(httpError(500, ERROR_CODES.INTERNAL_ERROR))).toBe(3);
    });

    it.each([
        [404, ERROR_CODES.NOT_FOUND],
        [422, ERROR_CODES.VALIDATION_ERROR],
        [401, ERROR_CODES.TOKEN_EXPIRED],
        [403, ERROR_CODES.FORBIDDEN],
    ])('never retries a %i', async (status, code) => {
        expect(await attempts(httpError(status, code))).toBe(1);
    });

    it('never retries errors that are not ApiErrors', () => {
        expect(shouldRetryQuery(0, new Error('boom'))).toBe(false);
    });

    it('does not retry mutations', () => {
        expect(makeQueryClient().getDefaultOptions().mutations?.retry).toBe(0);
    });

    it('uses the agreed query defaults', () => {
        const queries = makeQueryClient().getDefaultOptions().queries;
        expect(queries?.staleTime).toBe(30_000);
        expect(queries?.refetchOnWindowFocus).toBe(true);
    });
});
