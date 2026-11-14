import type { Metadata } from 'next';
import { Suspense } from 'react';

import { NotificationsView } from '@/features/notifications/components/NotificationsView';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
    return (
        // NotificationsView reads ?unread / ?page; useSearchParams needs a Suspense boundary.
        <Suspense>
            <NotificationsView />
        </Suspense>
    );
}
