import { z } from 'zod';

/** The invite form (POST /projects/{pid}/invitations), mirroring the API's request schema. */
export const inviteSchema = z.object({
    email: z
        .string()
        .trim()
        .toLowerCase()
        .min(1, 'Enter an email address.')
        .max(254, 'Email must be 254 characters or fewer.')
        .pipe(z.email('Enter a valid email address.')),
    role: z.enum(['ADMIN', 'MEMBER']),
});

export type InviteInput = z.input<typeof inviteSchema>;
export type InviteValues = z.output<typeof inviteSchema>;
