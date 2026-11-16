/*
 * /dashboard/profile (13a): the card and form load from GET /users/me; Save needs a dirty,
 * valid form; values are trimmed and only changes are sent (PATCH /users/me); success toasts
 * and renames the header's ProfileMenu at once; Reset; a 422 lands on its field; a 500 toasts
 * and keeps the edits; never a sign-out. Email is read-only (the API can't change it).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileMenu } from '@/components/shell/ProfileMenu';
import { MeSync } from '@/features/profile/components/MeSync';
import { ProfileView } from '@/features/profile/components/ProfileView';
import type { User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, server } from '../../msw/server';

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/profile',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const meUrl = `${API_ORIGIN}/api/v1/users/me`;

const saved: User = {
    id: 'u-me',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: 'Design lead.',
    avatarUrl: null,
    createdAt: '2025-10-01T09:00:00.000Z',
    updatedAt: '2025-10-01T09:00:00.000Z',
};

type Api = { patches: Record<string, unknown>[]; gets: number };

/** GET /users/me (the server's copy) and PATCH, answered by `patch` or applied to it. */
function mockApi(server_: User, patch?: () => Response | Promise<Response>): Api {
    const state: Api = { patches: [], gets: 0 };
    let current = server_;
    server.use(
        http.get(meUrl, () => {
            state.gets += 1;
            return HttpResponse.json({ data: current });
        }),
        http.patch(meUrl, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            state.patches.push(body);
            if (patch) return patch();
            current = { ...current, ...body, updatedAt: new Date().toISOString() };
            return HttpResponse.json({ data: current });
        }),
    );
    return state;
}

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MeSync />
            <ProfileMenu />
            <ProfileView />
        </QueryClientProvider>,
    );
    return { user: userEvent.setup(), client };
}

const field = (name: string) => screen.getByRole('textbox', { name });
const nameBox = () => field('Name');
const save = () => screen.getByRole('button', { name: 'Save changes' });
const resetButton = () => screen.getByRole('button', { name: 'Reset' });
const loaded = () => screen.findByTestId('profile-card');

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: saved });
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
});

describe('loading', () => {
    it('shows the card and the saved values; email read-only; nothing to save yet', async () => {
        mockApi(saved);
        renderPage();

        expect(screen.getByText('Loading your profile…')).toBeInTheDocument();
        const card = await loaded();
        expect(card).toHaveTextContent('Mara Okafor');
        expect(card).toHaveTextContent('mara@taskmaster.app');
        expect(card).toHaveTextContent('Member since October 2025');
        expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();

        expect(nameBox()).toHaveValue('Mara Okafor');
        expect(field('Bio')).toHaveValue('Design lead.');
        expect(field('Avatar URL')).toHaveValue('');
        const email = field('Email');
        expect(email).toHaveValue('mara@taskmaster.app');
        expect(email).toHaveAttribute('readonly');
        expect(screen.getByText("Your email can't be changed.")).toBeInTheDocument();
        expect(save()).toBeDisabled();
        expect(resetButton()).toBeDisabled();
    });

    it('a failed load: ErrorState, Try again loads it', async () => {
        let fail = true;
        server.use(
            http.get(meUrl, () =>
                fail
                    ? HttpResponse.json(
                          { error: { code: 'INTERNAL', message: 'Boom', requestId: 'r' } },
                          { status: 500 },
                      )
                    : HttpResponse.json({ data: saved }),
            ),
        );
        const { user } = renderPage();

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your profile");
        fail = false;
        await user.click(screen.getByRole('button', { name: 'Try again' }));

        await loaded();
        expect(sessionStore.get().status).toBe('authenticated');
    });
});

describe('validation', () => {
    it('Save is enabled only while the form is dirty and valid', async () => {
        mockApi(saved);
        const { user } = renderPage();
        await loaded();

        await user.type(nameBox(), ' Jr');
        expect(save()).toBeEnabled();

        await user.clear(nameBox());
        await user.tab();
        expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
        expect(save()).toBeDisabled();

        await user.type(nameBox(), 'x'.repeat(101));
        expect(
            await screen.findByText('Name must be 100 characters or fewer.'),
        ).toBeInTheDocument();
        expect(save()).toBeDisabled();
    });

    it('a bio over 500 and a non-http(s) avatar URL are refused', async () => {
        mockApi(saved);
        const { user } = renderPage();
        await loaded();

        await user.click(field('Bio'));
        await user.paste('b'.repeat(501));
        await user.type(field('Avatar URL'), 'ftp://example.com/me.png');
        await user.tab();

        expect(screen.getByText('Bio must be 500 characters or fewer.')).toBeInTheDocument();
        expect(screen.getByText('Enter a full http(s) URL.')).toBeInTheDocument();
        expect(save()).toBeDisabled();
    });
});

describe('saving', () => {
    it('trims, sends only what changed, toasts, and renames the header at once', async () => {
        const api = mockApi(saved);
        const { user } = renderPage();
        await loaded();
        expect(screen.getByRole('button', { name: 'Account menu for Mara Okafor' })).toBeVisible();

        await user.clear(nameBox());
        await user.type(nameBox(), '  Mara O.  ');
        await user.type(field('Avatar URL'), ' https://example.com/me.png ');
        await user.click(save());

        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Profile updated'));
        expect(api.patches).toEqual([{ name: 'Mara O.', avatarUrl: 'https://example.com/me.png' }]);
        expect(screen.getByRole('button', { name: 'Account menu for Mara O.' })).toBeVisible();
        expect(sessionStore.get().user?.name).toBe('Mara O.');
        // The card reads the me query: one batched render behind the session store.
        await vi.waitFor(() =>
            expect(screen.getByTestId('profile-card')).toHaveTextContent('Mara O.'),
        );
        // The saved values are the new baseline.
        expect(nameBox()).toHaveValue('Mara O.');
        expect(save()).toBeDisabled();
        expect(resetButton()).toBeDisabled();
    });

    it('clearing the bio sends null', async () => {
        const api = mockApi(saved);
        const { user } = renderPage();
        await loaded();

        await user.clear(field('Bio'));
        await user.click(save());

        await vi.waitFor(() => expect(api.patches).toEqual([{ bio: null }]));
    });

    it('only whitespace added: nothing to send, back to the saved values', async () => {
        const api = mockApi(saved);
        const { user } = renderPage();
        await loaded();

        await user.type(nameBox(), '   ');
        await user.click(save());

        await vi.waitFor(() => expect(nameBox()).toHaveValue('Mara Okafor'));
        expect(api.patches).toEqual([]);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('Reset puts the saved values back', async () => {
        const api = mockApi(saved);
        const { user } = renderPage();
        await loaded();

        await user.type(nameBox(), ' Jr');
        await user.clear(field('Bio'));
        await user.click(resetButton());

        expect(nameBox()).toHaveValue('Mara Okafor');
        expect(field('Bio')).toHaveValue('Design lead.');
        expect(save()).toBeDisabled();
        expect(api.patches).toEqual([]);
    });
});

describe('errors', () => {
    it('422: the message goes under its field; no toast, nothing renamed', async () => {
        mockApi(saved, () =>
            HttpResponse.json(
                {
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request',
                        requestId: 'r',
                        details: [{ path: 'avatarUrl', message: 'Must be an http(s) URL' }],
                    },
                },
                { status: 422 },
            ),
        );
        const { user } = renderPage();
        await loaded();

        await user.type(nameBox(), ' Jr');
        await user.type(field('Avatar URL'), 'https://example.com/a.png');
        await user.click(save());

        expect(await screen.findByText('Must be an http(s) URL')).toBeInTheDocument();
        expect(field('Avatar URL')).toHaveAttribute('aria-invalid', 'true');
        expect(toast.error).not.toHaveBeenCalled();
        expect(sessionStore.get().user?.name).toBe('Mara Okafor');
        expect(nameBox()).toHaveValue('Mara Okafor Jr');
    });

    it('500: toasts, keeps the edits to try again, stays signed in', async () => {
        mockApi(saved, () =>
            HttpResponse.json(
                { error: { code: 'INTERNAL', message: 'Server exploded', requestId: 'r' } },
                { status: 500 },
            ),
        );
        const { user } = renderPage();
        await loaded();

        await user.type(nameBox(), ' Jr');
        await user.click(save());

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(nameBox()).toHaveValue('Mara Okafor Jr');
        expect(save()).toBeEnabled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(sessionStore.get().status).toBe('authenticated');
        expect(screen.getByRole('button', { name: 'Account menu for Mara Okafor' })).toBeVisible();
    });
});

describe('other tabs', () => {
    it('a me refetch with a newer name renames the header; a field being edited keeps its text', async () => {
        let current = saved;
        server.use(http.get(meUrl, () => HttpResponse.json({ data: current })));
        const { user, client } = renderPage();
        await loaded();
        await user.click(field('Bio'));
        await user.keyboard(' Edited.');

        // Changed in another tab; this one refetches on focus.
        current = { ...saved, name: 'Mara Okafor-Reyes', updatedAt: new Date().toISOString() };
        await client.refetchQueries({ queryKey: ['me'] });

        await vi.waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Account menu for Mara Okafor-Reyes' }),
            ).toBeVisible(),
        );
        await vi.waitFor(() => expect(nameBox()).toHaveValue('Mara Okafor-Reyes'));
        expect(field('Bio')).toHaveValue('Design lead. Edited.');
    });
});
