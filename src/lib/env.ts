import { z } from 'zod';

/**
 * Public (browser-safe) environment. Next inlines NEXT_PUBLIC_* at build time, so each
 * variable must be referenced literally — no destructuring or dynamic keys.
 */
const publicEnvSchema = z.object({
    NEXT_PUBLIC_API_URL: z.url(),
    /** Upload size limit in MB — keep equal to the backend's MAX_UPLOAD_MB. Unset or '' → 10. */
    NEXT_PUBLIC_MAX_UPLOAD_MB: z.preprocess(
        (value) => (value === '' ? undefined : value),
        z.coerce.number().positive().default(10),
    ),
});

export const env = publicEnvSchema.parse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_MAX_UPLOAD_MB: process.env.NEXT_PUBLIC_MAX_UPLOAD_MB,
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
