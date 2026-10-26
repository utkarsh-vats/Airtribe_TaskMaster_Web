'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { NativeSelect } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/Table';
import { RoleTag } from '@/components/ui/Tag';
import { InviteSection } from '@/features/invitations/components/InviteForm';
import { ProjectInvitationsSection } from '@/features/invitations/components/ProjectInvitations';
import { useProjectContext } from '@/features/projects/ProjectContext';
import { errorMessage } from '@/lib/api/messages';
import type { Member } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';
import { fullDateTime, shortDate } from '@/lib/format/dates';
import { queryView } from '@/lib/query/view';

import {
    isMemberGone,
    leftProject,
    reportMemberError,
    useChangeRole,
    useProjectMembers,
    useRemoveMember,
} from '../api';

export const OWNER_LEAVE_HINT = 'Transfer ownership before leaving.';

/**
 * The project's Members tab (DESIGN.md §4, §6; prototype Members tab): "Invite people",
 * "Members" and "Pending invitations" (ADMIN+), stacked like the prototype, each after the
 * first behind a 2px rule.
 */
export function MembersView() {
    const { project } = useProjectContext();

    return (
        <div className="flex max-w-[960px] flex-col gap-8 [&>section+section]:border-t-rule [&>section+section]:border-divider [&>section+section]:pt-6">
            <InviteSection />
            <MembersSection projectId={project.id} />
            <ProjectInvitationsSection />
        </div>
    );
}

/** What the signed-in user may do to one row (§8), from ProjectContext's bound checks. */
type RowActions = {
    changeRole: boolean;
    transfer: boolean;
    remove: boolean;
    leave: boolean;
    /** The OWNER's own row: no Leave, a hint instead. */
    ownerHint: boolean;
};

/** The action waiting for its confirm dialog. */
type Pending = { kind: 'transfer' | 'remove' | 'leave'; member: Member };

/** Callbacks a row's controls use. */
type RowHandlers = {
    onRoleChange: (member: Member, role: 'ADMIN' | 'MEMBER') => void;
    onConfirm: (pending: Pending) => void;
};

function MembersSection({ projectId }: { projectId: string }) {
    const members = useProjectMembers(projectId);
    const { project, can } = useProjectContext();
    const { user } = useSession();
    const headingId = useId();
    const queryClient = useQueryClient();
    const router = useRouter();
    const changeRole = useChangeRole(projectId);
    const remove = useRemoveMember(projectId);
    const [pending, setPending] = useState<Pending | null>(null);
    const meId = user?.id;

    const actionsFor = (member: Member): RowActions => {
        const isMe = member.user.id === meId;
        return {
            changeRole: can.changeRoles && !isMe && member.role !== 'OWNER',
            transfer: can.transferOwnership && !isMe,
            remove: can.removeMember(member.role, member.user.id),
            leave: isMe && can.leave,
            ownerHint: isMe && member.role === 'OWNER',
        };
    };

    // The row whose role is being saved (a transfer spins in its dialog instead).
    const savingRoleOf =
        changeRole.isPending && changeRole.variables.role !== 'OWNER'
            ? changeRole.variables.member.user.id
            : null;

    const handlers: RowHandlers = {
        // Errors are reported by the hook; the select shows the cached role again.
        onRoleChange: (member, role) => changeRole.mutate({ member, role }),
        onConfirm: setPending,
    };

    /** The confirmed action. Rejects to keep the dialog open — any error but a 404. */
    const confirm = async ({ kind, member }: Pending) => {
        const name = member.user.name;
        try {
            if (kind === 'transfer') {
                await changeRole.mutateAsync({ member, role: 'OWNER' });
                toast.success(`${name} is now the owner.`);
            } else if (kind === 'remove') {
                await remove.mutateAsync(member.user.id);
                toast(`${name} was removed.`);
            } else {
                await remove.mutateAsync(member.user.id);
                toast(`You left ${project.name}.`);
            }
        } catch (error) {
            // The hook already reported a failed role change.
            if (kind !== 'transfer') {
                if (kind === 'leave' && isMemberGone(error)) {
                    // Not a member any more anyway: same as having left.
                    leftProject(queryClient, router, projectId);
                    toast(`You left ${project.name}.`);
                    return;
                }
                reportMemberError(queryClient, projectId, error);
            }
            if (isMemberGone(error)) return;
            throw error;
        }
    };

    let body;
    const view = queryView(members);
    if (view.status === 'loading') {
        body = (
            <>
                <div className="hidden md:block">
                    <Table minWidth={640} aria-label="Loading members">
                        <MembersHead />
                        <TableSkeleton rows={3} cols={4} />
                    </Table>
                </div>
                <div aria-busy="true" className="flex flex-col md:hidden">
                    <span className="sr-only">Loading members…</span>
                    {Array.from({ length: 3 }, (_, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 border-b border-divider py-3"
                        >
                            <Skeleton width={32} height={32} />
                            <div className="flex flex-1 flex-col gap-1">
                                <Skeleton width="50%" height={14} />
                                <Skeleton width="70%" height={11} />
                            </div>
                        </div>
                    ))}
                </div>
            </>
        );
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                title="Couldn't load members"
                message={errorMessage(view.error)}
                retrying={members.isRefetching}
                onRetry={() => void members.refetch()}
            />
        );
    } else {
        // A project always has its owner, so the list is never empty.
        const rows = view.data.map((member) => ({
            member,
            isMe: member.user.id === meId,
            actions: actionsFor(member),
            savingRole: savingRoleOf === member.user.id,
        }));
        body = (
            <>
                <div className="hidden md:block" data-testid="member-table">
                    <MembersTable rows={rows} handlers={handlers} />
                </div>
                <div className="md:hidden" data-testid="member-rows">
                    <MemberRows rows={rows} handlers={handlers} />
                </div>
            </>
        );
    }

    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
                <h4 id={headingId} className="m-0">
                    Members
                </h4>
                {members.data && (
                    <span className="text-muted" data-testid="member-count">
                        {members.data.length}
                    </span>
                )}
            </div>
            {body}
            <ConfirmDialog
                open={pending !== null}
                onOpenChange={(open) => {
                    if (!open) setPending(null);
                }}
                {...(pending ? dialogText(pending, project.name) : { title: '' })}
                onConfirm={() => (pending ? confirm(pending) : undefined)}
            />
        </section>
    );
}

function dialogText({ kind, member }: Pending, projectName: string) {
    const name = member.user.name;
    if (kind === 'transfer') {
        return {
            title: `Transfer ownership to ${name}?`,
            description: `You'll become an admin. Only ${name} will be able to delete the project, change roles or invite admins.`,
            confirmLabel: 'Transfer ownership',
        };
    }
    if (kind === 'remove') {
        return {
            title: `Remove ${name}?`,
            description: 'Their open tasks will be unassigned. Their comments and files stay.',
            confirmLabel: 'Remove',
            destructive: true,
        };
    }
    return {
        title: `Leave ${projectName}?`,
        description: "Your open tasks will be unassigned and you'll lose access to this project.",
        confirmLabel: 'Leave',
        destructive: true,
    };
}

type Row = { member: Member; isMe: boolean; actions: RowActions; savingRole: boolean };

function MembersHead() {
    return (
        <THead>
            <tr>
                <Th>Name</Th>
                <Th style={{ width: 150 }}>Role</Th>
                <Th style={{ width: 110 }}>Joined</Th>
                <Th style={{ width: 230 }}>
                    <span className="sr-only">Actions</span>
                </Th>
            </tr>
        </THead>
    );
}

/** Name, with a muted "(you)" for the signed-in user. */
function MemberName({ member, isMe }: { member: Member; isMe: boolean }) {
    return (
        <span className="font-semibold break-words">
            {member.user.name}
            {isMe && <span className="text-muted font-normal"> (you)</span>}
        </span>
    );
}

function Joined({ iso, prefix = '' }: { iso: string; prefix?: string }) {
    return (
        <time dateTime={iso} title={fullDateTime(iso)}>
            {prefix}
            {shortDate(iso)}
        </time>
    );
}

/** The OWNER's Admin / Member select (prototype), disabled with a spinner while saving. */
function RoleSelect({ row, handlers }: { row: Row; handlers: RowHandlers }) {
    const { member, savingRole } = row;
    return (
        <div className="flex items-center gap-2">
            <NativeSelect
                aria-label={`Role for ${member.user.name}`}
                value={member.role}
                disabled={savingRole}
                onChange={(event) =>
                    handlers.onRoleChange(member, event.target.value as 'ADMIN' | 'MEMBER')
                }
                className="min-h-[30px] px-2 py-[3px]"
            >
                <option value="ADMIN">Admin</option>
                <option value="MEMBER">Member</option>
            </NativeSelect>
            {savingRole && <Spinner size={14} label="Saving role" />}
        </div>
    );
}

/** ≥ 820px: the prototype's table. */
function MembersTable({ rows, handlers }: { rows: Row[]; handlers: RowHandlers }) {
    return (
        <Table minWidth={640} aria-label="Members">
            <MembersHead />
            <TBody>
                {rows.map((row) => {
                    const { member, isMe, actions } = row;
                    const name = member.user.name;
                    return (
                        <Tr key={member.user.id}>
                            <Td>
                                <div className="flex items-center gap-3">
                                    <Avatar
                                        name={name}
                                        src={member.user.avatarUrl}
                                        className="flex-none"
                                    />
                                    <div className="flex min-w-0 flex-col">
                                        <MemberName member={member} isMe={isMe} />
                                        <span className="text-muted text-[12px] break-all">
                                            {member.user.email}
                                        </span>
                                    </div>
                                </div>
                            </Td>
                            <Td>
                                {actions.changeRole ? (
                                    <RoleSelect row={row} handlers={handlers} />
                                ) : (
                                    <RoleTag role={member.role} />
                                )}
                            </Td>
                            <Td className="text-muted text-[13px]">
                                <Joined iso={member.joinedAt} />
                            </Td>
                            <Td>
                                <div className="flex items-center justify-end gap-1">
                                    {actions.remove && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            danger
                                            aria-label={`Remove ${name}`}
                                            onClick={() =>
                                                handlers.onConfirm({ kind: 'remove', member })
                                            }
                                        >
                                            Remove
                                        </Button>
                                    )}
                                    {actions.leave && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            danger
                                            onClick={() =>
                                                handlers.onConfirm({ kind: 'leave', member })
                                            }
                                        >
                                            Leave project
                                        </Button>
                                    )}
                                    {actions.ownerHint && (
                                        <span className="text-muted text-[12px]">
                                            {OWNER_LEAVE_HINT}
                                        </span>
                                    )}
                                    {actions.transfer && (
                                        // Not modal: a modal menu opening the confirm dialog can
                                        // leave the page without pointer events.
                                        <Menu modal={false}>
                                            <MenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    iconOnly
                                                    aria-label={`More actions for ${name}`}
                                                >
                                                    <MoreHorizontal aria-hidden size={16} />
                                                </Button>
                                            </MenuTrigger>
                                            <MenuContent>
                                                <MenuItem
                                                    onSelect={() =>
                                                        handlers.onConfirm({
                                                            kind: 'transfer',
                                                            member,
                                                        })
                                                    }
                                                >
                                                    Make owner
                                                </MenuItem>
                                            </MenuContent>
                                        </Menu>
                                    )}
                                </div>
                            </Td>
                        </Tr>
                    );
                })}
            </TBody>
        </Table>
    );
}

/** < 820px: stacked rows, the actions in a menu. */
function MemberRows({ rows, handlers }: { rows: Row[]; handlers: RowHandlers }) {
    return (
        <ul aria-label="Members" className="m-0 list-none border-t-rule border-divider p-0">
            {rows.map((row) => {
                const { member, isMe, actions, savingRole } = row;
                const name = member.user.name;
                const otherRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
                const hasMenu =
                    actions.changeRole || actions.transfer || actions.remove || actions.leave;
                return (
                    <li
                        key={member.user.id}
                        className="flex items-start gap-3 border-b border-divider py-3"
                    >
                        <Avatar name={name} src={member.user.avatarUrl} className="flex-none" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <MemberName member={member} isMe={isMe} />
                            <span className="text-muted text-[12px] break-all">
                                {member.user.email}
                            </span>
                            <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                <RoleTag role={member.role} size="sm" />
                                {savingRole && <Spinner size={12} label="Saving role" />}
                                <span className="text-muted">
                                    <Joined iso={member.joinedAt} prefix="Joined " />
                                </span>
                            </div>
                            {actions.ownerHint && (
                                <span className="text-muted text-[12px]">{OWNER_LEAVE_HINT}</span>
                            )}
                        </div>
                        {hasMenu && (
                            <Menu modal={false}>
                                <MenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        iconOnly
                                        aria-label={`Actions for ${name}`}
                                        disabled={savingRole}
                                    >
                                        <MoreHorizontal aria-hidden size={16} />
                                    </Button>
                                </MenuTrigger>
                                <MenuContent>
                                    {actions.changeRole && (
                                        <MenuItem
                                            onSelect={() =>
                                                handlers.onRoleChange(member, otherRole)
                                            }
                                        >
                                            {otherRole === 'ADMIN' ? 'Make admin' : 'Make member'}
                                        </MenuItem>
                                    )}
                                    {actions.transfer && (
                                        <MenuItem
                                            onSelect={() =>
                                                handlers.onConfirm({ kind: 'transfer', member })
                                            }
                                        >
                                            Make owner
                                        </MenuItem>
                                    )}
                                    {actions.remove && (
                                        <MenuItem
                                            danger
                                            onSelect={() =>
                                                handlers.onConfirm({ kind: 'remove', member })
                                            }
                                        >
                                            Remove
                                        </MenuItem>
                                    )}
                                    {actions.leave && (
                                        <MenuItem
                                            danger
                                            onSelect={() =>
                                                handlers.onConfirm({ kind: 'leave', member })
                                            }
                                        >
                                            Leave project
                                        </MenuItem>
                                    )}
                                </MenuContent>
                            </Menu>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
