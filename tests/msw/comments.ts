import { http, HttpResponse } from 'msw';

import { API_ORIGIN } from './server';

/** An empty comment thread for every task of `projectId`: for tests that open the task panel. */
export const emptyComments = (projectId = 'p1') =>
    http.get(`${API_ORIGIN}/api/v1/projects/${projectId}/comments`, ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
        return HttpResponse.json({ data: [], meta: { page: 1, limit, total: 0, totalPages: 0 } });
    });
