/*
 * The invitations inbox (10d): pending invitations newest first, Accept (toast with Open
 * project, projects and the badge refreshed), Decline (confirmed), per-row pending, the errors
 * (404 / 409 / 410 stale → toast + refetch; others → the usual toast), the list states and the
 * sidebar badge. The inbox and the sidebar are rendered together, sharing one cache.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarNav } from '@/components/shell/SidebarNav';
import { InvitationsInbox } from '@/features/invitations/components/InvitationsInbox';
import type { MyInvitation, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/invitations',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();

const me: User = {
    id: 'u-me',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
};

const invite = (
    id: string,
    projectName: string,
    overrides: Partial<MyInvitation> = {},
): MyInvitation => ({
    id,
    projectId: `p-${id}`,
    email: me.email,
    role: 'MEMBER',
    status: 'PENDING',
    expiresAt: at(5 * DAY),
    respondedAt: null,
    createdAt: at(-HOUR),
    invitedBy: { id: 'u2', name: 'Priya Raman' },
    project: { id: `p-${id}`, name: projectName },
    ...overrides,
});

type State = {
    invitations: MyInvitation[];
    gets: { mine: number; projects: number };
    accepts: string[];
    declines: string[];
};

/** A response to send instead, or undefined to carry on as normal. */
type Override = (id: string) => Response | undefined | Promise<Response | undefined>;

/**
 * GET /users/me/invitations (every status, like the API), the projects list (counted), and
 * accept / decline — which mark it answered — unless `override` returns a response first.
 */
function mockApi(
    invitations: MyInvitation[],
    override: { accept?: Override; decline?: Override } = {},
) {
    const state: State = { invitations, gets: { mine: 0, projects: 0 }, accepts: [], declines: [] };
    const answer = (id: string, status: 'ACCEPTED' | 'DECLINED') => {
        state.invitations = state.invitations.map((i) =>
            i.id === id ? { ...i, status, respondedAt: at(0) } : i,
        );
    };
    server.use(
        http.get(`${API_ORIGIN}/api/v1/users/me/invitations`, () => {
            state.gets.mine += 1;
            return HttpResponse.json({ data: state.invitations });
        }),
        http.get(`${API_ORIGIN}/api/v1/projects`, () => {
            state.gets.projects += 1;
            return HttpResponse.json({
                data: [],
                meta: { page: 1, limit: 8, total: 0, totalPages: 0 },
            });
        }),
        http.post(`${API_ORIGIN}/api/v1/invitations/:id/accept`, async ({ params }) => {
            const id = String(params.id);
            state.accepts.push(id);
            const custom = await override.accept?.(id);
            if (custom) return custom;
            answer(id, 'ACCEPTED');
            return HttpResponse.json({ data: { projectId: `p-${id}`, role: 'MEMBER' } });
        }),
        http.post(`${API_ORIGIN}/api/v1/invitations/:id/decline`, async ({ params }) => {
            const id = String(params.id);
            state.declines.push(id);
            const custom = await override.decline?.(id);
            if (custom) return custom;
            answer(id, 'DECLINED');
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return state;
}

const apiError = (status: number, code: string, message = `${code} message`) =>
    HttpResponse.json({ error: { code, message, requestId: 'r' } }, { status });

function renderInbox() {
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <SidebarNav />
            <InvitationsInbox />
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const list = () => screen.getByRole('list', { name: 'Pending invitations' });
const row = (projectName: string) =>
    within(list()).getByText(projectName).closest('li') as HTMLElement;
const acceptButton = (projectName: string) =>
    within(row(projectName)).getByRole('button', {
        name: `Accept the invitation to ${projectName}`,
    });
const declineButton = (projectName: string) =>
    within(row(projectName)).getByRole('button', {
        name: `Decline the invitation to ${projectName}`,
    });

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    nav.push.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => resetRefreshForTests());

describe('the list', () => {
    it('pending only, newest first: project, inviter and role, sent, expires; the count', async () => {
        mockApi([
            invite('i1', 'Older project', { createdAt: at(-2 * DAY), role: 'ADMIN' }),
            invite('i2', 'Website relaunch'),
            invite('i3', 'Accepted one', { status: 'ACCEPTED' }),
            invite('i4', 'Lapsed one', { status: 'EXPIRED', expiresAt: at(-DAY) }),
        ]);
        renderInbox();

        await screen.findByRole('list', { name: 'Pending invitations' });
        const items = within(list()).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('Website relaunch');
        expect(items[0]).toHaveTextContent('Priya Raman invited you as Member');
        expect(items[0]).toHaveTextContent('Sent 1 h ago · Expires in 5 days');
        expect(items[1]).toHaveTextContent('Older project');
        expect(items[1]).toHaveTextContent('invited you as Admin');
        expect(screen.getByRole('heading', { name: 'Invitations', level: 2 })).toBeVisible();
        expect(screen.getByTestId('invitation-count')).toHaveTextContent('2');
        expect(screen.queryByText('Accepted one')).not.toBeInTheDocument();
        expect(screen.queryByText('Lapsed one')).not.toBeInTheDocument();
    });

    it('empty: "No pending invitations" with the explanation', async () => {
        mockApi([invite('i3', 'Accepted one', { status: 'ACCEPTED' })]);
        renderInbox();

        expect(
            await screen.findByRole('heading', { name: 'No pending invitations' }),
        ).toBeVisible();
        expect(
            screen.getByText('When someone invites you to a project, it shows up here.'),
        ).toBeVisible();
        expect(screen.getByTestId('invitation-count')).toHaveTextContent('0');
    });

    it('loading: skeleton rows', () => {
        mockApi([]);
        server.use(
            http.get(`${API_ORIGIN}/api/v1/users/me/invitations`, async () => {
                await delay('infinite');
                return HttpResponse.json({});
            }),
        );
        renderInbox();

        expect(screen.getByText('Loading invitations…').parentElement).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });

    it('error, then Try again', async () => {
        let fail = true;
        mockApi([]);
        server.use(
            http.get(`${API_ORIGIN}/api/v1/users/me/invitations`, () =>
                fail
                    ? apiError(500, 'INTERNAL_ERROR')
                    : HttpResponse.json({ data: [invite('i1', 'Website relaunch')] }),
            ),
        );
        const u = renderInbox();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load your invitations");
        fail = false;
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByText('Website relaunch')).toBeInTheDocument();
    });
});

describe('Accept', () => {
    it('POST → the row goes, a toast with Open project, projects refetched, the badge drops', async () => {
        const state = mockApi([invite('i1', 'Website relaunch'), invite('i2', 'Hiring')]);
        const u = renderInbox();
        await screen.findByRole('link', { name: 'Invitations, 2 pending' });
        const projectGets = state.gets.projects;

        await u.click(acceptButton('Website relaunch'));

        await vi.waitFor(() => expect(within(list()).queryByText('Website relaunch')).toBeNull());
        expect(state.accepts).toEqual(['i1']);
        expect(toast.success).toHaveBeenCalledWith('You joined Website relaunch', {
            action: { label: 'Open project', onClick: expect.any(Function) },
        });
        // Sonner types the handler as taking a click event; this one ignores it.
        const action = vi.mocked(toast.success).mock.calls[0]?.[1]?.action as unknown as {
            onClick: () => void;
        };
        action.onClick();
        expect(nav.push).toHaveBeenCalledWith('/dashboard/projects/p-i1');

        await vi.waitFor(() => expect(state.gets.projects).toBeGreaterThan(projectGets));
        expect(
            await screen.findByRole('link', { name: 'Invitations, 1 pending' }),
        ).toBeInTheDocument();
        expect(screen.getByTestId('invitation-count')).toHaveTextContent('1');
    });

    it('while a row’s request is pending, only that row’s buttons are disabled', async () => {
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        mockApi([invite('i1', 'Website relaunch'), invite('i2', 'Hiring')], {
            accept: async () => {
                await held;
                return undefined;
            },
        });
        const u = renderInbox();
        await screen.findByRole('list', { name: 'Pending invitations' });

        await u.click(acceptButton('Website relaunch'));

        expect(acceptButton('Website relaunch')).toBeDisabled();
        expect(acceptButton('Website relaunch')).toHaveAttribute('aria-busy', 'true');
        expect(declineButton('Website relaunch')).toBeDisabled();
        expect(acceptButton('Hiring')).toBeEnabled();
        expect(declineButton('Hiring')).toBeEnabled();
        // Not removed before the server answers.
        expect(row('Website relaunch')).toBeInTheDocument();

        release();
        await vi.waitFor(() => expect(within(list()).queryByText('Website relaunch')).toBeNull());
    });
});

describe('Decline', () => {
    it('confirm → POST → the row goes, "Invitation declined"', async () => {
        const state = mockApi([invite('i1', 'Website relaunch'), invite('i2', 'Hiring')]);
        const u = renderInbox();
        await screen.findByRole('list', { name: 'Pending invitations' });

        await u.click(declineButton('Website relaunch'));
        const dialog = await screen.findByRole('dialog', {
            name: 'Decline the invitation to Website relaunch?',
        });
        expect(dialog).toHaveTextContent("You'll need a new invitation to join.");
        await u.click(within(dialog).getByRole('button', { name: 'Decline' }));

        await vi.waitFor(() =>
            expect(
                within(
                    screen.getByRole('list', { name: 'Pending invitations', hidden: true }),
                ).queryByText('Website relaunch'),
            ).toBeNull(),
        );
        expect(state.declines).toEqual(['i1']);
        expect(toast.success).toHaveBeenCalledWith('Invitation declined');
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(
            await screen.findByRole('link', { name: 'Invitations, 1 pending' }),
        ).toBeInTheDocument();
    });

    it('Cancel keeps it, and sends nothing', async () => {
        const state = mockApi([invite('i1', 'Website relaunch')]);
        const u = renderInbox();
        await screen.findByRole('list', { name: 'Pending invitations' });

        await u.click(declineButton('Website relaunch'));
        const dialog = await screen.findByRole('dialog', {
            name: 'Decline the invitation to Website relaunch?',
        });
        await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(row('Website relaunch')).toBeInTheDocument();
        expect(state.declines).toEqual([]);
    });
});

describe('errors', () => {
    it.each([
        [
            409,
            'CONFLICT',
            'This invitation was already accepted.',
            'This invitation was already accepted.',
        ],
        [404, 'NOT_FOUND', 'Not found', "That doesn't exist, or you no longer have access to it."],
        [410, 'INVITATION_EXPIRED', 'Expired', 'This invitation has expired.'],
    ])(
        '%d on Accept: a toast with its message, and the list is refetched',
        async (status, code, message, shown) => {
            const state = mockApi([invite('i1', 'Website relaunch')], {
                accept: (id) => {
                    // The server's truth afterwards: no longer pending.
                    state.invitations = state.invitations.filter((i) => i.id !== id);
                    return apiError(status, code, message);
                },
            });
            const u = renderInbox();
            await screen.findByRole('list', { name: 'Pending invitations' });
            const gets = state.gets.mine;

            await u.click(acceptButton('Website relaunch'));

            await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(shown));
            await vi.waitFor(() => expect(state.gets.mine).toBeGreaterThan(gets));
            expect(
                await screen.findByRole('heading', { name: 'No pending invitations' }),
            ).toBeVisible();
            expect(toast.success).not.toHaveBeenCalled();
        },
    );

    it('409 on Decline closes the dialog (nothing left to decline) and refetches', async () => {
        const state = mockApi([invite('i1', 'Website relaunch')], {
            decline: () => apiError(409, 'CONFLICT', 'This invitation was revoked.'),
        });
        const u = renderInbox();
        await screen.findByRole('list', { name: 'Pending invitations' });
        const gets = state.gets.mine;

        await u.click(declineButton('Website relaunch'));
        const dialog = await screen.findByRole('dialog', {
            name: 'Decline the invitation to Website relaunch?',
        });
        await u.click(within(dialog).getByRole('button', { name: 'Decline' }));

        await vi.waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('This invitation was revoked.'),
        );
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(state.gets.mine).toBeGreaterThan(gets);
    });

    it('403 (the invitation is for another email): the usual error toast, no refetch', async () => {
        const state = mockApi([invite('i1', 'Website relaunch')], {
            accept: () => apiError(403, 'FORBIDDEN'),
        });
        const u = renderInbox();
        await screen.findByRole('list', { name: 'Pending invitations' });
        const gets = state.gets.mine;

        await u.click(acceptButton('Website relaunch'));

        await vi.waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith("You don't have permission to do that.", {
                id: "error:You don't have permission to do that.",
            }),
        );
        expect(state.gets.mine).toBe(gets);
        expect(acceptButton('Website relaunch')).toBeEnabled();
    });

    it('500 on Decline keeps the dialog open', async () => {
        mockApi([invite('i1', 'Website relaunch')], {
            decline: () => apiError(500, 'INTERNAL_ERROR'),
        });
        const u = renderInbox();
        await screen.findByRole('list', { name: 'Pending invitations' });

        await u.click(declineButton('Website relaunch'));
        const dialog = await screen.findByRole('dialog', {
            name: 'Decline the invitation to Website relaunch?',
        });
        await u.click(within(dialog).getByRole('button', { name: 'Decline' }));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
        await vi.waitFor(() =>
            expect(within(dialog).getByRole('button', { name: 'Decline' })).toBeEnabled(),
        );
        expect(screen.getByRole('dialog', { name: /Decline the invitation/ })).toBeInTheDocument();
    });
});

describe('the sidebar badge', () => {
    const pending = (n: number) =>
        Array.from({ length: n }, (_, i) => invite(`i${i}`, `Project ${i}`));

    it('hidden at 0', async () => {
        mockApi([invite('i3', 'Accepted one', { status: 'ACCEPTED' })]);
        renderInbox();

        await screen.findByRole('heading', { name: 'No pending invitations' });
        expect(screen.getByRole('link', { name: 'Invitations' })).toBeInTheDocument();
        expect(screen.queryByTestId('invitations-badge')).not.toBeInTheDocument();
    });

    it('the count, with "Invitations, N pending" as the link’s name', async () => {
        mockApi(pending(3));
        renderInbox();

        const link = await screen.findByRole('link', { name: 'Invitations, 3 pending' });
        expect(within(link).getByTestId('invitations-badge')).toHaveTextContent('3');
    });

    it('capped at "9+" (the name keeps the real number)', async () => {
        mockApi(pending(12));
        renderInbox();

        const link = await screen.findByRole('link', { name: 'Invitations, 12 pending' });
        expect(within(link).getByTestId('invitations-badge')).toHaveTextContent('9+');
    });
});
