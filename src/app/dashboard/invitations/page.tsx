import type { Metadata } from 'next';

import { InvitationsInbox } from '@/features/invitations/components/InvitationsInbox';

export const metadata: Metadata = { title: 'Invitations' };

export default function InvitationsPage() {
    return <InvitationsInbox />;
}
