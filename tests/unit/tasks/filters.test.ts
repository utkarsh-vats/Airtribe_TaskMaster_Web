import { describe, expect, it } from 'vitest';

import {
    filtersToSearch,
    hasActiveFilters,
    parseTaskFilters,
    toQueryParams,
    updateFilters,
} from '@/features/tasks/filters';

const parse = (search: string) => parseTaskFilters(new URLSearchParams(search));

describe('parseTaskFilters', () => {
    it('reads valid values', () => {
        expect(parse('status=OPEN&q=hero&page=3')).toEqual({
            status: ['OPEN'],
            q: 'hero',
            page: 3,
        });
    });

    it('defaults to page 1 and no filters', () => {
        expect(parse('')).toEqual({ page: 1 });
    });

    it('reads comma lists and repeated keys, in canonical order without duplicates', () => {
        expect(parse('status=COMPLETED,OPEN,OPEN').status).toEqual(['OPEN', 'COMPLETED']);
        expect(parse('status=IN_PROGRESS&status=OPEN').status).toEqual(['OPEN', 'IN_PROGRESS']);
        expect(parse('status= OPEN , COMPLETED ').status).toEqual(['OPEN', 'COMPLETED']);
    });

    it('drops junk silently, field by field', () => {
        expect(parse('status=DONE')).toEqual({ page: 1 });
        expect(parse('status=DONE,OPEN')).toEqual({ status: ['OPEN'], page: 1 });
        expect(parse('page=-1')).toEqual({ page: 1 });
        expect(parse('page=2.5')).toEqual({ page: 1 });
        expect(parse('page=abc&q=ok')).toEqual({ q: 'ok', page: 1 });
        expect(parse(`q=${'x'.repeat(500)}`)).toEqual({ page: 1 });
        expect(parse('q=%20%20%20')).toEqual({ page: 1 });
        expect(parse('q=%20%20trim%20me%20')).toEqual({ q: 'trim me', page: 1 });
        expect(parse('unknown=1&status=')).toEqual({ page: 1 });
    });

    it('never throws on malformed input', () => {
        expect(() => parse('status=%E0%A4%A&page=%%%')).not.toThrow();
    });
});

describe('updateFilters', () => {
    it('resets the page when a filter changes', () => {
        expect(updateFilters({ page: 4, q: 'a' }, { status: ['OPEN'] })).toEqual({
            page: 1,
            q: 'a',
            status: ['OPEN'],
        });
    });

    it('keeps an explicit page change', () => {
        expect(updateFilters({ page: 1, q: 'a' }, { page: 3 })).toEqual({ page: 3, q: 'a' });
    });

    it('removes cleared filters', () => {
        expect(
            updateFilters(
                { page: 2, status: ['OPEN'], q: 'a' },
                { status: undefined, q: undefined },
            ),
        ).toEqual({ page: 1 });
        expect(updateFilters({ page: 1, status: ['OPEN'] }, { status: [] })).toEqual({ page: 1 });
    });
});

describe('toQueryParams / filtersToSearch', () => {
    it('builds the API query (paging handled by the caller)', () => {
        expect(toQueryParams({ status: ['OPEN', 'COMPLETED'], q: 'x', page: 2 })).toEqual({
            status: ['OPEN', 'COMPLETED'],
            q: 'x',
        });
        expect(toQueryParams({ page: 1 })).toEqual({});
    });

    it('writes filters in a fixed order, then the other params as they were', () => {
        const current = new URLSearchParams('task=t1&page=9&q=old&view=board&status=OPEN');
        expect(filtersToSearch({ q: 'new', status: ['COMPLETED', 'OPEN'], page: 2 }, current)).toBe(
            'status=COMPLETED%2COPEN&q=new&page=2&task=t1&view=board',
        );
    });

    it('round-trips: parse → serialise → parse gives the same filters and the same URL', () => {
        const messy = new URLSearchParams('page=2&status=COMPLETED&q=%20hero%20&status=OPEN&new=1');
        const filters = parseTaskFilters(messy);
        const search = filtersToSearch(filters, messy);

        expect(search).toBe('status=OPEN%2CCOMPLETED&q=hero&page=2&new=1');
        expect(parseTaskFilters(new URLSearchParams(search))).toEqual(filters);
        expect(
            filtersToSearch(
                parseTaskFilters(new URLSearchParams(search)),
                new URLSearchParams(search),
            ),
        ).toBe(search);
    });

    it('omits page 1', () => {
        expect(filtersToSearch({ page: 1, q: 'a' }, new URLSearchParams())).toBe('q=a');
    });
});

describe('hasActiveFilters', () => {
    it('ignores the page', () => {
        expect(hasActiveFilters({ page: 3 })).toBe(false);
        expect(hasActiveFilters({ page: 1, q: 'a' })).toBe(true);
        expect(hasActiveFilters({ page: 1, status: ['OPEN'] })).toBe(true);
    });
});
