'use client';

import { clsx } from 'clsx';
import { useId } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { errorMessage } from '@/lib/api/messages';
import type { Comment } from '@/lib/api/types';
import { fullDateTime, relativeTime } from '@/lib/format/dates';

import { useComments } from '../api';
import { CommentComposer } from './CommentComposer';

/**
 * A comment thread (DESIGN.md §6) for a task, or the project-level one (`taskId` null): "Comments"
 * + count, the comments oldest first with "Load more" for the next page, then the composer —
 * any member can comment. Used by the task panel and the project's Discussion tab.
 */
export function CommentThread({
    projectId,
    taskId,
    title = 'Comments',
    count,
    className,
}: {
    projectId: string;
    taskId: string | null;
    title?: string;
    /** The count to show (the task's commentCount); the thread's total when omitted. */
    count?: number;
    className?: string;
}) {
    const thread = useComments(projectId, taskId ?? 'none');
    const headingId = useId();
    const shown = count ?? thread.data?.pages[0]?.meta.total;

    let body;
    if (thread.isPending) {
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
    } else if (thread.isError) {
        body = (
            <ErrorState
                compact
                title="Couldn't load comments"
                message={errorMessage(thread.error)}
                retrying={thread.isRefetching}
                onRetry={() => void thread.refetch()}
            />
        );
    } else {
        const comments = thread.data.pages.flatMap((page) => page.items);
        body = comments.length ? (
            <>
                <ol aria-labelledby={headingId} className="m-0 flex list-none flex-col gap-3 p-0">
                    {comments.map((comment) => (
                        <CommentItem key={comment.id} comment={comment} />
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
            <p className="text-muted m-0 text-sm">No comments yet.</p>
        );
    }

    return (
        <section aria-labelledby={headingId} className={clsx('flex flex-col gap-3', className)}>
            <div className="flex items-baseline gap-2">
                <h5 id={headingId} className="m-0">
                    {title}
                </h5>
                {shown !== undefined && (
                    <span className="text-muted text-[12px]" data-testid="comment-count">
                        {shown}
                    </span>
                )}
            </div>
            {body}
            <CommentComposer projectId={projectId} taskId={taskId} />
        </section>
    );
}

function CommentItem({ comment }: { comment: Comment }) {
    return (
        <li className="grid grid-cols-[28px_1fr] gap-3">
            <Avatar name={comment.author.name} size="sm" />
            <div className="min-w-0">
                <div className="text-[13px]">
                    <b>{comment.author.name}</b>{' '}
                    <time
                        className="text-muted"
                        dateTime={comment.createdAt}
                        title={fullDateTime(comment.createdAt)}
                    >
                        {relativeTime(comment.createdAt)}
                    </time>
                    {comment.editedAt && <span className="text-muted"> · edited</span>}
                </div>
                {/* Plain text: line breaks kept, never rendered as HTML. */}
                <p className="m-0 text-sm break-words whitespace-pre-wrap">{comment.body}</p>
            </div>
        </li>
    );
}
