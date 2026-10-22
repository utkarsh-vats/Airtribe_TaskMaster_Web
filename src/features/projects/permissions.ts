import type { ProjectRole } from '@/lib/api/types';

/*
 * UI permission checks (DESIGN.md §8). They only decide what to show or enable — the API is the
 * authority and still answers 403. Pure functions of the caller's role and ids, so they're
 * cheap to call in render and easy to test.
 */

const RANK: Record<ProjectRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };
const atLeast = (role: ProjectRole, minimum: ProjectRole) => RANK[role] >= RANK[minimum];

/** The task fields these checks read (works for Task and TaskListItem). */
export type TaskOwnership = {
    createdBy: { id: string };
    assignee: { id: string } | null;
};
export type CommentOwnership = { authorId: string };
export type AttachmentOwnership = { uploadedBy: { id: string } };

// — project —
export const canEditProject = (role: ProjectRole) => atLeast(role, 'ADMIN');
export const canDeleteProject = (role: ProjectRole) => role === 'OWNER';
export const canLeave = (role: ProjectRole) => role !== 'OWNER';

// — members & invitations —
/** Invite, revoke invitations, remove members (ADMIN+). */
export const canManageMembers = (role: ProjectRole) => atLeast(role, 'ADMIN');
export const canChangeRoles = (role: ProjectRole) => role === 'OWNER';
export const canTransferOwnership = (role: ProjectRole) => role === 'OWNER';
export const canInviteAdmin = (role: ProjectRole) => role === 'OWNER';

/**
 * Remove someone else from the project: ADMIN+ removes MEMBERs, only the OWNER removes ADMINs,
 * nobody removes the OWNER. Removing yourself is "leave", not this.
 */
export function canRemoveMember(callerRole: ProjectRole, targetRole: ProjectRole, isSelf: boolean) {
    if (isSelf || targetRole === 'OWNER') return false;
    if (targetRole === 'ADMIN') return callerRole === 'OWNER';
    return atLeast(callerRole, 'ADMIN');
}

// — tasks —
/** Edit fields: the creator, the assignee, or ADMIN+. */
export function canEditTask(role: ProjectRole, userId: string, task: TaskOwnership) {
    return atLeast(role, 'ADMIN') || task.createdBy.id === userId || task.assignee?.id === userId;
}

/** Delete: the creator or ADMIN+ (an assignee can't). */
export function canDeleteTask(role: ProjectRole, userId: string, task: TaskOwnership) {
    return atLeast(role, 'ADMIN') || task.createdBy.id === userId;
}

// — comments & attachments —
/** Only the author edits a comment — not even the owner. */
export const canEditComment = (userId: string, comment: CommentOwnership) =>
    comment.authorId === userId;

export function canDeleteComment(role: ProjectRole, userId: string, comment: CommentOwnership) {
    return atLeast(role, 'ADMIN') || comment.authorId === userId;
}

export function canDeleteAttachment(
    role: ProjectRole,
    userId: string,
    attachment: AttachmentOwnership,
) {
    return atLeast(role, 'ADMIN') || attachment.uploadedBy.id === userId;
}

/** All checks bound to one caller: what ProjectContext hands to components. */
export function bindPermissions(role: ProjectRole, userId: string) {
    return {
        editProject: canEditProject(role),
        deleteProject: canDeleteProject(role),
        leave: canLeave(role),
        manageMembers: canManageMembers(role),
        changeRoles: canChangeRoles(role),
        transferOwnership: canTransferOwnership(role),
        inviteAdmin: canInviteAdmin(role),
        removeMember: (targetRole: ProjectRole, targetUserId: string) =>
            canRemoveMember(role, targetRole, targetUserId === userId),
        editTask: (task: TaskOwnership) => canEditTask(role, userId, task),
        deleteTask: (task: TaskOwnership) => canDeleteTask(role, userId, task),
        editComment: (comment: CommentOwnership) => canEditComment(userId, comment),
        deleteComment: (comment: CommentOwnership) => canDeleteComment(role, userId, comment),
        deleteAttachment: (attachment: AttachmentOwnership) =>
            canDeleteAttachment(role, userId, attachment),
    };
}

export type ProjectPermissions = ReturnType<typeof bindPermissions>;
