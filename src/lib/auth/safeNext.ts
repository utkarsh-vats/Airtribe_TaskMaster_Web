/** Where to go after signing in when there's no usable `next`. */
export const DEFAULT_NEXT = '/dashboard';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** "/dashboard" exactly, or followed by a path, a query or nothing. */
const DASHBOARD = /^\/dashboard(?:$|[/?])/;

/**
 * Validate a post-login `next` (DESIGN.md §3) — an open-redirect guard used by the route guard
 * and the login / register forms. Returns `raw` (query string kept) only when, decoded once,
 * it is a same-origin path under /dashboard; anything else gives "/dashboard".
 */
export function safeNext(raw: string | null | undefined): string {
    if (!raw) return DEFAULT_NEXT;

    let decoded: string;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        return DEFAULT_NEXT; // malformed %-escapes
    }

    for (const candidate of [raw, decoded]) {
        if (
            !DASHBOARD.test(candidate) ||
            candidate.startsWith('//') ||
            candidate.includes('\\') ||
            SCHEME.test(candidate) ||
            CONTROL_CHARS.test(candidate) ||
            /\/\.\.?(?:\/|$|\?)/.test(candidate)
        ) {
            return DEFAULT_NEXT;
        }
    }

    // Belt and braces: let the URL parser have the final word on where this actually points.
    const resolved = new URL(raw, 'http://app.invalid');
    if (resolved.origin !== 'http://app.invalid' || !DASHBOARD.test(resolved.pathname + '?')) {
        return DEFAULT_NEXT;
    }
    return raw;
}
