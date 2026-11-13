'use client';

import { createContext, useContext, useMemo } from 'react';

import type { ProjectDetail, ProjectRole } from '@/lib/api/types';

import { bindPermissions, type ProjectPermissions } from './permissions';
import { useSession } from '@/lib/auth/SessionProvider';

export type ProjectContextValue = {
    project: ProjectDetail;
    myRole: ProjectRole;
    /** DESIGN.md §8 checks, bound to the signed-in user and their role here. */
    can: ProjectPermissions;
};

export const ProjectContext = createContext<ProjectContextValue | null>(null);

/** The current project (anything under /dashboard/projects/[projectId]). */
export function useProjectContext(): ProjectContextValue {
    const value = useContext(ProjectContext);
    if (!value) throw new Error('useProjectContext must be used inside a ProjectContext provider');
    return value;
}

export function useBoundProjectContext(project: ProjectDetail): ProjectContextValue {
    const { user } = useSession();
    const userId = user?.id ?? '';
    return useMemo(
        () => ({
            project,
            myRole: project.myRole,
            can: bindPermissions(project.myRole, userId),
        }),
        [project, userId],
    );
}
