import { z } from 'zod';

import type { Notification } from '@/lib/api/types';

/*
 * A notification as a sentence (DESIGN.md §9), from its type and payload snapshot (names as
 * they were at the time). The payload is checked per type with a small schema; anything that
 * doesn't fit — a type this client doesn't know yet, a malformed payload — falls back to a
 * generic sentence, so the page never breaks on it.
 *
 * Payloads (backend notifications.listener.ts): every one has `actor { id, name|null }` and
 * `project { id, name }`; task events add `task { id, title }`; TASK_UPDATED `changedFields`;
 * COMMENT_ADDED `commentId` + `commentPreview`; COMMENT_REPLY `commentId`, `parentId`,
 * `commentPreview` (+ `task` when on a task); PROJECT_INVITATION `invitationId` + `role`.
 */

/** A piece of the sentence; `strong` ones (task and project names) are shown bold. */
export type SentencePart = { text: string; strong?: boolean };

export type NotificationSentence = {
    /** The plain sentence, e.g. for an accessible name. */
    text: string;
    parts: SentencePart[];
    /** Where the notification leads. */
    href: string;
};

const actor = z.object({ id: z.string(), name: z.string().nullable() });
const project = z.object({ id: z.string(), name: z.string() });
const task = z.object({ id: z.string(), title: z.string() });

const base = z.object({ actor, project });
const taskEvent = base.extend({ task });
const updated = taskEvent.extend({ changedFields: z.array(z.string()).optional() });
const commented = base.extend({ task: task.optional(), commentPreview: z.string() });
const replied = commented.extend({ parentId: z.string() });

/** Field names as the API reports them → words. */
const FIELD_LABELS: Record<string, string> = {
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    dueDate: 'due date',
    assigneeId: 'assignee',
    assignee: 'assignee',
};

/** "status", "status and priority", "status, priority and due date". */
function listOf(words: string[]): string {
    if (words.length <= 1) return words[0] ?? '';
    return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const actorName = (a: z.infer<typeof actor>) => a.name ?? 'Someone';
const quoted = (preview: string) => `“${preview}”`;

const taskHref = (projectId: string, taskId: string) =>
    `/dashboard/projects/${projectId}/tasks?task=${encodeURIComponent(taskId)}`;
const discussionHref = (projectId: string) => `/dashboard/projects/${projectId}/discussion`;

function sentence(parts: SentencePart[], href: string): NotificationSentence {
    return { text: parts.map((p) => p.text).join(''), parts, href };
}

export function notificationSentence(n: Notification): NotificationSentence {
    const payload: unknown = n.payload;

    switch (n.type) {
        case 'TASK_ASSIGNED': {
            const p = taskEvent.safeParse(payload);
            if (!p.success) break;
            return sentence(
                [
                    { text: `${actorName(p.data.actor)} assigned you ` },
                    { text: p.data.task.title, strong: true },
                ],
                taskHref(n.projectId ?? p.data.project.id, n.taskId ?? p.data.task.id),
            );
        }
        case 'TASK_COMPLETED': {
            const p = taskEvent.safeParse(payload);
            if (!p.success) break;
            return sentence(
                [
                    { text: `${actorName(p.data.actor)} completed ` },
                    { text: p.data.task.title, strong: true },
                ],
                taskHref(n.projectId ?? p.data.project.id, n.taskId ?? p.data.task.id),
            );
        }
        case 'TASK_UPDATED': {
            const p = updated.safeParse(payload);
            if (!p.success) break;
            const fields = [
                ...new Set((p.data.changedFields ?? []).map((f) => FIELD_LABELS[f] ?? f)),
            ];
            return sentence(
                fields.length
                    ? [
                          { text: `${actorName(p.data.actor)} updated the ${listOf(fields)} of ` },
                          { text: p.data.task.title, strong: true },
                      ]
                    : [
                          { text: `${actorName(p.data.actor)} updated ` },
                          { text: p.data.task.title, strong: true },
                      ],
                taskHref(n.projectId ?? p.data.project.id, n.taskId ?? p.data.task.id),
            );
        }
        case 'COMMENT_ADDED': {
            const p = commented.safeParse(payload);
            if (!p.success) break;
            const projectId = n.projectId ?? p.data.project.id;
            const where = p.data.task
                ? [{ text: ' on ' }, { text: p.data.task.title, strong: true }]
                : [{ text: ' in ' }, { text: p.data.project.name, strong: true }];
            return sentence(
                [
                    { text: `${actorName(p.data.actor)} commented` },
                    ...where,
                    { text: `: ${quoted(p.data.commentPreview)}` },
                ],
                p.data.task
                    ? taskHref(projectId, n.taskId ?? p.data.task.id)
                    : discussionHref(projectId),
            );
        }
        case 'COMMENT_REPLY': {
            const p = replied.safeParse(payload);
            if (!p.success) break;
            const projectId = n.projectId ?? p.data.project.id;
            return sentence(
                [
                    { text: `${actorName(p.data.actor)} replied to your comment` },
                    ...(p.data.task
                        ? [{ text: ' on ' }, { text: p.data.task.title, strong: true }]
                        : []),
                    { text: `: ${quoted(p.data.commentPreview)}` },
                ],
                p.data.task
                    ? taskHref(projectId, n.taskId ?? p.data.task.id)
                    : discussionHref(projectId),
            );
        }
        case 'PROJECT_INVITATION': {
            const p = base.safeParse(payload);
            if (!p.success) break;
            return sentence(
                [
                    { text: `${actorName(p.data.actor)} invited you to ` },
                    { text: p.data.project.name, strong: true },
                ],
                '/dashboard/invitations',
            );
        }
    }

    return fallback(n);
}

/** A type this client doesn't know, or a payload that doesn't fit its type. */
function fallback(n: Notification): NotificationSentence {
    const p = base.safeParse(n.payload);
    const projectId = n.projectId ?? (p.success ? p.data.project.id : null);
    const href = projectId ? `/dashboard/projects/${projectId}` : '/dashboard/notifications';
    if (!p.success) return sentence([{ text: 'Something changed' }], href);
    return sentence(
        [
            { text: `${actorName(p.data.actor)} updated something in ` },
            { text: p.data.project.name, strong: true },
        ],
        href,
    );
}

/** The actor's name for the avatar, when the payload has one. */
export function notificationActor(n: Notification): string | null {
    const p = z.object({ actor }).safeParse(n.payload);
    return p.success ? p.data.actor.name : null;
}
