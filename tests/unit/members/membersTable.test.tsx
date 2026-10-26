/*
 * The Members tab (10a): the members table (≥ 820px) and stacked rows (< 820px) in
 * API order, "(you)", the count, loading / error, and the page title. Rendered inside
 * ProjectShell like the page; both layouts are in the DOM (CSS picks one).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersView } from '@/features/members/components/MembersView';
import { ProjectShell } from '@/features/projects/components/ProjectShell';
import type { Member, ProjectDetail, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { emptyInvitations } from '../../msw/invitations';
import { API_ORIGIN, server } from '../../msw/server';

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/members',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const api = (path: string) => `${API_ORIGIN}/api/v1/projects${path}`;

const me: User = {
    id: 'u-me',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
};

const project: ProjectDetail = {
    id: 'p1',
    name: 'Website relaunch',
    description: null,
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
    myRole: 'ADMIN',
    memberCount: 3,
    owner: { id: 'u-owner', name: 'Priya Raman', email: 'priya@taskmaster.app' },
};

// Midday UTC in another year: the same day in any test zone, always with the year.
const members: Member[] = [
    {
        user: {
            id: 'u-owner',
            name: 'Priya Raman',
            email: 'priya@taskmaster.app',
            avatarUrl: null,
        },
        role: 'OWNER',
        joinedAt: '2025-01-05T12:00:00.000Z',
    },
    {
        user: { id: me.id, name: me.name, email: me.email, avatarUrl: null },
        role: 'ADMIN',
        joinedAt: '2025-03-04T12:00:00.000Z',
    },
    {
        user: { id: 'u-3', name: 'Jonas Weber', email: 'jonas@taskmaster.app', avatarUrl: null },
        role: 'MEMBER',
        joinedAt: '2025-06-20T12:00:00.000Z',
    },
];

function mockApi(
    respond: () => Response | Promise<Response> = () => HttpResponse.json({ data: members }),
) {
    server.use(
        http.get(api('/p1'), () => HttpResponse.json({ data: project })),
        http.get(`${API_ORIGIN}/api/v1/projects`, () =>
            HttpResponse.json({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
        ),
        http.get(api('/p1/members'), respond),
        // The Pending invitations section (10c) for this ADMIN viewer.
        emptyInvitations(),
    );
}

function renderMembers() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ProjectShell projectId="p1">
                <MembersView />
            </ProjectShell>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    document.title = 'TaskMaster';
});
afterEach(() => resetRefreshForTests());

describe('the table (≥ 820px)', () => {
    it('rows in API order: avatar, name, email, role tag, joined date; "(you)" only for me', async () => {
        mockApi();
        renderMembers();

        const table = await screen.findByRole('table', { name: 'Members' });
        expect(
            within(table)
                .getAllByRole('columnheader')
                .map((th) => th.textContent),
        ).toEqual(['Name', 'Role', 'Joined', 'Actions']);

        const rows = within(table).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(3);
        const cells = rows.map((row) =>
            within(row)
                .getAllByRole('cell')
                .map((td) => td.textContent),
        );
        expect(cells).toEqual([
            // The actions (10b, memberActions.test.tsx) for an ADMIN viewer.
            ['PRPriya Ramanpriya@taskmaster.app', 'Owner', 'Jan 5, 2025', ''],
            ['MOMara Okafor (you)mara@taskmaster.app', 'Admin', 'Mar 4, 2025', 'Leave project'],
            ['JWJonas Weberjonas@taskmaster.app', 'Member', 'Jun 20, 2025', 'Remove'],
        ]);
        expect(
            within(rows[0] as HTMLElement).getByRole('img', { name: 'Priya Raman' }),
        ).toBeVisible();
        expect(within(table).getAllByText(/\(you\)/)).toHaveLength(1);

        const joined = within(rows[1] as HTMLElement).getByText('Mar 4, 2025');
        expect(joined.tagName).toBe('TIME');
        expect(joined).toHaveAttribute('dateTime', '2025-03-04T12:00:00.000Z');
        expect(joined.getAttribute('title')).toMatch(/2025/);
    });
});

describe('stacked rows (< 820px)', () => {
    it('avatar, name + "(you)", email, role tag, "Joined {date}", in API order', async () => {
        mockApi();
        renderMembers();

        const list = await screen.findByRole('list', { name: 'Members' });
        const items = within(list).getAllByRole('listitem');
        expect(items.map((li) => li.textContent)).toEqual([
            'PRPriya Ramanpriya@taskmaster.appOwnerJoined Jan 5, 2025',
            'MOMara Okafor (you)mara@taskmaster.appAdminJoined Mar 4, 2025',
            'JWJonas Weberjonas@taskmaster.appMemberJoined Jun 20, 2025',
        ]);
        expect(within(list).getAllByText(/\(you\)/)).toHaveLength(1);
    });
});

describe('header and title', () => {
    it('"Members" with the count, and the page title "Members · {project}"', async () => {
        mockApi();
        renderMembers();

        expect(await screen.findByRole('heading', { name: 'Members', level: 4 })).toBeVisible();
        expect(await screen.findByTestId('member-count')).toHaveTextContent('3');
        expect(document.title).toBe('Members · Website relaunch · TaskMaster');
    });
});

describe('states', () => {
    it('loading: a 3-row table skeleton (and stacked placeholders)', async () => {
        mockApi(async () => {
            await delay('infinite');
            return HttpResponse.json({});
        });
        renderMembers();

        const table = await screen.findByRole('table', { name: 'Loading members' });
        const body = table.querySelector('tbody') as HTMLElement;
        expect(body).toHaveAttribute('aria-busy', 'true');
        expect(within(body).getAllByRole('row')).toHaveLength(3);
        expect(screen.getByText('Loading members…').parentElement).toHaveAttribute(
            'aria-busy',
            'true',
        );
        expect(screen.queryByTestId('member-count')).not.toBeInTheDocument();
    });

    it('error, then Try again', async () => {
        let fail = true;
        mockApi(() =>
            fail
                ? HttpResponse.json(
                      { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                      { status: 500 },
                  )
                : HttpResponse.json({ data: members }),
        );
        const u = renderMembers();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load members");
        fail = false;
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
