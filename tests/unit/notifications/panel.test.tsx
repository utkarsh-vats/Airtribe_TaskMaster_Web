/*
 * The header's notifications panel (12b): opens from the bell (from 820px; below it's a link),
 * the 10 newest as the page's rows, marking read on a plain click (optimistic) that navigates
 * and closes, not on a modified click, Mark all as read, View all, states, keyboard, a cache
 * shared with the page, and refetching on open only when stale.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardHeader } from '@/components/shell/DashboardHeader';
import { latestNotificationsKey } from '@/features/notifications/api';
import { NotificationsView } from '@/features/notifications/components/NotificationsView';
import type { Notification, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { queryKeys } from '@/lib/query/keys';

import { notificationsApi, type NotificationCalls } from '../../msw/notifications';
import { API_ORIGIN, server } from '../../msw/server';
import { refetchAndFail } from '../../refetch';

const nav = vi.hoisted(() => ({ pathname: '/dashboard/projects', search: '', push: vi.fn() }));
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
const TASK = { id: 't1', title: 'Finalise hero copy' };
const TASK_HREF = '/dashboard/projects/p1/tasks?task=t1';

/** TASK_ASSIGNED `minutesAgo` old (so n1 is the newest of n1…nN). */
const assigned = (id: string, minutesAgo: number, read = false): Notification => ({
    id,
    type: 'TASK_ASSIGNED',
    projectId: 'p1',
    taskId: 't1',
    payload: { actor: PRIYA, project: PROJECT, task: TASK },
    readAt: read ? '2026-11-13T09:00:00.000Z' : null,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

function mockApi(store: Notification[]): NotificationCalls {
    const calls: NotificationCalls = { gets: [], reads: [], readAll: 0 };
    server.use(...notificationsApi(store, calls));
    return calls;
}

/** The panel's GETs (limit 10), not the badge's (limit 1) or the page's (limit 20). */
const panelGets = (calls: NotificationCalls) => calls.gets.filter((q) => q.get('limit') === '10');

let client: QueryClient;

function renderHeader({ withPage = false } = {}) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (): ReactNode => (
        <QueryClientProvider client={client}>
            <DashboardHeader />
            {withPage && <NotificationsView />}
        </QueryClientProvider>
    );
    const result = render(ui());
    return { user: userEvent.setup(), rerender: () => result.rerender(ui()) };
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });
const panel = () => screen.getByRole('dialog', { name: 'Notifications' });
const panelList = () => within(panel()).getByRole('list', { name: 'Latest notifications' });
const panelRows = () => within(panelList()).getAllByRole('listitem');
const badgeLabel = () => bell().getAttribute('aria-label');

/** Click the bell and wait for the rows. */
async function openPanel(user: ReturnType<typeof userEvent.setup>) {
    await user.click(bell());
    return within(panel()).findByRole('list', { name: 'Latest notifications' });
}

beforeEach(() => {
    nav.pathname = '/dashboard/projects';
    nav.search = '';
    nav.push.mockClear();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.useRealTimers();
});

describe('opening', () => {
    it('the bell opens the panel with the 10 newest (page 1, limit 10, read or not)', async () => {
        const store = Array.from({ length: 12 }, (_, i) => assigned(`n${i + 1}`, i + 1, i >= 2));
        const calls = mockApi(store);
        const { user } = renderHeader();
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 2 unread'));
        expect(bell()).toHaveAttribute('aria-haspopup', 'dialog');
        expect(bell()).toHaveAttribute('aria-expanded', 'false');

        await openPanel(user);

        expect(bell()).toHaveAttribute('aria-expanded', 'true');
        expect(panelRows()).toHaveLength(10);
        const [query] = panelGets(calls);
        expect(query?.get('page')).toBe('1');
        expect(query?.has('unread')).toBe(false);
        expect(within(panel()).getByTestId('panel-unread-count')).toHaveTextContent('2 unread');
        // Newest first; the two unread ones are flagged.
        const flagged = panelRows().map((li) => li.hasAttribute('data-unread'));
        expect(flagged).toEqual([true, true, ...Array<boolean>(8).fill(false)]);
    });

    it('rows are the page’s: sentence with bold names, link, avatar, dot, time', async () => {
        mockApi([
            assigned('n1', 1),
            {
                id: 'n2',
                type: 'PROJECT_INVITATION',
                projectId: 'p1',
                taskId: null,
                payload: { actor: PRIYA, project: PROJECT, invitationId: 'i1', role: 'MEMBER' },
                readAt: '2026-11-13T09:00:00.000Z',
                createdAt: new Date(Date.now() - 120 * 60_000).toISOString(),
            },
        ]);
        const { user } = renderHeader();
        await openPanel(user);

        const [first, second] = panelRows() as [HTMLElement, HTMLElement];
        const link1 = within(first).getByRole('link', {
            name: 'Unread: Priya Raman assigned you Finalise hero copy',
        });
        expect(link1).toHaveAttribute('href', TASK_HREF);
        expect(within(first).getByText('Finalise hero copy').tagName).toBe('STRONG');
        expect(within(first).getByTestId('unread-dot')).toHaveClass('bg-accent');
        expect(within(first).getByText('PR')).toBeInTheDocument();
        expect(within(first).getByText('1 min ago')).toBeInTheDocument();

        expect(
            within(second).getByRole('link', {
                name: 'Priya Raman invited you to Website relaunch',
            }),
        ).toHaveAttribute('href', '/dashboard/invitations');
        expect(within(second).getByTestId('unread-dot')).toHaveClass('bg-transparent');
        expect(within(second).getByText('2 h ago')).toBeInTheDocument();
    });

    it('reopening while fresh doesn’t refetch; once stale it does, once', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const calls = mockApi([assigned('n1', 1)]);
        const { user } = renderHeader();

        await openPanel(user);
        await user.keyboard('{Escape}');
        await openPanel(user);
        expect(panelGets(calls)).toHaveLength(1);
        await user.keyboard('{Escape}');

        vi.setSystemTime(Date.now() + 31_000);
        await openPanel(user);
        await vi.waitFor(() => expect(panelGets(calls)).toHaveLength(2));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(panelGets(calls)).toHaveLength(2);
    });

    it('reopening refetches when the badge has moved past the cached list', async () => {
        const store = [assigned('n1', 2)];
        const calls = mockApi(store);
        const { user } = renderHeader();
        await openPanel(user);
        await user.keyboard('{Escape}');

        // The badge's poll sees a new one; the panel's list (still fresh) doesn't know it.
        store.unshift(assigned('n0', 1));
        await client.refetchQueries({ queryKey: queryKeys.notifications.unreadCount() });
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 2 unread'));

        await openPanel(user);
        await vi.waitFor(() => expect(panelRows()).toHaveLength(2));
        expect(panelGets(calls)).toHaveLength(2);
    });
});

describe('rows', () => {
    it('a plain click marks it read at once, navigates and closes the panel', async () => {
        const calls = mockApi([assigned('n1', 1), assigned('n2', 2)]);
        // The PATCH never answers: what changes is the optimistic update.
        server.use(
            http.patch(`${API_ORIGIN}/api/v1/notifications/:id/read`, async () => {
                await delay('infinite');
                return new HttpResponse(null, { status: 204 });
            }),
        );
        const { user } = renderHeader();
        await openPanel(user);
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 2 unread'));

        await user.click(within(panelRows()[0] as HTMLElement).getByRole('link'));

        expect(nav.push).toHaveBeenCalledExactlyOnceWith(TASK_HREF);
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 1 unread'));
        // Read in the panel's cache (what reopening shows), while the PATCH is still out.
        const cached = client.getQueryData<{ items: Notification[] }>(latestNotificationsKey());
        expect(cached?.items.map((n) => Boolean(n.readAt))).toEqual([true, false]);
        expect(calls.reads).toEqual([]);
    });

    it('a modified click just follows the link: not marked, panel stays', async () => {
        const calls = mockApi([assigned('n1', 1)]);
        const { user } = renderHeader();
        await openPanel(user);

        const link = within(panelRows()[0] as HTMLElement).getByRole('link');
        fireEvent.click(link, { ctrlKey: true });
        fireEvent.click(link, { metaKey: true });

        expect(calls.reads).toEqual([]);
        expect(nav.push).not.toHaveBeenCalled();
        expect(panel()).toBeInTheDocument();
        expect(panelRows()[0]).toHaveAttribute('data-unread');
    });

    it('Mark all as read: every row read, the panel count and the badge go to 0', async () => {
        const calls = mockApi([assigned('n1', 1), assigned('n2', 2), assigned('n3', 3, true)]);
        const { user } = renderHeader();
        await openPanel(user);
        await vi.waitFor(() =>
            expect(within(bell()).getByTestId('unread-badge')).toHaveTextContent('2'),
        );

        await user.click(within(panel()).getByRole('button', { name: 'Mark all as read' }));

        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications'));
        expect(within(bell()).queryByTestId('unread-badge')).not.toBeInTheDocument();
        expect(panelRows().some((li) => li.hasAttribute('data-unread'))).toBe(false);
        expect(within(panel()).getByTestId('panel-unread-count')).toHaveTextContent('0 unread');
        expect(within(panel()).getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
        await vi.waitFor(() => expect(calls.readAll).toBe(1));
    });

    it('Mark all as read is disabled at 0 unread', async () => {
        mockApi([assigned('n1', 1, true)]);
        const { user } = renderHeader();
        await openPanel(user);

        expect(within(panel()).getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    });

    it('marking read in the panel updates the page’s row and count too (one cache)', async () => {
        nav.pathname = '/dashboard/notifications';
        mockApi([assigned('n1', 1), assigned('n2', 2)]);
        const { user } = renderHeader({ withPage: true });
        const pageList = await screen.findByRole('list', { name: 'Notifications' });
        await openPanel(user);

        await user.click(within(panelRows()[1] as HTMLElement).getByRole('link'));

        await vi.waitFor(() =>
            expect(within(pageList).getAllByRole('listitem')[1]).not.toHaveAttribute('data-unread'),
        );
        expect(screen.getByTestId('unread-count')).toHaveTextContent('1 unread');
        expect(badgeLabel()).toBe('Notifications, 1 unread');
    });

    it('marking all read on the page clears the panel’s rows and the badge', async () => {
        nav.pathname = '/dashboard/notifications';
        mockApi([assigned('n1', 1), assigned('n2', 2)]);
        const { user } = renderHeader({ withPage: true });
        await openPanel(user);
        await user.keyboard('{Escape}');
        await screen.findByRole('list', { name: 'Notifications' });

        await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications'));

        await user.click(bell());
        await vi.waitFor(() =>
            expect(panelRows().some((li) => li.hasAttribute('data-unread'))).toBe(false),
        );
    });
});

describe('closing', () => {
    it('View all notifications goes to the page and closes the panel', async () => {
        mockApi([assigned('n1', 1)]);
        const { user } = renderHeader();
        await openPanel(user);

        const viewAll = within(panel()).getByRole('link', { name: 'View all notifications' });
        expect(viewAll).toHaveAttribute('href', '/dashboard/notifications');
        // next/link would navigate; here just the click handler matters.
        viewAll.addEventListener('click', (event) => event.preventDefault());
        await user.click(viewAll);

        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('a route change closes it', async () => {
        mockApi([assigned('n1', 1)]);
        const { user, rerender } = renderHeader();
        await openPanel(user);

        nav.pathname = '/dashboard/my-tasks';
        rerender();

        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(bell()).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('keyboard', () => {
    it('Enter opens with focus in the panel, Tab walks its actions, Esc returns to the bell', async () => {
        mockApi([assigned('n1', 1), assigned('n2', 2)]);
        const { user } = renderHeader();
        await vi.waitFor(() => expect(badgeLabel()).toBe('Notifications, 2 unread'));

        bell().focus();
        await user.keyboard('{Enter}');
        await within(panel()).findByRole('list', { name: 'Latest notifications' });
        expect(panel().contains(document.activeElement)).toBe(true);

        const [first, second] = panelRows() as [HTMLElement, HTMLElement];
        const markAll = within(panel()).getByRole('button', { name: 'Mark all as read' });
        const viewAll = within(panel()).getByRole('link', { name: 'View all notifications' });
        const order = [markAll, within(first).getByRole('link'), within(second).getByRole('link')];
        for (const target of [...order, viewAll]) {
            if (document.activeElement !== target) await user.tab();
            expect(target).toHaveFocus();
        }

        await user.keyboard('{Escape}');
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(bell()).toHaveFocus();
    });

    it('Space opens it too', async () => {
        mockApi([assigned('n1', 1)]);
        const { user } = renderHeader();

        bell().focus();
        await user.keyboard(' ');

        expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    });
});

describe('states', () => {
    it('empty: "You’re all caught up"', async () => {
        mockApi([]);
        const { user } = renderHeader();
        await user.click(bell());

        expect(await within(panel()).findByText("You're all caught up")).toBeInTheDocument();
    });

    it('loading: 3 skeleton rows', async () => {
        mockApi([]);
        server.use(
            http.get(`${API_ORIGIN}/api/v1/notifications`, async ({ request }) => {
                if (new URL(request.url).searchParams.get('limit') !== '10') return undefined;
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        const { user } = renderHeader();
        await user.click(bell());

        const busy = within(panel()).getByText('Loading notifications…').parentElement;
        expect(busy).toHaveAttribute('aria-busy', 'true');
        expect(busy?.children).toHaveLength(4); // the sr-only text + 3 rows
    });

    it('error: compact ErrorState; Try again loads it', async () => {
        const calls = mockApi([assigned('n1', 1)]);
        let fail = true;
        server.use(
            http.get(`${API_ORIGIN}/api/v1/notifications`, ({ request }) => {
                if (new URL(request.url).searchParams.get('limit') !== '10' || !fail) {
                    return undefined;
                }
                return HttpResponse.json(
                    { error: { code: 'INTERNAL', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                );
            }),
        );
        const { user } = renderHeader();
        await user.click(bell());

        const alert = await within(panel()).findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load notifications");
        fail = false;
        await user.click(within(alert).getByRole('button', { name: 'Try again' }));

        await within(panel()).findByRole('list', { name: 'Latest notifications' });
        expect(panelGets(calls)).toHaveLength(1); // the store saw only the successful one
    });

    it('a failed background refetch keeps the rows', async () => {
        mockApi([assigned('n1', 1)]);
        const { user } = renderHeader();
        await openPanel(user);

        server.use(
            http.get(`${API_ORIGIN}/api/v1/notifications`, () =>
                HttpResponse.json(
                    { error: { code: 'INTERNAL', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                ),
            ),
        );
        await refetchAndFail(client, latestNotificationsKey());

        expect(panelRows()).toHaveLength(1);
        expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('below 820px', () => {
    it('the bell is a link to the page, with the badge; the panel trigger is hidden', async () => {
        mockApi([assigned('n1', 1), assigned('n2', 2)]);
        renderHeader();

        const link = await screen.findByRole('link', { name: 'Notifications, 2 unread' });
        expect(link).toHaveAttribute('href', '/dashboard/notifications');
        expect(link).toHaveClass('md:hidden');
        expect(within(link).getByTestId('unread-badge')).toHaveTextContent('2');
        // The Popover trigger only shows from 820px.
        expect(bell()).toHaveClass('hidden', 'md:inline-flex');
    });
});
