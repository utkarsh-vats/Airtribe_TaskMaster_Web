'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { FieldError } from '@/components/ui/Field';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toaster';
import { isApiError } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';

import { useCreateComment } from '../api';

export const COMMENT_MAX_LENGTH = 5000;
export const TASK_GONE_MESSAGE = 'This task no longer exists.';

/**
 * "Write a comment" + Post (prototype). Ctrl/Cmd+Enter posts too. The body is trimmed and must
 * be 1–5000 characters. Success clears the draft; a failure keeps it: a 422 shows under the
 * composer, a 404 (the task was deleted) toasts, anything else toasts the error.
 */
export function CommentComposer({
    projectId,
    taskId,
}: {
    projectId: string;
    /** null for a project-level comment. */
    taskId: string | null;
}) {
    const create = useCreateComment(projectId);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const errorId = useId();
    const body = draft.trim();
    const canPost = body.length > 0 && !create.isPending;

    const post = () => {
        if (!canPost) return;
        if (body.length > COMMENT_MAX_LENGTH) {
            setError(`Comments can be up to ${COMMENT_MAX_LENGTH} characters.`);
            return;
        }
        setError(null);
        create.mutate(
            { body, taskId },
            {
                onSuccess: () => setDraft(''),
                onError: (failure) => {
                    if (isApiError(failure) && failure.status === 422) {
                        setError(failure.details?.[0]?.message ?? failure.message);
                    } else if (isApiError(failure) && failure.status === 404) {
                        toast.error(TASK_GONE_MESSAGE);
                    } else {
                        notifyError(failure);
                    }
                },
            },
        );
    };

    return (
        <form
            noValidate
            onSubmit={(event) => {
                event.preventDefault();
                post();
            }}
            className="flex flex-col"
        >
            <div className="flex items-end gap-2">
                <Textarea
                    autoGrow
                    rows={1}
                    aria-label="Comment"
                    placeholder="Write a comment"
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
                        }
                    }}
                    // One line to start (like the prototype's input), growing as it fills.
                    className="min-h-0 min-w-0 flex-1"
                />
                <Button
                    type="submit"
                    variant="secondary"
                    disabled={!body}
                    loading={create.isPending}
                >
                    Post
                </Button>
            </div>
            {error && <FieldError id={errorId}>{error}</FieldError>}
        </form>
    );
}
