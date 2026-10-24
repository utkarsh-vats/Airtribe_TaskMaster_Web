/*
 * Per-column Add task on the board (8c): the button opens New task with ?column=<status>, and
 * a task added to In progress or Done is created (always To do) and then PATCHed to its column.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import {
    TASK_CREATED_MESSAGE,
    taskNotMovedMessage,
} from '@/features/tasks/components/NewTaskDialog';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type { ProjectDetail, Task, TaskStatus } from '@/lib/api/types';
import { resetRefreshForTests } from '@/lib/auth/refresh';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { API_ORIGIN, server } from '../../msw/server';

const PATH = '/dashboard/projects/p1/tasks';
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

const MARA = 'u1';
const tasksUrl = `${API_ORIGIN}/api/v1/projects/p1/tasks`;

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

const newTask = (title: string, status: TaskStatus = 'OPEN'): Task => ({
    id: 'new-task',
    projectId: 'p1',
    title,
    description: null,
    status,
    priority: 'MEDIUM',
    dueDate: null,
    completedAt: status === 'COMPLETED' ? '2026-10-24T09:00:00.000Z' : null,
    createdAt: '2026-10-24T09:00:00.000Z',
    updatedAt: '2026-10-24T09:00:00.000Z',
    assignee: null,
    createdBy: { id: MARA, name: 'Mara Okafor', email: 'mara@taskmaster.app' },
    commentCount: 0,
    attachmentCount: 0,
});

/** What reached the API, in order. */
let calls: string[];
let patchFails: boolean;
/** Resolve to answer the pending PATCH (set while one is waiting). */
let releasePatch: (() => void) | null;
let holdPatch: boolean;

function mockApi() {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () => HttpResponse.json({ data: [] })),
        http.get(tasksUrl, ({ request }) => {
            const limit = Number(new URL(request.url).searchParams.get('limit'));
            return HttpResponse.json({
                data: [],
                meta: { page: 1, limit, total: 0, totalPages: 1 },
            });
        }),
        http.post(tasksUrl, async ({ request }) => {
            const body = (await request.json()) as { title: string };
            calls.push('POST');
            return HttpResponse.json({ data: newTask(body.title) }, { status: 201 });
        }),
        http.patch(`${tasksUrl}/new-task`, async ({ request }) => {
            const body = (await request.json()) as { status: TaskStatus };
            calls.push(`PATCH ${JSON.stringify(body)}`);
            if (holdPatch) await new Promise<void>((resolve) => (releasePatch = resolve));
            if (patchFails) {
                return HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Server error', requestId: 'r' } },
                    { status: 500 },
                );
            }
            return HttpResponse.json({ data: newTask('Write launch post', body.status) });
        }),
    );
}

let client: QueryClient;

function renderView(search: string) {
    nav.search = search;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <ProjectContext
                    value={{ project, myRole: 'MEMBER', can: bindPermissions('MEMBER', MARA) }}
                >
                    <TaskListView />
                </ProjectContext>
            </TooltipProvider>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const dialog = () => screen.findByRole('dialog', { name: 'New task' });
const titleBox = (scope: HTMLElement) => within(scope).getByRole('textbox', { name: /^Title/ });

let urlPush: MockInstance<(url: string) => void>;
let urlReplace: MockInstance<(url: string) => void>;

beforeEach(() => {
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    calls = [];
    patchFails = false;
    holdPatch = false;
    releasePatch = null;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    urlReplace = vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    mockApi();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('the column button', () => {
    it.each([
        ['To do', `${PATH}?view=board&new=1`],
        ['In progress', `${PATH}?view=board&new=1&column=IN_PROGRESS`],
        ['Done', `${PATH}?view=board&new=1&column=COMPLETED`],
    ])('%s writes %s', async (label, expected) => {
        const user = renderView('view=board');
        const column = await screen.findByRole('region', { name: label });

        await user.click(within(column).getByRole('button', { name: `Add task to ${label}` }));

        expect(urlPush).toHaveBeenCalledExactlyOnceWith(expected);
    });

    it('the toolbar New task button stays To do (drops a stale column)', async () => {
        const user = renderView('view=board&column=COMPLETED');
        const [button] = await screen.findAllByRole('button', { name: 'New task' });

        await user.click(button as HTMLElement);

        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${PATH}?view=board&new=1`);
    });
});

describe('adding to another column', () => {
    it.each([
        ['IN_PROGRESS', 'In progress'],
        ['COMPLETED', 'Done'],
    ] as const)(
        '%s: POST, then one PATCH { status }; closes only after both',
        async (status, label) => {
            holdPatch = true;
            const user = renderView(`view=board&new=1&column=${status}`);
            const d = await dialog();
            expect(within(d).getByText(`Will be added to ${label}`)).toBeInTheDocument();

            await user.type(titleBox(d), 'Write launch post{Enter}');

            // The PATCH is waiting: the dialog is still open, the submit button pending.
            await vi.waitFor(() => expect(releasePatch).not.toBeNull());
            expect(within(d).getByRole('button', { name: /Create task/ })).toHaveAttribute(
                'aria-busy',
                'true',
            );
            expect(urlReplace).not.toHaveBeenCalled();
            expect(toast.success).not.toHaveBeenCalled();

            releasePatch?.();

            await vi.waitFor(() =>
                expect(toast.success).toHaveBeenCalledWith(TASK_CREATED_MESSAGE, expect.anything()),
            );
            expect(calls).toEqual(['POST', `PATCH ${JSON.stringify({ status })}`]);
            // Deep-linked: closing replaces the URL, without ?new or ?column.
            expect(urlReplace).toHaveBeenCalledExactlyOnceWith(`${PATH}?view=board`);
            expect(toast.error).not.toHaveBeenCalled();
        },
    );

    it('To do: POST only, no "Will be added" line', async () => {
        const user = renderView('view=board&new=1');
        const d = await dialog();
        expect(within(d).queryByText(/Will be added to/)).not.toBeInTheDocument();

        await user.type(titleBox(d), 'Write launch post{Enter}');

        await vi.waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith(TASK_CREATED_MESSAGE, expect.anything()),
        );
        expect(calls).toEqual(['POST']);
    });

    it('a failed PATCH closes, toasts "created in To do" with Open, and refetches the columns', async () => {
        patchFails = true;
        const user = renderView('view=board&new=1&column=COMPLETED');
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const d = await dialog();

        await user.type(titleBox(d), 'Write launch post{Enter}');

        await vi.waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(
                taskNotMovedMessage('COMPLETED'),
                expect.anything(),
            ),
        );
        expect(taskNotMovedMessage('COMPLETED')).toBe(
            "Task created in To do — couldn't move it to Done",
        );
        // Only that toast: the update's own error toast is off.
        expect(toast.error).toHaveBeenCalledOnce();
        expect(toast.success).not.toHaveBeenCalled();
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(`${PATH}?view=board`);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks.all('p1') });

        const options = vi.mocked(toast.error).mock.calls[0]?.[1] as {
            action: { label: string; onClick: () => void };
        };
        expect(options.action.label).toBe('Open');
        options.action.onClick();
        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${PATH}?view=board&task=new-task`);
    });
});

describe('the column param', () => {
    it('junk is ignored: no line, POST only', async () => {
        const user = renderView('view=board&new=1&column=DONE');
        const d = await dialog();
        expect(within(d).queryByText(/Will be added to/)).not.toBeInTheDocument();

        await user.type(titleBox(d), 'Write launch post{Enter}');

        await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
        expect(calls).toEqual(['POST']);
    });

    it('closing removes both new and column', async () => {
        const user = renderView('view=board&new=1&column=IN_PROGRESS');

        await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));

        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(`${PATH}?view=board`);
    });
});
