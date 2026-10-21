/*
 * Walks the stale-cookie chain end to end with the real pieces — route guard (proxy), the
 * /api/auth/refresh route handler, SessionProvider — and a tiny cookie jar standing in for the
 * browser. Proves it settles on /login instead of bouncing between /login and /dashboard.
 */
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as refreshRoute } from '@/app/api/auth/refresh/route';
import { resetRefreshForTests } from '@/lib/auth/refresh';
import { SessionProvider } from '@/lib/auth/SessionProvider';
import { sessionStore } from '@/lib/auth/store';
import { proxy } from '@/proxy';

import { API_ORIGIN, APP_ORIGIN, server } from '../../msw/server';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

/** The browser's cookies for the app origin. */
const jar = new Map<string, string>();

function cookieHeader() {
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Apply a response's Set-Cookie headers like a browser (Max-Age=0 deletes). */
function storeCookies(response: Response) {
    for (const header of response.headers.getSetCookie()) {
        const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
        const [name = '', value = ''] = pair.split('=');
        const expired = attributes.some((a) => /^max-age=0$/i.test(a));
        if (expired || value === '') jar.delete(name);
        else jar.set(name, value);
    }
}

const MAX_HOPS = 5;

/** Navigate like a browser: run the guard and follow its redirects. */
function visit(path: string) {
    const hops: string[] = [];
    let current = path;
    for (let i = 0; i <= MAX_HOPS; i++) {
        const headers = new Headers();
        if (jar.size) headers.set('cookie', cookieHeader());
        const response = proxy(new NextRequest(`${APP_ORIGIN}${current}`, { headers }));
        const location = response.headers.get('location');
        if (!location) return { rendered: current, hops };
        const url = new URL(location);
        current = url.pathname + url.search;
        hops.push(current);
    }
    throw new Error(`Redirect loop: ${[path, ...hops].join(' → ')}`);
}

/** The browser's POST /api/auth/refresh, served by the real route handler with the jar's cookies. */
function serveRefreshRoute() {
    server.use(
        http.post(`${APP_ORIGIN}/api/auth/refresh`, async () => {
            const headers = new Headers({ origin: APP_ORIGIN });
            if (jar.size) headers.set('cookie', cookieHeader());
            const response = await refreshRoute(
                new NextRequest(`${APP_ORIGIN}/api/auth/refresh`, { method: 'POST', headers }),
            );
            storeCookies(response);
            return response;
        }),
    );
}

/** Render the dashboard gate at `path` and return where it sends the user, if anywhere. */
async function openDashboard(path: string) {
    window.history.replaceState(null, '', path);
    render(
        <SessionProvider>
            <p>Dashboard content</p>
        </SessionProvider>,
    );
}

beforeEach(() => {
    jar.clear();
    sessionStore.reset();
    resetRefreshForTests();
    router.replace.mockClear();
});

afterEach(() => resetRefreshForTests());

describe('stale refresh cookie', () => {
    it('settles on /login: guard → dashboard → refresh 401 clears cookie → /login renders', async () => {
        jar.set('tm_refresh', 'stale-token');
        server.use(
            http.post(`${API_ORIGIN}/api/v1/auth/refresh`, () =>
                HttpResponse.json(
                    { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x', requestId: 'r' } },
                    { status: 401 },
                ),
            ),
        );
        serveRefreshRoute();

        // 1. The stale cookie makes the guard send /login to /dashboard.
        const first = visit('/login');
        expect(first).toEqual({ rendered: '/dashboard', hops: ['/dashboard'] });

        // 2. SessionProvider's restore is refused; the route clears the cookie.
        await openDashboard(first.rendered);
        await vi.waitFor(() => expect(router.replace).toHaveBeenCalledOnce());
        expect(jar.has('tm_refresh')).toBe(false);
        expect(sessionStore.get().status).toBe('unauthenticated');

        // 3. Without the cookie the guard lets /login render — the chain ends.
        const target = router.replace.mock.calls[0]?.[0];
        expect(target).toBe('/login?next=%2Fdashboard');
        expect(visit(String(target))).toEqual({ rendered: '/login?next=%2Fdashboard', hops: [] });
    });

    it('never redirects to /login while the API is unreachable (cookie kept, retry offered)', async () => {
        jar.set('tm_refresh', 'probably-fine');
        server.use(http.post(`${API_ORIGIN}/api/v1/auth/refresh`, () => HttpResponse.error()));
        serveRefreshRoute();

        const first = visit('/login');
        expect(first.rendered).toBe('/dashboard');

        await openDashboard(first.rendered);
        expect(await screen.findByText("Can't reach TaskMaster")).toBeInTheDocument();
        expect(router.replace).not.toHaveBeenCalled();
        expect(jar.get('tm_refresh')).toBe('probably-fine');
        expect(sessionStore.get().status).toBe('unknown');
    });

    it('lets a valid session straight through to the dashboard', async () => {
        jar.set('tm_refresh', 'good');
        server.use(
            http.post(`${API_ORIGIN}/api/v1/auth/refresh`, () =>
                HttpResponse.json({
                    data: {
                        accessToken: 'at',
                        refreshToken: 'rotated',
                        expiresIn: 900,
                        tokenType: 'Bearer',
                    },
                }),
            ),
            http.get(`${API_ORIGIN}/api/v1/users/me`, () =>
                HttpResponse.json({
                    data: { id: 'u1', email: 'mara@taskmaster.app', name: 'Mara Okafor' },
                }),
            ),
        );
        serveRefreshRoute();

        expect(visit('/dashboard/my-tasks')).toEqual({ rendered: '/dashboard/my-tasks', hops: [] });
        await openDashboard('/dashboard/my-tasks');

        expect(await screen.findByText('Dashboard content')).toBeInTheDocument();
        expect(jar.get('tm_refresh')).toBe('rotated');
        expect(router.replace).not.toHaveBeenCalled();
    });
});
