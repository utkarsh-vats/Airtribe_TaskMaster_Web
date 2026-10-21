import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/shell/DashboardShell';
import { SessionProvider } from '@/lib/auth/SessionProvider';

// SessionProvider restores the session (or redirects to /login) before the shell renders.
export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <SessionProvider>
            <DashboardShell>{children}</DashboardShell>
        </SessionProvider>
    );
}
