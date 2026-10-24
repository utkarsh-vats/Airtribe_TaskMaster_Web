/*
 * The board (?view=board): one query per status column, cards that open the task panel, and
 * the per-column states. Like the list, both breakpoints share one markup here (jsdom ignores
 * the CSS), so tests scope to a column by its heading.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { FILTER_BAR_OPEN_KEY, resetFilterBarOpenForTests } from '@/features/tasks/filterBarOpen';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type { ProjectDetail, Task, TaskListItem, TaskStatus, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';

import { API_ORIGIN, server } from '../../msw/server';

const PATH = '/dashboard/projects/p1/tasks';
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

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

const project: ProjectDetail = {
    id: 'p1',
    name: 'Website relaunch',
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole: 'OWNER',
    memberCount: 3,
    owner: null,
};

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const task = (id: string, overrides: Partial<TaskListItem> = {}): TaskListItem => ({
    id,
    projectId: 'p1',
    title: `Task ${id}`,
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    dueDate: null,
    completedAt: null,
    createdAt: '2026-10-10T09:00:00.000Z',
    updatedAt: '2026-10-10T09:00:00.000Z',
    assignee: null,
    createdBy: { id: 'u1', name: 'Mara Okafor' },
    ...overrides,
});

const heroCopy = task('t3', {
    title: 'Finalise homepage hero copy',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    dueDate: days(3),
});

const COLUMNS: Record<TaskStatus, TaskListItem[]> = {
    OPEN: [
        task('t1', {
            title: 'Set up 301 redirects',
            priority: 'URGENT',
            dueDate: days(-3),
            assignee: { id: 'u1', name: 'Mara Okafor' },
        }),
        task('t2', { title: 'Write launch email', priority: 'LOW' }),
    ],
    IN_PROGRESS: [heroCopy],
    COMPLETED: [],
};

const apiError = (status: number) =>
    HttpResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Server error', requestId: 'r' } },
        { status },
    );

type ColumnMock = { items?: TaskListItem[]; total?: number; fail?: boolean };

/**
 * GET tasks: board columns (limit=100) per status, plus anything else the page asks for.
 * Records every query string.
 */
function mockBoard(columns: Partial<Record<TaskStatus, ColumnMock>> = {}) {
    const requests: string[] = [];
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () => HttpResponse.json({ data: [] })),
        http.get(tasksUrl, ({ request }) => {
            const url = new URL(request.url);
            requests.push(url.search);
            const status = url.searchParams.get('status') as TaskStatus | null;
            const mock = status ? columns[status] : undefined;
            if (mock?.fail) return apiError(500);
            const items = mock?.items ?? (status ? COLUMNS[status] : []);
            const total = mock?.total ?? items.length;
            return HttpResponse.json({
                data: items,
                meta: { page: 1, limit: 100, total, totalPages: Math.ceil(total / 100) },
            });
        }),
    );
    return requests;
}

function renderView(search: string) {
    nav.search = search;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <ProjectContext
                    value={{ project, myRole: 'OWNER', can: bindPermissions('OWNER', user.id) }}
                >
                    <TaskListView />
                </ProjectContext>
            </TooltipProvider>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const column = (label: string) => screen.getByRole('region', { name: label });
const boardRequests = (requests: string[]) => requests.filter((r) => r.includes('limit=100'));

let urlPush: MockInstance<(url: string) => void>;

beforeEach(() => {
    resetFilterBarOpenForTests();
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    sessionStore.reset();
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
});
afterEach(() => resetRefreshForTests());

describe('view switch', () => {
    it('Board writes view=board, keeping the filters and dropping the page', async () => {
        mockBoard();
        const u = renderView('status=OPEN&q=hero&page=3');
        const view = screen.getByRole('radiogroup', { name: 'View' });
        expect(within(view).getByRole('radio', { name: 'List' })).toBeChecked();

        await u.click(within(view).getByRole('radio', { name: 'Board' }));

        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?status=OPEN&q=hero&view=board`);
    });

    it('List removes view, keeping the filters', async () => {
        mockBoard();
        const u = renderView('q=hero&priority=HIGH&view=board');
        const view = screen.getByRole('radiogroup', { name: 'View' });
        expect(within(view).getByRole('radio', { name: 'Board' })).toBeChecked();

        await u.click(within(view).getByRole('radio', { name: 'List' }));

        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?q=hero&priority=HIGH`);
    });
});

describe('column queries', () => {
    it('one request per status with limit=100 and the other filters; no URL status, page or list queries', async () => {
        const requests = mockBoard();
        renderView('status=COMPLETED&q=hero&priority=URGENT,HIGH&sort=title&page=2&view=board');

        await within(await screen.findByRole('region', { name: 'To do' })).findByText(
            'Set up 301 redirects',
        );
        await within(column('Done')).findByText('No tasks');

        // Only the three columns: no 25-row list page and no limit=1 status counts.
        expect(requests).toHaveLength(3);
        const sent = boardRequests(requests).map((search) => new URLSearchParams(search));
        expect(sent.map((params) => params.getAll('status'))).toEqual([
            ['OPEN'],
            ['IN_PROGRESS'],
            ['COMPLETED'],
        ]);
        for (const params of sent) {
            expect(params.get('limit')).toBe('100');
            expect(params.get('q')).toBe('hero');
            expect(params.get('priority')).toBe('URGENT,HIGH');
            expect(params.get('sort')).toBe('title');
            expect(params.has('page')).toBe(false);
        }
    });
});

describe('columns and cards', () => {
    it('show each column with its count, and cards with priority, title, due and assignee', async () => {
        mockBoard({ OPEN: { items: COLUMNS.OPEN, total: 2 } });
        renderView('view=board');

        const todo = await screen.findByRole('region', { name: 'To do' });
        await within(todo).findByText('Set up 301 redirects');
        expect(within(todo).getByRole('heading', { name: 'To do' })).toBeInTheDocument();
        expect(within(todo).getByText('2')).toBeInTheDocument();

        const [overdueCard] = within(todo).getAllByRole('link');
        if (!overdueCard) throw new Error('no card');
        expect(within(overdueCard).getByText('Urgent')).toBeInTheDocument();
        expect(within(overdueCard).getByText(/^Overdue · /)).toHaveClass(
            'font-bold',
            'text-danger',
        );
        expect(within(overdueCard).getByRole('img', { name: 'Mara Okafor' })).toHaveTextContent(
            'MO',
        );

        // No assignee: no avatar. Not overdue: plain due text.
        const unassigned = within(todo).getByRole('link', { name: /Write launch email/ });
        expect(within(unassigned).queryByRole('img')).not.toBeInTheDocument();
        expect(within(unassigned).getByText('No date')).toBeInTheDocument();

        const doing = column('In progress');
        const due = await within(doing).findByText(/^[A-Z][a-z]{2} \d+/);
        expect(due).not.toHaveClass('text-danger');
        expect(within(doing).getByText('High')).toBeInTheDocument();
    });

    it('a click or Enter on a card opens ?task, keeping the other params', async () => {
        mockBoard();
        const u = renderView('q=hero&view=board');

        const card = await screen.findByRole('link', { name: /Set up 301 redirects/ });
        expect(card).toHaveAttribute('href', `${PATH}?q=hero&view=board&task=t1`);

        await u.click(card);
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?q=hero&view=board&task=t1`);

        urlPush.mockClear();
        const other = screen.getByRole('link', { name: /Finalise homepage hero copy/ });
        other.focus();
        await u.keyboard('{Enter}');
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?q=hero&view=board&task=t3`);
    });

    it('a modified click leaves the card to the browser (new tab)', async () => {
        mockBoard();
        renderView('view=board');

        const card = await screen.findByRole('link', { name: /Set up 301 redirects/ });
        fireEvent.click(card, { ctrlKey: true });

        expect(urlPush).not.toHaveBeenCalled();
    });

    it('?task opens the panel over the board', async () => {
        mockBoard();
        server.use(
            http.get(`${API_ORIGIN}/api/v1/projects/p1`, () =>
                HttpResponse.json({ data: project }),
            ),
            http.get(`${tasksUrl}/t3`, () =>
                HttpResponse.json({
                    data: {
                        ...heroCopy,
                        assignee: null,
                        createdBy: { id: 'u1', name: 'Mara Okafor', email: user.email },
                        commentCount: 0,
                        attachmentCount: 0,
                    } satisfies Task,
                }),
            ),
        );
        renderView('view=board&task=t3');

        const panel = await screen.findByRole('dialog', { name: 'Website relaunch / Task' });
        expect(within(panel).getByRole('textbox', { name: 'Title' })).toHaveValue(
            'Finalise homepage hero copy',
        );
        expect(screen.getByTestId('task-board')).toBeInTheDocument();
    });
});

describe('column states', () => {
    it('shows three skeleton cards per column while loading', () => {
        mockBoard();
        renderView('view=board');

        for (const label of ['To do', 'In progress', 'Done']) {
            const col = column(label);
            expect(within(col).getByText(`Loading ${label} tasks…`)).toBeInTheDocument();
            expect(col.querySelectorAll('.card')).toHaveLength(3);
            expect(within(col).getByText('–')).toBeInTheDocument();
        }
    });

    it('shows "No tasks" in an empty column', async () => {
        mockBoard();
        renderView('view=board');

        const done = column('Done');
        expect(await within(done).findByText('No tasks')).toBeInTheDocument();
        expect(within(done).getByText('0')).toBeInTheDocument();
    });

    it('an error stays in its column, and Try again reloads just that column', async () => {
        const requests = mockBoard({ IN_PROGRESS: { fail: true } });
        const u = renderView('view=board');

        const doing = column('In progress');
        expect(await within(doing).findByRole('alert')).toHaveTextContent("Couldn't load tasks");
        // The other columns still load.
        expect(
            await within(column('To do')).findByText('Set up 301 redirects'),
        ).toBeInTheDocument();

        mockBoard();
        requests.length = 0;
        await u.click(within(doing).getByRole('button', { name: 'Try again' }));

        expect(await within(doing).findByText('Finalise homepage hero copy')).toBeInTheDocument();
        expect(within(doing).queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('100+ guard', () => {
    it('says "Showing 100 of N" and links to that status in the list, keeping the filters', async () => {
        const hundred = Array.from({ length: 100 }, (_, i) => task(`o${i}`));
        mockBoard({ OPEN: { items: hundred, total: 250 } });
        const u = renderView('q=hero&priority=HIGH&view=board');

        const todo = column('To do');
        expect(await within(todo).findByText('Showing 100 of 250')).toBeInTheDocument();
        const link = within(todo).getByRole('link', { name: 'See all in the list' });
        expect(link).toHaveAttribute('href', `${PATH}?status=OPEN&q=hero&priority=HIGH`);

        await u.click(link);
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?status=OPEN&q=hero&priority=HIGH`);

        // Columns within the limit have no footer.
        await within(column('In progress')).findByText('Finalise homepage hero copy');
        expect(within(column('In progress')).queryByText(/^Showing/)).not.toBeInTheDocument();
    });
});

describe('board toolbar', () => {
    it('hides the status segmented control, the task count and pagination', async () => {
        const hundred = Array.from({ length: 100 }, (_, i) => task(`o${i}`));
        mockBoard({ OPEN: { items: hundred, total: 250 } });
        localStorage.setItem(FILTER_BAR_OPEN_KEY, 'true');
        renderView('status=OPEN&view=board');

        await within(column('To do')).findByText('Showing 100 of 250');
        expect(screen.queryByRole('radiogroup', { name: 'Status' })).not.toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/^\d+ tasks?$/)).not.toBeInTheDocument();
        // A URL status isn't a board filter, so there's nothing to clear.
        expect(
            within(screen.getByTestId('filter-row')).queryByRole('button', {
                name: 'Clear filters',
            }),
        ).not.toBeInTheDocument();
    });

    it('Clear filters keeps the board', async () => {
        localStorage.setItem(FILTER_BAR_OPEN_KEY, 'true');
        mockBoard();
        const u = renderView('priority=HIGH&view=board');

        await u.click(
            within(screen.getByTestId('filter-row')).getByRole('button', { name: 'Clear filters' }),
        );

        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?view=board`);
    });
});
