/*
 * The filter bar renders as a row from 820px and inside a sheet below; jsdom ignores the CSS,
 * so tests use the row (data-testid="filter-row") unless they're about the mobile sheet. The
 * row starts open here (remembered in storage); filterToggle.test.tsx covers collapsing it.
 * Sort lives in the toolbar.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';

import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { FILTER_BAR_OPEN_KEY, resetFilterBarOpenForTests } from '@/features/tasks/filterBarOpen';
import type { Member, ProjectDetail, TaskListItem, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';

import { API_ORIGIN, server } from '../../msw/server';

const PATH = '/dashboard/projects/p1/tasks';
const nav = vi.hoisted(() => ({ search: '', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

// Due dates convert in the user's time zone: pin it.
const originalTz = process.env.TZ;
beforeAll(() => {
    process.env.TZ = 'Asia/Kolkata';
});
afterAll(() => {
    process.env.TZ = originalTz;
});

const PRIYA = '0b6f9f3a-5d2e-4c1b-9a8e-1f2d3c4b5a69';
const MARA = '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f';

const user: User = {
    id: MARA,
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
    memberCount: 2,
    owner: null,
};

const member = (id: string, name: string, role: Member['role']): Member => ({
    user: {
        id,
        name,
        email: `${name.split(' ')[0]?.toLowerCase()}@taskmaster.app`,
        avatarUrl: null,
    },
    role,
    joinedAt: '2026-10-01T09:00:00.000Z',
});

const task: TaskListItem = {
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
    createdBy: { id: MARA, name: 'Mara Okafor' },
};

/** Serves members and tasks; returns the recorded task query strings. */
function mockApi() {
    const requests: string[] = [];
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () =>
            HttpResponse.json({
                data: [member(PRIYA, 'Priya Raman', 'ADMIN'), member(MARA, 'Mara Okafor', 'OWNER')],
            }),
        ),
        http.get(`${API_ORIGIN}/api/v1/projects/p1/tasks`, ({ request }) => {
            const url = new URL(request.url);
            requests.push(url.search);
            const limit = Number(url.searchParams.get('limit'));
            return HttpResponse.json({
                data: limit === 1 ? [] : [task],
                meta: { page: 1, limit, total: 1, totalPages: 1 },
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
                value={{ project, myRole: 'OWNER', can: bindPermissions('OWNER', MARA) }}
            >
                <TaskListView />
            </ProjectContext>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const row = () => screen.getByTestId('filter-row');
const listRequests = (requests: string[]) => requests.filter((r) => r.includes('limit=25'));
const countRequests = (requests: string[]) => requests.filter((r) => r.includes('limit=1'));

/** Client-side URL updates (filters, page, open task) go through shallowUrl, not the router. */
let urlPush: MockInstance<(url: string) => void>;

beforeEach(() => {
    resetFilterBarOpenForTests();
    localStorage.setItem(FILTER_BAR_OPEN_KEY, 'true');
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    nav.push.mockClear();
    nav.replace.mockClear();
});
afterEach(() => resetRefreshForTests());

describe('controls write their URL param and reset the page', () => {
    it('priority (Urgent → Low, multi)', async () => {
        mockApi();
        const u = renderList('page=3&ref=mail');
        await screen.findByText('1 task');

        await u.click(within(row()).getByRole('button', { name: 'Any priority' }));
        await u.click(screen.getByRole('checkbox', { name: 'High' }));

        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?priority=HIGH&ref=mail`);
    });

    it('assignee: Anyone, Me, Unassigned, then members by name', async () => {
        mockApi();
        const u = renderList('page=2');
        await screen.findByText('1 task');
        const assignee = within(row()).getByRole('combobox', { name: 'Assignee' });
        await within(assignee).findByRole('option', { name: 'Priya Raman' });

        expect(
            within(assignee)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Anyone', 'Me', 'Unassigned', 'Mara Okafor', 'Priya Raman']);
        await u.selectOptions(assignee, PRIYA);
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?assignee=${PRIYA}`);

        await u.selectOptions(assignee, 'unassigned');
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?assignee=unassigned`);
    });

    it('created by: Anyone, Me, members — no Unassigned', async () => {
        mockApi();
        const u = renderList();
        await screen.findByText('1 task');
        const createdBy = within(row()).getByRole('combobox', { name: 'Created by' });
        await within(createdBy).findByRole('option', { name: 'Priya Raman' });

        expect(
            within(createdBy)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Anyone', 'Me', 'Mara Okafor', 'Priya Raman']);
        await u.selectOptions(createdBy, 'me');
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?createdBy=me`);
    });

    it('due from / to, with min and max tied together', async () => {
        mockApi();
        renderList('dueFrom=2026-10-01&page=4');
        await screen.findByText('1 task');
        const from = within(row()).getByLabelText('Due from');
        const to = within(row()).getByLabelText('Due to');

        expect(to).toHaveAttribute('min', '2026-10-01');
        fireEvent.change(to, { target: { value: '2026-10-31' } });
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?dueFrom=2026-10-01&dueTo=2026-10-31`);

        fireEvent.change(from, { target: { value: '' } });
        expect(urlPush).toHaveBeenLastCalledWith(PATH);
    });

    it('overdue only', async () => {
        mockApi();
        const u = renderList('page=2');
        await screen.findByText('1 task');

        await u.click(within(row()).getByRole('checkbox', { name: 'Overdue only' }));
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?overdue=true`);
    });

    it('sort by: a new field drops any explicit order', async () => {
        mockApi();
        const u = renderList('order=asc&page=2');
        await screen.findByText('1 task');

        await u.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'priority');
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?sort=priority`);
    });
});

describe('the list request', () => {
    it('carries every filter, with due days converted to API instants', async () => {
        const requests = mockApi();
        renderList(
            `priority=URGENT,HIGH&assignee=me&createdBy=${PRIYA}&dueFrom=2026-10-28&dueTo=2026-10-30&overdue=true&sort=dueDate&order=desc`,
        );
        await screen.findByText('1 task');

        const query = new URLSearchParams(listRequests(requests)[0]);
        // Comma-separated, as the spec's `explode: false` requires (repeated keys → 422).
        expect(query.getAll('priority')).toEqual(['URGENT,HIGH']);
        expect(query.get('assignee')).toBe('me');
        expect(query.get('createdBy')).toBe(PRIYA);
        expect(query.get('dueAfter')).toBe('2026-10-27T18:29:59.999Z');
        expect(query.get('dueBefore')).toBe('2026-10-30T18:30:00.000Z');
        expect(query.get('overdue')).toBe('true');
        expect(query.get('sort')).toBe('dueDate');
        expect(query.get('order')).toBe('desc');
    });

    it('status counts honour the other filters, without sort', async () => {
        const requests = mockApi();
        renderList('q=hero&priority=URGENT&assignee=unassigned&sort=title&status=OPEN');
        await screen.findByText('1 task');
        await vi.waitFor(() => expect(countRequests(requests)).toHaveLength(4));

        for (const search of countRequests(requests)) {
            const query = new URLSearchParams(search);
            expect(query.get('q')).toBe('hero');
            expect(query.get('priority')).toBe('URGENT');
            expect(query.get('assignee')).toBe('unassigned');
            expect(query.has('sort')).toBe(false);
        }
        expect(countRequests(requests).filter((r) => !r.includes('status='))).toHaveLength(1);
    });
});

describe('order toggle', () => {
    it.each([
        ['', 'Sort descending', `${PATH}?order=asc`], // createdAt desc by default
        ['sort=updatedAt', 'Sort descending', `${PATH}?sort=updatedAt&order=asc`],
        ['sort=priority', 'Sort descending', `${PATH}?sort=priority&order=asc`],
        ['sort=dueDate', 'Sort ascending', `${PATH}?sort=dueDate&order=desc`],
        ['sort=title', 'Sort ascending', `${PATH}?sort=title&order=desc`],
        ['sort=dueDate&order=desc', 'Sort descending', `${PATH}?sort=dueDate`], // back to default
    ])('%s → shows "%s" and flips', async (search, label, next) => {
        mockApi();
        const u = renderList(search);
        await screen.findByText('1 task');

        const toggle = screen.getByRole('button', { name: label });
        await u.click(toggle);
        expect(urlPush).toHaveBeenLastCalledWith(next);
    });
});

describe('clear and mobile', () => {
    it('Clear filters shows when anything is set and removes every filter and the sort', async () => {
        mockApi();
        const u = renderList('status=OPEN&q=x&priority=HIGH&sort=title');
        await screen.findByText('1 task');

        await u.click(within(row()).getByRole('button', { name: 'Clear filters' }));
        expect(urlPush).toHaveBeenLastCalledWith(PATH);
    });

    it('Clear filters is hidden with nothing to clear', async () => {
        mockApi();
        renderList('page=2');
        await screen.findByText('1 task');

        expect(
            within(row()).queryByRole('button', { name: 'Clear filters' }),
        ).not.toBeInTheDocument();
    });

    it('the mobile Filters button counts active filters and opens a live sheet', async () => {
        mockApi();
        const u = renderList(
            'priority=HIGH&assignee=me&dueFrom=2026-10-01&dueTo=2026-10-09&status=OPEN&sort=title',
        );
        await screen.findByText('1 task');

        const button = screen.getByTestId('filter-sheet-button');
        expect(button).toHaveAccessibleName('Filters, 3 active');
        expect(within(button).getByTestId('filter-badge')).toHaveTextContent('3');

        await u.click(button);
        const sheet = await screen.findByRole('dialog', { name: 'Filters' });
        expect(within(sheet).getByRole('combobox', { name: 'Sort by' })).toHaveValue('title');
        await u.click(within(sheet).getByRole('checkbox', { name: 'Overdue only' }));
        expect(urlPush).toHaveBeenLastCalledWith(
            `${PATH}?status=OPEN&priority=HIGH&assignee=me&dueFrom=2026-10-01&dueTo=2026-10-09&overdue=true&sort=title`,
        );
    });

    it('the mobile Filters button has no badge with no bar filters', async () => {
        mockApi();
        renderList('status=OPEN&q=x');
        await screen.findByText('1 task');

        expect(screen.getByTestId('filter-sheet-button')).toHaveAccessibleName('Filters');
        expect(screen.queryByTestId('filter-badge')).not.toBeInTheDocument();
    });
});
