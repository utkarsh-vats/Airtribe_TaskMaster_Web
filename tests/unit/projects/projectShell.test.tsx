import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectShell } from '@/features/projects/components/ProjectShell';
import { useProjectContext } from '@/features/projects/ProjectContext';
import type { Project, ProjectDetail, ProjectRole, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({ pathname: '/dashboard/projects/p1/tasks', push: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => nav.pathname,
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));

const api = (path: string) => `${API_ORIGIN}/api/v1${path}`;
const ME = 'u-me';

const user: User = {
    id: ME,
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

const detail = (id: string, overrides: Partial<ProjectDetail> = {}): ProjectDetail => ({
    id,
    name: `Project ${id}`,
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole: 'ADMIN' satisfies ProjectRole,
    memberCount: 4,
    owner: { id: 'u-owner', name: 'Priya Raman', email: 'priya@taskmaster.app' },
    ...overrides,
});

const summary = ({ owner: _owner, ...rest }: ProjectDetail): Project => rest;

const apiError = (status: number, code: string) =>
    HttpResponse.json({ error: { code, message: code, requestId: 'r' } }, { status });

function mockProject(respond: () => Response, id = 'p1') {
    server.use(http.get(api(`/projects/${id}`), respond));
}

function mockProjectList(items: Project[]) {
    server.use(
        http.get(api('/projects'), () =>
            HttpResponse.json({
                data: items,
                meta: { page: 1, limit: 100, total: items.length, totalPages: 1 },
            }),
        ),
    );
}

/** Reads the context the way tab pages will. */
function ContextProbe() {
    const { myRole, can, project } = useProjectContext();
    const mine = { createdBy: { id: ME }, assignee: null };
    const theirs = { createdBy: { id: 'other' }, assignee: null };
    return (
        <dl>
            <dt>project</dt>
            <dd>{project.id}</dd>
            <dt>role</dt>
            <dd>{myRole}</dd>
            <dt>can edit project</dt>
            <dd>{String(can.editProject)}</dd>
            <dt>can delete project</dt>
            <dd>{String(can.deleteProject)}</dd>
            <dt>can delete own task</dt>
            <dd>{String(can.deleteTask(mine))}</dd>
            <dt>can delete their task</dt>
            <dd>{String(can.deleteTask(theirs))}</dd>
            <dt>can remove self</dt>
            <dd>{String(can.removeMember('MEMBER', ME))}</dd>
        </dl>
    );
}

function renderShell(projectId = 'p1') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ProjectShell projectId={projectId}>
                <ContextProbe />
            </ProjectShell>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

/** The value next to a <dt> label in ContextProbe. */
const probe = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    nav.pathname = '/dashboard/projects/p1/tasks';
    nav.push.mockClear();
    document.title = 'TaskMaster';
});
afterEach(() => resetRefreshForTests());

describe('project header', () => {
    it('shows the name, description and my role, then the page', async () => {
        const project = detail('p1', {
            name: 'Website relaunch',
            description: 'New marketing site and docs.',
            myRole: 'OWNER',
        });
        mockProject(() => HttpResponse.json({ data: project }));
        mockProjectList([summary(project)]);
        renderShell();

        expect(
            await screen.findByRole('heading', { name: 'Website relaunch' }),
        ).toBeInTheDocument();
        expect(screen.getByText('New marketing site and docs.')).toBeInTheDocument();
        expect(screen.getByText('Project')).toHaveClass('card-kicker');
        expect(screen.getByText('Owner')).toHaveClass('tag-accent');
        expect(probe('project')).toBe('p1');
    });

    it('omits an empty description', async () => {
        mockProject(() => HttpResponse.json({ data: detail('p1', { description: null }) }));
        mockProjectList([]);
        renderShell();

        await screen.findByRole('heading', { name: 'Project p1' });
        expect(screen.queryByText(/marketing/)).not.toBeInTheDocument();
    });

    it('links the five tabs and marks the current one', async () => {
        nav.pathname = '/dashboard/projects/p1/members';
        mockProject(() => HttpResponse.json({ data: detail('p1') }));
        mockProjectList([]);
        renderShell();

        const tabs = await screen.findByRole('navigation', { name: 'Project sections' });
        const links = within(tabs).getAllByRole('link');
        expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
            ['Tasks', '/dashboard/projects/p1/tasks'],
            ['Discussion', '/dashboard/projects/p1/discussion'],
            ['Files', '/dashboard/projects/p1/files'],
            ['Members', '/dashboard/projects/p1/members'],
            ['Settings', '/dashboard/projects/p1/settings'],
        ]);
        expect(within(tabs).getByRole('link', { name: 'Members' })).toHaveAttribute(
            'aria-current',
            'page',
        );
        expect(within(tabs).getByRole('link', { name: 'Tasks' })).not.toHaveAttribute(
            'aria-current',
        );
    });

    it('sets the document title to the project name', async () => {
        mockProject(() => HttpResponse.json({ data: detail('p1', { name: 'Website relaunch' }) }));
        mockProjectList([]);
        renderShell();

        await screen.findByRole('heading', { name: 'Website relaunch' });
        expect(document.title).toBe('Website relaunch · TaskMaster');
    });

    it('shows a header skeleton and no page while loading', () => {
        mockProject(() => HttpResponse.json({ data: detail('p1') }));
        mockProjectList([]);
        renderShell();

        expect(screen.getByText('Loading project…')).toBeInTheDocument();
        expect(screen.queryByText('project')).not.toBeInTheDocument();
    });
});

describe('mobile project switcher', () => {
    it('goes to the same tab in the chosen project', async () => {
        nav.pathname = '/dashboard/projects/p1/files';
        const p1 = detail('p1', { name: 'Website relaunch' });
        const p2 = detail('p2', { name: 'Q4 hiring' });
        mockProject(() => HttpResponse.json({ data: p1 }));
        mockProjectList([summary(p1), summary(p2)]);
        const u = renderShell();

        const select = await screen.findByRole('combobox', { name: 'Switch project' });
        await screen.findByRole('option', { name: 'Q4 hiring' });
        expect(select).toHaveValue('p1');

        await u.selectOptions(select, 'p2');

        expect(nav.push).toHaveBeenCalledExactlyOnceWith('/dashboard/projects/p2/files');
    });

    it('always lists the current project, even if it is not in the list', async () => {
        mockProject(
            () => HttpResponse.json({ data: detail('p9', { name: 'Archived thing' }) }),
            'p9',
        );
        mockProjectList([summary(detail('p1'))]);
        nav.pathname = '/dashboard/projects/p9/tasks';
        renderShell('p9');

        const select = await screen.findByRole('combobox', { name: 'Switch project' });
        expect(select).toHaveValue('p9');
        expect(within(select).getByRole('option', { name: 'Archived thing' })).toBeInTheDocument();
    });
});

describe('errors', () => {
    it.each([
        [404, 'NOT_FOUND'],
        [422, 'VALIDATION_ERROR'],
    ])('%i → "Project not found" with a way back', async (status, code) => {
        mockProject(() => apiError(status, code));
        renderShell();

        expect(
            await screen.findByRole('heading', { name: 'Project not found' }),
        ).toBeInTheDocument();
        expect(
            screen.getByText("It doesn't exist, or you're not a member of it."),
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Go to your projects' })).toHaveAttribute(
            'href',
            '/dashboard/projects',
        );
        expect(screen.queryByText('project')).not.toBeInTheDocument();
        expect(document.title).toBe('Project not found · TaskMaster');
    });

    it('500 → ErrorState with a working retry', async () => {
        let attempt = 0;
        mockProject(() => {
            attempt += 1;
            return attempt === 1
                ? apiError(500, 'INTERNAL_ERROR')
                : HttpResponse.json({ data: detail('p1', { name: 'Back again' }) });
        });
        mockProjectList([]);
        const u = renderShell();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load this project");
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByRole('heading', { name: 'Back again' })).toBeInTheDocument();
    });
});

describe('ProjectContext', () => {
    it('exposes myRole and permissions bound to the signed-in user', async () => {
        mockProject(() => HttpResponse.json({ data: detail('p1', { myRole: 'MEMBER' }) }));
        mockProjectList([]);
        renderShell();

        await screen.findByRole('heading', { name: 'Project p1' });
        expect(probe('role')).toBe('MEMBER');
        expect(probe('can edit project')).toBe('false');
        expect(probe('can delete project')).toBe('false');
        expect(probe('can delete own task')).toBe('true');
        expect(probe('can delete their task')).toBe('false');
        expect(probe('can remove self')).toBe('false');
    });

    it('throws outside a project', () => {
        function Orphan() {
            useProjectContext();
            return null;
        }
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<Orphan />)).toThrow(
            'useProjectContext must be used inside ProjectShell',
        );
        spy.mockRestore();
    });
});
