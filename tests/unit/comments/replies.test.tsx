/*
 * Comment replies: View N replies (loaded on first expand, oldest first, Show more replies),
 * Hide, the inline reply composer (one at a time, Esc, parentId and no taskId), optimistic
 * append with replyCount +1 and its rollback, a deleted parent (404), no Reply on replies,
 * deleting a reply, and the parent's delete confirm. The MSW lists filter, order and page like
 * the API (tests/msw/comments.ts); POST and DELETE keep `store` up to date the way the API does.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSectionsForTests } from '@/components/ui/CollapsibleSection';
import { PARENT_DELETED_MESSAGE } from '@/features/comments/api';
import { CommentThread } from '@/features/comments/components/CommentThread';
import type { Comment, ProjectDetail, User } from '@/lib/api/types';
import { resetRefreshForTests, startSession } from '@/lib/auth/refresh';
import { sessionStore } from '@/lib/auth/store';

import { commentsList, repliesList } from '../../msw/comments';
import { API_ORIGIN, server } from '../../msw/server';

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const commentsUrl = `${API_ORIGIN}/api/v1/projects/p1/comments`;

const me: User = {
    id: 'u1',
    email: 'mara@taskmaster.app',
    name: 'Mara Okafor',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
};
const PRIYA = { id: 'u2', name: 'Priya Raman' };
const ME = { id: me.id, name: me.name };

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const top = (id: string, body: string, author = PRIYA, taskId: string | null = 't1'): Comment => ({
    id,
    projectId: 'p1',
    taskId,
    authorId: author.id,
    parentId: null,
    body,
    editedAt: null,
    createdAt: minutesAgo(60),
    author,
    replyCount: 0,
});

const reply = (
    id: string,
    parent: Comment,
    body: string,
    ago: number,
    author = PRIYA,
): Comment => ({
    ...top(id, body, author, parent.taskId),
    parentId: parent.id,
    createdAt: minutesAgo(ago),
});

/** `parent` with `replies` (oldest first), its replyCount set to match. */
function withReplies(parent: Comment, replies: Comment[]): Comment[] {
    return [{ ...parent, replyCount: replies.length }, ...replies];
}

type Calls = {
    threadGets: URLSearchParams[];
    replyGets: URLSearchParams[];
    posts: Record<string, unknown>[];
    deletes: string[];
};

/**
 * The project (MEMBER), the comment and reply lists over `store`, POST (a reply bumps its
 * parent's replyCount; a missing parent → 404) and DELETE (a reply takes it down; a top-level
 * comment takes its replies with it). `post` / `remove` override those responses.
 */
function mockApi(
    store: Comment[],
    overrides: {
        post?: () => Response | Promise<Response>;
        remove?: () => Response | Promise<Response>;
    } = {},
): Calls {
    const calls: Calls = { threadGets: [], replyGets: [], posts: [], deletes: [] };
    let seq = 0;
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () =>
            HttpResponse.json({
                data: {
                    id: 'p1',
                    name: 'Website relaunch',
                    description: null,
                    createdAt: '2026-10-01T09:00:00.000Z',
                    updatedAt: '2026-10-01T09:00:00.000Z',
                    myRole: 'MEMBER',
                    memberCount: 2,
                    owner: null,
                } satisfies ProjectDetail,
            }),
        ),
        commentsList(store, calls.threadGets),
        repliesList(store, calls.replyGets),
        http.post(commentsUrl, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            calls.posts.push(body);
            if (overrides.post) return overrides.post();
            const parent = store.find((c) => c.id === body.parentId);
            if (body.parentId && !parent) {
                return HttpResponse.json(
                    { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r' } },
                    { status: 404 },
                );
            }
            seq += 1;
            const created: Comment = parent
                ? reply(`r-new-${seq}`, parent, String(body.body), 0, ME)
                : top(`c-new-${seq}`, String(body.body), ME);
            if (parent) parent.replyCount += 1;
            store.push(created);
            return HttpResponse.json({ data: created }, { status: 201 });
        }),
        http.delete(`${commentsUrl}/:id`, ({ params }) => {
            calls.deletes.push(String(params.id));
            if (overrides.remove) return overrides.remove();
            const gone = store.find((c) => c.id === params.id);
            const parent = store.find((c) => c.id === gone?.parentId);
            if (parent) parent.replyCount -= 1;
            for (let i = store.length - 1; i >= 0; i -= 1) {
                const c = store[i] as Comment;
                if (c.id === params.id || c.parentId === params.id) store.splice(i, 1);
            }
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return calls;
}

let client: QueryClient;

function renderThread(taskId: string | null = 't1') {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <CommentThread projectId="p1" taskId={taskId} />
        </QueryClientProvider>,
    );
    return userEvent.setup();
}

/** A top-level comment's row (not its replies'). */
const commentRow = (body: string) =>
    within(screen.getByRole('list', { name: /^(Comments|Discussion)$/ }))
        .getByText(body, { selector: 'p' })
        .closest('li') as HTMLElement;
const repliesOf = (name = 'Priya Raman') =>
    screen.queryByRole('list', { name: `Replies to ${name}` });
const replyTexts = (name?: string) =>
    within(repliesOf(name) as HTMLElement)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('p')?.textContent);
const toggleOf = (body: string) =>
    within(commentRow(body)).getByRole('button', { name: /^(View \d+ repl(y|ies)|Hide replies)$/ });
const replyComposer = (name = 'Priya Raman') =>
    screen.getByRole('textbox', { name: `Reply to ${name}` });

beforeEach(() => {
    resetSectionsForTests();
    sessionStore.reset();
    resetRefreshForTests();
    startSession({ accessToken: 'at', expiresIn: 900, user: me });
    vi.mocked(toast).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('viewing replies', () => {
    it('"View 2 replies" loads them only when first expanded, oldest first; Hide hides them', async () => {
        const parent = top('c1', 'Kick-off notes');
        const calls = mockApi(
            withReplies(parent, [
                reply('r1', parent, 'Older reply', 30),
                reply('r2', parent, 'Newer reply', 10),
            ]),
        );
        const u = renderThread();
        await screen.findByText('Kick-off notes');

        const toggle = toggleOf('Kick-off notes');
        expect(toggle).toHaveTextContent('View 2 replies');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        // Everything that was going to load has: the replies weren't asked for.
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
        expect(calls.replyGets).toHaveLength(0);

        await u.click(toggle);

        await vi.waitFor(() => expect(repliesOf()).toBeInTheDocument());
        expect(replyTexts()).toEqual(['Older reply', 'Newer reply']);
        expect(calls.replyGets).toHaveLength(1);
        expect(calls.replyGets[0]?.get('order')).toBe('asc');
        expect(calls.replyGets[0]?.get('limit')).toBe('20');
        expect(toggle).toHaveTextContent('Hide replies');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const region = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
        expect(region).toContainElement(repliesOf());
        // Replies have no Reply of their own (one level only).
        expect(
            within(repliesOf() as HTMLElement).queryByRole('button', { name: /^Reply to/ }),
        ).not.toBeInTheDocument();

        await u.click(toggle);
        expect(toggle).toHaveTextContent('View 2 replies');
        expect(region).not.toBeVisible();
    });

    it('"View 1 reply" in the singular; no toggle without replies', async () => {
        const parent = top('c1', 'One reply here');
        mockApi([
            ...withReplies(parent, [reply('r1', parent, 'Only reply', 5)]),
            top('c2', 'None here'),
        ]);
        renderThread();
        await screen.findByText('None here');

        expect(toggleOf('One reply here')).toHaveTextContent('View 1 reply');
        expect(
            within(commentRow('None here')).queryByRole('button', { name: /View|Hide/ }),
        ).not.toBeInTheDocument();
    });

    it('Show more replies fetches the next page (20 a page)', async () => {
        const parent = top('c1', 'Busy comment');
        const replies = Array.from({ length: 25 }, (_, i) =>
            reply(`r${i + 1}`, parent, `Reply ${i + 1}`, 100 - i),
        );
        const calls = mockApi(withReplies(parent, replies));
        const u = renderThread();
        await screen.findByText('Busy comment');

        await u.click(toggleOf('Busy comment'));
        await vi.waitFor(() => expect(repliesOf()).toBeInTheDocument());
        expect(replyTexts()).toHaveLength(20);
        expect(replyTexts()[0]).toBe('Reply 1');

        await u.click(screen.getByRole('button', { name: 'Show more replies' }));

        await vi.waitFor(() => expect(replyTexts()).toHaveLength(25));
        expect(replyTexts().at(-1)).toBe('Reply 25');
        expect(calls.replyGets.map((g) => g.get('page'))).toEqual(['1', '2']);
        expect(screen.queryByRole('button', { name: 'Show more replies' })).not.toBeInTheDocument();
    });
});

describe('replying', () => {
    it('Reply opens one composer at a time, focused, "Reply to {name}…"; Esc closes it', async () => {
        mockApi([top('c1', 'From Priya'), top('c2', 'From me', ME)]);
        const u = renderThread();
        await screen.findByText('From me');

        await u.click(
            within(commentRow('From Priya')).getByRole('button', { name: 'Reply to Priya Raman' }),
        );
        expect(replyComposer()).toHaveFocus();
        expect(replyComposer()).toHaveAttribute('placeholder', 'Reply to Priya Raman…');

        // Another comment's Reply moves the one composer there.
        await u.click(
            within(commentRow('From me')).getByRole('button', { name: 'Reply to Mara Okafor' }),
        );
        expect(
            screen.queryByRole('textbox', { name: 'Reply to Priya Raman' }),
        ).not.toBeInTheDocument();
        expect(replyComposer('Mara Okafor')).toHaveFocus();

        await u.keyboard('{Escape}');
        expect(screen.queryByRole('textbox', { name: /^Reply to/ })).not.toBeInTheDocument();
    });

    it('posting sends parentId and no taskId; the reply shows at once at the end, and the count goes up', async () => {
        const parent = top('c1', 'Kick-off notes');
        const store = withReplies(parent, [reply('r1', parent, 'First reply', 30)]);
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        const calls = mockApi(store);
        const realPost = calls.posts;
        server.use(
            http.post(commentsUrl, async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                realPost.push(body);
                await held;
                const saved = reply('r-saved', store[0] as Comment, String(body.body), 0, ME);
                (store[0] as Comment).replyCount += 1;
                store.push(saved);
                return HttpResponse.json({ data: saved }, { status: 201 });
            }),
        );
        const u = renderThread();
        await screen.findByText('Kick-off notes');

        await u.click(
            within(commentRow('Kick-off notes')).getByRole('button', {
                name: 'Reply to Priya Raman',
            }),
        );
        await vi.waitFor(() => expect(repliesOf()).toBeInTheDocument());
        await u.type(replyComposer(), 'On it');
        await u.keyboard('{Control>}{Enter}{/Control}');

        // Before the server answers: appended, dimmed; the box is empty; 2 replies now.
        expect(replyTexts()).toEqual(['First reply', 'On it']);
        const pending = within(repliesOf() as HTMLElement)
            .getAllByRole('listitem')
            .at(-1);
        expect(pending).toHaveAttribute('aria-busy', 'true');
        expect(replyComposer()).toHaveValue('');
        expect(calls.posts).toEqual([{ body: 'On it', parentId: 'c1' }]);

        release();
        await vi.waitFor(() =>
            expect(
                within(repliesOf() as HTMLElement)
                    .getAllByRole('listitem')
                    .at(-1),
            ).not.toHaveAttribute('aria-busy'),
        );
        expect(replyTexts()).toEqual(['First reply', 'On it']);

        await u.keyboard('{Escape}');
        await u.click(toggleOf('Kick-off notes'));
        expect(toggleOf('Kick-off notes')).toHaveTextContent('View 2 replies');
    });

    it('a failure (500) takes the reply and the count back out, and keeps the text', async () => {
        const parent = top('c1', 'Kick-off notes');
        let fail = () => {};
        const failed = new Promise<void>((resolve) => (fail = resolve));
        mockApi(withReplies(parent, [reply('r1', parent, 'First reply', 30)]), {
            post: async () => {
                await failed;
                return HttpResponse.json(
                    { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
                    { status: 500 },
                );
            },
        });
        const u = renderThread();
        await screen.findByText('Kick-off notes');
        await u.click(
            within(commentRow('Kick-off notes')).getByRole('button', {
                name: 'Reply to Priya Raman',
            }),
        );
        await vi.waitFor(() => expect(repliesOf()).toBeInTheDocument());

        await u.type(replyComposer(), 'Will fail');
        await u.click(screen.getByRole('button', { name: 'Post reply' }));
        expect(replyTexts()).toEqual(['First reply', 'Will fail']);

        fail();
        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        await vi.waitFor(() => expect(replyTexts()).toEqual(['First reply']));
        await vi.waitFor(() => expect(replyComposer()).toHaveValue('Will fail'));

        await u.keyboard('{Escape}');
        await u.click(toggleOf('Kick-off notes'));
        expect(toggleOf('Kick-off notes')).toHaveTextContent('View 1 reply');
    });

    it('404 (the comment was deleted meanwhile): "That comment was deleted", and the thread is refetched', async () => {
        const store = [top('c1', 'About to vanish')];
        const calls = mockApi(store);
        const u = renderThread();
        await screen.findByText('About to vanish');
        await u.click(
            within(commentRow('About to vanish')).getByRole('button', {
                name: 'Reply to Priya Raman',
            }),
        );

        // Someone deletes it.
        store.splice(0, 1);
        const before = calls.threadGets.length;
        await u.type(replyComposer(), 'Too late');
        await u.click(screen.getByRole('button', { name: 'Post reply' }));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(PARENT_DELETED_MESSAGE));
        await vi.waitFor(() => expect(calls.threadGets.length).toBeGreaterThan(before));
        expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
    });
});

describe('deleting', () => {
    it('deleting my reply removes it and takes the count down', async () => {
        const parent = top('c1', 'Kick-off notes');
        const calls = mockApi(
            withReplies(parent, [
                reply('r1', parent, 'Keep this', 30),
                reply('r2', parent, 'My reply', 10, ME),
            ]),
        );
        const u = renderThread();
        await screen.findByText('Kick-off notes');
        await u.click(toggleOf('Kick-off notes'));
        await vi.waitFor(() => expect(repliesOf()).toBeInTheDocument());

        const mine = within(repliesOf() as HTMLElement)
            .getByText('My reply')
            .closest('li') as HTMLElement;
        await u.click(within(mine).getByRole('button', { name: 'Comment actions' }));
        await u.click(await screen.findByRole('menuitem', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete this reply?' });
        expect(dialog).not.toHaveTextContent(/also deletes/);
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('My reply')).not.toBeInTheDocument());
        expect(calls.deletes).toEqual(['r2']);
        expect(replyTexts()).toEqual(['Keep this']);
        await u.click(toggleOf('Kick-off notes'));
        expect(toggleOf('Kick-off notes')).toHaveTextContent('View 1 reply');
    });

    it.each([
        [2, 'This also deletes 2 replies.'],
        [1, 'This also deletes 1 reply.'],
    ])('the parent’s confirm with %d replies: "%s"', async (n, line) => {
        const parent = top('c1', 'My comment', ME);
        const replies = Array.from({ length: n }, (_, i) =>
            reply(`r${i}`, parent, `Reply ${i}`, 10 + i),
        );
        const calls = mockApi(withReplies(parent, replies));
        const u = renderThread();
        await screen.findByText('My comment');

        await u.click(
            within(commentRow('My comment')).getByRole('button', { name: 'Comment actions' }),
        );
        await u.click(await screen.findByRole('menuitem', { name: 'Delete' }));
        const dialog = await screen.findByRole('dialog', { name: 'Delete this comment?' });
        expect(dialog).toHaveTextContent(line);
        expect(dialog).toHaveTextContent("This can't be undone.");
        await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await vi.waitFor(() => expect(screen.queryByText('My comment')).not.toBeInTheDocument());
        expect(calls.deletes).toEqual(['c1']);
    });
});

describe('the Discussion tab (project-level)', () => {
    it('works the same: View replies, and a reply sends parentId without a taskId', async () => {
        const parent = top('c1', 'Project-wide note', PRIYA, null);
        const calls = mockApi(withReplies(parent, [reply('r1', parent, 'Agreed', 5)]));
        const u = renderThread(null);
        await screen.findByText('Project-wide note');

        await u.click(toggleOf('Project-wide note'));
        await vi.waitFor(() => expect(replyTexts()).toEqual(['Agreed']));

        await u.click(
            within(commentRow('Project-wide note')).getByRole('button', {
                name: 'Reply to Priya Raman',
            }),
        );
        await u.type(replyComposer(), 'Me too');
        await u.click(screen.getByRole('button', { name: 'Post reply' }));

        await vi.waitFor(() => expect(replyTexts()).toEqual(['Agreed', 'Me too']));
        expect(calls.posts).toEqual([{ body: 'Me too', parentId: 'c1' }]);
    });
});
