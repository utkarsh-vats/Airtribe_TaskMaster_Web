import { setupServer } from 'msw/node';

/** Base URL the app's `api` client targets in tests (vitest.config.mts `test.env`). */
export const API_ORIGIN = 'http://localhost:3000';

/** Shared MSW server. No default handlers: each test adds what it needs with `server.use()`. */
export const server = setupServer();
