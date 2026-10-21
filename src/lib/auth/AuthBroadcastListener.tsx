'use client';

import { useEffect } from 'react';

import { endLocalSession } from './actions';
import { onAuthBroadcast } from './broadcast';
import { authNavigation } from './navigation';
import { safeNext } from './safeNext';

const isAuthPage = (path: string) => path === '/login' || path === '/register';

/**
 * Reacts to sign-in / sign-out in other tabs (src/lib/auth/broadcast.ts). Mounted once in the
 * root providers so every page listens.
 *   'signed-out' → a dashboard tab drops its session and goes to /login
 *   'signed-in'  → a tab on /login or /register continues to its `next` (or /dashboard)
 */
export function AuthBroadcastListener() {
    useEffect(
        () =>
            onAuthBroadcast((type) => {
                const { pathname, search } = window.location;
                if (type === 'signed-out') {
                    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
                        endLocalSession();
                    }
                    return;
                }
                if (isAuthPage(pathname)) {
                    authNavigation.assign(safeNext(new URLSearchParams(search).get('next')));
                }
            }),
        [],
    );
    return null;
}
