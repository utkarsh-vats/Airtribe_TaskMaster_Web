import { http, HttpResponse } from 'msw';

import type { Notification } from '@/lib/api/types';

import { API_ORIGIN } from './server';

const url = `${API_ORIGIN}/api/v1/notifications`;

export type NotificationCalls = {
    /** GET /notifications queries. */
    gets: URLSearchParams[];
    /** Ids marked read one by one. */
    reads: string[];
    readAll: number;
};

/**
 * The notifications API over `store` (newest first, like the API): GET with `unread`
 * (`true` / `false`), `page`, `limit`, and `meta.unreadCount` over everything; PATCH
 * /{id}/read (404 if it isn't there) and POST /read-all, both updating `store`.
 */
export function notificationsApi(store: Notification[], calls: NotificationCalls) {
    return [
        http.get(url, ({ request }) => {
            const search = new URL(request.url).searchParams;
            calls.gets.push(search);
            const unread = search.get('unread');
            const page = Number(search.get('page') ?? 1);
            const limit = Number(search.get('limit') ?? 20);
            const matching = store
                .filter((n) =>
                    unread === 'true' ? !n.readAt : unread === 'false' ? Boolean(n.readAt) : true,
                )
                .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
            return HttpResponse.json({
                data: matching.slice((page - 1) * limit, page * limit),
                meta: {
                    page,
                    limit,
                    total: matching.length,
                    totalPages: Math.ceil(matching.length / limit),
                    unreadCount: store.filter((n) => !n.readAt).length,
                },
            });
        }),
        http.patch(`${url}/:id/read`, ({ params }) => {
            const id = String(params.id);
            calls.reads.push(id);
            const n = store.find((item) => item.id === id);
            if (!n) {
                return HttpResponse.json(
                    { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r' } },
                    { status: 404 },
                );
            }
            n.readAt ??= new Date().toISOString();
            return new HttpResponse(null, { status: 204 });
        }),
        http.post(`${url}/read-all`, () => {
            calls.readAll += 1;
            const now = new Date().toISOString();
            for (const n of store) n.readAt ??= now;
            return new HttpResponse(null, { status: 204 });
        }),
    ];
}
