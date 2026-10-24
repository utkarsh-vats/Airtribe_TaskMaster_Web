/*
 * next/navigation is mocked, so the URL only changes when a test says so: opening and closing
 * are asserted on shallowUrl / history.back, then the test re-renders with the new ?task to
 * play the browser's part.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type { ProjectDetail, Task, TaskListItem, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { emptyComments } from '../../msw/comments';
import { API_ORIGIN, server } from '../../msw/server';

const PATH = '/dashboard/projects/p1/tasks';
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const tasksUrl = `${API_ORIGIN}/api/v1/projects/p1/tasks`;

// A member who neither created nor is assigned the task: the panel is read-only for them
// (editing is covered by taskEdit.test.tsx).
const user: User = {
    id: 'u-viewer',
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
    myRole: 'MEMBER',
    memberCount: 3,
    owner: null,
};

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const row: TaskListItem = {
    id: 't1',
    projectId: 'p1',
    title: 'Finalise homepage hero copy',
    description: 'Tighten the headline.\nAlign it with the launch doc.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    dueDate: days(-2),
    completedAt: null,
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    updatedAt: '2026-10-10T09:00:00.000Z',
    assignee: { id: 'u1', name: 'Mara Okafor' },
    createdBy: { id: 'u2', name: 'Priya Raman' },
};

const detail = (overrides: Partial<Task> = {}): Task => ({
    ...row,
    assignee: { id: 'u1', name: 'Mara Okafor', email: 'mara@taskmaster.app' },
    createdBy: { id: 'u2', name: 'Priya Raman', email: 'priya@taskmaster.app' },
    commentCount: 3,
    attachmentCount: 2,
    ...overrides,
});

const apiError = (status: number, code: string) =>
    HttpResponse.json({ error: { code, message: code, requestId: 'r' } }, { status });

function mockList() {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () => HttpResponse.json({ data: project })),
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () => HttpResponse.json({ data: [] })),
        http.get(tasksUrl, ({ request }) => {
            const limit = Number(new URL(request.url).searchParams.get('limit'));
            return HttpResponse.json({
                data: limit === 1 ? [] : [row],
                meta: { page: 1, limit, total: 1, totalPages: 1 },
            });
        }),
    );
}

function mockDetail(respond: () => Response | Promise<Response>) {
    server.use(http.get(`${tasksUrl}/t1`, respond));
}

let client: QueryClient;
let urlPush: MockInstance<(url: string) => void>;
let urlReplace: MockInstance<(url: string) => void>;
let historyBack: MockInstance<() => void>;

function ui() {
    return (
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <ProjectContext
                    value={{ project, myRole: 'MEMBER', can: bindPermissions('MEMBER', user.id) }}
                >
                    <TaskListView />
                </ProjectContext>
            </TooltipProvider>
        </QueryClientProvider>
    );
}

function renderAt(search: string) {
    nav.search = search;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // ProjectShell has already loaded the project on a real page.
    client.setQueryData(queryKeys.projects.detail('p1'), project);
    const result = render(ui());
    return {
        ...result,
        user: userEvent.setup(),
        /** Play the browser: the URL now has `search`. */
        navigate(next: string) {
            nav.search = next;
            result.rerender(ui());
        },
    };
}

const panel = () => screen.findByRole('dialog', { name: 'Website relaunch / Task' });

beforeEach(() => {
    // The panel's comment thread (thread.test.tsx covers it).
    server.use(emptyComments());
    sessionStore.reset();
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    urlReplace = vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('content', () => {
    it('shows the task from ?task: title, fields, description, counts and created-by', async () => {
        mockList();
        mockDetail(() => HttpResponse.json({ data: detail() }));
        renderAt('task=t1');

        const dialog = await panel();
        expect(await within(dialog).findByText('(2)')).toBeInTheDocument(); // detail loaded
        expect(within(dialog).getByRole('heading', { level: 3 })).toHaveTextContent(
            'Finalise homepage hero copy',
        );
        expect(within(dialog).getByText('In progress')).toHaveClass('tag-accent');
        expect(within(dialog).getByText('High')).toBeInTheDocument();
        expect(within(dialog).getByRole('img', { name: 'Mara Okafor' })).toBeInTheDocument();

        const due = within(dialog).getByText(/^Overdue · /);
        expect(due).toHaveClass('text-danger', 'font-bold');
        expect(due.getAttribute('title')).toMatch(/\d{4} at \d/); // full date and time

        const description = within(dialog).getByText(/Tighten the headline/);
        expect(description.textContent).toBe(
            'Tighten the headline.\nAlign it with the launch doc.',
        );
        expect(description).toHaveClass('whitespace-pre-wrap');

        expect(
            within(dialog).getByRole('heading', { name: 'Attachments (2)' }),
        ).toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
        expect(within(dialog).getByTestId('comment-count')).toHaveTextContent('3');
        expect(within(dialog).getAllByText('Coming soon')).toHaveLength(1);
        expect(within(dialog).getByText('Created by Priya Raman · 2 h ago')).toBeInTheDocument();
    });

    it('shows the list row at once while the detail is still loading', async () => {
        mockList();
        mockDetail(async () => {
            await delay(300);
            return HttpResponse.json({ data: detail() });
        });
        const view = renderAt('');
        await screen.findByText('1 task');

        view.navigate('task=t1');
        const dialog = await panel();

        // From the cached row: title and status straight away; counts wait for the detail.
        expect(within(dialog).getByRole('heading', { level: 3 })).toHaveTextContent(
            'Finalise homepage hero copy',
        );
        expect(within(dialog).getByText('In progress')).toBeInTheDocument();
        expect(within(dialog).queryByText('Loading task…')).not.toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { name: 'Attachments' })).toBeInTheDocument();

        expect(
            await within(dialog).findByRole('heading', { name: 'Attachments (2)' }),
        ).toBeInTheDocument();
    });

    it('shows skeleton lines when there is nothing cached', async () => {
        mockList();
        mockDetail(async () => {
            await delay('infinite');
            return HttpResponse.json({});
        });
        server.use(
            http.get(tasksUrl, async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        renderAt('task=t1');

        expect(within(await panel()).getByText('Loading task…')).toBeInTheDocument();
    });

    it('unassigned, no description, completed', async () => {
        mockList();
        mockDetail(() =>
            HttpResponse.json({
                data: detail({
                    assignee: null,
                    description: null,
                    status: 'COMPLETED',
                    completedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
                }),
            }),
        );
        renderAt('task=t1');
        const dialog = await panel();

        expect(await within(dialog).findByText('Unassigned')).toBeInTheDocument();
        expect(within(dialog).getByText('No description')).toBeInTheDocument();
        expect(within(dialog).getByText('Done')).toHaveClass('tag-outline');
        expect(within(dialog).getByText('Completed 5 min ago')).toBeInTheDocument();
        expect(within(dialog).queryByText(/^Overdue/)).not.toBeInTheDocument(); // completed
    });
});

describe('closing and history', () => {
    it('opening from a row pushes ?task; closing with X goes back (no duplicate entry)', async () => {
        mockList();
        mockDetail(() => HttpResponse.json({ data: detail() }));
        const view = renderAt('page=2');
        await screen.findByText('1 task');

        await view.user.click(
            within(screen.getByTestId('task-table')).getByRole('row', { name: row.title }),
        );
        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${PATH}?page=2&task=t1`);

        view.navigate('page=2&task=t1');
        const dialog = await panel();
        await view.user.click(within(dialog).getByRole('button', { name: 'Close' }));

        expect(historyBack).toHaveBeenCalledOnce();
        expect(urlPush).toHaveBeenCalledOnce(); // the open — nothing pushed on close
        expect(urlReplace).not.toHaveBeenCalled();
    });

    it.each(['X', 'Esc', 'overlay'])(
        'a deep-linked panel closed with %s replaces the URL without ?task',
        async (how) => {
            mockList();
            mockDetail(() => HttpResponse.json({ data: detail() }));
            const view = renderAt('status=OPEN&task=t1');
            const dialog = await panel();

            if (how === 'X')
                await view.user.click(within(dialog).getByRole('button', { name: 'Close' }));
            if (how === 'Esc') await view.user.keyboard('{Escape}');
            if (how === 'overlay') {
                const overlay = document.querySelector('.tm-sheet-overlay');
                expect(overlay).not.toBeNull();
                await view.user.click(overlay as Element);
            }

            expect(urlReplace).toHaveBeenCalledExactlyOnceWith(`${PATH}?status=OPEN`);
            expect(historyBack).not.toHaveBeenCalled();
        },
    );

    it('Back (the URL losing ?task) closes it', async () => {
        mockList();
        mockDetail(() => HttpResponse.json({ data: detail() }));
        const view = renderAt('task=t1');
        await panel();

        view.navigate(''); // popstate
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('moves focus into the panel and back to the opening row', async () => {
        mockList();
        mockDetail(() => HttpResponse.json({ data: detail() }));
        const view = renderAt('');
        await screen.findByText('1 task');
        const opener = within(screen.getByTestId('task-table')).getByRole('row', {
            name: row.title,
        });

        opener.focus();
        await view.user.keyboard('{Enter}');
        view.navigate('task=t1');
        const dialog = await panel();
        expect(dialog).toContainElement(document.activeElement as HTMLElement);

        await view.user.keyboard('{Escape}');
        expect(historyBack).toHaveBeenCalledOnce();
        view.navigate(''); // the browser went back
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        // Radix restores focus in a timeout after the sheet unmounts.
        await vi.waitFor(() => expect(opener).toHaveFocus());
    });
});

describe('errors', () => {
    it.each([
        [404, 'NOT_FOUND'],
        [422, 'VALIDATION_ERROR'],
    ])('%i → "Task not found" with a Close button', async (status, code) => {
        mockList();
        mockDetail(() => apiError(status, code));
        const view = renderAt('task=t1');
        const dialog = await panel();

        expect(
            await within(dialog).findByRole('heading', { name: 'Task not found' }),
        ).toBeInTheDocument();
        expect(within(dialog).getByText('It may have been deleted.')).toBeInTheDocument();
        // The not-found block's own Close (the header's X is also named "Close").
        const notFound = within(dialog).getByRole('heading', { name: 'Task not found' })
            .parentElement as HTMLElement;
        await view.user.click(within(notFound).getByRole('button', { name: 'Close' }));
        expect(urlReplace).toHaveBeenCalledWith(PATH);
    });

    it('500 → ErrorState with a working retry', async () => {
        mockList();
        let attempt = 0;
        mockDetail(() => {
            attempt += 1;
            return attempt === 1
                ? apiError(500, 'INTERNAL_ERROR')
                : HttpResponse.json({ data: detail() });
        });
        const view = renderAt('task=t1');
        const dialog = await panel();

        const alert = await within(dialog).findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load this task");
        await view.user.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(
            await within(dialog).findByRole('heading', { name: 'Attachments (2)' }),
        ).toBeInTheDocument();
    });
});
