import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/components/ui/Toaster';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { ACCOUNT_CREATED_MESSAGE, RegisterForm } from '@/features/auth/components/RegisterForm';
import { EMAIL_TAKEN_MESSAGE } from '@/features/auth/errors';
import { resetRefreshForTests } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { APP_ORIGIN, server } from '../../msw/server';

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const user = {
    id: '6c1d1b8e-2f4a-4c3b-8d9e-0a1b2c3d4e5f',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};
const session = { data: { accessToken: 'at-1', expiresIn: 900, user } };
const authUrl = (path: string) => `${APP_ORIGIN}/api/auth/${path}`;
const apiError = (status: number, code: string, details?: { path: string; message: string }[]) =>
    HttpResponse.json({ error: { code, message: code, details, requestId: 'r' } }, { status });

const NEXT = '/dashboard/projects/p1/tasks?view=board';

beforeEach(() => {
    sessionStore.reset();
    resetRefreshForTests();
    router.replace.mockClear();
});
afterEach(() => resetRefreshForTests());

const fields = () => ({
    name: () => screen.getByLabelText('Full name'),
    email: () => screen.getByLabelText('Email'),
    password: () => screen.getByLabelText('Password'),
});

async function fillLogin(email = user.email, password = 'correct horse') {
    const u = userEvent.setup();
    if (email) await u.type(fields().email(), email);
    if (password) await u.type(fields().password(), password);
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    return u;
}

async function fillRegister({
    name = user.name,
    email = user.email,
    password = 'correct horse',
} = {}) {
    const u = userEvent.setup();
    if (name) await u.type(fields().name(), name);
    if (email) await u.type(fields().email(), email);
    if (password) await u.type(fields().password(), password);
    await u.click(screen.getByRole('button', { name: 'Create account' }));
    return u;
}

describe('client validation', () => {
    it('login: requires a valid email and a password', async () => {
        render(<LoginForm />);
        await fillLogin('not-an-email', '');

        expect(fields().email()).toHaveAccessibleDescription('Enter a valid email address.');
        expect(fields().email()).toHaveAttribute('aria-invalid', 'true');
        expect(fields().password()).toHaveAccessibleDescription('Enter your password.');
        expect(fields().email()).toHaveFocus(); // first invalid field
    });

    it('login: empty email', async () => {
        render(<LoginForm />);
        await fillLogin('', 'x');

        expect(fields().email()).toHaveAccessibleDescription('Enter your email address.');
    });

    it('login: accepts a short password (no length rule on sign-in)', async () => {
        server.use(http.post(authUrl('login'), () => HttpResponse.json(session)));
        render(<LoginForm />);
        await fillLogin(user.email, 'abc');

        await vi.waitFor(() => expect(router.replace).toHaveBeenCalled());
    });

    it('register: name, email and an 8+ character password; a short password is blocked', async () => {
        let called = false;
        server.use(
            http.post(authUrl('register'), () => {
                called = true;
                return HttpResponse.json(session, { status: 201 });
            }),
        );
        render(<RegisterForm />);
        await fillRegister({ name: '   ', email: 'nope', password: 'short' });

        expect(fields().name()).toHaveAccessibleDescription('Enter your name.');
        expect(fields().email()).toHaveAccessibleDescription('Enter a valid email address.');
        expect(fields().password()).toHaveAccessibleDescription(
            'Password is too short. At least 8 characters',
        );
        expect(called).toBe(false);
    });

    it('register: shows the password hint up front', () => {
        render(<RegisterForm />);

        expect(fields().password()).toHaveAccessibleDescription('At least 8 characters');
        expect(fields().password()).toHaveAttribute('autocomplete', 'new-password');
        expect(fields().name()).toHaveAttribute('autocomplete', 'name');
    });
});

describe('login submit', () => {
    it('signs in through /api/auth/login and goes to safeNext(next)', async () => {
        let sent: unknown;
        server.use(
            http.post(authUrl('login'), async ({ request }) => {
                sent = await request.json();
                return HttpResponse.json(session);
            }),
        );
        render(<LoginForm next={NEXT} />);
        await fillLogin();

        await vi.waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith(NEXT));
        expect(sent).toEqual({ email: user.email, password: 'correct horse' });
        expect(sessionStore.get()).toMatchObject({ status: 'authenticated', user });
    });

    it('ignores an unsafe next', async () => {
        server.use(http.post(authUrl('login'), () => HttpResponse.json(session)));
        render(<LoginForm next="//evil.com" />);
        await fillLogin();

        await vi.waitFor(() =>
            expect(router.replace).toHaveBeenCalledExactlyOnceWith('/dashboard'),
        );
    });

    it('INVALID_CREDENTIALS: form-level alert, focus on it, typed email kept', async () => {
        server.use(http.post(authUrl('login'), () => apiError(401, 'INVALID_CREDENTIALS')));
        render(<LoginForm />);
        await fillLogin(user.email, 'wrong password');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Incorrect email or password.');
        expect(alert).toHaveFocus();
        expect(fields().email()).toHaveValue(user.email);
        expect(router.replace).not.toHaveBeenCalled();
    });

    it.each([
        ['429', () => apiError(429, 'RATE_LIMITED'), 'Too many attempts — try again in a minute.'],
        [
            'network failure',
            () => HttpResponse.error(),
            "Can't reach the server. Check your connection.",
        ],
        ['502 from the proxy', () => apiError(502, 'INTERNAL_ERROR'), 'Something went wrong.'],
    ])('%s → form-level message', async (_label, respond, message) => {
        server.use(http.post(authUrl('login'), respond));
        render(<LoginForm />);
        await fillLogin();

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
    });

    it('422 details land on the matching fields', async () => {
        server.use(
            http.post(authUrl('login'), () =>
                apiError(422, 'VALIDATION_ERROR', [
                    { path: 'email', message: 'Invalid email address' },
                ]),
            ),
        );
        render(<LoginForm />);
        await fillLogin();

        await vi.waitFor(() =>
            expect(fields().email()).toHaveAccessibleDescription('Invalid email address'),
        );
        expect(fields().email()).toHaveFocus();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('422 details it cannot place go to the form-level message', async () => {
        server.use(
            http.post(authUrl('login'), () =>
                apiError(422, 'VALIDATION_ERROR', [
                    { path: '', message: 'Unrecognized key: "extra"' },
                ]),
            ),
        );
        render(<LoginForm />);
        await fillLogin();

        expect(await screen.findByRole('alert')).toHaveTextContent('Unrecognized key: "extra"');
    });

    it('disables the submit and sets aria-busy while pending', async () => {
        server.use(
            http.post(authUrl('login'), async () => {
                await delay(200);
                return apiError(401, 'INVALID_CREDENTIALS');
            }),
        );
        render(<LoginForm />);
        await fillLogin();

        const submit = screen.getByRole('button', { name: 'Sign in' });
        expect(submit).toBeDisabled();
        expect(submit).toHaveAttribute('aria-busy', 'true');

        await screen.findByRole('alert');
        expect(submit).toBeEnabled();
        expect(submit).not.toHaveAttribute('aria-busy');
    });
});

describe('register submit', () => {
    it('creates the account and goes to safeNext(next)', async () => {
        server.use(
            http.post(authUrl('register'), () => HttpResponse.json(session, { status: 201 })),
        );
        render(<RegisterForm next={NEXT} />);
        await fillRegister();

        await vi.waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith(NEXT));
    });

    it('409 puts the error on the email field', async () => {
        server.use(http.post(authUrl('register'), () => apiError(409, 'CONFLICT')));
        render(<RegisterForm />);
        await fillRegister();

        await vi.waitFor(() =>
            expect(fields().email()).toHaveAccessibleDescription(EMAIL_TAKEN_MESSAGE),
        );
        expect(fields().email()).toHaveFocus();
    });

    it('422 details land on the matching fields', async () => {
        server.use(
            http.post(authUrl('register'), () =>
                apiError(422, 'VALIDATION_ERROR', [
                    { path: 'name', message: 'Name is too long' },
                    { path: 'password', message: 'Password is too common' },
                ]),
            ),
        );
        render(<RegisterForm />);
        await fillRegister();

        await vi.waitFor(() =>
            expect(fields().name()).toHaveAccessibleDescription('Name is too long'),
        );
        expect(fields().password()).toHaveAccessibleDescription(
            'Password is too common At least 8 characters',
        );
    });

    it('needsLogin → /login with next kept, plus a toast', async () => {
        const success = vi.spyOn(toast, 'success');
        server.use(
            http.post(authUrl('register'), () =>
                HttpResponse.json({ data: { user, accessToken: null } }, { status: 201 }),
            ),
        );
        render(<RegisterForm next={NEXT} />);
        await fillRegister();

        await vi.waitFor(() =>
            expect(router.replace).toHaveBeenCalledExactlyOnceWith(
                `/login?next=${encodeURIComponent(NEXT)}`,
            ),
        );
        expect(success).toHaveBeenCalledWith(ACCOUNT_CREATED_MESSAGE);
        success.mockRestore();
    });
});

describe('page chrome', () => {
    it('the switch keeps next and marks the current page', () => {
        render(<LoginForm next={NEXT} />);

        const nav = screen.getByRole('navigation', { name: 'Sign in or create an account' });
        const signInLink = screen.getByRole('link', { name: 'Sign in' });
        const registerLink = screen.getByRole('link', { name: 'Create account' });
        expect(nav).toContainElement(registerLink);
        expect(signInLink).toHaveAttribute('aria-current', 'page');
        expect(registerLink).not.toHaveAttribute('aria-current');
        expect(registerLink).toHaveAttribute('href', `/register?next=${encodeURIComponent(NEXT)}`);
        expect(signInLink).toHaveAttribute('href', `/login?next=${encodeURIComponent(NEXT)}`);
    });

    it('the switch links have no next when there is none', () => {
        render(<RegisterForm />);

        expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
        expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
            'aria-current',
            'page',
        );
    });

    it('headings follow the prototype and there is no "Forgot password?"', () => {
        const { unmount } = render(<LoginForm />);
        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
        expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
        unmount();

        render(<RegisterForm />);
        expect(screen.getByRole('heading', { name: 'Start with a project' })).toBeInTheDocument();
    });

    it('the password toggle flips the input type and aria-pressed', async () => {
        const u = userEvent.setup();
        render(<LoginForm />);
        const toggle = screen.getByRole('button', { name: 'Show password' });

        expect(fields().password()).toHaveAttribute('type', 'password');
        expect(toggle).toHaveAttribute('aria-pressed', 'false');

        await u.click(toggle);
        expect(fields().password()).toHaveAttribute('type', 'text');
        expect(toggle).toHaveAttribute('aria-pressed', 'true');

        await u.click(toggle);
        expect(fields().password()).toHaveAttribute('type', 'password');
        expect(fields().password()).toHaveAttribute('autocomplete', 'current-password');
    });
});
