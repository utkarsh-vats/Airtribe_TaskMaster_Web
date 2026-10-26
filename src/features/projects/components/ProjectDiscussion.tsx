'use client';

import { CommentThread } from '@/features/comments/components/CommentThread';

import { useProjectContext } from '../ProjectContext';

/**
 * The project's Discussion tab (DESIGN.md §4, §6): the project-level comment thread
 * (taskId=none) at a reading width. The title is set by ProjectShell.
 */
export function ProjectDiscussion() {
    const { project } = useProjectContext();
    return (
        <CommentThread
            projectId={project.id}
            taskId={null}
            heading="Discussion"
            emptyText="No discussion yet — start the conversation."
            placeholder="Write to the whole project"
            className="w-full max-w-[760px]"
        />
    );
}
