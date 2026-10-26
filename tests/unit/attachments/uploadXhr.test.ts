/*
 * uploadAttachment (9d): XMLHttpRequest with the bearer token and a multipart body, progress,
 * one refresh-and-retry on 401 TOKEN_EXPIRED, errors as ApiErrors, and a silent cancel.
 * XMLHttpRequest is faked (tests/fakeXhr.ts); the refresh goes through MSW.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadErrorMessage } from '@/features/attachments/useUploadQueue';
import { ERROR_CODES } from '@/lib/api/errors';
import { errorMessage, TOO_LARGE_MESSAGE, TYPE_NOT_ALLOWED_MESSAGE } from '@/lib/api/messages';
import type { Attachment, User } from '@/lib/api/types';
import { uploadAttachment, type UploadProgress, type UploadResult } from '@/lib/api/upload';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionEnded } from '@/lib/auth/sessionEnded';
import { sessionStore } from '@/lib/auth/store';

import { errorBody, FakeXhr, installFakeXhr } from '../../fakeXhr';
import { API_ORIGIN, APP_ORIGIN, server } from '../../msw/server';

vi.mock('@/lib/auth/sessionEnded', () => ({ sessionEnded: vi.fn() }));

const uploadUrl = `${API_ORIGIN}/api/v1/projects/p1/attachments`;

const user: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const saved: Attachment = {
    id: 'a9',
    originalName: 'brief.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 9,
    taskId: 't1',
    createdAt: '2026-10-24T09:00:00.000Z',
    uploadedBy: { id: 'u1', name: 'Mara Okafor' },
};

const pdf = () => new File(['%PDF-1.7'], 'brief.pdf', { type: 'application/pdf' });

/** The nth request, once it has been sent. */
async function request(n = 0) {
    await vi.waitFor(() => expect(FakeXhr.sent.length).toBeGreaterThan(n));
    return FakeXhr.sent[n] as FakeXhr;
}

beforeEach(() => {
    installFakeXhr();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at-1', expiresIn: 900, user });
    vi.mocked(sessionEnded).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.unstubAllGlobals();
});

describe('the request', () => {
    it('POSTs multipart with the Bearer token, the file and taskId; no Content-Type of its own', async () => {
        const file = pdf();
        const done = uploadAttachment({ projectId: 'p1', file, taskId: 't1' });

        const xhr = await request();
        expect(xhr.method).toBe('POST');
        expect(xhr.url).toBe(uploadUrl);
        expect(xhr.headers).toEqual({ authorization: 'Bearer at-1' });
        expect(xhr.form.get('taskId')).toBe('t1');
        const sent = xhr.form.get('file') as File;
        expect(sent.name).toBe('brief.pdf');
        expect(await sent.text()).toBe('%PDF-1.7');

        xhr.respond(201, { data: saved });
        expect(await done).toEqual({ status: 'uploaded', attachment: saved });
    });

    it('a project-level file: no taskId field', async () => {
        const done = uploadAttachment({ projectId: 'p1', file: pdf() });

        const xhr = await request();
        expect(xhr.form.has('taskId')).toBe(false);
        xhr.respond(201, { data: { ...saved, taskId: null } });
        expect((await done).status).toBe('uploaded');
    });

    it('reports upload progress', async () => {
        const progress: UploadProgress[] = [];
        const done = uploadAttachment({
            projectId: 'p1',
            file: pdf(),
            onProgress: (p) => progress.push(p),
        });

        const xhr = await request();
        xhr.progress(4, 8);
        xhr.progress(8, 8);
        xhr.respond(201, { data: saved });
        await done;

        expect(progress).toEqual([
            { loaded: 4, total: 8 },
            { loaded: 8, total: 8 },
        ]);
    });
});

describe('401', () => {
    it('TOKEN_EXPIRED: refreshes once, then retries from a fresh request with the new token', async () => {
        let refreshes = 0;
        server.use(
            http.post(`${APP_ORIGIN}/api/auth/refresh`, () => {
                refreshes += 1;
                return HttpResponse.json({ data: { accessToken: 'at-2', expiresIn: 900, user } });
            }),
        );
        FakeXhr.autoRespond = (xhr) =>
            xhr.headers.authorization === 'Bearer at-2'
                ? xhr.respond(201, { data: saved })
                : xhr.respond(401, errorBody(ERROR_CODES.TOKEN_EXPIRED));
        const progress: UploadProgress[] = [];

        const result = await uploadAttachment({
            projectId: 'p1',
            file: pdf(),
            taskId: 't1',
            onProgress: (p) => progress.push(p),
        });

        expect(result).toEqual({ status: 'uploaded', attachment: saved });
        expect(refreshes).toBe(1);
        expect(FakeXhr.sent.map((x) => x.headers.authorization)).toEqual([
            'Bearer at-1',
            'Bearer at-2',
        ]);
        expect(FakeXhr.sent[1]).not.toBe(FakeXhr.sent[0]);
        expect((FakeXhr.sent[1] as FakeXhr).form.get('file')).toBeInstanceOf(File);
        // The bar goes back to 0 for the second attempt.
        expect(progress).toEqual([{ loaded: 0, total: 8 }]);
        expect(sessionEnded).not.toHaveBeenCalled();
    });

    it('TOKEN_EXPIRED twice: retried only once, then signed out', async () => {
        server.use(
            http.post(`${APP_ORIGIN}/api/auth/refresh`, () =>
                HttpResponse.json({ data: { accessToken: 'at-2', expiresIn: 900, user } }),
            ),
        );
        FakeXhr.autoRespond = (xhr) => xhr.respond(401, errorBody(ERROR_CODES.TOKEN_EXPIRED));

        const result = await uploadAttachment({ projectId: 'p1', file: pdf() });

        expect(FakeXhr.sent).toHaveLength(2);
        expect(result.status).toBe('failed');
        expect(sessionEnded).toHaveBeenCalledOnce();
    });

    it('any other 401: the same sign-out as the API client, no retry', async () => {
        FakeXhr.autoRespond = (xhr) => xhr.respond(401, errorBody(ERROR_CODES.UNAUTHORIZED));

        const result = await uploadAttachment({ projectId: 'p1', file: pdf() });

        expect(FakeXhr.sent).toHaveLength(1);
        expect(result.status).toBe('failed');
        expect(sessionEnded).toHaveBeenCalledOnce();
    });
});

describe('errors', () => {
    const failed = async (status: number, body: unknown) => {
        FakeXhr.autoRespond = (xhr) => xhr.respond(status, body);
        const result: UploadResult = await uploadAttachment({
            projectId: 'p1',
            file: pdf(),
            taskId: 't1',
        });
        if (result.status !== 'failed') throw new Error(`Expected a failure, got ${result.status}`);
        return result.error;
    };

    it('413 PAYLOAD_TOO_LARGE → "Too large — max 10 MB."', async () => {
        const error = await failed(413, errorBody(ERROR_CODES.PAYLOAD_TOO_LARGE));
        expect(error).toMatchObject({ status: 413, code: ERROR_CODES.PAYLOAD_TOO_LARGE });
        expect(errorMessage(error)).toBe(TOO_LARGE_MESSAGE);
        expect(TOO_LARGE_MESSAGE).toBe('Too large — max 10 MB.');
    });

    it('415 UNSUPPORTED_MEDIA_TYPE → "That file type isn’t allowed."', async () => {
        const error = await failed(415, errorBody(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE));
        expect(error.code).toBe(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
        expect(errorMessage(error)).toBe(TYPE_NOT_ALLOWED_MESSAGE);
    });

    it('404: the task is gone', async () => {
        const error = await failed(404, errorBody(ERROR_CODES.NOT_FOUND));
        expect(uploadErrorMessage(error, true)).toBe('This task no longer exists.');
    });

    it('422: the first detail’s message', async () => {
        const error = await failed(422, {
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid',
                requestId: 'r',
                details: [{ path: 'taskId', message: 'Invalid uuid' }],
            },
        });
        expect(uploadErrorMessage(error, true)).toBe('Invalid uuid');
    });

    it('a body that isn’t the envelope (proxy HTML) → INTERNAL_ERROR with the status', async () => {
        const error = await failed(502, '<html>Bad gateway</html>');
        expect(error).toMatchObject({ status: 502, code: ERROR_CODES.INTERNAL_ERROR });
    });

    it('no response → NETWORK_ERROR', async () => {
        FakeXhr.autoRespond = (xhr) => xhr.fail();
        const result = await uploadAttachment({ projectId: 'p1', file: pdf() });
        expect(result).toMatchObject({ status: 'failed', error: { code: 'NETWORK_ERROR' } });
    });
});

describe('cancel', () => {
    it('aborting the signal aborts the request: a cancelled result', async () => {
        const controller = new AbortController();
        const done = uploadAttachment({ projectId: 'p1', file: pdf(), signal: controller.signal });

        const xhr = await request();
        controller.abort();

        expect(await done).toEqual({ status: 'cancelled' });
        expect(xhr.aborted).toBe(true);
    });

    it('already aborted: nothing is sent', async () => {
        const controller = new AbortController();
        controller.abort();

        const result = await uploadAttachment({
            projectId: 'p1',
            file: pdf(),
            signal: controller.signal,
        });

        expect(result).toEqual({ status: 'cancelled' });
        expect(FakeXhr.sent).toHaveLength(0);
    });
});
