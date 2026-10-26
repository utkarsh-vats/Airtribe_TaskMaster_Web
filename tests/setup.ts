import '@testing-library/jest-dom/vitest';

import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { server } from './msw/server';
import { restoreTimeZone } from './timeZone';

// Any request without a matching handler fails the test instead of hitting the network.
// (MSW 3 renamed v2's `onUnhandledRequest` to `onUnhandledFrame`.)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

/**
 * How long async waits keep retrying: 1 s locally, 5 s on CI (2 slow cores), set here once
 * rather than per test. Covers Testing Library's findBy* / waitFor and vi.waitFor (which has
 * its own 1 s default). A wait that passes an explicit timeout keeps it.
 */
const ASYNC_TIMEOUT = process.env.CI ? 5000 : 1000;
const viWaitFor = vi.waitFor.bind(vi);
vi.waitFor = ((callback, options) =>
    viWaitFor(
        callback,
        typeof options === 'number' ? options : { timeout: ASYNC_TIMEOUT, ...options },
    )) as typeof vi.waitFor;

// Safety net: whatever a file did to TZ, the next file in this worker starts from the suite's
// zone (vitest.config.mts). Overrides should restore it themselves (tests/timeZone.ts).
const suiteTimeZone = process.env.TZ;
afterAll(() => restoreTimeZone(suiteTimeZone));

// Everything below needs a DOM. Server-side tests (route handlers) opt into the node
// environment with `// @vitest-environment node` and skip it.
if (typeof window !== 'undefined') {
    const { cleanup, configure } = await import('@testing-library/react');
    configure({ asyncUtilTimeout: ASYNC_TIMEOUT });

    afterEach(() => {
        cleanup();
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.removeAttribute('style');
    });

    // jsdom has no matchMedia; next-themes uses it for the system theme. Default: light.
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });

    // Radix (Popover / DropdownMenu / Tooltip positioning) measures elements with ResizeObserver.
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    globalThis.ResizeObserver ??= ResizeObserverStub;

    // Radix DropdownMenu uses pointer capture and scrolls items into view.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.setPointerCapture ??= () => {};
    Element.prototype.releasePointerCapture ??= () => {};
    Element.prototype.scrollIntoView ??= () => {};
}
