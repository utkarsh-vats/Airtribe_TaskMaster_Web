import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type * as Sonner from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/Tooltip';
import { resetAiAvailabilityForTests } from '@/features/ai/availability';
import {
    AI_RATE_LIMITED_MESSAGE,
    AI_UNAVAILABLE_MESSAGE,
    AI_UPSTREAM_MESSAGE,
} from '@/features/ai/components/AiDraftRow';
import { bindPermissions } from '@/features/projects/permissions';
import { ProjectContext } from '@/features/projects/ProjectContext';
import { TaskListView } from '@/features/tasks/components/TaskListView';
import { resetTaskPanelHistoryForTests } from '@/features/tasks/panelHistory';
import type { ProjectDetail } from '@/lib/api/types';
import { resetRefreshForTests } from '@/lib/auth/refresh';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { queryKeys } from '@/lib/query/keys';

import { API_ORIGIN, server } from '../../msw/server';

const url = vi.hoisted(() => ({ search: 'new=1' }));

vi.mock('next/navigation', () => ({
    usePathname: () => '/dashboard/projects/p1/tasks',
    useSearchParams: () => new URLSearchParams(url.search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', async (importOriginal) => {
    const original = await importOriginal<typeof Sonner>();
    return { ...original, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

const DRAFT = 'Write the launch post.\n- Two drafts\n- Legal review';
const tasksUrl = `${API_ORIGIN}/api/v1/projects/p1/tasks`;

const project: ProjectDetail = {
    id: 'p1',
    name: 'Website relaunch',
    description: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    myRole: 'OWNER',
    memberCount: 1,
    owner: null,
};

let aiBodies: unknown[];
let taskPosts: number;
/** AI requests the client aborted before the answer. */
let aiAborted: number;
/** When set, AI answers wait until the test releases it. */
let aiGate: Promise<void> | null;
let aiAnswered: number;
/** The next AI answer instead of a draft. */
let aiFailure: (() => Response) | null;

const aiError = (status: number, code: string) => () =>
    HttpResponse.json({ error: { code, message: 'x', requestId: 'r' } }, { status });

function mockApi() {
    server.use(
        http.get(`${API_ORIGIN}/api/v1/projects/p1`, () => HttpResponse.json({ data: project })),
        http.get(`${API_ORIGIN}/api/v1/projects/p1/members`, () => HttpResponse.json({ data: [] })),
        http.get(tasksUrl, ({ request }) => {
            const limit = Number(new URL(request.url).searchParams.get('limit'));
            return HttpResponse.json({
                data: [],
                meta: { page: 1, limit, total: 0, totalPages: 1 },
            });
        }),
        http.post(tasksUrl, () => {
            taskPosts += 1;
            return HttpResponse.json(
                { error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' } },
                { status: 500 },
            );
        }),
        http.post(`${API_ORIGIN}/api/v1/ai/task-description`, async ({ request }) => {
            aiBodies.push(await request.json());
            if (aiGate) await aiGate;
            if (request.signal.aborted) aiAborted += 1;
            aiAnswered += 1;
            if (aiFailure) {
                const failure = aiFailure;
                aiFailure = null;
                return failure();
            }
            return HttpResponse.json({ data: { description: DRAFT } });
        }),
    );
}

function renderView() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.projects.detail('p1'), project);
    const ui = () => (
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <ProjectContext
                    value={{ project, myRole: 'OWNER', can: bindPermissions('OWNER', 'u1') }}
                >
                    <TaskListView />
                </ProjectContext>
            </TooltipProvider>
        </QueryClientProvider>
    );
    const view = render(ui());
    return { rerender: () => view.rerender(ui()), user: userEvent.setup() };
}

const dialog = () => screen.findByRole('dialog', { name: 'New task' });
const title = (d: HTMLElement) => within(d).getByRole('textbox', { name: /^Title/ });
const description = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'Description' });
const draftButton = (d: HTMLElement) =>
    within(d).getByRole('button', { name: /Draft with AI|Drafting/ });

/** Close the (dirty) dialog via Discard, then reopen it. */
async function closeAndReopen(user: ReturnType<typeof userEvent.setup>, rerender: () => void) {
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    const confirm = screen.queryByRole('dialog', { name: 'Discard this task?' });
    if (confirm) await user.click(within(confirm).getByRole('button', { name: 'Discard' }));
    url.search = '';
    rerender();
    await vi.waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'New task' })).not.toBeInTheDocument(),
    );
    url.search = 'new=1';
    rerender();
    return dialog();
}

beforeEach(() => {
    url.search = 'new=1';
    resetRefreshForTests();
    resetTaskPanelHistoryForTests();
    resetAiAvailabilityForTests();
    aiBodies = [];
    taskPosts = 0;
    aiAborted = 0;
    aiGate = null;
    aiAnswered = 0;
    aiFailure = null;
    vi.mocked(toast.success).mockClear();
    vi.spyOn(shallowUrl, 'replace').mockImplementation(() => {});
    vi.spyOn(shallowUrl, 'push').mockImplementation(() => {});
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    mockApi();
});
afterEach(() => {
    resetRefreshForTests();
    vi.restoreAllMocks();
});

describe('the request', () => {
    it('is disabled without a title; sends the trimmed title only', async () => {
        const { user } = renderView();
        const d = await dialog();
        expect(draftButton(d)).toBeDisabled();
        expect(within(d).getByText('Add a title to draft a description')).toBeInTheDocument();

        await user.type(title(d), '  Write launch post  ');
        expect(within(d).getByText('Draft a description from the title')).toBeInTheDocument();
        await user.click(draftButton(d));

        await vi.waitFor(() => expect(description(d)).toHaveValue(DRAFT));
        expect(aiBodies).toEqual([{ title: 'Write launch post' }]);
    });

    it('sends the existing description as notes', async () => {
        const { user } = renderView();
        const d = await dialog();

        await user.type(title(d), 'Write launch post');
        await user.type(description(d), 'Mention the pricing page');
        await user.click(draftButton(d));

        await vi.waitFor(() =>
            expect(aiBodies).toEqual([
                { title: 'Write launch post', notes: 'Mention the pricing page' },
            ]),
        );
    });

    it('Enter in the title submits the form, never drafts', async () => {
        const { user } = renderView();
        const d = await dialog();

        await user.type(title(d), 'Write launch post{Enter}');

        await vi.waitFor(() => expect(taskPosts).toBe(1));
        expect(aiBodies).toEqual([]);
    });
});

describe('the draft', () => {
    it('fills the description (focused, cursor at the end); Undo restores the previous text', async () => {
        const { user } = renderView();
        const d = await dialog();
        await user.type(title(d), 'Write launch post');
        await user.type(description(d), 'Rough notes');
        await user.click(draftButton(d));

        await vi.waitFor(() => expect(description(d)).toHaveValue(DRAFT));
        expect(description(d)).toHaveFocus();
        expect((description(d) as HTMLTextAreaElement).selectionStart).toBe(DRAFT.length);

        await user.click(within(d).getByRole('button', { name: 'Undo' }));
        expect(description(d)).toHaveValue('Rough notes');
        expect(within(d).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });

    it('editing the description removes Undo', async () => {
        const { user } = renderView();
        const d = await dialog();
        await user.type(title(d), 'Write launch post');
        await user.click(draftButton(d));
        await within(d).findByRole('button', { name: 'Undo' });

        await user.type(description(d), '!');

        expect(within(d).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
        expect(description(d)).toHaveValue(`${DRAFT}!`);
    });

    it('while pending only the AI button is disabled', async () => {
        let release = () => {};
        aiGate = new Promise((resolve) => {
            release = resolve;
        });
        const { user } = renderView();
        const d = await dialog();
        await user.type(title(d), 'Write launch post');

        await user.click(draftButton(d));

        const button = within(d).getByRole('button', { name: /Drafting…/ });
        expect(button).toBeDisabled();
        expect(title(d)).toBeEnabled();
        expect(description(d)).toBeEnabled();
        expect(within(d).getByRole('button', { name: 'Create task' })).toBeEnabled();
        expect(within(d).getByRole('button', { name: 'Cancel' })).toBeEnabled();

        release();
        await vi.waitFor(() => expect(description(d)).toHaveValue(DRAFT));
        expect(draftButton(d)).toHaveTextContent('Draft with AI');
        expect(draftButton(d)).toBeEnabled();
    });

    it('closing mid-request drops a late answer', async () => {
        let release = () => {};
        aiGate = new Promise((resolve) => {
            release = resolve;
        });
        const { user, rerender } = renderView();
        const d = await dialog();
        await user.type(title(d), 'Write launch post');
        await user.click(draftButton(d));
        expect(aiBodies).toHaveLength(1);

        const reopened = await closeAndReopen(user, rerender);
        release(); // the late answer
        await vi.waitFor(() => expect(aiAnswered).toBe(1));

        expect(aiAborted).toBe(1); // the request was cancelled, not just ignored
        expect(description(reopened)).toHaveValue('');
        expect(title(reopened)).toHaveValue('');
    });
});

describe('errors', () => {
    it('503 AI_DISABLED: unavailable now, hidden on the next open', async () => {
        aiFailure = aiError(503, 'AI_DISABLED');
        const { user, rerender } = renderView();
        const d = await dialog();
        await user.type(title(d), 'Write launch post');
        await user.click(draftButton(d));

        expect(await within(d).findByText(AI_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
        expect(within(d).queryByRole('button', { name: /Draft/ })).not.toBeInTheDocument();

        const reopened = await closeAndReopen(user, rerender);
        expect(within(reopened).queryByText(AI_UNAVAILABLE_MESSAGE)).not.toBeInTheDocument();
        expect(within(reopened).queryByRole('button', { name: /Draft/ })).not.toBeInTheDocument();
        expect(
            within(reopened).queryByText('Add a title to draft a description'),
        ).not.toBeInTheDocument();
    });

    it('502: inline message, and the button still works', async () => {
        aiFailure = aiError(502, 'AI_UPSTREAM_ERROR');
        const { user } = renderView();
        const d = await dialog();
        await user.type(title(d), 'Write launch post');
        await user.click(draftButton(d));

        expect(await within(d).findByText(AI_UPSTREAM_MESSAGE)).toBeInTheDocument();
        expect(draftButton(d)).toBeEnabled();

        await user.click(draftButton(d));
        await vi.waitFor(() => expect(description(d)).toHaveValue(DRAFT));
        expect(within(d).queryByText(AI_UPSTREAM_MESSAGE)).not.toBeInTheDocument();
    });

    it('429: inline rate-limit message', async () => {
        aiFailure = aiError(429, 'RATE_LIMITED');
        const { user } = renderView();
        const d = await dialog();
        await user.type(title(d), 'Write launch post');
        await user.click(draftButton(d));

        expect(await within(d).findByText(AI_RATE_LIMITED_MESSAGE)).toBeInTheDocument();
        expect(description(d)).toHaveValue('');
    });

    it('a draft alone (AI row state) never makes the form dirty; the description does', async () => {
        aiFailure = aiError(502, 'AI_UPSTREAM_ERROR');
        const { user } = renderView();
        const d = await dialog();
        await user.type(title(d), 'x');
        await user.click(draftButton(d));
        await within(d).findByText(AI_UPSTREAM_MESSAGE);
        await user.clear(title(d));

        // Only the AI row has state: closing doesn't ask.
        await user.click(within(d).getByRole('button', { name: 'Cancel' }));
        expect(
            screen.queryByRole('dialog', { name: 'Discard this task?' }),
        ).not.toBeInTheDocument();
    });
});
