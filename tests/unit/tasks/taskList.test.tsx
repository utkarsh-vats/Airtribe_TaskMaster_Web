/*
 * The list renders both layouts and CSS shows one (table from 820px, rows below), so there is
 * no matchMedia hook to mock: jsdom ignores the CSS and both markups are in the DOM. Tests
 * scope to the table (data-testid="task-table") or the rows (data-testid="task-rows").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import type { ProjectDetail, TaskListItem, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';

const PATH = '/dashboard/projects/p1/tasks';
const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: nav.push, replace: vi.fn() }),
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

const TASKS: TaskListItem[] = [
    task('t1', {
        title: 'Finalise homepage hero copy',
        description: 'Tighten the headline.\nSecond line is not shown.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignee: { id: 'u1', name: 'Mara Okafor' },
        dueDate: days(3),
    }),
    task('t2', {
        title: 'Set up 301 redirects',
        status: 'OPEN',
        priority: 'URGENT',
        dueDate: days(-3),
    }),
    task('t3', {
        title: 'Cookie consent banner',
        status: 'COMPLETED',
        priority: 'LOW',
        dueDate: days(-5),
    }),
];

/** GET tasks serving `pages` (1-based); records the query strings. */
function mockTasks(pages: TaskListItem[][], total = pages.flat().length) {
    const requests: string[] = [];
    server.use(
        http.get(tasksUrl, ({ request }) => {
            const url = new URL(request.url);
            requests.push(url.search);
            const page = Number(url.searchParams.get('page') ?? '1');
            return HttpResponse.json({
                data: pages[page - 1] ?? [],
                meta: { page, limit: 25, total, totalPages: pages.length },
            });
        }),
    );
    return requests;
}

function renderList(search = '') {
    nav.search = search;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ProjectContext
                value={{ project, myRole: 'OWNER', can: bindPermissions('OWNER', user.id) }}
            >
                <TaskListView />
            </ProjectContext>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const table = () => screen.getByTestId('task-table');
const rows = () => screen.getByTestId('task-rows');

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    nav.push.mockClear();
});
afterEach(() => resetRefreshForTests());

describe('table (820px and up)', () => {
    it('has the prototype columns minus ID', async () => {
        mockTasks([TASKS]);
        renderList();

        await screen.findByText('3 tasks');
        const headers = within(table())
            .getAllByRole('columnheader')
            .map((th) => th.textContent);
        expect(headers).toEqual(['Task', 'Status', 'Priority', 'Assignee', 'Due']);
    });

    it('fills each cell: title + first description line, status, priority, assignee, due', async () => {
        mockTasks([TASKS]);
        renderList();
        await screen.findByText('3 tasks');

        const hero = within(table()).getByRole('row', { name: 'Finalise homepage hero copy' });
        const cells = within(hero).getAllByRole('cell');
        expect(cells[0]).toHaveTextContent('Finalise homepage hero copy');
        expect(cells[0]).toHaveTextContent('Tighten the headline.');
        expect(cells[0]).not.toHaveTextContent('Second line');
        expect(within(cells[1] as HTMLElement).getByText('In progress')).toHaveClass('tag-accent');
        expect(cells[2]).toHaveTextContent('High');
        expect(
            within(cells[3] as HTMLElement).getByRole('img', { name: 'Mara Okafor' }),
        ).toBeInTheDocument();
        expect(cells[3]).toHaveTextContent('Mara Okafor');
        expect(within(cells[4] as HTMLElement).getByText(/^\w{3} \d+/)).not.toHaveClass(
            'text-danger',
        );

        const redirects = within(table()).getByRole('row', { name: 'Set up 301 redirects' });
        const redirectCells = within(redirects).getAllByRole('cell');
        expect(redirectCells[1]).toHaveTextContent('To do');
        expect(within(redirectCells[2] as HTMLElement).getByText('Urgent')).toBeInTheDocument();
        expect(redirectCells[3]).toHaveTextContent('Unassigned');
        const overdue = within(redirectCells[4] as HTMLElement).getByText(/^Overdue · /);
        expect(overdue).toHaveClass('text-danger', 'font-bold');

        const banner = within(table()).getByRole('row', { name: 'Cookie consent banner' });
        const bannerDue = within(banner).getAllByRole('cell')[4] as HTMLElement;
        expect(bannerDue).not.toHaveTextContent('Overdue'); // completed
        expect(within(banner).getByText('Done')).toHaveClass('tag-outline');
    });

    it('shows "No date" for a task without a due date', async () => {
        mockTasks([[task('t9')]]);
        renderList();

        await screen.findByText('1 task');
        expect(within(table()).getByText('No date')).toBeInTheDocument();
    });

    it('opens a task on click or Enter, keeping the other params', async () => {
        mockTasks([TASKS, [task('t4')]], 26);
        const u = renderList('page=2');
        await screen.findByText('26 tasks');

        await u.click(within(table()).getByRole('row', { name: 'Task t4' }));
        expect(nav.push).toHaveBeenLastCalledWith(`${PATH}?page=2&task=t4`, { scroll: false });

        nav.push.mockClear();
        within(table()).getByRole('row', { name: 'Task t4' }).focus();
        await u.keyboard('{Enter}');
        expect(nav.push).toHaveBeenLastCalledWith(`${PATH}?page=2&task=t4`, { scroll: false });
    });
});

describe('rows (below 820px)', () => {
    it('render priority, title, first description line, status, due and assignee avatar', async () => {
        mockTasks([TASKS]);
        renderList();
        await screen.findByText('3 tasks');

        const hero = within(rows()).getByRole('link', { name: /Finalise homepage hero copy/ });
        expect(hero).toHaveTextContent('High');
        expect(hero).toHaveTextContent('Tighten the headline.');
        expect(hero).not.toHaveTextContent('Second line');
        expect(within(hero).getByText('In progress')).toBeInTheDocument();
        expect(within(hero).getByRole('img', { name: 'Mara Okafor' })).toHaveTextContent('MO');

        const redirects = within(rows()).getByRole('link', { name: /Set up 301 redirects/ });
        expect(within(redirects).getByText(/^Overdue · /)).toHaveClass('text-danger');
    });

    it('link to ?task=, keeping other params', async () => {
        mockTasks([TASKS]);
        renderList('page=1');
        await screen.findByText('3 tasks');

        expect(within(rows()).getByRole('link', { name: /Cookie consent banner/ })).toHaveAttribute(
            'href',
            `${PATH}?page=1&task=t3`,
        );
    });
});

describe('task panel vs New task dialog', () => {
    it('New task closes an open task; opening a task drops ?new', async () => {
        mockTasks([TASKS]);
        const u = renderList('task=t1&new=1');
        await screen.findByText('3 tasks');

        await u.click(screen.getByRole('button', { name: 'New task' }));
        expect(nav.push).toHaveBeenLastCalledWith(`${PATH}?new=1`, { scroll: false });

        await u.click(within(table()).getByRole('row', { name: 'Set up 301 redirects' }));
        expect(nav.push).toHaveBeenLastCalledWith(`${PATH}?task=t2`, { scroll: false });
        expect(within(rows()).getByRole('link', { name: /Cookie consent banner/ })).toHaveAttribute(
            'href',
            `${PATH}?task=t3`,
        );
    });
});

describe('toolbar and pagination', () => {
    it('New task sets ?new=1', async () => {
        mockTasks([TASKS]);
        const u = renderList('page=2');
        await screen.findByText('3 tasks');

        await u.click(screen.getByRole('button', { name: 'New task' }));

        expect(nav.push).toHaveBeenCalledWith(`${PATH}?page=2&new=1`, { scroll: false });
    });

    it('requests the page from ?page and drops page=1 from the URL', async () => {
        const requests = mockTasks([[task('a')], [task('b')], [task('c')]], 60);
        const u = renderList('page=2');

        await screen.findByText('60 tasks');
        expect(requests).toEqual(['?page=2&limit=25']);

        await u.click(screen.getByRole('button', { name: /Next/ }));
        expect(nav.push).toHaveBeenLastCalledWith(`${PATH}?page=3`);

        await u.click(screen.getByRole('button', { name: /Previous/ }));
        expect(nav.push).toHaveBeenLastCalledWith(PATH);
    });
});

describe('states', () => {
    it('shows skeletons while loading', () => {
        mockTasks([TASKS]);
        renderList();

        expect(screen.getByRole('table', { name: 'Loading tasks' })).toBeInTheDocument();
        expect(screen.getByText('Loading tasks…')).toBeInTheDocument();
    });

    it('shows the empty project state with New task', async () => {
        mockTasks([[]], 0);
        const u = renderList();

        expect(await screen.findByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument();
        expect(screen.getByText('Create the first task for this project.')).toBeInTheDocument();
        expect(screen.getByText('0 tasks')).toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: 'New task' });
        expect(buttons).toHaveLength(2);
        await u.click(buttons[1] as HTMLElement);
        expect(nav.push).toHaveBeenCalledWith(`${PATH}?new=1`, { scroll: false });
    });

    it('shows "Nothing on this page" past the end, with a link to page 1', async () => {
        mockTasks([[task('a')]], 1);
        renderList('page=9');

        expect(
            await screen.findByRole('heading', { name: 'Nothing on this page' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
            'href',
            PATH,
        );
    });

    it('shows an error with a working retry', async () => {
        let attempt = 0;
        server.use(
            http.get(tasksUrl, () => {
                attempt += 1;
                return attempt === 1
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } },
                          { status: 500 },
                      )
                    : HttpResponse.json({
                          data: TASKS,
                          meta: { page: 1, limit: 25, total: 3, totalPages: 1 },
                      });
            }),
        );
        const u = renderList();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load tasks");
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByText('3 tasks')).toBeInTheDocument();
    });
});
