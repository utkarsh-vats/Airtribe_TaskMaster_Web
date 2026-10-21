import { z } from 'zod';

/*
 * Client-side checks for the auth forms, mirroring the API's request schemas (POST
 * /auth/login, /auth/register) so most problems are caught before a round trip. The API stays
 * the authority: its 422 details are mapped back onto these fields.
 */

const email = z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .max(254, 'Email must be 254 characters or fewer.')
    .pipe(z.email('Enter a valid email address.'));

export const loginSchema = z.object({
    email,
    // Only presence here: an old account's password may predate today's length rules.
    password: z.string().min(1, 'Enter your password.'),
});

export const registerSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, 'Enter your name.')
        .max(100, 'Name must be 100 characters or fewer.'),
    email,
    password: z
        .string()
        .min(8, 'Password is too short.')
        .max(128, 'Password must be 128 characters or fewer.'),
});

export type LoginInput = z.input<typeof loginSchema>;
export type LoginValues = z.output<typeof loginSchema>;
export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterValues = z.output<typeof registerSchema>;
