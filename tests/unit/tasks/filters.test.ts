import { afterEach, describe, expect, it } from 'vitest';

import {
    countBarFilters,
    effectiveOrder,
    filtersToSearch,
    hasActiveFilters,
    hasAnyListParams,
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

describe('advanced filters (6c)', () => {
    const MARA = '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f';

    it('priority: comma lists in Urgent → Low order, junk dropped', () => {
        expect(parse('priority=LOW,URGENT,HIGH,LOW').priority).toEqual(['URGENT', 'HIGH', 'LOW']);
        expect(parse('priority=CRITICAL')).toEqual({ page: 1 });
    });

    it('assignee: me, unassigned or a uuid', () => {
        expect(parse('assignee=me').assignee).toBe('me');
        expect(parse('assignee=unassigned').assignee).toBe('unassigned');
        expect(parse(`assignee=${MARA}`).assignee).toBe(MARA);
        expect(parse('assignee=mara')).toEqual({ page: 1 });
    });

    it('createdBy: me or a uuid — never unassigned', () => {
        expect(parse('createdBy=me').createdBy).toBe('me');
        expect(parse(`createdBy=${MARA}`).createdBy).toBe(MARA);
        expect(parse('createdBy=unassigned')).toEqual({ page: 1 });
    });

    it('dueFrom / dueTo: real YYYY-MM-DD days only; an inverted range is dropped', () => {
        expect(parse('dueFrom=2026-10-28&dueTo=2026-10-30')).toMatchObject({
            dueFrom: '2026-10-28',
            dueTo: '2026-10-30',
        });
        expect(parse('dueFrom=2026-10-28&dueTo=2026-10-28').dueTo).toBe('2026-10-28');
        expect(parse('dueFrom=2026-02-31')).toEqual({ page: 1 });
        expect(parse('dueTo=28-10-2026')).toEqual({ page: 1 });
        expect(parse('dueTo=2026-10-28T00:00')).toEqual({ page: 1 });
        expect(parse('dueFrom=2026-11-02&dueTo=2026-10-01')).toEqual({ page: 1 });
    });

    it('overdue: only "true" counts', () => {
        expect(parse('overdue=true').overdue).toBe(true);
        expect(parse('overdue=false')).toEqual({ page: 1 });
        expect(parse('overdue=1')).toEqual({ page: 1 });
    });

    it('sort and order: known values only', () => {
        expect(parse('sort=dueDate&order=asc')).toMatchObject({ sort: 'dueDate', order: 'asc' });
        expect(parse('sort=assignee&order=up')).toEqual({ page: 1 });
    });

    it('writes every param in the fixed order', () => {
        const filters = parse(
            `order=desc&sort=title&overdue=true&dueTo=2026-10-30&dueFrom=2026-10-01&createdBy=me&assignee=unassigned&priority=LOW,HIGH&q=x&status=OPEN&page=2`,
        );
        expect(filtersToSearch(filters, new URLSearchParams('task=t1'))).toBe(
            'status=OPEN&q=x&priority=HIGH%2CLOW&assignee=unassigned&createdBy=me&dueFrom=2026-10-01&dueTo=2026-10-30&overdue=true&sort=title&order=desc&page=2&task=t1',
        );
    });

    it('maps to the API query; sort and order pass through', () => {
        expect(
            toQueryParams(
                parse(
                    `priority=URGENT&assignee=me&createdBy=${MARA}&overdue=true&sort=priority&order=asc`,
                ),
            ),
        ).toEqual({
            priority: ['URGENT'],
            assignee: 'me',
            createdBy: MARA,
            overdue: 'true',
            sort: 'priority',
            order: 'asc',
        });
    });
});

describe('due range → API instants (user time zone)', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
        process.env.TZ = originalTz;
    });

    it('Asia/Kolkata: dueAfter = start of from − 1 ms, dueBefore = start of the day after to', () => {
        process.env.TZ = 'Asia/Kolkata';
        expect(toQueryParams(parse('dueFrom=2026-10-28&dueTo=2026-10-30'))).toEqual({
            dueAfter: '2026-10-27T18:29:59.999Z',
            dueBefore: '2026-10-30T18:30:00.000Z',
        });
    });

    it('America/New_York across the end of DST (Nov 1 2026)', () => {
        process.env.TZ = 'America/New_York';
        expect(toQueryParams(parse('dueFrom=2026-11-01&dueTo=2026-11-01'))).toEqual({
            dueAfter: '2026-11-01T03:59:59.999Z', // midnight EDT (UTC−4)
            dueBefore: '2026-11-02T05:00:00.000Z', // midnight EST (UTC−5)
        });
    });
});

describe('sort helpers', () => {
    it('effective order uses each field default when order is absent', () => {
        expect(effectiveOrder({})).toBe('desc'); // createdAt
        expect(effectiveOrder({ sort: 'dueDate' })).toBe('asc');
        expect(effectiveOrder({ sort: 'updatedAt' })).toBe('desc');
        expect(effectiveOrder({ sort: 'priority' })).toBe('desc');
        expect(effectiveOrder({ sort: 'title' })).toBe('asc');
        expect(effectiveOrder({ sort: 'title', order: 'desc' })).toBe('desc');
    });

    it('counts the filter-bar filters (not status, search or sort)', () => {
        expect(countBarFilters(parse('status=OPEN&q=x&sort=title'))).toBe(0);
        expect(
            countBarFilters(
                parse(
                    'priority=HIGH&assignee=me&createdBy=me&dueFrom=2026-10-01&dueTo=2026-10-02&overdue=true',
                ),
            ),
        ).toBe(5);
    });

    it('Clear filters has something to do with a sort alone', () => {
        expect(hasAnyListParams(parse('order=asc'))).toBe(true);
        expect(hasAnyListParams(parse('page=4'))).toBe(false);
    });
});
