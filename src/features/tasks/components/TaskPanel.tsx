'use client';

import { clsx } from 'clsx';
import { Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { PriorityMark, StatusTag } from '@/components/ui/Tag';
import { Tooltip } from '@/components/ui/Tooltip';
import { AttachmentList } from '@/features/attachments/components/AttachmentList';
import { CommentThread } from '@/features/comments/components/CommentThread';
import { useProject } from '@/features/projects/api';
import { bindPermissions } from '@/features/projects/permissions';
import { isNotFound } from '@/lib/api/errors';
import { errorMessage } from '@/lib/api/messages';
import { useSession } from '@/lib/auth/SessionProvider';
import { fullDateTime, relativeTime } from '@/lib/format/dates';
import { useUrlWith } from '@/lib/hooks/useUrlWith';
import { queryView } from '@/lib/query/view';

import {
    isFullTask,
    TASK_ALREADY_DELETED_MESSAGE,
    useDeleteTask,
    useTask,
    type TaskView,
} from '../api';
import { formatDue } from '../format';
import { closeTaskPanel, taskPanelOpener } from '../panelHistory';
import {
    AssigneeField,
    DescriptionField,
    DueField,
    PriorityField,
    StatusField,
    TitleField,
} from './TaskFields';

type TaskPanelProps = {
    projectId: string;
    /** From ?task; null = closed. */
    taskId: string | null;
    /** Where to land after deleting the task (e.g. the previous page); default: just close. */
    afterDeleteUrl?: string | undefined;
};

export const TASK_DELETED_MESSAGE = 'Task deleted';

/**
 * Task detail sheet (DESIGN.md §6 "Task panel"), opened by ?task=<id>: fields editable per
 * DESIGN.md §8, delete in the footer. Takes the project id explicitly so My tasks can reuse it.
 */
export function TaskPanel({ projectId, taskId, afterDeleteUrl }: TaskPanelProps) {
    const project = useProject(projectId);
    const urlWith = useUrlWith();
    const breadcrumb = `${project.data?.name ?? 'Project'} / Task`;
    // Focus goes back to the row (or link) that opened the panel. Keep the last task id: by
    // the time Radix restores focus, ?task (and so `taskId`) is already gone.
    const [lastTaskId, setLastTaskId] = useState(taskId);
    if (taskId && taskId !== lastTaskId) setLastTaskId(taskId);
    const returnFocus = useMemo(
        () => ({ current: lastTaskId ? taskPanelOpener(lastTaskId) : null }),
        [lastTaskId],
    );
    // A deleted task closes at once (not when the URL catches up) and its detail is never
    // rendered again — a refetch would only flash "Task not found" while the sheet closes.
    const [deletedId, setDeletedId] = useState<string | null>(null);
    const shownId = taskId !== deletedId ? taskId : null;

    const onDeleted = (id: string, alreadyDeleted: boolean) => {
        setDeletedId(id);
        closeTaskPanel(id, urlWith({ task: null }), afterDeleteUrl);
        if (alreadyDeleted) toast(TASK_ALREADY_DELETED_MESSAGE);
        else toast.success(TASK_DELETED_MESSAGE);
    };

    return (
        <Sheet
            open={shownId !== null}
            onOpenChange={(open) => {
                if (!open && taskId) closeTaskPanel(taskId, urlWith({ task: null }));
            }}
            title={breadcrumb}
            returnFocusTo={returnFocus}
        >
            {shownId && <TaskDetail projectId={projectId} taskId={shownId} onDeleted={onDeleted} />}
        </Sheet>
    );
}

/** The task panel lists this many files, newest first, then "Show N more". */
export const TASK_PANEL_ATTACHMENT_CAP = 3;

type OnDeleted = (taskId: string, alreadyDeleted: boolean) => void;

function TaskDetail({
    projectId,
    taskId,
    onDeleted,
}: {
    projectId: string;
    taskId: string;
    onDeleted: OnDeleted;
}) {
    const task = useTask(projectId, taskId);
    const urlWith = useUrlWith();

    const view = queryView(task);

    // A 404 (or 422) means the task is gone — deleted by someone else, say — so it replaces
    // the panel even when it comes from a background refetch.
    if (task.isError && isNotFound(task.error)) {
        return (
            <EmptyState
                title="Task not found"
                body="It may have been deleted."
                action={
                    <Button onClick={() => closeTaskPanel(taskId, urlWith({ task: null }))}>
                        Close
                    </Button>
                }
            />
        );
    }
    if (view.status === 'error') {
        return (
            <ErrorState
                title="Couldn't load this task"
                message={errorMessage(view.error)}
                retrying={task.isRefetching}
                onRetry={() => void task.refetch()}
            />
        );
    }
    if (view.status === 'loading') return <TaskDetailSkeleton />;

    return <TaskBody projectId={projectId} task={view.data} onDeleted={onDeleted} />;
}

function TaskBody({
    projectId,
    task,
    onDeleted,
}: {
    projectId: string;
    task: TaskView;
    onDeleted: OnDeleted;
}) {
    const full = isFullTask(task);
    const project = useProject(projectId);
    const { user } = useSession();
    // Permissions from the cached project + the signed-in user (works outside ProjectContext,
    // e.g. on My tasks). Editing waits for the full task.
    const can = project.data && user ? bindPermissions(project.data.myRole, user.id) : null;
    const editable = full && can !== null && can.editTask(task);
    const readOnlyHint = full && can !== null && !editable;

    return (
        <article aria-busy={!full || undefined} className="flex flex-col gap-4">
            {editable ? (
                <TitleField projectId={projectId} task={task} />
            ) : (
                <h3 className="m-0 font-heading text-[26px] leading-[1.15] break-words">
                    {task.title}
                </h3>
            )}

            {editable ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <StatusField projectId={projectId} task={task} />
                    <PriorityField projectId={projectId} task={task} />
                    <AssigneeField projectId={projectId} task={task} />
                    <DueField projectId={projectId} task={task} />
                </div>
            ) : readOnlyHint ? (
                <Tooltip content={READ_ONLY_HINT}>
                    {/* Focusable so keyboard users get the explanation too. */}
                    <div tabIndex={0} aria-label={`Task details. ${READ_ONLY_HINT}`}>
                        <ReadOnlyDetails task={task} />
                    </div>
                </Tooltip>
            ) : (
                <ReadOnlyDetails task={task} />
            )}

            {editable ? (
                <DescriptionField projectId={projectId} task={task} />
            ) : (
                <section aria-labelledby="task-description" className="flex flex-col gap-1">
                    <h4
                        id="task-description"
                        className="text-muted m-0 text-[12px] font-normal tracking-normal"
                    >
                        Description
                    </h4>
                    {task.description ? (
                        // Plain text: line breaks kept, never rendered as HTML.
                        <p className="m-0 text-sm break-words whitespace-pre-wrap">
                            {task.description}
                        </p>
                    ) : (
                        <p className="text-muted m-0 text-sm">No description</p>
                    )}
                </section>
            )}

            <AttachmentList
                projectId={projectId}
                taskId={task.id}
                count={full ? task.attachmentCount : null}
                sectionKey="task-attachments"
                cap={TASK_PANEL_ATTACHMENT_CAP}
                className="border-t-rule border-divider pt-3"
            />
            <CommentThread
                projectId={projectId}
                taskId={task.id}
                count={full ? task.commentCount : null}
                className="border-t-rule border-divider pt-3"
            />

            <footer className="flex flex-col gap-1 border-t-rule border-divider pt-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="text-muted flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                        <span>
                            Created by {task.createdBy.name} · {relativeTime(task.createdAt)}
                        </span>
                        {task.completedAt && (
                            <span>Completed {relativeTime(task.completedAt)}</span>
                        )}
                    </div>
                    {can && (
                        <DeleteTask
                            projectId={projectId}
                            task={task}
                            allowed={can.deleteTask(task)}
                            onDeleted={onDeleted}
                        />
                    )}
                </div>
                {can && !can.deleteTask(task) && (
                    <p className="text-muted m-0 text-right text-[12px]">{DELETE_HINT}</p>
                )}
            </footer>
        </article>
    );
}

export const READ_ONLY_HINT = 'Only the creator, the assignee or an admin can edit this task.';
export const DELETE_HINT = 'Members can delete only tasks they created.';

/** Ghost danger "Delete task" + confirm. Not optimistic: the dialog waits for the server. */
function DeleteTask({
    projectId,
    task,
    allowed,
    onDeleted,
}: {
    projectId: string;
    task: TaskView;
    allowed: boolean;
    onDeleted: OnDeleted;
}) {
    const remove = useDeleteTask(projectId, task.id);
    const button = (
        <Button variant="ghost" size="sm" danger disabled={!allowed}>
            <Trash2 size={14} aria-hidden />
            Delete task
        </Button>
    );

    if (!allowed) {
        // A disabled button gets no pointer/focus events: the span carries the tooltip.
        return (
            <Tooltip content={DELETE_HINT}>
                <span tabIndex={0} className="inline-flex">
                    {button}
                </span>
            </Tooltip>
        );
    }

    return (
        <ConfirmDialog
            trigger={button}
            title="Delete this task?"
            description={`“${task.title}” and its comments and attachments will be permanently deleted. This can't be undone.`}
            confirmLabel="Delete task"
            destructive
            onConfirm={async () => {
                // Rejects on failure (already toasted), which keeps the dialog open to retry.
                const { alreadyDeleted } = await remove.mutateAsync();
                onDeleted(task.id, alreadyDeleted);
            }}
        />
    );
}

function ReadOnlyDetails({ task }: { task: TaskView }) {
    const due = formatDue(task.dueDate, task.status);
    return (
        <dl className="m-0 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Detail label="Status">
                <StatusTag status={task.status} />
            </Detail>
            <Detail label="Priority">
                <PriorityMark priority={task.priority} />
            </Detail>
            <Detail label="Assignee">
                {task.assignee ? (
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                        <Avatar name={task.assignee.name} size="sm" />
                        <span className="truncate">{task.assignee.name}</span>
                    </span>
                ) : (
                    <span className="text-muted text-sm">Unassigned</span>
                )}
            </Detail>
            <Detail label="Due">
                <span
                    className={clsx('text-sm', due.overdue && 'font-bold text-danger')}
                    title={task.dueDate ? fullDateTime(task.dueDate) : undefined}
                >
                    {due.label}
                </span>
            </Detail>
        </dl>
    );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-[12px] opacity-70">{label}</dt>
            <dd className="m-0 flex min-h-[24px] items-center">{children}</dd>
        </div>
    );
}

function TaskDetailSkeleton() {
    return (
        <div aria-busy="true" className="flex flex-col gap-4">
            <span className="sr-only">Loading task…</span>
            <Skeleton width="80%" height={28} />
            <div className="grid grid-cols-2 gap-3">
                <Skeleton height={36} />
                <Skeleton height={36} />
                <Skeleton height={36} />
                <Skeleton height={36} />
            </div>
            <Skeleton />
            <Skeleton width="70%" />
        </div>
    );
}
