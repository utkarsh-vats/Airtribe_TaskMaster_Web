import { z } from 'zod';

import type { User } from '@/lib/api/types';

/**
 * Profile form, mirroring PATCH /users/me (backend users.schemas.ts): name trimmed 1–100, bio
 * ≤ 500, avatar URL an http(s) URL ≤ 2048 — both optional, and empty means none (null).
 * Email isn't in that body: it can't be changed here.
 */
export const profileSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Enter your name.')
        .max(100, 'Name must be 100 characters or fewer.'),
    bio: z
        .string()
        .trim()
        .max(500, 'Bio must be 500 characters or fewer.')
        .transform((value) => value || null),
    avatarUrl: z
        .string()
        .trim()
        .max(2048, 'Avatar URL must be 2,048 characters or fewer.')
        .pipe(
            z.union([
                z.literal(''),
                z.url({ protocol: /^https?$/, message: 'Enter a full http(s) URL.' }),
            ]),
        )
        .transform((value) => value || null),
});

export type ProfileFormInput = z.input<typeof profileSchema>;
export type ProfileFormValues = z.output<typeof profileSchema>;

/** The saved profile as form values (null → ''). */
export const profileFormValues = (user: User): ProfileFormInput => ({
    name: user.name,
    bio: user.bio ?? '',
    avatarUrl: user.avatarUrl ?? '',
});

/** Only what differs from the saved user: PATCH needs at least one field, and sends no more. */
export function profileChanges(user: User, values: ProfileFormValues): Partial<ProfileFormValues> {
    const changes: Partial<ProfileFormValues> = {};
    if (values.name !== user.name) changes.name = values.name;
    if (values.bio !== user.bio) changes.bio = values.bio;
    if (values.avatarUrl !== user.avatarUrl) changes.avatarUrl = values.avatarUrl;
    return changes;
}

/**
 * Change password, mirroring PATCH /users/me/password (backend users.schemas.ts): current
 * 1–128 (only checked against the stored hash), new 8–128 and different from the current one;
 * plus a confirmation that must match. Passwords aren't trimmed.
 */
export const passwordChangeSchema = z
    .object({
        currentPassword: z
            .string()
            .min(1, 'Enter your current password.')
            .max(128, 'Password must be 128 characters or fewer.'),
        newPassword: z
            .string()
            .min(8, 'Use at least 8 characters.')
            .max(128, 'Password must be 128 characters or fewer.'),
        confirmPassword: z.string().min(1, 'Confirm your new password.'),
    })
    .superRefine(({ currentPassword, newPassword, confirmPassword }, ctx) => {
        if (newPassword && newPassword === currentPassword) {
            ctx.addIssue({
                code: 'custom',
                path: ['newPassword'],
                message: 'Choose a password different from your current one.',
            });
        }
        if (confirmPassword && confirmPassword !== newPassword) {
            ctx.addIssue({
                code: 'custom',
                path: ['confirmPassword'],
                message: "Passwords don't match.",
            });
        }
    });

export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;
