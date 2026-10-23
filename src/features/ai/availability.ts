/*
 * Whether AI drafting is switched off on the server (503 AI_DISABLED), remembered in memory
 * for this browser session only — a reload checks again (DESIGN.md §7).
 */
let aiUnavailable = false;

export const isAiUnavailable = () => aiUnavailable;

export function markAiUnavailable() {
    aiUnavailable = true;
}

export function resetAiAvailabilityForTests() {
    aiUnavailable = false;
}
