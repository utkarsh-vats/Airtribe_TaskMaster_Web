import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

/*
 * Time zone overrides for tests. process.env.TZ is shared by every file a worker runs, so each
 * override must put back exactly what was there — including "unset": assigning `undefined`
 * would store the string "undefined", which Node treats as an unknown zone (UTC).
 * vitest.config.mts sets TZ=UTC for the suite; these go on top.
 */

/** Put TZ back to `previous` (deleting it when it was unset). */
export function restoreTimeZone(previous: string | undefined) {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
}

/** Run this file (or describe block) in `tz`, restoring the previous zone afterwards. */
export function inTimeZone(tz: string) {
    let previous: string | undefined;
    beforeAll(() => {
        previous = process.env.TZ;
        process.env.TZ = tz;
    });
    afterAll(() => restoreTimeZone(previous));
}

/** For tests that set process.env.TZ themselves: restore it after each one. */
export function restoreTimeZoneAfterEach() {
    let previous: string | undefined;
    beforeEach(() => {
        previous = process.env.TZ;
    });
    afterEach(() => restoreTimeZone(previous));
}
