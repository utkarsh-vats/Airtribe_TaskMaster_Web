/*
 * Live notifications refresh what they're about (12c-2): a task event invalidates the project's
 * task queries and My tasks, a comment / reply the project's comments (and the task's detail
 * when it's on a task), an invitation my invitations — and an open view shows the new data.
 * Repeats and unknown types invalidate nothing; a reconnect (not the first open) catches up
 * on everything. fetch-event-source is the fake in tests/fakeEventSource.ts.
 */
import * as sse from '@microsoft/fetch-event-source';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { SidebarNav } from '@/components/shell/SidebarNav';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { CommentThread } from '@/features/comments/components/CommentThread';
import { InvitationsInbox } from '@/features/invitations/components/InvitationsInbox';
import { latestNotificationsKey } from '@/features/notifications/api';
import { NotificationStream } from '@/features/notifications/useNotificationStream';
import { TaskPanel } from '@/features/tasks/components/TaskPanel';
import type {
    Comment,
    MyInvitation,
    Notification,
    ProjectDetail,
    Task,
    User,
} from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { queryKeys } from '@/lib/query/keys';
import { streamState } from '@/lib/realtime/notificationStream';

import { mockStreamFetch, setTabHidden, type createFakeEventSource } from '../../fakeEventSource';
import { emptyAttachments } from '../../msw/attachments';
import { commentsList } from '../../msw/comments';
import { notificationsApi, type NotificationCalls } from '../../msw/notifications';
import { API_ORIGIN, server } from '../../msw/server';

vi.mock('@microsoft/fetch-event-source', async () => {
    const { createFakeEventSource } = await import('../../fakeEventSource');
    const fake = createFakeEventSource();
    return {
        EventStreamContentType: 'text/event-stream',
        fetchEventSource: fake.fetchEventSource,
        fake,
    };
});
const fake = (sse as unknown as { fake: ReturnType<typeof createFakeEventSource> }).fake;

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams('task=t1'),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

// A member who neither created nor is assigned the task: the panel shows it read-only.
const me: User = {
    id: 'u-me',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};
const PRIYA = { id: 'u2', name: 'Priya Raman' };
const PROJECT = { id: 'p1', name: 'Website relaunch' };
const project: ProjectDetail = {
    id: 'p1',
    name: 'Website relaunch',
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole: 'MEMBER',
    memberCount: 3,
    owner: null,
};

let seq = 0;
/** A live notification of `type` (payload: actor, project, the task when `taskId`, extra). */
function note(
    type: string,
    { taskId = null, extra = {} }: { taskId?: string | null; extra?: Record<string, unknown> } = {},
): Notification {
    seq += 1;
    return {
        id: `n${seq}`,
        type: type as Notification['type'],
        projectId: 'p1',
        taskId,
        payload: {
            actor: PRIYA,
            project: PROJECT,
            ...(taskId ? { task: { id: taskId, title: 'Old title' } } : {}),
            ...extra,
        },
        readAt: null,
        createdAt: new Date().toISOString(),
    };
}

const task = (title: string): Task => ({
    id: 't1',
    projectId: 'p1',
    title,
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    dueDate: null,
    completedAt: null,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
    assignee: null,
    createdBy: { id: 'u2', name: 'Priya Raman', email: 'priya@taskmaster.app' },
    commentCount: 0,
    attachmentCount: 0,
});

const comment = (id: string, body: string, over: Partial<Comment> = {}): Comment => ({
    id,
    projectId: 'p1',
    taskId: 't1',
    authorId: 'u2',
    parentId: null,
    body,
    editedAt: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    author: PRIYA,
    replyCount: 0,
    ...over,
});

let client: QueryClient;
let invalidate: MockInstance<QueryClient['invalidateQueries']>;

function renderWith(view: ReactNode) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.projects.detail('p1'), project);
    invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <NotificationStream />
                {view}
            </TooltipProvider>
        </QueryClientProvider>,
    );
}

/** The keys invalidateQueries was called with since the last clear. */
const invalidated = (): QueryKey[] =>
    invalidate.mock.calls.map(([filters]) => filters?.queryKey ?? []);

const openStream = () => vi.waitFor(() => expect(streamState.get()).toBe('open'));

/** Deliver `n` over the open stream, from a clean invalidateQueries record. */
async function push(n: Notification) {
    await act(() => fake.latest().emit({ event: 'notification', data: JSON.stringify(n) }));
}

let calls: NotificationCalls;
beforeEach(() => {
    seq = 0;
    fake.reset();
    vi.mocked(toast).mockClear();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at-1', expiresIn: 900, user: me });
    calls = { gets: [], reads: [], readAll: 0 };
    server.use(...notificationsApi([], calls), emptyAttachments());
    mockStreamFetch();
});
afterEach(() => {
    vi.restoreAllMocks();
    resetRefreshForTests();
    setTabHidden(false);
});

describe('task events', () => {
    it.each(['TASK_ASSIGNED', 'TASK_UPDATED', 'TASK_COMPLETED'])(
        '%s: the project’s task queries and My tasks; an open panel shows the change',
        async (type) => {
            let current = task('Old title');
            server.use(
                http.get(`${API_ORIGIN}/api/v1/projects/p1/tasks/t1`, () =>
                    HttpResponse.json({ data: current }),
                ),
                http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () =>
                    HttpResponse.json({ data: [] }),
                ),
                commentsList([]),
            );
            renderWith(<TaskPanel projectId="p1" taskId="t1" />);
            expect(await screen.findByRole('heading', { name: 'Old title' })).toBeInTheDocument();
            await openStream();
            invalidate.mockClear();

            current = task('New title');
            await push(note(type, { taskId: 't1' }));

            expect(invalidated()).toEqual([queryKeys.tasks.all('p1'), queryKeys.tasks.mineAll()]);
            expect(await screen.findByRole('heading', { name: 'New title' })).toBeInTheDocument();
        },
    );
});

describe('comment events', () => {
    it('COMMENT_ADDED on a task: the project’s comments and the task’s detail; the thread shows it', async () => {
        const store = [comment('c1', 'First')];
        server.use(commentsList(store));
        renderWith(<CommentThread projectId="p1" taskId="t1" />);
        expect(await screen.findByText('First')).toBeInTheDocument();
        await openStream();
        invalidate.mockClear();

        store.push(comment('c2', 'Fresh from Priya', { createdAt: new Date().toISOString() }));
        await push(
            note('COMMENT_ADDED', {
                taskId: 't1',
                extra: { commentId: 'c2', commentPreview: 'Fresh from Priya' },
            }),
        );

        expect(invalidated()).toEqual([
            queryKeys.comments.all('p1'),
            queryKeys.tasks.detail('p1', 't1'),
        ]);
        expect(await screen.findByText('Fresh from Priya')).toBeInTheDocument();
    });

    it('COMMENT_REPLY on a task: comments and the task’s detail; the reply count shows', async () => {
        const store = [comment('c1', 'First')];
        server.use(commentsList(store));
        renderWith(<CommentThread projectId="p1" taskId="t1" />);
        expect(await screen.findByText('First')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /View 1 reply/ })).not.toBeInTheDocument();
        await openStream();
        invalidate.mockClear();

        store[0] = { ...comment('c1', 'First'), replyCount: 1 };
        store.push(comment('r1', 'Agreed', { parentId: 'c1' }));
        await push(
            note('COMMENT_REPLY', {
                taskId: 't1',
                extra: { commentId: 'r1', parentId: 'c1', commentPreview: 'Agreed' },
            }),
        );

        expect(invalidated()).toEqual([
            queryKeys.comments.all('p1'),
            queryKeys.tasks.detail('p1', 't1'),
        ]);
        expect(await screen.findByRole('button', { name: /View 1 reply/ })).toBeInTheDocument();
    });

    it('COMMENT_REPLY on the project (no task): comments only, no task detail', async () => {
        const store = [comment('c1', 'Kick-off notes', { taskId: null })];
        server.use(commentsList(store));
        renderWith(<CommentThread projectId="p1" taskId={null} heading="Discussion" />);
        expect(await screen.findByText('Kick-off notes')).toBeInTheDocument();
        await openStream();
        invalidate.mockClear();

        store[0] = { ...comment('c1', 'Kick-off notes', { taskId: null }), replyCount: 1 };
        store.push(comment('r1', 'Thanks', { taskId: null, parentId: 'c1' }));
        await push(
            note('COMMENT_REPLY', {
                extra: { commentId: 'r1', parentId: 'c1', commentPreview: 'Thanks' },
            }),
        );

        expect(invalidated()).toEqual([queryKeys.comments.all('p1')]);
        expect(await screen.findByRole('button', { name: /View 1 reply/ })).toBeInTheDocument();
    });
});

describe('invitation events', () => {
    it('PROJECT_INVITATION: my invitations; the inbox and the sidebar badge show it', async () => {
        let mine: MyInvitation[] = [];
        server.use(
            http.get(`${API_ORIGIN}/api/v1/users/me/invitations`, () =>
                HttpResponse.json({ data: mine }),
            ),
            http.get(`${API_ORIGIN}/api/v1/projects`, () =>
                HttpResponse.json({
                    data: [],
                    meta: { page: 1, limit: 100, total: 0, totalPages: 0 },
                }),
            ),
        );
        renderWith(
            <>
                <SidebarNav />
                <InvitationsInbox />
            </>,
        );
        expect(await screen.findByText('No pending invitations')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Invitations' })).toBeInTheDocument();
        await openStream();
        invalidate.mockClear();

        mine = [
            {
                id: 'i1',
                projectId: 'p9',
                email: me.email,
                role: 'MEMBER',
                status: 'PENDING',
                expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
                respondedAt: null,
                createdAt: new Date().toISOString(),
                invitedBy: PRIYA,
                project: { id: 'p9', name: 'Brand refresh' },
            },
        ];
        await push(
            note('PROJECT_INVITATION', {
                extra: {
                    invitationId: 'i1',
                    role: 'MEMBER',
                    project: { id: 'p9', name: 'Brand refresh' },
                },
            }),
        );

        expect(invalidated()).toEqual([queryKeys.invitations.mine()]);
        expect(await screen.findByText('Brand refresh')).toBeInTheDocument();
        expect(
            await screen.findByRole('link', { name: 'Invitations, 1 pending' }),
        ).toBeInTheDocument();
    });
});

describe('what doesn’t invalidate', () => {
    it('the same id again: no second invalidation', async () => {
        renderWith(null);
        await openStream();
        invalidate.mockClear();
        const n = note('TASK_UPDATED', { taskId: 't1' });

        await push(n);
        expect(invalidated()).toHaveLength(2);
        await push(n);
        expect(invalidated()).toHaveLength(2);
    });

    it('an id a cached list already has (fetched, not streamed): no invalidation', async () => {
        renderWith(null);
        await openStream();
        const n = note('TASK_UPDATED', { taskId: 't1' });
        client.setQueryData(latestNotificationsKey(), {
            items: [n],
            meta: { page: 1, limit: 10, total: 1, totalPages: 1, unreadCount: 1 },
        });
        invalidate.mockClear();

        await push(n);

        expect(invalidated()).toEqual([]);
        expect(toast).not.toHaveBeenCalled();
    });

    it('a type this client doesn’t know: nothing invalidated, no throw (the toast still shows)', async () => {
        renderWith(null);
        await openStream();
        invalidate.mockClear();

        await push(note('SOMETHING_NEW', { taskId: 't1' }));

        expect(invalidated()).toEqual([]);
        expect(toast).toHaveBeenCalledOnce();
        expect(streamState.get()).toBe('open');
    });
});

describe('catch-up', () => {
    it('a reconnect invalidates notifications, every task, comments and my invitations; the first open doesn’t', async () => {
        renderWith(null);
        await openStream();
        // The first open: nothing to catch up on.
        expect(invalidated()).toEqual([]);

        act(() => setTabHidden(true));
        act(() => setTabHidden(false));

        await vi.waitFor(() =>
            expect(invalidated()).toEqual([
                queryKeys.notifications.all(),
                queryKeys.tasks.root(),
                queryKeys.comments.root(),
                queryKeys.invitations.mine(),
            ]),
        );
    });
});
