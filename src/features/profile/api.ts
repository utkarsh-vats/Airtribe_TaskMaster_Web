'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';
import type { User } from '@/lib/api/types';
import { sessionStore } from '@/lib/auth/store';
import { queryKeys } from '@/lib/query/keys';

import type { ProfileFormValues } from './schemas';

/**
 * GET /users/me. Each fetch also refreshes the session's copy of the user, which the header's
 * avatar and ProfileMenu read — so another tab's profile change shows here on the next
 * refetch (window focus), with no broadcast of its own.
 */
export function useMe() {
    return useQuery({
        queryKey: queryKeys.me(),
        queryFn: async ({ signal }) => {
            const user = await unwrap(api.GET('/api/v1/users/me', { signal }));
            sessionStore.setUser(user);
            return user;
        },
    });
}

/**
 * PATCH /users/me with the changed fields. On success the saved user replaces the me query
 * and the session's user at once (header avatar, ProfileMenu name). Names shown elsewhere
 * (comment authors, assignees) come from the server per request and aren't patched.
 */
export function useUpdateProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<ProfileFormValues>) =>
            unwrap(api.PATCH('/api/v1/users/me', { body })),
        onSuccess: (user: User) => {
            queryClient.setQueryData(queryKeys.me(), user);
            sessionStore.setUser(user);
        },
    });
}

/**
 * PATCH /users/me/password. The API ends every session on success (it revokes all refresh
 * tokens), so the caller signs this tab out. A wrong current password is a 400
 * INVALID_CURRENT_PASSWORD — not a 401, so the client's session handling never sees it.
 */
export function useChangePassword() {
    return useMutation({
        mutationFn: (body: { currentPassword: string; newPassword: string }) =>
            unwrap(api.PATCH('/api/v1/users/me/password', { body })),
    });
}
