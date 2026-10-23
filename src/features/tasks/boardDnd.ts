import type {
    Active,
    Announcements,
    KeyboardCoordinateGetter,
    Over,
    ScreenReaderInstructions,
    UniqueIdentifier,
} from '@dnd-kit/core';

import type { TaskListItem, TaskStatus } from '@/lib/api/types';
import { STATUS_LABELS, TASK_STATUSES } from '@/lib/domain';

/*
 * The board's drag & drop rules (DESIGN.md §2, §7), kept free of React so they can be tested
 * on their own. Columns are droppables whose id is their status; cards are draggables whose id
 * is the task id and whose data says which column they came from. There's no ordering field in
 * the API, so a card can only change column.
 */

export type CardDragData = { task: TaskListItem; from: TaskStatus };

const isStatus = (value: unknown): value is TaskStatus =>
    (TASK_STATUSES as readonly unknown[]).includes(value);

/** The card being dragged, from dnd-kit's `active`. */
export const cardData = (active: Pick<Active, 'data'> | null): CardDragData | undefined =>
    active?.data.current as CardDragData | undefined;

/**
 * What a drop does: the status to move the card to, or null when nothing should happen —
 * dropped outside a column, back on its own column, or on a task the user can't edit.
 */
export function decideDrop({
    from,
    over,
    canEdit,
}: {
    from: TaskStatus;
    over: UniqueIdentifier | null | undefined;
    canEdit: boolean;
}): TaskStatus | null {
    if (!canEdit || !isStatus(over) || over === from) return null;
    return over;
}

/* — screen-reader announcements — */

export const pickedUp = (title: string, from: TaskStatus) =>
    `Picked up ${title}, in ${STATUS_LABELS[from]}.`;
export const overColumn = (status: TaskStatus) => `Over ${STATUS_LABELS[status]}.`;
export const notOverColumn = () => 'Not over a column.';
export const moved = (title: string, to: TaskStatus) => `Moved ${title} to ${STATUS_LABELS[to]}.`;
export const stayed = (title: string, from: TaskStatus) =>
    `${title} stayed in ${STATUS_LABELS[from]}.`;
export const cancelled = (title: string, from: TaskStatus) =>
    `Cancelled, ${title} stayed in ${STATUS_LABELS[from]}.`;

const overStatus = (over: Pick<Over, 'id'> | null) => (isStatus(over?.id) ? over.id : null);

/**
 * dnd-kit's live-region messages, in the board's words. One set per board: it remembers the
 * column last announced, so the starting column isn't announced again straight after
 * "Picked up…" (dnd-kit reports it as the first "over").
 */
export function createBoardAnnouncements(): Announcements {
    let lastOver: TaskStatus | null = null;
    return {
        onDragStart: ({ active }) => {
            const card = cardData(active);
            lastOver = card?.from ?? null;
            return card && pickedUp(card.task.title, card.from);
        },
        onDragOver: ({ active, over }) => {
            if (!cardData(active)) return undefined;
            const status = overStatus(over);
            if (status === lastOver) return undefined;
            lastOver = status;
            return status ? overColumn(status) : notOverColumn();
        },
        onDragEnd: ({ active, over }) => {
            const card = cardData(active);
            if (!card) return undefined;
            const status = overStatus(over);
            return status && status !== card.from
                ? moved(card.task.title, status)
                : stayed(card.task.title, card.from);
        },
        onDragCancel: ({ active }) => {
            const card = cardData(active);
            return card && cancelled(card.task.title, card.from);
        },
    };
}

export const boardInstructions: ScreenReaderInstructions = {
    draggable:
        'To move this task to another column, press Space, use the left and right arrow keys to choose a column, then press Space again to drop it or Escape to cancel. Press Enter to open it.',
};

/** Space picks up and drops; Enter stays free to open the card. */
export const BOARD_KEYBOARD_CODES = {
    start: ['Space'],
    cancel: ['Escape'],
    end: ['Space'],
};

/**
 * Keyboard moves: ← / → put the card at the top of the previous / next column; other keys do
 * nothing. Coordinates are the dragged card's top-left corner.
 */
export const columnKeyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { currentCoordinates, context },
) => {
    const step = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
    if (!step) return undefined;
    event.preventDefault();

    const card = cardData(context.active);
    const current = overStatus(context.over) ?? card?.from;
    if (!current) return currentCoordinates;
    const next = TASK_STATUSES[TASK_STATUSES.indexOf(current) + step];
    const rect = next && context.droppableRects.get(next);
    if (!rect) return currentCoordinates;

    const width = context.collisionRect?.width ?? 0;
    return { x: rect.left + Math.max(0, (rect.width - width) / 2), y: rect.top };
};
