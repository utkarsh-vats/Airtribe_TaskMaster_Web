/*
 * Member actions (10b): who sees what (role select, Make owner, Remove, Leave, the owner's
 * hint), changing a role (the returned list is the cache), transferring ownership, removing,
 * leaving, and the errors (409, 404, others). Rendered inside ProjectShell like the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MEMBER_GONE_MESSAGE } from '@/features/members/api';
import { MembersView, OWNER_LEAVE_HINT } from '@/features/members/components/MembersView';
import { ProjectShell } from '@/features/projects/components/ProjectShell';
import type { Member, ProjectDetail, ProjectRole, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';
import { queryKeys } from '@/lib/query/keys';

import { emptyInvitations } from '../../msw/invitations';
import { API_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/members',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const api = (path: string) => `${API_ORIGIN}/api/v1/projects${path}`;

const person = (id: string, name: string) => ({
    id,
    name,
    email: `${name.split(' ')[0]?.toLowerCase()}@taskmaster.app`,
    avatarUrl: null,
});
const PRIYA = person('u-owner', 'Priya Raman');
const ANA = person('u-admin', 'Ana Lopez');
const JONAS = person('u-member', 'Jonas Weber');

const member = (user: Member['user'], role: ProjectRole, joinedAt: string): Member => ({
    user,
    role,
    joinedAt,
});

const userOf = (p: Member['user']): User => ({
    id: p.id,
    email: p.email,
    name: p.name,
    bio: null,
    avatarUrl: null,
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
});

/** Server state, kept up to date by PATCH and DELETE. */
type Server = {
    members: Member[];
    myRole: ProjectRole;
    gets: { members: number; project: number };
    patches: { userId: string; role: string }[];
    deletes: string[];
};

/**
 * The API for `me`'s view: the project (myRole from the members), the members, PATCH (returns
 * the updated list; OWNER transfers) and DELETE. `fail` overrides PATCH / DELETE responses.
 */
function mockApi(
    me: Member['user'],
    fail: { patch?: () => Response; remove?: () => Response } = {},
): Server {
    const state: Server = {
        members: [
            member(PRIYA, 'OWNER', '2025-01-05T12:00:00.000Z'),
            member(ANA, 'ADMIN', '2025-02-05T12:00:00.000Z'),
            member(JONAS, 'MEMBER', '2025-03-05T12:00:00.000Z'),
        ],
        myRole: 'MEMBER',
        gets: { members: 0, project: 0 },
        patches: [],
        deletes: [],
    };
    const roleOf = (id: string) => state.members.find((m) => m.user.id === id)?.role ?? 'MEMBER';
    state.myRole = roleOf(me.id);
    server.use(
        http.get(api('/p1'), () => {
            state.gets.project += 1;
            const project: ProjectDetail = {
                id: 'p1',
                name: 'Website relaunch',
                description: null,
                createdAt: '2025-01-01T09:00:00.000Z',
                updatedAt: '2025-01-01T09:00:00.000Z',
                myRole: roleOf(me.id),
                memberCount: state.members.length,
                owner: null,
            };
            return HttpResponse.json({ data: project });
        }),
        emptyInvitations(),
        http.get(`${API_ORIGIN}/api/v1/projects`, () =>
            HttpResponse.json({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } }),
        ),
        http.get(api('/p1/members'), () => {
            state.gets.members += 1;
            return HttpResponse.json({ data: state.members });
        }),
        http.patch(api('/p1/members/:userId'), async ({ params, request }) => {
            const { role } = (await request.json()) as { role: ProjectRole };
            const userId = String(params.userId);
            state.patches.push({ userId, role });
            if (fail.patch) return fail.patch();
            state.members = state.members.map((m) => {
                if (m.user.id === userId) return { ...m, role };
                // A transfer: the old owner becomes an admin.
                if (role === 'OWNER' && m.role === 'OWNER') return { ...m, role: 'ADMIN' };
                return m;
            });
            return HttpResponse.json({ data: state.members });
        }),
        http.delete(api('/p1/members/:userId'), ({ params }) => {
            const userId = String(params.userId);
            state.deletes.push(userId);
            if (fail.remove) return fail.remove();
            state.members = state.members.filter((m) => m.user.id !== userId);
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return state;
}

const apiError =
    (status: number, code: string, message = `${code} message`) =>
    () =>
        HttpResponse.json({ error: { code, message, requestId: 'r' } }, { status });

function renderMembers(me: Member['user']) {
    startSession({ accessToken: 'at', expiresIn: 900, user: userOf(me) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
        <QueryClientProvider client={client}>
            <ProjectShell projectId="p1">
                <MembersView />
            </ProjectShell>
        </QueryClientProvider>,
    );
    return { client, view, u: userEvent.setup() };
}

/** A member's row in the desktop table. */
const tableRow = (name: string) =>
    within(screen.getByRole('table', { name: 'Members' }))
        .getByText(name)
        .closest('tr') as HTMLElement;
/** The accessible names of a row's buttons and selects. */
const controls = (row: HTMLElement) =>
    [...within(row).queryAllByRole('button'), ...within(row).queryAllByRole('combobox')].map(
        (el) => el.getAttribute('aria-label') ?? el.textContent,
    );
const headerRole = () => (document.querySelector('header') as HTMLElement).textContent;

async function confirmIn(u: ReturnType<typeof userEvent.setup>, title: string, button: string) {
    const dialog = await screen.findByRole('dialog', { name: title });
    await u.click(within(dialog).getByRole('button', { name: button }));
    return dialog;
}

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    nav.push.mockClear();
    vi.mocked(toast).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => resetRefreshForTests());

describe('who sees what', () => {
    it('OWNER: role select, Remove and Make owner on ADMIN and MEMBER rows; the hint on their own', async () => {
        mockApi(PRIYA);
        const { u } = renderMembers(PRIYA);
        await screen.findByRole('table', { name: 'Members' });

        expect(controls(tableRow('Ana Lopez'))).toEqual([
            'Remove Ana Lopez',
            'More actions for Ana Lopez',
            'Role for Ana Lopez',
        ]);
        expect(controls(tableRow('Jonas Weber'))).toEqual([
            'Remove Jonas Weber',
            'More actions for Jonas Weber',
            'Role for Jonas Weber',
        ]);
        expect(controls(tableRow('Priya Raman'))).toEqual([]);
        expect(within(tableRow('Priya Raman')).getByText(OWNER_LEAVE_HINT)).toBeVisible();

        await u.click(within(tableRow('Ana Lopez')).getByRole('button', { name: /More actions/ }));
        expect(
            within(await screen.findByRole('menu'))
                .getAllByRole('menuitem')
                .map((i) => i.textContent),
        ).toEqual(['Make owner']);
    });

    it('OWNER below 820px: the same actions in a menu', async () => {
        mockApi(PRIYA);
        const { u } = renderMembers(PRIYA);
        const list = await screen.findByRole('list', { name: 'Members' });

        expect(within(list).queryByRole('button', { name: 'Actions for Priya Raman' })).toBeNull();
        expect(within(list).getByText(OWNER_LEAVE_HINT)).toBeVisible();
        await u.click(within(list).getByRole('button', { name: 'Actions for Ana Lopez' }));
        expect(
            within(await screen.findByRole('menu'))
                .getAllByRole('menuitem')
                .map((i) => i.textContent),
        ).toEqual(['Make member', 'Make owner', 'Remove']);
    });

    it('ADMIN: Remove only on MEMBER rows; Leave on their own', async () => {
        mockApi(ANA);
        renderMembers(ANA);
        await screen.findByRole('table', { name: 'Members' });

        expect(controls(tableRow('Priya Raman'))).toEqual([]);
        expect(controls(tableRow('Jonas Weber'))).toEqual(['Remove Jonas Weber']);
        expect(controls(tableRow('Ana Lopez'))).toEqual(['Leave project']);
        expect(screen.queryByText(OWNER_LEAVE_HINT)).not.toBeInTheDocument();
    });

    it('MEMBER: nothing on others; Leave on their own (and in their menu below 820px)', async () => {
        mockApi(JONAS);
        const { u } = renderMembers(JONAS);
        await screen.findByRole('table', { name: 'Members' });

        expect(controls(tableRow('Priya Raman'))).toEqual([]);
        expect(controls(tableRow('Ana Lopez'))).toEqual([]);
        expect(controls(tableRow('Jonas Weber'))).toEqual(['Leave project']);

        const list = screen.getByRole('list', { name: 'Members' });
        expect(within(list).getAllByRole('button')).toHaveLength(1);
        await u.click(within(list).getByRole('button', { name: 'Actions for Jonas Weber' }));
        expect(
            within(await screen.findByRole('menu'))
                .getAllByRole('menuitem')
                .map((i) => i.textContent),
        ).toEqual(['Leave project']);
    });
});

describe('changing a role', () => {
    it('saves with a spinner; the returned list becomes the cache — no GET afterwards', async () => {
        const state = mockApi(PRIYA);
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        server.use(
            http.patch(api('/p1/members/:userId'), async ({ params, request }) => {
                const { role } = (await request.json()) as { role: ProjectRole };
                state.patches.push({ userId: String(params.userId), role });
                await held;
                // Only the PATCH response says Jonas is an admin; a GET would still say member.
                return HttpResponse.json({
                    data: state.members.map((m) =>
                        m.user.id === params.userId ? { ...m, role } : m,
                    ),
                });
            }),
        );
        const { u } = renderMembers(PRIYA);
        await screen.findByRole('table', { name: 'Members' });
        const select = within(tableRow('Jonas Weber')).getByRole('combobox', {
            name: 'Role for Jonas Weber',
        });

        await u.selectOptions(select, 'ADMIN');

        expect(select).toBeDisabled();
        expect(within(tableRow('Jonas Weber')).getByRole('status')).toHaveTextContent(
            'Saving role',
        );
        release();
        await vi.waitFor(() => expect(select).toBeEnabled());
        expect(select).toHaveValue('ADMIN');
        expect(state.patches).toEqual([{ userId: 'u-member', role: 'ADMIN' }]);
        expect(state.gets.members).toBe(1);
        const list = screen.getByRole('list', { name: 'Members' });
        expect(within(list).getByText('Jonas Weber').closest('li')).toHaveTextContent('Admin');
    });
});

describe('transferring ownership', () => {
    it('confirm → PATCH role OWNER → the list and the header say Admin, Make owner is gone', async () => {
        const state = mockApi(PRIYA);
        const { u } = renderMembers(PRIYA);
        await screen.findByRole('table', { name: 'Members' });
        expect(headerRole()).toContain('Owner');

        await u.click(within(tableRow('Ana Lopez')).getByRole('button', { name: /More actions/ }));
        await u.click(await screen.findByRole('menuitem', { name: 'Make owner' }));
        const dialog = await screen.findByRole('dialog', {
            name: 'Transfer ownership to Ana Lopez?',
        });
        expect(dialog).toHaveTextContent(
            "You'll become an admin. Only Ana Lopez will be able to delete the project, change roles or invite admins.",
        );
        await u.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }));

        await vi.waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('Ana Lopez is now the owner.'),
        );
        expect(state.patches).toEqual([{ userId: 'u-admin', role: 'OWNER' }]);
        await vi.waitFor(() => expect(headerRole()).toContain('Admin'));
        expect(headerRole()).not.toContain('Owner');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        // Now an admin: no role selects, no Make owner; Leave on my own row.
        expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: /Role for/ })).not.toBeInTheDocument();
        expect(within(tableRow('Ana Lopez')).getByText('Owner')).toBeVisible();
        expect(controls(tableRow('Priya Raman'))).toEqual(['Leave project']);
    });
});

describe('removing', () => {
    it('confirm → DELETE → the row goes, task queries are invalidated, a toast', async () => {
        const state = mockApi(ANA);
        const { client, u } = renderMembers(ANA);
        const tasksKey = queryKeys.tasks.list('p1', {});
        client.setQueryData(tasksKey, {
            items: [],
            meta: { page: 1, limit: 25, total: 0, totalPages: 0 },
        });
        await screen.findByRole('table', { name: 'Members' });

        await u.click(
            within(tableRow('Jonas Weber')).getByRole('button', { name: 'Remove Jonas Weber' }),
        );
        const dialog = await screen.findByRole('dialog', { name: 'Remove Jonas Weber?' });
        expect(dialog).toHaveTextContent(
            'Their open tasks will be unassigned. Their comments and files stay.',
        );
        await u.click(within(dialog).getByRole('button', { name: 'Remove' }));

        await vi.waitFor(() =>
            expect(
                within(screen.getByRole('table', { name: 'Members' })).queryByText('Jonas Weber'),
            ).toBeNull(),
        );
        expect(state.deletes).toEqual(['u-member']);
        expect(client.getQueryState(tasksKey)?.isInvalidated).toBe(true);
        expect(toast).toHaveBeenCalledWith('Jonas Weber was removed.');
        expect(screen.getByTestId('member-count')).toHaveTextContent('2');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('409: a toast with the API’s message; the dialog stays open', async () => {
        mockApi(ANA, { remove: apiError(409, 'CONFLICT', 'They own open tasks.') });
        const { u } = renderMembers(ANA);
        await screen.findByRole('table', { name: 'Members' });

        await u.click(
            within(tableRow('Jonas Weber')).getByRole('button', { name: 'Remove Jonas Weber' }),
        );
        await confirmIn(u, 'Remove Jonas Weber?', 'Remove');

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('They own open tasks.'));
        expect(screen.getByRole('dialog', { name: 'Remove Jonas Weber?' })).toBeInTheDocument();
    });

    it('404: already gone — members refetched, "That person is no longer a member.", dialog closed', async () => {
        const state = mockApi(ANA, { remove: apiError(404, 'NOT_FOUND') });
        const { u } = renderMembers(ANA);
        await screen.findByRole('table', { name: 'Members' });
        expect(state.gets.members).toBe(1);

        await u.click(
            within(tableRow('Jonas Weber')).getByRole('button', { name: 'Remove Jonas Weber' }),
        );
        await confirmIn(u, 'Remove Jonas Weber?', 'Remove');

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(MEMBER_GONE_MESSAGE));
        await vi.waitFor(() => expect(state.gets.members).toBe(2));
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('500: an error toast; the dialog stays open for a retry', async () => {
        mockApi(ANA, { remove: apiError(500, 'INTERNAL_ERROR') });
        const { u } = renderMembers(ANA);
        await screen.findByRole('table', { name: 'Members' });

        await u.click(
            within(tableRow('Jonas Weber')).getByRole('button', { name: 'Remove Jonas Weber' }),
        );
        const dialog = await confirmIn(u, 'Remove Jonas Weber?', 'Remove');

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
        // Re-enabled once the rejection reaches the dialog, just after the toast.
        await vi.waitFor(() =>
            expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeEnabled(),
        );
        expect(screen.getByRole('dialog', { name: 'Remove Jonas Weber?' })).toBeInTheDocument();
        // Still listed (behind the modal, hence hidden).
        expect(
            within(screen.getByRole('table', { name: 'Members', hidden: true })).getByText(
                'Jonas Weber',
            ),
        ).toBeInTheDocument();
    });
});

describe('leaving', () => {
    it('confirm → DELETE myself → /dashboard/projects and a toast; the project is forgotten once its pages go', async () => {
        const state = mockApi(JONAS);
        const { client, view, u } = renderMembers(JONAS);
        await screen.findByRole('table', { name: 'Members' });

        await u.click(
            within(tableRow('Jonas Weber')).getByRole('button', { name: 'Leave project' }),
        );
        const dialog = await screen.findByRole('dialog', { name: 'Leave Website relaunch?' });
        expect(dialog).toHaveTextContent(
            "Your open tasks will be unassigned and you'll lose access to this project.",
        );
        await u.click(within(dialog).getByRole('button', { name: 'Leave' }));

        await vi.waitFor(() => expect(nav.push).toHaveBeenCalledWith('/dashboard/projects'));
        expect(state.deletes).toEqual(['u-member']);
        expect(toast).toHaveBeenCalledWith('You left Website relaunch.');
        // Nothing of the project refetched on the way out (it would 404).
        expect(state.gets.project).toBe(1);
        expect(state.gets.members).toBe(1);
        expect(client.getQueryData(queryKeys.projects.detail('p1'))).toBeDefined();

        // The route change unmounts the project's pages: then its cache goes.
        view.unmount();
        expect(client.getQueryData(queryKeys.projects.detail('p1'))).toBeUndefined();
        expect(client.getQueryData(queryKeys.members.list('p1'))).toBeUndefined();
    });

    it('404 when leaving: not a member any more anyway — the same as having left', async () => {
        mockApi(JONAS, { remove: apiError(404, 'NOT_FOUND') });
        const { u } = renderMembers(JONAS);
        await screen.findByRole('table', { name: 'Members' });

        await u.click(
            within(tableRow('Jonas Weber')).getByRole('button', { name: 'Leave project' }),
        );
        await confirmIn(u, 'Leave Website relaunch?', 'Leave');

        await vi.waitFor(() => expect(nav.push).toHaveBeenCalledWith('/dashboard/projects'));
        expect(toast.error).not.toHaveBeenCalled();
    });
});
