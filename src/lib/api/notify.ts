import { isCancelledError } from '@tanstack/react-query';
import { toast } from 'sonner';

import { errorMessage } from './messages';

type NotifyErrorOptions = {
    /** Adds a "Retry" action to the toast. */
    retry?: () => void;
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * Show a failed request as an error toast (DESIGN.md §7 text). Cancelled requests — a query
 * the user navigated away from, an aborted fetch — are silent. Returns the toast id, or
 * undefined when nothing was shown. The same message replaces its earlier toast instead of
 * stacking.
 */
export function notifyError(error: unknown, { retry }: NotifyErrorOptions = {}) {
    if (isCancelledError(error) || isAbort(error)) return undefined;

    const message = errorMessage(error);
    return toast.error(message, {
        id: `error:${message}`,
        ...(retry ? { action: { label: 'Retry', onClick: retry } } : {}),
    });
}
