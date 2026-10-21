import 'server-only';

import type { NextResponse } from 'next/server';

import { serverEnv } from '@/lib/env.server';

import { REFRESH_COOKIE } from './hasSession';

export { REFRESH_COOKIE };

const DAY_SECONDS = 24 * 60 * 60;

function cookieAttributes() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    } as const;
}

/** Store the refresh token in the httpOnly cookie (DESIGN.md §3). */
export function setRefreshCookie(response: NextResponse, refreshToken: string) {
    response.cookies.set(REFRESH_COOKIE, refreshToken, {
        ...cookieAttributes(),
        maxAge: serverEnv.REFRESH_COOKIE_MAX_AGE_DAYS * DAY_SECONDS,
    });
}

/** Expire the refresh cookie (same attributes, so the browser matches and drops it). */
export function clearRefreshCookie(response: NextResponse) {
    response.cookies.set(REFRESH_COOKIE, '', {
        ...cookieAttributes(),
        maxAge: 0,
        expires: new Date(0),
    });
}
