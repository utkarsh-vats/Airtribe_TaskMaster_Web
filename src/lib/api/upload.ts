'use client';

import { removeTrailingSlash } from 'openapi-fetch';

import { sessionEnded } from '@/lib/auth/sessionEnded';
import { env } from '@/lib/env';

import { currentAccessToken, isSessionOver, tokenAfterExpiry } from './client';
import { ERROR_CODES, networkError, toApiError, type ApiError } from './errors';
import type { Attachment } from './types';

export type UploadProgress = { loaded: number; total: number };

/** How an upload ended. It never rejects: a failure is a result, a cancel is silent. */
export type UploadResult =
    | { status: 'uploaded'; attachment: Attachment }
    | { status: 'failed'; error: ApiError }
    | { status: 'cancelled' };

export type UploadOptions = {
    projectId: string;
    file: File;
    /** The task to attach it to; omitted for a project-level file. */
    taskId?: string | undefined;
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal | undefined;
};

/** What one XMLHttpRequest came back with. */
type Sent =
    | { kind: 'response'; status: number; body: unknown }
    | { kind: 'network'; cause: unknown }
    | { kind: 'aborted' };

/**
 * POST /projects/{pid}/attachments (DESIGN.md §7 "Uploads") as multipart/form-data with
 * `taskId` (optional) and `file`. XMLHttpRequest, not fetch, for upload progress — so it does
 * by hand what the API client's middleware does: the bearer token, one refresh-and-retry on
 * 401 TOKEN_EXPIRED (from a fresh request, progress back to 0), and sign-out on any other
 * 401. The browser sets the Content-Type (with the multipart boundary) itself.
 */
export async function uploadAttachment({
    projectId,
    file,
    taskId,
    onProgress,
    signal,
}: UploadOptions): Promise<UploadResult> {
    const url = `${removeTrailingSlash(env.NEXT_PUBLIC_API_URL)}/api/v1/projects/${encodeURIComponent(projectId)}/attachments`;
    const form = () => {
        const data = new FormData();
        // Fields before the file, so the API has them when it reads the file.
        if (taskId) data.append('taskId', taskId);
        data.append('file', file, file.name);
        return data;
    };

    const token = await currentAccessToken();
    let sent = await send(url, form(), token, onProgress, signal);

    if (sent.kind === 'response' && sent.status === 401) {
        const error = await errorOf(sent.status, sent.body);
        if (error.code === ERROR_CODES.TOKEN_EXPIRED) {
            const fresh = await tokenAfterExpiry(token);
            if (fresh) {
                onProgress?.({ loaded: 0, total: file.size });
                // A retry is never retried again.
                sent = await send(url, form(), fresh, onProgress, signal);
                if (sent.kind === 'response' && sent.status === 401) sessionEnded();
            } else if (isSessionOver()) {
                sessionEnded();
            }
        } else {
            sessionEnded();
        }
    }

    if (sent.kind === 'aborted') return { status: 'cancelled' };
    if (sent.kind === 'network') return { status: 'failed', error: networkError(sent.cause) };
    if (sent.status === 201 || sent.status === 200) {
        const attachment = attachmentOf(sent.body);
        if (attachment) return { status: 'uploaded', attachment };
    }
    return { status: 'failed', error: await errorOf(sent.status, sent.body) };
}

function send(
    url: string,
    body: FormData,
    token: string | null,
    onProgress: UploadOptions['onProgress'],
    signal: AbortSignal | undefined,
): Promise<Sent> {
    if (signal?.aborted) return Promise.resolve({ kind: 'aborted' });

    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const settle = (sent: Sent) => {
            signal?.removeEventListener('abort', abort);
            resolve(sent);
        };

        xhr.open('POST', url);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onProgress?.({ loaded: event.loaded, total: event.total });
        };
        xhr.onload = () =>
            settle(
                // Status 0 means no real response (e.g. blocked by CORS).
                xhr.status === 0
                    ? { kind: 'network', cause: new Error('No response') }
                    : { kind: 'response', status: xhr.status, body: parseBody(xhr.responseText) },
            );
        xhr.onerror = () => settle({ kind: 'network', cause: new Error('Network error') });
        xhr.ontimeout = () => settle({ kind: 'network', cause: new Error('Timed out') });
        xhr.onabort = () => settle({ kind: 'aborted' });
        signal?.addEventListener('abort', abort, { once: true });
        xhr.send(body);
    });
}

function parseBody(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/** The ApiError for an error response, from its parsed body. */
const errorOf = (status: number, body: unknown) => toApiError(new Response(null, { status }), body);

function attachmentOf(body: unknown): Attachment | null {
    if (typeof body !== 'object' || body === null || !('data' in body)) return null;
    const data = body.data;
    return typeof data === 'object' && data !== null && 'id' in data ? (data as Attachment) : null;
}
