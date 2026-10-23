import type { MouseEvent } from 'react';

/**
 * A plain left click, with no modifier key: the page handles it in place. Anything else (new
 * tab, new window, download) is left to the link's href.
 */
export const isPlainClick = (event: MouseEvent) =>
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
