import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ProjectsSkeleton, ProjectsView } from '@/features/projects/components/ProjectsView';

export const metadata: Metadata = { title: 'Projects' };

export default function ProjectsPage() {
    return (
        // ProjectsView reads ?page and ?new; useSearchParams needs a Suspense boundary here.
        <Suspense fallback={<ProjectsSkeleton />}>
            <ProjectsView />
        </Suspense>
    );
}
