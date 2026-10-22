'use client';

import { createContext, useContext } from 'react';

import type { ProjectDetail, ProjectRole } from '@/lib/api/types';

import type { ProjectPermissions } from './permissions';

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
    if (!value) throw new Error('useProjectContext must be used inside ProjectShell');
    return value;
}
