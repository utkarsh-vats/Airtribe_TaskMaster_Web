import { describe, expect, it } from 'vitest';

import { queryView } from '@/lib/query/view';

const failure = new Error('boom');

describe('queryView', () => {
    it.each([
        ['first load', { data: undefined, error: null, isError: false }, { status: 'loading' }],
        [
            'first load failed',
            { data: undefined, error: failure, isError: true },
            { status: 'error', error: failure },
        ],
        ['loaded', { data: ['a'], error: null, isError: false }, { status: 'ready', data: ['a'] }],
        [
            // The rule: a failed background refetch keeps what's on screen.
            'loaded, then a refetch failed',
            { data: ['a'], error: failure, isError: true },
            { status: 'ready', data: ['a'] },
        ],
        [
            'placeholder (previous page) while the new one loads',
            { data: ['a'], error: null, isError: false, isPlaceholderData: true },
            { status: 'ready', data: ['a'] },
        ],
        [
            // The previous page isn't an answer for this one.
            'placeholder, and the new page failed to load',
            { data: ['a'], error: failure, isError: true, isPlaceholderData: true },
            { status: 'error', error: failure },
        ],
    ])('%s', (_, query, expected) => {
        expect(queryView(query)).toEqual(expected);
    });

    it('falsy data still counts as data', () => {
        expect(queryView({ data: 0, error: failure, isError: true })).toEqual({
            status: 'ready',
            data: 0,
        });
    });
});
