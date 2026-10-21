import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from '@/components/shell/DashboardShell';
import { SidebarNav } from '@/components/shell/SidebarNav';
import type { MyInvitation, Project, ProjectRole, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({
    pathname: '/dashboard/my-tasks',
    push: vi.fn(),
    replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
    usePathname: () => nav.pathname,
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

const api = (path: string) => `${API_ORIGIN}/api/v1${path}`;

const user: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const project = (id: string, name: string, myRole: ProjectRole): Project => ({
    id,
    name,
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole,
    memberCount: 3,
});

const PROJECTS = [
    project('p1', 'Website relaunch', 'OWNER'),
    project('p2', 'Mobile app v2 — a very long project name that will not fit', 'ADMIN'),
    project('p3', 'Q4 hiring', 'MEMBER'),
];

const invitation = (
    id: string,
    status: MyInvitation['status'],
    expiresInDays = 3,
): MyInvitation => ({
    id,
    projectId: 'px',
    email: user.email,
    role: 'MEMBER',
    status,
    expiresAt: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
    respondedAt: null,
    createdAt: '2026-10-20T09:00:00.000Z',
    invitedBy: { id: 'u2', name: 'Priya Raman' },
    project: { id: 'px', name: 'Other project' },
});

function mockProjects(items: Project[], total = items.length) {
    server.use(
        http.get(api('/projects'), () =>
            HttpResponse.json({
                data: items,
                meta: { page: 1, limit: 100, total, totalPages: Math.ceil(total / 100) },
            }),
        ),
    );
}

function mockInvitations(list: MyInvitation[]) {
    server.use(http.get(api('/users/me/invitations'), () => HttpResponse.json({ data: list })));
}

function mockUnread() {
    server.use(
        http.get(api('/notifications'), () =>
            HttpResponse.json({
                data: [],
                meta: { page: 1, limit: 1, total: 0, totalPages: 0, unreadCount: 0 },
            }),
        ),
    );
}

function wrapper(ui: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    nav.pathname = '/dashboard/my-tasks';
});
afterEach(() => resetRefreshForTests());

describe('SidebarNav', () => {
    it('lists projects with role tags, truncation titles and the active project', async () => {
        mockProjects(PROJECTS);
        mockInvitations([]);
        nav.pathname = '/dashboard/projects/p1/tasks';
        wrapper(<SidebarNav />);

        const relaunch = await screen.findByRole('link', { name: /Website relaunch/ });
        expect(relaunch).toHaveAttribute('href', '/dashboard/projects/p1');
        expect(relaunch).toHaveAttribute('aria-current', 'page');
        expect(within(relaunch).getByText('Owner')).toHaveClass('tag-accent', 'tag-sm');

        const mobile = screen.getByRole('link', { name: /Mobile app v2/ });
        expect(mobile).toHaveAttribute('title', PROJECTS[1]?.name);
        expect(mobile).not.toHaveAttribute('aria-current');
        expect(within(mobile).getByText('Admin')).toHaveClass('tag-neutral');
        expect(
            within(screen.getByRole('link', { name: /Q4 hiring/ })).getByText('Member'),
        ).toBeInTheDocument();

        // Order is the API's.
        const names = screen
            .getAllByRole('link')
            .map((link) => link.getAttribute('href'))
            .filter((href) => href?.startsWith('/dashboard/projects/'));
        expect(names).toEqual([
            '/dashboard/projects/p1',
            '/dashboard/projects/p2',
            '/dashboard/projects/p3',
        ]);
    });

    it('marks the active personal link', async () => {
        mockProjects(PROJECTS);
        mockInvitations([]);
        nav.pathname = '/dashboard/notifications';
        wrapper(<SidebarNav />);

        expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
            'aria-current',
            'page',
        );
        expect(screen.getByRole('link', { name: 'My tasks' })).not.toHaveAttribute('aria-current');
        await screen.findByRole('link', { name: /Website relaunch/ });
        expect(screen.getByRole('link', { name: /Website relaunch/ })).not.toHaveAttribute(
            'aria-current',
        );
    });

    it('shows skeleton rows while loading', () => {
        mockProjects(PROJECTS);
        mockInvitations([]);
        wrapper(<SidebarNav />);

        expect(screen.getByText('Loading projects…')).toBeInTheDocument();
    });

    it('shows a compact error with a working retry', async () => {
        let attempt = 0;
        server.use(
            http.get(api('/projects'), () => {
                attempt += 1;
                return attempt === 1
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } },
                          { status: 500 },
                      )
                    : HttpResponse.json({
                          data: PROJECTS,
                          meta: { page: 1, limit: 100, total: 3, totalPages: 1 },
                      });
            }),
        );
        mockInvitations([]);
        const u = userEvent.setup();
        wrapper(<SidebarNav />);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load projects");
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByRole('link', { name: /Website relaunch/ })).toBeInTheDocument();
        expect(attempt).toBe(2);
    });

    it('says "No projects yet" when there are none', async () => {
        mockProjects([]);
        mockInvitations([]);
        wrapper(<SidebarNav />);

        expect(await screen.findByText('No projects yet')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute(
            'href',
            '/dashboard/projects?new=1',
        );
    });

    it('shows "View all projects" only when there are more than 100', async () => {
        mockProjects(PROJECTS, 3);
        mockInvitations([]);
        const { unmount } = wrapper(<SidebarNav />);
        await screen.findByRole('link', { name: /Website relaunch/ });
        expect(screen.queryByRole('link', { name: /View all projects/ })).not.toBeInTheDocument();
        unmount();

        mockProjects(PROJECTS, 140);
        wrapper(<SidebarNav />);
        const viewAll = await screen.findByRole('link', { name: /View all projects/ });
        expect(viewAll).toHaveAttribute('href', '/dashboard/projects');
    });

    it('badges Invitations with the pending count, hidden at 0', async () => {
        mockProjects(PROJECTS);
        mockInvitations([
            invitation('i1', 'PENDING'),
            invitation('i2', 'PENDING'),
            invitation('i3', 'ACCEPTED'),
            invitation('i4', 'PENDING', -1), // past its expiry
        ]);
        const { unmount } = wrapper(<SidebarNav />);

        const link = await screen.findByRole('link', { name: 'Invitations, 2 pending' });
        expect(within(link).getByTestId('invitations-badge')).toHaveTextContent('2');
        unmount();

        mockInvitations([invitation('i3', 'DECLINED')]);
        wrapper(<SidebarNav />);
        await screen.findByRole('link', { name: /Website relaunch/ });
        expect(screen.getByRole('link', { name: 'Invitations' })).toBeInTheDocument();
        expect(screen.queryByTestId('invitations-badge')).not.toBeInTheDocument();
    });
});

describe('mobile drawer', () => {
    function renderShell() {
        mockProjects(PROJECTS);
        mockInvitations([]);
        mockUnread();
        const result = wrapper(
            <DashboardShell>
                <p>Page</p>
            </DashboardShell>,
        );
        return { ...result, user: userEvent.setup() };
    }

    const drawer = () => screen.queryByRole('dialog', { name: 'Navigation' });
    const menuButton = () => screen.getByRole('button', { name: 'Open navigation' });

    it('opens from the menu button with the same navigation', async () => {
        const { user: u } = renderShell();

        await u.click(menuButton());

        const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
        expect(
            await within(dialog).findByRole('link', { name: /Website relaunch/ }),
        ).toBeInTheDocument();
        expect(within(dialog).getByRole('link', { name: 'My tasks' })).toBeInTheDocument();
    });

    it('closes on Esc and returns focus to the menu button', async () => {
        const { user: u } = renderShell();

        await u.click(menuButton());
        await screen.findByRole('dialog', { name: 'Navigation' });
        await u.keyboard('{Escape}');

        expect(drawer()).not.toBeInTheDocument();
        expect(menuButton()).toHaveFocus();
    });

    it('closes when the route changes', async () => {
        const { user: u, rerender } = renderShell();
        await u.click(menuButton());
        await screen.findByRole('dialog', { name: 'Navigation' });

        nav.pathname = '/dashboard/projects/p1';
        rerender(
            <QueryClientProvider client={new QueryClient()}>
                <DashboardShell>
                    <p>Page</p>
                </DashboardShell>
            </QueryClientProvider>,
        );

        expect(drawer()).not.toBeInTheDocument();
    });

    it('closes when a link is followed, even to the current page', async () => {
        const { user: u } = renderShell();
        await u.click(menuButton());
        const dialog = await screen.findByRole('dialog', { name: 'Navigation' });

        await u.click(within(dialog).getByRole('link', { name: 'My tasks' }));

        expect(drawer()).not.toBeInTheDocument();
    });
});
