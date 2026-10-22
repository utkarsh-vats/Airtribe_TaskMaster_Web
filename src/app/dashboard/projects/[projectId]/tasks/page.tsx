import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tasks' };

// Placeholder — the project layout, tabs and task list come in steps 5d and 6.
export default async function ProjectTasksPage({
    params,
}: PageProps<'/dashboard/projects/[projectId]/tasks'>) {
    const { projectId } = await params;
    return <h2 className="m-0 break-all">Project {projectId}</h2>;
}
