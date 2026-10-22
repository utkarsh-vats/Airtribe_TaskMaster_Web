'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api, unwrapPage } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';

export const TASKS_PAGE_SIZE = 25;

type TaskPage = { page?: number; limit?: number };

/**
 * A project's tasks (GET /projects/{id}/tasks) in the API's default order. While another page
 * loads, the previous one stays on screen.
 */
export function useTasks(projectId: string, { page, limit = TASKS_PAGE_SIZE }: TaskPage = {}) {
    const filters = { page, limit };
    return useQuery({
        queryKey: queryKeys.tasks.list(projectId, filters),
        queryFn: ({ signal }) =>
            unwrapPage(
                api.GET('/api/v1/projects/{projectId}/tasks', {
                    params: { path: { projectId }, query: filters },
                    signal,
                }),
            ),
        placeholderData: keepPreviousData,
    });
}
