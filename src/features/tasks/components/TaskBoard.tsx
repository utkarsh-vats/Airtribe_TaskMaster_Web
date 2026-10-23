'use client';

import { clsx } from 'clsx';
import { useId } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { PriorityMark } from '@/components/ui/Tag';
import { errorMessage } from '@/lib/api/messages';
import type { TaskListItem, TaskStatus } from '@/lib/api/types';
import { STATUS_LABELS, TASK_STATUSES } from '@/lib/domain';
import { isPlainClick } from '@/lib/react/plainClick';

import { BOARD_COLUMN_LIMIT, useBoardColumn } from '../api';
import type { TaskFilters } from '../filters';
import { formatDue } from '../format';

type TaskBoardProps = {
    projectId: string;
    /** The URL's filters and sort; status is ignored (the columns are the statuses). */
    filters: TaskFilters;
    /** URL of a task's panel, for the card's href. */
    taskHref: (taskId: string) => string;
    /** Open a task's panel in place. */
    onOpen: (taskId: string) => void;
    /** URL of the list filtered to one status, for a column that holds more than 100. */
    listHref: (status: TaskStatus) => string;
    /** Go to a URL in place (list state is client-side; no route round trip). */
    onNavigate: (url: string) => void;
};

/**
 * Read-only board (DESIGN.md §4, §6): one column per status, each its own query of up to 100
 * tasks. From 820px three equal columns split by 2px rules; below that the columns scroll
 * sideways with snap points, each ~85% of the viewport wide.
 */
export function TaskBoard(props: TaskBoardProps) {
    return (
        <div
            data-testid="task-board"
            // `relative`: the scroll box also clips absolutely positioned bits (sr-only text) in
            // off-screen columns, which would otherwise widen the page.
            className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:gap-0 md:overflow-visible md:pb-0"
        >
            {TASK_STATUSES.map((status, index) => (
                <BoardColumn
                    key={status}
                    status={status}
                    className={clsx(
                        index > 0 && 'md:border-l-rule md:border-divider md:pl-4',
                        index < TASK_STATUSES.length - 1 && 'md:pr-4',
                    )}
                    {...props}
                />
            ))}
        </div>
    );
}

function BoardColumn({
    projectId,
    status,
    filters,
    taskHref,
    onOpen,
    listHref,
    onNavigate,
    className,
}: TaskBoardProps & { status: TaskStatus; className?: string }) {
    const column = useBoardColumn(projectId, status, filters);
    const headingId = useId();
    const label = STATUS_LABELS[status];
    const total = column.data?.meta.total;
    const dimmed = column.isPlaceholderData;

    let body;
    if (column.isPending) {
        body = (
            <div aria-busy="true" className="flex flex-col gap-2">
                <span className="sr-only">Loading {label} tasks…</span>
                {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="card elev-sm">
                        <Skeleton width={70} height={11} />
                        <Skeleton width="80%" height={15} />
                        <Skeleton width="40%" height={11} />
                    </div>
                ))}
            </div>
        );
    } else if (column.isError) {
        body = (
            <ErrorState
                compact
                title="Couldn't load tasks"
                message={errorMessage(column.error)}
                retrying={column.isRefetching}
                onRetry={() => void column.refetch()}
            />
        );
    } else if (column.data.items.length === 0) {
        body = <p className="text-muted m-0 py-2 text-sm">No tasks</p>;
    } else {
        const { items, meta } = column.data;
        const href = listHref(status);
        body = (
            <>
                <ul
                    aria-labelledby={headingId}
                    aria-busy={dimmed || undefined}
                    className={clsx(
                        'm-0 flex list-none flex-col gap-2 p-0 transition-opacity',
                        dimmed && 'opacity-60',
                    )}
                >
                    {items.map((task) => (
                        <li key={task.id}>
                            <TaskCard task={task} href={taskHref(task.id)} onOpen={onOpen} />
                        </li>
                    ))}
                </ul>
                {meta.total > BOARD_COLUMN_LIMIT && (
                    <p className="text-muted m-0 flex flex-wrap gap-x-2 py-2 text-sm">
                        <span>
                            Showing {items.length} of {meta.total}
                        </span>
                        <a
                            href={href}
                            onClick={(event) => {
                                if (!isPlainClick(event)) return;
                                event.preventDefault();
                                onNavigate(href);
                            }}
                        >
                            See all in the list
                        </a>
                    </p>
                )}
            </>
        );
    }

    return (
        <section
            aria-labelledby={headingId}
            className={clsx(
                // Below 820px the board scrolls sideways; from there the grid sizes the columns.
                'flex w-[85vw] flex-none snap-start flex-col gap-2 md:w-auto md:min-w-0',
                className,
            )}
        >
            <div className="flex items-baseline gap-2 border-b-rule border-divider pb-2">
                <h6 id={headingId} className="m-0">
                    {label}
                </h6>
                <span className="text-muted text-[12px]">{total ?? '–'}</span>
            </div>
            {body}
        </section>
    );
}

function TaskCard({
    task,
    href,
    onOpen,
}: {
    task: TaskListItem;
    href: string;
    onOpen: (taskId: string) => void;
}) {
    const due = formatDue(task.dueDate, task.status);
    return (
        // A link, so Enter opens it and a modified click opens the panel's URL in a new tab.
        <a
            href={href}
            onClick={(event) => {
                if (!isPlainClick(event)) return;
                event.preventDefault();
                onOpen(task.id);
            }}
            className="card elev-sm text-text no-underline transition-shadow hover:text-text hover:shadow-md"
        >
            <PriorityMark priority={task.priority} className="text-xs" />
            <span className="card-title text-[15px] break-words">{task.title}</span>
            <span className="card-meta justify-between">
                <span className={clsx(due.overdue && 'font-bold text-danger')}>{due.label}</span>
                {task.assignee ? (
                    <Avatar name={task.assignee.name} size="sm" />
                ) : (
                    <span className="sr-only">Unassigned</span>
                )}
            </span>
        </a>
    );
}
