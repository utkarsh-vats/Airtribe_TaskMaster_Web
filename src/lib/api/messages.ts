import { env } from '@/lib/env';

import { ERROR_CODES, isApiError } from './errors';

export const FALLBACK_ERROR_MESSAGE = 'Something went wrong.';
/** A 413, or a file over the limit before it's sent (NEXT_PUBLIC_MAX_UPLOAD_MB). */
export const TOO_LARGE_MESSAGE = `Too large — max ${env.NEXT_PUBLIC_MAX_UPLOAD_MB} MB.`;
export const TYPE_NOT_ALLOWED_MESSAGE = "That file type isn't allowed.";

/** Codes whose text doesn't follow from the status alone. */
const MESSAGES_BY_CODE: Partial<Record<string, string>> = {
    [ERROR_CODES.NETWORK_ERROR]: "Can't reach the server. Check your connection.",
    // A failed login is a 401 too, but it isn't an expired session.
    [ERROR_CODES.INVALID_CREDENTIALS]: 'Incorrect email or password.',
    [ERROR_CODES.INVALID_CURRENT_PASSWORD]: 'Your current password is incorrect.',
    [ERROR_CODES.AI_UPSTREAM_ERROR]: "AI couldn't respond — try again.",
    [ERROR_CODES.AI_DISABLED]: "AI drafting isn't available right now.",
};

const MESSAGES_BY_STATUS: Partial<Record<number, string>> = {
    401: 'Your session has expired. Please sign in again.',
    403: "You don't have permission to do that.",
    404: "That doesn't exist, or you no longer have access to it.",
    410: 'This invitation has expired.',
    413: TOO_LARGE_MESSAGE,
    415: TYPE_NOT_ALLOWED_MESSAGE,
    422: 'Please check the highlighted fields.',
    429: 'Too many attempts — try again in a minute.',
};

/**
 * User-facing text for a failed request (DESIGN.md §7 error table). The code wins over the
 * status where both apply; 409 shows the API's own message (it says what conflicted);
 * anything else — including values that aren't ApiErrors — gets the generic fallback.
 */
export function errorMessage(error: unknown): string {
    if (!isApiError(error)) return FALLBACK_ERROR_MESSAGE;

    const byCode = MESSAGES_BY_CODE[error.code];
    if (byCode) return byCode;

    if (error.status === 409) return error.message || FALLBACK_ERROR_MESSAGE;

    return MESSAGES_BY_STATUS[error.status] ?? FALLBACK_ERROR_MESSAGE;
}
