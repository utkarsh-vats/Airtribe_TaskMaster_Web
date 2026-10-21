import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type * as Sonner from 'sonner';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { ProfileMenu } from '@/components/shell/ProfileMenu';
import type { User } from '@/lib/api/types';
import * as actions from '@/lib/auth/actions';
import {
    resetSignOutForTests,
    signOut,
    signOutEverywhere,
    SIGNED_OUT_EVERYWHERE,
    SIGNED_OUT_HERE_ONLY,
} from '@/lib/auth/actions';
import { AuthBroadcastListener } from '@/lib/auth/AuthBroadcastListener';
import { closeAuthChannelForTests, TAB_ID } from '@/lib/auth/broadcast';
import { authNavigation } from '@/lib/auth/navigation';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { getQueryClient } from '@/lib/query/client';

import { APP_ORIGIN, server } from '../../msw/server';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    const mocked = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
    return { ...original, toast: mocked };
});

const user: User = {
    id: '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};
const authUrl = (path: string) => `${APP_ORIGIN}/api/auth/${path}`;
const apiError = (status: number, code: string) =>
    HttpResponse.json({ error: { code, message: code, requestId: 'r' } }, { status });

/** Stand-in for another browser tab on the same channel. */
let otherTab: BroadcastChannel;
let assign: MockInstance<(path: string) => void>;

/** Messages the other tab received. */
function captureBroadcasts() {
    const received: unknown[] = [];
    otherTab.addEventListener('message', (event: MessageEvent<unknown>) =>
        received.push(event.data),
    );
    return received;
}

/** Let BroadcastChannel deliver (it's asynchronous). */
const flushChannel = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    resetSignOutForTests();
    getQueryClient().clear();
    router.replace.mockClear();
    vi.mocked(toast).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    assign = vi.spyOn(authNavigation, 'assign').mockImplementation(() => {});
    otherTab = new BroadcastChannel('tm-auth');
    window.history.replaceState(null, '', '/dashboard/my-tasks');
});

afterEach(() => {
    otherTab.close();
    closeAuthChannelForTests();
    resetRefreshForTests();
    vi.restoreAllMocks();
});

function signedIn(token = 'at-1', expiresIn = 900) {
    startSession({ accessToken: token, expiresIn, user });
    getQueryClient().setQueryData(['projects'], ['cached']);
}

describe('signOut', () => {
    it('calls /api/auth/logout, clears store and cache, broadcasts and goes to /login', async () => {
        let calls = 0;
        server.use(
            http.post(authUrl('logout'), () => {
                calls += 1;
                return new HttpResponse(null, { status: 204 });
            }),
        );
        const received = captureBroadcasts();
        signedIn();

        await signOut();
        await flushChannel();

        expect(calls).toBe(1);
        expect(sessionStore.get().status).toBe('unauthenticated');
        expect(getQueryClient().getQueryCache().getAll()).toHaveLength(0);
        expect(received).toEqual([{ type: 'signed-out', tabId: TAB_ID }]);
        expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
    });

    it('still signs out locally when the route fails', async () => {
        server.use(http.post(authUrl('logout'), () => HttpResponse.error()));
        signedIn();

        await signOut();

        expect(sessionStore.get().status).toBe('unauthenticated');
        expect(assign).toHaveBeenCalledWith('/login');
    });

    it('sends one request when called twice', async () => {
        let calls = 0;
        server.use(
            http.post(authUrl('logout'), () => {
                calls += 1;
                return new HttpResponse(null, { status: 204 });
            }),
        );
        signedIn();

        await Promise.all([signOut(), signOut()]);

        expect(calls).toBe(1);
        expect(assign).toHaveBeenCalledOnce();
    });

    it('uses the given navigate instead of a full page load', async () => {
        server.use(http.post(authUrl('logout'), () => new HttpResponse(null, { status: 204 })));
        const navigate = vi.fn();
        signedIn();

        await signOut({ navigate });

        expect(navigate).toHaveBeenCalledWith('/login');
        expect(assign).not.toHaveBeenCalled();
    });
});

describe('signOutEverywhere', () => {
    it('refreshes first when the token expires within 30 s, then sends Bearer to logout-all', async () => {
        const order: string[] = [];
        let bearer: string | null = null;
        server.use(
            http.post(authUrl('refresh'), () => {
                order.push('refresh');
                return HttpResponse.json({ data: { accessToken: 'fresh', expiresIn: 900, user } });
            }),
            http.post(authUrl('logout-all'), ({ request }) => {
                order.push('logout-all');
                bearer = request.headers.get('authorization');
                return new HttpResponse(null, { status: 204 });
            }),
        );
        signedIn('about-to-expire', 20);

        expect(await signOutEverywhere()).toBe('everywhere');

        expect(order).toEqual(['refresh', 'logout-all']);
        expect(bearer).toBe('Bearer fresh');
    });

    it('uses a fresh token as is', async () => {
        let refreshed = false;
        let bearer: string | null = null;
        server.use(
            http.post(authUrl('refresh'), () => {
                refreshed = true;
                return HttpResponse.json({});
            }),
            http.post(authUrl('logout-all'), ({ request }) => {
                bearer = request.headers.get('authorization');
                return new HttpResponse(null, { status: 204 });
            }),
        );
        signedIn('good-for-15-min', 900);

        await signOutEverywhere();

        expect(refreshed).toBe(false);
        expect(bearer).toBe('Bearer good-for-15-min');
    });

    it('204 → signed out locally, everywhere toast, other tabs told', async () => {
        server.use(http.post(authUrl('logout-all'), () => new HttpResponse(null, { status: 204 })));
        const received = captureBroadcasts();
        signedIn();

        await signOutEverywhere();
        await flushChannel();

        expect(toast.success).toHaveBeenCalledWith(SIGNED_OUT_EVERYWHERE);
        expect(sessionStore.get().status).toBe('unauthenticated');
        expect(getQueryClient().getQueryCache().getAll()).toHaveLength(0);
        expect(assign).toHaveBeenCalledWith('/login');
        expect(received).toEqual([{ type: 'signed-out', tabId: TAB_ID }]);
    });

    it('401 → signed out on this device, with the explanation', async () => {
        server.use(http.post(authUrl('logout-all'), () => apiError(401, 'TOKEN_EXPIRED')));
        signedIn();

        expect(await signOutEverywhere()).toBe('this-device');

        expect(toast).toHaveBeenCalledWith(SIGNED_OUT_HERE_ONLY);
        expect(sessionStore.get().status).toBe('unauthenticated');
        expect(assign).toHaveBeenCalledWith('/login');
    });

    it('no token even after refreshing → local sign-out', async () => {
        server.use(
            http.post(authUrl('refresh'), () => apiError(401, 'INVALID_REFRESH_TOKEN')),
            http.post(authUrl('logout'), () => new HttpResponse(null, { status: 204 })),
        );

        expect(await signOutEverywhere()).toBe('this-device');

        expect(toast).toHaveBeenCalledWith(SIGNED_OUT_HERE_ONLY);
        expect(assign).toHaveBeenCalledWith('/login');
    });

    it('503 → stays signed in, error toast', async () => {
        server.use(http.post(authUrl('logout-all'), () => apiError(503, 'INTERNAL_ERROR')));
        signedIn();

        expect(await signOutEverywhere()).toBe('failed');

        expect(toast.error).toHaveBeenCalledWith('Something went wrong.', expect.anything());
        expect(sessionStore.get()).toMatchObject({ status: 'authenticated', accessToken: 'at-1' });
        expect(getQueryClient().getQueryCache().getAll()).toHaveLength(1);
        expect(assign).not.toHaveBeenCalled();
    });

    it('network failure → stays signed in, error toast', async () => {
        server.use(http.post(authUrl('logout-all'), () => HttpResponse.error()));
        signedIn();

        expect(await signOutEverywhere()).toBe('failed');

        expect(toast.error).toHaveBeenCalledWith(
            "Can't reach the server. Check your connection.",
            expect.anything(),
        );
        expect(sessionStore.get().status).toBe('authenticated');
    });
});

describe('cross-tab sync', () => {
    it("another tab's 'signed-out' clears this dashboard tab's session and goes to /login", async () => {
        render(<AuthBroadcastListener />);
        signedIn();

        otherTab.postMessage({ type: 'signed-out', tabId: 'some-other-tab' });

        await vi.waitFor(() => expect(sessionStore.get().status).toBe('unauthenticated'));
        expect(getQueryClient().getQueryCache().getAll()).toHaveLength(0);
        expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
    });

    it('ignores messages carrying its own tab id', async () => {
        render(<AuthBroadcastListener />);
        signedIn();

        otherTab.postMessage({ type: 'signed-out', tabId: TAB_ID });
        otherTab.postMessage({ type: 'nonsense', tabId: 'x' });
        await flushChannel();

        expect(sessionStore.get().status).toBe('authenticated');
        expect(assign).not.toHaveBeenCalled();
    });

    it("'signed-in' moves a /login tab on to its next", async () => {
        window.history.replaceState(null, '', '/login?next=%2Fdashboard%2Fprojects');
        render(<AuthBroadcastListener />);

        otherTab.postMessage({ type: 'signed-in', tabId: 'some-other-tab' });

        await vi.waitFor(() =>
            expect(assign).toHaveBeenCalledExactlyOnceWith('/dashboard/projects'),
        );
    });

    it("'signed-in' moves a /register tab to /dashboard", async () => {
        window.history.replaceState(null, '', '/register');
        render(<AuthBroadcastListener />);

        otherTab.postMessage({ type: 'signed-in', tabId: 'some-other-tab' });

        await vi.waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith('/dashboard'));
    });

    it("'signed-in' leaves other pages alone", async () => {
        window.history.replaceState(null, '', '/dashboard/my-tasks');
        render(<AuthBroadcastListener />);

        otherTab.postMessage({ type: 'signed-in', tabId: 'some-other-tab' });
        await flushChannel();

        expect(assign).not.toHaveBeenCalled();
    });

    it('a successful signIn tells other tabs', async () => {
        server.use(
            http.post(authUrl('login'), () =>
                HttpResponse.json({ data: { accessToken: 'at', expiresIn: 900, user } }),
            ),
        );
        const received = captureBroadcasts();

        await actions.signIn(user.email, 'pw');
        await flushChannel();

        expect(received).toEqual([{ type: 'signed-in', tabId: TAB_ID }]);
    });
});

describe('profile menu', () => {
    async function openMenu() {
        const u = userEvent.setup();
        signedIn();
        render(<ProfileMenu />);
        await u.click(screen.getByRole('button', { name: `Account menu for ${user.name}` }));
        return u;
    }

    it('shows the user and the items; Profile is disabled for now', async () => {
        await openMenu();

        expect(screen.getByText(user.email)).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
            'aria-disabled',
            'true',
        );
        expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    });

    it('"Sign out of all devices" opens the confirm dialog; confirming calls signOutEverywhere', async () => {
        const everywhere = vi.spyOn(actions, 'signOutEverywhere').mockResolvedValue('everywhere');
        const u = await openMenu();

        await u.click(screen.getByRole('menuitem', { name: 'Sign out of all devices' }));

        const dialog = await screen.findByRole('dialog', { name: 'Sign out of all devices?' });
        expect(dialog).toHaveTextContent(
            "You'll be signed out here and on every other device or browser.",
        );
        expect(everywhere).not.toHaveBeenCalled();

        await u.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

        expect(everywhere).toHaveBeenCalledOnce();
        expect(everywhere.mock.calls[0]?.[0]?.navigate).toEqual(expect.any(Function));
    });

    it('"Sign out" signs out with client-side navigation', async () => {
        const out = vi.spyOn(actions, 'signOut').mockResolvedValue();
        const u = await openMenu();

        await u.click(screen.getByRole('menuitem', { name: 'Sign out' }));

        expect(out).toHaveBeenCalledOnce();
        out.mock.calls[0]?.[0]?.navigate?.('/login');
        expect(router.replace).toHaveBeenCalledWith('/login');
    });
});
