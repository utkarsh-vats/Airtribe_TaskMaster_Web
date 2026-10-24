// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { POST as login } from '@/app/api/auth/login/route';
import { POST as logoutAll } from '@/app/api/auth/logout-all/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as refresh } from '@/app/api/auth/refresh/route';
import { POST as register } from '@/app/api/auth/register/route';

import { API_ORIGIN, server } from '../../msw/server';

const APP = 'http://localhost:3001';
const api = (path: string) => `${API_ORIGIN}/api/v1${path}`;

const REFRESH_TOKEN = 'rt-secret-0001';
const ROTATED_TOKEN = 'rt-secret-0002';

const user = {
    id: '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const loginResult = (refreshToken = REFRESH_TOKEN) => ({
    accessToken: 'at-1',
    refreshToken,
    expiresIn: 900,
    tokenType: 'Bearer',
    user,
});

const apiError = (status: number, code: string, message = code) =>
    HttpResponse.json({ error: { code, message, requestId: 'req-1' } }, { status });

type RequestOptions = {
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    headers?: Record<string, string>;
};

function request(path: string, { body, cookie, origin = APP, headers = {} }: RequestOptions = {}) {
    const all = new Headers(headers);
    if (origin) all.set('origin', origin);
    if (cookie) all.set('cookie', `tm_refresh=${cookie}`);
    if (body !== undefined) all.set('content-type', 'application/json');
    return new NextRequest(`${APP}/api/auth/${path}`, {
        method: 'POST',
        headers: all,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

/** The tm_refresh Set-Cookie header, if the response sets one. */
const refreshCookie = (response: Response) =>
    response.headers.getSetCookie().find((c) => c.startsWith('tm_refresh='));

/** Read the body once and make sure no refresh token value appears anywhere in it. */
async function bodyOf(response: Response): Promise<unknown> {
    const text = await response.text();
    expect(text).not.toContain(REFRESH_TOKEN);
    expect(text).not.toContain(ROTATED_TOKEN);
    expect(text).not.toContain('refreshToken');
    return text ? JSON.parse(text) : undefined;
}

const credentials = { email: user.email, password: 'correct horse' };

describe('POST /api/auth/login', () => {
    it('sets the refresh cookie and returns the session without the refresh token', async () => {
        let forwarded: unknown;
        server.use(
            http.post(api('/auth/login'), async ({ request: req }) => {
                forwarded = await req.json();
                return HttpResponse.json({ data: loginResult() });
            }),
        );

        const response = await login(request('login', { body: { ...credentials, extra: 1 } }));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await bodyOf(response)).toEqual({
            data: { accessToken: 'at-1', expiresIn: 900, user },
        });
        const cookie = refreshCookie(response);
        expect(cookie).toContain(`tm_refresh=${REFRESH_TOKEN}`);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(cookie).toMatch(/Path=\//);
        expect(cookie).toMatch(/Max-Age=604800/);
        expect(cookie).not.toMatch(/Secure/i); // only in production
        expect(forwarded).toEqual(credentials); // extra fields aren't forwarded
    });

    it('passes a 401 through unchanged and sets no cookie', async () => {
        server.use(
            http.post(api('/auth/login'), () =>
                apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
            ),
        );

        const response = await login(request('login', { body: credentials }));

        expect(response.status).toBe(401);
        expect(await bodyOf(response)).toEqual({
            error: {
                code: 'INVALID_CREDENTIALS',
                message: 'Invalid email or password',
                requestId: 'req-1',
            },
        });
        expect(refreshCookie(response)).toBeUndefined();
    });

    it('passes the API 422 details through for the form', async () => {
        const details = [{ path: 'email', message: 'Invalid email address' }];
        server.use(
            http.post(api('/auth/login'), () =>
                HttpResponse.json(
                    { error: { code: 'VALIDATION_ERROR', message: 'x', details, requestId: 'r' } },
                    { status: 422 },
                ),
            ),
        );

        const response = await login(request('login', { body: { email: 'no', password: 'p' } }));

        expect(response.status).toBe(422);
        expect(await bodyOf(response)).toMatchObject({ error: { details } });
    });

    it('rejects a body without the expected strings with 400', async () => {
        const response = await login(request('login', { body: { email: 'a@b.co' } }));

        expect(response.status).toBe(400);
        expect(await bodyOf(response)).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    });

    it('forwards the first X-Forwarded-For address', async () => {
        let forwardedFor: string | null = 'unset';
        server.use(
            http.post(api('/auth/login'), ({ request: req }) => {
                forwardedFor = req.headers.get('x-forwarded-for');
                return HttpResponse.json({ data: loginResult() });
            }),
        );

        await login(
            request('login', {
                body: credentials,
                headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2' },
            }),
        );
        expect(forwardedFor).toBe('203.0.113.7');

        await login(request('login', { body: credentials }));
        expect(forwardedFor).toBeNull();
    });

    it('answers 502 in the envelope when the API is unreachable', async () => {
        server.use(http.post(api('/auth/login'), () => HttpResponse.error()));

        const response = await login(request('login', { body: credentials }));

        expect(response.status).toBe(502);
        expect(await bodyOf(response)).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    });
});

describe('POST /api/auth/register', () => {
    const body = { ...credentials, name: user.name };

    it('creates the account, signs in and responds 201 with the session', async () => {
        const calls: string[] = [];
        server.use(
            http.post(api('/auth/register'), () => {
                calls.push('register');
                return HttpResponse.json({ data: user }, { status: 201 });
            }),
            http.post(api('/auth/login'), async ({ request: req }) => {
                calls.push('login');
                expect(await req.json()).toEqual(credentials);
                return HttpResponse.json({ data: loginResult() });
            }),
        );

        const response = await register(request('register', { body }));

        expect(response.status).toBe(201);
        expect(calls).toEqual(['register', 'login']);
        expect(await bodyOf(response)).toEqual({
            data: { accessToken: 'at-1', expiresIn: 900, user },
        });
        expect(refreshCookie(response)).toContain(`tm_refresh=${REFRESH_TOKEN}`);
    });

    it('passes a 409 through', async () => {
        server.use(
            http.post(api('/auth/register'), () =>
                apiError(409, 'CONFLICT', 'Email already registered'),
            ),
        );

        const response = await register(request('register', { body }));

        expect(response.status).toBe(409);
        expect(await bodyOf(response)).toMatchObject({
            error: { code: 'CONFLICT', message: 'Email already registered' },
        });
        expect(refreshCookie(response)).toBeUndefined();
    });

    it('responds 201 with accessToken null when the follow-up login fails', async () => {
        server.use(
            http.post(api('/auth/register'), () =>
                HttpResponse.json({ data: user }, { status: 201 }),
            ),
            http.post(api('/auth/login'), () => apiError(429, 'RATE_LIMITED')),
        );

        const response = await register(request('register', { body }));

        expect(response.status).toBe(201);
        expect(await bodyOf(response)).toEqual({ data: { user, accessToken: null } });
        expect(refreshCookie(response)).toBeUndefined();
    });
});

describe('POST /api/auth/refresh', () => {
    it('answers 401 and clears the cookie when there is no cookie', async () => {
        const response = await refresh(request('refresh'));

        expect(response.status).toBe(401);
        expect(await bodyOf(response)).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
        expect(refreshCookie(response)).toMatch(/Max-Age=0/);
    });

    it('rotates the cookie and returns the session with the current user', async () => {
        let sentToken: unknown;
        let bearer: string | null = null;
        server.use(
            http.post(api('/auth/refresh'), async ({ request: req }) => {
                sentToken = await req.json();
                return HttpResponse.json({
                    data: {
                        accessToken: 'at-2',
                        refreshToken: ROTATED_TOKEN,
                        expiresIn: 900,
                        tokenType: 'Bearer',
                    },
                });
            }),
            http.get(api('/users/me'), ({ request: req }) => {
                bearer = req.headers.get('authorization');
                return HttpResponse.json({ data: user });
            }),
        );

        const response = await refresh(request('refresh', { cookie: REFRESH_TOKEN }));

        expect(response.status).toBe(200);
        expect(sentToken).toEqual({ refreshToken: REFRESH_TOKEN });
        expect(bearer).toBe('Bearer at-2');
        expect(await bodyOf(response)).toEqual({
            data: { accessToken: 'at-2', expiresIn: 900, user },
        });
        expect(refreshCookie(response)).toContain(`tm_refresh=${ROTATED_TOKEN}`);
    });

    it('clears the cookie and passes the 401 through when the API rejects the token', async () => {
        server.use(http.post(api('/auth/refresh'), () => apiError(401, 'INVALID_REFRESH_TOKEN')));

        const response = await refresh(request('refresh', { cookie: REFRESH_TOKEN }));

        expect(response.status).toBe(401);
        expect(await bodyOf(response)).toMatchObject({ error: { code: 'INVALID_REFRESH_TOKEN' } });
        expect(refreshCookie(response)).toMatch(/^tm_refresh=;.*Max-Age=0/);
    });

    it('keeps the cookie on a 429 and passes Retry-After and RateLimit headers through', async () => {
        server.use(
            http.post(api('/auth/refresh'), () =>
                HttpResponse.json(
                    {
                        error: {
                            code: 'RATE_LIMITED',
                            message: 'Too many requests',
                            requestId: 'r',
                        },
                    },
                    {
                        status: 429,
                        headers: {
                            'Retry-After': '42',
                            'RateLimit-Limit': '10',
                            'RateLimit-Remaining': '0',
                            'RateLimit-Reset': '42',
                        },
                    },
                ),
            ),
        );

        const response = await refresh(request('refresh', { cookie: REFRESH_TOKEN }));

        expect(response.status).toBe(429);
        expect(await bodyOf(response)).toMatchObject({ error: { code: 'RATE_LIMITED' } });
        expect(response.headers.get('retry-after')).toBe('42');
        expect(response.headers.get('ratelimit-remaining')).toBe('0');
        expect(response.headers.get('ratelimit-reset')).toBe('42');
        expect(refreshCookie(response)).toBeUndefined();
    });

    it('keeps the cookie when the API is down, so a blip does not sign the user out', async () => {
        server.use(http.post(api('/auth/refresh'), () => HttpResponse.error()));

        const response = await refresh(request('refresh', { cookie: REFRESH_TOKEN }));

        expect(response.status).toBe(502);
        expect(refreshCookie(response)).toBeUndefined();
    });
});

describe('POST /api/auth/logout', () => {
    it('revokes the refresh token and clears the cookie', async () => {
        let sent: unknown;
        server.use(
            http.post(api('/auth/logout'), async ({ request: req }) => {
                sent = await req.json();
                return new HttpResponse(null, { status: 204 });
            }),
        );

        const response = await logout(request('logout', { cookie: REFRESH_TOKEN }));

        expect(response.status).toBe(204);
        expect(sent).toEqual({ refreshToken: REFRESH_TOKEN });
        expect(refreshCookie(response)).toMatch(/Max-Age=0/);
        expect(await bodyOf(response)).toBeUndefined();
    });

    it('clears the cookie even when the backend call fails', async () => {
        server.use(http.post(api('/auth/logout'), () => HttpResponse.error()));

        const response = await logout(request('logout', { cookie: REFRESH_TOKEN }));

        expect(response.status).toBe(204);
        expect(refreshCookie(response)).toMatch(/Max-Age=0/);
    });

    it('does not call the API without a cookie', async () => {
        // No handler: an API call would fail the test (onUnhandledFrame: 'error').
        const response = await logout(request('logout'));

        expect(response.status).toBe(204);
        expect(refreshCookie(response)).toMatch(/Max-Age=0/);
    });
});

describe('POST /api/auth/logout-all', () => {
    it('forwards the Authorization header and clears the cookie', async () => {
        let authorization: string | null = null;
        server.use(
            http.post(api('/auth/logout-all'), ({ request: req }) => {
                authorization = req.headers.get('authorization');
                return new HttpResponse(null, { status: 204 });
            }),
        );

        const response = await logoutAll(
            request('logout-all', {
                cookie: REFRESH_TOKEN,
                headers: { authorization: 'Bearer at-1' },
            }),
        );

        expect(response.status).toBe(204);
        expect(authorization).toBe('Bearer at-1');
        expect(refreshCookie(response)).toMatch(/Max-Age=0/);
    });

    it('passes a 401 through and still clears the cookie', async () => {
        server.use(http.post(api('/auth/logout-all'), () => apiError(401, 'TOKEN_EXPIRED')));

        const response = await logoutAll(
            request('logout-all', {
                cookie: REFRESH_TOKEN,
                headers: { authorization: 'Bearer old' },
            }),
        );

        expect(response.status).toBe(401);
        expect(await bodyOf(response)).toMatchObject({ error: { code: 'TOKEN_EXPIRED' } });
        expect(refreshCookie(response)).toMatch(/Max-Age=0/);
    });

    it('answers 401 without calling the API when Authorization is missing', async () => {
        const response = await logoutAll(request('logout-all', { cookie: REFRESH_TOKEN }));

        expect(response.status).toBe(401);
        expect(refreshCookie(response)).toBeUndefined();
    });
});

describe('Origin check (CSRF)', () => {
    const handlers = [
        ['login', login, { body: credentials }],
        ['register', register, { body: { ...credentials, name: 'x' } }],
        ['refresh', refresh, { cookie: REFRESH_TOKEN }],
        ['logout', logout, { cookie: REFRESH_TOKEN }],
        ['logout-all', logoutAll, { headers: { authorization: 'Bearer at-1' } }],
    ] as const;

    it.each(handlers)('%s refuses a foreign Origin with 403', async (path, handler, options) => {
        const response = await handler(
            request(path, { ...options, origin: 'https://evil.example' }),
        );

        expect(response.status).toBe(403);
        expect(await bodyOf(response)).toMatchObject({ error: { code: 'FORBIDDEN' } });
        expect(refreshCookie(response)).toBeUndefined();
    });

    it.each(handlers)('%s refuses a missing Origin with 403', async (path, handler, options) => {
        const response = await handler(request(path, { ...options, origin: null }));

        expect(response.status).toBe(403);
    });
});
