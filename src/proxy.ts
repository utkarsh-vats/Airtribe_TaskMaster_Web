import { NextResponse, type NextRequest } from 'next/server';

import { REFRESH_COOKIE } from '@/lib/auth/constants';
import { loginUrl } from '@/lib/auth/navigation';
import { safeNext } from '@/lib/auth/safeNext';

/**
 * Route guard (DESIGN.md §3). Checks only that the refresh cookie is present — the API is the
 * authority; a stale cookie is caught by SessionProvider's restore, whose 401 clears it.
 *   /dashboard/** without the cookie      → /login?next=<path + query>
 *   /login, /register with the cookie     → safeNext(?next) (default /dashboard)
 * Never runs on `/`, /api, _next or static files (see `config.matcher`).
 */
export function proxy(request: NextRequest) {
    const { pathname, search, searchParams } = request.nextUrl;
    const signedIn = Boolean(request.cookies.get(REFRESH_COOKIE)?.value);

    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
        if (signedIn) return NextResponse.next();
        return NextResponse.redirect(new URL(loginUrl(pathname + search), request.url), 307);
    }

    if (signedIn) {
        return NextResponse.redirect(new URL(safeNext(searchParams.get('next')), request.url), 307);
    }
    return NextResponse.next();
}

export const config = {
    matcher: ['/dashboard/:path*', '/login', '/register'],
};
