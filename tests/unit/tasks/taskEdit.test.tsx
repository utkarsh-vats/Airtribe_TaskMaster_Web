/*
 * Editing in the task panel. The panel is modal, so the list behind it is outside the
 * accessibility tree: list-row assertions use `hidden: true`.
 */
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TASK_STATUS_CONFLICT_MESSAGE } from '@/features/tasks/api';
import { EMPTY_TITLE_MESSAGE } from '@/features/tasks/components/TaskFields';
import { READ_ONLY_HINT } from '@/features/tasks/components/TaskPanel';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type { Member, ProjectDetail, ProjectRole, Task, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { emptyAttachments } from '../../msw/attachments';
import { emptyComments } from '../../msw/comments';
import { API_ORIGIN, server } from '../../msw/server';
import { inTimeZone } from '../../timeZone';

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams('task=t1'),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

inTimeZone('Asia/Kolkata');

const ME = '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f';
const PRIYA = '0b6f9f3a-5d2e-4c1b-9a8e-1f2d3c4b5a69';
const CREATOR = '9a8e1f2d-3c4b-4a69-8b6f-9f3a5d2e4c1b';
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

const member = (id: string, name: string): Member => ({
    user: { id, name, email: `${id}@taskmaster.app`, avatarUrl: null },
    role: 'MEMBER',
    joinedAt: '2026-10-01T09:00:00.000Z',
});

const baseTask = (): Task => ({
    id: 't1',
    projectId: 'p1',
    title: 'Finalise homepage hero copy',
    description: 'Tighten the headline.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    dueDate: null,
    completedAt: null,
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: '2026-10-10T09:00:00.000Z',
    assignee: { id: ME, name: 'Mara Okafor', email: 'mara@taskmaster.app' },
    createdBy: { id: CREATOR, name: 'Priya Creator', email: 'c@taskmaster.app' },
    commentCount: 0,
    attachmentCount: 0,
});

/** The fake server's copy of the task (PATCH updates it). */
let serverTask: Task;
let patches: unknown[];
let detailGets: number;
/** Make the next PATCH answer this instead of succeeding. */
let patchFailure: (() => Response) | null;
let patchDelay: number;

function mockApi() {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () =>
            HttpResponse.json({ data: [member(PRIYA, 'Priya Raman'), member(ME, 'Mara Okafor')] }),
        ),
        http.get(tasksUrl, ({ request }) => {
            const limit = Number(new URL(request.url).searchParams.get('limit'));
            const { commentCount: _c, attachmentCount: _a, ...row } = serverTask;
            return HttpResponse.json({
                data: limit === 1 ? [] : [row],
                meta: { page: 1, limit, total: 1, totalPages: 1 },
            });
        }),
        http.get(`${tasksUrl}/t1`, () => {
            detailGets += 1;
            return HttpResponse.json({ data: serverTask });
        }),
        http.patch(`${tasksUrl}/t1`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            patches.push(body);
            if (patchDelay) await delay(patchDelay);
            if (patchFailure) {
                const failure = patchFailure;
                patchFailure = null;
                return failure();
            }
            const next: Task = { ...serverTask, updatedAt: new Date().toISOString() };
            if ('title' in body) next.title = body.title as string;
            if ('description' in body) next.description = body.description as string | null;
            if ('priority' in body) next.priority = body.priority as Task['priority'];
            if ('dueDate' in body) next.dueDate = body.dueDate as string | null;
            if ('status' in body) {
                next.status = body.status as Task['status'];
                next.completedAt = next.status === 'COMPLETED' ? new Date().toISOString() : null;
            }
            if ('assigneeId' in body) {
                const id = body.assigneeId as string | null;
                next.assignee =
                    id === PRIYA
                        ? { id: PRIYA, name: 'Priya Raman', email: 'p@taskmaster.app' }
                        : id === ME
                          ? { id: ME, name: 'Mara Okafor', email: 'mara@taskmaster.app' }
                          : null;
            }
            serverTask = next;
            return HttpResponse.json({ data: next });
        }),
    );
}

let client: QueryClient;

/** Open the panel as `userId` with `role` in the project. */
async function openPanel({
    role = 'MEMBER',
    userId = ME,
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
    const dialog = await screen.findByRole('dialog', { name: 'Website relaunch / Task' });
    await within(dialog).findByTestId('attachment-count'); // shown once the full task is in
    return { dialog, user: userEvent.setup() };
}

const tableRow = () =>
    within(screen.getByTestId('task-table')).getByRole('row', {
        name: serverTask.title,
        hidden: true,
    });

beforeEach(() => {
    // The panel's comment thread (thread.test.tsx covers it).
    server.use(emptyComments(), emptyAttachments());
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    serverTask = baseTask();
    patches = [];
    detailGets = 0;
    patchFailure = null;
    patchDelay = 0;
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    mockApi();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('each field sends only its own key', () => {
    // Two selects, each saved and checked: the slowest test here, and slow under load.
    it('status and priority', async () => {
        const { dialog, user } = await openPanel();

        await user.selectOptions(
            within(dialog).getByRole('combobox', { name: 'Status' }),
            'COMPLETED',
        );
        await vi.waitFor(() => expect(patches).toEqual([{ status: 'COMPLETED' }]));

        await user.selectOptions(
            within(dialog).getByRole('combobox', { name: 'Priority' }),
            'URGENT',
        );
        await vi.waitFor(() =>
            expect(patches).toEqual([{ status: 'COMPLETED' }, { priority: 'URGENT' }]),
        );
    }, 15_000);

    it('assignee: a member, then Unassigned as null', async () => {
        // As an admin: an assignee who hands the task to someone else can no longer edit it.
        const { dialog, user } = await openPanel({ role: 'ADMIN' });
        const assignee = within(dialog).getByRole('combobox', { name: 'Assignee' });
        await within(assignee).findByRole('option', { name: 'Priya Raman' });
        expect(
            within(assignee)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Unassigned', 'Mara Okafor', 'Priya Raman']);

        await user.selectOptions(assignee, PRIYA);
        await vi.waitFor(() => expect(patches).toEqual([{ assigneeId: PRIYA }]));
        // The field is disabled while its own save is pending.
        await vi.waitFor(() => expect(assignee).toBeEnabled());

        await user.selectOptions(assignee, '');
        await vi.waitFor(() =>
            expect(patches).toEqual([{ assigneeId: PRIYA }, { assigneeId: null }]),
        );
    });

    it('due: end of the chosen day with the local offset; Clear sends null', async () => {
        const { dialog, user } = await openPanel();

        fireEvent.change(within(dialog).getByLabelText(/^Due/), {
            target: { value: '2026-10-28' },
        });
        await vi.waitFor(() => expect(patches).toEqual([{ dueDate: '2026-10-28T23:59:59+05:30' }]));
        expect(await within(dialog).findByDisplayValue('2026-10-28')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
        await vi.waitFor(() =>
            expect(patches).toEqual([{ dueDate: '2026-10-28T23:59:59+05:30' }, { dueDate: null }]),
        );
    });

    it('description: an emptied description saves as null', async () => {
        const { dialog, user } = await openPanel();
        const description = within(dialog).getByLabelText(/^Description/);

        await user.clear(description);
        await user.click(within(dialog).getByRole('button', { name: 'Save' }));

        await vi.waitFor(() => expect(patches).toEqual([{ description: null }]));
    });

    it('title: Enter saves the trimmed title', async () => {
        const { dialog, user } = await openPanel();
        const title = within(dialog).getByRole('textbox', { name: 'Title' });

        await user.clear(title);
        await user.type(title, '  Hero copy v2  {Enter}');

        await vi.waitFor(() => expect(patches).toEqual([{ title: 'Hero copy v2' }]));
        expect(title).toHaveValue('Hero copy v2');
    });
});

describe('optimistic updates', () => {
    it('the list row and the panel change before the response', async () => {
        patchDelay = 300;
        const { dialog, user } = await openPanel();
        const status = within(dialog).getByRole('combobox', { name: 'Status' });

        await user.selectOptions(status, 'COMPLETED');

        expect(patches).toHaveLength(1);
        expect(status).toHaveValue('COMPLETED');
        expect(within(tableRow()).getByText('Done')).toBeInTheDocument();
        // Its own field is busy; the others stay usable.
        expect(status).toBeDisabled();
        expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toBeEnabled();

        await vi.waitFor(() => expect(status).toBeEnabled());
        expect(await within(dialog).findByText(/^Completed /)).toBeInTheDocument(); // from the server
    });

    it('an error rolls the panel and the list back, with an error toast', async () => {
        patchDelay = 100;
        patchFailure = () =>
            HttpResponse.json(
                { error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } },
                { status: 500 },
            );
        const { dialog, user } = await openPanel();
        const status = within(dialog).getByRole('combobox', { name: 'Status' });

        await user.selectOptions(status, 'COMPLETED');
        expect(within(tableRow()).getByText('Done')).toBeInTheDocument();

        await vi.waitFor(() => expect(status).toHaveValue('IN_PROGRESS'));
        expect(within(tableRow()).getByText('In progress')).toBeInTheDocument();
        expect(toast.error).toHaveBeenCalledWith('Something went wrong.', expect.anything());
    });

    it('409 → rollback, the status-conflict toast and a fresh detail', async () => {
        patchFailure = () =>
            HttpResponse.json(
                { error: { code: 'CONFLICT', message: 'Status changed', requestId: 'r' } },
                { status: 409 },
            );
        const { dialog, user } = await openPanel();
        const before = detailGets;

        await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Status' }), 'OPEN');

        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(TASK_STATUS_CONFLICT_MESSAGE));
        // The rollback renders through TanStack's batched notify, possibly after the toast.
        await vi.waitFor(() =>
            expect(within(dialog).getByRole('combobox', { name: 'Status' })).toHaveValue(
                'IN_PROGRESS',
            ),
        );
        await vi.waitFor(() => expect(detailGets).toBeGreaterThan(before));
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('422 → the API message under that field', async () => {
        patchFailure = () =>
            HttpResponse.json(
                {
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Request validation failed',
                        details: [
                            { path: 'title', message: 'Title is already used in this project' },
                        ],
                        requestId: 'r',
                    },
                },
                { status: 422 },
            );
        const { dialog, user } = await openPanel();
        const title = within(dialog).getByRole('textbox', { name: 'Title' });

        await user.clear(title);
        await user.type(title, 'Duplicate{Enter}');

        expect(
            await within(dialog).findByText('Title is already used in this project'),
        ).toBeInTheDocument();
        expect(title).toHaveValue('Finalise homepage hero copy'); // rolled back
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('422 rolls the title back even if the optimistic title never rendered', async () => {
        // A fast 422 can arrive before React renders the optimistic title (TanStack batches
        // cache notifications on a timer); the field must not keep the rejected text.
        patchFailure = () =>
            HttpResponse.json(
                {
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Request validation failed',
                        details: [{ path: 'title', message: 'Title is already used' }],
                        requestId: 'r',
                    },
                },
                { status: 422 },
            );
        const { dialog, user } = await openPanel();
        const title = within(dialog).getByRole('textbox', { name: 'Title' });
        await user.clear(title);
        await user.type(title, 'Duplicate');

        // Hold cache notifications until after the response, so the optimistic value and
        // the rollback reach the component together.
        notifyManager.setScheduler((flush) => setTimeout(flush, 100));
        try {
            await user.keyboard('{Enter}');
            expect(await within(dialog).findByText('Title is already used')).toBeInTheDocument();
            await vi.waitFor(() => expect(title).toHaveValue('Finalise homepage hero copy'), {
                timeout: 2000,
            });
        } finally {
            notifyManager.setScheduler((flush) => setTimeout(flush, 0));
        }
    });

    it('lists and status counts (and My tasks) are invalidated after it settles', async () => {
        const { dialog, user } = await openPanel();
        const invalidate = vi.spyOn(client, 'invalidateQueries');

        await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Priority' }), 'LOW');

        await vi.waitFor(() =>
            expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks.all('p1') }),
        );
        expect(invalidate).toHaveBeenCalledWith({ queryKey: [...queryKeys.tasks.root(), 'mine'] });
    });
});

describe('title and description editing', () => {
    it('Esc reverts the title without saving or closing the panel', async () => {
        const { dialog, user } = await openPanel();
        const title = within(dialog).getByRole('textbox', { name: 'Title' });

        await user.clear(title);
        await user.type(title, 'Something else');
        await user.keyboard('{Escape}');

        expect(title).toHaveValue('Finalise homepage hero copy');
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(patches).toEqual([]);
    });

    it('an empty title is rejected', async () => {
        const { dialog, user } = await openPanel();
        const title = within(dialog).getByRole('textbox', { name: 'Title' });

        await user.clear(title);
        await user.keyboard('{Enter}');

        expect(within(dialog).getByText(EMPTY_TITLE_MESSAGE)).toBeInTheDocument();
        expect(title).toHaveValue('Finalise homepage hero copy');
        expect(patches).toEqual([]);
    });

    it('newlines never get into the title', async () => {
        const { dialog, user } = await openPanel();
        const title = within(dialog).getByRole('textbox', { name: 'Title' });

        await user.clear(title);
        await user.click(title);
        await user.paste('Line one\nLine two');

        expect(title).toHaveValue('Line one Line two');
    });

    it('description: Save / Cancel appear once dirty; blur does not save', async () => {
        const { dialog, user } = await openPanel();
        const description = within(dialog).getByLabelText(/^Description/);
        expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

        await user.type(description, ' More detail.');
        expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument();
        await user.click(within(dialog).getByRole('combobox', { name: 'Priority' })); // blur
        expect(patches).toEqual([]);

        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(description).toHaveValue('Tighten the headline.');
        expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

        await user.type(description, '\nSecond line');
        await user.click(within(dialog).getByRole('button', { name: 'Save' }));
        await vi.waitFor(() =>
            expect(patches).toEqual([{ description: 'Tighten the headline.\nSecond line' }]),
        );
    });
});

describe('permissions', () => {
    it('read-only for a member who is neither the creator nor the assignee', async () => {
        const { dialog, user } = await openPanel({ role: 'MEMBER', userId: PRIYA });

        expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { level: 3 })).toHaveTextContent(
            serverTask.title,
        );
        expect(within(dialog).getByText('In progress')).toBeInTheDocument();

        await user.tab(); // onto the read-only details
        const details = within(dialog).getByLabelText(
            new RegExp(READ_ONLY_HINT.replace('.', '\\.')),
        );
        details.focus();
        expect(await screen.findByRole('tooltip')).toHaveTextContent(READ_ONLY_HINT);
    });

    it('editable for the assignee', async () => {
        const { dialog } = await openPanel({ role: 'MEMBER', userId: ME });
        expect(within(dialog).getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    });

    it('editable for the creator', async () => {
        const { dialog } = await openPanel({ role: 'MEMBER', userId: CREATOR });
        expect(within(dialog).getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    });

    it('editable for an admin', async () => {
        const { dialog } = await openPanel({ role: 'ADMIN', userId: PRIYA });
        expect(within(dialog).getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
    });
});
