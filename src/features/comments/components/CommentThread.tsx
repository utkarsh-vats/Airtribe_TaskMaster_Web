'use client';

import { clsx } from 'clsx';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProject } from '@/features/projects/api';
import { bindPermissions } from '@/features/projects/permissions';
import { errorMessage } from '@/lib/api/messages';
import { useSession } from '@/lib/auth/SessionProvider';
import { queryView } from '@/lib/query/view';

import { useComments } from '../api';
import { CommentComposer } from './CommentComposer';
import { CommentItem } from './CommentItem';

/**
 * A comment thread (DESIGN.md §6) for a task, or the project-level one (`taskId` null): "Comments"
 * + count, the comments oldest first with "Load more" for the next page, then the composer —
 * any member can comment. Used by the task panel and the project's Discussion tab (heading,
 * empty text and placeholder of its own).
 */
export function CommentThread({
    projectId,
    taskId,
    heading = 'Comments',
    count,
    emptyText = 'No comments yet.',
    placeholder,
    className,
}: {
    projectId: string;
    taskId: string | null;
    /** The section's heading ("Discussion" on the project's tab). */
    heading?: string;
    /**
     * The count to show: the task's commentCount (null while it isn't known yet, e.g. the panel is
     * still showing the list row), or the thread's own total when omitted.
     */
    count?: number | null;
    /** Shown when there are no comments. */
    emptyText?: string;
    /** The composer's placeholder (default "Write a comment"). */
    placeholder?: string;
    className?: string;
}) {
    const thread = useComments(projectId, taskId ?? 'none');
    const headingId = useId();
    // From the cached project + the signed-in user, like the task panel (works outside
    // ProjectContext). No actions until both are known.
    const project = useProject(projectId);
    const { user } = useSession();
    const can = project.data && user ? bindPermissions(project.data.myRole, user.id) : null;
    // One comment in edit mode at a time.
    const [editingId, setEditingId] = useState<string | null>(null);
    const shown = count === undefined ? thread.data?.pages[0]?.meta.total : count;

    let body;
    const view = queryView(thread);
    if (view.status === 'loading') {
        body = (
            <div aria-busy="true" className="flex flex-col gap-3">
                <span className="sr-only">Loading comments…</span>
                {Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="grid grid-cols-[28px_1fr] gap-3">
                        <Skeleton width={28} height={28} />
                        <div className="flex flex-col gap-1">
                            <Skeleton width="40%" height={12} />
                            <Skeleton width="85%" height={14} />
                        </div>
                    </div>
                ))}
            </div>
        );
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                compact
                title="Couldn't load comments"
                message={errorMessage(view.error)}
                retrying={thread.isRefetching}
                onRetry={() => void thread.refetch()}
            />
        );
    } else {
        const comments = view.data.pages.flatMap((page) => page.items);
        body = comments.length ? (
            <>
                <ol aria-labelledby={headingId} className="m-0 flex list-none flex-col gap-3 p-0">
                    {comments.map((comment) => (
                        <CommentItem
                            key={comment.id}
                            projectId={projectId}
                            comment={comment}
                            canEdit={can?.editComment(comment) ?? false}
                            canDelete={can?.deleteComment(comment) ?? false}
                            editing={editingId === comment.id}
                            onEditingChange={(editing) =>
                                setEditingId((current) =>
                                    editing ? comment.id : current === comment.id ? null : current,
                                )
                            }
                        />
                    ))}
                </ol>
                {thread.hasNextPage && (
                    <Button
                        variant="secondary"
                        size="sm"
                        className="self-start"
                        loading={thread.isFetchingNextPage}
                        onClick={() => void thread.fetchNextPage()}
                    >
                        Load more
                    </Button>
                )}
            </>
        ) : (
            <p className="text-muted m-0 text-sm">{emptyText}</p>
        );
    }

    return (
        <section aria-labelledby={headingId} className={clsx('flex flex-col gap-3', className)}>
            <div className="flex items-baseline gap-2">
                <h5 id={headingId} className="m-0">
                    {heading}
                </h5>
                {shown != null && (
                    <span className="text-muted text-[12px]" data-testid="comment-count">
                        {shown}
                    </span>
                )}
            </div>
            {body}
            <CommentComposer projectId={projectId} taskId={taskId} placeholder={placeholder} />
        </section>
    );
}
