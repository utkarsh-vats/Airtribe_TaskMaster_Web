import type { EventSourceMessage, FetchEventSourceInit } from '@microsoft/fetch-event-source';
import { vi } from 'vitest';

/** One opened stream (its onopen accepted the response): the test plays the server. */
export type FakeStream = {
    /** Deliver an SSE message (onmessage). */
    emit: (message: { event: string; data: string; id?: string }) => void;
    /** The server ends the stream normally (onclose). */
    end: () => void;
    /** The connection drops mid-stream (a network error). */
    drop: () => void;
    /** Aborted: by the caller's signal, or because the tab was hidden. */
    readonly closed: boolean;
};

/**
 * Stand-in for @microsoft/fetch-event-source 2.0.1's fetchEventSource, with its control flow
 * (lib/esm/fetch.js): fetch via `options.fetch`, `onopen`, messages, `onclose` on a normal
 * end; any error → `onerror`, whose return value is the retry delay (setTimeout) and whose
 * throw rejects; `signal` abort resolves; with `openWhenHidden: false` a hidden tab aborts the
 * request and showing it again reconnects at once. Only the byte parsing is left out: tests
 * call emit() on the opened stream instead.
 */
export function createFakeEventSource() {
    const streams: FakeStream[] = [];
    let calls = 0;

    function fetchEventSource(input: RequestInfo, options: FetchEventSourceInit): Promise<void> {
        calls += 1;
        const { signal, onopen, onmessage, onclose, onerror, openWhenHidden } = options;
        const doFetch = options.fetch ?? globalThis.fetch;
        const headers: Record<string, string> = { accept: 'text/event-stream', ...options.headers };

        return new Promise((resolve, reject) => {
            let current = new AbortController();
            let retryTimer: ReturnType<typeof setTimeout> | undefined;
            const onVisibilityChange = () => {
                current.abort();
                if (!document.hidden) void create();
            };
            if (!openWhenHidden) document.addEventListener('visibilitychange', onVisibilityChange);
            const dispose = () => {
                document.removeEventListener('visibilitychange', onVisibilityChange);
                clearTimeout(retryTimer);
                current.abort();
            };
            signal?.addEventListener('abort', () => {
                dispose();
                resolve();
            });

            async function create() {
                const mine = new AbortController();
                current = mine;
                try {
                    const response = await doFetch(input, { headers, signal: mine.signal });
                    await onopen?.(response);
                    await new Promise<void>((done, fail) => {
                        mine.signal.addEventListener('abort', () =>
                            fail(new DOMException('Aborted', 'AbortError')),
                        );
                        streams.push({
                            emit: ({ event, data, id = '' }) => {
                                const message: EventSourceMessage = { event, data, id };
                                onmessage?.(message);
                            },
                            end: done,
                            drop: () => fail(new TypeError('network error')),
                            get closed() {
                                return mine.signal.aborted;
                            },
                        });
                    });
                    onclose?.();
                    dispose();
                    resolve();
                } catch (error) {
                    if (mine.signal.aborted) return;
                    try {
                        const interval = onerror?.(error) ?? 1000;
                        clearTimeout(retryTimer);
                        retryTimer = setTimeout(() => void create(), interval);
                    } catch (fatal) {
                        dispose();
                        reject(fatal instanceof Error ? fatal : new Error(String(fatal)));
                    }
                }
            }
            void create();
        });
    }

    return {
        fetchEventSource,
        streams,
        /** The latest opened stream. */
        latest: () => {
            const stream = streams.at(-1);
            if (!stream) throw new Error('No stream has opened');
            return stream;
        },
        /** fetchEventSource() calls (one per start or post-refresh reconnect). */
        calls: () => calls,
        reset: () => {
            streams.length = 0;
            calls = 0;
        },
    };
}

// ── the stream's HTTP side ───────────────────────────────────────────────────────────

/** A response for one connect attempt, or a network failure. */
export type StreamReply = () => Response | Promise<Response>;

export const streamOk: StreamReply = () =>
    new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } });
export const streamError =
    (status: number, code: string): StreamReply =>
    () =>
        Response.json({ error: { code, message: code, requestId: 'r' } }, { status });
export const networkDown: StreamReply = () => Promise.reject(new TypeError('Failed to fetch'));

/**
 * Answer fetches to the stream URL from `replies` in turn (then `fallback`, default 200), and
 * record each one's headers; every other fetch goes on to MSW. Restore with vi.restoreAllMocks.
 */
export function mockStreamFetch(replies: StreamReply[] = [], fallback: StreamReply = streamOk) {
    const requests: { url: string; headers: Headers }[] = [];
    const next = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith('/api/v1/notifications/stream')) return next(input, init);
        requests.push({ url, headers: new Headers(init?.headers) });
        return Promise.resolve().then(replies.shift() ?? fallback);
    });
    return {
        requests,
        auth: () => requests.map((r) => r.headers.get('Authorization')),
        reply: (...more: StreamReply[]) => replies.push(...more),
    };
}

/** Hide or show the tab (jsdom's document.hidden is read-only), firing visibilitychange. */
export function setTabHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
}
