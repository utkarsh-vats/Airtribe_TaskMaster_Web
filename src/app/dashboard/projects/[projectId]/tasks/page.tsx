import { Suspense } from 'react';

import { TaskListSkeleton, TaskListView } from '@/features/tasks/components/TaskListView';

// The title is set by ProjectShell (project name).
export default function ProjectTasksPage() {
    return (
        // TaskListView reads ?page / ?task; useSearchParams needs a Suspense boundary.
        <Suspense fallback={<TaskListSkeleton />}>
            <TaskListView />
        </Suspense>
    );
}
