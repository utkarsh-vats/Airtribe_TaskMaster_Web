'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/Toaster';
import { TooltipProvider } from '@/components/ui/Tooltip';

export function Providers({ children }: { children: ReactNode }) {
    return (
        <ThemeProvider
            attribute="data-theme"
            themes={['light', 'dark']}
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
            <TooltipProvider delayDuration={300}>
                {children}
                <Toaster />
            </TooltipProvider>
        </ThemeProvider>
    );
}
