'use client';

import { useTheme } from 'next-themes';
import { Toaster as SonnerToaster } from 'sonner';

export { toast } from 'sonner';

/** Flat sonner toasts: 0 radius, 2px rule, page ground; follows the app theme. Mounted in providers. */
export function Toaster() {
    const { resolvedTheme } = useTheme();

    return (
        <SonnerToaster
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            position="bottom-left"
            gap={8}
            toastOptions={{
                unstyled: true,
                classNames: {
                    toast: 'tm-toast',
                    content: 'tm-toast-content',
                    title: 'tm-toast-title',
                    description: 'tm-toast-description',
                    actionButton: 'btn btn-secondary btn-sm',
                    cancelButton: 'btn btn-ghost btn-sm',
                },
            }}
        />
    );
}
