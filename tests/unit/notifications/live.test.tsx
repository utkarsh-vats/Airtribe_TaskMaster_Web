/*
 * Live notifications in the app (12c-1): an event lands in the badge, the panel and the page
 * (page 1 only) with a toast whose Open marks it read and goes there; repeats and malformed
 * events are ignored; a reopened tab catches up; sign-out (here or in another tab) aborts the
 * stream and sign-in starts it; the unread poll is off while the stream is open.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as sse from '@microsoft/fetch-event-source';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardHeader } from '@/components/shell/DashboardHeader';
import {
    addNotificationToCache,
    latestNotificationsKey,
    NOTIFICATIONS_PAGE_SIZE,
} from '@/features/notifications/api';
import { NotificationsView } from '@/features/notifications/components/NotificationsView';
import { NotificationStream } from '@/features/notifications/useNotificationStream';
import type { Notification, User } from '@/lib/api/types';
import { resetSignOutForTests } from '@/lib/auth/actions';
import { AuthBroadcastListener } from '@/lib/auth/AuthBroadcastListener';
import { closeAuthChannelForTests } from '@/lib/auth/broadcast';
import { authNavigation } from '@/lib/auth/navigation';
import { endSession, resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { queryKeys } from '@/lib/query/keys';
import { streamState } from '@/lib/realtime/notificationStream';

import {
    mockStreamFetch,
    networkDown,
    setTabHidden,
    streamOk,
    type createFakeEventSource,
} from '../../fakeEventSource';
import { notificationsApi, type NotificationCalls } from '../../msw/notifications';
import { server } from '../../msw/server';

vi.mock('@microsoft/fetch-event-source', async () => {
    const { createFakeEventSource } = await import('../../fakeEventSource');
    const fake = createFakeEventSource();
    return {
        EventStreamContentType: 'text/event-stream',
        fetchEventSource: fake.fetchEventSource,
        fake,
    };
});
const fake = (sse as unknown as { fake: ReturnType<typeof createFakeEventSource> }).fake;

const nav = vi.hoisted(() => ({ pathname: '/dashboard/notifications', search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => nav.pathname,
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

const assigned = (id: string, title: string, minutesAgo: number, read = false): Notification => ({
    id,
    type: 'TASK_ASSIGNED',
    projectId: 'p1',
    taskId: `t-${id}`,
    payload: { actor: PRIYA, project: PROJECT, task: { id: `t-${id}`, title } },
    readAt: read ? '2026-11-13T09:00:00.000Z' : null,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});
const LIVE = () => assigned('n9', 'Ship the launch post', 0);
const LIVE_TEXT = 'Priya Raman assigned you Ship the launch post';

function mockApi(store: Notification[]): NotificationCalls {
    const calls: NotificationCalls = { gets: [], reads: [], readAll: 0 };
    server.use(...notificationsApi(store, calls));
    return calls;
}
const unreadGets = (calls: NotificationCalls) => calls.gets.filter((q) => q.get('limit') === '1');

let client: QueryClient;
function renderApp({ page = false, listener = false } = {}) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (): ReactNode => (
        <QueryClientProvider client={client}>
            {listener && <AuthBroadcastListener />}
            <NotificationStream />
            <DashboardHeader />
            {page && <NotificationsView />}
        </QueryClientProvider>
    );
    render(ui());
    return { user: userEvent.setup() };
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });
const badgeLabel = () => bell().getAttribute('aria-label');
const pageRows = () =>
    within(screen.getByRole('list', { name: 'Notifications' })).getAllByRole('listitem');
const panelRows = () =>
    within(screen.getByRole('list', { name: 'Latest notifications' })).getAllByRole('listitem');

/** The first toast's text and its action (label + onClick). */
function firstToast() {
    const [text, options] = vi.mocked(toast).mock.calls[0] ?? [];
    return { text, action: options?.action as unknown as { label: string; onClick: () => void } };
}

/** Deliver `n` over the open stream. */
const push = (n: Notification | string) =>
    act(() =>
        fake.latest().emit({
            event: 'notification',
            data: typeof n === 'string' ? n : JSON.stringify(n),
        }),
    );

beforeEach(() => {
    fake.reset();
    nav.pathname = '/dashboard/notifications';
    nav.push.mockClear();
    vi.mocked(toast).mockClear();
    sessionStore.reset();
    resetRefreshForTests();
    resetSignOutForTests();
    startSession({ accessToken: 'at-1', expiresIn: 900, user: me });
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetRefreshForTests();
    closeAuthChannelForTests();
    setTabHidden(false);
});

describe('a notification event', () => {
    it('badge +1, first in the panel and the page, toast with Open (marks read, goes there)', async () => {
        const store = [assigned('n1', 'Finalise hero copy', 5)];
        const calls = mockApi(store);
        mockStreamFetch();
        const { user } = renderApp({ page: true });
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        await user.click(bell());
        await screen.findByRole('list', { name: 'Latest notifications' });
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 1 unread'));
        const gets = calls.gets.length;

        // The server created it (later refetches see it) and pushes it.
        const live = LIVE();
        store.unshift({ ...live });
        await push(live);

        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 2 unread'));
        // Straight into the cache: the event itself fetched nothing.
        expect(calls.gets).toHaveLength(gets);
        expect(panelRows()).toHaveLength(2);
        expect(within(panelRows()[0] as HTMLElement).getByRole('link')).toHaveAccessibleName(
            `Unread: ${LIVE_TEXT}`,
        );
        expect(pageRows()).toHaveLength(2);
        expect(within(pageRows()[0] as HTMLElement).getByRole('link')).toHaveAccessibleName(
            `Unread: ${LIVE_TEXT}`,
        );
        expect(screen.getByTestId('unread-count')).toHaveTextContent('2 unread');

        expect(toast).toHaveBeenCalledOnce();
        const { text, action } = firstToast();
        expect(text).toBe(LIVE_TEXT);
        expect(action.label).toBe('Open');

        act(() => action.onClick());

        expect(nav.push).toHaveBeenCalledExactlyOnceWith('/dashboard/projects/p1/tasks?task=t-n9');
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 1 unread'));
        expect(pageRows()[0]).not.toHaveAttribute('data-unread');
        await vi.waitFor(() => expect(calls.reads).toEqual(['n9']));
    });

    it('Open on one read meanwhile just goes there', async () => {
        const store: Notification[] = [];
        const calls = mockApi(store);
        mockStreamFetch();
        renderApp({ page: true });
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        await screen.findByText("You're all caught up");

        store.push(LIVE());
        await push(LIVE());
        await vi.waitFor(() => expect(pageRows()).toHaveLength(1));
        await userEvent.setup().click(screen.getByRole('button', { name: 'Mark all as read' }));
        await vi.waitFor(() => expect(calls.readAll).toBe(1));

        act(() => firstToast().action.onClick());

        expect(nav.push).toHaveBeenCalledOnce();
        expect(calls.reads).toEqual([]);
    });

    it('an id the cache already has: ignored — no toast, no count', async () => {
        const existing = assigned('n1', 'Finalise hero copy', 5);
        mockApi([existing]);
        mockStreamFetch();
        renderApp({ page: true });
        await screen.findByRole('list', { name: 'Notifications' });
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 1 unread'));

        await push(existing);

        expect(toast).not.toHaveBeenCalled();
        expect(badgeLabel()).toBe('Notifications, 1 unread');
        expect(pageRows()).toHaveLength(1);
    });

    it('the same id twice with no list cached: counted and toasted once', async () => {
        nav.pathname = '/dashboard/projects';
        mockApi([]);
        mockStreamFetch();
        renderApp();
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        await vi.waitFor(() =>
            expect(client.getQueryData(queryKeys.notifications.unreadCount())).toBe(0),
        );

        await push(LIVE());
        await push(LIVE());

        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 1 unread'));
        expect(toast).toHaveBeenCalledOnce();
    });

    it('malformed events are ignored', async () => {
        mockApi([]);
        mockStreamFetch();
        renderApp({ page: true });
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        await screen.findByText("You're all caught up");

        await push('{"oops"');
        await push(JSON.stringify({ id: 'n7' }));
        await push(JSON.stringify({ ...LIVE(), readAt: 7 }));

        expect(toast).not.toHaveBeenCalled();
        expect(screen.getByText("You're all caught up")).toBeInTheDocument();
        expect(badgeLabel()).toBe('Notifications');
        expect(streamState.get()).toBe('open');
    });
});

describe('the cache', () => {
    const page = (items: Notification[], meta: Partial<Record<string, number>> = {}) => ({
        items,
        meta: { page: 1, limit: 20, total: items.length, totalPages: 1, unreadCount: 1, ...meta },
    });

    it('prepended to page-1 lists it belongs on; later pages only go stale', () => {
        const old = assigned('n1', 'Old', 5);
        const qc = new QueryClient();
        const keys = {
            latest: latestNotificationsKey(),
            all: queryKeys.notifications.list({ page: 1, limit: NOTIFICATIONS_PAGE_SIZE }),
            unread: queryKeys.notifications.list({ page: 1, limit: 20, unread: 'true' }),
            read: queryKeys.notifications.list({ page: 1, limit: 20, unread: 'false' }),
            page2: queryKeys.notifications.list({ page: 2, limit: 20 }),
        };
        const ten = Array.from({ length: 10 }, (_, i) => assigned(`m${i}`, `T${i}`, i + 1));
        qc.setQueryData(keys.latest, page(ten, { limit: 10, total: 25, totalPages: 3 }));
        qc.setQueryData(keys.all, page([old]));
        qc.setQueryData(keys.unread, page([old]));
        qc.setQueryData(keys.read, page([], { total: 0 }));
        qc.setQueryData(keys.page2, page([old], { page: 2, total: 21, totalPages: 2 }));
        qc.setQueryData(queryKeys.notifications.unreadCount(), 1);

        expect(addNotificationToCache(qc, LIVE())).toBe(true);

        type Page = ReturnType<typeof page>;
        const get = (key: readonly unknown[]) => qc.getQueryData<Page>(key);
        // The panel's 10: the new one first, still 10.
        expect(get(keys.latest)?.items.map((n) => n.id)).toEqual([
            'n9',
            ...ten.slice(0, 9).map((n) => n.id),
        ]);
        expect(get(keys.latest)?.meta).toMatchObject({ total: 26, totalPages: 3, unreadCount: 2 });
        expect(get(keys.all)?.items.map((n) => n.id)).toEqual(['n9', 'n1']);
        expect(get(keys.all)?.meta).toMatchObject({ total: 2, unreadCount: 2 });
        expect(get(keys.unread)?.items.map((n) => n.id)).toEqual(['n9', 'n1']);
        // Read only: not its list (only the shared count moves).
        expect(get(keys.read)?.items).toEqual([]);
        expect(get(keys.read)?.meta).toMatchObject({ total: 0, unreadCount: 2 });
        // Page 2 keeps its rows (it refetches when visited).
        expect(get(keys.page2)?.items.map((n) => n.id)).toEqual(['n1']);
        expect(get(keys.page2)?.meta).toMatchObject({ total: 21, unreadCount: 2 });
        expect(qc.getQueryState(keys.page2)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(keys.all)?.isInvalidated).toBe(false);
        expect(qc.getQueryData(queryKeys.notifications.unreadCount())).toBe(2);

        // Again: already there, nothing changes.
        expect(addNotificationToCache(qc, LIVE())).toBe(false);
        expect(qc.getQueryData(queryKeys.notifications.unreadCount())).toBe(2);
    });
});

describe('connection', () => {
    it('hidden → visible: reconnects and refetches the notifications', async () => {
        const calls = mockApi([assigned('n1', 'Finalise hero copy', 5)]);
        const stream = mockStreamFetch();
        renderApp({ page: true });
        await screen.findByRole('list', { name: 'Notifications' });
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        const unread = unreadGets(calls).length;
        const lists = calls.gets.filter((q) => q.get('limit') === '20').length;

        act(() => setTabHidden(true));
        act(() => setTabHidden(false));

        await vi.waitFor(() => expect(stream.requests).toHaveLength(2));
        await vi.waitFor(() => expect(unreadGets(calls).length).toBe(unread + 1));
        expect(calls.gets.filter((q) => q.get('limit') === '20').length).toBe(lists + 1);
    });

    it('sign-out aborts the stream; signing in starts it with the new token', async () => {
        mockApi([]);
        const stream = mockStreamFetch();
        renderApp();
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        const first = fake.latest();

        act(() => endSession());

        expect(first.closed).toBe(true);
        expect(streamState.get()).toBe('stopped');

        act(() => startSession({ accessToken: 'at-9', expiresIn: 900, user: me }));

        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        expect(stream.auth()).toEqual(['Bearer at-1', 'Bearer at-9']);
    });

    it('sign-out in another tab (tm-auth) aborts it', async () => {
        window.history.pushState({}, '', '/dashboard/projects');
        const assign = vi.spyOn(authNavigation, 'assign').mockImplementation(() => {});
        mockApi([]);
        mockStreamFetch();
        renderApp({ listener: true });
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        const first = fake.latest();

        const other = new BroadcastChannel('tm-auth');
        other.postMessage({ type: 'signed-out', tabId: 'another-tab' });

        await vi.waitFor(() => expect(first.closed).toBe(true));
        expect(streamState.get()).toBe('stopped');
        expect(assign).toHaveBeenCalledWith('/login');
        other.close();
        window.history.pushState({}, '', '/');
    });

    it('signed out from the start: no stream', async () => {
        sessionStore.setUnauthenticated();
        mockApi([]);
        const stream = mockStreamFetch();
        renderApp();

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(stream.requests).toHaveLength(0);
        expect(streamState.get()).toBe('stopped');
    });
});

describe('the unread poll', () => {
    it('is off while the stream is open, and back every 60 s while it isn’t', async () => {
        // Only intervals are fake: the poll is TanStack's refetchInterval.
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        nav.pathname = '/dashboard/projects';
        const calls = mockApi([]);
        // The first connect opens; every reconnect after the drop fails.
        mockStreamFetch([streamOk], networkDown);
        renderApp();
        await vi.waitFor(() => expect(streamState.get()).toBe('open'));
        await vi.waitFor(() => expect(unreadGets(calls)).toHaveLength(1));

        await act(() => vi.advanceTimersByTimeAsync(130_000));
        expect(unreadGets(calls)).toHaveLength(1);

        act(() => fake.latest().drop());
        await vi.waitFor(() => expect(streamState.get()).toBe('retrying'));
        await act(() => vi.advanceTimersByTimeAsync(60_000));

        await vi.waitFor(() => expect(unreadGets(calls)).toHaveLength(2));
    });
});
