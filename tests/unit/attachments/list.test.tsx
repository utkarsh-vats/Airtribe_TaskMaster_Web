/*
 * Attachment lists (9c): rows (icon by MIME type, name, size, uploader, time), paging, the
 * list states, and the per-row download button. The download itself is download.test.ts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { attachmentListKey } from '@/features/attachments/api';
import { AttachmentList } from '@/features/attachments/components/AttachmentList';
import { fileKind } from '@/features/attachments/fileKind';
import type { Attachment, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';
import { refetchAndFail } from '../../refetch';

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

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

let seq = 0;
const attachment = (overrides: Partial<Attachment> = {}): Attachment => {
    seq += 1;
    return {
        id: `a${seq}`,
        originalName: `File ${seq}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 2048,
        taskId: 't1',
        createdAt: hoursAgo(1),
        uploadedBy: { id: 'u2', name: 'Priya Raman' },
        ...overrides,
    };
};

/** GET the list from `files` (50 a page, like the API); returns the query strings. */
function mockList(files: Attachment[]) {
    const requests: URLSearchParams[] = [];
    server.use(
        http.get(listUrl, ({ request }) => {
            const search = new URL(request.url).searchParams;
            requests.push(search);
            const page = Number(search.get('page') ?? 1);
            const limit = Number(search.get('limit') ?? 50);
            return HttpResponse.json({
                data: files.slice((page - 1) * limit, page * limit),
                meta: {
                    page,
                    limit,
                    total: files.length,
                    totalPages: Math.ceil(files.length / limit),
                },
            });
        }),
    );
    return requests;
}

let client: QueryClient;

function renderList(taskId: string | null = 't1', count?: number) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <AttachmentList projectId="p1" taskId={taskId} count={count} />
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const rows = () =>
    within(screen.getByRole('list', { name: 'Attachments' })).getAllByRole('listitem');

beforeEach(() => {
    seq = 0;
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('rows', () => {
    it('icon by type, name (full name in the title), size, uploader, time', async () => {
        const long = 'Quarterly revenue forecast with regional breakdown and notes.xlsx';
        mockList([
            attachment({
                originalName: 'hero.png',
                mimeType: 'image/png',
                sizeBytes: 3.4 * 1024 * 1024,
                createdAt: hoursAgo(2),
            }),
            attachment({
                originalName: long,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeBytes: 12 * 1024,
                uploadedBy: { id: 'u3', name: 'Jonas Weber' },
            }),
            attachment({ originalName: 'assets.zip', mimeType: 'application/zip', sizeBytes: 512 }),
            attachment({ originalName: 'brief.pdf', mimeType: 'application/pdf' }),
            attachment({ originalName: 'mystery.bin', mimeType: 'application/octet-stream' }),
        ]);
        renderList();

        await screen.findByText('hero.png');
        const [hero, sheet, zip, pdf, bin] = rows() as HTMLElement[];
        expect([hero, sheet, zip, pdf, bin].map((row) => row?.dataset.fileKind)).toEqual([
            'image',
            'spreadsheet',
            'archive',
            'document',
            'other',
        ]);
        expect(hero?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(hero).toHaveTextContent('3.4 MB · Priya Raman · 2 h ago');
        expect(within(hero as HTMLElement).getByText('2 h ago').tagName).toBe('TIME');
        expect(within(sheet as HTMLElement).getByText(long)).toHaveAttribute('title', long);
        expect(within(sheet as HTMLElement).getByText(long)).toHaveClass('truncate');
        expect(sheet).toHaveTextContent('12 KB · Jonas Weber');
        expect(zip).toHaveTextContent('512 B');
        expect(
            within(pdf as HTMLElement).getByRole('button', { name: 'Download brief.pdf' }),
        ).toBeInTheDocument();
    });

    it('the count: the given one (the task’s), else the list total', async () => {
        mockList([attachment(), attachment()]);
        renderList('t1', 7);

        await screen.findByText('File 1.txt');
        expect(screen.getByTestId('attachment-count')).toHaveTextContent('7');
    });

    it('project-level: taskId=none and the list total', async () => {
        const requests = mockList([attachment({ taskId: null })]);
        renderList(null);

        await screen.findByText('File 1.txt');
        expect(requests[0]?.get('taskId')).toBe('none');
        expect(screen.getByTestId('attachment-count')).toHaveTextContent('1');
    });

    it('Load more fetches page 2 and appends it', async () => {
        const requests = mockList(Array.from({ length: 51 }, () => attachment()));
        const u = renderList();
        await screen.findByText('File 50.txt');
        expect(rows()).toHaveLength(50);

        await u.click(screen.getByRole('button', { name: 'Load more' }));

        await screen.findByText('File 51.txt');
        expect(rows()).toHaveLength(51);
        expect(rows().at(-1)).toHaveTextContent('File 51.txt');
        expect(requests.map((r) => r.get('page'))).toEqual(['1', '2']);
        expect(requests[0]?.get('limit')).toBe('50');
        expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });
});

describe('states', () => {
    it('empty', async () => {
        mockList([]);
        renderList();

        expect(await screen.findByText('No files yet.')).toBeInTheDocument();
    });

    it('loading: skeleton rows', () => {
        server.use(
            http.get(listUrl, async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        renderList();

        expect(screen.getByText('Loading attachments…').parentElement).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });

    it('a background refetch that fails keeps the files on screen (no error state)', async () => {
        mockList([
            attachment({ originalName: 'one.txt' }),
            attachment({ originalName: 'two.txt' }),
        ]);
        renderList();
        await screen.findByText('two.txt');

        server.use(
            http.get(listUrl, () =>
                HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                ),
            ),
        );
        await refetchAndFail(client, attachmentListKey('p1', 't1'));

        expect(rows()).toHaveLength(2);
        expect(screen.getByText('one.txt')).toBeVisible();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('error, then Try again', async () => {
        let fail = true;
        server.use(
            http.get(listUrl, () =>
                fail
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                          { status: 500 },
                      )
                    : HttpResponse.json({
                          data: [attachment({ originalName: 'back.txt' })],
                          meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
                      }),
            ),
        );
        const u = renderList();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load attachments");
        fail = false;
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByText('back.txt')).toBeInTheDocument();
    });
});

describe('download button', () => {
    it('spins only on the row being downloaded, until it finishes', async () => {
        mockList([
            attachment({ originalName: 'one.txt' }),
            attachment({ originalName: 'two.txt' }),
        ]);
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        server.use(
            http.get(`${listUrl}/a1/download`, async () => {
                await held;
                return new HttpResponse('one');
            }),
        );
        URL.createObjectURL = (() => 'blob:x') as typeof URL.createObjectURL;
        URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const u = renderList();
        await screen.findByText('one.txt');

        const one = screen.getByRole('button', { name: 'Download one.txt' });
        const two = screen.getByRole('button', { name: 'Download two.txt' });
        await u.click(one);

        expect(one).toHaveAttribute('aria-busy', 'true');
        expect(one).toBeDisabled();
        expect(two).not.toHaveAttribute('aria-busy');
        expect(two).toBeEnabled();

        release();
        await vi.waitFor(() => expect(one).not.toHaveAttribute('aria-busy'));
        expect(click).toHaveBeenCalledOnce();
    });
});

describe('fileKind', () => {
    it.each([
        ['image/jpeg', 'image'],
        ['IMAGE/SVG+XML', 'image'],
        ['text/csv', 'spreadsheet'],
        ['application/vnd.ms-excel', 'spreadsheet'],
        ['application/x-7z-compressed', 'archive'],
        ['text/markdown; charset=utf-8', 'document'],
        ['application/msword', 'document'],
        ['video/mp4', 'other'],
        ['', 'other'],
    ])('%s → %s', (mime, kind) => {
        expect(fileKind(mime)).toBe(kind);
    });
});
