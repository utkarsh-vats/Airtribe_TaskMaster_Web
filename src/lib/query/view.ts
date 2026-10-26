/*
 * What a query's UI should show (DESIGN.md §7): data on screen is never replaced because a
 * background refetch failed — TanStack keeps the data and flags the error, and the next
 * refetch (focus, reconnect, interval) recovers silently. The error state is only for a first
 * load that failed: no data at all, or only placeholder data (the previous page or filters,
 * a list row standing in for the detail), which isn't an answer for this query.
 */

/** The fields of a TanStack query result this reads. */
type QueryLike<T> = {
    data: T | undefined;
    error: unknown;
    isError: boolean;
    isPlaceholderData?: boolean;
};

export type QueryView<T> =
    { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };

export function queryView<T>(query: QueryLike<T>): QueryView<T> {
    const placeholderFailed = query.isError && query.isPlaceholderData === true;
    if (query.data !== undefined && !placeholderFailed) {
        return { status: 'ready', data: query.data };
    }
    if (query.isError) return { status: 'error', error: query.error };
    return { status: 'loading' };
}
