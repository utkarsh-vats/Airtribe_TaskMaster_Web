import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/components/ui/Toaster';
import { PROJECT_CREATED_MESSAGE } from '@/features/projects/components/NewProjectDialog';
import { ProjectsView } from '@/features/projects/components/ProjectsView';
import type { Project, ProjectRole, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { queryKeys } from '@/lib/query/keys';

import { API_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

const projectsUrl = `${API_ORIGIN}/api/v1/projects`;

const user: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const project = (id: string, overrides: Partial<Project> = {}): Project => ({
    id,
    name: `Project ${id}`,
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: minutesAgo(5),
    myRole: 'MEMBER' satisfies ProjectRole,
    memberCount: 3,
    ...overrides,
});

/** GET /projects serving `pages` (1-based); records the requested query strings. */
function mockProjects(pages: Project[][], total = pages.flat().length) {
    const requests: string[] = [];
    server.use(
        http.get(projectsUrl, ({ request }) => {
            const url = new URL(request.url);
            requests.push(url.search);
            const page = Number(url.searchParams.get('page') ?? '1');
            return HttpResponse.json({
                data: pages[page - 1] ?? [],
                meta: { page, limit: 24, total, totalPages: pages.length },
            });
        }),
    );
    return requests;
}

let client: QueryClient;

function renderView(search = '') {
    nav.search = search;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = render(
        <QueryClientProvider client={client}>
            <ProjectsView />
        </QueryClientProvider>,
    );
    return { ...result, user: userEvent.setup() };
}

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    nav.push.mockClear();
    nav.replace.mockClear();
});
afterEach(() => resetRefreshForTests());

describe('project cards', () => {
    it('show name, description, role, members and last update, linking to the tasks', async () => {
        mockProjects([
            [
                project('p1', {
                    name: 'Website relaunch',
                    description: 'New marketing site and docs.',
                    myRole: 'OWNER',
                    memberCount: 4,
                    updatedAt: minutesAgo(5),
                }),
                project('p2', { name: 'Q4 hiring', memberCount: 1, updatedAt: minutesAgo(0) }),
            ],
        ]);
        renderView();

        const card = await screen.findByRole('link', { name: /Website relaunch/ });
        expect(card).toHaveAttribute('href', '/dashboard/projects/p1/tasks');
        expect(card).toHaveClass('card');
        expect(within(card).getByText('New marketing site and docs.')).toHaveClass('line-clamp-2');
        expect(within(card).getByText('Owner')).toBeInTheDocument();
        expect(within(card).getByText('4 members')).toBeInTheDocument();
        expect(within(card).getByText('Updated 5 min ago')).toBeInTheDocument();

        const hiring = screen.getByRole('link', { name: /Q4 hiring/ });
        expect(within(hiring).getByText('1 member')).toBeInTheDocument();
        expect(within(hiring).getByText('Updated just now')).toBeInTheDocument();
        expect(within(hiring).getByText('Member')).toBeInTheDocument();
    });
});

describe('pagination', () => {
    it('requests the page from ?page and moves pages through the URL', async () => {
        const requests = mockProjects([[project('a')], [project('b')], [project('c')]], 3);
        const { user: u } = renderView('page=2');

        expect(await screen.findByRole('link', { name: /Project b/ })).toBeInTheDocument();
        expect(requests).toEqual(['?page=2&limit=24']);
        expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

        await u.click(screen.getByRole('button', { name: /Next/ }));
        expect(nav.push).toHaveBeenLastCalledWith('/dashboard/projects?page=3');

        await u.click(screen.getByRole('button', { name: /Previous/ }));
        expect(nav.push).toHaveBeenLastCalledWith('/dashboard/projects'); // page 1 drops the param
    });

    it('treats an invalid ?page as page 1', async () => {
        const requests = mockProjects([[project('a')]]);
        renderView('page=-4');

        await screen.findByRole('link', { name: /Project a/ });
        expect(requests).toEqual(['?page=1&limit=24']);
    });
});

describe('states', () => {
    it('shows skeleton cards while loading', () => {
        mockProjects([[project('a')]]);
        renderView();

        expect(screen.getByText('Loading projects…')).toBeInTheDocument();
    });

    it('shows the empty state with New project and invitations', async () => {
        mockProjects([[]], 0);
        renderView();

        expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
        expect(screen.getByText('Create one, or check your invitations.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'View invitations' })).toHaveAttribute(
            'href',
            '/dashboard/invitations',
        );
        expect(screen.getAllByRole('button', { name: 'New project' })).toHaveLength(2);
    });

    it('shows an error with a working retry', async () => {
        let attempt = 0;
        server.use(
            http.get(projectsUrl, () => {
                attempt += 1;
                return attempt === 1
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } },
                          { status: 500 },
                      )
                    : HttpResponse.json({
                          data: [project('a')],
                          meta: { page: 1, limit: 24, total: 1, totalPages: 1 },
                      });
            }),
        );
        const { user: u } = renderView();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load projects");
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByRole('link', { name: /Project a/ })).toBeInTheDocument();
    });
});

describe('New project dialog', () => {
    it('opens from ?new=1; closing removes the param without a history entry', async () => {
        mockProjects([[project('a')]]);
        const { user: u } = renderView('new=1&page=2');

        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        expect(within(dialog).getByLabelText(/Name/)).toHaveFocus();

        await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(nav.replace).toHaveBeenCalledExactlyOnceWith('/dashboard/projects?page=2', {
            scroll: false,
        });
        expect(nav.push).not.toHaveBeenCalled();
    });

    it('opens from the page button without touching the URL', async () => {
        mockProjects([[project('a')]]);
        const { user: u } = renderView();

        await u.click(screen.getByRole('button', { name: 'New project' }));
        expect(await screen.findByRole('dialog', { name: 'New project' })).toBeInTheDocument();

        await u.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(nav.replace).not.toHaveBeenCalled();
    });

    it('creates the project: trimmed body, lists refreshed, toast, navigation', async () => {
        mockProjects([[project('a')]]);
        let body: unknown;
        server.use(
            http.post(projectsUrl, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(
                    { data: { ...project('new-1', { name: 'Launch plan' }), owner: null } },
                    { status: 201 },
                );
            }),
        );
        const success = vi.spyOn(toast, 'success');
        const { user: u } = renderView('new=1');
        // The open modal hides the page from the accessibility tree, hence `hidden`.
        await screen.findByRole('link', { name: /Project a/, hidden: true });
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const dialog = screen.getByRole('dialog', { name: 'New project' });

        await u.type(within(dialog).getByLabelText(/Name/), '  Launch plan  ');
        await u.type(within(dialog).getByLabelText('Description'), '  Q1 launch tasks ');
        await u.click(within(dialog).getByRole('button', { name: 'Create project' }));

        await vi.waitFor(() =>
            expect(nav.push).toHaveBeenCalledWith('/dashboard/projects/new-1/tasks'),
        );
        expect(body).toEqual({ name: 'Launch plan', description: 'Q1 launch tasks' });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects.lists() });
        expect(success).toHaveBeenCalledWith(PROJECT_CREATED_MESSAGE);
        success.mockRestore();
    });

    it('omits an empty description', async () => {
        mockProjects([[project('a')]]);
        let body: unknown;
        server.use(
            http.post(projectsUrl, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(
                    { data: { ...project('n'), owner: null } },
                    { status: 201 },
                );
            }),
        );
        const { user: u } = renderView('new=1');
        const dialog = await screen.findByRole('dialog', { name: 'New project' });

        await u.type(within(dialog).getByLabelText(/Name/), 'Solo');
        await u.type(within(dialog).getByLabelText('Description'), '   ');
        await u.click(within(dialog).getByRole('button', { name: 'Create project' }));

        await vi.waitFor(() => expect(body).toEqual({ name: 'Solo' }));
    });

    it('validates the name: empty and too long', async () => {
        mockProjects([[project('a')]]);
        let posted = false;
        server.use(
            http.post(projectsUrl, () => {
                posted = true;
                return HttpResponse.json({}, { status: 500 });
            }),
        );
        const { user: u } = renderView('new=1');
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        const name = within(dialog).getByLabelText(/Name/);

        await u.type(name, '   ');
        await u.click(within(dialog).getByRole('button', { name: 'Create project' }));
        expect(name).toHaveAccessibleDescription('Enter a project name.');

        await u.clear(name);
        await u.type(name, 'x'.repeat(101));
        await u.click(within(dialog).getByRole('button', { name: 'Create project' }));
        expect(name).toHaveAccessibleDescription('Name must be 100 characters or fewer.');
        expect(posted).toBe(false);
    });

    it('maps 422 details onto the fields and other errors to the alert', async () => {
        mockProjects([[project('a')]]);
        let attempt = 0;
        server.use(
            http.post(projectsUrl, () => {
                attempt += 1;
                return attempt === 1
                    ? HttpResponse.json(
                          {
                              error: {
                                  code: 'VALIDATION_ERROR',
                                  message: 'x',
                                  details: [{ path: 'name', message: 'Name already used here' }],
                                  requestId: 'r',
                              },
                          },
                          { status: 422 },
                      )
                    : HttpResponse.json(
                          { error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } },
                          { status: 429 },
                      );
            }),
        );
        const { user: u } = renderView('new=1');
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        const name = within(dialog).getByLabelText(/Name/);

        await u.type(name, 'Dup');
        await u.click(within(dialog).getByRole('button', { name: 'Create project' }));
        await vi.waitFor(() => expect(name).toHaveAccessibleDescription('Name already used here'));

        await u.click(within(dialog).getByRole('button', { name: 'Create project' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(
            'Too many attempts — try again in a minute.',
        );
        expect(nav.push).not.toHaveBeenCalled();
    });
});
