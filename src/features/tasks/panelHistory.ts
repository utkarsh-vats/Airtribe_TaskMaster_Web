import { shallowUrl } from '@/lib/hooks/shallowUrl';

/*
 * History for the task panel (?task=). Opening pushes an entry so the browser's Back button
 * closes the panel. Closing it from inside (X, Esc, overlay) then goes back instead of pushing
 * again — otherwise Back would reopen it. A panel reached by a link or reload has no entry of
 * ours to go back to, so closing replaces the URL instead.
 */

let opened: { taskId: string; opener: HTMLElement | null } | null = null;

/** Open the panel: push the URL and remember who opened it (focus goes back there). */
export function openTaskPanel(url: string, taskId: string) {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    opened = { taskId, opener: active instanceof HTMLElement ? active : null };
    shallowUrl.push(url);
}

/**
 * Close the panel from inside it. `urlWithoutTask` is used when there's no entry to go back to.
 * `landingUrl` (e.g. the previous page after deleting the last row) replaces wherever the
 * close lands — after the Back step, so no stale entry is left behind.
 */
export function closeTaskPanel(taskId: string, urlWithoutTask: string, landingUrl?: string) {
    const pushedHere = opened?.taskId === taskId;
    if (pushedHere) {
        if (landingUrl) {
            window.addEventListener('popstate', () => shallowUrl.replace(landingUrl), {
                once: true,
            });
        }
        window.history.back();
    } else {
        shallowUrl.replace(landingUrl ?? urlWithoutTask);
    }
}

/** The element that opened this task's panel in this tab, if it's still on the page. */
export function taskPanelOpener(taskId: string): HTMLElement | null {
    const opener = opened?.taskId === taskId ? opened.opener : null;
    return opener?.isConnected ? opener : null;
}

/** Tests only. */
export function resetTaskPanelHistoryForTests() {
    opened = null;
}
