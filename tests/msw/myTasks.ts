import { http, HttpResponse } from 'msw';

import type { TaskListItem } from '@/lib/api/types';

import { API_ORIGIN } from './server';

const PRIORITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 } as const;

/**
 * GET /users/me/tasks over `store`, the way the API does it: only tasks assigned to `meId`;
 * `status` and `priority` (comma lists), `q` (title or description, any case), `createdBy`
 * (`me` or an id), `dueAfter` / `dueBefore` (instants, exclusive — the app turns the URL's
 * dueFrom / dueTo days into these), `overdue=true` (due before now and not done), `sort`
 * (createdAt by default, dueDate with no-date last, updatedAt, priority, title)
 * with `order`, then `page` / `limit`. `assignee` is rejected with a 422, like the real API
 * (every task here is assigned to you). Each request's query is pushed to `requests`.
 */
export function myTasksList(store: TaskListItem[], meId: string, requests: URLSearchParams[] = []) {
    return http.get(`${API_ORIGIN}/api/v1/users/me/tasks`, ({ request }) => {
        const search = new URL(request.url).searchParams;
        requests.push(search);

        if (search.has('assignee')) {
            return HttpResponse.json(
                {
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid query',
                        requestId: 'r',
                        details: [{ path: 'assignee', message: 'Unrecognized key' }],
                    },
                },
                { status: 422 },
            );
        }

        const list = (name: string) => search.get(name)?.split(',').filter(Boolean);
        const statuses = list('status');
        const priorities = list('priority');
        const q = search.get('q')?.toLowerCase();
        const createdBy = search.get('createdBy');
        const creatorId = createdBy === 'me' ? meId : createdBy;
        const dueAfter = search.get('dueAfter');
        const dueBefore = search.get('dueBefore');
        const overdue = search.get('overdue') === 'true';
        const now = Date.now();

        const matching = store.filter((task) => {
            if (task.assignee?.id !== meId) return false;
            if (statuses && !statuses.includes(task.status)) return false;
            if (priorities && !priorities.includes(task.priority)) return false;
            if (q && !`${task.title}\n${task.description ?? ''}`.toLowerCase().includes(q)) {
                return false;
            }
            if (creatorId && task.createdBy.id !== creatorId) return false;
            const due = task.dueDate ? Date.parse(task.dueDate) : null;
            if (dueAfter && (due === null || due <= Date.parse(dueAfter))) return false;
            if (dueBefore && (due === null || due >= Date.parse(dueBefore))) return false;
            if (overdue) {
                if (!task.dueDate || task.status === 'COMPLETED') return false;
                if (Date.parse(task.dueDate) >= now) return false;
            }
            return true;
        });

        const sort = search.get('sort') ?? 'createdAt';
        const defaultOrder = sort === 'dueDate' || sort === 'title' ? 'asc' : 'desc';
        const direction = (search.get('order') ?? defaultOrder) === 'asc' ? 1 : -1;
        const sorted = [...matching].sort((a, b) => {
            if (sort === 'dueDate') {
                // No due date always last, whatever the order.
                if (!a.dueDate || !b.dueDate) return a.dueDate ? -1 : b.dueDate ? 1 : 0;
                return (Date.parse(a.dueDate) - Date.parse(b.dueDate)) * direction;
            }
            if (sort === 'priority') {
                return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * direction;
            }
            if (sort === 'title') return a.title.localeCompare(b.title) * direction;
            const field = sort === 'updatedAt' ? 'updatedAt' : 'createdAt';
            return (
                (Date.parse(a[field]) - Date.parse(b[field])) * direction ||
                a.id.localeCompare(b.id)
            );
        });

        const page = Number(search.get('page') ?? 1);
        const limit = Number(search.get('limit') ?? 25);
        return HttpResponse.json({
            data: sorted.slice((page - 1) * limit, page * limit),
            meta: {
                page,
                limit,
                total: sorted.length,
                totalPages: Math.ceil(sorted.length / limit),
            },
        });
    });
}
