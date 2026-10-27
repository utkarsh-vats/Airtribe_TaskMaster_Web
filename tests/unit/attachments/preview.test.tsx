/*
 * The file preview: opened from a file's name, the file fetched through the API client
 * (Bearer), shown by type (image, PDF, text, none), text truncated at 1 MB and never parsed as
 * HTML, a 404 / error state, abort + revoke on close, moving between files, and Download.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AttachmentList } from '@/features/attachments/components/AttachmentList';
import {
    NO_PREVIEW_MESSAGE,
    TRUNCATED_MESSAGE,
} from '@/features/attachments/components/AttachmentPreview';
import { TEXT_PREVIEW_BYTES } from '@/features/attachments/preview';
import { FILE_GONE_MESSAGE } from '@/lib/api/download';
import type { Attachment, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';

vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const listUrl = `${API_ORIGIN}/api/v1/projects/p1/attachments`;

const user: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const file = (id: string, originalName: string, mimeType: string, sizeBytes = 2048) =>
    ({
        id,
        originalName,
        mimeType,
        sizeBytes,
        taskId: 't1',
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        uploadedBy: { id: 'u2', name: 'Priya Raman' },
    }) satisfies Attachment;

const hero = file('a1', 'hero.png', 'image/png', 3.4 * 1024 * 1024);
const brief = file('a2', 'brief.pdf', 'application/pdf');
const notes = file('a3', 'notes.txt', 'text/plain');
const assets = file('a4', 'assets.zip', 'application/zip');

type Download = { id: string; auth: string | null; signal: AbortSignal };

/**
 * The list (`files`) and each file's download: `bodies[id]` (a string, or a Response), PNG/PDF
 * stand-ins by default. Returns the downloads requested.
 */
function mockApi(
    files: Attachment[],
    bodies: Record<string, string | (() => Response | Promise<Response>)> = {},
) {
    const downloads: Download[] = [];
    server.use(
        // The list reads the project for its delete buttons (none here: no file is mine).
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () =>
            HttpResponse.json({
                data: {
                    id: 'p1',
                    name: 'Website relaunch',
                    description: null,
                    createdAt: '2026-10-01T09:00:00.000Z',
                    updatedAt: '2026-10-01T09:00:00.000Z',
                    myRole: 'MEMBER',
                    memberCount: 2,
                    owner: null,
                },
            }),
        ),
        http.get(listUrl, () =>
            HttpResponse.json({
                data: files,
                meta: { page: 1, limit: 50, total: files.length, totalPages: 1 },
            }),
        ),
        http.get(`${listUrl}/:id/download`, ({ params, request }) => {
            const id = String(params.id);
            downloads.push({
                id,
                auth: request.headers.get('Authorization'),
                signal: request.signal,
            });
            const body = bodies[id] ?? `content of ${id}`;
            return typeof body === 'string' ? new HttpResponse(body) : body();
        }),
    );
    return downloads;
}

function renderList() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <AttachmentList projectId="p1" taskId="t1" />
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

/** Click a file's name; returns the preview dialog. */
async function open(u: ReturnType<typeof userEvent.setup>, name: string) {
    await u.click(await screen.findByRole('button', { name }));
    return screen.findByRole('dialog', { name });
}

let urls: number;
let createObjectURL: MockInstance<(blob: Blob) => string>;
let revokeObjectURL: MockInstance<(url: string) => void>;
let clicks: { href: string; download: string }[];

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at-1', expiresIn: 900, user });
    vi.mocked(toast.error).mockClear();
    urls = 0;
    clicks = [];
    URL.createObjectURL = (() => '') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        urls += 1;
        return `blob:http://localhost:3001/obj-${urls}`;
    });
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
    ) {
        clicks.push({ href: this.href, download: this.download });
    });
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('opening', () => {
    it('clicking a name opens the preview: name, size · uploader, fetched with the Bearer token', async () => {
        const downloads = mockApi([hero]);
        const u = renderList();

        const dialog = await open(u, 'hero.png');

        expect(dialog).toHaveTextContent('3.4 MB · Priya Raman');
        expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
        await within(dialog).findByRole('img', { name: 'hero.png' });
        expect(downloads).toEqual([expect.objectContaining({ id: 'a1', auth: 'Bearer at-1' })]);
    });

    it('Enter on a focused name opens it too', async () => {
        mockApi([hero]);
        const u = renderList();
        (await screen.findByRole('button', { name: 'hero.png' })).focus();

        await u.keyboard('{Enter}');

        expect(await screen.findByRole('dialog', { name: 'hero.png' })).toBeInTheDocument();
    });

    it('the row’s Download icon still downloads directly, without the preview', async () => {
        const downloads = mockApi([hero]);
        const u = renderList();

        await u.click(await screen.findByRole('button', { name: 'Download hero.png' }));

        await vi.waitFor(() => expect(clicks).toHaveLength(1));
        expect(clicks[0]?.download).toBe('hero.png');
        expect(downloads).toHaveLength(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('by type', () => {
    it('loading: a skeleton block', async () => {
        mockApi([hero], {
            a1: async () => {
                await delay('infinite');
                return new HttpResponse('');
            },
        });
        const u = renderList();

        const dialog = await open(u, 'hero.png');

        expect(within(dialog).getByText('Loading preview…').parentElement).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });

    it('an image: <img> on the object URL, alt = the name, object-fit contain', async () => {
        mockApi([hero]);
        const u = renderList();

        const dialog = await open(u, 'hero.png');

        const img = await within(dialog).findByRole('img', { name: 'hero.png' });
        expect(img).toHaveAttribute('src', 'blob:http://localhost:3001/obj-1');
        expect(img).toHaveClass('object-contain');
    });

    it('a PDF: an <iframe> titled with the name on the object URL', async () => {
        mockApi([brief]);
        const u = renderList();

        const dialog = await open(u, 'brief.pdf');

        const frame = await vi.waitFor(() => {
            const el = dialog.querySelector('iframe');
            expect(el).not.toBeNull();
            return el as HTMLIFrameElement;
        });
        expect(frame).toHaveAttribute('title', 'brief.pdf');
        expect(frame).toHaveAttribute('src', 'blob:http://localhost:3001/obj-1');
    });

    it('text: shown as text in a <pre> — markup in the file shows literally', async () => {
        mockApi([notes], { a3: 'Line one\n<b>not bold</b> & <script>x()</script>' });
        const u = renderList();

        const dialog = await open(u, 'notes.txt');

        const pre = await vi.waitFor(() => {
            const el = dialog.querySelector('pre');
            expect(el).not.toBeNull();
            return el as HTMLPreElement;
        });
        expect(pre.textContent).toBe('Line one\n<b>not bold</b> & <script>x()</script>');
        expect(pre.querySelector('b, script')).toBeNull();
        expect(pre).toHaveClass('whitespace-pre-wrap');
        expect(within(dialog).queryByText(TRUNCATED_MESSAGE)).not.toBeInTheDocument();
        // No object URL needed for text.
        expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('text over 1 MB: the first 1 MB and "Preview truncated — download for the full file."', async () => {
        const big = 'a'.repeat(TEXT_PREVIEW_BYTES) + 'TAIL';
        mockApi([file('a5', 'big.txt', 'text/plain', big.length)], { a5: big });
        const u = renderList();

        const dialog = await open(u, 'big.txt');

        expect(await within(dialog).findByText(TRUNCATED_MESSAGE)).toBeInTheDocument();
        const pre = dialog.querySelector('pre') as HTMLPreElement;
        expect(pre.textContent).toHaveLength(TEXT_PREVIEW_BYTES);
        expect(pre.textContent).not.toContain('TAIL');
    });

    it('no preview: the type’s icon, the message and a primary Download — nothing fetched up front', async () => {
        const downloads = mockApi([assets]);
        const u = renderList();

        const dialog = await open(u, 'assets.zip');

        expect(within(dialog).getByText(NO_PREVIEW_MESSAGE)).toBeInTheDocument();
        expect(dialog.querySelector('svg.lucide-file-archive')).not.toBeNull();
        const download = within(dialog).getByRole('button', { name: 'Download assets.zip' });
        expect(download).toHaveClass('btn-primary');
        expect(downloads).toHaveLength(0);

        await u.click(download);

        await vi.waitFor(() =>
            expect(clicks).toEqual([expect.objectContaining({ download: 'assets.zip' })]),
        );
        expect(downloads).toHaveLength(1);
    });
});

describe('errors', () => {
    it('404: "This file is no longer available."', async () => {
        mockApi([hero], {
            a1: () =>
                HttpResponse.json(
                    { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r' } },
                    { status: 404 },
                ),
        });
        const u = renderList();

        const dialog = await open(u, 'hero.png');

        expect(await within(dialog).findByText(FILE_GONE_MESSAGE)).toBeInTheDocument();
        expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
    });

    it('others: ErrorState, and Retry fetches again', async () => {
        let fail = true;
        mockApi([hero], {
            a1: () =>
                fail
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                          { status: 500 },
                      )
                    : new HttpResponse('png'),
        });
        const u = renderList();

        const dialog = await open(u, 'hero.png');
        const alert = await within(dialog).findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load the preview");
        fail = false;
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await within(dialog).findByRole('img', { name: 'hero.png' })).toBeInTheDocument();
    });
});

describe('closing', () => {
    it('closing while it loads aborts the fetch', async () => {
        const downloads = mockApi([hero], {
            a1: async () => {
                await delay('infinite');
                return new HttpResponse('');
            },
        });
        const u = renderList();
        const dialog = await open(u, 'hero.png');
        await vi.waitFor(() => expect(downloads).toHaveLength(1));

        await u.click(within(dialog).getByRole('button', { name: 'Close' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await vi.waitFor(() => expect(downloads[0]?.signal.aborted).toBe(true));
    });

    it('closing revokes the object URL', async () => {
        mockApi([hero]);
        const u = renderList();
        const dialog = await open(u, 'hero.png');
        const img = await within(dialog).findByRole('img', { name: 'hero.png' });
        const url = img.getAttribute('src') as string;

        await u.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(revokeObjectURL).toHaveBeenCalledWith(url);
        // Every URL made was revoked (StrictMode-style re-attaches included).
        expect(revokeObjectURL).toHaveBeenCalledTimes(createObjectURL.mock.calls.length);
    });
});

describe('moving between files', () => {
    it('← / → and Previous / Next go through every file in the list, with "{i} of {n}"', async () => {
        mockApi([hero, assets, notes]);
        const u = renderList();
        let dialog = await open(u, 'hero.png');
        expect(dialog).toHaveTextContent('1 of 3');
        expect(within(dialog).getByRole('button', { name: 'Previous file' })).toBeDisabled();
        await within(dialog).findByRole('img', { name: 'hero.png' });

        await u.keyboard('{ArrowRight}');
        // Not previewable, still a stop.
        dialog = await screen.findByRole('dialog', { name: 'assets.zip' });
        expect(dialog).toHaveTextContent('2 of 3');
        // Leaving the image revoked its URL.
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost:3001/obj-1');

        await u.click(within(dialog).getByRole('button', { name: 'Next file' }));
        dialog = await screen.findByRole('dialog', { name: 'notes.txt' });
        expect(dialog).toHaveTextContent('3 of 3');
        expect(within(dialog).getByRole('button', { name: 'Next file' })).toBeDisabled();

        // At the end, → stays put.
        await u.keyboard('{ArrowRight}');
        expect(screen.getByRole('dialog', { name: 'notes.txt' })).toBeInTheDocument();

        await u.keyboard('{ArrowLeft}');
        dialog = await screen.findByRole('dialog', { name: 'assets.zip' });
        await u.click(within(dialog).getByRole('button', { name: 'Previous file' }));
        dialog = await screen.findByRole('dialog', { name: 'hero.png' });
        expect(dialog).toHaveTextContent('1 of 3');
    });
});

describe('Download in the header', () => {
    it('saves the file under its name, reusing what the preview fetched', async () => {
        const downloads = mockApi([brief]);
        const u = renderList();
        const dialog = await open(u, 'brief.pdf');
        await vi.waitFor(() => expect(dialog.querySelector('iframe')).not.toBeNull());

        await u.click(within(dialog).getByRole('button', { name: 'Download brief.pdf' }));

        expect(clicks).toEqual([expect.objectContaining({ download: 'brief.pdf' })]);
        expect(downloads).toHaveLength(1);
    });

    it('before the preview has loaded, it downloads on its own', async () => {
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        const downloads = mockApi([brief], {
            a2: async () => {
                if (downloads.length === 1) await held;
                return new HttpResponse('pdf');
            },
        });
        const u = renderList();
        const dialog = await open(u, 'brief.pdf');

        await u.click(within(dialog).getByRole('button', { name: 'Download brief.pdf' }));

        await vi.waitFor(() =>
            expect(clicks).toEqual([expect.objectContaining({ download: 'brief.pdf' })]),
        );
        expect(downloads).toHaveLength(2);
        release();
    });
});
