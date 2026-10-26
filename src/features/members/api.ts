'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { api, unwrap } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';
import type { Member, ProjectRole } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';
import { queryKeys } from '@/lib/query/keys';

export const MEMBER_GONE_MESSAGE = 'That person is no longer a member.';

/** A project's members (GET /projects/{id}/members — not paginated). Shared by filters, the task panel and the Members tab. */
export function useProjectMembers(projectId: string) {
    return useQuery({
        queryKey: queryKeys.members.list(projectId),
        queryFn: ({ signal }) =>
            unwrap(
                api.GET('/api/v1/projects/{projectId}/members', {
                    params: { path: { projectId } },
                    signal,
                }),
            ),
        staleTime: 5 * 60_000,
    });
}

/** A 404 from a member endpoint: that person (or you) isn't a member any more. */
export const isMemberGone = (error: unknown) => isApiError(error) && error.status === 404;

/**
 * How a failed member change is reported (DESIGN.md §8): a 409 toasts the API's message (it
 * says what conflicted); a 404 refetches the members and toasts "That person is no longer a
 * member."; anything else the usual error toast.
 */
export function reportMemberError(queryClient: QueryClient, projectId: string, error: unknown) {
    if (isApiError(error) && error.status === 409) {
        toast.error(error.message);
    } else if (isMemberGone(error)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.members.list(projectId) });
        toast.error(MEMBER_GONE_MESSAGE);
    } else {
        notifyError(error);
    }
}

export type RoleChange = { member: Member; role: ProjectRole };

/**
 * PATCH /projects/{pid}/members/{userId} ({ role }), OWNER only. The API answers with the
 * whole member list, which goes straight into the members cache. Role OWNER is a transfer:
 * the caller becomes an ADMIN, so the project (myRole, owner) and the projects list are
 * refetched too. Errors are reported (reportMemberError) and rethrown.
 */
export function useChangeRole(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ member, role }: RoleChange) =>
            unwrap(
                api.PATCH('/api/v1/projects/{projectId}/members/{userId}', {
                    params: { path: { projectId, userId: member.user.id } },
                    body: { role },
                }),
            ),
        onSuccess: (members, { role }) => {
            queryClient.setQueryData(queryKeys.members.list(projectId), members);
            if (role === 'OWNER') {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.projects.detail(projectId),
                });
                void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() });
            }
        },
        onError: (error) => reportMemberError(queryClient, projectId, error),
    });
}

/**
 * DELETE /projects/{pid}/members/{userId}: removing someone (ADMIN+, §8), or leaving (your own
 * id). After a removal the members, the project (memberCount), its tasks (the person's open
 * tasks were unassigned) and the projects list are refetched. After leaving — see leftProject
 * — it goes to /dashboard/projects and forgets the project. Errors are left to the caller: a
 * leave and a removal report them differently.
 */
export function useRemoveMember(projectId: string) {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { user } = useSession();

    return useMutation({
        mutationFn: (userId: string) =>
            unwrap(
                api.DELETE('/api/v1/projects/{projectId}/members/{userId}', {
                    params: { path: { projectId, userId } },
                }),
            ),
        onSuccess: (_, userId) => {
            if (userId === user?.id) leftProject(queryClient, router, projectId);
            else invalidateAfterRemoval(queryClient, projectId);
        },
    });
}

/**
 * You're no longer in the project (left, or a 404 when leaving): to the projects page, the
 * sidebar's list refetched, the project's cache dropped. Nothing of the project is refetched
 * on the way out — it would only 404.
 */
export function leftProject(
    queryClient: QueryClient,
    router: { push: (href: string) => void },
    projectId: string,
) {
    router.push('/dashboard/projects');
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() });
    forgetProjectWhenUnused(queryClient, projectId);
}

function invalidateAfterRemoval(queryClient: QueryClient, projectId: string) {
    for (const queryKey of [
        queryKeys.members.list(projectId),
        queryKeys.projects.detail(projectId),
        queryKeys.tasks.all(projectId),
        queryKeys.projects.lists(),
    ]) {
        void queryClient.invalidateQueries({ queryKey });
    }
}

/** Every cache entry that belongs to one project. */
const projectKeys = (projectId: string) => [
    queryKeys.projects.detail(projectId),
    queryKeys.tasks.all(projectId),
    queryKeys.comments.all(projectId),
    queryKeys.attachments.all(projectId),
    queryKeys.members.list(projectId),
    queryKeys.invitations.projectAll(projectId),
];

/**
 * After leaving: drop everything cached for the project once its pages have unmounted (the
 * project detail has no observer left). Removing it while it's still on screen would make
 * those pages refetch — and show "Project not found" — on their way out.
 */
export function forgetProjectWhenUnused(queryClient: QueryClient, projectId: string) {
    const cache = queryClient.getQueryCache();
    const forget = () => {
        for (const queryKey of projectKeys(projectId)) queryClient.removeQueries({ queryKey });
    };
    const detail = cache.find({ queryKey: queryKeys.projects.detail(projectId), exact: true });
    if (!detail || detail.getObserversCount() === 0) return forget();

    const unsubscribe = cache.subscribe((event) => {
        if (
            event.type === 'observerRemoved' &&
            event.query === detail &&
            detail.getObserversCount() === 0
        ) {
            unsubscribe();
            forget();
        }
    });
}
