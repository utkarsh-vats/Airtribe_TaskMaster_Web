import { http, HttpResponse } from 'msw';

import { API_ORIGIN } from './server';

/** No pending or expired invitations for `projectId`: for tests that render the Members tab. */
export const emptyInvitations = (projectId = 'p1') =>
    http.get(`${API_ORIGIN}/api/v1/projects/${projectId}/invitations`, ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
        return HttpResponse.json({ data: [], meta: { page: 1, limit, total: 0, totalPages: 0 } });
    });
