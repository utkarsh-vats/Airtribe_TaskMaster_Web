'use client';

import { useQuery } from '@tanstack/react-query';

import { api, unwrapPage } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';

/** The API's page-size ceiling: the sidebar shows up to this many projects. */
export const SIDEBAR_PROJECT_LIMIT = 100;

/** My projects (GET /projects?limit=100), in the order the API returns them. */
export function useProjects() {
    const filters = { limit: SIDEBAR_PROJECT_LIMIT };
    return useQuery({
        queryKey: queryKeys.projects.list(filters),
        queryFn: ({ signal }) =>
            unwrapPage(api.GET('/api/v1/projects', { params: { query: filters }, signal })),
    });
}
