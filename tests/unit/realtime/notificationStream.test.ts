/*
 * The live notification stream (12c-1), on its own: the bearer token per connect, events,
 * TOKEN_EXPIRED → refresh → reconnect, other auth failures stop it, backoff with jitter on
 * network errors (never signing out) and its reset after an open, server closes, the hidden
 * tab, and stop(). fetch-event-source is the fake in tests/fakeEventSource.ts.
 */
import * as sse from '@microsoft/fetch-event-source';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Notification, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import {
    parseNotification,
    retryDelay,
    startNotificationStream,
    streamState,
} from '@/lib/realtime/notificationStream';

import {
    mockStreamFetch,
    networkDown,
    setTabHidden,
    streamError,
    streamOk,
    type createFakeEventSource,
} from '../../fakeEventSource';
import { API_ORIGIN, APP_ORIGIN, server } from '../../msw/server';

vi.mock('@microsoft/fetch-event-source', async () => {
    const { createFakeEventSource } = await import('../../fakeEventSource');
    const fake = createFakeEventSource();
    return {
        EventStreamContentType: 'text/event-stream',
        fetchEventSource: fake.fetchEventSource,
        fake,
    };
});
const fake = (sse as unknown as { fake: ReturnType<typeof createFakeEventSource> }).fake;

const user: User = {
    id: 'u-me',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const NOTE: Notification = {
    id: 'n9',
    type: 'TASK_ASSIGNED',
    projectId: 'p1',
    taskId: 't1',
    payload: {
        actor: { id: 'u2', name: 'Priya Raman' },
        project: { id: 'p1', name: 'Website relaunch' },
        task: { id: 't1', title: 'Finalise hero copy' },
    },
    readAt: null,
    createdAt: '2026-11-15T09:00:00.000Z',
};

/** /api/auth/refresh handing out `token` (counting calls), or failing with `status`. */
function mockRefresh(token: string | null, status = 401) {
    const seen = { count: 0 };
    server.use(
        http.post(`${APP_ORIGIN}/api/auth/refresh`, () => {
            seen.count += 1;
            return token
                ? HttpResponse.json({ data: { accessToken: token, expiresIn: 900, user } })
                : HttpResponse.json(
                      { error: { code: 'UNAUTHORIZED', message: 'No', requestId: 'r' } },
                      { status },
                  );
        }),
    );
    return seen;
}

let stop: (() => void) | undefined;
const handlers = () => ({ onNotification: vi.fn(), onReconnected: vi.fn() });
function start(h = handlers()) {
    stop = startNotificationStream(h);
    return h;
}

beforeEach(() => {
    fake.reset();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at-1', expiresIn: 900, user });
});
afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetRefreshForTests();
    setTabHidden(false);
});

describe('connecting', () => {
    it('GET /api/v1/notifications/stream with the in-memory bearer token; opens', async () => {
        const stream = mockStreamFetch();
        start();

        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        expect(stream.requests).toHaveLength(1);
        expect(stream.requests[0]?.url).toBe(`${API_ORIGIN}/api/v1/notifications/stream`);
        expect(stream.auth()).toEqual(['Bearer at-1']);
        expect(stream.requests[0]?.headers.get('accept')).toBe('text/event-stream');
    });

    it('closes while the tab is hidden; showing it reconnects and asks to catch up', async () => {
        const stream = mockStreamFetch();
        const h = start();
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        const first = fake.latest();

        setTabHidden(true);
        expect(first.closed).toBe(true);
        expect(stream.requests).toHaveLength(1);
        expect(h.onReconnected).not.toHaveBeenCalled();

        setTabHidden(false);
        await vi.waitFor(() => expect(h.onReconnected).toHaveBeenCalledOnce());
        expect(stream.requests).toHaveLength(2);
        expect(streamState.get()).toBe('open');
    });

    it('stop() aborts it', async () => {
        const stream = mockStreamFetch();
        start();
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));

        stop?.();

        expect(fake.latest().closed).toBe(true);
        expect(streamState.get()).toBe('stopped');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(stream.requests).toHaveLength(1);
    });
});

describe('events', () => {
    it('a notification reaches onNotification; ready, malformed and other events don’t', async () => {
        mockStreamFetch();
        const h = start();
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        const s = fake.latest();

        s.emit({ event: 'ready', data: '{}' });
        s.emit({ event: 'notification', data: 'not json' });
        s.emit({ event: 'notification', data: JSON.stringify({ id: 1, type: 'TASK_ASSIGNED' }) });
        s.emit({ event: 'notification', data: JSON.stringify({ ...NOTE, payload: null }) });
        s.emit({ event: 'something', data: JSON.stringify(NOTE) });
        expect(h.onNotification).not.toHaveBeenCalled();

        s.emit({ event: 'notification', data: JSON.stringify(NOTE), id: NOTE.id });
        expect(h.onNotification).toHaveBeenCalledExactlyOnceWith(NOTE);
        expect(streamState.get()).toBe('open');
    });

    it('parseNotification keeps a type this client doesn’t know (the sentence falls back)', () => {
        expect(parseNotification(JSON.stringify({ ...NOTE, type: 'SOMETHING_NEW' }))?.type).toBe(
            'SOMETHING_NEW',
        );
    });
});

describe('auth', () => {
    it('401 TOKEN_EXPIRED: one refresh, then reconnects with the new token', async () => {
        const stream = mockStreamFetch([streamError(401, 'TOKEN_EXPIRED')]);
        const refresh = mockRefresh('at-2');
        const h = start();

        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        expect(stream.auth()).toEqual(['Bearer at-1', 'Bearer at-2']);
        expect(refresh.count).toBe(1);
        expect(sessionStore.get().accessToken).toBe('at-2');
        expect(h.onReconnected).not.toHaveBeenCalled(); // never opened before
    });

    it('no valid token in memory: refreshes first, never sends a stale one', async () => {
        sessionStore.setAuthenticated({ accessToken: 'old', expiresIn: 900, user }, 0);
        const stream = mockStreamFetch();
        const refresh = mockRefresh('at-2');
        start();

        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        expect(stream.auth()).toEqual(['Bearer at-2']);
        expect(refresh.count).toBe(1);
    });

    it('any other 401: stops — no refresh, no retry, and the stream doesn’t sign out', async () => {
        const stream = mockStreamFetch([streamError(401, 'UNAUTHORIZED')]);
        const refresh = mockRefresh('at-2');
        start();

        await vi.waitFor(() => expect(streamState.get()).toBe('stopped'));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(stream.requests).toHaveLength(1);
        expect(refresh.count).toBe(0);
        expect(sessionStore.get().status).toBe('authenticated');
    });

    it('the refresh is rejected (session over): stopped', async () => {
        mockStreamFetch([streamError(401, 'TOKEN_EXPIRED')]);
        mockRefresh(null, 401);
        start();

        await vi.waitFor(() => expect(sessionStore.get().status).toBe('unauthenticated'));
        await vi.waitFor(() => expect(streamState.get()).toBe('stopped'));
    });
});

describe('backoff', () => {
    it('retryDelay: 1 s doubling to a 30 s cap, less up to 25 % jitter', () => {
        const top = [1, 2, 3, 4, 5, 6, 7, 12].map((n) => retryDelay(n, () => 1));
        expect(top).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
        const bottom = [1, 2, 6].map((n) => retryDelay(n, () => 0));
        expect(bottom).toEqual([750, 1500, 22500]);
    });

    it('network errors: retries after growing delays, never signs out; an open resets it', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        vi.spyOn(Math, 'random').mockReturnValue(0); // delays 750, 1500, 3000 …
        const stream = mockStreamFetch([networkDown, networkDown, networkDown]);
        const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
        start();

        await tick(0);
        expect(stream.requests).toHaveLength(1);
        expect(streamState.get()).toBe('retrying');

        for (const [delay, after] of [
            [750, 2],
            [1500, 3],
            [3000, 4],
        ] as const) {
            await tick(delay - 1);
            expect(stream.requests).toHaveLength(after - 1);
            await tick(1);
            expect(stream.requests).toHaveLength(after);
        }
        expect(streamState.get()).toBe('open');
        expect(sessionStore.get().status).toBe('authenticated');

        // Dropped after a successful open: back to the first delay.
        fake.latest().drop();
        await tick(0);
        expect(streamState.get()).toBe('retrying');
        await tick(749);
        expect(stream.requests).toHaveLength(4);
        await tick(1);
        expect(stream.requests).toHaveLength(5);
        expect(stream.auth().every((a) => a === 'Bearer at-1')).toBe(true);
    });

    it('a 5xx or the server ending the stream: retried the same way, then catches up', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const stream = mockStreamFetch([streamError(503, 'UNAVAILABLE'), streamOk]);
        const h = start();
        const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

        await tick(750);
        expect(stream.requests).toHaveLength(2);
        expect(streamState.get()).toBe('open');
        expect(h.onReconnected).not.toHaveBeenCalled(); // the first open

        fake.latest().end();
        await tick(0);
        expect(streamState.get()).toBe('retrying');
        await tick(750);
        expect(streamState.get()).toBe('open');
        expect(h.onReconnected).toHaveBeenCalledOnce();
    });
});
