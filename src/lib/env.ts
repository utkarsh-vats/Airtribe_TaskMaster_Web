import { z } from 'zod';

/**
 * Public (browser-safe) environment. Next inlines NEXT_PUBLIC_* at build time, so each
 * variable must be referenced literally — no destructuring or dynamic keys.
 */
const publicEnvSchema = z.object({
    NEXT_PUBLIC_API_URL: z.url(),
});

export const env = publicEnvSchema.parse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
