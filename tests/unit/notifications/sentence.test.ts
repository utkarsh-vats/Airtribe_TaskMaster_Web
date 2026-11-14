import { describe, expect, it } from 'vitest';

import { notificationActor, notificationSentence } from '@/features/notifications/sentence';
import type { Notification } from '@/lib/api/types';

const ACTOR = { id: 'u2', name: 'Priya Raman' };
const PROJECT = { id: 'p1', name: 'Website relaunch' };
const TASK = { id: 't1', title: 'Finalise hero copy' };

/** A notification as the API stores it: payload snapshot (backend notifications.listener.ts). */
const n = (
    type: Notification['type'] | 'SOMETHING_NEW',
    payload: Record<string, unknown>,
    ids: { projectId?: string | null; taskId?: string | null } = {},
): Notification => ({
    id: 'n1',
    type: type as Notification['type'],
    projectId: ids.projectId === undefined ? 'p1' : ids.projectId,
    taskId: ids.taskId === undefined ? null : ids.taskId,
    payload,
    readAt: null,
    createdAt: '2026-11-14T09:00:00.000Z',
});

const TASK_HREF = '/dashboard/projects/p1/tasks?task=t1';

describe('notificationSentence', () => {
    it.each([
        [
            'TASK_ASSIGNED',
            { actor: ACTOR, project: PROJECT, task: TASK },
            'Priya Raman assigned you Finalise hero copy',
        ],
        [
            'TASK_COMPLETED',
            { actor: ACTOR, project: PROJECT, task: TASK },
            'Priya Raman completed Finalise hero copy',
        ],
        [
            'TASK_UPDATED',
            { actor: ACTOR, project: PROJECT, task: TASK },
            'Priya Raman updated Finalise hero copy',
        ],
        [
            'COMMENT_ADDED',
            {
                actor: ACTOR,
                project: PROJECT,
                task: TASK,
                commentId: 'c1',
                commentPreview: 'Looks good to me',
            },
            'Priya Raman commented on Finalise hero copy: “Looks good to me”',
        ],
    ] as const)('%s → "%s", to the task', (type, payload, text) => {
        const s = notificationSentence(n(type, payload, { taskId: 't1' }));
        expect(s.text).toBe(text);
        expect(s.href).toBe(TASK_HREF);
        // The task's name is the bold part.
        expect(s.parts.filter((p) => p.strong).map((p) => p.text)).toEqual([TASK.title]);
    });

    it('TASK_UPDATED says what changed when the payload does', () => {
        const one = notificationSentence(
            n('TASK_UPDATED', {
                actor: ACTOR,
                project: PROJECT,
                task: TASK,
                changedFields: ['status'],
            }),
        );
        expect(one.text).toBe('Priya Raman updated the status of Finalise hero copy');

        const many = notificationSentence(
            n('TASK_UPDATED', {
                actor: ACTOR,
                project: PROJECT,
                task: TASK,
                changedFields: ['priority', 'dueDate', 'assigneeId'],
            }),
        );
        expect(many.text).toBe(
            'Priya Raman updated the priority, due date and assignee of Finalise hero copy',
        );
    });

    it('COMMENT_REPLY on a task: "replied to your comment on {task}", to the task', () => {
        const s = notificationSentence(
            n(
                'COMMENT_REPLY',
                {
                    actor: ACTOR,
                    project: PROJECT,
                    task: TASK,
                    commentId: 'c2',
                    parentId: 'c1',
                    commentPreview: 'Agreed',
                },
                { taskId: 't1' },
            ),
        );
        expect(s.text).toBe('Priya Raman replied to your comment on Finalise hero copy: “Agreed”');
        expect(s.href).toBe(TASK_HREF);
    });

    it('COMMENT_REPLY on the project: no task, to the Discussion tab', () => {
        const s = notificationSentence(
            n('COMMENT_REPLY', {
                actor: ACTOR,
                project: PROJECT,
                commentId: 'c2',
                parentId: 'c1',
                commentPreview: 'Agreed',
            }),
        );
        expect(s.text).toBe('Priya Raman replied to your comment: “Agreed”');
        expect(s.href).toBe('/dashboard/projects/p1/discussion');
    });

    it('COMMENT_ADDED on the project (no task): "in {project}", to the Discussion tab', () => {
        const s = notificationSentence(
            n('COMMENT_ADDED', {
                actor: ACTOR,
                project: PROJECT,
                commentId: 'c1',
                commentPreview: 'Hello all',
            }),
        );
        expect(s.text).toBe('Priya Raman commented in Website relaunch: “Hello all”');
        expect(s.href).toBe('/dashboard/projects/p1/discussion');
    });

    it('PROJECT_INVITATION: "invited you to {project}", to the inbox', () => {
        const s = notificationSentence(
            n('PROJECT_INVITATION', {
                actor: ACTOR,
                project: PROJECT,
                invitationId: 'i1',
                role: 'MEMBER',
            }),
        );
        expect(s.text).toBe('Priya Raman invited you to Website relaunch');
        expect(s.href).toBe('/dashboard/invitations');
        expect(s.parts.filter((p) => p.strong).map((p) => p.text)).toEqual(['Website relaunch']);
    });

    it('an actor without a name (account gone) is "Someone"', () => {
        const s = notificationSentence(
            n('TASK_COMPLETED', { actor: { id: 'u9', name: null }, project: PROJECT, task: TASK }),
        );
        expect(s.text).toBe('Someone completed Finalise hero copy');
    });

    it('the top-level projectId / taskId win over the payload’s for the link', () => {
        const s = notificationSentence(
            n(
                'TASK_ASSIGNED',
                { actor: ACTOR, project: PROJECT, task: TASK },
                {
                    projectId: 'p7',
                    taskId: 't7',
                },
            ),
        );
        expect(s.href).toBe('/dashboard/projects/p7/tasks?task=t7');
    });

    describe('fallback (never crashes)', () => {
        it('a type this client doesn’t know: "{actor} updated something in {project}"', () => {
            const s = notificationSentence(n('SOMETHING_NEW', { actor: ACTOR, project: PROJECT }));
            expect(s.text).toBe('Priya Raman updated something in Website relaunch');
            expect(s.href).toBe('/dashboard/projects/p1');
        });

        it('a known type with a malformed payload (no task) falls back the same way', () => {
            const s = notificationSentence(n('TASK_ASSIGNED', { actor: ACTOR, project: PROJECT }));
            expect(s.text).toBe('Priya Raman updated something in Website relaunch');
        });

        it('nothing usable at all: "Something changed"', () => {
            const s = notificationSentence(n('TASK_ASSIGNED', { junk: true }, { projectId: null }));
            expect(s.text).toBe('Something changed');
            expect(s.href).toBe('/dashboard/notifications');
        });
    });
});

describe('notificationActor', () => {
    it('the actor’s name, or null', () => {
        expect(notificationActor(n('TASK_ASSIGNED', { actor: ACTOR }))).toBe('Priya Raman');
        expect(notificationActor(n('TASK_ASSIGNED', {}))).toBeNull();
    });
});
