import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MyTasksView } from '@/features/tasks/components/MyTasksView';
import { TaskListSkeleton } from '@/features/tasks/components/TaskListView';

export const metadata: Metadata = { title: 'My tasks' };

export default function MyTasksPage() {
    return (
        <Suspense fallback={<TaskListSkeleton />}>
            <MyTasksView />
        </Suspense>
    );
}
