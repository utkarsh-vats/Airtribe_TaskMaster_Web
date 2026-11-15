import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source';
import { z } from 'zod';

import type { Notification } from '@/lib/api/types';
import { refreshSession } from '@/lib/auth/refresh';
import { sessionStore, validAccessToken } from '@/lib/auth/store';
import { env } from '@/lib/env';

/*
 * Live notifications (DESIGN.md §9) over GET /api/v1/notifications/stream, an SSE stream the
 * API authenticates like any request — `Authorization: Bearer <access token>`, checked once
 * when it connects (an expired token → 401 TOKEN_EXPIRED; an open stream isn't cut when the
 * token later expires). It sends `event: ready`, then `id` / `event: notification` / `data:
 * <Notification JSON>` per new notification, and a `: ping` comment every 25 s.
 * EventSource can't send the header, hence fetch-event-source.
 */

export type StreamState = 'connecting' | 'open' | 'retrying' | 'stopped';

let state: StreamState = 'stopped';
const listeners = new Set<() => void>();

function setState(next: StreamState) {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener();
}

/** The connection's state, for useSyncExternalStore: the unread poll pauses while 'open'. */
export const streamState = {
    get: (): StreamState => state,
    getServerSnapshot: (): StreamState => 'stopped',
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
};

const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 30_000;

/**
 * Backoff before reconnect attempt `attempt` (from 1): 1 s, 2 s, 4 s … capped at 30 s, less a
 * random 0–25 % so tabs that lost the same server don't all come back at once.
 */
export function retryDelay(attempt: number, random = Math.random): number {
    const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
    return Math.round(ceiling * (0.75 + 0.25 * random()));
}

const notificationSchema = z.object({
    id: z.string(),
    // Any type: one this client doesn't know yet gets the sentence fallback.
    type: z.string(),
    projectId: z.string().nullable(),
    taskId: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    readAt: z.string().nullable(),
    createdAt: z.string(),
});

/** A `notification` event's data, or null if it isn't one (malformed events are ignored). */
export function parseNotification(data: string): Notification | null {
    let json: unknown;
    try {
        json = JSON.parse(data);
    } catch {
        return null;
    }
    const parsed = notificationSchema.safeParse(json);
    return parsed.success ? (parsed.data as Notification) : null;
}

/** 401 TOKEN_EXPIRED, or no valid token to send: refresh, then connect again. */
class TokenExpired extends Error {}
/** Any other auth failure (or a missing endpoint): stop; the session logic signs out. */
class StopStream extends Error {}
/** A 5xx / 429 / unexpected response, or the server ended the stream: back off and retry. */
class RetryStream extends Error {}

async function errorCode(response: Response): Promise<string | null> {
    const body: unknown = await response.json().catch(() => null);
    const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
    return parsed.success ? parsed.data.error.code : null;
}

export type StreamHandlers = {
    onNotification: (notification: Notification) => void;
    /** Opened again after a drop or a hidden tab: catch up on what was missed meanwhile. */
    onReconnected: () => void;
};

const streamUrl = () =>
    `${env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1/notifications/stream`;

/**
 * Open the stream with the in-memory access token and keep it open: reconnect with backoff
 * after network errors, 5xx and server closes (never signing out); on TOKEN_EXPIRED run the
 * shared single-flight refresh and reconnect with the new token; stop on any other auth
 * failure. fetch-event-source closes it while the tab is hidden and reopens it when it's
 * shown. Returns stop(), which aborts it.
 */
export function startNotificationStream({ onNotification, onReconnected }: StreamHandlers) {
    const controller = new AbortController();
    /** Failed connects in a row; 0 after a successful open. */
    let attempt = 0;
    /** TOKEN_EXPIRED in a row: a second one right after a refresh waits (clock skew). */
    let expiredInARow = 0;
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // fetch-event-source copies the headers once; read the token on every (re)connect instead.
    const authedFetch: typeof fetch = (input, init) => {
        const token = validAccessToken();
        if (!token) return Promise.reject(new TokenExpired());
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return globalThis.fetch(input, { ...init, headers });
    };

    const later = () => {
        attempt += 1;
        setState('retrying');
        return retryDelay(attempt);
    };

    function connect() {
        if (controller.signal.aborted) return;
        setState(attempt > 0 ? 'retrying' : 'connecting');
        fetchEventSource(streamUrl(), {
            signal: controller.signal,
            openWhenHidden: false,
            fetch: authedFetch,
            async onopen(response) {
                const type = response.headers.get('content-type');
                if (response.ok && type?.startsWith(EventStreamContentType)) {
                    attempt = 0;
                    expiredInARow = 0;
                    setState('open');
                    if (opened) onReconnected();
                    opened = true;
                    return;
                }
                if (response.status === 401) {
                    throw (await errorCode(response)) === 'TOKEN_EXPIRED'
                        ? new TokenExpired()
                        : new StopStream();
                }
                if (response.status === 403 || response.status === 404) throw new StopStream();
                throw new RetryStream(`Stream answered ${response.status}`);
            },
            onmessage(message) {
                if (message.event !== 'notification') return;
                const notification = parseNotification(message.data);
                if (notification) onNotification(notification);
            },
            onclose() {
                throw new RetryStream('Stream closed');
            },
            onerror(error) {
                if (error instanceof TokenExpired || error instanceof StopStream) throw error;
                return later();
            },
        }).catch(async (error: unknown) => {
            if (controller.signal.aborted) return;
            if (!(error instanceof TokenExpired)) {
                setState('stopped');
                return;
            }
            expiredInARow += 1;
            setState('connecting');
            const token = await refreshSession();
            if (controller.signal.aborted) return;
            // Refresh rejected: the session is over (the session logic signs out).
            if (sessionStore.get().status !== 'authenticated') {
                setState('stopped');
                return;
            }
            if (token && expiredInARow === 1) connect();
            // Rate limited / API down, or expired again straight after a refresh: back off.
            else timer = setTimeout(connect, later());
        });
    }

    connect();

    return function stop() {
        controller.abort();
        clearTimeout(timer);
        setState('stopped');
    };
}
