'use client';

import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FieldError } from '@/components/ui/Field';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Textarea } from '@/components/ui/Textarea';
import { isApiError } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';
import type { Comment } from '@/lib/api/types';
import { fullDateTime, relativeTime } from '@/lib/format/dates';

import { useDeleteComment, useUpdateComment } from '../api';
import { COMMENT_MAX_LENGTH } from './CommentComposer';

export const EMPTY_COMMENT_MESSAGE = "A comment can't be empty.";

/** A rejected edit, reopened with what the user typed and why it failed. */
type Rejected = { draft: string; error: string };

/**
 * One comment (DESIGN.md §6, §8): avatar, author, time, "· edited", the body as plain text,
 * and — for whoever may use them — "Comment actions" with Edit (the author) and Delete (the
 * author or ADMIN+). Edit swaps the body for an inline editor; saving closes it at once and
 * shows the new body (optimistic), reopening it with the message if the API rejects the text.
 */
export function CommentItem({
    projectId,
    comment,
    canEdit,
    canDelete,
    editing,
    onEditingChange,
}: {
    projectId: string;
    comment: Comment;
    canEdit: boolean;
    canDelete: boolean;
    /** The thread allows one comment in edit mode at a time. */
    editing: boolean;
    onEditingChange: (editing: boolean) => void;
}) {
    const update = useUpdateComment(projectId);
    const remove = useDeleteComment(projectId);
    const [rejected, setRejected] = useState<Rejected | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    // Edit was picked: keep the menu from taking focus back from the editor as it closes.
    const editPicked = useRef(false);

    const startEdit = () => {
        setRejected(null);
        onEditingChange(true);
    };
    const stopEdit = () => {
        setRejected(null);
        onEditingChange(false);
    };

    const save = (body: string) => {
        stopEdit();
        update.mutate(
            { comment, body },
            {
                onError: (failure) => {
                    if (isApiError(failure) && failure.status === 422) {
                        setRejected({
                            draft: body,
                            error: failure.details?.[0]?.message ?? failure.message,
                        });
                        onEditingChange(true);
                    } else {
                        notifyError(failure);
                    }
                },
            },
        );
    };

    return (
        <li className="tm-comment grid grid-cols-[28px_1fr] gap-3">
            <Avatar name={comment.author.name} size="sm" />
            <div className="min-w-0">
                <div className="flex min-h-[28px] items-center gap-1 text-[13px]">
                    <span className="min-w-0">
                        <b>{comment.author.name}</b>{' '}
                        <time
                            className="text-muted"
                            dateTime={comment.createdAt}
                            title={fullDateTime(comment.createdAt)}
                        >
                            {relativeTime(comment.createdAt)}
                        </time>
                        {comment.editedAt && <span className="text-muted"> · edited</span>}
                    </span>
                    {(canEdit || canDelete) && !editing && (
                        // Not modal: a modal menu opening the confirm dialog can leave the page
                        // without pointer events.
                        <Menu modal={false}>
                            <MenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    iconOnly
                                    aria-label="Comment actions"
                                    className="tm-comment-actions ml-auto"
                                >
                                    <MoreHorizontal aria-hidden size={16} />
                                </Button>
                            </MenuTrigger>
                            <MenuContent
                                onCloseAutoFocus={(event) => {
                                    if (!editPicked.current) return;
                                    editPicked.current = false;
                                    event.preventDefault();
                                }}
                            >
                                {canEdit && (
                                    <MenuItem
                                        onSelect={() => {
                                            editPicked.current = true;
                                            startEdit();
                                        }}
                                    >
                                        Edit
                                    </MenuItem>
                                )}
                                {canDelete && (
                                    <MenuItem danger onSelect={() => setConfirmOpen(true)}>
                                        Delete
                                    </MenuItem>
                                )}
                            </MenuContent>
                        </Menu>
                    )}
                </div>
                {editing ? (
                    <CommentEditor
                        initial={rejected ?? { draft: comment.body, error: null }}
                        original={comment.body}
                        onSave={save}
                        onCancel={stopEdit}
                    />
                ) : (
                    // Plain text: line breaks kept, never rendered as HTML.
                    <p className="m-0 text-sm break-words whitespace-pre-wrap">{comment.body}</p>
                )}
            </div>
            {canDelete && (
                <ConfirmDialog
                    open={confirmOpen}
                    onOpenChange={setConfirmOpen}
                    title="Delete this comment?"
                    description="This can't be undone."
                    confirmLabel="Delete"
                    destructive
                    // Rejects on failure (already toasted), which keeps the dialog open to retry.
                    onConfirm={async () => {
                        await remove.mutateAsync(comment);
                    }}
                />
            )}
        </li>
    );
}

/**
 * The inline editor: prefilled, focused with the cursor at the end. Ctrl/Cmd+Enter saves, Esc
 * cancels; the text is trimmed and must be 1–5000 characters; unchanged text just closes.
 */
function CommentEditor({
    initial,
    original,
    onSave,
    onCancel,
}: {
    initial: { draft: string; error: string | null };
    original: string;
    onSave: (body: string) => void;
    onCancel: () => void;
}) {
    const [draft, setDraft] = useState(initial.draft);
    const [error, setError] = useState(initial.error);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const errorId = useId();

    useEffect(() => {
        const el = textarea.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
    }, []);

    const save = () => {
        const body = draft.trim();
        if (!body) return setError(EMPTY_COMMENT_MESSAGE);
        if (body.length > COMMENT_MAX_LENGTH) {
            return setError(`Comments can be up to ${COMMENT_MAX_LENGTH} characters.`);
        }
        if (body === original) return onCancel();
        onSave(body);
    };

    return (
        <div className="mt-1 flex flex-col gap-2">
            <Textarea
                ref={textarea}
                autoGrow
                rows={1}
                aria-label="Edit comment"
                // Esc cancels the edit; the panel around it stays open (Sheet).
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
                        save();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        onCancel();
                    }
                }}
                className="min-h-0"
            />
            {error && <FieldError id={errorId}>{error}</FieldError>}
            <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={save}>
                    Save
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}
