'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import type { Invitation, MyInvitation } from '@/lib/api/types';
import { queryKeys } from '@/lib/query/keys';

/** Invitations sent to me (GET /users/me/invitations — not paginated). */
export function useMyInvitations<T = MyInvitation[]>(select?: (data: MyInvitation[]) => T) {
    return useQuery({
        queryKey: queryKeys.invitations.mine(),
        queryFn: ({ signal }) => unwrap(api.GET('/api/v1/users/me/invitations', { signal })),
        select,
    });
}

/** Still actionable: pending and not past its expiry (the API may not have flipped it yet). */
export const isPendingInvitation = (invitation: MyInvitation, now = Date.now()) =>
    invitation.status === 'PENDING' && Date.parse(invitation.expiresAt) > now;

/** Number of pending invitations, for the sidebar badge. */
export function useMyInvitationsCount() {
    return useMyInvitations(
        (list) => list.filter((invitation) => isPendingInvitation(invitation)).length,
    );
}

// ── a project's invitations (ADMIN+) ───────────────────────────────────────────────────

export const PROJECT_INVITATIONS_LIMIT = 50;
const STATUSES = ['PENDING', 'EXPIRED'] as const;

/**
 * The project's open invitations for the Members tab: PENDING and EXPIRED (still worth an
 * "Invite again"), newest first. The API filters one status at a time — and reports a lapsed
 * PENDING invitation as EXPIRED — so it's two requests, 50 each. `enabled` false for anyone
 * who can't manage members (the API would answer 403).
 */
export function useProjectInvitations(projectId: string, enabled = true) {
    return useQueries({
        queries: STATUSES.map((status) => ({
            queryKey: queryKeys.invitations.project(projectId, {
                status,
                limit: PROJECT_INVITATIONS_LIMIT,
            }),
            queryFn: ({ signal }: { signal: AbortSignal }) =>
                unwrapPage(
                    api.GET('/api/v1/projects/{projectId}/invitations', {
                        params: {
                            path: { projectId },
                            query: { status, limit: PROJECT_INVITATIONS_LIMIT },
                        },
                        signal,
                    }),
                ),
            enabled,
        })),
        combine: (results) => {
            const error = results.find((result) => result.isError)?.error ?? null;
            const pages = results.map((result) => result.data);
            const loaded = pages.every((page) => page !== undefined);
            const data: Invitation[] | undefined = loaded
                ? pages
                      .flatMap((page) => page?.items ?? [])
                      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                : undefined;
            return {
                data,
                error,
                isPending: !error && !loaded,
                isRefetching: results.some((result) => result.isRefetching),
                refetch: () => Promise.all(results.map((result) => result.refetch())),
            };
        },
    });
}

export type NewInvitation = { email: string; role: Invitation['role'] };

/**
 * POST /projects/{pid}/invitations ({ email, role }), ADMIN+ (role ADMIN: OWNER only). On
 * success the project's invitation lists are refetched. Errors are left to the caller: the
 * form puts a 409 under the email, "Invite again" toasts it.
 */
export function useCreateInvitation(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (invitation: NewInvitation) =>
            unwrap(
                api.POST('/api/v1/projects/{projectId}/invitations', {
                    params: { path: { projectId } },
                    body: invitation,
                }),
            ),
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: queryKeys.invitations.projectAll(projectId),
            }),
    });
}

/**
 * DELETE /projects/{pid}/invitations/{id}: revoke a PENDING invitation, ADMIN+. The lists are
 * refetched afterwards — also after a failure, which usually means it changed meanwhile (409:
 * no longer pending; 404: gone). Errors are left to the caller.
 */
export function useRevokeInvitation(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (invitation: Invitation) =>
            unwrap(
                api.DELETE('/api/v1/projects/{projectId}/invitations/{invitationId}', {
                    params: { path: { projectId, invitationId: invitation.id } },
                }),
            ),
        onSettled: () =>
            queryClient.invalidateQueries({
                queryKey: queryKeys.invitations.projectAll(projectId),
            }),
    });
}
