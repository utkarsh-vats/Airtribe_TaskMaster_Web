'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/Table';
import { RoleTag } from '@/components/ui/Tag';
import { useProjectContext } from '@/features/projects/ProjectContext';
import { isApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/api/messages';
import { notifyError } from '@/lib/api/notify';
import type { Invitation } from '@/lib/api/types';
import { fullDateTime, relativeTime, timeUntil } from '@/lib/format/dates';

import { useCreateInvitation, useProjectInvitations, useRevokeInvitation } from '../api';

export const NO_INVITATIONS_MESSAGE = 'No pending invitations.';

/** What can be done with one invitation. */
type Handlers = {
    onRevoke: (invitation: Invitation) => void;
    onInviteAgain: (invitation: Invitation) => void;
    /** "Invite again" for this one: ADMIN invitations need the OWNER. */
    canInviteAgain: (invitation: Invitation) => boolean;
    /** The invitation being sent again. */
    resending: string | null;
};

/**
 * "Pending invitations" (DESIGN.md §6 Members tab; prototype), ADMIN+ only: the project's
 * PENDING and EXPIRED invitations, newest first. PENDING ones can be revoked (confirmed),
 * EXPIRED ones sent again with the same email and role.
 */
export function ProjectInvitationsSection() {
    const { project, can } = useProjectContext();
    const invitations = useProjectInvitations(project.id, can.manageMembers);
    const create = useCreateInvitation(project.id);
    const revoke = useRevokeInvitation(project.id);
    const headingId = useId();
    const [revoking, setRevoking] = useState<Invitation | null>(null);

    if (!can.manageMembers) return null;

    const handlers: Handlers = {
        onRevoke: setRevoking,
        onInviteAgain: (invitation) =>
            create.mutate(
                { email: invitation.email, role: invitation.role },
                {
                    onSuccess: () => toast.success(`Invitation sent to ${invitation.email}`),
                    onError: (error) => {
                        if (isApiError(error) && error.status === 409) toast.error(error.message);
                        else notifyError(error);
                    },
                },
            ),
        canInviteAgain: (invitation) => invitation.role !== 'ADMIN' || can.inviteAdmin,
        resending: create.isPending ? create.variables.email : null,
    };

    /** Rejects to keep the dialog open, except when it's no longer pending (409) or gone (404). */
    const confirmRevoke = async (invitation: Invitation) => {
        try {
            await revoke.mutateAsync(invitation);
        } catch (error) {
            // Either way the lists are refetched (useRevokeInvitation).
            if (isApiError(error) && error.status === 409) return void toast.error(error.message);
            if (isApiError(error) && error.status === 404) return;
            notifyError(error);
            throw error;
        }
    };

    let body;
    if (invitations.isPending) {
        body = (
            <>
                <div className="hidden md:block">
                    <Table minWidth={640} aria-label="Loading invitations">
                        <InvitationsHead />
                        <TableSkeleton rows={2} cols={5} />
                    </Table>
                </div>
                <div aria-busy="true" className="flex flex-col md:hidden">
                    <span className="sr-only">Loading invitations…</span>
                    {Array.from({ length: 2 }, (_, i) => (
                        <div key={i} className="flex flex-col gap-1 border-b border-divider py-3">
                            <Skeleton width="60%" height={14} />
                            <Skeleton width="40%" height={11} />
                        </div>
                    ))}
                </div>
            </>
        );
    } else if (invitations.error || !invitations.data) {
        body = (
            <ErrorState
                compact
                title="Couldn't load invitations"
                message={errorMessage(invitations.error)}
                retrying={invitations.isRefetching}
                onRetry={() => void invitations.refetch()}
            />
        );
    } else if (!invitations.data.length) {
        // The prototype's empty row, under the same 2px rule as the table.
        body = (
            <p className="text-muted m-0 border-t-rule border-divider py-3">
                {NO_INVITATIONS_MESSAGE}
            </p>
        );
    } else {
        body = (
            <>
                <div className="hidden md:block" data-testid="invitation-table">
                    <InvitationsTable invitations={invitations.data} handlers={handlers} />
                </div>
                <div className="md:hidden" data-testid="invitation-rows">
                    <InvitationRows invitations={invitations.data} handlers={handlers} />
                </div>
            </>
        );
    }

    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
                <h4 id={headingId} className="m-0">
                    Pending invitations
                </h4>
                {invitations.data && (
                    <span className="text-muted" data-testid="invitation-count">
                        {invitations.data.length}
                    </span>
                )}
            </div>
            {body}
            <ConfirmDialog
                open={revoking !== null}
                onOpenChange={(open) => {
                    if (!open) setRevoking(null);
                }}
                title={revoking ? `Revoke the invitation to ${revoking.email}?` : ''}
                description="They won't be able to join with this invitation."
                confirmLabel="Revoke"
                destructive
                onConfirm={() => (revoking ? confirmRevoke(revoking) : undefined)}
            />
        </section>
    );
}

function InvitationsHead() {
    return (
        <THead>
            <tr>
                <Th>Email</Th>
                <Th style={{ width: 110 }}>Role</Th>
                <Th style={{ width: 110 }}>Sent</Th>
                <Th style={{ width: 110 }}>Expires</Th>
                <Th style={{ width: 130 }}>
                    <span className="sr-only">Actions</span>
                </Th>
            </tr>
        </THead>
    );
}

function Sent({ invitation }: { invitation: Invitation }) {
    return (
        <time dateTime={invitation.createdAt} title={fullDateTime(invitation.createdAt)}>
            {relativeTime(invitation.createdAt)}
        </time>
    );
}

/** "in 5 days" for a pending one; "Expired" in the danger colour. */
function Expires({ invitation }: { invitation: Invitation }) {
    if (invitation.status === 'EXPIRED') {
        return (
            <time
                dateTime={invitation.expiresAt}
                title={fullDateTime(invitation.expiresAt)}
                className="text-danger"
            >
                Expired
            </time>
        );
    }
    return (
        <time dateTime={invitation.expiresAt} title={fullDateTime(invitation.expiresAt)}>
            {timeUntil(invitation.expiresAt)}
        </time>
    );
}

function Action({ invitation, handlers }: { invitation: Invitation; handlers: Handlers }) {
    if (invitation.status === 'PENDING') {
        return (
            <Button
                variant="ghost"
                size="sm"
                danger
                aria-label={`Revoke the invitation to ${invitation.email}`}
                onClick={() => handlers.onRevoke(invitation)}
            >
                Revoke
            </Button>
        );
    }
    if (!handlers.canInviteAgain(invitation)) return null;
    return (
        <Button
            variant="ghost"
            size="sm"
            aria-label={`Invite ${invitation.email} again`}
            loading={handlers.resending === invitation.email}
            onClick={() => handlers.onInviteAgain(invitation)}
        >
            Invite again
        </Button>
    );
}

/** ≥ 820px. */
function InvitationsTable({
    invitations,
    handlers,
}: {
    invitations: Invitation[];
    handlers: Handlers;
}) {
    return (
        <Table minWidth={640} aria-label="Pending invitations">
            <InvitationsHead />
            <TBody>
                {invitations.map((invitation) => (
                    <Tr key={invitation.id}>
                        <Td className="break-all">{invitation.email}</Td>
                        <Td>
                            <RoleTag role={invitation.role} />
                        </Td>
                        <Td className="text-muted text-[13px]">
                            <Sent invitation={invitation} />
                        </Td>
                        <Td className="text-muted text-[13px]">
                            <Expires invitation={invitation} />
                        </Td>
                        <Td>
                            <div className="flex justify-end">
                                <Action invitation={invitation} handlers={handlers} />
                            </div>
                        </Td>
                    </Tr>
                ))}
            </TBody>
        </Table>
    );
}

/** < 820px: stacked rows with the same information and action. */
function InvitationRows({
    invitations,
    handlers,
}: {
    invitations: Invitation[];
    handlers: Handlers;
}) {
    return (
        <ul
            aria-label="Pending invitations"
            className="m-0 list-none border-t-rule border-divider p-0"
        >
            {invitations.map((invitation) => (
                <li
                    key={invitation.id}
                    className="flex items-start gap-3 border-b border-divider py-3"
                >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-semibold break-all">{invitation.email}</span>
                        <div className="text-muted flex flex-wrap items-center gap-2 text-[12px]">
                            <RoleTag role={invitation.role} size="sm" />
                            <span>
                                Sent <Sent invitation={invitation} />
                            </span>
                            <span>
                                {invitation.status === 'EXPIRED' ? '' : 'Expires '}
                                <Expires invitation={invitation} />
                            </span>
                        </div>
                    </div>
                    <Action invitation={invitation} handlers={handlers} />
                </li>
            ))}
        </ul>
    );
}
