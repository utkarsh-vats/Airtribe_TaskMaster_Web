import 'server-only';

import { z } from 'zod';

/** Server-only environment. Importing this from a client component fails the build. */
const serverEnvSchema = z.object({
    API_URL: z.url(),
    API_SPEC_URL: z.url().optional(),
    /**
     * Lifetime of the tm_refresh cookie. Keep equal to the backend's REFRESH_TOKEN_TTL_DAYS —
     * the API doesn't return the refresh token's TTL.
     */
    REFRESH_COOKIE_MAX_AGE_DAYS: z.coerce.number().int().positive().default(7),
    /**
     * Public origin of this app (e.g. https://tasks.example.com), for the auth handlers' Origin
     * check when a proxy rewrites the Host. Defaults to the request URL's origin.
     */
    APP_ORIGIN: z.url().optional(),
});

export const serverEnv = serverEnvSchema.parse({
    API_URL: process.env.API_URL,
    API_SPEC_URL: process.env.API_SPEC_URL,
    REFRESH_COOKIE_MAX_AGE_DAYS: process.env.REFRESH_COOKIE_MAX_AGE_DAYS,
    APP_ORIGIN: process.env.APP_ORIGIN,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
