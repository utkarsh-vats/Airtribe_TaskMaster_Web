/*
 * My tasks (step 11): /dashboard/my-tasks lists the tasks assigned to me across projects. The
 * list (Project column, names from the shared projects list), status counts, filters (no
 * Assignee; ?assignee is never sent), search, pagination and states, the task panel
 * (?task + ?project), closing, deleting, and how edits elsewhere refresh it. Like the project
 * list, both layouts are in the DOM (CSS shows one): tests scope to the table (task-table) or
 * the rows (task-rows). The MSW list (tests/msw/myTasks.ts) filters, sorts and pages like the
 * API, so a row on screen proves what was asked for.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { HeaderSearch } from '@/components/shell/HeaderSearch';
import { SidebarNav } from '@/components/shell/SidebarNav';
import { resetSectionsForTests } from '@/components/ui/CollapsibleSection';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { leftProject } from '@/features/members/api';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { MyTasksView } from '@/features/tasks/components/MyTasksView';
import { READ_ONLY_HINT } from '@/features/tasks/components/TaskPanel';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { FILTER_BAR_OPEN_KEY, resetFilterBarOpenForTests } from '@/features/tasks/filterBarOpen';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type {
    Member,
    Project,
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
import { emptyComments } from '../../msw/comments';
import { myTasksList } from '../../msw/myTasks';
import { API_ORIGIN, server } from '../../msw/server';
import { refetchAndFail } from '../../refetch';

const MY = '/dashboard/my-tasks';
const nav = vi.hoisted(() => ({
    pathname: '/dashboard/my-tasks',
    search: '',
    push: vi.fn(),
    replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
    usePathname: () => nav.pathname,
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const api = (path: string) => `${API_ORIGIN}/api/v1${path}`;

const me: User = {
    id: 'u-me',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};
const ME = { id: me.id, name: me.name };
const JONAS = { id: 'u-jonas', name: 'Jonas Weber' };

/** p1: I'm a MEMBER; p2: I'm the OWNER. p3 isn't in my projects list (e.g. I just left it). */
const PROJECTS: Record<string, { name: string; role: ProjectRole }> = {
    p1: { name: 'Website relaunch', role: 'MEMBER' },
    p2: { name: 'Hiring', role: 'OWNER' },
};

const projectDetail = (id: string): ProjectDetail => ({
    id,
    name: PROJECTS[id]?.name ?? id,
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole: PROJECTS[id]?.role ?? 'MEMBER',
    memberCount: 2,
    owner: null,
});
const projectSummary = (id: string): Project => {
    const { owner: _owner, ...summary } = projectDetail(id);
    return summary;
};

let seq = 0;
/** A task assigned to me (the list is "assigned to me"), created `seq` minutes ago. */
const task = (id: string, overrides: Partial<TaskListItem> = {}): TaskListItem => {
    seq += 1;
    return {
        id,
        projectId: 'p1',
        title: `Task ${id}`,
        description: null,
        status: 'OPEN',
        priority: 'MEDIUM',
        dueDate: null,
        completedAt: null,
        createdAt: new Date(Date.UTC(2026, 9, 1) + seq * 60_000).toISOString(),
        updatedAt: '2026-10-10T09:00:00.000Z',
        assignee: ME,
        createdBy: JONAS,
        ...overrides,
    };
};

const detailOf = (row: TaskListItem): Task => ({
    ...row,
    createdBy: { ...row.createdBy, email: `${row.createdBy.id}@taskmaster.app` },
    assignee: row.assignee ? { ...row.assignee, email: `${row.assignee.id}@taskmaster.app` } : null,
    commentCount: 0,
    attachmentCount: 0,
});

const members = (): Member[] => [
    { user: { ...ME, email: me.email, avatarUrl: null }, role: 'MEMBER', joinedAt: me.createdAt },
    {
        user: { ...JONAS, email: 'jonas@taskmaster.app', avatarUrl: null },
        role: 'OWNER',
        joinedAt: me.createdAt,
    },
];

type Calls = {
    /** GET /users/me/tasks queries (the list and the status counts). */
    mine: URLSearchParams[];
    projectLists: number;
    members: string[];
    patches: Record<string, unknown>[];
    deletes: string[];
};

const notFound = () =>
    HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r' } },
        { status: 404 },
    );

/**
 * The API over `store`: My tasks (only those assigned to me), my projects list (p1, p2), each
 * project's detail and members, a task's detail, PATCH (applies the change) and DELETE.
 */
function mockApi(store: TaskListItem[]): Calls {
    const calls: Calls = { mine: [], projectLists: 0, members: [], patches: [], deletes: [] };
    server.use(
        myTasksList(store, me.id, calls.mine),
        http.get(api('/projects'), ({ request }) => {
            calls.projectLists += 1;
            const limit = Number(new URL(request.url).searchParams.get('limit') ?? 20);
            const data = Object.keys(PROJECTS).map(projectSummary);
            return HttpResponse.json({
                data,
                meta: { page: 1, limit, total: data.length, totalPages: 1 },
            });
        }),
        http.get(api('/projects/:pid'), ({ params }) =>
            PROJECTS[String(params.pid)]
                ? HttpResponse.json({ data: projectDetail(String(params.pid)) })
                : notFound(),
        ),
        http.get(api('/projects/:pid/members'), ({ params }) => {
            calls.members.push(String(params.pid));
            return HttpResponse.json({ data: members() });
        }),
        http.get(api('/projects/:pid/tasks/:tid'), ({ params }) => {
            const row = store.find((t) => t.id === params.tid && t.projectId === params.pid);
            return row ? HttpResponse.json({ data: detailOf(row) }) : notFound();
        }),
        http.patch(api('/projects/:pid/tasks/:tid'), async ({ params, request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            calls.patches.push(body);
            const index = store.findIndex((t) => t.id === params.tid);
            const row = store[index];
            if (!row) return notFound();
            const updated: TaskListItem = {
                ...row,
                ...(typeof body.status === 'string'
                    ? { status: body.status as TaskListItem['status'] }
                    : {}),
                ...('assigneeId' in body
                    ? {
                          assignee:
                              members().find((m) => m.user.id === body.assigneeId)?.user ?? null,
                      }
                    : {}),
                updatedAt: new Date().toISOString(),
            };
            if (updated.assignee) {
                updated.assignee = { id: updated.assignee.id, name: updated.assignee.name };
            }
            store[index] = updated;
            return HttpResponse.json({ data: detailOf(updated) });
        }),
        http.delete(api('/projects/:pid/tasks/:tid'), ({ params }) => {
            calls.deletes.push(String(params.tid));
            const index = store.findIndex((t) => t.id === params.tid);
            if (index < 0) return notFound();
            store.splice(index, 1);
            return new HttpResponse(null, { status: 204 });
        }),
        // The panel's comments and files (thread.test.tsx / list.test.tsx cover them).
        emptyComments('p1'),
        emptyComments('p2'),
        emptyAttachments('p1'),
        emptyAttachments('p2'),
        // The sidebar's Invitations badge.
        http.get(api('/users/me/invitations'), () => HttpResponse.json({ data: [] })),
    );
    return calls;
}

/** The list's own requests (limit=25); the status counts ask for limit=1. */
const listRequests = (calls: Calls) => calls.mine.filter((q) => q.get('limit') === '25');
const countRequests = (calls: Calls) => calls.mine.filter((q) => q.get('limit') === '1');

let client: QueryClient;
let urlPush: MockInstance<(url: string) => void>;
let urlReplace: MockInstance<(url: string) => void>;
let historyBack: MockInstance<() => void>;

/** My tasks at `?search` (optionally with the sidebar, as on the real page). */
function renderMyTasks(search = '', { sidebar = false }: { sidebar?: boolean } = {}) {
    nav.pathname = MY;
    nav.search = search;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (): ReactNode => (
        <QueryClientProvider client={client}>
            <TooltipProvider>
                {sidebar && <SidebarNav />}
                <MyTasksView />
            </TooltipProvider>
        </QueryClientProvider>
    );
    const result = render(ui());
    return {
        user: userEvent.setup(),
        /** Play the browser: the URL now has `next`. */
        navigate(next: string) {
            nav.search = next;
            result.rerender(ui());
        },
    };
}

const table = () => screen.getByTestId('task-table');
const rowsList = () => screen.getByTestId('task-rows');
const tableRow = (title: string) => within(table()).getByRole('row', { name: title });
const tableTitles = () =>
    within(table())
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.getAttribute('aria-label'));
const filterRow = () => screen.getByTestId('filter-row');
/** A table row, once the list has loaded (the skeleton shows until then). */
const findRow = async (title: string) =>
    within(await screen.findByTestId('task-table')).findByRole('row', { name: title });
const panel = (projectName: string) =>
    screen.findByRole('dialog', { name: `${projectName} / Task` });
/** The panel shows `title` (an editable task: in the Title box). */
const expectTitle = (dialog: HTMLElement, title: string) =>
    vi.waitFor(() =>
        expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue(title),
    );

beforeEach(() => {
    seq = 0;
    nav.push.mockClear();
    nav.replace.mockClear();
    sessionStore.reset();
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    resetFilterBarOpenForTests();
    resetSectionsForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    urlReplace = vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    vi.mocked(toast).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

// ── the list ─────────────────────────────────────────────────────────────────────────

describe('the list', () => {
    const store = () => [
        task('t1', { projectId: 'p1', title: 'Finalise homepage hero copy' }),
        task('t2', { projectId: 'p2', title: 'Shortlist designers' }),
        task('t3', { projectId: 'p3', title: 'Left-behind task' }),
    ];

    it('tasks from two projects: a Project column with their names, no Assignee column', async () => {
        mockApi(store());
        renderMyTasks();

        await findRow('Shortlist designers');
        const headers = within(table())
            .getAllByRole('columnheader')
            .map((th) => th.textContent);
        expect(headers).toEqual(['Task', 'Status', 'Priority', 'Project', 'Due']);
        expect(headers).not.toContain('Assignee');

        await vi.waitFor(() =>
            expect(tableRow('Finalise homepage hero copy')).toHaveTextContent('Website relaunch'),
        );
        expect(tableRow('Shortlist designers')).toHaveTextContent('Hiring');
        // A project that isn't in my projects list: no name to show.
        expect(within(tableRow('Left-behind task')).getByText('—')).toBeInTheDocument();
    });

    it('below 820px the rows show the project too', async () => {
        mockApi(store());
        renderMyTasks();

        const rows = await within(await screen.findByTestId('task-rows')).findAllByRole('listitem');
        expect(rows).toHaveLength(3);
        await vi.waitFor(() =>
            expect(within(rowsList()).getByText('Website relaunch')).toBeInTheDocument(),
        );
        expect(within(rowsList()).getByText('Hiring')).toBeInTheDocument();
        expect(within(rowsList()).getByText('—')).toBeInTheDocument();
    });

    it('the projects list is requested once — the same query as the sidebar’s', async () => {
        const calls = mockApi(store());
        renderMyTasks('', { sidebar: true });

        await findRow('Shortlist designers');
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
        expect(calls.projectLists).toBe(1);
        // And the sidebar lists the same projects.
        expect(
            within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
                name: /Website relaunch/,
            }),
        ).toBeInTheDocument();
    });

    it('status counts come from /users/me/tasks, limit=1 per status, with the other filters', async () => {
        const calls = mockApi([
            task('t1', { status: 'OPEN', priority: 'HIGH' }),
            task('t2', { status: 'IN_PROGRESS', priority: 'HIGH' }),
            task('t3', { status: 'COMPLETED', priority: 'HIGH' }),
            task('t4', { status: 'OPEN', priority: 'LOW' }),
        ]);
        renderMyTasks('priority=HIGH');

        const segment = (name: RegExp) => screen.getByRole('radio', { name });
        await vi.waitFor(() => expect(segment(/^All/).closest('label')).toHaveTextContent('All3'));
        expect(segment(/To do/).closest('label')).toHaveTextContent('To do1');
        expect(segment(/In progress/).closest('label')).toHaveTextContent('In progress1');
        expect(segment(/Done/).closest('label')).toHaveTextContent('Done1');

        const counts = countRequests(calls);
        expect(counts).toHaveLength(4);
        expect(counts.map((q) => q.get('status') ?? 'ALL').sort()).toEqual(
            ['ALL', 'COMPLETED', 'IN_PROGRESS', 'OPEN'].sort(),
        );
        for (const q of counts) {
            expect(q.get('priority')).toBe('HIGH');
            expect(q.has('page')).toBe(false);
        }
    });
});

// ── filters ──────────────────────────────────────────────────────────────────────────

describe('filters', () => {
    const openRow = () => localStorage.setItem(FILTER_BAR_OPEN_KEY, 'true');

    it('priority, created by, due and overdue write the URL; the request follows it', async () => {
        openRow();
        const calls = mockApi([task('t1')]);
        const view = renderMyTasks();
        await findRow('Task t1');

        await view.user.click(within(filterRow()).getByRole('button', { name: 'Any priority' }));
        await view.user.click(screen.getByRole('checkbox', { name: 'High' }));
        expect(urlPush).toHaveBeenLastCalledWith(`${MY}?priority=HIGH`);
        await view.user.keyboard('{Escape}');

        await view.user.selectOptions(
            within(filterRow()).getByRole('combobox', { name: 'Created by' }),
            'me',
        );
        expect(urlPush).toHaveBeenLastCalledWith(`${MY}?createdBy=me`);

        fireEvent.change(within(filterRow()).getByLabelText('Due from'), {
            target: { value: '2026-11-01' },
        });
        expect(urlPush).toHaveBeenLastCalledWith(`${MY}?dueFrom=2026-11-01`);

        await view.user.click(within(filterRow()).getByRole('checkbox', { name: 'Overdue only' }));
        expect(urlPush).toHaveBeenLastCalledWith(`${MY}?overdue=true`);

        // The URL is the state: the request carries what it says.
        view.navigate(
            'priority=HIGH&createdBy=me&dueFrom=2026-11-01&dueTo=2026-11-30&overdue=true',
        );
        await vi.waitFor(() => expect(listRequests(calls).at(-1)?.get('createdBy')).toBe('me'));
        const last = listRequests(calls).at(-1) as URLSearchParams;
        expect(last.get('priority')).toBe('HIGH');
        // The URL's inclusive days become the API's exclusive instants (the suite runs in UTC).
        expect(last.get('dueAfter')).toBe('2026-10-31T23:59:59.999Z');
        expect(last.get('dueBefore')).toBe('2026-12-01T00:00:00.000Z');
        expect(last.has('dueFrom')).toBe(false);
        expect(last.get('overdue')).toBe('true');
    });

    // Values the URL parser keeps (parseTaskFilters accepts me, unassigned or a uuid), so it's
    // useMyTasks / useMyTaskStatusCounts that must keep them out of the request.
    it.each([
        ['me', 'me'],
        ['a user id', '3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c'],
    ])(
        '?assignee=%s in the URL is never sent: no 422, the list and its counts load',
        async (_, value) => {
            const calls = mockApi([task('t1', { title: 'Mine anyway' })]);
            renderMyTasks(`assignee=${value}&priority=MEDIUM`);

            expect(await findRow('Mine anyway')).toBeVisible();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            await vi.waitFor(() => expect(countRequests(calls)).toHaveLength(4));
            await vi.waitFor(() =>
                expect(
                    screen.getByRole('radio', { name: /^All/ }).closest('label'),
                ).toHaveTextContent('All1'),
            );

            // Every request that went out: the list (limit=25) and the four counts (limit=1).
            expect(listRequests(calls).length).toBeGreaterThan(0);
            for (const q of [...listRequests(calls), ...countRequests(calls)]) {
                expect(q.has('assignee')).toBe(false);
                expect(q.get('priority')).toBe('MEDIUM');
            }
            expect(calls.mine).toHaveLength(listRequests(calls).length + 4);
        },
    );

    it('the filter row has no Assignee field; Created by offers only Anyone and Me; no members request', async () => {
        openRow();
        const calls = mockApi([task('t1')]);
        renderMyTasks();
        await findRow('Task t1');

        expect(within(filterRow()).queryByRole('combobox', { name: 'Assignee' })).toBeNull();
        const createdBy = within(filterRow()).getByRole('combobox', { name: 'Created by' });
        expect(
            within(createdBy)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Anyone', 'Me']);
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
        expect(calls.members).toEqual([]);
    });

    it('the "Created by: Me" chip reads "Me"; Clear filters resets', async () => {
        const calls = mockApi([task('t1')]);
        const view = renderMyTasks('createdBy=me&overdue=true&page=2');
        await vi.waitFor(() => expect(listRequests(calls)).toHaveLength(1));

        // The row is closed by default: active filters show as chips.
        expect(await screen.findByText('Created by: Me')).toBeInTheDocument();
        expect(screen.getByText('Overdue')).toBeInTheDocument();

        await view.user.click(screen.getByRole('button', { name: 'Clear all' }));
        expect(urlPush).toHaveBeenLastCalledWith(MY);
    });

    it('the Filters sheet (below 820px) works the same: no Assignee, Created by → the URL', async () => {
        const calls = mockApi([task('t1')]);
        const view = renderMyTasks();
        await findRow('Task t1');

        await view.user.click(screen.getByTestId('filter-sheet-button'));
        const sheet = await screen.findByRole('dialog', { name: 'Filters' });
        expect(within(sheet).queryByRole('combobox', { name: 'Assignee' })).toBeNull();
        const createdBy = within(sheet).getByRole('combobox', { name: 'Created by' });
        expect(
            within(createdBy)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Anyone', 'Me']);

        await view.user.selectOptions(createdBy, 'me');
        expect(urlPush).toHaveBeenLastCalledWith(`${MY}?createdBy=me`);
        await view.user.click(within(sheet).getByRole('checkbox', { name: 'Overdue only' }));
        expect(urlPush).toHaveBeenLastCalledWith(`${MY}?overdue=true`);
        expect(calls.members).toEqual([]);
    });
});

// ── search ───────────────────────────────────────────────────────────────────────────

describe('search', () => {
    it('the search field (below 820px) sets ?q, replacing the history entry', async () => {
        const calls = mockApi([task('t1', { title: 'Hero copy' })]);
        const view = renderMyTasks('page=2');
        await vi.waitFor(() => expect(listRequests(calls)).toHaveLength(1));

        const box = within(screen.getByTestId('task-toolbar')).getByRole('searchbox', {
            name: 'Search tasks',
        });
        await view.user.type(box, 'hero');

        await vi.waitFor(() => expect(urlReplace).toHaveBeenLastCalledWith(`${MY}?q=hero`));
        view.navigate('q=hero');
        await vi.waitFor(() => expect(listRequests(calls).at(-1)?.get('q')).toBe('hero'));
        expect(await findRow('Hero copy')).toBeVisible();
    });

    it('the header search on /dashboard/my-tasks sets ?q in place (filters kept, page reset)', async () => {
        nav.pathname = MY;
        nav.search = 'priority=HIGH&page=3';
        const u = userEvent.setup();
        render(<HeaderSearch />);

        await u.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'redirects{Enter}');

        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${MY}?priority=HIGH&q=redirects`);
        expect(nav.push).not.toHaveBeenCalled();
    });
});

// ── pages and states ─────────────────────────────────────────────────────────────────

describe('pages and states', () => {
    it('25 a page; Next goes to page 2', async () => {
        const calls = mockApi(Array.from({ length: 30 }, (_, i) => task(`t${i + 1}`)));
        const view = renderMyTasks();
        await findRow('Task t30');
        expect(tableTitles()).toHaveLength(25);

        await view.user.click(screen.getByRole('button', { name: /Next/ }));
        expect(urlPush).toHaveBeenLastCalledWith(`${MY}?page=2`);

        view.navigate('page=2');
        await vi.waitFor(() => expect(tableTitles()).toHaveLength(5));
        expect(listRequests(calls).at(-1)?.get('page')).toBe('2');
        // Newest first (the API's default): page 2 holds the oldest.
        expect(tableTitles()).toEqual(['Task t5', 'Task t4', 'Task t3', 'Task t2', 'Task t1']);
    });

    it('nothing assigned: its own empty state, and no New task button', async () => {
        mockApi([task('t1', { assignee: JONAS })]);
        renderMyTasks();

        expect(
            await screen.findByRole('heading', { name: 'Nothing assigned to you' }),
        ).toBeVisible();
        expect(
            screen.getByText('Tasks assigned to you across all projects will show up here.'),
        ).toBeVisible();
        expect(screen.queryByRole('button', { name: /New task/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /New task/ })).not.toBeInTheDocument();
    });

    it('no match: "No tasks match" with Clear filters', async () => {
        mockApi([task('t1')]);
        const view = renderMyTasks('q=zzz');

        expect(await screen.findByRole('heading', { name: 'No tasks match' })).toBeVisible();
        await view.user.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(urlPush).toHaveBeenLastCalledWith(MY);
    });

    it('a page past the end: "Nothing on this page" with a link to the first', async () => {
        mockApi([task('t1')]);
        renderMyTasks('page=5');

        expect(await screen.findByRole('heading', { name: 'Nothing on this page' })).toBeVisible();
        expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
            'href',
            MY,
        );
    });

    it('loading: the table skeleton', () => {
        mockApi([]);
        server.use(
            http.get(api('/users/me/tasks'), async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        renderMyTasks();

        expect(screen.getByRole('table', { name: 'Loading tasks' })).toBeInTheDocument();
    });

    it('error, then Try again', async () => {
        let fail = true;
        mockApi([task('t1', { title: 'Back again' })]);
        server.use(
            // Failing until told otherwise; then nothing is returned, so the request falls
            // through to the normal My tasks handler.
            http.get(api('/users/me/tasks'), () =>
                fail
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                          { status: 500 },
                      )
                    : undefined,
            ),
        );
        const view = renderMyTasks();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load tasks");
        fail = false;
        await view.user.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await findRow('Back again')).toBeVisible();
    });

    it('a background refetch that fails keeps the rows (no error state)', async () => {
        mockApi([task('t1', { title: 'Still here' })]);
        renderMyTasks();
        await findRow('Still here');

        server.use(
            http.get(api('/users/me/tasks'), () =>
                HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                ),
            ),
        );
        await refetchAndFail(client, queryKeys.tasks.mine({ page: 1, limit: 25 }));

        expect(tableRow('Still here')).toBeVisible();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

// ── the task panel ───────────────────────────────────────────────────────────────────

describe('the task panel', () => {
    it('clicking a row sets ?task & ?project and opens that task under its project', async () => {
        mockApi([
            task('t1', { projectId: 'p1', title: 'Finalise homepage hero copy' }),
            task('t2', { projectId: 'p2', title: 'Shortlist designers' }),
        ]);
        const view = renderMyTasks('priority=MEDIUM');
        await findRow('Shortlist designers');

        await view.user.click(tableRow('Shortlist designers'));
        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${MY}?priority=MEDIUM&task=t2&project=p2`);

        view.navigate('priority=MEDIUM&task=t2&project=p2');
        const dialog = await panel('Hiring');
        await expectTitle(dialog, 'Shortlist designers');
    });

    it('a MEMBER’s task they can no longer edit (reassigned meanwhile) shows the read-only hint', async () => {
        const store = [task('t1', { projectId: 'p1', title: 'Finalise homepage hero copy' })];
        mockApi(store);
        // Since the list loaded, it was given to Jonas; Jonas created it; I'm a MEMBER of p1.
        server.use(
            http.get(api('/projects/p1/tasks/t1'), () =>
                HttpResponse.json({
                    data: detailOf({ ...(store[0] as TaskListItem), assignee: JONAS }),
                }),
            ),
        );
        renderMyTasks('task=t1&project=p1');

        const dialog = await panel('Website relaunch');
        expect(
            await within(dialog).findByLabelText(`Task details. ${READ_ONLY_HINT}`),
        ).toBeInTheDocument();
    });

    it('a pasted URL (?task & ?project) opens the panel directly', async () => {
        mockApi([task('t2', { projectId: 'p2', title: 'Shortlist designers' })]);
        renderMyTasks('task=t2&project=p2');

        const dialog = await panel('Hiring');
        await expectTitle(dialog, 'Shortlist designers');
    });

    it('?task without ?project stays closed', async () => {
        mockApi([task('t1')]);
        renderMyTasks('task=t1');

        await findRow('Task t1');
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('closing the panel', () => {
    it('opened by a click: closing goes Back — to the URL without task and project', async () => {
        mockApi([task('t2', { projectId: 'p2', title: 'Shortlist designers' })]);
        const view = renderMyTasks();
        await findRow('Shortlist designers');
        await view.user.click(tableRow('Shortlist designers'));
        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${MY}?task=t2&project=p2`);
        view.navigate('task=t2&project=p2');
        const dialog = await panel('Hiring');

        await view.user.click(within(dialog).getByRole('button', { name: 'Close' }));

        // Back returns to the entry the click pushed from, which had neither.
        expect(historyBack).toHaveBeenCalledOnce();
        expect(urlReplace).not.toHaveBeenCalled();
        expect(urlPush).toHaveBeenCalledOnce();
    });

    it('opened from a direct URL: closing replaces it with one that has neither (other params kept)', async () => {
        mockApi([task('t2', { projectId: 'p2', title: 'Shortlist designers' })]);
        const view = renderMyTasks('priority=MEDIUM&task=t2&project=p2');
        const dialog = await panel('Hiring');
        await expectTitle(dialog, 'Shortlist designers');

        await view.user.click(within(dialog).getByRole('button', { name: 'Close' }));

        expect(historyBack).not.toHaveBeenCalled();
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(`${MY}?priority=MEDIUM`);
    });

    it('"Task not found" → Close leaves neither task nor project', async () => {
        mockApi([task('t2', { projectId: 'p2' })]);
        const view = renderMyTasks('task=gone&project=p2');
        const dialog = await panel('Hiring');

        await within(dialog).findByRole('heading', { name: 'Task not found' });
        const closes = within(dialog).getAllByRole('button', { name: 'Close' });
        // The empty state's own Close (the header X is "Close" too).
        await view.user.click(closes.at(-1) as HTMLElement);

        expect(urlReplace).toHaveBeenLastCalledWith(MY);
    });
});

describe('deleting from the panel', () => {
    it('the only task on page 2: lands on page 1 without task or project; the row goes', async () => {
        // 26 tasks: page 2 holds only the oldest, t1 — in p2, where I'm the OWNER.
        const store = Array.from({ length: 26 }, (_, i) =>
            task(`t${i + 1}`, { projectId: 'p2', title: `Hiring task ${i + 1}` }),
        );
        const calls = mockApi(store);
        const view = renderMyTasks('page=2&task=t1&project=p2');
        await findRow('Hiring task 1');
        const dialog = await panel('Hiring');
        await expectTitle(dialog, 'Hiring task 1');

        await view.user.click(await within(dialog).findByRole('button', { name: /Delete task/ }));
        const confirm = await screen.findByRole('dialog', { name: 'Delete this task?' });
        await view.user.click(within(confirm).getByRole('button', { name: 'Delete task' }));

        await vi.waitFor(() => expect(calls.deletes).toEqual(['t1']));
        // Opened from the URL: no entry of ours to go back to — replaced with page 1.
        await vi.waitFor(() => expect(urlReplace).toHaveBeenLastCalledWith(MY));
        expect(screen.queryByRole('row', { name: 'Hiring task 1' })).not.toBeInTheDocument();

        // The browser follows: page 1, the 25 remaining tasks, no panel.
        view.navigate('');
        await findRow('Hiring task 26');
        await vi.waitFor(() => expect(tableTitles()).toHaveLength(25));
        expect(screen.queryByRole('row', { name: 'Hiring task 1' })).not.toBeInTheDocument();
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});

describe('keeping My tasks up to date', () => {
    it('changing the status in the panel updates the row', async () => {
        mockApi([task('t2', { projectId: 'p2', title: 'Shortlist designers', status: 'OPEN' })]);
        const view = renderMyTasks('task=t2&project=p2');
        await findRow('Shortlist designers');
        expect(tableRow('Shortlist designers')).toHaveTextContent('To do');
        const dialog = await panel('Hiring');

        const status = await within(dialog).findByRole('combobox', { name: 'Status' });
        await vi.waitFor(() => expect(status).toBeEnabled());
        await view.user.selectOptions(status, 'COMPLETED');

        await vi.waitFor(() => expect(tableRow('Shortlist designers')).toHaveTextContent('Done'));
    });

    it('reassigning it to someone else drops it from the list after the refetch', async () => {
        const calls = mockApi([
            task('t1', { projectId: 'p2', title: 'Keep me' }),
            task('t2', { projectId: 'p2', title: 'Give away' }),
        ]);
        const view = renderMyTasks('task=t2&project=p2');
        await findRow('Give away');
        const dialog = await panel('Hiring');
        const before = listRequests(calls).length;

        const assignee = await within(dialog).findByRole('combobox', { name: 'Assignee' });
        await within(assignee).findByRole('option', { name: JONAS.name });
        await view.user.selectOptions(assignee, JONAS.id);

        await vi.waitFor(() => expect(calls.patches).toEqual([{ assigneeId: JONAS.id }]));
        await vi.waitFor(() => expect(listRequests(calls).length).toBeGreaterThan(before));
        await vi.waitFor(() =>
            expect(within(table()).queryByRole('row', { name: 'Give away' })).toBeNull(),
        );
        expect(tableRow('Keep me')).toBeVisible();
    });

    it('leaving a project (leftProject) refreshes My tasks', async () => {
        const store = [
            task('t1', { projectId: 'p1', title: 'From the project I leave' }),
            task('t2', { projectId: 'p2', title: 'Stays' }),
        ];
        const calls = mockApi(store);
        renderMyTasks();
        await findRow('From the project I leave');
        const before = listRequests(calls).length;

        // Left p1: its tasks are unassigned from me server-side.
        (store[0] as TaskListItem).assignee = null;
        const router = { push: vi.fn() };
        act(() => leftProject(client, router, 'p1'));

        expect(router.push).toHaveBeenCalledWith('/dashboard/projects');
        await vi.waitFor(() => expect(listRequests(calls).length).toBeGreaterThan(before));
        await vi.waitFor(() =>
            expect(
                within(table()).queryByRole('row', { name: 'From the project I leave' }),
            ).toBeNull(),
        );
        expect(tableRow('Stays')).toBeVisible();
    });
});

// ── regressions ──────────────────────────────────────────────────────────────────────

describe('a project’s task list (regression)', () => {
    it('its filter row still has Assignee, and loads the project’s members', async () => {
        localStorage.setItem(FILTER_BAR_OPEN_KEY, 'true');
        const calls = mockApi([]);
        server.use(
            http.get(api('/projects/p1/tasks'), ({ request }) => {
                const limit = Number(new URL(request.url).searchParams.get('limit') ?? 25);
                return HttpResponse.json({
                    data: [task('t1', { title: 'Project task' })],
                    meta: { page: 1, limit, total: 1, totalPages: 1 },
                });
            }),
        );
        nav.pathname = '/dashboard/projects/p1/tasks';
        nav.search = '';
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const project = projectDetail('p1');
        render(
            <QueryClientProvider client={client}>
                <TooltipProvider>
                    <ProjectContext
                        value={{
                            project,
                            myRole: project.myRole,
                            can: bindPermissions(project.myRole, me.id),
                        }}
                    >
                        <TaskListView />
                    </ProjectContext>
                </TooltipProvider>
            </QueryClientProvider>,
        );

        await findRow('Project task');
        const assignee = within(filterRow()).getByRole('combobox', { name: 'Assignee' });
        await within(assignee).findByRole('option', { name: JONAS.name });
        expect(calls.members).toContain('p1');
        // And the project list keeps its Assignee column.
        expect(
            within(screen.getByTestId('task-table'))
                .getAllByRole('columnheader')
                .map((th) => th.textContent),
        ).toContain('Assignee');
    });
});
