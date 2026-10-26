'use client';

import { AttachmentList } from '@/features/attachments/components/AttachmentList';

import { useProjectContext } from '../ProjectContext';

/**
 * The project's Files tab (DESIGN.md §4, §6): the project-level attachments (taskId=none) at a
 * reading width — upload, drop, download and delete as in the task panel. The title is set by
 * ProjectShell.
 */
export function ProjectFiles() {
    const { project } = useProjectContext();
    return (
        <AttachmentList
            projectId={project.id}
            taskId={null}
            heading="Files"
            emptyText="No project files yet. Upload one, or drop it here."
            className="w-full max-w-[760px]"
        />
    );
}
