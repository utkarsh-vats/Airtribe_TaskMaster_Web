import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/shell/DashboardShell';
import { NotificationStream } from '@/features/notifications/useNotificationStream';
import { MeSync } from '@/features/profile/components/MeSync';
import { SessionProvider } from '@/lib/auth/SessionProvider';

// SessionProvider restores the session (or redirects to /login) before the shell renders;
// the live notification stream and the me refetch (the header's user) run once per signed-in
// tab, beside the shell.
export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <SessionProvider>
            <NotificationStream />
            <MeSync />
            <DashboardShell>{children}</DashboardShell>
        </SessionProvider>
    );
}
