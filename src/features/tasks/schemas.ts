import { z } from 'zod';

import { TASK_PRIORITIES } from '@/lib/domain';

import { toDueInstant } from './due';

/**
 * New task form, mirroring POST /projects/{pid}/tasks (title 1–200, description ≤ 5000). No
 * status: the API creates every task OPEN (DESIGN.md §5). Empty optional fields come out as
 * `undefined` so they're left out of the body; `due` (YYYY-MM-DD) becomes end of that day in
 * the user's timezone.
 */
export const newTaskSchema = z.object({
    title: z
        .string()
        .trim()
        .min(1, 'Enter a title.')
        .max(200, 'Title must be 200 characters or fewer.'),
    description: z
        .string()
        .trim()
        .max(5000, 'Description must be 5,000 characters or fewer.')
        .transform((value) => value || undefined),
    priority: z.enum(TASK_PRIORITIES),
    assignee: z.string().transform((value) => value || undefined),
    due: z.string().transform((value) => (value ? toDueInstant(value) : undefined)),
});

export type NewTaskFormInput = z.input<typeof newTaskSchema>;
export type NewTaskFormValues = z.output<typeof newTaskSchema>;
