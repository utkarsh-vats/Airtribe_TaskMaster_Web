'use client';

import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';

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
