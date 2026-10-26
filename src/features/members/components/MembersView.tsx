'use client';

import { useId } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/Table';
import { RoleTag } from '@/components/ui/Tag';
import { useProjectContext } from '@/features/projects/ProjectContext';
import { errorMessage } from '@/lib/api/messages';
import type { Member } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';
import { fullDateTime, shortDate } from '@/lib/format/dates';

import { useProjectMembers } from '../api';

/**
 * The project's Members tab (DESIGN.md §4, §6; prototype Members tab): sections stacked like
 * the prototype — "Invite people" goes above and "Pending invitations" below in 10c, each
 * after a 2px rule. For now, the Members section (read-only; role changes and removal in 10b).
 */
export function MembersView() {
    const { project } = useProjectContext();

    return (
        <div className="flex max-w-[960px] flex-col gap-8 [&>section+section]:border-t-rule [&>section+section]:border-divider [&>section+section]:pt-6">
            <MembersSection projectId={project.id} />
        </div>
    );
}

function MembersSection({ projectId }: { projectId: string }) {
    const members = useProjectMembers(projectId);
    const { user } = useSession();
    const headingId = useId();

    let body;
    if (members.isPending) {
        body = (
            <>
                <div className="hidden md:block">
                    <Table minWidth={560} aria-label="Loading members">
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
    } else if (members.isError) {
        body = (
            <ErrorState
                title="Couldn't load members"
                message={errorMessage(members.error)}
                retrying={members.isRefetching}
                onRetry={() => void members.refetch()}
            />
        );
    } else {
        // A project always has its owner, so the list is never empty.
        body = (
            <>
                <div className="hidden md:block" data-testid="member-table">
                    <MembersTable members={members.data} meId={user?.id} />
                </div>
                <div className="md:hidden" data-testid="member-rows">
                    <MemberRows members={members.data} meId={user?.id} />
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
        </section>
    );
}

function MembersHead() {
    return (
        <THead>
            <tr>
                <Th>Name</Th>
                <Th style={{ width: 150 }}>Role</Th>
                <Th style={{ width: 110 }}>Joined</Th>
                {/* Role changes and Remove (10b). */}
                <Th style={{ width: 90 }}>
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

/** ≥ 820px: the prototype's table. */
function MembersTable({ members, meId }: { members: Member[]; meId: string | undefined }) {
    return (
        <Table minWidth={560} aria-label="Members">
            <MembersHead />
            <TBody>
                {members.map((member) => (
                    <Tr key={member.user.id}>
                        <Td>
                            <div className="flex items-center gap-3">
                                <Avatar
                                    name={member.user.name}
                                    src={member.user.avatarUrl}
                                    className="flex-none"
                                />
                                <div className="flex min-w-0 flex-col">
                                    <MemberName member={member} isMe={member.user.id === meId} />
                                    <span className="text-muted text-[12px] break-all">
                                        {member.user.email}
                                    </span>
                                </div>
                            </div>
                        </Td>
                        <Td>
                            <RoleTag role={member.role} />
                        </Td>
                        <Td className="text-muted text-[13px]">
                            <Joined iso={member.joinedAt} />
                        </Td>
                        <Td />
                    </Tr>
                ))}
            </TBody>
        </Table>
    );
}

/** < 820px: stacked rows. */
function MemberRows({ members, meId }: { members: Member[]; meId: string | undefined }) {
    return (
        <ul aria-label="Members" className="m-0 list-none border-t-rule border-divider p-0">
            {members.map((member) => (
                <li
                    key={member.user.id}
                    className="flex items-start gap-3 border-b border-divider py-3"
                >
                    <Avatar
                        name={member.user.name}
                        src={member.user.avatarUrl}
                        className="flex-none"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <MemberName member={member} isMe={member.user.id === meId} />
                        <span className="text-muted text-[12px] break-all">
                            {member.user.email}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                            <RoleTag role={member.role} size="sm" />
                            <span className="text-muted">
                                <Joined iso={member.joinedAt} prefix="Joined " />
                            </span>
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    );
}
