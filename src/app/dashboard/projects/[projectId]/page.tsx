import { redirect } from 'next/navigation';

export default async function ProjectPage({
    params,
}: PageProps<'/dashboard/projects/[projectId]'>) {
    const { projectId } = await params;
    redirect(`/dashboard/projects/${projectId}/tasks`);
}
