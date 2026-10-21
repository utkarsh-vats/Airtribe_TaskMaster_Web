import 'server-only';

import { z } from 'zod';

/** Server-only environment. Importing this from a client component fails the build. */
const serverEnvSchema = z.object({
    API_URL: z.url(),
    API_SPEC_URL: z.url().optional(),
});

export const serverEnv = serverEnvSchema.parse({
    API_URL: process.env.API_URL,
    API_SPEC_URL: process.env.API_SPEC_URL,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
