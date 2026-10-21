// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { config, proxy } from '@/proxy';

const APP = 'http://localhost:3001';

function run(path: string, cookie?: string) {
    const headers = new Headers();
    if (cookie !== undefined) headers.set('cookie', `tm_refresh=${cookie}`);
    return proxy(new NextRequest(`${APP}${path}`, { headers }));
}

/** Where the response redirects to (path + query), or null when the request goes through. */
function redirectOf(response: Response) {
    const location = response.headers.get('location');
    if (!location) return null;
    expect(response.status).toBe(307);
    const url = new URL(location);
    expect(url.origin).toBe(APP);
    return url.pathname + url.search;
}

const passesThrough = (response: Response) => {
    expect(response.headers.get('location')).toBeNull();
    // NextResponse.next() marks the response so Next continues to the route.
    expect(response.headers.get('x-middleware-next')).toBe('1');
};

describe('matcher', () => {
    it('lists only the guarded routes', () => {
        expect(config.matcher).toEqual(['/dashboard/:path*', '/login', '/register']);
    });

    it.each([
        '/dashboard',
        '/dashboard/my-tasks',
        '/dashboard/projects/p1/tasks?view=board',
        '/login',
        '/login?next=%2Fdashboard',
        '/register',
    ])('runs on %s', (url) => {
        expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    });

    it.each([
        '/',
        '/api/auth/login',
        '/api/auth/refresh',
        '/_next/static/chunks/app.js',
        '/favicon.ico',
        '/dev/ui',
        '/dashboardx',
        '/login/extra',
    ])('never runs on %s', (url) => {
        expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    });
});

describe('/dashboard/**', () => {
    it('sends a request without the cookie to /login with next = path + query', () => {
        expect(redirectOf(run('/dashboard/projects/p1/tasks?view=board&task=t1'))).toBe(
            `/login?next=${encodeURIComponent('/dashboard/projects/p1/tasks?view=board&task=t1')}`,
        );
        expect(redirectOf(run('/dashboard'))).toBe('/login?next=%2Fdashboard');
    });

    it('treats an empty cookie as no cookie', () => {
        expect(redirectOf(run('/dashboard', ''))).toBe('/login?next=%2Fdashboard');
    });

    it('lets a request with the cookie through (presence only)', () => {
        passesThrough(run('/dashboard/my-tasks', 'any-value'));
    });
});

describe('/login and /register', () => {
    it.each(['/login', '/register'])('%s renders without the cookie', (path) => {
        passesThrough(run(`${path}?next=%2Fdashboard%2Fprojects`));
    });

    it.each(['/login', '/register'])('%s with the cookie goes to /dashboard', (path) => {
        expect(redirectOf(run(path, 'rt'))).toBe('/dashboard');
    });

    it('honours a safe next, query string included', () => {
        const next = '/dashboard/projects/p1/tasks?view=board&priority=HIGH';
        expect(redirectOf(run(`/login?next=${encodeURIComponent(next)}`, 'rt'))).toBe(next);
    });

    it.each(['//evil.com', 'https://evil.com', '/login', '/dashboard/../login'])(
        'ignores an unsafe next (%s)',
        (next) => {
            expect(redirectOf(run(`/login?next=${encodeURIComponent(next)}`, 'rt'))).toBe(
                '/dashboard',
            );
        },
    );
});
