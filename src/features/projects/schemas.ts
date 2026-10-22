import { z } from 'zod';

/** New / edit project form, mirroring POST /projects (name 1–100, description ≤ 5000). */
export const projectSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Enter a project name.')
        .max(100, 'Name must be 100 characters or fewer.'),
    description: z
        .string()
        .trim()
        .max(5000, 'Description must be 5,000 characters or fewer.')
        .transform((value) => value || undefined),
});

export type ProjectFormInput = z.input<typeof projectSchema>;
export type ProjectFormValues = z.output<typeof projectSchema>;
