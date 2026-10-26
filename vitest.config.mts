import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    resolve: {
        tsconfigPaths: true,
        alias: {
            'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        // The app's origin (same as `npm run dev`), distinct from the API's :3000, so tests can
        // tell same-origin /api/auth/* calls from API calls.
        environmentOptions: { jsdom: { url: 'http://localhost:3001' } },
        setupFiles: ['./tests/setup.ts'],
        // Room for a few async waits per test: they time out after 1 s locally and 5 s on CI
        // (tests/setup.ts), so a test gets 5 s locally and 20 s on CI.
        testTimeout: process.env.CI ? 20_000 : 5_000,
        include: ['tests/unit/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
        css: false,
        // src/lib/env.ts and env.server.ts validate these on import (same values as .env.example).
        env: {
            NEXT_PUBLIC_API_URL: 'http://localhost:3000',
            API_URL: 'http://localhost:3000',
            // One default zone for the whole suite, locally and in CI (where TZ is unset). A TZ set
            // in the shell wins, to run the suite in another zone (TZ=America/New_York npm test);
            // tests that need a zone override it on top (tests/timeZone.ts) and restore it.
            TZ: process.env.TZ || 'UTC',
        },
    },
});
