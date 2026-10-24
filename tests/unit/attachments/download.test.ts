/*
 * downloadAttachment: the file comes through the API client (bearer token, refresh-and-retry)
 * as a Blob and is saved through a temporary object URL and <a download>.
 */
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { downloadAttachment, FILE_GONE_MESSAGE } from '@/lib/api/download';
import type { User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, APP_ORIGIN, server } from '../../msw/server';

vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});
// A signed-in user whose refresh is rejected would be sent to /login.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const downloadUrl = `${API_ORIGIN}/api/v1/projects/p1/attachments/a1/download`;
const file = { id: 'a1', originalName: 'Launch plan (final).pdf' };

const user: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

// A string body: jsdom's Blob isn't one Node's fetch can send.
const pdf = () =>
    new HttpResponse('%PDF-1.7 hello', { headers: { 'Content-Type': 'application/pdf' } });
const apiError = (status: number, code: string) =>
    HttpResponse.json({ error: { code, message: `${code} message`, requestId: 'r' } }, { status });

/** What the anchor looked like when it was clicked. */
let clicks: { href: string; download: string; inDocument: boolean }[];
let createObjectURL: MockInstance<(blob: Blob) => string>;
let revokeObjectURL: MockInstance<(url: string) => void>;
let blobs: Blob[];

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at-1', expiresIn: 900, user });
    vi.mocked(toast.error).mockClear();
    clicks = [];
    blobs = [];
    // jsdom has no object URLs.
    URL.createObjectURL = (() => '') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        blobs.push(blob as Blob);
        return 'blob:http://localhost:3001/obj-1';
    });
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
    ) {
        clicks.push({ href: this.href, download: this.download, inDocument: this.isConnected });
    });
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('downloadAttachment', () => {
    it('fetches with the Bearer token, saves the Blob as originalName, then revokes the URL', async () => {
        const auth: (string | null)[] = [];
        server.use(
            http.get(downloadUrl, ({ request }) => {
                auth.push(request.headers.get('Authorization'));
                return pdf();
            }),
        );

        expect(await downloadAttachment('p1', file)).toBe(true);

        expect(auth).toEqual(['Bearer at-1']);
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(await blobs[0]?.text()).toBe('%PDF-1.7 hello');
        expect(clicks).toEqual([
            {
                href: 'blob:http://localhost:3001/obj-1',
                download: 'Launch plan (final).pdf',
                inDocument: true,
            },
        ]);
        // The temporary link is gone; the URL is revoked once the click has been handled.
        expect(document.querySelector('a[download]')).toBeNull();
        await vi.waitFor(() =>
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost:3001/obj-1'),
        );
    });

    it('401 TOKEN_EXPIRED: refreshes once and retries with the new token', async () => {
        const auth: (string | null)[] = [];
        let refreshes = 0;
        server.use(
            http.get(downloadUrl, ({ request }) => {
                const header = request.headers.get('Authorization');
                auth.push(header);
                return header === 'Bearer at-2' ? pdf() : apiError(401, 'TOKEN_EXPIRED');
            }),
            http.post(`${APP_ORIGIN}/api/auth/refresh`, () => {
                refreshes += 1;
                return HttpResponse.json({ data: { accessToken: 'at-2', expiresIn: 900, user } });
            }),
        );

        expect(await downloadAttachment('p1', file)).toBe(true);

        expect(refreshes).toBe(1);
        expect(auth).toEqual(['Bearer at-1', 'Bearer at-2']);
        expect(clicks).toHaveLength(1);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('404: "This file is no longer available." and nothing saved', async () => {
        server.use(http.get(downloadUrl, () => apiError(404, 'NOT_FOUND')));

        expect(await downloadAttachment('p1', file)).toBe(false);

        expect(toast.error).toHaveBeenCalledWith(FILE_GONE_MESSAGE);
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(clicks).toHaveLength(0);
    });

    it('other errors: the usual error toast', async () => {
        server.use(http.get(downloadUrl, () => apiError(500, 'INTERNAL_ERROR')));

        expect(await downloadAttachment('p1', file)).toBe(false);

        expect(toast.error).toHaveBeenCalledOnce();
        expect(toast.error).not.toHaveBeenCalledWith(FILE_GONE_MESSAGE);
        expect(clicks).toHaveLength(0);
    });

    it('a network failure toasts too', async () => {
        server.use(http.get(downloadUrl, () => HttpResponse.error()));

        expect(await downloadAttachment('p1', file)).toBe(false);

        expect(toast.error).toHaveBeenCalledOnce();
    });
});
