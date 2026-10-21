// Domain enums come from the API (src/lib/api/types.ts); this file adds display order and labels.

import type { ProjectRole, TaskPriority, TaskStatus } from './api/types';

export type { ProjectRole, TaskPriority, TaskStatus };

/**
 * A readonly list that must name every member of `U` — a type error when the API adds an enum
 * value the UI doesn't order yet. Usage: `allOf<TaskStatus>()(['OPEN', …])`.
 */
const allOf =
    <U extends string>() =>
    <const L extends readonly U[]>(
        list: L & ([Exclude<U, L[number]>] extends [never] ? unknown : never),
    ): L =>
        list;

export const TASK_STATUSES = allOf<TaskStatus>()(['OPEN', 'IN_PROGRESS', 'COMPLETED']);

/** Display order: most urgent first (DESIGN.md §5). */
export const TASK_PRIORITIES = allOf<TaskPriority>()(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);

export const PROJECT_ROLES = allOf<ProjectRole>()(['OWNER', 'ADMIN', 'MEMBER']);

export const STATUS_LABELS: Record<TaskStatus, string> = {
    OPEN: 'To do',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Done',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
    URGENT: 'Urgent',
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
};

export const ROLE_LABELS: Record<ProjectRole, string> = {
    OWNER: 'Owner',
    ADMIN: 'Admin',
    MEMBER: 'Member',
};
