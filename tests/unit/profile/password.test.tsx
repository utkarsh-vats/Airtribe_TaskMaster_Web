/*
 * Change password (13b): validation mirrors the API (current 1–128, new 8–128 and different,
 * confirm matches) once a field is left; a show / hide toggle per field; a wrong current
 * password (400 INVALID_CURRENT_PASSWORD) is a field error and the session survives — no
 * refresh, no logout; 422 / 429 / 500 never sign out; success toasts, signs out through
 * /api/auth/logout, tells other tabs (tm-auth) and goes to /login.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChangePasswordForm } from '@/features/profile/components/ChangePasswordForm';
import type { User } from '@/lib/api/types';
import { resetSignOutForTests } from '@/lib/auth/actions';
import { closeAuthChannelForTests } from '@/lib/auth/broadcast';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { API_ORIGIN, APP_ORIGIN, server } from '../../msw/server';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/profile',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
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
    createdAt: '2025-10-01T09:00:00.000Z',
    updatedAt: '2025-10-01T09:00:00.000Z',
};

const apiError = (status: number, code: string, details?: unknown[]) =>
    HttpResponse.json(
        { error: { code, message: code, requestId: 'r', ...(details ? { details } : {}) } },
        { status },
    );

type Calls = { patches: unknown[]; refreshes: number; logouts: number };

/** PATCH /users/me/password answered by `respond` (default 204), counting the auth routes. */
function mockApi(respond: () => Response = () => new HttpResponse(null, { status: 204 })) {
    const calls: Calls = { patches: [], refreshes: 0, logouts: 0 };
    server.use(
        http.patch(`${API_ORIGIN}/api/v1/users/me/password`, async ({ request }) => {
            calls.patches.push(await request.json());
            return respond();
        }),
        http.post(`${APP_ORIGIN}/api/auth/refresh`, () => {
            calls.refreshes += 1;
            return HttpResponse.json({ data: { accessToken: 'at-2', expiresIn: 900, user: me } });
        }),
        http.post(`${APP_ORIGIN}/api/auth/logout`, () => {
            calls.logouts += 1;
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return calls;
}

function renderForm() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ChangePasswordForm />
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

/** Password inputs aren't textboxes: find them by their label. */
const current = () => screen.getByLabelText(/^Current password/);
const next = () => screen.getByLabelText(/^New password/);
const confirm = () => screen.getByLabelText(/^Confirm new password/);
const submit = () => screen.getByRole('button', { name: 'Change password' });

async function fill(
    user: ReturnType<typeof userEvent.setup>,
    values: { current?: string; next?: string; confirm?: string },
) {
    if (values.current !== undefined) await user.type(current(), values.current);
    if (values.next !== undefined) await user.type(next(), values.next);
    if (values.confirm !== undefined) await user.type(confirm(), values.confirm);
    await user.tab();
}

const stillSignedIn = (calls: Calls) => {
    expect(sessionStore.get().status).toBe('authenticated');
    expect(sessionStore.get().accessToken).toBe('at-1');
    expect(calls.refreshes).toBe(0);
    expect(calls.logouts).toBe(0);
    expect(nav.replace).not.toHaveBeenCalled();
};

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    resetSignOutForTests();
    startSession({ accessToken: 'at-1', expiresIn: 900, user: me });
    nav.replace.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    closeAuthChannelForTests();
});

describe('the form', () => {
    it('autocomplete hints, and disabled until valid', async () => {
        mockApi();
        const user = renderForm();

        expect(current()).toHaveAttribute('autocomplete', 'current-password');
        expect(next()).toHaveAttribute('autocomplete', 'new-password');
        expect(confirm()).toHaveAttribute('autocomplete', 'new-password');
        expect(submit()).toBeDisabled();

        await fill(user, { current: 'old-secret', next: 'new-secret-1', confirm: 'new-secret-1' });

        expect(submit()).toBeEnabled();
    });

    it('a show / hide toggle per field (aria-pressed)', async () => {
        mockApi();
        const user = renderForm();
        const toggles = screen.getAllByRole('button', { name: 'Show password' });
        expect(toggles).toHaveLength(3);
        const [first, second] = toggles as [HTMLElement, HTMLElement];

        expect(current()).toHaveAttribute('type', 'password');
        expect(first).toHaveAttribute('aria-pressed', 'false');
        await user.click(first);
        expect(current()).toHaveAttribute('type', 'text');
        expect(first).toHaveAttribute('aria-pressed', 'true');
        // Each field has its own.
        expect(next()).toHaveAttribute('type', 'password');
        expect(second).toHaveAttribute('aria-pressed', 'false');
        await user.click(first);
        expect(current()).toHaveAttribute('type', 'password');
    });
});

describe('validation (after a field is left)', () => {
    it('nothing shows before a field is left', async () => {
        mockApi();
        const user = renderForm();

        await user.type(next(), 'short');

        expect(screen.queryByText('Use at least 8 characters.')).not.toBeInTheDocument();
        await user.tab();
        expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    });

    it('empty current, too long, mismatch', async () => {
        mockApi();
        const user = renderForm();

        await user.click(current());
        await user.tab();
        expect(screen.getByText('Enter your current password.')).toBeInTheDocument();

        await user.click(next());
        await user.paste('x'.repeat(129));
        await user.tab();
        expect(screen.getByText('Password must be 128 characters or fewer.')).toBeInTheDocument();

        await user.clear(next());
        await user.type(next(), 'new-secret-1');
        await user.type(confirm(), 'new-secret-2');
        await user.tab();
        expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
        expect(submit()).toBeDisabled();

        // Fixing the new password (to what was confirmed) clears the mismatch.
        await user.clear(next());
        await user.type(next(), 'new-secret-2');
        expect(screen.queryByText("Passwords don't match.")).not.toBeInTheDocument();
    });

    it('the new password must differ from the current one', async () => {
        mockApi();
        const user = renderForm();

        await fill(user, { current: 'same-secret', next: 'same-secret', confirm: 'same-secret' });

        expect(
            screen.getByText('Choose a password different from your current one.'),
        ).toBeInTheDocument();
        expect(submit()).toBeDisabled();
    });
});

describe('errors never sign out', () => {
    it('a wrong current password: under Current password; no refresh, no logout', async () => {
        const calls = mockApi(() => apiError(400, 'INVALID_CURRENT_PASSWORD'));
        const user = renderForm();
        await fill(user, { current: 'wrong-one', next: 'new-secret-1', confirm: 'new-secret-1' });

        await user.click(submit());

        expect(await screen.findByText('Your current password is incorrect.')).toBeInTheDocument();
        expect(current()).toHaveAttribute('aria-invalid', 'true');
        expect(current()).toHaveFocus();
        expect(calls.patches).toEqual([
            { currentPassword: 'wrong-one', newPassword: 'new-secret-1' },
        ]);
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        stillSignedIn(calls);
    });

    it('422: onto its field', async () => {
        const calls = mockApi(() =>
            apiError(422, 'VALIDATION_ERROR', [
                { path: 'newPassword', message: 'Too weak, says the server' },
            ]),
        );
        const user = renderForm();
        await fill(user, { current: 'old-secret', next: 'new-secret-1', confirm: 'new-secret-1' });

        await user.click(submit());

        expect(await screen.findByText('Too weak, says the server')).toBeInTheDocument();
        expect(toast.error).not.toHaveBeenCalled();
        stillSignedIn(calls);
    });

    it.each([
        [429, 'RATE_LIMITED', 'Too many attempts — try again in a minute.'],
        [500, 'INTERNAL', 'Something went wrong.'],
    ])('%i: a toast (%s), the form kept', async (status, code, message) => {
        const calls = mockApi(() => apiError(status, code));
        const user = renderForm();
        await fill(user, { current: 'old-secret', next: 'new-secret-1', confirm: 'new-secret-1' });

        await user.click(submit());

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(message);
        expect(current()).toHaveValue('old-secret');
        expect(submit()).toBeEnabled();
        stillSignedIn(calls);
    });
});

describe('success', () => {
    it('toasts, signs out through /api/auth/logout, tells other tabs, goes to /login', async () => {
        const calls = mockApi();
        const messages: unknown[] = [];
        const otherTab = new BroadcastChannel('tm-auth');
        otherTab.addEventListener('message', (event: MessageEvent) => messages.push(event.data));
        const user = renderForm();
        await fill(user, { current: 'old-secret', next: 'new-secret-1', confirm: 'new-secret-1' });

        await user.click(submit());

        await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'));
        expect(toast.success).toHaveBeenCalledWith(
            'Password changed. Sign in with your new password.',
        );
        expect(calls.patches).toEqual([
            { currentPassword: 'old-secret', newPassword: 'new-secret-1' },
        ]);
        expect(calls.logouts).toBe(1);
        expect(calls.refreshes).toBe(0);
        expect(sessionStore.get().status).toBe('unauthenticated');
        await vi.waitFor(() =>
            expect(messages).toEqual([expect.objectContaining({ type: 'signed-out' })]),
        );
        // Still spinning while it leaves.
        expect(submit()).toHaveAttribute('aria-busy', 'true');
        otherTab.close();
    });
});
