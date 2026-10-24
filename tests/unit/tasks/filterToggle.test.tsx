/*
 * The collapsible filter row (≥ 820px): the toolbar's Filters toggle, the remembered open
 * state, the chips shown while it's closed, and sort staying in the toolbar. jsdom ignores the
 * CSS, so "hidden" here means inert / aria-hidden, which also hides it from role queries.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { FILTER_BAR_OPEN_KEY, resetFilterBarOpenForTests } from '@/features/tasks/filterBarOpen';
import type { Member, ProjectDetail, TaskListItem, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';

import { API_ORIGIN, server } from '../../msw/server';
import { inTimeZone } from '../../timeZone';

const PATH = '/dashboard/projects/p1/tasks';
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

inTimeZone('Asia/Kolkata');

const PRIYA = '0b6f9f3a-5d2e-4c1b-9a8e-1f2d3c4b5a69';
const MARA = '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f';
// The chips show "Oct 20" for dates in the current year.
const YEAR = new Date().getFullYear();

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

const member = (id: string, name: string): Member => ({
    user: { id, name, email: `${id}@taskmaster.app`, avatarUrl: null },
    role: 'MEMBER',
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

function mockApi(total = 1) {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () =>
            HttpResponse.json({
                data: [member(PRIYA, 'Priya Raman'), member(MARA, 'Mara Okafor')],
            }),
        ),
        http.get(`${API_ORIGIN}/api/v1/projects/p1/tasks`, ({ request }) => {
            const limit = Number(new URL(request.url).searchParams.get('limit'));
            return HttpResponse.json({
                data: limit === 1 || total === 0 ? [] : [task],
                meta: { page: 1, limit, total, totalPages: 1 },
            });
        }),
    );
}

function renderList(search = '') {
    nav.search = search;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
        <QueryClientProvider client={client}>
            <ProjectContext
                value={{ project, myRole: 'OWNER', can: bindPermissions('OWNER', MARA) }}
            >
                <TaskListView />
            </ProjectContext>
        </QueryClientProvider>,
    );
    return { user: userEvent.setup(), unmount: view.unmount };
}

const toggle = () => screen.getByTestId('filter-toggle');
const filterRow = () => document.getElementById(toggle().getAttribute('aria-controls') ?? '');
const assigneeSelect = () => screen.queryByRole('combobox', { name: 'Assignee' });
const chips = () => screen.queryByRole('group', { name: 'Active filters' });
const loaded = () => screen.findByText('1 task');

let urlPush: MockInstance<(url: string) => void>;

beforeEach(() => {
    resetFilterBarOpenForTests();
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('the Filters toggle', () => {
    it('starts collapsed, then shows and hides the row with aria-expanded', async () => {
        mockApi();
        const { user } = renderList();
        await loaded();

        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(filterRow()).toHaveAttribute('data-state', 'closed');
        expect(filterRow()).toHaveAttribute('inert');
        expect(assigneeSelect()).not.toBeInTheDocument();

        await user.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        expect(filterRow()).toHaveAttribute('data-state', 'open');
        expect(filterRow()).not.toHaveAttribute('inert');
        expect(assigneeSelect()).toBeInTheDocument();

        await user.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
        expect(assigneeSelect()).not.toBeInTheDocument();
    });

    it('shows the active count, like the mobile button', async () => {
        mockApi();
        renderList('priority=HIGH&overdue=true&status=OPEN');
        await loaded();

        expect(toggle()).toHaveAccessibleName('Filters, 2 active');
        expect(within(toggle()).getByTestId('filter-badge')).toHaveTextContent('2');
    });

    it('remembers open/closed across remounts (and a reload)', async () => {
        mockApi();
        const first = renderList();
        await loaded();
        await first.user.click(toggle());
        expect(localStorage.getItem(FILTER_BAR_OPEN_KEY)).toBe('true');
        first.unmount();

        // A reload: nothing in memory, the stored value decides.
        resetFilterBarOpenForTests();
        const second = renderList();
        await loaded();
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        expect(assigneeSelect()).toBeInTheDocument();

        await second.user.click(toggle());
        expect(localStorage.getItem(FILTER_BAR_OPEN_KEY)).toBe('false');
    });

    it('still works when localStorage throws', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });
        mockApi();
        const { user } = renderList();
        await loaded();
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');

        await user.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        expect(assigneeSelect()).toBeInTheDocument();

        await user.click(toggle());
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('chips', () => {
    const ALL = `priority=URGENT,HIGH&assignee=me&createdBy=${PRIYA}&dueFrom=${YEAR}-10-20&dueTo=${YEAR}-10-25&overdue=true&page=3`;

    it('one per active filter while collapsed; gone when the row opens', async () => {
        mockApi();
        const { user } = renderList(ALL);
        await loaded();

        const group = chips();
        expect(group).toBeInTheDocument();
        await within(group as HTMLElement).findByText('Created by: Priya Raman');
        expect(
            within(group as HTMLElement)
                .getAllByRole('button', { name: /^Remove / })
                .map((b) => b.getAttribute('aria-label')),
        ).toEqual([
            'Remove Priority: Urgent, High',
            'Remove Assignee: Me',
            'Remove Created by: Priya Raman',
            'Remove Due: Oct 20 – Oct 25',
            'Remove Overdue',
        ]);
        expect(
            within(group as HTMLElement).getByRole('button', { name: 'Clear all' }),
        ).toBeInTheDocument();

        await user.click(toggle());
        expect(chips()).not.toBeInTheDocument();
    });

    it('one-sided due ranges read "from" / "until"', async () => {
        mockApi();
        renderList(`dueTo=${YEAR}-10-25&assignee=unassigned`);
        await loaded();

        expect(screen.getByText('Due: until Oct 25')).toBeInTheDocument();
        expect(screen.getByText('Assignee: Unassigned')).toBeInTheDocument();
    });

    it('no chip row with nothing active (status, search and sort have their own controls)', async () => {
        mockApi();
        renderList('status=OPEN&q=hero&sort=title');
        await loaded();

        expect(chips()).not.toBeInTheDocument();
    });

    it.each([
        [
            'Remove Priority: Urgent, High',
            `${PATH}?assignee=me&createdBy=${PRIYA}&dueFrom=${YEAR}-10-20&dueTo=${YEAR}-10-25&overdue=true`,
        ],
        [
            'Remove Due: Oct 20 – Oct 25',
            `${PATH}?priority=URGENT,HIGH&assignee=me&createdBy=${PRIYA}&overdue=true`,
        ],
        [
            'Remove Overdue',
            `${PATH}?priority=URGENT,HIGH&assignee=me&createdBy=${PRIYA}&dueFrom=${YEAR}-10-20&dueTo=${YEAR}-10-25`,
        ],
    ])('"%s" clears only that filter and the page', async (name, expected) => {
        mockApi();
        const { user } = renderList(ALL);
        await loaded();

        await user.click(within(chips() as HTMLElement).getByRole('button', { name }));

        expect(urlPush).toHaveBeenLastCalledWith(expected.replaceAll(',', '%2C'));
    });

    it('Clear all removes the chips but keeps status, search and sort', async () => {
        mockApi();
        const { user } = renderList(`status=OPEN&q=hero&priority=HIGH&overdue=true&sort=title`);
        await loaded();

        await user.click(within(chips() as HTMLElement).getByRole('button', { name: 'Clear all' }));

        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?status=OPEN&q=hero&sort=title`);
    });
});

describe('sort while collapsed', () => {
    it('the toolbar sort and order toggle still work', async () => {
        mockApi();
        const { user } = renderList('page=2');
        await loaded();
        expect(toggle()).toHaveAttribute('aria-expanded', 'false');

        await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'dueDate');
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?sort=dueDate`);

        await user.click(screen.getByRole('button', { name: 'Sort descending' }));
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?order=asc`);
    });
});

describe('the result count', () => {
    it('is announced, not shown: screen-reader-only live text', async () => {
        mockApi();
        renderList();

        const live = await screen.findByText('1 task');
        expect(live).toHaveClass('sr-only');
        expect(live).toHaveAttribute('aria-live', 'polite');
    });

    it('says "No tasks match" when filters leave nothing', async () => {
        mockApi(0);
        renderList('priority=HIGH');

        await vi.waitFor(() =>
            expect(screen.getByTestId('result-announcement')).toHaveTextContent('No tasks match'),
        );
    });
});
