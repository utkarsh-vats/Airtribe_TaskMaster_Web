import { clsx } from 'clsx';
import type { ComponentProps } from 'react';

import {
    PRIORITY_LABELS,
    ROLE_LABELS,
    STATUS_LABELS,
    type ProjectRole,
    type TaskPriority,
    type TaskStatus,
} from '@/lib/domain';

export type TagTone = 'neutral' | 'accent' | 'outline';

type TagProps = ComponentProps<'span'> & {
    tone?: TagTone;
    /** 'sm' for dense lists (sidebar rows). */
    size?: 'default' | 'sm';
};

export function Tag({ tone = 'neutral', size = 'default', className, ...props }: TagProps) {
    return (
        <span
            className={clsx('tag', `tag-${tone}`, size === 'sm' && 'tag-sm', className)}
            {...props}
        />
    );
}

const STATUS_TONES: Record<TaskStatus, TagTone> = {
    OPEN: 'neutral',
    IN_PROGRESS: 'accent',
    COMPLETED: 'outline',
};

export function StatusTag({ status, className }: { status: TaskStatus; className?: string }) {
    return (
        <Tag tone={STATUS_TONES[status]} className={className}>
            {STATUS_LABELS[status]}
        </Tag>
    );
}

const PRIORITY_MARKS: Record<TaskPriority, string> = {
    URGENT: 'bg-danger',
    HIGH: 'bg-prio-high',
    MEDIUM: 'bg-prio-medium',
    LOW: 'bg-prio-low',
};

/** 8px square in the priority colour plus its label. Urgent is danger-red and bold. */
export function PriorityMark({
    priority,
    className,
}: {
    priority: TaskPriority;
    className?: string;
}) {
    return (
        <span
            className={clsx(
                'inline-flex items-center gap-[6px] text-sm',
                priority === 'URGENT' && 'font-bold',
                className,
            )}
        >
            <span aria-hidden className={clsx('h-2 w-2 flex-none', PRIORITY_MARKS[priority])} />
            {PRIORITY_LABELS[priority]}
        </span>
    );
}

export function RoleTag({
    role,
    size,
    className,
}: {
    role: ProjectRole;
    size?: 'default' | 'sm';
    className?: string;
}) {
    return (
        <Tag tone={role === 'OWNER' ? 'accent' : 'neutral'} size={size} className={className}>
            {ROLE_LABELS[role]}
        </Tag>
    );
}
