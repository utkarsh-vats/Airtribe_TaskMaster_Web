import { vi } from 'vitest';

/*
 * A stand-in for XMLHttpRequest (uploads, src/lib/api/upload.ts): MSW can't fake upload
 * progress, so tests drive each request by hand — progress(), respond(), fail() — and see what
 * was sent. installFakeXhr() swaps it in for the test file (vi.unstubAllGlobals restores it).
 */

type Handler = ((event: ProgressEvent) => void) | null;

export class FakeXhr {
    /** Every request sent, oldest first. */
    static sent: FakeXhr[] = [];
    /** Answers each request as it's sent, if set (else the test calls respond() itself). */
    static autoRespond: ((xhr: FakeXhr) => void) | null = null;

    method = '';
    url = '';
    headers: Record<string, string> = {};
    body: unknown = null;
    status = 0;
    responseText = '';
    aborted = false;
    done = false;

    upload: { onprogress: Handler } = { onprogress: null };
    onload: Handler = null;
    onerror: Handler = null;
    ontimeout: Handler = null;
    onabort: Handler = null;

    open(method: string, url: string) {
        this.method = method;
        this.url = url;
    }

    setRequestHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
    }

    send(body: unknown) {
        this.body = body;
        FakeXhr.sent.push(this);
        FakeXhr.autoRespond?.(this);
    }

    abort() {
        if (this.done) return;
        this.aborted = true;
        this.done = true;
        this.onabort?.(new ProgressEvent('abort'));
    }

    // ── test controls ──

    get form(): FormData {
        if (!(this.body instanceof FormData)) throw new Error('Not a FormData body');
        return this.body;
    }

    progress(loaded: number, total: number) {
        this.upload.onprogress?.(
            new ProgressEvent('progress', { lengthComputable: true, loaded, total }),
        );
    }

    respond(status: number, body: unknown) {
        if (this.done) return;
        this.done = true;
        this.status = status;
        this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
        this.onload?.(new ProgressEvent('load'));
    }

    fail() {
        if (this.done) return;
        this.done = true;
        this.onerror?.(new ProgressEvent('error'));
    }
}

export function installFakeXhr() {
    FakeXhr.sent = [];
    FakeXhr.autoRespond = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
}

/** The API's error envelope. */
export const errorBody = (code: string, message = `${code} message`) => ({
    error: { code, message, requestId: 'r' },
});
