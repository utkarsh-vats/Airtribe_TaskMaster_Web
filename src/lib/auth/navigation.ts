/** Where an ended session sends the browser, with `next` so login can return there. */
export function loginUrl(next?: string): string {
    return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

/** The current path + query, for `next`. */
export function currentPath(): string {
    return `${window.location.pathname}${window.location.search}`;
}

/**
 * Full navigation to /login. An object (not a bare function) so tests can spy on it.
 * A full load, rather than a client-side push, also drops any in-memory state left behind.
 */
export const authNavigation = {
    toLogin(next: string) {
        window.location.assign(loginUrl(next));
    },
};
