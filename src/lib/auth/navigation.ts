/** Where an ended session sends the browser, with `next` so login can return there. */
export function loginUrl(next?: string): string {
    return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

/** The current path + query, for `next`. */
export function currentPath(): string {
    return `${window.location.pathname}${window.location.search}`;
}

/** A navigation function: router.replace from a component, or a full page load. */
export type Navigate = (path: string) => void;

/**
 * Full page loads for code outside React. An object (not bare functions) so tests can spy on
 * it. A full load, rather than a client-side push, also drops any in-memory state left behind.
 */
export const authNavigation = {
    assign(path: string) {
        window.location.assign(path);
    },
    toLogin(next?: string) {
        authNavigation.assign(loginUrl(next));
    },
};
