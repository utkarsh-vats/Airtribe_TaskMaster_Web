import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { archivo } from './fonts';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
    title: 'TaskMaster',
    description: 'Projects, tasks and the people doing them.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        // suppressHydrationWarning: next-themes sets data-theme on <html> before hydration.
        <html lang="en" className={archivo.variable} suppressHydrationWarning>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
