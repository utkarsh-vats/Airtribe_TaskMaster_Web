import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
    moveCard,
    moveInColumnCaches,
    restoreColumnCaches,
    type TaskPage,
} from '@/features/tasks/boardCache';
import type { TaskListItem, TaskStatus } from '@/lib/api/types';

const task = (id: string, status: TaskStatus = 'OPEN'): TaskListItem => ({
    id,
    projectId: 'p1',
    title: `Task ${id}`,
    description: null,
    status,
    priority: 'MEDIUM',
    dueDate: null,
    completedAt: null,
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: '2026-10-10T09:00:00.000Z',
    assignee: null,
    createdBy: { id: 'u1', name: 'Mara Okafor' },
});

const page = (items: TaskListItem[], total = items.length): TaskPage => ({
    items,
    meta: { page: 1, limit: 100, total, totalPages: Math.ceil(total / 100) },
});

const ids = (p: TaskPage | undefined) => p?.items.map((item) => item.id);

describe('moveCard', () => {
    it('takes the card out of the source and puts it on top of the target, adjusting totals', () => {
        const source = page([task('a'), task('b')], 2);
        const target = page([task('c', 'IN_PROGRESS')], 1);

        const next = moveCard(source, target, 'a', 'IN_PROGRESS');

        expect(ids(next.source)).toEqual(['b']);
        expect(next.source?.meta.total).toBe(1);
        expect(ids(next.target)).toEqual(['a', 'c']);
        expect(next.target?.items[0]?.status).toBe('IN_PROGRESS');
        expect(next.target?.meta.total).toBe(2);
        // Inputs untouched.
        expect(ids(source)).toEqual(['a', 'b']);
        expect(ids(target)).toEqual(['c']);
    });

    it('into a full column (100 of 140): the card goes on top, the last one drops off, total + 1', () => {
        const full = page(
            Array.from({ length: 100 }, (_, i) => task(`d${i}`, 'COMPLETED')),
            140,
        );
        const next = moveCard(page([task('a')]), full, 'a', 'COMPLETED');

        expect(next.target?.items).toHaveLength(100);
        expect(next.target?.items[0]?.id).toBe('a');
        expect(ids(next.target)).not.toContain('d99');
        expect(next.target?.meta.total).toBe(141);
        expect(next.target?.meta.totalPages).toBe(2);
        expect(next.source?.items).toHaveLength(0);
        expect(next.source?.meta.total).toBe(0);
    });

    it('changes nothing when the card isn’t in the source', () => {
        const source = page([task('b')]);
        const target = page([]);
        const next = moveCard(source, target, 'a', 'IN_PROGRESS');
        expect(next.source).toBe(source);
        expect(next.target).toBe(target);
    });

    it('still leaves the source when the target column isn’t cached', () => {
        const next = moveCard(page([task('a')]), undefined, 'a', 'IN_PROGRESS');
        expect(ids(next.source)).toEqual([]);
        expect(next.target).toBeUndefined();
    });
});

describe('moveInColumnCaches / restoreColumnCaches', () => {
    it('moves in the cache, then restores both columns exactly', () => {
        const client = new QueryClient();
        const from = ['tasks', 'project', 'p1', 'list', { status: ['OPEN'], limit: 100 }];
        const to = ['tasks', 'project', 'p1', 'list', { status: ['COMPLETED'], limit: 100 }];
        const source = page([task('a'), task('b')]);
        const target = page(
            Array.from({ length: 100 }, (_, i) => task(`d${i}`, 'COMPLETED')),
            120,
        );
        client.setQueryData(from, source);
        client.setQueryData(to, target);

        const snapshot = moveInColumnCaches(client, { from, to }, 'a', 'COMPLETED');
        expect(ids(client.getQueryData<TaskPage>(from))).toEqual(['b']);
        expect(client.getQueryData<TaskPage>(to)?.items[0]?.id).toBe('a');
        expect(client.getQueryData<TaskPage>(to)?.meta.total).toBe(121);

        restoreColumnCaches(client, snapshot);
        expect(client.getQueryData(from)).toEqual(source);
        expect(client.getQueryData(to)).toEqual(target);
    });
});
