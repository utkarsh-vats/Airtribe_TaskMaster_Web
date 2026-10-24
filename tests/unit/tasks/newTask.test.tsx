import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TASK_CREATED_MESSAGE } from '@/features/tasks/components/NewTaskDialog';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type { Member, ProjectDetail, Task } from '@/lib/api/types';
import { resetRefreshForTests } from '@/lib/auth/refresh';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { API_ORIGIN, server } from '../../msw/server';
import { inTimeZone } from '../../timeZone';

const PATH = '/dashboard/projects/p1/tasks';
const url = vi.hoisted(() => ({ search: 'new=1' }));

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(url.search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

inTimeZone('Asia/Kolkata');

const PRIYA = '0b6f9f3a-5d2e-4c1b-9a8e-1f2d3c4b5a69';
const MARA = '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f';
const tasksUrl = `${API_ORIGIN}/api/v1/projects/p1/tasks`;

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

const member = (id: string, name: string): Member => ({
    user: { id, name, email: `${id}@taskmaster.app`, avatarUrl: null },
    role: 'MEMBER',
    joinedAt: '2026-10-01T09:00:00.000Z',
});

const created = (body: Record<string, unknown>): Task => ({
    id: 'new-task',
    projectId: 'p1',
    title: String(body.title),
    description: (body.description as string | undefined) ?? null,
    status: 'OPEN',
    priority: (body.priority as Task['priority'] | undefined) ?? 'MEDIUM',
    dueDate: (body.dueDate as string | undefined) ?? null,
    completedAt: null,
    createdAt: '2026-10-23T09:00:00.000Z',
    updatedAt: '2026-10-23T09:00:00.000Z',
    assignee: null,
    createdBy: { id: MARA, name: 'Mara Okafor', email: 'mara@taskmaster.app' },
    commentCount: 0,
    attachmentCount: 0,
});

let posts: Record<string, unknown>[];
let postFailure: (() => Response) | null;

function mockApi() {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () => HttpResponse.json({ data: project })),
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () =>
            HttpResponse.json({
                data: [member(PRIYA, 'Priya Raman'), member(MARA, 'Mara Okafor')],
            }),
        ),
        http.get(tasksUrl, ({ request }) => {
            const limit = Number(new URL(request.url).searchParams.get('limit'));
            return HttpResponse.json({
                data: [],
                meta: { page: 1, limit, total: 0, totalPages: 1 },
            });
        }),
        http.post(tasksUrl, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            posts.push(body);
            if (postFailure) return postFailure();
            return HttpResponse.json({ data: created(body) }, { status: 201 });
        }),
    );
}

let client: QueryClient;

function renderView() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.projects.detail('p1'), project);
    const ui = () => (
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <ProjectContext
                    value={{ project, myRole: 'OWNER', can: bindPermissions('OWNER', MARA) }}
                >
                    <TaskListView />
                </ProjectContext>
            </TooltipProvider>
        </QueryClientProvider>
    );
    const view = render(ui());
    return { rerender: () => view.rerender(ui()), user: userEvent.setup() };
}

const dialog = () => screen.findByRole('dialog', { name: 'New task' });
const titleBox = (scope: HTMLElement) => within(scope).getByRole('textbox', { name: /^Title/ });

let urlReplace: ReturnType<typeof vi.spyOn>;
let urlPush: ReturnType<typeof vi.spyOn>;
let historyBack: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    url.search = 'new=1';
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    posts = [];
    postFailure = null;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    urlReplace = vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    mockApi();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('opening', () => {
    it('opens from ?new=1 with the title focused and defaults set', async () => {
        renderView();
        const d = await dialog();

        expect(titleBox(d)).toHaveFocus();
        expect(titleBox(d)).toHaveAttribute('placeholder', 'What needs doing?');
        expect(within(d).getByRole('combobox', { name: 'Priority' })).toHaveValue('MEDIUM');
        expect(
            within(within(d).getByRole('combobox', { name: 'Priority' }))
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Urgent', 'High', 'Medium', 'Low']);
        const assignee = within(d).getByRole('combobox', { name: 'Assignee' });
        expect(assignee).toHaveValue('');
        await within(assignee).findByRole('option', { name: 'Priya Raman' });
        expect(
            within(assignee)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Unassigned', 'Mara Okafor', 'Priya Raman']);
        expect(within(d).queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    });

    it('the New task button pushes ?new=1; closing then goes back (no extra entry)', async () => {
        url.search = '';
        const { rerender, user } = renderView();
        const [newTaskButton] = await screen.findAllByRole('button', { name: 'New task' });
        await user.click(newTaskButton as HTMLElement);
        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${PATH}?new=1`);

        url.search = 'new=1';
        rerender();
        await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));

        expect(historyBack).toHaveBeenCalledOnce();
        expect(urlReplace).not.toHaveBeenCalled();
    });

    it('the form is reset when it reopens', async () => {
        const { rerender, user } = renderView();
        await user.type(titleBox(await dialog()), 'Half-typed');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await user.click(
            within(await screen.findByRole('dialog', { name: 'Discard this task?' })).getByRole(
                'button',
                { name: 'Discard' },
            ),
        );
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(PATH);

        url.search = '';
        rerender();
        await vi.waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument(),
        );
        url.search = 'new=1';
        rerender();

        expect(titleBox(await dialog())).toHaveValue('');
    });
});

describe('validation', () => {
    it('an empty title', async () => {
        const { user } = renderView();
        const d = await dialog();

        await user.type(titleBox(d), '   ');
        await user.click(within(d).getByRole('button', { name: 'Create task' }));

        expect(await within(d).findByText('Enter a title.')).toBeInTheDocument();
        expect(posts).toEqual([]);
    });

    it('a title over 200 characters', async () => {
        const { user } = renderView();
        const d = await dialog();

        await user.click(titleBox(d));
        await user.paste('x'.repeat(201));
        await user.click(within(d).getByRole('button', { name: 'Create task' }));

        expect(
            await within(d).findByText('Title must be 200 characters or fewer.'),
        ).toBeInTheDocument();
        expect(posts).toEqual([]);
    });
});

describe('the POST body', () => {
    it('minimal: just the title and priority', async () => {
        const { user } = renderView();
        const d = await dialog();

        await user.type(titleBox(d), '  Write launch post  ');
        await user.click(within(d).getByRole('button', { name: 'Create task' }));

        await vi.waitFor(() =>
            expect(posts).toEqual([{ title: 'Write launch post', priority: 'MEDIUM' }]),
        );
    });

    it('full: every field, due as end of day with the offset', async () => {
        const { user } = renderView();
        const d = await dialog();

        await user.type(titleBox(d), 'Write launch post');
        await user.type(within(d).getByRole('textbox', { name: 'Description' }), 'Two drafts.');
        await user.selectOptions(within(d).getByRole('combobox', { name: 'Priority' }), 'URGENT');
        const assignee = within(d).getByRole('combobox', { name: 'Assignee' });
        await within(assignee).findByRole('option', { name: 'Priya Raman' });
        await user.selectOptions(assignee, PRIYA);
        fireEvent.change(within(d).getByLabelText('Due date'), {
            target: { value: '2026-10-28' },
        });
        await user.click(within(d).getByRole('button', { name: 'Create task' }));

        await vi.waitFor(() =>
            expect(posts).toEqual([
                {
                    title: 'Write launch post',
                    description: 'Two drafts.',
                    priority: 'URGENT',
                    assigneeId: PRIYA,
                    dueDate: '2026-10-28T23:59:59+05:30',
                },
            ]),
        );
    });
});

describe('success', () => {
    it('closes, toasts with Open (which opens the new task) and invalidates the lists', async () => {
        const { user } = renderView();
        const invalidate = vi.spyOn(client, 'invalidateQueries');
        const d = await dialog();

        await user.type(titleBox(d), 'Write launch post{Enter}');

        await vi.waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith(TASK_CREATED_MESSAGE, expect.anything()),
        );
        // Deep-linked ?new=1: closing replaces the URL.
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(PATH);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks.all('p1') });
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: [...queryKeys.tasks.root(), 'mine'],
        });

        const options = vi.mocked(toast.success).mock.calls[0]?.[1] as {
            action: { label: string; onClick: () => void };
        };
        expect(options.action.label).toBe('Open');
        options.action.onClick();
        expect(urlPush).toHaveBeenCalledExactlyOnceWith(`${PATH}?task=new-task`);
    });
});

describe('closing', () => {
    it('with a dirty title asks to discard; Keep editing keeps the values', async () => {
        const { user } = renderView();
        const d = await dialog();
        await user.type(titleBox(d), 'Keep me');

        await user.keyboard('{Escape}');
        const confirm = await screen.findByRole('dialog', { name: 'Discard this task?' });
        await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));

        expect(
            screen.queryByRole('dialog', { name: 'Discard this task?' }),
        ).not.toBeInTheDocument();
        expect(titleBox(d)).toHaveValue('Keep me');
        expect(urlReplace).not.toHaveBeenCalled();
    });

    it('a dirty description asks too (via X)', async () => {
        const { user } = renderView();
        const d = await dialog();
        await user.type(within(d).getByRole('textbox', { name: 'Description' }), 'Notes');

        await user.click(within(d).getByRole('button', { name: 'Close' }));

        expect(
            await screen.findByRole('dialog', { name: 'Discard this task?' }),
        ).toBeInTheDocument();
        expect(urlReplace).not.toHaveBeenCalled();
    });

    it('a clean form closes at once', async () => {
        const { user } = renderView();
        await dialog();

        await user.keyboard('{Escape}');

        expect(
            screen.queryByRole('dialog', { name: 'Discard this task?' }),
        ).not.toBeInTheDocument();
        expect(urlReplace).toHaveBeenCalledExactlyOnceWith(PATH);
    });
});

describe('errors', () => {
    it('422: dueDate goes under the Due date field', async () => {
        postFailure = () =>
            HttpResponse.json(
                {
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Request validation failed',
                        details: [{ path: 'dueDate', message: 'Due date is not valid' }],
                        requestId: 'r',
                    },
                },
                { status: 422 },
            );
        const { user } = renderView();
        const d = await dialog();

        await user.type(titleBox(d), 'Write launch post');
        fireEvent.change(within(d).getByLabelText('Due date'), {
            target: { value: '2026-10-28' },
        });
        await user.click(within(d).getByRole('button', { name: 'Create task' }));

        expect(await within(d).findByText('Due date is not valid')).toBeInTheDocument();
        expect(within(d).getByLabelText('Due date')).toHaveAttribute('aria-invalid', 'true');
        expect(within(d).queryByRole('alert')).not.toBeInTheDocument(); // placed, so no FormAlert
        expect(urlReplace).not.toHaveBeenCalled();
    });

    it('500: a FormAlert at the top; the dialog stays open', async () => {
        postFailure = () =>
            HttpResponse.json(
                { error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } },
                { status: 500 },
            );
        const { user } = renderView();
        const d = await dialog();

        await user.type(titleBox(d), 'Write launch post{Enter}');

        expect(await within(d).findByRole('alert')).toHaveTextContent(/went wrong/i);
        expect(titleBox(d)).toHaveValue('Write launch post');
        expect(urlReplace).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });
});
