/*
 * Uploading and deleting attachments (9d): pre-checks, the upload rows (progress, Cancel,
 * Retry / Dismiss), one file at a time, drag-and-drop, the cache after success, and delete
 * (who may, confirm, 404, other errors). XMLHttpRequest is faked (tests/fakeXhr.ts); the list,
 * project and DELETE go through MSW. The XHR itself is uploadXhr.test.ts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { ATTACHMENT_ALREADY_DELETED_MESSAGE } from '@/features/attachments/api';
import { AttachmentList } from '@/features/attachments/components/AttachmentList';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import { ERROR_CODES } from '@/lib/api/errors';
import type {
    Attachment,
    ProjectDetail,
    ProjectRole,
    Task,
    TaskListItem,
    User,
} from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { errorBody, FakeXhr, installFakeXhr } from '../../fakeXhr';
import { emptyComments } from '../../msw/comments';
import { API_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const listUrl = `${API_ORIGIN}/api/v1/projects/p1/attachments`;
const tasksUrl = `${API_ORIGIN}/api/v1/projects/p1/tasks`;

const me: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const project = (myRole: ProjectRole): ProjectDetail => ({
    id: 'p1',
    name: 'Website relaunch',
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole,
    memberCount: 2,
    owner: null,
});

let seq = 0;
const attachment = (overrides: Partial<Attachment> = {}): Attachment => {
    seq += 1;
    return {
        id: `a${seq}`,
        originalName: `File ${seq}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 2048,
        taskId: 't1',
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        uploadedBy: { id: 'u2', name: 'Priya Raman' },
        ...overrides,
    };
};

/** What the API answers an upload of `file` with. */
const uploaded = (file: File): Attachment => ({
    ...attachment({ originalName: file.name, mimeType: file.type, sizeBytes: file.size }),
    createdAt: new Date().toISOString(),
    uploadedBy: { id: me.id, name: me.name },
});

const fileOf = (name: string, type: string, content = 'hello') =>
    new File([content], name, { type });
/** A file that claims `size` bytes (without allocating them). */
function sized(name: string, type: string, size: number) {
    const file = fileOf(name, type);
    Object.defineProperty(file, 'size', { value: size });
    return file;
}

type Calls = { deletes: string[] };

/**
 * The project (with `role`) and the list (`files`, newest first, kept up to date by DELETE);
 * `remove` overrides the DELETE response.
 */
function mockApi(
    role: ProjectRole,
    files: Attachment[],
    remove?: () => Response | Promise<Response>,
): Calls {
    const calls: Calls = { deletes: [] };
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () =>
            HttpResponse.json({ data: project(role) }),
        ),
        http.get(listUrl, () =>
            HttpResponse.json({
                data: files,
                meta: { page: 1, limit: 50, total: files.length, totalPages: 1 },
            }),
        ),
        http.delete(`${listUrl}/:id`, ({ params }) => {
            calls.deletes.push(String(params.id));
            if (remove) return remove();
            files.splice(
                files.findIndex((f) => f.id === params.id),
                1,
            );
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return calls;
}

function renderList() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <AttachmentList projectId="p1" taskId="t1" />
        </QueryClientProvider>,
    );
    // Real browsers let you pick any file whatever `accept` says.
    return userEvent.setup({ applyAccept: false });
}

const fileInput = () => screen.getByLabelText<HTMLInputElement>('Choose files to upload');
const uploadsList = () => screen.queryByRole('list', { name: 'Uploads' });
const uploadRow = (name: string) =>
    within(screen.getByRole('list', { name: 'Uploads' }))
        .getByText(name)
        .closest('li') as HTMLElement;
const fileRows = () =>
    within(screen.getByRole('list', { name: 'Attachments' })).getAllByRole('listitem');

/** The nth upload request, once it's sent. */
async function request(n: number) {
    await vi.waitFor(() => expect(FakeXhr.sent.length).toBeGreaterThan(n));
    return FakeXhr.sent[n] as FakeXhr;
}
const sentName = (xhr: FakeXhr) => (xhr.form.get('file') as File).name;

beforeEach(() => {
    seq = 0;
    installFakeXhr();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('choosing files', () => {
    it('Upload opens the file picker: multiple files, the allowlist as accept', async () => {
        mockApi('MEMBER', []);
        const u = renderList();
        await screen.findByText('No files yet.');
        const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});

        await u.click(screen.getByRole('button', { name: 'Upload' }));

        expect(click).toHaveBeenCalledOnce();
        expect(fileInput()).toHaveAttribute('multiple');
        expect(fileInput().accept).toContain('.docx');
        expect(fileInput().accept).toContain('image/png');
    });

    it('pre-checks: too large or a disallowed type never sends; the row says why', async () => {
        mockApi('MEMBER', []);
        const u = renderList();
        await screen.findByText('No files yet.');

        await u.upload(fileInput(), [
            sized('huge.pdf', 'application/pdf', 10 * 1024 * 1024 + 1),
            fileOf('setup.exe', 'application/x-msdownload'),
        ]);

        expect(within(uploadRow('huge.pdf')).getByText('Too large — max 10 MB.')).toBeVisible();
        expect(
            within(uploadRow('setup.exe')).getByText("That file type isn't allowed."),
        ).toBeVisible();
        // Retrying wouldn't help; Dismiss clears the row.
        expect(within(uploadRow('huge.pdf')).queryByRole('button', { name: /Retry/ })).toBeNull();
        await u.click(within(uploadRow('huge.pdf')).getByRole('button', { name: /Dismiss/ }));
        expect(screen.queryByText('huge.pdf')).not.toBeInTheDocument();

        expect(FakeXhr.sent).toHaveLength(0);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('exactly the limit is fine; an allowed extension with an odd browser type is sent as the right type', async () => {
        mockApi('MEMBER', []);
        const u = renderList();
        await screen.findByText('No files yet.');

        await u.upload(fileInput(), [
            sized('limit.pdf', 'application/pdf', 10 * 1024 * 1024),
            fileOf('assets.zip', 'application/x-zip-compressed'),
        ]);

        const first = await request(0);
        expect(sentName(first)).toBe('limit.pdf');
        first.respond(201, { data: uploaded(fileOf('limit.pdf', 'application/pdf')) });
        const second = await request(1);
        expect((second.form.get('file') as File).type).toBe('application/zip');
    });
});

describe('uploading', () => {
    it('a row with name, size and a progress bar; on success it joins the top of the list, no toast', async () => {
        const files = [attachment({ originalName: 'older.txt' })];
        mockApi('MEMBER', files);
        const u = renderList();
        await screen.findByText('older.txt');
        const file = fileOf('brief.pdf', 'application/pdf', '%PDF-1.7');

        await u.upload(fileInput(), file);

        const xhr = await request(0);
        expect(xhr.form.get('taskId')).toBe('t1');
        const row = uploadRow('brief.pdf');
        expect(row).toHaveTextContent('8 B');
        const bar = within(row).getByRole('progressbar', { name: 'Uploading brief.pdf' });
        expect(bar).toHaveAttribute('aria-valuenow', '0');

        xhr.progress(4, 8);
        await vi.waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));

        const saved = uploaded(file);
        files.unshift(saved);
        xhr.respond(201, { data: saved });

        await vi.waitFor(() => expect(uploadsList()).not.toBeInTheDocument());
        expect(fileRows()[0]).toHaveTextContent('brief.pdf');
        expect(fileRows()[0]).toHaveTextContent('8 B · Mara Okafor');
        expect(fileRows()).toHaveLength(2);
        expect(screen.getByTestId('attachment-count')).toHaveTextContent('2');
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
    });

    it('several files go one at a time; Cancel stops the current one and the next starts', async () => {
        mockApi('MEMBER', []);
        const u = renderList();
        await screen.findByText('No files yet.');
        const [a, b, c] = [
            fileOf('a.txt', 'text/plain'),
            fileOf('b.txt', 'text/plain'),
            fileOf('c.txt', 'text/plain'),
        ];

        await u.upload(fileInput(), [a, b, c]);

        const first = await request(0);
        expect(sentName(first)).toBe('a.txt');
        expect(FakeXhr.sent).toHaveLength(1);
        // Waiting files have a row (at 0) too.
        expect(within(uploadRow('c.txt')).getByRole('progressbar')).toHaveAttribute(
            'aria-valuenow',
            '0',
        );

        first.respond(201, { data: uploaded(a) });
        const second = await request(1);
        expect(sentName(second)).toBe('b.txt');

        await u.click(within(uploadRow('b.txt')).getByRole('button', { name: 'Cancel b.txt' }));

        expect(second.aborted).toBe(true);
        const third = await request(2);
        expect(sentName(third)).toBe('c.txt');
        expect(screen.queryByText('b.txt')).not.toBeInTheDocument();
        third.respond(201, { data: uploaded(c) });

        await vi.waitFor(() => expect(uploadsList()).not.toBeInTheDocument());
        expect(FakeXhr.sent).toHaveLength(3);
        // A cancel is silent.
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('files added while one is uploading wait: never more than one request open', async () => {
        mockApi('MEMBER', []);
        const u = renderList();
        await screen.findByText('No files yet.');
        const open = () => FakeXhr.sent.filter((xhr) => !xhr.done).length;
        // How many requests were open as each one was sent.
        const openAtSend: number[] = [];
        FakeXhr.autoRespond = () => openAtSend.push(open());
        const [a, b, c] = [
            fileOf('a.txt', 'text/plain'),
            fileOf('b.txt', 'text/plain'),
            fileOf('c.txt', 'text/plain'),
        ];

        await u.upload(fileInput(), a);
        const first = await request(0);
        // Added mid-upload, in two batches.
        await u.upload(fileInput(), b);
        await u.upload(fileInput(), c);

        expect(FakeXhr.sent).toHaveLength(1);
        expect(open()).toBe(1);
        expect(uploadRow('b.txt')).toHaveAttribute('data-upload-status', 'queued');
        expect(uploadRow('c.txt')).toHaveAttribute('data-upload-status', 'queued');

        // The next starts only once the current one finishes…
        first.respond(201, { data: uploaded(a) });
        const second = await request(1);
        expect(sentName(second)).toBe('b.txt');
        expect(open()).toBe(1);
        expect(uploadRow('c.txt')).toHaveAttribute('data-upload-status', 'queued');

        // …or is cancelled.
        await u.click(within(uploadRow('b.txt')).getByRole('button', { name: 'Cancel b.txt' }));
        const third = await request(2);
        expect(sentName(third)).toBe('c.txt');
        expect(open()).toBe(1);
        third.respond(201, { data: uploaded(c) });

        await vi.waitFor(() => expect(uploadsList()).not.toBeInTheDocument());
        expect(FakeXhr.sent).toHaveLength(3);
        expect(openAtSend).toEqual([1, 1, 1]);
    });

    it('a failure: the row shows the error with Retry and Dismiss, a toast; Retry sends it again', async () => {
        mockApi('MEMBER', []);
        const u = renderList();
        await screen.findByText('No files yet.');
        const file = fileOf('notes.txt', 'text/plain');

        await u.upload(fileInput(), file);
        (await request(0)).respond(500, errorBody(ERROR_CODES.INTERNAL_ERROR));

        const row = await vi.waitFor(() => {
            const li = uploadRow('notes.txt');
            expect(li).toHaveTextContent('Something went wrong.');
            return li;
        });
        expect(within(row).queryByRole('progressbar')).not.toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'Dismiss notes.txt' })).toBeVisible();
        expect(toast.error).toHaveBeenCalledWith("Couldn't upload notes.txt", {
            description: 'Something went wrong.',
        });

        await u.click(within(row).getByRole('button', { name: 'Retry notes.txt' }));

        const again = await request(1);
        expect(sentName(again)).toBe('notes.txt');
        again.respond(201, { data: uploaded(file) });
        await vi.waitFor(() => expect(uploadsList()).not.toBeInTheDocument());
    });

    it.each([
        [413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Too large — max 10 MB.'],
        [415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, "That file type isn't allowed."],
    ])('%d from the API: the message on the row, no toast', async (status, code, message) => {
        mockApi('MEMBER', []);
        const u = renderList();
        await screen.findByText('No files yet.');

        await u.upload(fileInput(), fileOf('odd.txt', 'text/plain'));
        (await request(0)).respond(status, errorBody(code));

        await vi.waitFor(() => expect(uploadRow('odd.txt')).toHaveTextContent(message));
        expect(toast.error).not.toHaveBeenCalled();
    });
});

describe('drag and drop', () => {
    it('files dragged over the list highlight it; dropping uploads them', async () => {
        mockApi('MEMBER', []);
        renderList();
        await screen.findByText('No files yet.');
        const section = screen.getByRole('region', { name: 'Attachments' });
        const file = fileOf('dropped.png', 'image/png');
        const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };

        fireEvent.dragEnter(section, { dataTransfer });
        // Entering a child, then leaving it, keeps the highlight.
        fireEvent.dragEnter(screen.getByText('No files yet.'), { dataTransfer });
        fireEvent.dragLeave(screen.getByText('No files yet.'), { dataTransfer });
        expect(section).toHaveAttribute('data-dragging', 'true');
        expect(section).toHaveClass('outline-2', 'outline-accent', 'bg-accent-100');

        fireEvent.dragOver(section, { dataTransfer });
        fireEvent.drop(section, { dataTransfer });

        expect(section).not.toHaveAttribute('data-dragging');
        expect(sentName(await request(0))).toBe('dropped.png');
    });

    it('leaving without dropping clears it; dragging text (not files) does nothing', async () => {
        mockApi('MEMBER', []);
        renderList();
        await screen.findByText('No files yet.');
        const section = screen.getByRole('region', { name: 'Attachments' });

        fireEvent.dragEnter(section, { dataTransfer: { types: ['Files'], files: [] } });
        fireEvent.dragLeave(section, { dataTransfer: { types: ['Files'], files: [] } });
        expect(section).not.toHaveAttribute('data-dragging');

        fireEvent.dragEnter(section, { dataTransfer: { types: ['text/plain'], files: [] } });
        expect(section).not.toHaveAttribute('data-dragging');
    });
});

describe('delete', () => {
    const mineFile = () =>
        attachment({ originalName: 'mine.pdf', uploadedBy: { id: me.id, name: me.name } });
    const priyasFile = () => attachment({ originalName: 'priyas.pdf' });
    const deleteButton = (name: string) => screen.queryByRole('button', { name: `Delete ${name}` });

    it('the uploader may delete their file; another MEMBER may not delete someone else’s', async () => {
        mockApi('MEMBER', [mineFile(), priyasFile()]);
        renderList();
        await screen.findByText('priyas.pdf');

        await vi.waitFor(() => expect(deleteButton('mine.pdf')).toBeInTheDocument());
        expect(deleteButton('priyas.pdf')).not.toBeInTheDocument();
        // Every member can upload.
        expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    });

    it.each(['ADMIN', 'OWNER'] as const)('%s may delete anyone’s file', async (role) => {
        mockApi(role, [priyasFile()]);
        renderList();
        await screen.findByText('priyas.pdf');

        await vi.waitFor(() => expect(deleteButton('priyas.pdf')).toBeInTheDocument());
    });

    it('confirm: DELETE, the row goes', async () => {
        const calls = mockApi('MEMBER', [mineFile(), priyasFile()]);
        const u = renderList();
        await vi.waitFor(() => expect(deleteButton('mine.pdf')).toBeInTheDocument());

        await u.click(deleteButton('mine.pdf') as HTMLElement);
        const dialog = await screen.findByRole('dialog', { name: 'Delete this file?' });
        expect(dialog).toHaveTextContent('“mine.pdf” will be permanently deleted.');
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('mine.pdf')).not.toBeInTheDocument());
        expect(calls.deletes).toEqual(['a1']);
        expect(screen.getByTestId('attachment-count')).toHaveTextContent('1');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(toast).not.toHaveBeenCalled();
    });

    it('404: treated as gone — the row goes, "That file was already deleted."', async () => {
        mockApi('MEMBER', [mineFile()], () =>
            HttpResponse.json(errorBody(ERROR_CODES.NOT_FOUND), { status: 404 }),
        );
        const u = renderList();
        await vi.waitFor(() => expect(deleteButton('mine.pdf')).toBeInTheDocument());

        await u.click(deleteButton('mine.pdf') as HTMLElement);
        const dialog = await screen.findByRole('dialog', { name: 'Delete this file?' });
        // The refetch after the delete no longer has it either.
        server.use(
            http.get(listUrl, () =>
                HttpResponse.json({
                    data: [],
                    meta: { page: 1, limit: 50, total: 0, totalPages: 0 },
                }),
            ),
        );
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('mine.pdf')).not.toBeInTheDocument());
        expect(toast).toHaveBeenCalledWith(ATTACHMENT_ALREADY_DELETED_MESSAGE);
        expect(ATTACHMENT_ALREADY_DELETED_MESSAGE).toBe('That file was already deleted.');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('500: the dialog stays open with an error toast, the row stays', async () => {
        mockApi('MEMBER', [mineFile()], () =>
            HttpResponse.json(errorBody(ERROR_CODES.INTERNAL_ERROR), { status: 500 }),
        );
        const u = renderList();
        await vi.waitFor(() => expect(deleteButton('mine.pdf')).toBeInTheDocument());

        await u.click(deleteButton('mine.pdf') as HTMLElement);
        const dialog = await screen.findByRole('dialog', { name: 'Delete this file?' });
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
        expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
        expect(screen.getByRole('dialog', { name: 'Delete this file?' })).toBeInTheDocument();
        expect(screen.getByText('mine.pdf')).toBeInTheDocument();
    });
});

describe('in the task panel', () => {
    const row: TaskListItem = {
        id: 't1',
        projectId: 'p1',
        title: 'Finalise homepage hero copy',
        description: null,
        status: 'OPEN',
        priority: 'HIGH',
        dueDate: null,
        completedAt: null,
        createdAt: '2026-10-10T09:00:00.000Z',
        updatedAt: '2026-10-10T09:00:00.000Z',
        assignee: null,
        createdBy: { id: 'u2', name: 'Priya Raman' },
    };

    /** The panel for t1, whose detail says `attachmentCount` (and stays stale on refetch). */
    async function renderPanel(attachmentCount: number) {
        vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
        vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
        resetTaskPanelHistoryForTests();
        const detail: Task = {
            ...row,
            assignee: null,
            createdBy: { id: 'u2', name: 'Priya Raman', email: 'priya@taskmaster.app' },
            commentCount: 0,
            attachmentCount,
        };
        server.use(
            emptyComments(),
            http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () =>
                HttpResponse.json({ data: [] }),
            ),
            http.get(tasksUrl, ({ request }) => {
                const limit = Number(new URL(request.url).searchParams.get('limit'));
                return HttpResponse.json({
                    data: limit === 1 ? [] : [row],
                    meta: { page: 1, limit, total: 1, totalPages: 1 },
                });
            }),
            // The server's count stays stale: the panel's count is the cache's.
            http.get(`${tasksUrl}/t1`, () => HttpResponse.json({ data: detail })),
        );
        nav.search = 'task=t1';
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(queryKeys.projects.detail('p1'), project('MEMBER'));
        render(
            <QueryClientProvider client={client}>
                <TooltipProvider>
                    <ProjectContext
                        value={{
                            project: project('MEMBER'),
                            myRole: 'MEMBER',
                            can: bindPermissions('MEMBER', me.id),
                        }}
                    >
                        <TaskListView />
                    </ProjectContext>
                </TooltipProvider>
            </QueryClientProvider>,
        );
        const panel = await screen.findByRole('dialog', { name: 'Website relaunch / Task' });
        await vi.waitFor(() =>
            expect(within(panel).getByTestId('attachment-count')).toHaveTextContent(
                String(attachmentCount),
            ),
        );
        return { panel, u: userEvent.setup({ applyAccept: false }) };
    }

    it('an upload: the row is added and the panel count goes up', async () => {
        const files = [attachment({ originalName: 'older.txt' })];
        mockApi('MEMBER', files);
        const { panel, u } = await renderPanel(1);
        await within(panel).findByText('older.txt');
        const file = fileOf('brief.pdf', 'application/pdf');

        await u.upload(within(panel).getByLabelText('Choose files to upload'), file);
        const saved = uploaded(file);
        files.unshift(saved);
        (await request(0)).respond(201, { data: saved });

        await within(panel).findByRole('button', { name: 'Download brief.pdf' });
        expect(within(panel).getByTestId('attachment-count')).toHaveTextContent('2');
    });

    it('a delete: the row goes and the panel count goes down', async () => {
        const calls = mockApi('MEMBER', [
            attachment({ originalName: 'mine.pdf', uploadedBy: { id: me.id, name: me.name } }),
            attachment({ originalName: 'other.pdf' }),
        ]);
        const { panel, u } = await renderPanel(2);

        await u.click(await within(panel).findByRole('button', { name: 'Delete mine.pdf' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete this file?' });
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('mine.pdf')).not.toBeInTheDocument());
        expect(calls.deletes).toEqual(['a1']);
        expect(within(panel).getByTestId('attachment-count')).toHaveTextContent('1');
    });
});
