'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FieldError } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import type { ProjectPermissions } from '@/features/projects/permissions';
import { errorMessage } from '@/lib/api/messages';
import type { Comment } from '@/lib/api/types';
import { queryView } from '@/lib/query/view';

import { commentKey, isPendingComment, useCreateReply, useReplies } from '../api';
import { COMMENT_MAX_LENGTH } from './CommentComposer';
import { CommentItem } from './CommentItem';

/**
 * Under a top-level comment (DESIGN.md §6): **Reply** (anyone who can comment) and, when it has
 * replies, **View N replies** / **Hide replies**. The replies load the first time they're shown:
 * indented behind a rule, oldest first, "Show more replies" for the next page. Reply opens an
 * inline composer under them (showing them too); the thread keeps one composer open at a time.
 * Whether the replies are shown is kept while this comment stays rendered.
 */
export function CommentReplies({
    projectId,
    parent,
    can,
    replying,
    onReplyingChange,
    editingId,
    onEditingChange,
}: {
    projectId: string;
    parent: Comment;
    can: ProjectPermissions | null;
    /** This comment's reply composer is the open one. */
    replying: boolean;
    onReplyingChange: (replying: boolean) => void;
    /** The one comment or reply in edit mode, thread-wide. */
    editingId: string | null;
    onEditingChange: (commentId: string, editing: boolean) => void;
}) {
    const [open, setOpen] = useState(false);
    const shown = open || replying;
    const replies = useReplies(projectId, parent.id, { enabled: shown });
    const listId = useId();
    const count = parent.replyCount;
    // Not for a comment still being posted: it has no id the API knows yet.
    const canReply = can !== null && !isPendingComment(parent);

    let body = null;
    const view = queryView(replies);
    if (view.status === 'loading') {
        body =
            count > 0 ? (
                <div aria-busy="true" className="flex flex-col gap-2">
                    <span className="sr-only">Loading replies…</span>
                    {Array.from({ length: Math.min(count, 2) }, (_, i) => (
                        <div key={i} className="grid grid-cols-[20px_1fr] gap-3">
                            <Skeleton width={20} height={20} />
                            <Skeleton width="70%" height={12} />
                        </div>
                    ))}
                </div>
            ) : null;
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                compact
                title="Couldn't load replies"
                message={errorMessage(view.error)}
                retrying={replies.isRefetching}
                onRetry={() => void replies.refetch()}
            />
        );
    } else {
        const items = view.data.pages.flatMap((page) => page.items);
        body = (
            <>
                {items.length > 0 && (
                    <ol
                        aria-label={`Replies to ${parent.author.name}`}
                        className="m-0 flex list-none flex-col gap-2 p-0"
                    >
                        {items.map((reply) => {
                            const pending = isPendingComment(reply);
                            return (
                                <CommentItem
                                    key={commentKey(reply)}
                                    variant="reply"
                                    projectId={projectId}
                                    comment={reply}
                                    pending={pending}
                                    canEdit={!pending && (can?.editComment(reply) ?? false)}
                                    canDelete={!pending && (can?.deleteComment(reply) ?? false)}
                                    editing={editingId === reply.id}
                                    onEditingChange={(editing) =>
                                        onEditingChange(reply.id, editing)
                                    }
                                />
                            );
                        })}
                    </ol>
                )}
                {replies.hasNextPage && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        loading={replies.isFetchingNextPage}
                        onClick={() => void replies.fetchNextPage()}
                    >
                        Show more replies
                    </Button>
                )}
            </>
        );
    }

    return (
        <div className="mt-1 flex flex-col gap-2">
            {(canReply || count > 0) && (
                <div className="flex flex-wrap gap-1">
                    {canReply && (
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Reply to ${parent.author.name}`}
                            onClick={() => {
                                setOpen(true);
                                onReplyingChange(true);
                            }}
                        >
                            Reply
                        </Button>
                    )}
                    {count > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={open}
                            aria-controls={listId}
                            onClick={() => {
                                setOpen(!open);
                                if (open) onReplyingChange(false);
                            }}
                        >
                            {open
                                ? 'Hide replies'
                                : `View ${count} ${count === 1 ? 'reply' : 'replies'}`}
                        </Button>
                    )}
                </div>
            )}
            <div
                id={listId}
                hidden={!shown}
                className="flex flex-col gap-2 border-l-2 border-divider pl-3"
            >
                {shown && body}
                {replying && (
                    <ReplyComposer
                        projectId={projectId}
                        parent={parent}
                        onClose={() => onReplyingChange(false)}
                    />
                )}
            </div>
        </div>
    );
}

/**
 * The inline reply composer: focused when it opens, "Reply to {name}…". Ctrl/Cmd+Enter posts,
 * Esc or Cancel closes (the panel around it stays open). Posting clears the box — the reply
 * shows at once at the end of the replies — and a failure puts the text back.
 */
function ReplyComposer({
    projectId,
    parent,
    onClose,
}: {
    projectId: string;
    parent: Comment;
    onClose: () => void;
}) {
    const create = useCreateReply(projectId);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const errorId = useId();
    const body = draft.trim();

    useEffect(() => {
        textarea.current?.focus();
    }, []);

    const post = () => {
        if (!body || create.isPending) return;
        if (body.length > COMMENT_MAX_LENGTH) {
            setError(`Replies can be up to ${COMMENT_MAX_LENGTH} characters.`);
            return;
        }
        setError(null);
        setDraft('');
        create.mutate(
            { parent, body },
            // The hook toasts the error; the text goes back in the box.
            { onError: () => setDraft((current) => (current === '' ? body : current)) },
        );
    };

    return (
        <div className="flex flex-col gap-2">
            <Textarea
                ref={textarea}
                autoGrow
                rows={1}
                aria-label={`Reply to ${parent.author.name}`}
                placeholder={`Reply to ${parent.author.name}…`}
                // Esc closes this composer; the panel around it stays open (Sheet).
                data-keep-open-on-escape
                value={draft}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => {
                    setDraft(event.target.value);
                    if (error) setError(null);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        post();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        onClose();
                    }
                }}
                className="min-h-0"
            />
            {error && <FieldError id={errorId}>{error}</FieldError>}
            <div className="flex gap-2">
                <Button
                    variant="primary"
                    size="sm"
                    disabled={!body}
                    loading={create.isPending}
                    onClick={post}
                >
                    Post reply
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}
