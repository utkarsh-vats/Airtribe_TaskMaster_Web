'use client';

import { useSyncExternalStore } from 'react';

/*
 * Whether the wide-screen filter row is open (DESIGN.md §5): collapsed by default, remembered
 * per browser. Storage can be blocked (private mode, site data off), so every access is
 * guarded and the value also lives in memory for this page.
 */

export const FILTER_BAR_OPEN_KEY = 'tm.taskFilters.open';

const listeners = new Set<() => void>();
/** Set once the user toggles in this page; until then the stored value is read. */
let memory: boolean | undefined;

function read(): boolean {
    if (memory !== undefined) return memory;
    try {
        return window.localStorage.getItem(FILTER_BAR_OPEN_KEY) === 'true';
    } catch {
        return false;
    }
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function setFilterBarOpen(open: boolean) {
    memory = open;
    try {
        window.localStorage.setItem(FILTER_BAR_OPEN_KEY, String(open));
    } catch {
        // Blocked storage: remembered for this page only.
    }
    for (const listener of listeners) listener();
}

/**
 * [open, setOpen, animated]. `animated` is false until the user toggles, so a row remembered
 * as open appears at once on load instead of sliding open after hydration.
 */
export function useFilterBarOpen() {
    // The server can't see storage: it renders collapsed, the client corrects after hydration.
    const open = useSyncExternalStore(subscribe, read, () => false);
    return [open, setFilterBarOpen, memory !== undefined] as const;
}

/** Tests only: forget the in-memory value, as a reload would. */
export function resetFilterBarOpenForTests() {
    memory = undefined;
}
