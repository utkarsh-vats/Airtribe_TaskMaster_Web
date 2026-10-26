import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import { expect, vi } from 'vitest';

/**
 * Refetch `queryKey` (the caller has made its next response fail), wait until the query is in
 * error, then let TanStack's batched notification (a 0 ms timer) re-render, so the DOM shows
 * what the UI does with "data, but the latest refetch failed".
 */
export async function refetchAndFail(client: QueryClient, queryKey: QueryKey) {
    await act(() => client.invalidateQueries({ queryKey }));
    await vi.waitFor(() => expect(client.getQueryState(queryKey)?.status).toBe('error'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}
