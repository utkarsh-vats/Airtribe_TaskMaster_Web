'use client';

import { Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useState } from 'react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { errorMessage } from '@/lib/api/messages';
import { pageParam, useUrlWith } from '@/lib/hooks/useUrlWith';

import { useProjects } from '../api';
import { NewProjectDialog } from './NewProjectDialog';
import { ProjectCard } from './ProjectCard';

export const PROJECTS_PAGE_SIZE = 24;

const GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';

/** /dashboard/projects: card grid, pagination via ?page, New project (button or ?new=1). */
export function ProjectsView() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const page = pageParam(searchParams.get('page'));
    const projects = useProjects({ page, limit: PROJECTS_PAGE_SIZE });

    const [dialogOpen, setDialogOpen] = useState(false);
    const openFromUrl = searchParams.get('new') === '1';

    const urlWith = useUrlWith();

    const setDialog = (open: boolean) => {
        setDialogOpen(open);
        // Closing drops ?new=1 without a history entry, so Back doesn't reopen it.
        if (!open && openFromUrl) router.replace(urlWith({ new: null }), { scroll: false });
    };

    const newProjectButton = (
        <Button variant="primary" onClick={() => setDialog(true)}>
            <Plus aria-hidden size={14} />
            New project
        </Button>
    );

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0">Projects</h2>
                {newProjectButton}
            </div>

            {projects.isPending ? (
                <ProjectsSkeleton />
            ) : projects.isError ? (
                <ErrorState
                    title="Couldn't load projects"
                    message={errorMessage(projects.error)}
                    retrying={projects.isRefetching}
                    onRetry={() => void projects.refetch()}
                />
            ) : projects.data.items.length === 0 ? (
                page > 1 ? (
                    <EmptyState
                        title="Nothing on this page"
                        body="There are fewer projects than that."
                        action={<ButtonLink href={pathname}>Go to the first page</ButtonLink>}
                    />
                ) : (
                    <EmptyState
                        title="No projects yet"
                        body="Create one, or check your invitations."
                        action={
                            <div className="flex flex-wrap gap-2">
                                {newProjectButton}
                                <ButtonLink href="/dashboard/invitations">
                                    View invitations
                                </ButtonLink>
                            </div>
                        }
                    />
                )
            ) : (
                <>
                    <ul
                        aria-label="Projects"
                        aria-busy={projects.isPlaceholderData || undefined}
                        className={`${GRID} m-0 list-none p-0 transition-opacity ${projects.isPlaceholderData ? 'opacity-60' : ''}`}
                    >
                        {projects.data.items.map((project) => (
                            <li key={project.id} className="flex">
                                <ProjectCard project={project} />
                            </li>
                        ))}
                    </ul>
                    <Pagination
                        page={page}
                        totalPages={projects.data.meta.totalPages}
                        onPageChange={(next) =>
                            router.push(urlWith({ page: next === 1 ? null : String(next) }))
                        }
                    />
                </>
            )}

            <NewProjectDialog open={dialogOpen || openFromUrl} onOpenChange={setDialog} />
        </div>
    );
}

export function ProjectsSkeleton() {
    return (
        <div aria-busy="true" className={GRID}>
            <span className="sr-only">Loading projects…</span>
            {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="card elev-sm min-h-[148px]">
                    <Skeleton width="60%" height={18} />
                    <Skeleton width="90%" />
                    <Skeleton width="70%" />
                    <Skeleton width="45%" className="mt-auto" />
                </div>
            ))}
        </div>
    );
}
