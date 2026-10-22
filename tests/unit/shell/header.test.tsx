import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { DashboardHeader, formatBadge } from '@/components/shell/DashboardHeader';
import type { User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { shallowUrl } from '@/lib/hooks/shallowUrl';

import { API_ORIGIN, server } from '../../msw/server';

/** What next/navigation reports; tests set the current URL. */
const nav = vi.hoisted(() => ({
    pathname: '/dashboard/my-tasks',
    search: '',
    push: vi.fn(),
    replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
    usePathname: () => nav.pathname,
    useSearchParams: () => new URLSearchParams(nav.search),
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));

const user: User = {
    id: '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};

/** GET /notifications?unread=true&limit=1 answering with this unread count. */
function mockUnread(unreadCount: number) {
    const seen: { query: string | null } = { query: null };
    server.use(
        http.get(`${API_ORIGIN}/api/v1/notifications`, ({ request }) => {
            seen.query = new URL(request.url).search;
            return HttpResponse.json({
                data: [],
                meta: { page: 1, limit: 1, total: unreadCount, totalPages: 1, unreadCount },
            });
        }),
    );
    return seen;
}

function renderHeader(path = '/dashboard/my-tasks', search = '', onOpenNav = vi.fn()) {
    nav.pathname = path;
    nav.search = search;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <DashboardHeader onOpenNav={onOpenNav} />
        </QueryClientProvider>,
    );
    return { onOpenNav, user: userEvent.setup() };
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Search tasks' });

/** Same-page ?q updates use shallowUrl; going to My tasks uses the router. */
let urlPush: MockInstance<(url: string) => void>;

beforeEach(() => {
    urlPush = vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user });
    nav.push.mockClear();
    nav.replace.mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    urlPush.mockRestore();
});

describe('search', () => {
    it('on a project task list sets ?q, keeps other params and resets page', async () => {
        mockUnread(0);
        const { user: u } = renderHeader(
            '/dashboard/projects/p1/tasks',
            'view=board&page=3&priority=HIGH',
        );

        await u.type(searchBox(), 'hero copy{Enter}');

        expect(urlPush).toHaveBeenCalledExactlyOnceWith(
            '/dashboard/projects/p1/tasks?view=board&priority=HIGH&q=hero+copy',
        );
        expect(nav.push).not.toHaveBeenCalled();
    });

    it('elsewhere opens My tasks with ?q', async () => {
        mockUnread(0);
        const { user: u } = renderHeader('/dashboard/projects');

        await u.type(searchBox(), 'redirects{Enter}');

        expect(nav.push).toHaveBeenCalledExactlyOnceWith('/dashboard/my-tasks?q=redirects');
    });

    it('shows the current ?q on a search route, and an empty search clears it', async () => {
        mockUnread(0);
        const { user: u } = renderHeader('/dashboard/my-tasks', 'q=hero&page=2');

        expect(searchBox()).toHaveValue('hero');
        await u.clear(searchBox());
        await u.type(searchBox(), '{Enter}');

        expect(urlPush).toHaveBeenCalledExactlyOnceWith('/dashboard/my-tasks');
    });

    it('ignores ?q on routes that are not task lists', () => {
        mockUnread(0);
        renderHeader('/dashboard/profile', 'q=something');

        expect(searchBox()).toHaveValue('');
    });

    it('"/" focuses the search; Esc clears and blurs', async () => {
        mockUnread(0);
        const { user: u } = renderHeader();

        await u.keyboard('/');
        expect(searchBox()).toHaveFocus();
        expect(searchBox()).toHaveValue(''); // the "/" itself isn't typed

        await u.type(searchBox(), 'abc');
        await u.keyboard('{Escape}');
        expect(searchBox()).toHaveValue('');
        expect(searchBox()).not.toHaveFocus();
    });

    it('typing "/" inside another field does not steal focus', async () => {
        mockUnread(0);
        const { user: u } = renderHeader();
        const other = document.createElement('input');
        other.setAttribute('aria-label', 'Other field');
        document.body.append(other);

        await u.click(other);
        await u.keyboard('a/b');

        expect(other).toHaveFocus();
        expect(other).toHaveValue('a/b');
        other.remove();
    });
});

describe('notifications button', () => {
    it('links to /dashboard/notifications and asks only for the unread count', async () => {
        const seen = mockUnread(0);
        renderHeader();

        const link = screen.getByRole('link', { name: 'Notifications' });
        expect(link).toHaveAttribute('href', '/dashboard/notifications');
        await vi.waitFor(() => expect(seen.query).toBe('?unread=true&limit=1'));
    });

    it('hides the badge at 0', async () => {
        const seen = mockUnread(0);
        renderHeader();

        await vi.waitFor(() => expect(seen.query).not.toBeNull());
        expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    });

    it('shows the count and puts it in the label', async () => {
        mockUnread(3);
        renderHeader();

        const link = await screen.findByRole('link', { name: 'Notifications, 3 unread' });
        expect(within(link).getByTestId('unread-badge')).toHaveTextContent('3');
    });

    it('shows 99+ above 99', async () => {
        mockUnread(140);
        renderHeader();

        const link = await screen.findByRole('link', { name: 'Notifications, 140 unread' });
        expect(within(link).getByTestId('unread-badge')).toHaveTextContent('99+');
        expect(formatBadge(99)).toBe('99');
        expect(formatBadge(100)).toBe('99+');
    });
});

describe('header chrome', () => {
    it('the menu button calls onOpenNav', async () => {
        mockUnread(0);
        const { onOpenNav, user: u } = renderHeader();

        await u.click(screen.getByRole('button', { name: 'Open navigation' }));

        expect(onOpenNav).toHaveBeenCalledOnce();
    });

    it('the brand links to /dashboard', () => {
        mockUnread(0);
        renderHeader();

        expect(screen.getByRole('link', { name: 'TaskMaster' })).toHaveAttribute(
            'href',
            '/dashboard',
        );
    });

    it("the profile menu's Profile item links to /dashboard/profile", async () => {
        mockUnread(0);
        const { user: u } = renderHeader();

        await u.click(screen.getByRole('button', { name: `Account menu for ${user.name}` }));
        const profile = screen.getByRole('menuitem', { name: 'Profile' });

        expect(profile).toHaveAttribute('href', '/dashboard/profile');
        expect(profile).not.toHaveAttribute('aria-disabled');
    });
});
