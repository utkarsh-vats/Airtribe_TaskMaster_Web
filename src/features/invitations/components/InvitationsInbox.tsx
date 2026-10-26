'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { RoleTag } from '@/components/ui/Tag';
import { errorMessage } from '@/lib/api/messages';
import type { MyInvitation } from '@/lib/api/types';
import { fullDateTime, relativeTime, timeUntil } from '@/lib/format/dates';
import { queryView } from '@/lib/query/view';

import {
    isStaleInvitation,
    useAcceptInvitation,
    useDeclineInvitation,
    usePendingInvitations,
} from '../api';

/**
 * /dashboard/invitations (DESIGN.md §4, §9): invitations sent to me, pending only, newest
 * first. Each can be accepted (I join the project) or declined (confirmed). Not in the
 * prototype; styled like its lists.
 */
export function InvitationsInbox() {
    const invitations = usePendingInvitations();

    let body;
    const view = queryView(invitations);
    if (view.status === 'loading') {
        body = (
            <div aria-busy="true" className="flex flex-col border-t-rule border-divider">
                <span className="sr-only">Loading invitations…</span>
                {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="flex flex-col gap-2 border-b border-divider py-4">
                        <Skeleton width="40%" height={16} />
                        <Skeleton width="60%" height={12} />
                    </div>
                ))}
            </div>
        );
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                title="Couldn't load your invitations"
                message={errorMessage(view.error)}
                retrying={invitations.isRefetching}
                onRetry={() => void invitations.refetch()}
            />
        );
    } else if (!view.data.length) {
        body = (
            <EmptyState
                title="No pending invitations"
                body="When someone invites you to a project, it shows up here."
            />
        );
    } else {
        body = (
            <ul
                aria-label="Pending invitations"
                className="m-0 list-none border-t-rule border-divider p-0"
            >
                {view.data.map((invitation) => (
                    <InvitationRow key={invitation.id} invitation={invitation} />
                ))}
            </ul>
        );
    }

    return (
        <div className="flex max-w-[960px] flex-col gap-4">
            <div className="flex items-baseline gap-2">
                <h2 className="m-0">Invitations</h2>
                {invitations.data && (
                    <span className="text-muted" data-testid="invitation-count">
                        {invitations.data.length}
                    </span>
                )}
            </div>
            {body}
        </div>
    );
}

/** One invitation with its own Accept / Decline: a request on one row leaves the others usable. */
function InvitationRow({ invitation }: { invitation: MyInvitation }) {
    const router = useRouter();
    const accept = useAcceptInvitation();
    const decline = useDeclineInvitation();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const busy = accept.isPending || decline.isPending;
    const project = invitation.project;

    const onAccept = () =>
        accept.mutate(invitation, {
            onSuccess: () =>
                toast.success(`You joined ${project.name}`, {
                    action: {
                        label: 'Open project',
                        onClick: () => router.push(`/dashboard/projects/${project.id}`),
                    },
                }),
        });

    return (
        <li className="flex flex-col gap-3 border-b border-divider py-4 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-semibold break-words">{project.name}</span>
                <span className="flex flex-wrap items-center gap-1 text-sm">
                    {invitation.invitedBy.name} invited you as{' '}
                    <RoleTag role={invitation.role} size="sm" />
                </span>
                <span className="text-muted text-[12px]">
                    Sent{' '}
                    <time
                        dateTime={invitation.createdAt}
                        title={fullDateTime(invitation.createdAt)}
                    >
                        {relativeTime(invitation.createdAt)}
                    </time>{' '}
                    · Expires{' '}
                    <time
                        dateTime={invitation.expiresAt}
                        title={fullDateTime(invitation.expiresAt)}
                    >
                        {timeUntil(invitation.expiresAt)}
                    </time>
                </span>
            </div>
            <div className="flex gap-2">
                <Button
                    variant="primary"
                    size="sm"
                    className="flex-1 md:flex-none"
                    aria-label={`Accept the invitation to ${project.name}`}
                    loading={accept.isPending}
                    disabled={busy}
                    onClick={onAccept}
                >
                    Accept
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 md:flex-none"
                    aria-label={`Decline the invitation to ${project.name}`}
                    disabled={busy}
                    onClick={() => setConfirmOpen(true)}
                >
                    Decline
                </Button>
            </div>
            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={`Decline the invitation to ${project.name}?`}
                description="You'll need a new invitation to join."
                confirmLabel="Decline"
                // Rejects (keeping the dialog open) unless it can't be answered any more.
                onConfirm={async () => {
                    try {
                        await decline.mutateAsync(invitation);
                        toast.success('Invitation declined');
                    } catch (error) {
                        if (!isStaleInvitation(error)) throw error;
                    }
                }}
            />
        </li>
    );
}
