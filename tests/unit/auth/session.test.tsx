import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { api, unwrap } from '@/lib/api/client';
import { ApiError, ERROR_CODES } from '@/lib/api/errors';
import type { User } from '@/lib/api/types';
import { register, signIn } from '@/lib/auth/actions';
import { authNavigation, loginUrl } from '@/lib/auth/navigation';
import { refreshSession, resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { resetSessionEndedForTests } from '@/lib/auth/sessionEnded';
import { SessionProvider } from '@/lib/auth/SessionProvider';
import { sessionStore } from '@/lib/auth/store';
import { getQueryClient } from '@/lib/query/client';

import { API_ORIGIN, APP_ORIGIN, server } from '../../msw/server';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const PROJECT_ID = '0b6f9f3a-5d2e-4c1b-9a8e-1f2d3c4b5a69';
const PATH = '/dashboard/my-tasks?view=board';

const user: User = {
    id: '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const apiUrl = (path: string) => `${API_ORIGIN}/api/v1${path}`;
const authUrl = (path: string) => `${APP_ORIGIN}/api/auth/${path}`;
const session = (accessToken: string, expiresIn = 900) => ({
    data: { accessToken, expiresIn, user },
});
const apiError = (status: number, code: string) =>
    HttpResponse.json({ error: { code, message: code, requestId: 'r' } }, { status });

/** /api/auth/refresh answering with `respond`; returns the call counter. */
function mockRefresh(respond: () => Response) {
    const calls = { count: 0 };
    server.use(
        http.post(authUrl('refresh'), () => {
            calls.count += 1;
            return respond();
        }),
    );
    return calls;
}

/** GET /users/me: 200 for `Bearer <validToken>`, 401 TOKEN_EXPIRED otherwise. */
function mockMe(validToken: string) {
    server.use(
        http.get(apiUrl('/users/me'), ({ request }) =>
            request.headers.get('authorization') === `Bearer ${validToken}`
                ? HttpResponse.json({ data: user })
                : apiError(401, ERROR_CODES.TOKEN_EXPIRED),
        ),
    );
}

let toLogin: MockInstance<(next: string) => void>;

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    resetSessionEndedForTests();
    getQueryClient().clear();
    router.replace.mockClear();
    toLogin = vi.spyOn(authNavigation, 'toLogin').mockImplementation(() => {});
    window.history.replaceState(null, '', PATH);
});

afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'locks');
});

describe('refresh-and-retry', () => {
    it('shares one refresh between concurrent 401 TOKEN_EXPIRED calls and retries both', async () => {
        startSession(session('old').data);
        mockMe('new');
        const refresh = mockRefresh(() => HttpResponse.json(session('new')));

        const [a, b] = await Promise.all([
            unwrap(api.GET('/api/v1/users/me')),
            unwrap(api.GET('/api/v1/users/me')),
        ]);

        expect(refresh.count).toBe(1);
        expect(a).toEqual(user);
        expect(b).toEqual(user);
        expect(sessionStore.get().accessToken).toBe('new');
    });

    it('retries a POST with the same body', async () => {
        startSession(session('old').data);
        mockRefresh(() => HttpResponse.json(session('new')));
        const received: { auth: string | null; body: unknown }[] = [];
        server.use(
            http.post(apiUrl(`/projects/${PROJECT_ID}/tasks`), async ({ request }) => {
                const auth = request.headers.get('authorization');
                received.push({ auth, body: await request.json() });
                return auth === 'Bearer new'
                    ? HttpResponse.json({ data: { id: 'task-1' } }, { status: 201 })
                    : apiError(401, ERROR_CODES.TOKEN_EXPIRED);
            }),
        );
        const body = { title: 'Finalise hero copy', priority: 'HIGH' } as const;

        await unwrap(
            api.POST('/api/v1/projects/{projectId}/tasks', {
                params: { path: { projectId: PROJECT_ID } },
                body,
            }),
        );

        expect(received).toEqual([
            { auth: 'Bearer old', body },
            { auth: 'Bearer new', body },
        ]);
    });

    it('signs out when the refresh is rejected: store, cache, redirect with next', async () => {
        startSession(session('old').data);
        mockMe('never');
        mockRefresh(() => apiError(401, ERROR_CODES.INVALID_REFRESH_TOKEN));
        getQueryClient().setQueryData(['projects'], ['cached']);

        const error = await unwrap(api.GET('/api/v1/users/me')).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(sessionStore.get().status).toBe('unauthenticated');
        expect(getQueryClient().getQueryCache().getAll()).toHaveLength(0);
        expect(toLogin).toHaveBeenCalledExactlyOnceWith(PATH);
        expect(loginUrl(PATH)).toBe('/login?next=%2Fdashboard%2Fmy-tasks%3Fview%3Dboard');
    });

    it('signs out on a 401 that is not TOKEN_EXPIRED, without refreshing', async () => {
        startSession(session('old').data);
        const refresh = mockRefresh(() => HttpResponse.json(session('new')));
        server.use(http.get(apiUrl('/users/me'), () => apiError(401, ERROR_CODES.UNAUTHORIZED)));

        await unwrap(api.GET('/api/v1/users/me')).catch(() => undefined);

        expect(refresh.count).toBe(0);
        expect(sessionStore.get().status).toBe('unauthenticated');
        expect(toLogin).toHaveBeenCalledOnce();
    });
});

describe('refreshSession', () => {
    it('keeps a signed-in user signed in when the refresh fails with 503', async () => {
        startSession(session('old').data);
        mockRefresh(() => apiError(503, ERROR_CODES.INTERNAL_ERROR));

        expect(await refreshSession()).toBeNull();

        expect(sessionStore.get()).toMatchObject({ status: 'authenticated', accessToken: 'old' });
    });

    it('leaves a session being restored as unknown on a network failure', async () => {
        mockRefresh(() => HttpResponse.error());

        expect(await refreshSession()).toBeNull();

        expect(sessionStore.get().status).toBe('unknown');
    });

    it('runs inside navigator.locks when available', async () => {
        const request = vi.fn((_name: string, task: () => Promise<unknown>) => task());
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
        mockRefresh(() => HttpResponse.json(session('new')));

        expect(await refreshSession()).toBe('new');

        expect(request).toHaveBeenCalledExactlyOnceWith('tm-refresh', expect.any(Function));
    });

    it('refreshes proactively 60 s before the access token expires', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        // fetch is stubbed here rather than served by MSW: network internals started under
        // fake timers can schedule on the fake clock and never finish.
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () => Response.json(session('next')));

        startSession(session('first', 900).data);
        vi.advanceTimersByTime(840_000 - 1);
        expect(fetchSpy).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        await vi.waitFor(() => expect(sessionStore.get().accessToken).toBe('next'));
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(authUrl('refresh'));
    });
});

describe('SessionProvider', () => {
    it('restores the session on mount, then renders its children', async () => {
        const refresh = mockRefresh(() => HttpResponse.json(session('restored')));

        render(
            <SessionProvider>
                <p>Dashboard content</p>
            </SessionProvider>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Loading your session…');
        expect(await screen.findByText('Dashboard content')).toBeInTheDocument();
        expect(refresh.count).toBe(1);
        expect(sessionStore.get().user).toEqual(user);
    });

    it('redirects to /login?next=… when there is no session', async () => {
        mockRefresh(() => apiError(401, ERROR_CODES.UNAUTHORIZED));

        render(
            <SessionProvider>
                <p>Dashboard content</p>
            </SessionProvider>,
        );

        await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith(loginUrl(PATH)));
        expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument();
    });

    it('offers a retry instead of signing out when the API is unreachable', async () => {
        mockRefresh(() => HttpResponse.error());

        render(
            <SessionProvider>
                <p>Dashboard content</p>
            </SessionProvider>,
        );

        expect(await screen.findByText("Can't reach TaskMaster")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
        expect(router.replace).not.toHaveBeenCalled();
    });
});

describe('signIn / register', () => {
    it('signIn stores the session and schedules its refresh', async () => {
        let sent: unknown;
        server.use(
            http.post(authUrl('login'), async ({ request }) => {
                sent = await request.json();
                return HttpResponse.json(session('signed-in'));
            }),
        );

        expect(await signIn(user.email, 'correct horse')).toEqual(user);

        expect(sent).toEqual({ email: user.email, password: 'correct horse' });
        expect(sessionStore.get()).toMatchObject({
            status: 'authenticated',
            accessToken: 'signed-in',
            user,
        });
    });

    it('signIn throws the ApiError on 401 INVALID_CREDENTIALS', async () => {
        server.use(
            http.post(authUrl('login'), () => apiError(401, ERROR_CODES.INVALID_CREDENTIALS)),
        );

        const error = await signIn(user.email, 'wrong').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status: 401, code: ERROR_CODES.INVALID_CREDENTIALS });
        expect(sessionStore.get().status).toBe('unknown');
    });

    it('register reports needsLogin when the automatic sign-in failed', async () => {
        server.use(
            http.post(authUrl('register'), () =>
                HttpResponse.json({ data: { user, accessToken: null } }, { status: 201 }),
            ),
        );

        expect(await register(user.name, user.email, 'correct horse')).toEqual({
            needsLogin: true,
        });
        expect(sessionStore.get().status).toBe('unknown');
    });
});
