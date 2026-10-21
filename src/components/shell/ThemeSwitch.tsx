'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** True after hydration; false during SSR and the hydration render. */
function useIsClient() {
    return useSyncExternalStore(
        subscribe,
        () => true,
        () => false,
    );
}

/**
 * Light / dark pill switch from the prototype header. The knob position is driven by CSS
 * (`dark:`), so it is right before hydration; aria-checked follows once the theme is known.
 */
export function ThemeSwitch() {
    const { resolvedTheme, setTheme } = useTheme();
    const isClient = useIsClient();
    const isDark = isClient && resolvedTheme === 'dark';

    return (
        <button
            type="button"
            role="switch"
            aria-checked={isDark}
            aria-label="Dark theme"
            title={isDark ? 'Switch to light' : 'Switch to dark'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="relative flex h-[30px] w-[60px] flex-none cursor-pointer items-center justify-between rounded-[999px] border border-divider bg-surface px-2 py-0 text-text hover:border-accent"
        >
            <Sun aria-hidden size={13} strokeWidth={2.2} className="opacity-55" />
            <Moon aria-hidden size={13} strokeWidth={2.2} className="opacity-55" />
            <span
                aria-hidden
                className="absolute top-[3px] left-[3px] h-[22px] w-[22px] rounded-[999px] bg-accent transition-transform duration-[180ms] ease-[ease] dark:translate-x-[30px]"
            />
        </button>
    );
}
