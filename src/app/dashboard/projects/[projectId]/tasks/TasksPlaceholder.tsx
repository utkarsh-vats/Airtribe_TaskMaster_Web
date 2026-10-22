'use client';

import { useProjectContext } from '@/features/projects/ProjectContext';

/** Proves the tab pages get the project from context (replaced in step 6a). */
export function TasksPlaceholder() {
    const { project, myRole, can } = useProjectContext();
    return (
        <div className="flex flex-col gap-1">
            <h3 className="m-0">Tasks</h3>
            <p className="text-muted m-0 text-sm">
                {project.name} · {project.memberCount}{' '}
                {project.memberCount === 1 ? 'member' : 'members'} · you are {myRole.toLowerCase()}
                {can.editProject ? ' (can edit the project)' : ''}
            </p>
        </div>
    );
}
