'use client';

import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ERROR_CODES, hasCode, isApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/api/messages';

import { useGenerateDescription } from '../api';
import { isAiUnavailable, markAiUnavailable } from '../availability';

export const AI_UNAVAILABLE_MESSAGE = "AI drafting isn't available right now.";
export const AI_UPSTREAM_MESSAGE = "AI couldn't respond — try again.";
export const AI_RATE_LIMITED_MESSAGE = 'Too many AI requests — wait a minute.';

function draftErrorMessage(error: unknown) {
    if (isApiError(error)) {
        if (error.status === 502 || error.code === ERROR_CODES.AI_UPSTREAM_ERROR) {
            return AI_UPSTREAM_MESSAGE;
        }
        if (error.status === 429) return AI_RATE_LIMITED_MESSAGE;
    }
    return errorMessage(error);
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

type AiDraftRowProps = {
    /** The form's current title and description. */
    title: string;
    description: string;
    /** Put text into the description (a draft, or the previous text on Undo). */
    onDescription: (text: string) => void;
};

/**
 * "Draft with AI" row under the title in New task (DESIGN.md §5, §7). Drafts from the title,
 * passing any description typed so far as notes. Unmounting (the dialog closing) aborts the
 * request, so a late answer is dropped. Hidden for the rest of the session once the server
 * says AI is off (503 AI_DISABLED).
 */
export function AiDraftRow({ title, description, onDescription }: AiDraftRowProps) {
    const draft = useGenerateDescription();
    const [hidden] = useState(isAiUnavailable);
    const [unavailable, setUnavailable] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [undo, setUndo] = useState<{ previous: string; drafted: string } | null>(null);
    const controller = useRef<AbortController | null>(null);

    useEffect(() => () => controller.current?.abort(), []);

    // Undo is only offered until the description changes away from the draft.
    if (undo && description !== undo.drafted) setUndo(null);

    if (hidden) return null;

    if (unavailable) {
        return (
            <p className="text-muted m-0 flex items-center gap-2 text-[12px]">
                <Sparkles aria-hidden size={14} />
                {AI_UNAVAILABLE_MESSAGE}
            </p>
        );
    }

    const trimmed = title.trim();

    const start = async () => {
        controller.current?.abort();
        const current = new AbortController();
        controller.current = current;
        setError(null);
        setUndo(null);
        const previous = description;
        try {
            const text = await draft.mutateAsync({
                title: trimmed,
                notes: previous.trim() ? previous : undefined,
                signal: current.signal,
            });
            if (current.signal.aborted) return;
            setUndo({ previous, drafted: text });
            onDescription(text);
        } catch (failure) {
            if (current.signal.aborted || isAbort(failure)) return;
            if (hasCode(failure, ERROR_CODES.AI_DISABLED)) {
                markAiUnavailable();
                setUnavailable(true);
                return;
            }
            setError(draftErrorMessage(failure));
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Sparkles aria-hidden size={14} className="flex-none text-accent" />
            <p
                aria-live="polite"
                className={
                    error
                        ? 'm-0 text-[12px] font-semibold text-danger'
                        : 'text-muted m-0 text-[12px]'
                }
            >
                {error ??
                    (trimmed
                        ? 'Draft a description from the title'
                        : 'Add a title to draft a description')}
            </p>
            <span className="ml-auto flex items-center gap-2">
                {undo && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setUndo(null);
                            onDescription(undo.previous);
                        }}
                    >
                        Undo
                    </Button>
                )}
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={!trimmed}
                    loading={draft.isPending}
                    onClick={() => void start()}
                >
                    {draft.isPending ? 'Drafting…' : 'Draft with AI'}
                </Button>
            </span>
        </div>
    );
}
