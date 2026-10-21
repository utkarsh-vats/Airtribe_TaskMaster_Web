'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/Toaster';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { AuthBroadcastListener } from '@/lib/auth/AuthBroadcastListener';
import { getQueryClient } from '@/lib/query/client';

// Development only. The condition is fixed at build time, so production bundles drop the import
// (and the devtools package, a devDependency, isn't needed to build).
const ReactQueryDevtools =
    process.env.NODE_ENV === 'development'
        ? dynamic(
              () => import('@tanstack/react-query-devtools').then((mod) => mod.ReactQueryDevtools),
              { ssr: false },
          )
        : () => null;

export function Providers({ children }: { children: ReactNode }) {
    const queryClient = getQueryClient();

    return (
        <QueryClientProvider client={queryClient}>
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
                    <AuthBroadcastListener />
                </TooltipProvider>
            </ThemeProvider>
            <ReactQueryDevtools buttonPosition="bottom-right" />
        </QueryClientProvider>
    );
}
