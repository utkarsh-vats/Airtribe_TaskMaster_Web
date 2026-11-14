/*
 * /dashboard/notifications (12a): rows with their sentences (names bold) and links, All | Unread
 * in the URL (the API filters), marking one read on a plain click (optimistic, rolled back on
 * failure) — not on a modified click — Mark all as read, the unread count, pages and states.
 * The MSW API (tests/msw/notifications.ts) filters and counts like the real one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { NotificationsView } from '@/features/notifications/components/NotificationsView';
import type { Notification, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { notificationsApi, type NotificationCalls } from '../../msw/notifications';
import { API_ORIGIN, server } from '../../msw/server';
import { refetchAndFail } from '../../refetch';

const PATH = '/dashboard/notifications';
const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/notifications',
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const me: User = {
    id: 'u-me',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};
const PRIYA = { id: 'u2', name: 'Priya Raman' };
const PROJECT = { id: 'p1', name: 'Website relaunch' };
const TASK = { id: 't1', title: 'Finalise hero copy' };

let seq = 0;
/** A notification `minutesAgo` old (newer ones get smaller numbers). */
const note = (
    id: string,
    type: Notification['type'],
    payload: Record<string, unknown>,
    { read = false, taskId = null as string | null, minutesAgo = 0 } = {},
): Notification => {
    seq += 1;
    return {
        id,
        type,
        projectId: 'p1',
        taskId,
        payload,
        readAt: read ? '2026-11-13T09:00:00.000Z' : null,
        createdAt: new Date(Date.now() - (minutesAgo || seq) * 60_000).toISOString(),
    };
};

const assigned = (id: string, opts = {}) =>
    note(
        id,
        'TASK_ASSIGNED',
        { actor: PRIYA, project: PROJECT, task: TASK },
        {
            taskId: 't1',
            ...opts,
        },
    );

function mockApi(store: Notification[]): NotificationCalls {
    const calls: NotificationCalls = { gets: [], reads: [], readAll: 0 };
    server.use(...notificationsApi(store, calls));
    return calls;
}

let client: QueryClient;
let urlPush: MockInstance<(url: string) => void>;

function renderPage(search = '') {
    nav.search = search;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (): ReactNode => (
        <QueryClientProvider client={client}>
            <NotificationsView />
        </QueryClientProvider>
    );
    const result = render(ui());
    return {
        user: userEvent.setup(),
        navigate(next: string) {
            nav.search = next;
            result.rerender(ui());
        },
    };
}

const list = () => screen.getByRole('list', { name: 'Notifications' });
const rows = () => within(list()).getAllByRole('listitem');
const rowLink = (name: RegExp) => within(list()).getByRole('link', { name });
const unreadText = () => screen.getByTestId('unread-count');
const listGets = (calls: NotificationCalls) => calls.gets.filter((q) => q.get('limit') === '20');

/** From now on the list never answers: what's on screen is the cache, not a refetch. */
const holdRefetches = () =>
    server.use(
        http.get(`${API_ORIGIN}/api/v1/notifications`, async () => {
            await delay('infinite');
            return HttpResponse.json({});
        }),
    );

beforeEach(() => {
    seq = 0;
    nav.push.mockClear();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('rows', () => {
    it('each type as a sentence (names bold), linking to what it’s about; unread ones flagged', async () => {
        mockApi([
            assigned('n1', { minutesAgo: 1 }),
            note(
                'n2',
                'COMMENT_REPLY',
                {
                    actor: PRIYA,
                    project: PROJECT,
                    commentId: 'c2',
                    parentId: 'c1',
                    commentPreview: 'Agreed',
                },
                { read: true, minutesAgo: 2 },
            ),
            note(
                'n3',
                'PROJECT_INVITATION',
                { actor: PRIYA, project: PROJECT, invitationId: 'i1', role: 'MEMBER' },
                { minutesAgo: 3 },
            ),
        ]);
        renderPage();

        await screen.findByRole('list', { name: 'Notifications' });
        expect(rows()).toHaveLength(3);

        const first = rowLink(/assigned you/);
        expect(first).toHaveAccessibleName('Unread: Priya Raman assigned you Finalise hero copy');
        expect(first).toHaveAttribute('href', '/dashboard/projects/p1/tasks?task=t1');
        expect(within(first).getByText('Finalise hero copy').tagName).toBe('STRONG');
        expect(within(first).getByRole('img', { name: 'Priya Raman' })).toBeInTheDocument();
        expect(within(first).getAllByText('1 min ago')[0]?.tagName).toBe('TIME');

        const reply = rowLink(/replied/);
        expect(reply).toHaveAccessibleName('Priya Raman replied to your comment: “Agreed”');
        expect(reply).toHaveAttribute('href', '/dashboard/projects/p1/discussion');

        const invite = rowLink(/invited you/);
        expect(invite).toHaveAttribute('href', '/dashboard/invitations');
        expect(within(invite).getByText('Website relaunch').tagName).toBe('STRONG');

        // The unread dot: shown on unread rows only.
        expect(rows().map((li) => li.hasAttribute('data-unread'))).toEqual([true, false, true]);
        expect(unreadText()).toHaveTextContent('2 unread');
    });
});

describe('All | Unread', () => {
    it('Unread writes ?unread=1; the API filters (unread=true)', async () => {
        const calls = mockApi([assigned('n1'), assigned('n2', { read: true })]);
        const view = renderPage('page=2');
        await screen.findByRole('radiogroup', { name: 'Show' });
        expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();

        await view.user.click(screen.getByRole('radio', { name: 'Unread' }));
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?unread=1`);

        view.navigate('unread=1');
        await vi.waitFor(() => expect(listGets(calls).at(-1)?.get('unread')).toBe('true'));
        await vi.waitFor(() => expect(rows()).toHaveLength(1));
        expect(screen.getByRole('radio', { name: 'Unread' })).toBeChecked();

        await view.user.click(screen.getByRole('radio', { name: 'All' }));
        expect(urlPush).toHaveBeenLastCalledWith(PATH);
    });

    it('nothing unread: "No unread notifications"', async () => {
        mockApi([assigned('n1', { read: true })]);
        renderPage('unread=1');

        expect(
            await screen.findByRole('heading', { name: 'No unread notifications' }),
        ).toBeVisible();
        expect(unreadText()).toHaveTextContent('0 unread');
        expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    });
});

describe('marking one read', () => {
    it('a plain click marks it read at once (dot and count) and goes to its link', async () => {
        const store = [assigned('n1'), assigned('n2')];
        const calls = mockApi(store);
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        server.use(
            http.patch(`${API_ORIGIN}/api/v1/notifications/:id/read`, async ({ params }) => {
                calls.reads.push(String(params.id));
                await held;
                const n = store.find((item) => item.id === params.id) as Notification;
                n.readAt = new Date().toISOString();
                return new HttpResponse(null, { status: 204 });
            }),
        );
        const view = renderPage();
        await screen.findByRole('list', { name: 'Notifications' });
        client.setQueryData(queryKeys.notifications.unreadCount(), 2);
        expect(unreadText()).toHaveTextContent('2 unread');

        await view.user.click(rows()[0]?.querySelector('a') as HTMLElement);

        expect(nav.push).toHaveBeenCalledWith('/dashboard/projects/p1/tasks?task=t1');
        expect(calls.reads).toEqual(['n1']);
        // Before the server answers: read, and one fewer unread — here and in the header's count.
        await vi.waitFor(() => expect(rows()[0]).not.toHaveAttribute('data-unread'));
        expect(unreadText()).toHaveTextContent('1 unread');
        expect(client.getQueryData(queryKeys.notifications.unreadCount())).toBe(1);

        release();
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
        expect(unreadText()).toHaveTextContent('1 unread');
    });

    it('a failure (500) puts it back to unread, with an error toast', async () => {
        mockApi([assigned('n1')]);
        server.use(
            http.patch(`${API_ORIGIN}/api/v1/notifications/:id/read`, () =>
                HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                ),
            ),
        );
        const view = renderPage();
        await screen.findByRole('list', { name: 'Notifications' });
        // The refetch after the failure never answers: only the rollback can restore it.
        holdRefetches();

        await view.user.click(rows()[0]?.querySelector('a') as HTMLElement);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        await vi.waitFor(() => expect(rows()[0]).toHaveAttribute('data-unread'));
        expect(unreadText()).toHaveTextContent('1 unread');
        expect(client.isFetching()).toBeGreaterThan(0);
    });

    it('a modified click (new tab) just follows the link: nothing marked, no navigation here', async () => {
        const calls = mockApi([assigned('n1')]);
        renderPage();
        await screen.findByRole('list', { name: 'Notifications' });

        const link = rows()[0]?.querySelector('a') as HTMLElement;
        fireEvent.click(link, { ctrlKey: true });
        fireEvent.click(link, { metaKey: true });

        expect(calls.reads).toEqual([]);
        expect(nav.push).not.toHaveBeenCalled();
        expect(rows()[0]).toHaveAttribute('data-unread');
    });

    it('a row already read: a click just goes there', async () => {
        const calls = mockApi([assigned('n1', { read: true })]);
        const view = renderPage();
        await screen.findByRole('list', { name: 'Notifications' });

        await view.user.click(rows()[0]?.querySelector('a') as HTMLElement);

        expect(nav.push).toHaveBeenCalledWith('/dashboard/projects/p1/tasks?task=t1');
        expect(calls.reads).toEqual([]);
    });
});

describe('Mark all as read', () => {
    it('everything read at once, the count 0, the button disabled; one POST', async () => {
        const calls = mockApi([assigned('n1'), assigned('n2'), assigned('n3', { read: true })]);
        const view = renderPage();
        await screen.findByRole('list', { name: 'Notifications' });
        const button = screen.getByRole('button', { name: 'Mark all as read' });
        expect(button).toBeEnabled();

        await view.user.click(button);

        await vi.waitFor(() =>
            expect(rows().some((li) => li.hasAttribute('data-unread'))).toBe(false),
        );
        expect(unreadText()).toHaveTextContent('0 unread');
        await vi.waitFor(() => expect(button).toBeDisabled());
        expect(calls.readAll).toBe(1);
    });

    it('a failure puts every unread one back, with an error toast', async () => {
        mockApi([assigned('n1'), assigned('n2')]);
        server.use(
            http.post(`${API_ORIGIN}/api/v1/notifications/read-all`, () =>
                HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                ),
            ),
        );
        const view = renderPage();
        await screen.findByRole('list', { name: 'Notifications' });
        holdRefetches();

        await view.user.click(screen.getByRole('button', { name: 'Mark all as read' }));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        await vi.waitFor(() => expect(unreadText()).toHaveTextContent('2 unread'));
        expect(rows().every((li) => li.hasAttribute('data-unread'))).toBe(true);
        expect(client.isFetching()).toBeGreaterThan(0);
    });
});

describe('pages and states', () => {
    it('20 a page; Next goes to page 2', async () => {
        const calls = mockApi(Array.from({ length: 25 }, (_, i) => assigned(`n${i + 1}`)));
        const view = renderPage();
        await screen.findByRole('list', { name: 'Notifications' });
        expect(rows()).toHaveLength(20);

        await view.user.click(screen.getByRole('button', { name: /Next/ }));
        expect(urlPush).toHaveBeenLastCalledWith(`${PATH}?page=2`);

        view.navigate('page=2');
        await vi.waitFor(() => expect(rows()).toHaveLength(5));
        expect(listGets(calls).at(-1)?.get('page')).toBe('2');
    });

    it('empty: "You\'re all caught up"', async () => {
        mockApi([]);
        renderPage();

        expect(await screen.findByRole('heading', { name: "You're all caught up" })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    });

    it('loading: skeleton rows', () => {
        mockApi([]);
        server.use(
            http.get(`${API_ORIGIN}/api/v1/notifications`, async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        renderPage();

        expect(screen.getByText('Loading notifications…').parentElement).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });

    it('error, then Try again', async () => {
        let fail = true;
        mockApi([assigned('n1')]);
        server.use(
            http.get(`${API_ORIGIN}/api/v1/notifications`, () =>
                fail
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                          { status: 500 },
                      )
                    : undefined,
            ),
        );
        const view = renderPage();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load notifications");
        fail = false;
        await view.user.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByRole('list', { name: 'Notifications' })).toBeVisible();
    });

    it('a background refetch that fails keeps the rows', async () => {
        mockApi([assigned('n1')]);
        renderPage();
        await screen.findByRole('list', { name: 'Notifications' });

        server.use(
            http.get(`${API_ORIGIN}/api/v1/notifications`, () =>
                HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                ),
            ),
        );
        await refetchAndFail(client, queryKeys.notifications.list({ page: 1, limit: 20 }));

        expect(rows()).toHaveLength(1);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
