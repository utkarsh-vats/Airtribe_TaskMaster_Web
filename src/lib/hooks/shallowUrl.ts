/**
 * Change the URL without a server round trip. Next integrates the History API with its router,
 * so usePathname / useSearchParams update at once — right for client-side state kept in the
 * URL (filters, sort, page, the open task). `router.push` would refetch the route's server
 * components first, and controls bound to the URL would lag behind the click.
 * An object so tests can spy on it.
 */
export const shallowUrl = {
    push(url: string) {
        window.history.pushState(null, '', url);
    },
    replace(url: string) {
        window.history.replaceState(null, '', url);
    },
};
