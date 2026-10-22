import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { api, createApiClient, setAccessTokenGetter, unwrap, unwrapPage } from '@/lib/api/client';
import { ApiError, ERROR_CODES, hasCode } from '@/lib/api/errors';

import { API_ORIGIN, server } from '../../msw/server';

const PROJECT_ID = '0b6f9f3a-5d2e-4c1b-9a8e-1f2d3c4b5a69';
const url = (path: string) => `${API_ORIGIN}/api/v1${path}`;

const user = {
    id: '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

// Back to the default (the session store's token, null while signed out).
afterEach(() => setAccessTokenGetter());

/** Record the Authorization header of the next GET /users/me. */
function captureAuthHeader() {
    const seen: { value: string | null } = { value: null };
    server.use(
        http.get(url('/users/me'), ({ request }) => {
            seen.value = request.headers.get('Authorization');
            return HttpResponse.json({ data: user });
        }),
    );
    return seen;
}

describe('bearer middleware', () => {
    it('adds Authorization when a token exists', async () => {
        const seen = captureAuthHeader();
        setAccessTokenGetter(() => 'token-123');

        await unwrap(api.GET('/api/v1/users/me'));

        expect(seen.value).toBe('Bearer token-123');
    });

    it('sends no Authorization header when the token is null', async () => {
        const seen = captureAuthHeader();

        await unwrap(api.GET('/api/v1/users/me'));

        expect(seen.value).toBeNull();
    });

    it('supports an async token source on a custom client', async () => {
        const seen = captureAuthHeader();
        const client = createApiClient({
            baseUrl: `${API_ORIGIN}/`,
            getAccessToken: async () => 'async-token',
        });

        await unwrap(client.GET('/api/v1/users/me'));

        expect(seen.value).toBe('Bearer async-token');
    });
});

describe('unwrap', () => {
    it('returns the payload of the { data } envelope', async () => {
        server.use(http.get(url('/users/me'), () => HttpResponse.json({ data: user })));

        const me = await unwrap(api.GET('/api/v1/users/me'));

        expect(me).toEqual(user);
    });

    it('returns undefined for 204 No Content', async () => {
        server.use(
            http.delete(
                url(`/projects/${PROJECT_ID}`),
                () => new HttpResponse(null, { status: 204 }),
            ),
        );

        const result = await unwrap(
            api.DELETE('/api/v1/projects/{projectId}', {
                params: { path: { projectId: PROJECT_ID } },
            }),
        );

        expect(result).toBeUndefined();
    });

    it('turns the error envelope into an ApiError with code, details and requestId', async () => {
        server.use(
            http.post(url(`/projects/${PROJECT_ID}/tasks`), () =>
                HttpResponse.json(
                    {
                        error: {
                            code: 'VALIDATION_ERROR',
                            message: 'Invalid request body',
                            details: [{ path: 'title', message: 'Required' }],
                            requestId: 'req-42',
                        },
                    },
                    { status: 422 },
                ),
            ),
        );

        const error = await unwrap(
            api.POST('/api/v1/projects/{projectId}/tasks', {
                params: { path: { projectId: PROJECT_ID } },
                body: { title: '' },
            }),
        ).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
            status: 422,
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: [{ path: 'title', message: 'Required' }],
            requestId: 'req-42',
        });
        expect(hasCode(error, ERROR_CODES.VALIDATION_ERROR)).toBe(true);
    });

    it('maps a non-JSON 502 (e.g. a proxy page) to INTERNAL_ERROR, keeping the status', async () => {
        server.use(
            http.get(url('/users/me'), () =>
                HttpResponse.html('<html><body>Bad Gateway</body></html>', { status: 502 }),
            ),
        );

        const error = await unwrap(api.GET('/api/v1/users/me')).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status: 502, code: ERROR_CODES.INTERNAL_ERROR, details: [] });
    });

    it('maps a fetch failure to status 0 NETWORK_ERROR', async () => {
        server.use(http.get(url('/users/me'), () => HttpResponse.error()));

        const error = await unwrap(api.GET('/api/v1/users/me')).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status: 0, code: ERROR_CODES.NETWORK_ERROR });
    });
});

describe('query serialisation', () => {
    it('sends array params comma-separated (spec: style form, explode false)', async () => {
        let search = '';
        server.use(
            http.get(url(`/projects/${PROJECT_ID}/tasks`), ({ request }) => {
                search = new URL(request.url).search;
                return HttpResponse.json({
                    data: [],
                    meta: { page: 1, limit: 25, total: 0, totalPages: 0 },
                });
            }),
        );

        await unwrapPage(
            api.GET('/api/v1/projects/{projectId}/tasks', {
                params: {
                    path: { projectId: PROJECT_ID },
                    query: { status: ['OPEN', 'COMPLETED'], priority: ['URGENT', 'HIGH'] },
                },
            }),
        );

        expect(search).toBe('?status=OPEN,COMPLETED&priority=URGENT,HIGH');
    });
});

describe('unwrapPage', () => {
    it('returns items and meta from a paginated list', async () => {
        const meta = { page: 2, limit: 1, total: 3, totalPages: 3 };
        const project = {
            id: PROJECT_ID,
            name: 'Website relaunch',
            description: null,
            createdAt: '2026-10-01T09:00:00.000Z',
            updatedAt: '2026-10-01T09:00:00.000Z',
            myRole: 'OWNER',
            memberCount: 4,
        };
        let query = '';
        server.use(
            http.get(url('/projects'), ({ request }) => {
                query = new URL(request.url).search;
                return HttpResponse.json({ data: [project], meta });
            }),
        );

        const page = await unwrapPage(
            api.GET('/api/v1/projects', { params: { query: { page: 2, limit: 1 } } }),
        );

        expect(page).toEqual({ items: [project], meta });
        expect(query).toBe('?page=2&limit=1');
    });
});
