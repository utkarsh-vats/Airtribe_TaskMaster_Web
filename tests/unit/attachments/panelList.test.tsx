/*
 * Attachments in the task panel: newest first (the API's order, uploads on top), the cap of 3
 * with "Show N more" / "Show less", and the collapsible section. AttachmentList is rendered as
 * the panel uses it (sectionKey + cap); the Files tab (no cap) is in discussionFiles.test.tsx.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSectionsForTests } from '@/components/ui/CollapsibleSection';
import { AttachmentList } from '@/features/attachments/components/AttachmentList';
import { TASK_PANEL_ATTACHMENT_CAP } from '@/features/tasks/components/TaskPanel';
import type { Attachment, ProjectDetail, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { FakeXhr, installFakeXhr } from '../../fakeXhr';
import { API_ORIGIN, server } from '../../msw/server';

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const listUrl = `${API_ORIGIN}/api/v1/projects/p1/attachments`;

const me: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

/** File n, n hours old (so file 1 is the newest), uploaded by me. */
const file = (n: number): Attachment => ({
    id: `a${n}`,
    originalName: `file-${n}.txt`,
    mimeType: 'text/plain',
    sizeBytes: 100,
    taskId: 't1',
    createdAt: new Date(Date.now() - n * 3_600_000).toISOString(),
    uploadedBy: { id: me.id, name: me.name },
});

/** The list as the API sends it — newest first — kept up to date by DELETE. */
function mockApi(files: Attachment[]) {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () =>
            HttpResponse.json({
                data: {
                    id: 'p1',
                    name: 'Website relaunch',
                    description: null,
                    createdAt: '2026-10-01T09:00:00.000Z',
                    updatedAt: '2026-10-01T09:00:00.000Z',
                    myRole: 'MEMBER',
                    memberCount: 1,
                    owner: null,
                } satisfies ProjectDetail,
            }),
        ),
        http.get(listUrl, () =>
            HttpResponse.json({
                data: files,
                meta: { page: 1, limit: 50, total: files.length, totalPages: 1 },
            }),
        ),
        http.delete(`${listUrl}/:id`, ({ params }) => {
            files.splice(
                files.findIndex((f) => f.id === params.id),
                1,
            );
            return new HttpResponse(null, { status: 204 });
        }),
    );
}

function renderPanelList() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <AttachmentList
                projectId="p1"
                taskId="t1"
                sectionKey="task-attachments"
                cap={TASK_PANEL_ATTACHMENT_CAP}
            />
        </QueryClientProvider>,
    );
    return userEvent.setup({ applyAccept: false });
}

/** The names of the listed files, top to bottom. */
const names = () =>
    within(screen.getByRole('list', { name: 'Attachments' }))
        .getAllByRole('listitem')
        .map((li) => li.querySelector('button')?.textContent);
const showToggle = () => screen.queryByRole('button', { name: /^Show (\d+ more|less)$/ });

beforeEach(() => {
    resetSectionsForTests();
    installFakeXhr();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
});
afterEach(() => {
    resetRefreshForTests();
    vi.unstubAllGlobals();
});

describe('newest first', () => {
    it('in the API’s order, newest at the top', async () => {
        mockApi([file(1), file(2)]);
        renderPanelList();

        await screen.findByText('file-2.txt');
        expect(names()).toEqual(['file-1.txt', 'file-2.txt']);
    });

    it('a file being uploaded sits above the list; once uploaded it’s the top row', async () => {
        const files = [file(1), file(2), file(3), file(4)];
        mockApi(files);
        const u = renderPanelList();
        await screen.findByText('file-3.txt');

        const fresh = new File(['hi'], 'fresh.txt', { type: 'text/plain' });
        await u.upload(screen.getByLabelText('Choose files to upload'), fresh);
        await vi.waitFor(() => expect(FakeXhr.sent).toHaveLength(1));

        // While uploading: its row comes before the files.
        const uploads = screen.getByRole('list', { name: 'Uploads' });
        const list = screen.getByRole('list', { name: 'Attachments' });
        expect(
            uploads.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        const saved: Attachment = { ...file(0), id: 'new', originalName: 'fresh.txt' };
        files.unshift(saved);
        (FakeXhr.sent[0] as FakeXhr).respond(201, { data: saved });

        // Uploaded: the top row, visible even though the list is capped.
        await vi.waitFor(() => expect(names()[0]).toBe('fresh.txt'));
        expect(names()).toEqual(['fresh.txt', 'file-1.txt', 'file-2.txt']);
        expect(showToggle()).toHaveTextContent('Show 2 more');
    });
});

describe('the cap of 3', () => {
    it('shows the 3 newest, then "Show N more" / "Show less"', async () => {
        mockApi([file(1), file(2), file(3), file(4), file(5)]);
        const u = renderPanelList();
        await screen.findByText('file-1.txt');

        expect(names()).toEqual(['file-1.txt', 'file-2.txt', 'file-3.txt']);
        expect(showToggle()).toHaveTextContent('Show 2 more');
        expect(showToggle()).toHaveAttribute('aria-expanded', 'false');
        // The count is everything, not just what's shown.
        expect(screen.getByTestId('attachment-count')).toHaveTextContent('5');

        await u.click(showToggle() as HTMLElement);
        expect(names()).toHaveLength(5);
        expect(showToggle()).toHaveTextContent('Show less');
        expect(showToggle()).toHaveAttribute('aria-expanded', 'true');

        await u.click(showToggle() as HTMLElement);
        expect(names()).toHaveLength(3);
    });

    it('no toggle with 3 files or fewer', async () => {
        mockApi([file(1), file(2), file(3)]);
        renderPanelList();
        await screen.findByText('file-3.txt');

        expect(names()).toHaveLength(3);
        expect(showToggle()).not.toBeInTheDocument();
    });

    it('deleting a file keeps it expanded', async () => {
        mockApi([file(1), file(2), file(3), file(4), file(5)]);
        const u = renderPanelList();
        await screen.findByText('file-1.txt');
        await u.click(showToggle() as HTMLElement);

        await u.click(await screen.findByRole('button', { name: 'Delete file-5.txt' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete this file?' });
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('file-5.txt')).not.toBeInTheDocument());
        expect(names()).toEqual(['file-1.txt', 'file-2.txt', 'file-3.txt', 'file-4.txt']);
        expect(showToggle()).toHaveTextContent('Show less');
    });
});

describe('the section', () => {
    it('collapses the files (and uploads) but keeps Upload in the header', async () => {
        mockApi([file(1)]);
        const u = renderPanelList();
        await screen.findByText('file-1.txt');
        const header = screen.getByRole('button', { name: /^Attachments/ });
        expect(header).toHaveAttribute('aria-expanded', 'true');

        await u.click(header);

        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByText('file-1.txt')).not.toBeVisible();
        expect(screen.getByRole('button', { name: 'Upload' })).toBeVisible();
    });
});
