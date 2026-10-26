'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';

import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { NativeSelect } from '@/components/ui/Input';
import { LinkTabs } from '@/components/ui/LinkTabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { RoleTag } from '@/components/ui/Tag';
import { isApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/api/messages';
import type { ProjectDetail } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';

import { useProject, useProjects } from '../api';
import { bindPermissions } from '../permissions';
import { ProjectContext, type ProjectContextValue } from '../ProjectContext';

export const PROJECT_TABS = [
    { segment: 'tasks', label: 'Tasks' },
    { segment: 'discussion', label: 'Discussion' },
    { segment: 'files', label: 'Files' },
    { segment: 'members', label: 'Members' },
    { segment: 'settings', label: 'Settings' },
] as const;

type TabSegment = (typeof PROJECT_TABS)[number]['segment'];

/** Tabs whose page has its own title: "{tab} · {project} · TaskMaster". */
const TAB_TITLES: Partial<Record<TabSegment, string>> = {
    discussion: 'Discussion',
    files: 'Files',
};

/** The tab segment of the current path ("tasks" when there isn't a known one). */
function currentTab(pathname: string, projectId: string): TabSegment {
    const segment = pathname.slice(`/dashboard/projects/${projectId}/`.length).split('/')[0];
    return PROJECT_TABS.find((tab) => tab.segment === segment)?.segment ?? 'tasks';
}

/**
 * Frame for everything under /dashboard/projects/[projectId] (DESIGN.md §6 "Project header"):
 * loads the project, provides ProjectContext, renders the header and tabs. The API answers
 * 404 for a project you're not in (and 422 for a malformed id): both show "Project not found".
 */
export function ProjectShell({ projectId, children }: { projectId: string; children: ReactNode }) {
    const project = useProject(projectId);

    if (project.isPending) return <ProjectHeaderSkeleton />;

    if (project.isError) {
        const status = isApiError(project.error) ? project.error.status : 0;
        if (status === 404 || status === 422) return <ProjectNotFound />;
        return (
            <ErrorState
                title="Couldn't load this project"
                message={errorMessage(project.error)}
                retrying={project.isRefetching}
                onRetry={() => void project.refetch()}
            />
        );
    }

    return <LoadedProject project={project.data}>{children}</LoadedProject>;
}

function LoadedProject({ project, children }: { project: ProjectDetail; children: ReactNode }) {
    const { user } = useSession();
    const userId = user?.id ?? '';
    const tabTitle = TAB_TITLES[currentTab(usePathname(), project.id)];

    const context = useMemo<ProjectContextValue>(
        () => ({
            project,
            myRole: project.myRole,
            can: bindPermissions(project.myRole, userId),
        }),
        [project, userId],
    );

    const base = `/dashboard/projects/${project.id}`;

    return (
        <ProjectContext value={context}>
            {/* React 19 hoists this into <head>; the layout opts out of Next's title. */}
            <title>
                {tabTitle
                    ? `${tabTitle} · ${project.name} · TaskMaster`
                    : `${project.name} · TaskMaster`}
            </title>
            <div className="flex flex-col gap-4">
                <header className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="card-kicker text-accent-700">Project</span>
                        <RoleTag role={project.myRole} />
                    </div>
                    <h2 className="m-0 hidden break-words md:block">{project.name}</h2>
                    <ProjectSwitcher current={project} />
                    {project.description && (
                        <p className="text-muted m-0 max-w-[70ch] [text-wrap:pretty]">
                            {project.description}
                        </p>
                    )}
                    <LinkTabs
                        aria-label="Project sections"
                        className="mt-3"
                        tabs={PROJECT_TABS.map((tab) => ({
                            href: `${base}/${tab.segment}`,
                            label: tab.label,
                        }))}
                    />
                </header>
                {children}
            </div>
        </ProjectContext>
    );
}

/** Below 820px the name is a select of my projects (prototype); choosing one keeps the tab. */
function ProjectSwitcher({ current }: { current: ProjectDetail }) {
    const router = useRouter();
    const pathname = usePathname();
    const projects = useProjects();
    const others = projects.data?.items ?? [];
    // The current project is always an option, even beyond the first 100 or before loading.
    const options = others.some((p) => p.id === current.id)
        ? others
        : [{ id: current.id, name: current.name }, ...others];

    return (
        <Field label={<span className="sr-only">Switch project</span>} className="md:hidden">
            <NativeSelect
                value={current.id}
                onChange={(event) => {
                    const tab = currentTab(pathname, current.id);
                    router.push(`/dashboard/projects/${event.target.value}/${tab}`);
                }}
                className="text-[18px] font-extrabold"
            >
                {options.map((option) => (
                    <option key={option.id} value={option.id}>
                        {option.name}
                    </option>
                ))}
            </NativeSelect>
        </Field>
    );
}

function ProjectHeaderSkeleton() {
    return (
        <div aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">Loading project…</span>
            <Skeleton width={120} height={14} />
            <Skeleton width="40%" height={32} />
            <Skeleton width="60%" />
            <Skeleton height={36} className="mt-3" />
        </div>
    );
}

export function ProjectNotFound() {
    return (
        <>
            <title>Project not found · TaskMaster</title>
            <EmptyState
                title="Project not found"
                body="It doesn't exist, or you're not a member of it."
                action={<ButtonLink href="/dashboard/projects">Go to your projects</ButtonLink>}
            />
        </>
    );
}
