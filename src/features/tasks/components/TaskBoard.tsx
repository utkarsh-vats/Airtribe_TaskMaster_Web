'use client';

import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    pointerWithin,
    rectIntersection,
    TouchSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { clsx } from 'clsx';
import { useId, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { PriorityMark } from '@/components/ui/Tag';
import { useProjectContext } from '@/features/projects/ProjectContext';
import { errorMessage } from '@/lib/api/messages';
import type { TaskListItem, TaskStatus } from '@/lib/api/types';
import { STATUS_LABELS, TASK_STATUSES } from '@/lib/domain';
import { isPlainClick } from '@/lib/react/plainClick';

import { BOARD_COLUMN_LIMIT, boardColumnKey, useBoardColumn, useUpdateTask } from '../api';
import {
    BOARD_KEYBOARD_CODES,
    boardInstructions,
    cardData,
    columnKeyboardCoordinates,
    createBoardAnnouncements,
    decideDrop,
    type CardDragData,
} from '../boardDnd';
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

/** The column under the pointer; with no pointer (keyboard), the column the card overlaps. */
const collisionDetection: CollisionDetection = (args) => {
    const underPointer = pointerWithin(args);
    return underPointer.length ? underPointer : rectIntersection(args);
};

/**
 * The board (DESIGN.md §4, §6): one column per status, each its own query of up to 100 tasks.
 * From 820px three equal columns split by 2px rules; below that the columns scroll sideways
 * with snap points, each ~85% of the viewport wide. Cards the user may edit drag between
 * columns (mouse, touch after a press, or keyboard), which changes their status optimistically.
 */
export function TaskBoard(props: TaskBoardProps) {
    const { projectId, filters } = props;
    const { can } = useProjectContext();
    const update = useUpdateTask(projectId);
    const [dragging, setDragging] = useState<CardDragData | null>(null);
    const [announcements] = useState(createBoardAnnouncements);
    // Set while a drag is on (and for the click that may follow it), so it doesn't open a card.
    const suppressClick = useRef(false);

    const sensors = useSensors(
        // Mouse rather than pointer events, so a touch drag on a phone stays a scroll.
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
        useSensor(KeyboardSensor, {
            keyboardCodes: BOARD_KEYBOARD_CODES,
            coordinateGetter: columnKeyboardCoordinates,
        }),
    );

    const onDragStart = ({ active }: DragStartEvent) => {
        suppressClick.current = true;
        setDragging(cardData(active) ?? null);
    };
    const finishDrag = () => {
        setDragging(null);
        // A click can fire right after the pointer is released; let it pass first.
        setTimeout(() => {
            suppressClick.current = false;
        }, 0);
    };
    const onDragEnd = ({ active, over }: DragEndEvent) => {
        finishDrag();
        const card = cardData(active);
        if (!card) return;
        const to = decideDrop({
            from: card.from,
            over: over?.id,
            canEdit: can.editTask(card.task),
        });
        if (!to) return;
        // Errors roll back and toast inside the mutation (DESIGN.md §7).
        update.mutate({
            taskId: card.task.id,
            patch: { status: to },
            columns: {
                from: boardColumnKey(projectId, card.from, filters),
                to: boardColumnKey(projectId, to, filters),
            },
        });
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            accessibility={{
                announcements,
                screenReaderInstructions: boardInstructions,
            }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={finishDrag}
        >
            <div
                data-testid="task-board"
                // `relative`: the scroll box also clips absolutely positioned bits (sr-only text)
                // in off-screen columns, which would otherwise widen the page.
                className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:gap-0 md:overflow-visible md:pb-0"
            >
                {TASK_STATUSES.map((status, index) => (
                    <BoardColumn
                        key={status}
                        status={status}
                        canDrag={can.editTask}
                        isClickSuppressed={() => suppressClick.current}
                        className={clsx(
                            index > 0 && 'md:border-l-rule md:border-divider md:pl-4',
                            index < TASK_STATUSES.length - 1 && 'md:pr-4',
                        )}
                        {...props}
                    />
                ))}
            </div>
            {/* No drop animation: the card is already in its new column when this goes. */}
            <DragOverlay dropAnimation={null}>
                {dragging && (
                    <div aria-hidden className="card cursor-grabbing shadow-lg">
                        <CardContent task={dragging.task} />
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
}

type ColumnProps = TaskBoardProps & {
    status: TaskStatus;
    canDrag: (task: TaskListItem) => boolean;
    isClickSuppressed: () => boolean;
    className?: string;
};

function BoardColumn({
    projectId,
    status,
    filters,
    taskHref,
    onOpen,
    listHref,
    onNavigate,
    canDrag,
    isClickSuppressed,
    className,
}: ColumnProps) {
    const column = useBoardColumn(projectId, status, filters);
    const { setNodeRef, isOver } = useDroppable({ id: status });
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
                            <TaskCard
                                task={task}
                                status={status}
                                href={taskHref(task.id)}
                                draggable={canDrag(task)}
                                onOpen={(taskId) => {
                                    if (!isClickSuppressed()) onOpen(taskId);
                                }}
                            />
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
            ref={setNodeRef}
            aria-labelledby={headingId}
            data-over={isOver || undefined}
            className={clsx(
                // Below 820px the board scrolls sideways; from there the grid sizes the columns.
                'flex min-h-[200px] w-[85vw] flex-none snap-start flex-col gap-2 md:w-auto md:min-w-0',
                isOver && 'bg-accent-100 outline-2 -outline-offset-2 outline-accent outline-solid',
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
    status,
    href,
    draggable,
    onOpen,
}: {
    task: TaskListItem;
    /** The column it's in. */
    status: TaskStatus;
    href: string;
    draggable: boolean;
    onOpen: (taskId: string) => void;
}) {
    const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
        id: task.id,
        data: { task, from: status } satisfies CardDragData,
        disabled: !draggable,
    });
    // Keep the link's own role (Enter opens it); add the drag description and keys only when
    // the user can actually move the card.
    const dragProps = draggable
        ? {
              ...listeners,
              'aria-roledescription': attributes['aria-roledescription'],
              'aria-describedby': attributes['aria-describedby'],
          }
        : {};

    return (
        // A link, so Enter opens it and a modified click opens the panel's URL in a new tab.
        <a
            ref={setNodeRef}
            href={href}
            {...dragProps}
            onClick={(event) => {
                if (!isPlainClick(event)) return;
                event.preventDefault();
                onOpen(task.id);
            }}
            className={clsx(
                'card elev-sm text-text no-underline transition-shadow hover:text-text hover:shadow-md',
                draggable && 'cursor-grab touch-manipulation',
                isDragging && 'opacity-40',
            )}
        >
            <CardContent task={task} />
        </a>
    );
}

/** A card's contents, shared by the card and its drag copy. */
function CardContent({ task }: { task: TaskListItem }) {
    const due = formatDue(task.dueDate, task.status);
    return (
        <>
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
        </>
    );
}
