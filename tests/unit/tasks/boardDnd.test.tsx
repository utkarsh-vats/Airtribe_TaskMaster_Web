/*
 * Board drag & drop. jsdom has no layout, so getBoundingClientRect is mocked: three 280px
 * columns side by side, cards stacked inside them. That's enough for dnd-kit's keyboard
 * sensor (Space, ← / →, Space / Esc) to find the columns, so the keyboard path runs end to end.
 * Mouse and touch drags need real pointer geometry and aren't driven here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type * as Sonner from 'sonner';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TASK_STATUS_CONFLICT_MESSAGE } from '@/features/tasks/api';
import {
    cancelled,
    createBoardAnnouncements,
    decideDrop,
    moved,
    overColumn,
    pickedUp,
} from '@/features/tasks/boardDnd';
import { TaskBoard } from '@/features/tasks/components/TaskBoard';
import type { ProjectRole, Task, TaskListItem, TaskStatus, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';

vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

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

const project = {
    id: 'p1',
    name: 'Website relaunch',
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole: 'OWNER' as ProjectRole,
    memberCount: 3,
    owner: null,
};

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

/** Server state: tasks by id; columns are filtered from it on every GET. */
let serverTasks: TaskListItem[] = [];
let patches: { id: string; body: Record<string, unknown> }[] = [];
let columnGets: string[] = [];
/** Holds PATCH responses until released, to look at the optimistic state. */
let patchGate: Promise<void> | null = null;
let patchFailure: (() => Response) | null = null;

const apiError = (status: number, code: string) =>
    HttpResponse.json({ error: { code, message: code, requestId: 'r' } }, { status });

function mockApi() {
    server.use(
        http.get(tasksUrl, ({ request }) => {
            const status = new URL(request.url).searchParams.get('status') as TaskStatus;
            columnGets.push(status);
            const items = serverTasks.filter((t) => t.status === status);
            return HttpResponse.json({
                data: items,
                meta: { page: 1, limit: 100, total: items.length, totalPages: 1 },
            });
        }),
        http.patch(`${tasksUrl}/:taskId`, async ({ request, params }) => {
            const id = String(params.taskId);
            const body = (await request.json()) as Record<string, unknown>;
            patches.push({ id, body });
            if (patchGate) await patchGate;
            if (patchFailure) return patchFailure();
            const current = serverTasks.find((t) => t.id === id);
            if (!current) return apiError(404, 'NOT_FOUND');
            const next = { ...current, status: body.status as TaskStatus };
            serverTasks = serverTasks.map((t) => (t.id === id ? next : t));
            const full: Task = {
                ...next,
                assignee: null,
                createdBy: { ...next.createdBy, email: 'x@example.test' },
                commentCount: 0,
                attachmentCount: 0,
            };
            return HttpResponse.json({ data: full });
        }),
    );
}

const onOpen = vi.fn();

function renderBoard(role: ProjectRole = 'OWNER') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ProjectContext
                value={{
                    project: { ...project, myRole: role },
                    myRole: role,
                    can: bindPermissions(role, user.id),
                }}
            >
                <TaskBoard
                    projectId="p1"
                    filters={{ page: 1 }}
                    taskHref={(id) => `/dashboard/projects/p1/tasks?view=board&task=${id}`}
                    onOpen={onOpen}
                    onAddTask={vi.fn()}
                    listHref={() => '/list'}
                    onNavigate={vi.fn()}
                />
            </ProjectContext>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const LABELS = ['To do', 'In progress', 'Done'];
const column = (label: string) => screen.getByRole('region', { name: label });
const liveRegion = () => document.querySelector('[id^="DndLiveRegion"]');

/**
 * Fake layout: columns at x = 0 / 300 / 600 (280 × 600), cards 80px tall from y = 50, and the
 * drag copy wherever its inline style puts it.
 */
function rectFor(el: HTMLElement): DOMRect {
    // The drag copy: DragOverlay's fixed wrapper sets its size inline; the card inside is measured.
    const overlay = el.style.position === 'fixed' ? el : el.parentElement;
    if (overlay?.style.position === 'fixed') {
        const { left, top, width, height } = overlay.style;
        return new DOMRect(
            parseFloat(left),
            parseFloat(top),
            parseFloat(width),
            parseFloat(height),
        );
    }
    const section = el.closest('section');
    const index = section ? LABELS.indexOf(section.querySelector('h6')?.textContent ?? '') : -1;
    if (index < 0) return new DOMRect(0, 0, 0, 0);
    const x = index * 300;
    if (el === section) return new DOMRect(x, 0, 280, 600);
    const li = el.closest('li');
    if (li && el.matches('a.card')) {
        const row = Array.from(li.parentElement?.children ?? []).indexOf(li);
        return new DOMRect(x, 50 + row * 90, 280, 80);
    }
    return new DOMRect(x, 0, 0, 0);
}

const key = async (target: Element, code: string) => {
    await act(async () => {
        fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code });
        // dnd-kit measures and listens on the next frame.
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
};

/** Keyboard drag: Space on the card, `steps` arrow presses, then Space (or Esc). */
async function keyboardDrag(card: HTMLElement, arrows: string[], finish: 'Space' | 'Escape') {
    card.focus();
    await key(card, 'Space');
    for (const arrow of arrows) await key(document.activeElement ?? card, arrow);
    await key(document.activeElement ?? card, finish);
}

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
    ) {
        return rectFor(this);
    });
    serverTasks = [
        task('t1', { title: 'Set up 301 redirects' }),
        task('t2', { title: 'Write launch email' }),
        task('t3', { title: 'Finalise hero copy', status: 'IN_PROGRESS' }),
        // Someone else's, not assigned to me: a MEMBER can't move it.
        task('t4', { title: 'Cookie banner', createdBy: { id: 'u2', name: 'Priya Raman' } }),
    ];
    patches = [];
    columnGets = [];
    patchGate = null;
    patchFailure = null;
    onOpen.mockClear();
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
    mockApi();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('decideDrop', () => {
    it('ignores drops on the same column, outside any column, or without permission', () => {
        expect(decideDrop({ from: 'OPEN', over: 'OPEN', canEdit: true })).toBeNull();
        expect(decideDrop({ from: 'OPEN', over: null, canEdit: true })).toBeNull();
        expect(decideDrop({ from: 'OPEN', over: 't2', canEdit: true })).toBeNull();
        expect(decideDrop({ from: 'OPEN', over: 'COMPLETED', canEdit: false })).toBeNull();
    });

    it('moves to another column’s status', () => {
        expect(decideDrop({ from: 'OPEN', over: 'COMPLETED', canEdit: true })).toBe('COMPLETED');
        expect(decideDrop({ from: 'COMPLETED', over: 'IN_PROGRESS', canEdit: true })).toBe(
            'IN_PROGRESS',
        );
    });
});

describe('announcements', () => {
    const active = {
        id: 't1',
        data: { current: { task: task('t1', { title: 'Fix login' }), from: 'OPEN' } },
        rect: { current: { initial: null, translated: null } },
    };
    const over = (id: string) => ({
        id,
        rect: new DOMRect(),
        disabled: false,
        data: { current: {} },
    });

    it('say what happens in the board’s words', () => {
        expect(pickedUp('Fix login', 'OPEN')).toBe('Picked up Fix login, in To do.');
        expect(overColumn('IN_PROGRESS')).toBe('Over In progress.');
        expect(moved('Fix login', 'COMPLETED')).toBe('Moved Fix login to Done.');
        expect(cancelled('Fix login', 'OPEN')).toBe('Cancelled, Fix login stayed in To do.');

        const announce = createBoardAnnouncements();
        expect(announce.onDragStart({ active })).toBe('Picked up Fix login, in To do.');
        // The starting column isn't repeated right after picking up.
        expect(announce.onDragOver({ active, over: over('OPEN') })).toBeUndefined();
        expect(announce.onDragOver({ active, over: over('IN_PROGRESS') })).toBe(
            'Over In progress.',
        );
        expect(announce.onDragOver({ active, over: over('IN_PROGRESS') })).toBeUndefined();
        expect(announce.onDragOver({ active, over: over('OPEN') })).toBe('Over To do.');
        expect(announce.onDragEnd({ active, over: over('COMPLETED') })).toBe(
            'Moved Fix login to Done.',
        );
        expect(announce.onDragEnd({ active, over: over('OPEN') })).toBe(
            'Fix login stayed in To do.',
        );
        expect(announce.onDragCancel({ active, over: null })).toBe(
            'Cancelled, Fix login stayed in To do.',
        );
    });
});

describe('keyboard drag', () => {
    it('Space, →, Space moves the card at once, then PATCHes { status } once', async () => {
        let release = () => {};
        patchGate = new Promise((resolve) => (release = resolve));
        renderBoard();
        const card = await within(column('To do')).findByRole('link', {
            name: /Set up 301 redirects/,
        });
        expect(card).toHaveAttribute('aria-roledescription', 'draggable');

        await keyboardDrag(card, ['ArrowRight'], 'Space');

        // Optimistic: in In progress (on top) before the server answers; counts adjusted.
        const doing = column('In progress');
        await vi.waitFor(() => expect(patches).toHaveLength(1));
        const doingCards = within(doing).getAllByRole('link');
        expect(doingCards[0]).toHaveAccessibleName(/Set up 301 redirects/);
        expect(within(column('To do')).queryByText('Set up 301 redirects')).toBeNull();
        expect(within(doing).getByText('2')).toBeInTheDocument();
        expect(patches[0]).toEqual({ id: 't1', body: { status: 'IN_PROGRESS' } });
        await vi.waitFor(() =>
            expect(liveRegion()).toHaveTextContent('Moved Set up 301 redirects to In progress.'),
        );

        release();
        await vi.waitFor(() =>
            expect(serverTasks.find((t) => t.id === 't1')?.status).toBe('IN_PROGRESS'),
        );
        expect(await within(doing).findByText('Set up 301 redirects')).toBeInTheDocument();
        expect(patches).toHaveLength(1);
    });

    it('announces picking up and the column it’s over', async () => {
        renderBoard();
        const card = await within(column('To do')).findByRole('link', {
            name: /Set up 301 redirects/,
        });
        card.focus();
        await key(card, 'Space');
        // The card dims while its copy follows the keys.
        expect(card).toHaveClass('opacity-40');
        await vi.waitFor(() =>
            expect(liveRegion()).toHaveTextContent('Picked up Set up 301 redirects, in To do.'),
        );
        await key(card, 'ArrowRight');
        await key(card, 'ArrowRight');
        await vi.waitFor(() => expect(liveRegion()).toHaveTextContent('Over Done.'));
        expect(column('Done')).toHaveAttribute('data-over', 'true');
        await key(card, 'Escape');
    });

    it('Esc cancels: nothing is sent and the card stays', async () => {
        renderBoard();
        const card = await within(column('To do')).findByRole('link', {
            name: /Set up 301 redirects/,
        });

        await keyboardDrag(card, ['ArrowRight'], 'Escape');

        await vi.waitFor(() =>
            expect(liveRegion()).toHaveTextContent(
                'Cancelled, Set up 301 redirects stayed in To do.',
            ),
        );
        expect(within(column('To do')).getByText('Set up 301 redirects')).toBeInTheDocument();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(patches).toHaveLength(0);
    });

    it('dropping back on its own column sends nothing', async () => {
        renderBoard();
        const card = await within(column('To do')).findByRole('link', {
            name: /Set up 301 redirects/,
        });

        await keyboardDrag(card, ['ArrowRight', 'ArrowLeft'], 'Space');

        await vi.waitFor(() =>
            expect(liveRegion()).toHaveTextContent(/^Set up 301 redirects stayed in To do\.$/),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(patches).toHaveLength(0);
    });
});

describe('failures', () => {
    it('an error moves the card back, with an error toast', async () => {
        let release = () => {};
        patchGate = new Promise((resolve) => (release = resolve));
        patchFailure = () => apiError(500, 'INTERNAL_ERROR');
        renderBoard();
        const card = await within(column('To do')).findByRole('link', {
            name: /Set up 301 redirects/,
        });

        await keyboardDrag(card, ['ArrowRight', 'ArrowRight'], 'Space');
        expect(await within(column('Done')).findByText('Set up 301 redirects')).toBeInTheDocument();

        release();
        expect(
            await within(column('To do')).findByText('Set up 301 redirects'),
        ).toBeInTheDocument();
        expect(within(column('Done')).queryByText('Set up 301 redirects')).toBeNull();
        expect(within(column('Done')).getByText('No tasks')).toBeInTheDocument();
        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    });

    it('409: the conflict toast, and the columns are refetched', async () => {
        patchFailure = () => apiError(409, 'CONFLICT');
        renderBoard();
        const card = await within(column('To do')).findByRole('link', {
            name: /Set up 301 redirects/,
        });
        // Meanwhile someone else completed it.
        serverTasks = serverTasks.map((t) => (t.id === 't1' ? { ...t, status: 'COMPLETED' } : t));
        columnGets = [];

        await keyboardDrag(card, ['ArrowRight'], 'Space');

        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(TASK_STATUS_CONFLICT_MESSAGE));
        await vi.waitFor(() =>
            expect([...columnGets].sort()).toEqual(['COMPLETED', 'IN_PROGRESS', 'OPEN']),
        );
        // The server's truth shows: the task is in Done now.
        expect(await within(column('Done')).findByText('Set up 301 redirects')).toBeInTheDocument();
        expect(within(column('In progress')).queryByText('Set up 301 redirects')).toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
    });
});

describe('clicks and permissions', () => {
    it('a plain click on a draggable card still opens it', async () => {
        const u = renderBoard();
        const card = await within(column('To do')).findByRole('link', {
            name: /Set up 301 redirects/,
        });
        expect(card).toHaveClass('cursor-grab');

        await u.click(card);

        expect(onOpen).toHaveBeenCalledWith('t1');
        expect(patches).toHaveLength(0);
    });

    it('a card the user can’t edit isn’t draggable but still opens', async () => {
        const u = renderBoard('MEMBER');
        const locked = await within(column('To do')).findByRole('link', { name: /Cookie banner/ });
        const mine = within(column('To do')).getByRole('link', { name: /Write launch email/ });
        expect(mine).toHaveAttribute('aria-roledescription', 'draggable');
        expect(locked).not.toHaveAttribute('aria-roledescription');
        expect(locked).not.toHaveClass('cursor-grab');

        await keyboardDrag(locked, ['ArrowRight'], 'Space');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(patches).toHaveLength(0);
        expect(within(column('To do')).getByText('Cookie banner')).toBeInTheDocument();

        await u.click(locked);
        expect(onOpen).toHaveBeenCalledWith('t4');
    });
});
