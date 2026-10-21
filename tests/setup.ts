import '@testing-library/jest-dom/vitest';

import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { server } from './msw/server';

// Any request without a matching handler fails the test instead of hitting the network.
// (MSW 3 renamed v2's `onUnhandledRequest` to `onUnhandledFrame`.)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

// Everything below needs a DOM. Server-side tests (route handlers) opt into the node
// environment with `// @vitest-environment node` and skip it.
if (typeof window !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');

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
