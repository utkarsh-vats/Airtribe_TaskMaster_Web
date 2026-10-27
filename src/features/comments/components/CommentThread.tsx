'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProject } from '@/features/projects/api';
import { bindPermissions } from '@/features/projects/permissions';
import { errorMessage } from '@/lib/api/messages';
import { useSession } from '@/lib/auth/SessionProvider';
import { queryView } from '@/lib/query/view';

import { commentKey, isPendingComment, useComments } from '../api';
import { CommentComposer } from './CommentComposer';
import { CommentItem } from './CommentItem';
import { CommentReplies } from './CommentReplies';

/** How many comments show at first, and how many more each "See more" reveals. */
export const TASK_COMMENTS_BATCH = 3;
export const DISCUSSION_BATCH = 10;

/**
 * A comment thread (DESIGN.md §6) for a task, or the project-level one (`taskId` null) — the
 * project's Discussion tab, with a heading, empty text and placeholder of its own. A
 * collapsible section ("task-comments" / "project-discussion") with the top-level comments'
 * total; the composer first (any member can comment), then the comments newest first: a batch
 * (3 for a task, 10 for the project), "See more" for the next — fetching the next, older, page
 * only once the loaded ones run out — and "Show less" back to the first batch.
 */
export function CommentThread({
    projectId,
    taskId,
    heading = 'Comments',
    emptyText = 'No comments yet.',
    placeholder,
    className,
}: {
    projectId: string;
    taskId: string | null;
    /** The section's heading ("Discussion" on the project's tab). */
    heading?: string;
    /** Shown when there are no comments. */
    emptyText?: string;
    /** The composer's placeholder (default "Write a comment"). */
    placeholder?: string;
    className?: string;
}) {
    const thread = useComments(projectId, taskId ?? 'none');
    const headingId = useId();
    const batch = taskId ? TASK_COMMENTS_BATCH : DISCUSSION_BATCH;
    // How many show; kept across posts, edits and deletes.
    const [visibleCount, setVisibleCount] = useState(batch);
    // From the cached project + the signed-in user, like the task panel (works outside
    // ProjectContext). No actions until both are known.
    const project = useProject(projectId);
    const { user } = useSession();
    const can = project.data && user ? bindPermissions(project.data.myRole, user.id) : null;
    // One comment or reply in edit mode at a time, and one reply composer open.
    const [editingId, setEditingId] = useState<string | null>(null);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const setEditing = (commentId: string, editing: boolean) =>
        setEditingId((current) => (editing ? commentId : current === commentId ? null : current));
    // Top-level comments, as the API counts them (the cache keeps it right on post / delete).
    const total = thread.data?.pages[0]?.meta.total;

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
        // Newest first: a comment just posted is the first one, so it's always shown.
        const comments = view.data.pages.flatMap((page) => page.items);
        const visible = comments.slice(0, visibleCount);
        const more = comments.length > visibleCount || thread.hasNextPage;

        const seeMore = () => {
            const next = visibleCount + batch;
            setVisibleCount(next);
            // Only when the loaded ones run out.
            if (comments.length < next && thread.hasNextPage) void thread.fetchNextPage();
        };

        body = comments.length ? (
            <>
                <ol aria-labelledby={headingId} className="m-0 flex list-none flex-col gap-3 p-0">
                    {visible.map((comment) => {
                        const pending = isPendingComment(comment);
                        return (
                            <CommentItem
                                key={commentKey(comment)}
                                projectId={projectId}
                                comment={comment}
                                pending={pending}
                                canEdit={!pending && (can?.editComment(comment) ?? false)}
                                canDelete={!pending && (can?.deleteComment(comment) ?? false)}
                                editing={editingId === comment.id}
                                onEditingChange={(editing) => setEditing(comment.id, editing)}
                            >
                                <CommentReplies
                                    projectId={projectId}
                                    parent={comment}
                                    can={can}
                                    replying={replyingTo === comment.id}
                                    onReplyingChange={(replying) =>
                                        setReplyingTo((current) =>
                                            replying
                                                ? comment.id
                                                : current === comment.id
                                                  ? null
                                                  : current,
                                        )
                                    }
                                    editingId={editingId}
                                    onEditingChange={setEditing}
                                />
                            </CommentItem>
                        );
                    })}
                </ol>
                {(more || visibleCount > batch) && (
                    <div className="flex gap-2">
                        {more && (
                            <Button
                                variant="secondary"
                                size="sm"
                                loading={thread.isFetchingNextPage}
                                onClick={seeMore}
                            >
                                See more
                            </Button>
                        )}
                        {visibleCount > batch && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setVisibleCount(batch)}
                            >
                                Show less
                            </Button>
                        )}
                    </div>
                )}
            </>
        ) : (
            <p className="text-muted m-0 text-sm">{emptyText}</p>
        );
    }

    return (
        <CollapsibleSection
            sectionKey={taskId ? 'task-comments' : 'project-discussion'}
            title={heading}
            titleId={headingId}
            count={total != null ? <span data-testid="comment-count">{total}</span> : undefined}
            className={className}
        >
            <CommentComposer projectId={projectId} taskId={taskId} placeholder={placeholder} />
            {body}
        </CollapsibleSection>
    );
}
