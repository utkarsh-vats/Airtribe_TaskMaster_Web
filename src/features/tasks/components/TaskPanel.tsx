'use client';

import { clsx } from 'clsx';
import { useMemo, useState, type ReactNode } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { PriorityMark, StatusTag } from '@/components/ui/Tag';
import { useProject } from '@/features/projects/api';
import { isApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/api/messages';
import { fullDateTime, relativeTime } from '@/lib/format/dates';
import { useUrlWith } from '@/lib/hooks/useUrlWith';

import { isFullTask, useTask, type TaskView } from '../api';
import { formatDue } from '../format';
import { closeTaskPanel, taskPanelOpener } from '../panelHistory';

type TaskPanelProps = {
    projectId: string;
    /** From ?task; null = closed. */
    taskId: string | null;
};

/**
 * Task detail sheet (DESIGN.md §6 "Task panel"), opened by ?task=<id>. Read-only for now —
 * step 7b makes the fields editable. Takes the project id explicitly so My tasks can reuse it.
 */
export function TaskPanel({ projectId, taskId }: TaskPanelProps) {
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

    return (
        <Sheet
            open={taskId !== null}
            onOpenChange={(open) => {
                if (!open && taskId) closeTaskPanel(taskId, urlWith({ task: null }));
            }}
            title={breadcrumb}
            returnFocusTo={returnFocus}
        >
            {taskId && <TaskDetail projectId={projectId} taskId={taskId} />}
        </Sheet>
    );
}

function TaskDetail({ projectId, taskId }: { projectId: string; taskId: string }) {
    const task = useTask(projectId, taskId);
    const urlWith = useUrlWith();

    if (task.isError) {
        const status = isApiError(task.error) ? task.error.status : 0;
        if (status === 404 || status === 422) {
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
        return (
            <ErrorState
                title="Couldn't load this task"
                message={errorMessage(task.error)}
                retrying={task.isRefetching}
                onRetry={() => void task.refetch()}
            />
        );
    }

    if (!task.data) return <TaskDetailSkeleton />;

    return <TaskBody task={task.data} />;
}

function TaskBody({ task }: { task: TaskView }) {
    const due = formatDue(task.dueDate, task.status);
    const full = isFullTask(task);

    return (
        <article aria-busy={!full || undefined} className="flex flex-col gap-4">
            <h3 className="m-0 font-heading text-[26px] leading-[1.15] break-words">
                {task.title}
            </h3>

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

            <PlaceholderSection
                title="Attachments"
                count={full ? task.attachmentCount : undefined}
            />
            <PlaceholderSection title="Comments" count={full ? task.commentCount : undefined} />

            <footer className="text-muted flex flex-wrap gap-x-3 gap-y-1 border-t-rule border-divider pt-3 text-[12px]">
                <span>
                    Created by {task.createdBy.name} · {relativeTime(task.createdAt)}
                </span>
                {task.completedAt && <span>Completed {relativeTime(task.completedAt)}</span>}
            </footer>
        </article>
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

/** Attachments / Comments until steps 9a and 9c fill them in. */
function PlaceholderSection({ title, count }: { title: string; count: number | undefined }) {
    return (
        <section className="flex flex-col gap-1 border-t-rule border-divider pt-3">
            <h5 className="m-0">
                {title}
                {count !== undefined && (
                    <>
                        {/* Its own text node: a space inside the span is dropped from the name. */}{' '}
                        <span className="text-muted font-normal">({count})</span>
                    </>
                )}
            </h5>
            <p className="text-muted m-0 text-sm">Coming soon</p>
        </section>
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
