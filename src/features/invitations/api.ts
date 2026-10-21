'use client';

import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';
import type { MyInvitation } from '@/lib/api/types';
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
