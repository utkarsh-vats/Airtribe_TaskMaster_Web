/*
 * Inviting people and the project's invitations (10c): the invite form by role, what it sends,
 * its errors; the Pending invitations table (PENDING + EXPIRED merged newest first), Revoke and
 * Invite again. Rendered inside ProjectShell + MembersView like the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NOT_ADMIN_INVITE_MESSAGE } from '@/features/invitations/components/InviteForm';
import { NO_INVITATIONS_MESSAGE } from '@/features/invitations/components/ProjectInvitations';
import { MembersView } from '@/features/members/components/MembersView';
import { ProjectShell } from '@/features/projects/components/ProjectShell';
import type { Invitation, Member, ProjectDetail, ProjectRole, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { queryKeys } from '@/lib/query/keys';

import { API_ORIGIN, server } from '../../msw/server';

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/members',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const api = (path: string) => `${API_ORIGIN}/api/v1/projects${path}`;
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

const invitation = (
    id: string,
    email: string,
    role: Invitation['role'],
    status: 'PENDING' | 'EXPIRED',
    createdAgo: number,
): Invitation => ({
    id,
    projectId: 'p1',
    email,
    role,
    status,
    // Pending: 5 days left; expired: lapsed yesterday.
    expiresAt: status === 'PENDING' ? at(5 * DAY) : at(-DAY),
    respondedAt: null,
    createdAt: at(-createdAgo),
    invitedBy: { id: me.id, name: me.name },
});

type State = {
    invitations: Invitation[];
    gets: { invitations: string[] };
    posts: unknown[];
    deletes: string[];
};

/**
 * The API as `role` sees it: project, members, invitations filtered by ?status, POST (adds a
 * PENDING one) and DELETE (removes it). `fail` overrides POST / DELETE responses.
 */
function mockApi(
    role: ProjectRole,
    invitations: Invitation[] = [],
    fail: { post?: () => Response; remove?: () => Response } = {},
): State {
    const state: State = { invitations, gets: { invitations: [] }, posts: [], deletes: [] };
    const members: Member[] = [
        {
            user: { id: me.id, name: me.name, email: me.email, avatarUrl: null },
            role,
            joinedAt: at(-30 * DAY),
        },
    ];
    const project: ProjectDetail = {
        id: 'p1',
        name: 'Website relaunch',
        description: null,
        createdAt: '2025-01-01T09:00:00.000Z',
        updatedAt: '2025-01-01T09:00:00.000Z',
        myRole: role,
        memberCount: 1,
        owner: null,
    };
    server.use(
        http.get(api('/p1'), () => HttpResponse.json({ data: project })),
        http.get(`${API_ORIGIN}/api/v1/projects`, () =>
            HttpResponse.json({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
        ),
        http.get(api('/p1/members'), () => HttpResponse.json({ data: members })),
        http.get(api('/p1/invitations'), ({ request }) => {
            const status = new URL(request.url).searchParams.get('status') ?? '';
            state.gets.invitations.push(status);
            const data = state.invitations.filter((i) => i.status === status);
            return HttpResponse.json({
                data,
                meta: { page: 1, limit: 50, total: data.length, totalPages: 1 },
            });
        }),
        http.post(api('/p1/invitations'), async ({ request }) => {
            const body = (await request.json()) as { email: string; role: Invitation['role'] };
            state.posts.push(body);
            if (fail.post) return fail.post();
            const created = invitation(
                `new-${state.posts.length}`,
                body.email,
                body.role,
                'PENDING',
                0,
            );
            state.invitations = [...state.invitations, created];
            return HttpResponse.json({ data: created }, { status: 201 });
        }),
        http.delete(api('/p1/invitations/:id'), ({ params }) => {
            state.deletes.push(String(params.id));
            if (fail.remove) return fail.remove();
            state.invitations = state.invitations.filter((i) => i.id !== params.id);
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return state;
}

const apiError =
    (status: number, code: string, message = `${code} message`, details?: unknown) =>
    () =>
        HttpResponse.json({ error: { code, message, requestId: 'r', details } }, { status });

let client: QueryClient;

function renderTab() {
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ProjectShell projectId="p1">
                <MembersView />
            </ProjectShell>
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

const form = () => screen.getByRole('form', { name: 'Invite people' });
const emailInput = () => within(form()).getByRole('textbox', { name: 'Email' });
const send = () => within(form()).getByRole('button', { name: 'Send invite' });
const table = () => screen.getByRole('table', { name: 'Pending invitations' });
const tableRow = (email: string) => within(table()).getByText(email).closest('tr') as HTMLElement;

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => resetRefreshForTests());

describe('the invite form by role', () => {
    it('OWNER: Member or Admin', async () => {
        const state = mockApi('OWNER');
        const u = renderTab();

        const role = await within(
            await screen.findByRole('form', { name: 'Invite people' }),
        ).findByRole('combobox', { name: 'Role' });
        expect(
            within(role)
                .getAllByRole('option')
                .map((o) => o.textContent),
        ).toEqual(['Member', 'Admin']);
        expect(role).toHaveValue('MEMBER');

        await u.type(emailInput(), 'ana@company.com');
        await u.selectOptions(role, 'ADMIN');
        await u.click(send());

        await vi.waitFor(() =>
            expect(state.posts).toEqual([{ email: 'ana@company.com', role: 'ADMIN' }]),
        );
    });

    it('ADMIN: the role is a fixed Member tag, not a select', async () => {
        const state = mockApi('ADMIN');
        const u = renderTab();

        await screen.findByRole('form', { name: 'Invite people' });
        expect(within(form()).queryByRole('combobox')).not.toBeInTheDocument();
        expect(within(form()).getByRole('group', { name: 'Role' })).toHaveTextContent('Member');

        await u.type(emailInput(), 'ana@company.com');
        await u.click(send());

        await vi.waitFor(() =>
            expect(state.posts).toEqual([{ email: 'ana@company.com', role: 'MEMBER' }]),
        );
    });

    it('MEMBER: the muted line, no form, no invitations table (and no request for them)', async () => {
        const state = mockApi('MEMBER');
        renderTab();

        expect(await screen.findByText(NOT_ADMIN_INVITE_MESSAGE)).toBeVisible();
        expect(screen.getByRole('heading', { name: 'Invite people' })).toBeVisible();
        expect(screen.queryByRole('form', { name: 'Invite people' })).not.toBeInTheDocument();
        await screen.findByRole('table', { name: 'Members' });
        expect(
            screen.queryByRole('heading', { name: 'Pending invitations' }),
        ).not.toBeInTheDocument();
        expect(state.gets.invitations).toEqual([]);
    });
});

describe('sending', () => {
    it('trims and lowercases the email; success toasts and resets; Send is disabled until valid', async () => {
        const state = mockApi('OWNER');
        const u = renderTab();
        await screen.findByRole('form', { name: 'Invite people' });
        expect(send()).toBeDisabled();

        await u.type(emailInput(), 'not-an-email');
        expect(send()).toBeDisabled();
        await u.clear(emailInput());
        await u.type(emailInput(), '  Ana.Lopez@Company.COM ');
        await vi.waitFor(() => expect(send()).toBeEnabled());
        await u.click(send());

        await vi.waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Invitation sent to ana.lopez@company.com'),
        );
        // The submit has settled (the toast comes just before the form's state catches up).
        await vi.waitFor(() => expect(send()).not.toHaveAttribute('aria-busy'));
        expect(state.posts).toEqual([{ email: 'ana.lopez@company.com', role: 'MEMBER' }]);
        expect(emailInput()).toHaveValue('');
        // The new one is in the table: the lists were refetched, and render once React catches up.
        const newTable = await screen.findByRole('table', { name: 'Pending invitations' });
        expect(await within(newTable).findByText('ana.lopez@company.com')).toBeInTheDocument();
    });

    it('409 (already a member / already invited): the API’s message under the email', async () => {
        mockApi('OWNER', [], {
            post: apiError(409, 'CONFLICT', 'ana@company.com is already a member.'),
        });
        const u = renderTab();
        await screen.findByRole('form', { name: 'Invite people' });

        await u.type(emailInput(), 'ana@company.com');
        await u.click(send());

        expect(
            await within(form()).findByText('ana@company.com is already a member.'),
        ).toBeVisible();
        expect(emailInput()).toHaveAttribute('aria-invalid', 'true');
        expect(emailInput()).toHaveValue('ana@company.com');
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('422: details go under their fields', async () => {
        mockApi('OWNER', [], {
            post: apiError(422, 'VALIDATION_ERROR', 'Invalid', [
                { path: 'email', message: 'That domain can’t receive mail.' },
            ]),
        });
        const u = renderTab();
        await screen.findByRole('form', { name: 'Invite people' });

        await u.type(emailInput(), 'ana@company.com');
        await u.click(send());

        expect(await within(form()).findByText('That domain can’t receive mail.')).toBeVisible();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('403: the usual error toast', async () => {
        mockApi('OWNER', [], { post: apiError(403, 'FORBIDDEN') });
        const u = renderTab();
        await screen.findByRole('form', { name: 'Invite people' });

        await u.type(emailInput(), 'ana@company.com');
        await u.click(send());

        await vi.waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(
                "You don't have permission to do that.",
                expect.anything(),
            ),
        );
    });
});

describe('Pending invitations', () => {
    it('PENDING and EXPIRED merged newest first, with role, sent, expires and the count', async () => {
        const state = mockApi('OWNER', [
            invitation('i1', 'newest@company.com', 'MEMBER', 'PENDING', HOUR),
            invitation('i2', 'oldest@company.com', 'ADMIN', 'PENDING', 3 * DAY),
            invitation('i3', 'lapsed@company.com', 'MEMBER', 'EXPIRED', 2 * DAY),
        ]);
        renderTab();

        await screen.findByRole('table', { name: 'Pending invitations' });
        expect(state.gets.invitations.sort()).toEqual(['EXPIRED', 'PENDING']);
        const rows = within(table()).getAllByRole('row').slice(1);
        expect(
            rows.map((row) =>
                within(row)
                    .getAllByRole('cell')
                    .map((td) => td.textContent),
            ),
        ).toEqual([
            ['newest@company.com', 'Member', '1 h ago', 'in 5 days', 'Revoke'],
            ['lapsed@company.com', 'Member', expect.any(String), 'Expired', 'Invite again'],
            ['oldest@company.com', 'Admin', expect.any(String), 'in 5 days', 'Revoke'],
        ]);
        expect(within(tableRow('lapsed@company.com')).getByText('Expired')).toHaveClass(
            'text-danger',
        );
        expect(screen.getByTestId('invitation-count')).toHaveTextContent('3');

        // Below 820px: the same, stacked.
        const list = screen.getByRole('list', { name: 'Pending invitations' });
        expect(
            within(list)
                .getAllByRole('listitem')
                .map((li) => li.textContent),
        ).toEqual([
            expect.stringMatching(/^newest@company\.comMemberSent 1 h agoExpires in 5 daysRevoke$/),
            expect.stringMatching(/^lapsed@company\.comMemberSent .+ExpiredInvite again$/),
            expect.stringMatching(/^oldest@company\.comAdminSent .+Expires in 5 daysRevoke$/),
        ]);
    });

    it('while they refetch (one of the two slower), the rows stay — no skeleton', async () => {
        mockApi('OWNER', [
            invitation('i1', 'ana@company.com', 'MEMBER', 'PENDING', HOUR),
            invitation('i3', 'lapsed@company.com', 'MEMBER', 'EXPIRED', DAY),
        ]);
        renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });

        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        let refetches = 0;
        server.use(
            http.get(api('/p1/invitations'), async ({ request }) => {
                refetches += 1;
                const status = new URL(request.url).searchParams.get('status');
                // EXPIRED answers late; PENDING at once, with the same row.
                if (status === 'EXPIRED') await held;
                const data =
                    status === 'EXPIRED'
                        ? [invitation('i3', 'lapsed@company.com', 'MEMBER', 'EXPIRED', DAY)]
                        : [invitation('i1', 'ana@company.com', 'MEMBER', 'PENDING', HOUR)];
                return HttpResponse.json({
                    data,
                    meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
                });
            }),
        );
        void client.invalidateQueries({ queryKey: queryKeys.invitations.projectAll('p1') });

        await vi.waitFor(() => expect(refetches).toBe(2));
        // PENDING is back, EXPIRED still on its way: both rows are still shown.
        expect(within(table()).getByText('ana@company.com')).toBeVisible();
        expect(within(table()).getByText('lapsed@company.com')).toBeVisible();
        expect(screen.queryByText('Loading invitations…')).not.toBeInTheDocument();
        expect(screen.queryByText(NO_INVITATIONS_MESSAGE)).not.toBeInTheDocument();

        release();
        await vi.waitFor(() =>
            expect(client.isFetching({ queryKey: queryKeys.invitations.projectAll('p1') })).toBe(0),
        );
        expect(within(table()).getAllByRole('row')).toHaveLength(3);
    });

    it('a background refetch that fails keeps the rows (no error state)', async () => {
        mockApi('OWNER', [invitation('i1', 'ana@company.com', 'MEMBER', 'PENDING', HOUR)]);
        renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });

        server.use(
            http.get(api('/p1/invitations'), () =>
                HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                ),
            ),
        );
        await client.invalidateQueries({ queryKey: queryKeys.invitations.projectAll('p1') });

        await vi.waitFor(() =>
            expect(
                client.getQueryState(
                    queryKeys.invitations.project('p1', { status: 'PENDING', limit: 50 }),
                )?.status,
            ).toBe('error'),
        );
        // Let TanStack's batched notification (a 0 ms timer, queued before this one) re-render.
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
        expect(within(table()).getByText('ana@company.com')).toBeVisible();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('empty: "No pending invitations."', async () => {
        mockApi('ADMIN');
        renderTab();

        expect(await screen.findByText(NO_INVITATIONS_MESSAGE)).toBeVisible();
        expect(screen.getByTestId('invitation-count')).toHaveTextContent('0');
    });

    it('error: a compact ErrorState, then Try again', async () => {
        let fail = true;
        mockApi('ADMIN');
        server.use(
            http.get(api('/p1/invitations'), () =>
                fail
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                          { status: 500 },
                      )
                    : HttpResponse.json({
                          data: [],
                          meta: { page: 1, limit: 50, total: 0, totalPages: 0 },
                      }),
            ),
        );
        const u = renderTab();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load invitations");
        fail = false;
        await u.click(within(alert).getByRole('button', { name: /Try again/ }));

        expect(await screen.findByText(NO_INVITATIONS_MESSAGE)).toBeVisible();
    });
});

describe('Revoke', () => {
    const pending = () => invitation('i1', 'ana@company.com', 'MEMBER', 'PENDING', HOUR);

    it('confirm → DELETE → the row goes', async () => {
        const state = mockApi('ADMIN', [pending()]);
        const u = renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });

        await u.click(within(tableRow('ana@company.com')).getByRole('button', { name: /Revoke/ }));
        const dialog = await screen.findByRole('dialog', {
            name: 'Revoke the invitation to ana@company.com?',
        });
        expect(dialog).toHaveTextContent("They won't be able to join with this invitation.");
        await u.click(within(dialog).getByRole('button', { name: 'Revoke' }));

        expect(await screen.findByText(NO_INVITATIONS_MESSAGE)).toBeVisible();
        expect(state.deletes).toEqual(['i1']);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('409 (no longer pending): a toast with the API’s message and a refetch', async () => {
        const state = mockApi('ADMIN', [pending()], {
            remove: apiError(409, 'CONFLICT', 'This invitation was already accepted.'),
        });
        const u = renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });
        const before = state.gets.invitations.length;

        await u.click(within(tableRow('ana@company.com')).getByRole('button', { name: /Revoke/ }));
        const dialog = await screen.findByRole('dialog', {
            name: 'Revoke the invitation to ana@company.com?',
        });
        await u.click(within(dialog).getByRole('button', { name: 'Revoke' }));

        await vi.waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('This invitation was already accepted.'),
        );
        await vi.waitFor(() => expect(state.gets.invitations.length).toBe(before + 2));
        // Nothing left to revoke: it closes.
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('500: the dialog stays open with an error toast', async () => {
        mockApi('ADMIN', [pending()], { remove: apiError(500, 'INTERNAL_ERROR') });
        const u = renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });

        await u.click(within(tableRow('ana@company.com')).getByRole('button', { name: /Revoke/ }));
        const dialog = await screen.findByRole('dialog', {
            name: 'Revoke the invitation to ana@company.com?',
        });
        await u.click(within(dialog).getByRole('button', { name: 'Revoke' }));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
        // Still open, ready for another try once the spinner stops.
        await vi.waitFor(() =>
            expect(within(dialog).getByRole('button', { name: 'Revoke' })).toBeEnabled(),
        );
        expect(
            screen.getByRole('dialog', { name: 'Revoke the invitation to ana@company.com?' }),
        ).toBeInTheDocument();
    });
});

describe('Invite again', () => {
    it('posts the same email and role, then toasts', async () => {
        const state = mockApi('ADMIN', [
            invitation('i3', 'lapsed@company.com', 'MEMBER', 'EXPIRED', DAY),
        ]);
        const u = renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });

        await u.click(
            within(tableRow('lapsed@company.com')).getByRole('button', {
                name: 'Invite lapsed@company.com again',
            }),
        );

        await vi.waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Invitation sent to lapsed@company.com'),
        );
        expect(state.posts).toEqual([{ email: 'lapsed@company.com', role: 'MEMBER' }]);
    });

    it('an expired ADMIN invitation: hidden for an ADMIN, there for the OWNER', async () => {
        const lapsedAdmin = () => invitation('i4', 'boss@company.com', 'ADMIN', 'EXPIRED', DAY);
        mockApi('ADMIN', [lapsedAdmin()]);
        renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });
        expect(within(tableRow('boss@company.com')).queryByRole('button')).not.toBeInTheDocument();
    });

    it('…and the OWNER may send it again', async () => {
        const state = mockApi('OWNER', [
            invitation('i4', 'boss@company.com', 'ADMIN', 'EXPIRED', DAY),
        ]);
        const u = renderTab();
        await screen.findByRole('table', { name: 'Pending invitations' });

        await u.click(within(tableRow('boss@company.com')).getByRole('button', { name: /again/ }));

        await vi.waitFor(() =>
            expect(state.posts).toEqual([{ email: 'boss@company.com', role: 'ADMIN' }]),
        );
    });
});
