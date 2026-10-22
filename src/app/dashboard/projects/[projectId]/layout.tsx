import type { Metadata } from 'next';

import { ProjectShell } from '@/features/projects/components/ProjectShell';

// No server title here: the name needs the access token, which only the browser has.
// ProjectShell renders the <title> itself ("{name} · TaskMaster").
export const metadata: Metadata = { title: null };

/** Everything under a project: header, tabs and ProjectContext (client-side, needs the token). */
export default async function ProjectLayout({
    params,
    children,
}: LayoutProps<'/dashboard/projects/[projectId]'>) {
    const { projectId } = await params;
    return <ProjectShell projectId={projectId}>{children}</ProjectShell>;
}
