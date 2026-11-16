'use client';

import { useMe } from '../api';

/**
 * Keeps the session's user fresh in every signed-in tab (GET /users/me, refetched on window
 * focus); rendered once inside SessionProvider in the dashboard layout.
 */
export function MeSync() {
    useMe();
    return null;
}
