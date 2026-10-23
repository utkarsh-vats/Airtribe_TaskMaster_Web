/*
 * Deleting a task from the panel footer. The panel is modal, so the list behind it is outside
 * the accessibility tree while it's open: list assertions use text queries.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TASK_ALREADY_DELETED_MESSAGE } from '@/features/tasks/api';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { DELETE_HINT, TASK_DELETED_MESSAGE } from '@/features/tasks/components/TaskPanel';
import {
    closeTaskPanel,
    openTaskPanel,
    resetTaskPanelHistoryForTests,
} from '@/features/tasks/panelHistory';
import type { ProjectDetail, ProjectRole, Task, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { API_ORIGIN, server } from '../../msw/server';

const PATH = '/dashboard/projects/p1/tasks';
const url = vi.hoisted(() => ({ search: 'task=t1' }));

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(url.search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const ME = '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f';
const CREATOR = '9a8e1f2d-3c4b-4a69-8b6f-9f3a5d2e4c1b';
const OTHER = '0b6f9f3a-5d2e-4c1b-9a8e-1f2d3c4b5a69';
const tasksUrl = `${API_ORIGIN}/api/v1/projects/p1/tasks`;

const userFor = (id: string): User => ({
    id,
    email: `${id}@taskmaster.app`,
    name: 'Signed In',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
});

const projectAs = (myRole: ProjectRole): ProjectDetail => ({
    id: 'p1',
    name: 'Website relaunch',
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole,
    memberCount: 3,
    owner: null,
});

const makeTask = (id: string, title: string): Task => ({
    id,
    projectId: 'p1',
    title,
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    dueDate: null,
    completedAt: null,
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: '2026-10-10T09:00:00.000Z',
    // I'm the assignee: that's enough to edit, not to delete.
    assignee: { id: ME, name: 'Mara Okafor', email: 'mara@taskmaster.app' },
    createdBy: { id: CREATOR, name: 'Priya Creator', email: 'c@taskmaster.app' },
    commentCount: 0,
    attachmentCount: 0,
});

/** The fake server's tasks (DELETE removes from it). */
let serverTasks: Task[];
let deletes: string[];
let deleteFailure: (() => Response) | null;
/** Rows before the current page (for the paging test). */
let offset: number;

function mockApi() {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () => HttpResponse.json({ data: [] })),
        http.get(tasksUrl, ({ request }) => {
            const params = new URL(request.url).searchParams;
            const limit = Number(params.get('limit'));
            const page = Number(params.get('page') ?? 1);
            const total = offset + serverTasks.length;
            const rows = serverTasks.map(
                ({ commentCount: _c, attachmentCount: _a, ...row }) => row,
            );
            return HttpResponse.json({
                data: rows,
                meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / 25)) },
            });
        }),
        http.get(`${tasksUrl}/:taskId`, ({ params }) => {
            const task = serverTasks.find((t) => t.id === params.taskId);
            return task
                ? HttpResponse.json({ data: task })
                : HttpResponse.json(
                      { error: { code: 'NOT_FOUND', message: 'Task not found', requestId: 'r' } },
                      { status: 404 },
                  );
        }),
        http.delete(`${tasksUrl}/:taskId`, ({ params }) => {
            const id = String(params.taskId);
            deletes.push(id);
            if (deleteFailure) {
                const failure = deleteFailure;
                deleteFailure = null;
                return failure();
            }
            serverTasks = serverTasks.filter((t) => t.id !== id);
            return new HttpResponse(null, { status: 204 });
        }),
    );
}

let client: QueryClient;

async function openPanel({
    role = 'MEMBER',
    userId = CREATOR,
}: { role?: ProjectRole; userId?: string } = {}) {
    sessionStore.reset();
    startSession({ accessToken: 'at', expiresIn: 900, user: userFor(userId) });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const project = projectAs(role);
    client.setQueryData(queryKeys.projects.detail('p1'), project);
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () => HttpResponse.json({ data: project })),
    );
    render(
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <ProjectContext
                    value={{ project, myRole: role, can: bindPermissions(role, userId) }}
                >
                    <TaskListView />
                </ProjectContext>
            </TooltipProvider>
        </QueryClientProvider>,
    );
    const panel = await screen.findByRole('dialog', { name: 'Website relaunch / Task' });
    await within(panel).findByRole('heading', { name: 'Comments (0)' }); // the full task
    return { panel, user: userEvent.setup() };
}

const taskTable = () => screen.getByTestId('task-table');

async function confirmDelete(panel: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(panel).getByRole('button', { name: 'Delete task' }));
    return screen.findByRole('dialog', { name: 'Delete this task?' });
}

let urlReplace: ReturnType<typeof vi.spyOn>;
let historyBack: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    url.search = 'task=t1';
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    serverTasks = [
        makeTask('t1', 'Finalise homepage hero copy'),
        makeTask('t2', 'Set up 301 redirects'),
    ];
    deletes = [];
    deleteFailure = null;
    offset = 0;
    vi.mocked(toast).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    urlReplace = vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    mockApi();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('who can delete', () => {
    it('the creator sees an enabled button and no hint', async () => {
        const { panel } = await openPanel({ role: 'MEMBER', userId: CREATOR });
        expect(within(panel).getByRole('button', { name: 'Delete task' })).toBeEnabled();
        expect(within(panel).queryByText(DELETE_HINT)).not.toBeInTheDocument();
    });

    it('an ADMIN sees an enabled button', async () => {
        const { panel } = await openPanel({ role: 'ADMIN', userId: OTHER });
        expect(within(panel).getByRole('button', { name: 'Delete task' })).toBeEnabled();
    });

    it('another MEMBER — even the assignee — sees it disabled, with the hint and a tooltip', async () => {
        const { panel, user } = await openPanel({ role: 'MEMBER', userId: ME });
        const button = within(panel).getByRole('button', { name: 'Delete task' });
        expect(button).toBeDisabled();
        expect(within(panel).getByText(DELETE_HINT)).toBeInTheDocument();
        // The editable fields are still there: the assignee can edit, just not delete.
        expect(within(panel).getByRole('combobox', { name: 'Status' })).toBeInTheDocument();

        await user.hover(button.parentElement as HTMLElement);
        expect(await screen.findByRole('tooltip')).toHaveTextContent(DELETE_HINT);
    });
});

describe('deleting', () => {
    it('confirm sends DELETE, closes the panel, toasts, removes the row and decrements the count', async () => {
        const { panel, user } = await openPanel();
        expect(screen.getByText('2 tasks')).toBeInTheDocument();

        const confirm = await confirmDelete(panel, user);
        expect(confirm).toHaveTextContent(
            "“Finalise homepage hero copy” and its comments and attachments will be permanently deleted. This can't be undone.",
        );
        await user.click(within(confirm).getByRole('button', { name: 'Delete task' }));

        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(TASK_DELETED_MESSAGE));
        expect(deletes).toEqual(['t1']);
        // Deep-linked, so closing replaces the URL (as the X button does).
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(PATH);
        expect(historyBack).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(
            within(taskTable()).queryByText('Finalise homepage hero copy'),
        ).not.toBeInTheDocument();
        expect(within(taskTable()).getByText('Set up 301 redirects')).toBeInTheDocument();
        expect(screen.getByText('1 task')).toBeInTheDocument();
        expect(client.getQueryData(queryKeys.tasks.detail('p1', 't1'))).toBeUndefined();
        // Never a "Task not found" flash while closing.
        expect(screen.queryByText('Task not found')).not.toBeInTheDocument();
    });

    it('opened from a row, it closes by going back (no duplicate history entry)', async () => {
        // As if opened from the list: the panel pushed ?task=t1 itself.
        openTaskPanel(`${PATH}?task=t1`, 't1');
        const { panel, user } = await openPanel();

        const confirm = await confirmDelete(panel, user);
        await user.click(within(confirm).getByRole('button', { name: 'Delete task' }));

        await vi.waitFor(() => expect(historyBack).toHaveBeenCalledOnce());
        expect(urlReplace).not.toHaveBeenCalled();
    });

    it('cancel sends nothing and leaves the panel open', async () => {
        const { panel, user } = await openPanel();

        const confirm = await confirmDelete(panel, user);
        await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog', { name: 'Delete this task?' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Website relaunch / Task' })).toBeInTheDocument();
        expect(deletes).toEqual([]);
        expect(urlReplace).not.toHaveBeenCalled();
    });

    it('404 → treated as already deleted', async () => {
        deleteFailure = () =>
            HttpResponse.json(
                { error: { code: 'NOT_FOUND', message: 'Task not found', requestId: 'r' } },
                { status: 404 },
            );
        const { panel, user } = await openPanel();
        serverTasks = serverTasks.filter((t) => t.id !== 't1'); // someone else deleted it

        const confirm = await confirmDelete(panel, user);
        await user.click(within(confirm).getByRole('button', { name: 'Delete task' }));

        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(TASK_ALREADY_DELETED_MESSAGE));
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(PATH);
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(
            within(taskTable()).queryByText('Finalise homepage hero copy'),
        ).not.toBeInTheDocument();
        expect(screen.getByText('1 task')).toBeInTheDocument();
    });

    it('500 → error toast; the confirm dialog stays open for a retry', async () => {
        deleteFailure = () =>
            HttpResponse.json(
                { error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } },
                { status: 500 },
            );
        const { panel, user } = await openPanel();

        const confirm = await confirmDelete(panel, user);
        const confirmButton = within(confirm).getByRole('button', { name: 'Delete task' });
        await user.click(confirmButton);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(confirm).toBeInTheDocument();
        await vi.waitFor(() => expect(confirmButton).toBeEnabled()); // pending state over
        // The panel is still open behind the confirm dialog.
        expect(panel).toBeInTheDocument();
        expect(panel).toHaveAttribute('data-state', 'open');
        expect(urlReplace).not.toHaveBeenCalled();
        expect(within(taskTable()).getByText('Finalise homepage hero copy')).toBeInTheDocument();

        // Retry succeeds.
        await user.click(confirmButton);
        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith(TASK_DELETED_MESSAGE));
        expect(deletes).toEqual(['t1', 't1']);
    });
});

describe('paging', () => {
    it('deleting the only row on page 2 lands on page 1', async () => {
        url.search = 'page=2&task=t1';
        offset = 25;
        serverTasks = [makeTask('t1', 'The lonely task')];
        const { panel, user } = await openPanel();
        await within(taskTable()).findByText('The lonely task');

        const confirm = await confirmDelete(panel, user);
        await user.click(within(confirm).getByRole('button', { name: 'Delete task' }));

        await vi.waitFor(() => expect(urlReplace).toHaveBeenCalledExactlyOnceWith(PATH));
    });

    it('page 3 → page 2, keeping the other params', async () => {
        url.search = 'priority=HIGH&page=3&task=t1';
        offset = 50;
        serverTasks = [makeTask('t1', 'The lonely task')];
        const { panel, user } = await openPanel();
        await within(taskTable()).findByText('The lonely task');

        const confirm = await confirmDelete(panel, user);
        await user.click(within(confirm).getByRole('button', { name: 'Delete task' }));

        await vi.waitFor(() =>
            expect(urlReplace).toHaveBeenCalledExactlyOnceWith(`${PATH}?priority=HIGH&page=2`),
        );
    });

    it('opened from a row: goes back, then replaces with the previous page', () => {
        const back = historyBack.mockImplementation(() =>
            window.dispatchEvent(new PopStateEvent('popstate')),
        );
        openTaskPanel(`${PATH}?page=2&task=t1`, 't1');

        closeTaskPanel('t1', `${PATH}?page=2`, PATH);

        expect(back).toHaveBeenCalledOnce();
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(PATH);
    });
});
