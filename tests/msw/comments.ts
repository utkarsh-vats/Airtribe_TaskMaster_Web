import { http, HttpResponse } from 'msw';

import type { Comment } from '@/lib/api/types';

import { API_ORIGIN } from './server';

const url = (projectId: string) => `${API_ORIGIN}/api/v1/projects/${projectId}/comments`;

/** An empty comment thread for every task of `projectId`: for tests that open the task panel. */
export const emptyComments = (projectId = 'p1') =>
    http.get(url(projectId), ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
        return HttpResponse.json({ data: [], meta: { page: 1, limit, total: 0, totalPages: 0 } });
    });

/**
 * GET /comments over `store`, the way the API does it: `taskId` (an id or `none`) and
 * `parentId` (`none` = top-level only, or an id = its replies) filter; `order` sorts by
 * createdAt — `asc` (the default) or `desc` — with ties going to the later entry in `store`
 * as the newer; `page` / `limit` page it. A test that renders newest first, without replies,
 * therefore proves the app sent parentId=none&order=desc. Each request's query is pushed to
 * `gets`.
 */
export function commentsList(store: Comment[], gets: URLSearchParams[] = [], projectId = 'p1') {
    return http.get(url(projectId), ({ request }) => {
        const search = new URL(request.url).searchParams;
        gets.push(search);
        const taskId = search.get('taskId');
        const parentId = search.get('parentId');
        const page = Number(search.get('page') ?? 1);
        const limit = Number(search.get('limit') ?? 50);

        const matching = store
            .map((comment, index) => ({ comment, index }))
            .filter(({ comment }) => {
                if (taskId === 'none' && comment.taskId !== null) return false;
                if (taskId && taskId !== 'none' && comment.taskId !== taskId) return false;
                if (parentId === 'none' && comment.parentId !== null) return false;
                if (parentId && parentId !== 'none' && comment.parentId !== parentId) return false;
                return true;
            })
            .sort(
                (a, b) =>
                    Date.parse(a.comment.createdAt) - Date.parse(b.comment.createdAt) ||
                    a.index - b.index,
            )
            .map(({ comment }) => comment);
        if (search.get('order') === 'desc') matching.reverse();

        return HttpResponse.json({
            data: matching.slice((page - 1) * limit, page * limit),
            meta: {
                page,
                limit,
                total: matching.length,
                totalPages: Math.ceil(matching.length / limit),
            },
        });
    });
}
