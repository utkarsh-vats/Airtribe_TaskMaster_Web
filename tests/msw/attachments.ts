import { http, HttpResponse } from 'msw';

import { API_ORIGIN } from './server';

/** No attachments for any task of `projectId`: for tests that open the task panel. */
export const emptyAttachments = (projectId = 'p1') =>
    http.get(`${API_ORIGIN}/api/v1/projects/${projectId}/attachments`, ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
        return HttpResponse.json({ data: [], meta: { page: 1, limit, total: 0, totalPages: 0 } });
    });
