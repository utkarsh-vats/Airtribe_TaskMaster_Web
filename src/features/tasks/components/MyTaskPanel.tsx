'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useUrlWith } from '@/lib/hooks/useUrlWith';
import { TaskPanel } from './TaskPanel';

/**
 * My tasks' task panel: ?task + ?project open it. TaskPanel loads the project and binds the
 * permissions itself, so no ProjectContext is needed here.
 */
export function MyTaskPanel({ afterDeleteUrl }: { afterDeleteUrl?: string | undefined }) {
    const searchParams = useSearchParams();
    const urlWith = useUrlWith();
    const taskId = searchParams.get('task');
    const projectId = searchParams.get('project');

    // Keep the last project after closing, so the sheet stays mounted and slides out
    // (TaskPanel does the same with lastTaskId).
    const [lastProjectId, setLastProjectId] = useState(projectId);
    if (projectId && projectId !== lastProjectId) setLastProjectId(projectId);

    if (!lastProjectId) return null; // nothing opened yet on this visit

    return (
        <TaskPanel
            projectId={lastProjectId}
            taskId={projectId ? taskId : null}
            afterDeleteUrl={afterDeleteUrl}
            closeUrl={urlWith({ task: null, project: null })}
        />
    );
}