import { hashKey, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { normalizeFilters, queryKeys } from '@/lib/query/keys';

const P = 'project-1';

/** Whether invalidating `prefix` would hit a cached query with `key` (same matching as invalidateQueries). */
const invalidates = (prefix: readonly unknown[], key: readonly unknown[]) => {
    const client = new QueryClient();
    client.setQueryData(key, 'cached');
    return client.getQueryCache().findAll({ queryKey: prefix }).length === 1;
};

describe('query keys', () => {
    it('nests task lists and details under tasks.all(projectId)', () => {
        const list = queryKeys.tasks.list(P, { status: ['OPEN'] });
        const detail = queryKeys.tasks.detail(P, 'task-1');

        expect(list.slice(0, queryKeys.tasks.all(P).length)).toEqual(queryKeys.tasks.all(P));
        expect(invalidates(queryKeys.tasks.all(P), list)).toBe(true);
        expect(invalidates(queryKeys.tasks.all(P), detail)).toBe(true);
        expect(invalidates(queryKeys.tasks.lists(P), detail)).toBe(false);
    });

    it("keeps one project's tasks apart from another's, and My tasks under tasks.root()", () => {
        const mine = queryKeys.tasks.mine({ overdue: 'true' });

        expect(invalidates(queryKeys.tasks.all(P), queryKeys.tasks.list('project-2'))).toBe(false);
        expect(invalidates(queryKeys.tasks.all(P), mine)).toBe(false);
        expect(invalidates(queryKeys.tasks.root(), mine)).toBe(true);
    });

    it('puts the filter object last', () => {
        expect(queryKeys.tasks.list(P, { q: 'hero' }).at(-1)).toEqual({ q: 'hero' });
        expect(queryKeys.notifications.list({ unread: 'true' }).at(-1)).toEqual({ unread: 'true' });
    });

    it('scopes comments and attachments to a task or the project (none)', () => {
        expect(queryKeys.comments.list(P, 'none')).toEqual(['comments', P, 'list', 'none', {}]);
        expect(
            invalidates(queryKeys.attachments.all(P), queryKeys.attachments.list(P, 'task-1')),
        ).toBe(true);
    });
});

describe('filter normalisation', () => {
    it('gives equivalent filters the same key whatever the order', () => {
        const a = queryKeys.tasks.list(P, {
            priority: ['URGENT', 'HIGH'],
            status: ['OPEN'],
            sort: 'dueDate',
        });
        const b = queryKeys.tasks.list(P, {
            sort: 'dueDate',
            status: ['OPEN'],
            priority: ['HIGH', 'URGENT'],
        });

        expect(hashKey(a)).toBe(hashKey(b));
    });

    it('drops empty values so "no filter" has one key', () => {
        expect(normalizeFilters({ q: '', status: [], assignee: undefined })).toEqual({});
        expect(hashKey(queryKeys.tasks.list(P, { q: '' }))).toBe(hashKey(queryKeys.tasks.list(P)));
    });

    it('still tells different filters apart', () => {
        expect(hashKey(queryKeys.tasks.list(P, { page: 1 }))).not.toBe(
            hashKey(queryKeys.tasks.list(P, { page: 2 })),
        );
        expect(hashKey(queryKeys.tasks.list(P, { priority: ['HIGH'] }))).not.toBe(
            hashKey(queryKeys.tasks.list(P, { priority: ['HIGH', 'LOW'] })),
        );
    });
});
