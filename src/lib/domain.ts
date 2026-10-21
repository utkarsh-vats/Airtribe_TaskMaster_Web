// Domain enums as string-literal unions. Replaced by the generated API types in step 3.

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type ProjectRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export const TASK_STATUSES = [
    'OPEN',
    'IN_PROGRESS',
    'COMPLETED',
] as const satisfies readonly TaskStatus[];

/** Display order: most urgent first (DESIGN.md §5). */
export const TASK_PRIORITIES = [
    'URGENT',
    'HIGH',
    'MEDIUM',
    'LOW',
] as const satisfies readonly TaskPriority[];

export const PROJECT_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const satisfies readonly ProjectRole[];

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
