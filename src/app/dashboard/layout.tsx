import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/shell/DashboardShell';
import { NotificationStream } from '@/features/notifications/useNotificationStream';
import { SessionProvider } from '@/lib/auth/SessionProvider';

// SessionProvider restores the session (or redirects to /login) before the shell renders;
// the live notification stream runs once per signed-in tab, beside the shell.
export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <SessionProvider>
            <NotificationStream />
            <DashboardShell>{children}</DashboardShell>
        </SessionProvider>
    );
}
