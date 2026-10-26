/*
 * Comment threads (9a): the list (oldest first, paged with Load more), its states, and the
 * composer. Most tests render CommentThread alone; posting from a task also goes through the
 * task panel, whose comment count comes from the task detail.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { TASK_GONE_MESSAGE } from '@/features/comments/components/CommentComposer';
import { CommentThread } from '@/features/comments/components/CommentThread';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type { Comment, ProjectDetail, Task, TaskListItem, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { emptyAttachments } from '../../msw/attachments';
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

const commentsUrl = `${API_ORIGIN}/api/v1/projects/p1/comments`;
const tasksUrl = `${API_ORIGIN}/api/v1/projects/p1/tasks`;

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
const comment = (overrides: Partial<Comment> = {}): Comment => {
    seq += 1;
    return {
        id: `c${seq}`,
        projectId: 'p1',
        taskId: 't1',
        authorId: 'u2',
        body: `Comment ${seq}`,
        editedAt: null,
        createdAt: hoursAgo(1),
        author: { id: 'u2', name: 'Priya Raman' },
        ...overrides,
    };
};

type Request = { search: URLSearchParams };

/**
 * GET comments from `thread` (50 a page, like the API), POST appends to it. Records the
 * requests; `postResponse` overrides the POST.
 */
function mockComments(thread: Comment[], postResponse?: () => Response | Promise<Response>) {
    const gets: Request[] = [];
    const posts: Record<string, unknown>[] = [];
    server.use(
        http.get(commentsUrl, ({ request }) => {
            const search = new URL(request.url).searchParams;
            gets.push({ search });
            const page = Number(search.get('page') ?? 1);
            const limit = Number(search.get('limit') ?? 50);
            return HttpResponse.json({
                data: thread.slice((page - 1) * limit, page * limit),
                meta: {
                    page,
                    limit,
                    total: thread.length,
                    totalPages: Math.ceil(thread.length / limit),
                },
            });
        }),
        http.post(commentsUrl, async ({ request }) => {
            const body = (await request.json()) as { body: string; taskId?: string };
            posts.push(body);
            if (postResponse) return postResponse();
            const created = comment({
                body: body.body,
                taskId: body.taskId ?? null,
                authorId: user.id,
                author: { id: user.id, name: user.name },
                createdAt: new Date().toISOString(),
            });
            thread.push(created);
            return HttpResponse.json({ data: created }, { status: 201 });
        }),
    );
    return { gets, posts };
}

const apiError = (status: number, code: string, details?: { path: string; message: string }[]) =>
    HttpResponse.json(
        { error: { code, message: `${code} message`, requestId: 'r', details } },
        { status },
    );

let client: QueryClient;

function renderThread(taskId: string | null = 't1') {
    // The thread reads the role from the project (comment actions: editDelete.test.tsx).
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
                    memberCount: 2,
                    owner: null,
                } satisfies ProjectDetail,
            }),
        ),
    );
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <CommentThread projectId="p1" taskId={taskId} />
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const composer = () => screen.getByRole('textbox', { name: 'Comment' });
const postButton = () => screen.getByRole('button', { name: 'Post' });
const items = () => within(screen.getByRole('list', { name: 'Comments' })).getAllByRole('listitem');

beforeEach(() => {
    seq = 0;
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('the list', () => {
    it('oldest first: author, relative time (full date in the title), edited, line breaks', async () => {
        mockComments([
            comment({ body: 'First line\nSecond line', createdAt: hoursAgo(3) }),
            comment({
                body: 'Fixed the typo',
                createdAt: hoursAgo(2),
                editedAt: hoursAgo(1),
                author: { id: 'u3', name: 'Jonas Weber' },
            }),
        ]);
        renderThread();

        await screen.findByText('Fixed the typo');
        const [first, second] = items();
        expect(within(first as HTMLElement).getByText('Priya Raman')).toBeInTheDocument();
        const time = within(first as HTMLElement).getByText('3 h ago');
        expect(time.tagName).toBe('TIME');
        expect(time.getAttribute('title')).toMatch(/\d{4} at /);
        const body = within(first as HTMLElement).getByText(/First line/);
        expect(body.textContent).toBe('First line\nSecond line');
        expect(body).toHaveClass('whitespace-pre-wrap');
        expect(within(first as HTMLElement).queryByText(/edited/)).not.toBeInTheDocument();

        expect(within(second as HTMLElement).getByText('Jonas Weber')).toBeInTheDocument();
        expect(within(second as HTMLElement).getByText('· edited')).toBeInTheDocument();
        expect(screen.getByTestId('comment-count')).toHaveTextContent('2');
    });

    it('a timestamp ahead of this clock (server skew) reads "just now", never "in 3 min"', async () => {
        const ahead = new Date(Date.now() + 3 * 60_000).toISOString();
        mockComments([comment({ body: 'From the future', createdAt: ahead })]);
        renderThread();

        const item = (await screen.findByText('From the future')).closest('li') as HTMLElement;
        expect(within(item).getByText('just now').tagName).toBe('TIME');
        expect(item).not.toHaveTextContent(/in \d+ min/);
    });

    it('never renders a body as HTML', async () => {
        mockComments([comment({ body: '<b>bold</b>' })]);
        renderThread();

        expect(await screen.findByText('<b>bold</b>')).toBeInTheDocument();
    });

    it('Load more fetches page 2 and appends it at the bottom', async () => {
        const thread = Array.from({ length: 51 }, () => comment());
        const { gets } = mockComments(thread);
        const u = renderThread();
        await screen.findByText('Comment 50');
        expect(items()).toHaveLength(50);

        await u.click(screen.getByRole('button', { name: 'Load more' }));

        await screen.findByText('Comment 51');
        expect(items()).toHaveLength(51);
        expect(items().at(-1)).toHaveTextContent('Comment 51');
        expect(gets.map((g) => g.search.get('page'))).toEqual(['1', '2']);
        expect(gets[0]?.search.get('limit')).toBe('50');
        expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    it('empty', async () => {
        mockComments([]);
        renderThread();

        expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
        expect(screen.getByTestId('comment-count')).toHaveTextContent('0');
    });

    it('loading: skeleton items', async () => {
        server.use(
            http.get(commentsUrl, async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        renderThread();

        expect(screen.getByText('Loading comments…').parentElement).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });

    it('error, then Try again', async () => {
        let fail = true;
        server.use(
            http.get(commentsUrl, () =>
                fail
                    ? apiError(500, 'INTERNAL_ERROR')
                    : HttpResponse.json({
                          data: [comment({ body: 'Back again' })],
                          meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
                      }),
            ),
        );
        const u = renderThread();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load comments");
        fail = false;
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByText('Back again')).toBeInTheDocument();
    });
});

describe('the composer', () => {
    it('Ctrl+Enter posts', async () => {
        const { posts } = mockComments([]);
        const u = renderThread();
        await screen.findByText('No comments yet.');

        await u.type(composer(), 'Shipping today');
        await u.keyboard('{Control>}{Enter}{/Control}');

        await screen.findByText('Shipping today', { selector: 'p' });
        expect(posts).toEqual([{ body: 'Shipping today', taskId: 't1' }]);
        expect(composer()).toHaveValue('');
    });

    it('empty or whitespace-only can’t be posted', async () => {
        const { posts } = mockComments([]);
        const u = renderThread();
        await screen.findByText('No comments yet.');

        expect(postButton()).toBeDisabled();
        await u.type(composer(), '   \n  ');
        expect(postButton()).toBeDisabled();
        await u.keyboard('{Control>}{Enter}{/Control}');

        expect(posts).toHaveLength(0);
    });

    it('a failure keeps the draft and toasts the error', async () => {
        mockComments([], () => apiError(500, 'INTERNAL_ERROR'));
        const u = renderThread();
        await screen.findByText('No comments yet.');

        await u.type(composer(), 'Keep me');
        await u.click(postButton());

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(composer()).toHaveValue('Keep me');
        expect(screen.getByText('No comments yet.')).toBeInTheDocument();
    });

    it('422: the message under the composer', async () => {
        mockComments([], () =>
            apiError(422, 'VALIDATION_ERROR', [{ path: 'body', message: 'Body is too long' }]),
        );
        const u = renderThread();
        await screen.findByText('No comments yet.');

        await u.type(composer(), 'Too long, says the server');
        await u.click(postButton());

        expect(await screen.findByText('Body is too long')).toBeInTheDocument();
        expect(composer()).toHaveAttribute('aria-invalid', 'true');
        expect(composer()).toHaveValue('Too long, says the server');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('404 (the task was deleted): "This task no longer exists."', async () => {
        mockComments([], () => apiError(404, 'NOT_FOUND'));
        const u = renderThread();
        await screen.findByText('No comments yet.');

        await u.type(composer(), 'Anyone there?');
        await u.click(postButton());

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(TASK_GONE_MESSAGE));
        expect(composer()).toHaveValue('Anyone there?');
    });
});

describe('project-level thread', () => {
    it('requests taskId=none and posts without a taskId', async () => {
        const { gets, posts } = mockComments([]);
        const u = renderThread(null);
        await screen.findByText('No comments yet.');
        expect(gets[0]?.search.get('taskId')).toBe('none');

        await u.type(composer(), 'Kick-off notes');
        await u.click(postButton());

        await screen.findByText('Kick-off notes', { selector: 'p' });
        expect(posts).toEqual([{ body: 'Kick-off notes' }]);
    });
});

describe('posting from the task panel', () => {
    const project: ProjectDetail = {
        id: 'p1',
        name: 'Website relaunch',
        description: null,
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
        myRole: 'MEMBER',
        memberCount: 2,
        owner: null,
    };
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
    const detail: Task = {
        ...row,
        assignee: null,
        createdBy: { id: 'u2', name: 'Priya Raman', email: 'priya@taskmaster.app' },
        commentCount: 1,
        attachmentCount: 0,
    };

    it('sends the trimmed body with the taskId; the comment appears, the count goes up, the composer clears', async () => {
        vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
        vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
        resetTaskPanelHistoryForTests();
        const { posts } = mockComments([comment({ body: 'Draft is up' })]);
        server.use(
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
            emptyAttachments(),
        );
        nav.search = 'task=t1';
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(queryKeys.projects.detail('p1'), project);
        render(
            <QueryClientProvider client={client}>
                <TooltipProvider>
                    <ProjectContext
                        value={{ project, myRole: 'MEMBER', can: bindPermissions('MEMBER', 'u1') }}
                    >
                        <TaskListView />
                    </ProjectContext>
                </TooltipProvider>
            </QueryClientProvider>,
        );
        const u = userEvent.setup();
        const panel = await screen.findByRole('dialog', { name: 'Website relaunch / Task' });
        await within(panel).findByText('Draft is up');
        await vi.waitFor(() =>
            expect(within(panel).getByTestId('comment-count')).toHaveTextContent('1'),
        );

        await u.type(within(panel).getByRole('textbox', { name: 'Comment' }), '  Looks good  ');
        await u.click(within(panel).getByRole('button', { name: 'Post' }));

        await within(panel).findByText('Looks good', { selector: 'p' });
        expect(posts).toEqual([{ body: 'Looks good', taskId: 't1' }]);
        expect(within(panel).getByTestId('comment-count')).toHaveTextContent('2');
        expect(client.getQueryData<Task>(queryKeys.tasks.detail('p1', 't1'))?.commentCount).toBe(2);
        expect(within(panel).getByRole('textbox', { name: 'Comment' })).toHaveValue('');
    });
});
