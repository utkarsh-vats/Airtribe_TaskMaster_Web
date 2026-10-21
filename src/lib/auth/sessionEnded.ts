import { getQueryClient } from '@/lib/query/client';

import { clearSession } from './actions';
import { authNavigation, currentPath } from './navigation';

let redirecting = false;

/**
 * The session can't be recovered (a 401 that isn't TOKEN_EXPIRED, or the refresh failed):
 * forget it, drop every cached query (they belong to that user), and go to
 * /login?next=<current path>. Several requests failing together redirect once.
 */
export function sessionEnded() {
    clearSession();
    getQueryClient().clear();
    if (redirecting) return;
    redirecting = true;
    authNavigation.toLogin(currentPath());
}

/** Tests only: allow another redirect. */
export function resetSessionEndedForTests() {
    redirecting = false;
}
