// Type-level checks for unwrap / unwrapPage, enforced by `npm run typecheck`. The request
// functions are never called — only their inferred return types are inspected.
import { describe, expectTypeOf, it } from 'vitest';

import { api, unwrap, unwrapPage } from '@/lib/api/client';
import type {
    NotificationPageMeta,
    PageMeta,
    ProjectDetail,
    TaskListItem,
    User,
} from '@/lib/api/types';

const params = { path: { projectId: 'p' } };

describe('client result types', () => {
    it('unwrap returns the envelope payload, or undefined for 204', () => {
        const getMe = () => unwrap(api.GET('/api/v1/users/me'));
        const getProject = () => unwrap(api.GET('/api/v1/projects/{projectId}', { params }));
        const deleteProject = () => unwrap(api.DELETE('/api/v1/projects/{projectId}', { params }));

        expectTypeOf(getMe).returns.toEqualTypeOf<Promise<User>>();
        expectTypeOf(getProject).returns.toEqualTypeOf<Promise<ProjectDetail>>();
        expectTypeOf(deleteProject).returns.toEqualTypeOf<Promise<undefined>>();
    });

    it('unwrapPage returns typed items and meta', () => {
        const listTasks = () =>
            unwrapPage(api.GET('/api/v1/projects/{projectId}/tasks', { params }));
        const listNotifications = () => unwrapPage(api.GET('/api/v1/notifications'));

        expectTypeOf(listTasks).returns.resolves.toEqualTypeOf<{
            items: TaskListItem[];
            meta: PageMeta;
        }>();
        expectTypeOf(listNotifications)
            .returns.resolves.toHaveProperty('meta')
            .toEqualTypeOf<NotificationPageMeta>();
    });

    it('unwrapPage rejects endpoints that are not paginated', () => {
        // @ts-expect-error — GET /users/me has no `meta`.
        const notAList = () => unwrapPage(api.GET('/api/v1/users/me'));
        expectTypeOf(notAList).toBeFunction();
    });
});
