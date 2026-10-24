/*
 * Comment actions (9b): who sees Edit / Delete, inline editing (optimistic) and deleting
 * (confirmed, not optimistic). The thread is rendered alone; the comment count is checked in
 * the task panel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { COMMENT_ALREADY_DELETED_MESSAGE } from '@/features/comments/api';
import { CommentThread } from '@/features/comments/components/CommentThread';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type {
    Comment,
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

const comment = (id: string, authorId: string, name: string, body: string): Comment => ({
    id,
    projectId: 'p1',
    taskId: 't1',
    authorId,
    body,
    editedAt: null,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    author: { id: authorId, name },
});

const mine = () => comment('c1', me.id, me.name, 'My first take');
const priyas = () => comment('c2', 'u2', 'Priya Raman', 'Priya says hi');

const apiError = (status: number, code: string, details?: { path: string; message: string }[]) =>
    HttpResponse.json(
        { error: { code, message: `${code} message`, requestId: 'r', details } },
        { status },
    );

type Calls = { patches: Record<string, unknown>[]; deletes: string[] };

/**
 * The project (with `role`), the thread (`thread`, kept up to date by PATCH and DELETE), and
 * optional overrides for PATCH / DELETE.
 */
function mockApi(
    role: ProjectRole,
    thread: Comment[],
    overrides: {
        patch?: () => Response | Promise<Response>;
        remove?: () => Response | Promise<Response>;
    } = {},
): Calls {
    const calls: Calls = { patches: [], deletes: [] };
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () =>
            HttpResponse.json({ data: project(role) }),
        ),
        http.get(commentsUrl, () =>
            HttpResponse.json({
                data: thread,
                meta: { page: 1, limit: 50, total: thread.length, totalPages: 1 },
            }),
        ),
        http.patch(`${commentsUrl}/:id`, async ({ params, request }) => {
            const body = (await request.json()) as { body: string };
            calls.patches.push(body);
            if (overrides.patch) return overrides.patch();
            const index = thread.findIndex((c) => c.id === params.id);
            const saved = {
                ...(thread[index] as Comment),
                body: body.body,
                editedAt: new Date().toISOString(),
            };
            thread[index] = saved;
            return HttpResponse.json({ data: saved });
        }),
        http.delete(`${commentsUrl}/:id`, ({ params }) => {
            calls.deletes.push(String(params.id));
            if (overrides.remove) return overrides.remove();
            thread.splice(
                thread.findIndex((c) => c.id === params.id),
                1,
            );
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return calls;
}

let client: QueryClient;

function renderThread() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <CommentThread projectId="p1" taskId="t1" />
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const item = (text: string) => screen.getByText(text).closest('li') as HTMLElement;
const actions = (text: string) =>
    within(item(text)).queryByRole('button', { name: 'Comment actions' });

/** Open a comment's menu; returns the item labels. */
async function openMenu(u: ReturnType<typeof userEvent.setup>, text: string) {
    await u.click(actions(text) as HTMLElement);
    const menu = await screen.findByRole('menu');
    return within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.textContent);
}

/** Hold the next response until release() is called. */
function gate() {
    let release = () => {};
    const opened = new Promise<void>((resolve) => (release = resolve));
    return { opened, release: () => release() };
}

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('who sees what', () => {
    it('the author: Edit and Delete', async () => {
        mockApi('MEMBER', [mine()]);
        const u = renderThread();
        await screen.findByText('My first take');

        await vi.waitFor(() => expect(actions('My first take')).toBeInTheDocument());
        expect(await openMenu(u, 'My first take')).toEqual(['Edit', 'Delete']);
    });

    it.each(['ADMIN', 'OWNER'] as const)(
        '%s: only Delete on someone else’s comment',
        async (role) => {
            mockApi(role, [priyas()]);
            const u = renderThread();
            await screen.findByText('Priya says hi');

            await vi.waitFor(() => expect(actions('Priya says hi')).toBeInTheDocument());
            expect(await openMenu(u, 'Priya says hi')).toEqual(['Delete']);
        },
    );

    it('a MEMBER: no actions on someone else’s comment', async () => {
        mockApi('MEMBER', [mine(), priyas()]);
        renderThread();
        await screen.findByText('Priya says hi');
        await vi.waitFor(() => expect(actions('My first take')).toBeInTheDocument());

        expect(actions('Priya says hi')).not.toBeInTheDocument();
    });
});

describe('editing', () => {
    async function startEditing() {
        const u = renderThread();
        await screen.findByText('My first take');
        await vi.waitFor(() => expect(actions('My first take')).toBeInTheDocument());
        await openMenu(u, 'My first take');
        await u.click(screen.getByRole('menuitem', { name: 'Edit' }));
        const editor = await screen.findByRole('textbox', { name: 'Edit comment' });
        return { u, editor };
    }

    it('opens prefilled and focused, cursor at the end', async () => {
        mockApi('MEMBER', [mine()]);
        const { editor } = await startEditing();

        expect(editor).toHaveValue('My first take');
        await vi.waitFor(() => expect(editor).toHaveFocus());
        expect((editor as HTMLTextAreaElement).selectionStart).toBe('My first take'.length);
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('Ctrl+Enter saves: the new body at once, then "· edited" from the server', async () => {
        const held = gate();
        const thread = [mine()];
        const calls = mockApi('MEMBER', thread, {
            patch: async () => {
                await held.opened;
                const saved = {
                    ...mine(),
                    body: 'Second take',
                    editedAt: new Date().toISOString(),
                };
                thread[0] = saved;
                return HttpResponse.json({ data: saved });
            },
        });
        const { u, editor } = await startEditing();

        await u.clear(editor);
        await u.type(editor, '  Second take ');
        await u.keyboard('{Control>}{Enter}{/Control}');

        // Optimistic: shown before the server answers.
        expect(await screen.findByText('Second take')).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Edit comment' })).not.toBeInTheDocument();
        expect(screen.queryByText('· edited')).not.toBeInTheDocument();

        held.release();
        expect(await screen.findByText('· edited')).toBeInTheDocument();
        expect(calls.patches).toEqual([{ body: 'Second take' }]);
    });

    it('Esc cancels without a request', async () => {
        const calls = mockApi('MEMBER', [mine()]);
        const { u, editor } = await startEditing();

        await u.type(editor, ' — scrap that');
        await u.keyboard('{Escape}');

        expect(screen.queryByRole('textbox', { name: 'Edit comment' })).not.toBeInTheDocument();
        expect(screen.getByText('My first take')).toBeInTheDocument();
        expect(calls.patches).toHaveLength(0);
    });

    it('unchanged text (after trimming) just closes', async () => {
        const calls = mockApi('MEMBER', [mine()]);
        const { u, editor } = await startEditing();

        await u.type(editor, '   ');
        await u.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.queryByRole('textbox', { name: 'Edit comment' })).not.toBeInTheDocument();
        expect(calls.patches).toHaveLength(0);
    });

    it('empty text stays in the editor with a message', async () => {
        const calls = mockApi('MEMBER', [mine()]);
        const { u, editor } = await startEditing();

        await u.clear(editor);
        await u.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.getByText("A comment can't be empty.")).toBeInTheDocument();
        expect(calls.patches).toHaveLength(0);
    });

    it('422: back in the editor with the text and the message; the body rolled back', async () => {
        mockApi('MEMBER', [mine()], {
            patch: () =>
                apiError(422, 'VALIDATION_ERROR', [{ path: 'body', message: 'Body is too long' }]),
        });
        const { u, editor } = await startEditing();

        await u.clear(editor);
        await u.type(editor, 'Rejected text');
        await u.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Body is too long')).toBeInTheDocument();
        const reopened = screen.getByRole('textbox', { name: 'Edit comment' });
        expect(reopened).toHaveValue('Rejected text');
        expect(reopened).toHaveAttribute('aria-invalid', 'true');
        expect(toast.error).not.toHaveBeenCalled();

        await u.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByText('My first take')).toBeInTheDocument();
    });

    it('another failure rolls the body back and toasts', async () => {
        mockApi('MEMBER', [mine()], { patch: () => apiError(500, 'INTERNAL_ERROR') });
        const { u, editor } = await startEditing();

        await u.clear(editor);
        await u.type(editor, 'Doomed edit{Control>}{Enter}{/Control}');

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(await screen.findByText('My first take')).toBeInTheDocument();
        expect(screen.queryByText('Doomed edit')).not.toBeInTheDocument();
    });

    it('one comment in edit mode at a time', async () => {
        const second = comment('c3', me.id, me.name, 'My second take');
        mockApi('MEMBER', [mine(), second]);
        const { u } = await startEditing();

        await openMenu(u, 'My second take');
        await u.click(screen.getByRole('menuitem', { name: 'Edit' }));

        const editors = await screen.findAllByRole('textbox', { name: 'Edit comment' });
        expect(editors).toHaveLength(1);
        expect(editors[0]).toHaveValue('My second take');
        expect(screen.getByText('My first take')).toBeInTheDocument();
    });
});

describe('deleting', () => {
    async function askToDelete(text: string) {
        const u = renderThread();
        await screen.findByText(text);
        await vi.waitFor(() => expect(actions(text)).toBeInTheDocument());
        await openMenu(u, text);
        await u.click(screen.getByRole('menuitem', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete this comment?' });
        expect(dialog).toHaveTextContent("This can't be undone.");
        return { u, dialog };
    }

    it('cancel sends nothing', async () => {
        const calls = mockApi('MEMBER', [mine()]);
        const { u, dialog } = await askToDelete('My first take');

        await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(calls.deletes).toHaveLength(0);
        expect(screen.getByText('My first take')).toBeInTheDocument();
    });

    it('404: removed anyway, with "That comment was already deleted."', async () => {
        mockApi('ADMIN', [priyas()], { remove: () => apiError(404, 'NOT_FOUND') });
        const { u, dialog } = await askToDelete('Priya says hi');

        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('Priya says hi')).not.toBeInTheDocument());
        expect(toast).toHaveBeenCalledWith(COMMENT_ALREADY_DELETED_MESSAGE);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('500: the dialog stays open, with an error toast', async () => {
        mockApi('MEMBER', [mine()], { remove: () => apiError(500, 'INTERNAL_ERROR') });
        const { u, dialog } = await askToDelete('My first take');

        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(screen.getByRole('dialog', { name: 'Delete this comment?' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
        expect(screen.getByText('My first take')).toBeInTheDocument();
    });

    it('confirm in the task panel: DELETE, the comment goes, the count goes down', async () => {
        vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
        vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
        resetTaskPanelHistoryForTests();
        const calls = mockApi('MEMBER', [mine(), priyas()]);
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
            commentCount: 2,
            attachmentCount: 0,
        };
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
        const u = userEvent.setup();
        const panel = await screen.findByRole('dialog', { name: 'Website relaunch / Task' });
        await within(panel).findByText('My first take');
        await vi.waitFor(() =>
            expect(within(panel).getByTestId('comment-count')).toHaveTextContent('2'),
        );

        await openMenu(u, 'My first take');
        await u.click(screen.getByRole('menuitem', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete this comment?' });
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('My first take')).not.toBeInTheDocument());
        expect(calls.deletes).toEqual(['c1']);
        expect(within(panel).getByTestId('comment-count')).toHaveTextContent('1');
        expect(screen.getByText('Priya says hi')).toBeInTheDocument();
        expect(
            screen.queryByRole('dialog', { name: 'Delete this comment?' }),
        ).not.toBeInTheDocument();
    });
});
