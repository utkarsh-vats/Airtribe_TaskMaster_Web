'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';

/** The API's page-size ceiling: the sidebar shows up to this many projects. */
export const SIDEBAR_PROJECT_LIMIT = 100;

type ProjectPage = { page?: number; limit?: number };

/**
 * My projects (GET /projects), in the order the API returns them. Defaults to the sidebar's
 * first 100. While another page loads, the previous page stays on screen.
 */
export function useProjects({ page, limit = SIDEBAR_PROJECT_LIMIT }: ProjectPage = {}) {
    const filters = { page, limit };
    return useQuery({
        queryKey: queryKeys.projects.list(filters),
        queryFn: ({ signal }) =>
            unwrapPage(api.GET('/api/v1/projects', { params: { query: filters }, signal })),
        placeholderData: keepPreviousData,
    });
}

/** One project with my role and its owner (GET /projects/{id}). 404 = missing or not a member. */
export function useProject(projectId: string) {
    return useQuery({
        queryKey: queryKeys.projects.detail(projectId),
        queryFn: ({ signal }) =>
            unwrap(
                api.GET('/api/v1/projects/{projectId}', {
                    params: { path: { projectId } },
                    signal,
                }),
            ),
    });
}

export type CreateProjectInput = { name: string; description?: string | undefined };

/** POST /projects (the caller becomes OWNER). Refreshes every projects list — sidebar too. */
export function useCreateProject() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: CreateProjectInput) => unwrap(api.POST('/api/v1/projects', { body })),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() }),
    });
}
