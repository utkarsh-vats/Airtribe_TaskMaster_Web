/*
 * The project's Discussion and Files tabs (9e): the shared thread and attachment list with
 * taskId=none, their own heading / empty text / placeholder, the page titles, and the same
 * permissions as in the task panel. Rendered inside ProjectShell, like the pages.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectDiscussion } from '@/features/projects/components/ProjectDiscussion';
import { ProjectFiles } from '@/features/projects/components/ProjectFiles';
import { ProjectShell } from '@/features/projects/components/ProjectShell';
import type { Attachment, Comment, ProjectDetail, ProjectRole, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { FakeXhr, installFakeXhr } from '../../fakeXhr';
import { commentsList } from '../../msw/comments';
import { API_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({ pathname: '/dashboard/projects/p1/discussion' }));
vi.mock('next/navigation', () => ({
    usePathname: () => nav.pathname,
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const api = (path: string) => `${API_ORIGIN}/api/v1/projects${path}`;

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

const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

const comment = (id: string, author: { id: string; name: string }, body: string): Comment => ({
    id,
    projectId: 'p1',
    taskId: null,
    authorId: author.id,
    parentId: null,
    body,
    editedAt: null,
    createdAt: hourAgo(),
    author,
    replyCount: 0,
});
const priya = { id: 'u2', name: 'Priya Raman' };

const file = (id: string, name: string, uploadedBy = priya): Attachment => ({
    id,
    originalName: name,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    taskId: null,
    createdAt: hourAgo(),
    uploadedBy,
});

const page = <T,>(data: T[]) =>
    HttpResponse.json({
        data,
        meta: { page: 1, limit: 50, total: data.length, totalPages: data.length ? 1 : 0 },
    });

/** The project (with `role`), the project list, and GETs of `comments` / `files`. */
function mockApi(role: ProjectRole, { comments = [] as Comment[], files = [] as Attachment[] }) {
    const searches = { comments: [] as URLSearchParams[], files: [] as URLSearchParams[] };
    server.use(
        http.get(api('/p1'), () => HttpResponse.json({ data: project(role) })),
        http.get(`${API_ORIGIN}/api/v1/projects`, () => page([])),
        // Filtered and ordered like the API (top-level, newest first when asked).
        commentsList(comments, searches.comments),
        http.get(api('/p1/attachments'), ({ request }) => {
            searches.files.push(new URL(request.url).searchParams);
            return page(files);
        }),
    );
    return searches;
}

function renderTab(tab: 'discussion' | 'files') {
    nav.pathname = `/dashboard/projects/p1/${tab}`;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const child: ReactNode = tab === 'discussion' ? <ProjectDiscussion /> : <ProjectFiles />;
    render(
        <QueryClientProvider client={client}>
            <ProjectShell projectId="p1">{child}</ProjectShell>
        </QueryClientProvider>,
    );
    return userEvent.setup({ applyAccept: false });
}

beforeEach(() => {
    installFakeXhr();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    document.title = 'TaskMaster';
});
afterEach(() => {
    resetRefreshForTests();
    vi.unstubAllGlobals();
});

describe('Discussion', () => {
    it('project-level comments (taskId=none): "Discussion" + the total, and the page title', async () => {
        const searches = mockApi('MEMBER', {
            comments: [comment('c1', priya, 'Kickoff notes'), comment('c2', me, 'Thanks!')],
        });
        renderTab('discussion');

        expect(await screen.findByText('Kickoff notes')).toBeInTheDocument();
        expect(searches.comments[0]?.get('taskId')).toBe('none');
        expect(searches.comments[0]?.get('parentId')).toBe('none');
        expect(searches.comments[0]?.get('order')).toBe('desc');
        // A collapsible section ("project-discussion"): its heading holds the toggle.
        expect(screen.getByRole('region', { name: 'Discussion' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Discussion/, expanded: true })).toBeVisible();
        expect(screen.getByTestId('comment-count')).toHaveTextContent('2');
        expect(screen.getByRole('list', { name: 'Discussion' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Comments' })).not.toBeInTheDocument();
        expect(document.title).toBe('Discussion · Website relaunch · TaskMaster');
    });

    it('empty: its own text and placeholder; a post has no taskId', async () => {
        const comments: Comment[] = [];
        mockApi('MEMBER', { comments });
        const posted: unknown[] = [];
        server.use(
            http.post(api('/p1/comments'), async ({ request }) => {
                const body = (await request.json()) as { body: string };
                posted.push(body);
                const saved = comment('c9', { id: me.id, name: me.name }, body.body);
                // The refetch after posting sees it too.
                comments.push(saved);
                return HttpResponse.json({ data: saved }, { status: 201 });
            }),
        );
        const u = renderTab('discussion');

        expect(
            await screen.findByText('No discussion yet — start the conversation.'),
        ).toBeInTheDocument();
        const composer = screen.getByRole('textbox', { name: 'Comment' });
        expect(composer).toHaveAttribute('placeholder', 'Write to the whole project');

        await u.type(composer, 'Hello, team');
        await u.click(screen.getByRole('button', { name: 'Post' }));

        expect(await screen.findByText('Hello, team')).toBeInTheDocument();
        expect(posted).toEqual([{ body: 'Hello, team' }]);
    });

    it('permissions as in the panel: a MEMBER gets actions on their own comment only', async () => {
        mockApi('MEMBER', {
            comments: [comment('c1', priya, 'Priya’s note'), comment('c2', me, 'My note')],
        });
        renderTab('discussion');
        const actions = (text: string) =>
            within(screen.getByText(text).closest('li') as HTMLElement).queryByRole('button', {
                name: 'Comment actions',
            });

        await screen.findByText('My note');
        await vi.waitFor(() => expect(actions('My note')).toBeInTheDocument());
        expect(actions('Priya’s note')).not.toBeInTheDocument();
    });

    it('an ADMIN gets actions on someone else’s comment', async () => {
        mockApi('ADMIN', { comments: [comment('c1', priya, 'Priya’s note')] });
        renderTab('discussion');

        const item = (await screen.findByText('Priya’s note')).closest('li') as HTMLElement;
        await vi.waitFor(() =>
            expect(within(item).getByRole('button', { name: 'Comment actions' })).toBeVisible(),
        );
    });
});

describe('Files', () => {
    it('project-level files (taskId=none): "Files" + the total, and the page title', async () => {
        const searches = mockApi('MEMBER', {
            files: [file('a1', 'brand.pdf'), file('a2', 'brief.pdf'), file('a3', 'logo.pdf')],
        });
        renderTab('files');

        expect(await screen.findByText('brand.pdf')).toBeInTheDocument();
        expect(searches.files[0]?.get('taskId')).toBe('none');
        expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
        expect(screen.getByTestId('attachment-count')).toHaveTextContent('3');
        expect(screen.getByRole('list', { name: 'Files' })).toBeInTheDocument();
        expect(document.title).toBe('Files · Website relaunch · TaskMaster');
    });

    it('empty: its own text; an upload has no taskId and joins the list', async () => {
        const files: Attachment[] = [];
        mockApi('MEMBER', { files });
        const u = renderTab('files');

        expect(
            await screen.findByText('No project files yet. Upload one, or drop it here.'),
        ).toBeInTheDocument();

        const chosen = new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' });
        await u.upload(screen.getByLabelText('Choose files to upload'), chosen);
        await vi.waitFor(() => expect(FakeXhr.sent).toHaveLength(1));
        const xhr = FakeXhr.sent[0] as FakeXhr;
        expect(xhr.url).toBe(api('/p1/attachments'));
        expect(xhr.form.has('taskId')).toBe(false);
        expect((xhr.form.get('file') as File).name).toBe('plan.pdf');

        const saved = file('a9', 'plan.pdf', { id: me.id, name: me.name });
        files.unshift(saved);
        xhr.respond(201, { data: saved });

        expect(
            await screen.findByRole('button', { name: 'Download plan.pdf' }),
        ).toBeInTheDocument();
        expect(screen.getByTestId('attachment-count')).toHaveTextContent('1');
    });

    it('a full page: every file, newest first, no "Show N more" cap', async () => {
        mockApi('MEMBER', {
            files: [1, 2, 3, 4, 5].map((n) => file(`a${n}`, `file-${n}.pdf`)),
        });
        renderTab('files');

        await screen.findByText('file-5.pdf');
        const list = screen.getByRole('list', { name: 'Files' });
        expect(
            within(list)
                .getAllByRole('listitem')
                .map((li) => li.querySelector('button')?.textContent),
        ).toEqual(['file-1.pdf', 'file-2.pdf', 'file-3.pdf', 'file-4.pdf', 'file-5.pdf']);
        expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).not.toBeInTheDocument();
    });

    it('permissions as in the panel: a MEMBER may delete only their own file', async () => {
        mockApi('MEMBER', {
            files: [file('a1', 'theirs.pdf'), file('a2', 'mine.pdf', { id: me.id, name: me.name })],
        });
        renderTab('files');

        await screen.findByText('theirs.pdf');
        await vi.waitFor(() =>
            expect(screen.getByRole('button', { name: 'Delete mine.pdf' })).toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: 'Delete theirs.pdf' })).not.toBeInTheDocument();
    });
});
