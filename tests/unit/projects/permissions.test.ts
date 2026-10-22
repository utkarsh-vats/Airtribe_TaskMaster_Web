import { describe, expect, it } from 'vitest';

import {
    bindPermissions,
    canChangeRoles,
    canDeleteAttachment,
    canDeleteComment,
    canDeleteProject,
    canDeleteTask,
    canEditComment,
    canEditProject,
    canEditTask,
    canInviteAdmin,
    canLeave,
    canManageMembers,
    canRemoveMember,
    canTransferOwnership,
} from '@/features/projects/permissions';
import type { ProjectRole } from '@/lib/api/types';

const ROLES: ProjectRole[] = ['OWNER', 'ADMIN', 'MEMBER'];
const ME = 'me';
const OTHER = 'someone-else';

/** Expect `check(role)` to be true exactly for `allowed`. */
function byRole(check: (role: ProjectRole) => boolean, allowed: ProjectRole[]) {
    expect(Object.fromEntries(ROLES.map((role) => [role, check(role)]))).toEqual(
        Object.fromEntries(ROLES.map((role) => [role, allowed.includes(role)])),
    );
}

describe('project and member permissions (DESIGN.md §8)', () => {
    it('edit project / manage members: ADMIN+', () => {
        byRole(canEditProject, ['OWNER', 'ADMIN']);
        byRole(canManageMembers, ['OWNER', 'ADMIN']);
    });

    it('delete project, change roles, transfer ownership, invite as admin: OWNER only', () => {
        byRole(canDeleteProject, ['OWNER']);
        byRole(canChangeRoles, ['OWNER']);
        byRole(canTransferOwnership, ['OWNER']);
        byRole(canInviteAdmin, ['OWNER']);
    });

    it('leave: everyone but the OWNER', () => {
        byRole(canLeave, ['ADMIN', 'MEMBER']);
    });

    it.each<[ProjectRole, ProjectRole, boolean]>([
        ['OWNER', 'MEMBER', true],
        ['OWNER', 'ADMIN', true],
        ['OWNER', 'OWNER', false],
        ['ADMIN', 'MEMBER', true],
        ['ADMIN', 'ADMIN', false],
        ['ADMIN', 'OWNER', false],
        ['MEMBER', 'MEMBER', false],
        ['MEMBER', 'ADMIN', false],
        ['MEMBER', 'OWNER', false],
    ])('%s removing a %s → %s', (caller, target, expected) => {
        expect(canRemoveMember(caller, target, false)).toBe(expected);
    });

    it('nobody "removes" themselves (that is leaving)', () => {
        for (const role of ROLES) expect(canRemoveMember(role, role, true)).toBe(false);
        expect(canRemoveMember('OWNER', 'MEMBER', true)).toBe(false);
    });
});

describe('task permissions', () => {
    const task = (createdBy: string, assignee: string | null) => ({
        createdBy: { id: createdBy },
        assignee: assignee ? { id: assignee } : null,
    });

    it('edit: creator, assignee or ADMIN+', () => {
        expect(canEditTask('MEMBER', ME, task(ME, null))).toBe(true);
        expect(canEditTask('MEMBER', ME, task(OTHER, ME))).toBe(true);
        expect(canEditTask('MEMBER', ME, task(OTHER, OTHER))).toBe(false);
        expect(canEditTask('MEMBER', ME, task(OTHER, null))).toBe(false);
        expect(canEditTask('ADMIN', ME, task(OTHER, OTHER))).toBe(true);
        expect(canEditTask('OWNER', ME, task(OTHER, null))).toBe(true);
    });

    it('delete: creator or ADMIN+, not the assignee', () => {
        expect(canDeleteTask('MEMBER', ME, task(ME, OTHER))).toBe(true);
        expect(canDeleteTask('MEMBER', ME, task(OTHER, ME))).toBe(false);
        expect(canDeleteTask('ADMIN', ME, task(OTHER, OTHER))).toBe(true);
        expect(canDeleteTask('OWNER', ME, task(OTHER, null))).toBe(true);
    });
});

describe('comment and attachment permissions', () => {
    it('edit comment: author only, whatever the role', () => {
        expect(canEditComment(ME, { authorId: ME })).toBe(true);
        expect(canEditComment(ME, { authorId: OTHER })).toBe(false);
    });

    it('delete comment: author or ADMIN+', () => {
        expect(canDeleteComment('MEMBER', ME, { authorId: ME })).toBe(true);
        expect(canDeleteComment('MEMBER', ME, { authorId: OTHER })).toBe(false);
        expect(canDeleteComment('ADMIN', ME, { authorId: OTHER })).toBe(true);
        expect(canDeleteComment('OWNER', ME, { authorId: OTHER })).toBe(true);
    });

    it('delete attachment: uploader or ADMIN+', () => {
        expect(canDeleteAttachment('MEMBER', ME, { uploadedBy: { id: ME } })).toBe(true);
        expect(canDeleteAttachment('MEMBER', ME, { uploadedBy: { id: OTHER } })).toBe(false);
        expect(canDeleteAttachment('ADMIN', ME, { uploadedBy: { id: OTHER } })).toBe(true);
    });
});

describe('bindPermissions', () => {
    it('applies the role and user id to every check', () => {
        const admin = bindPermissions('ADMIN', ME);

        expect(admin).toMatchObject({
            editProject: true,
            deleteProject: false,
            leave: true,
            manageMembers: true,
            changeRoles: false,
            transferOwnership: false,
            inviteAdmin: false,
        });
        expect(admin.removeMember('MEMBER', OTHER)).toBe(true);
        expect(admin.removeMember('ADMIN', OTHER)).toBe(false);
        expect(admin.removeMember('ADMIN', ME)).toBe(false);
        expect(admin.editComment({ authorId: OTHER })).toBe(false);
        expect(admin.deleteComment({ authorId: OTHER })).toBe(true);

        const member = bindPermissions('MEMBER', ME);
        const mine = { createdBy: { id: ME }, assignee: null };
        const assigned = { createdBy: { id: OTHER }, assignee: { id: ME } };
        expect(member.editTask(assigned)).toBe(true);
        expect(member.deleteTask(assigned)).toBe(false);
        expect(member.deleteTask(mine)).toBe(true);
        expect(member.deleteAttachment({ uploadedBy: { id: OTHER } })).toBe(false);
    });
});
