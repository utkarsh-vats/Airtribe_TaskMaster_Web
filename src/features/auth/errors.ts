import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ERROR_CODES, hasCode, isApiError } from '@/lib/api/errors';
import { applyFieldErrors } from '@/lib/api/forms';
import { errorMessage } from '@/lib/api/messages';

export const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists.';

/**
 * Map a failed sign-in / registration onto the form (DESIGN.md §7). Field problems go on the
 * fields (focusing the first); everything else comes back as the form-level message, or null
 * when nothing is left to show.
 *   422      → details onto `fields`; unplaced details → form message
 *   409      → (register) email field: "An account with this email already exists."
 *   others   → errorMessage(): INVALID_CREDENTIALS, 429, NETWORK_ERROR, 5xx, …
 */
export function authFormError<T extends FieldValues & { email: string }>(
    error: unknown,
    setError: UseFormSetError<T>,
    fields: readonly Path<T>[],
): string | null {
    if (hasCode(error, ERROR_CODES.VALIDATION_ERROR)) {
        const unplaced = applyFieldErrors(error, setError, {}, fields);
        if (unplaced.length === 0) return null;
        return unplaced.map((detail) => detail.message).join(' ');
    }
    if (isApiError(error) && error.status === 409) {
        setError(
            'email' as Path<T>,
            { type: 'server', message: EMAIL_TAKEN_MESSAGE },
            { shouldFocus: true },
        );
        return null;
    }
    return errorMessage(error);
}
