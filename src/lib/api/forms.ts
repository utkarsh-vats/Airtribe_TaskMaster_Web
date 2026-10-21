import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ERROR_CODES, isApiError } from './errors';
import type { ApiErrorDetail } from './types';

/** API detail path → form field, for fields named differently in the form (e.g. assigneeId → assignee). */
export type FieldMap<T extends FieldValues> = Partial<Record<string, Path<T>>>;

/**
 * Put a 422's `details[]` onto react-hook-form fields (`details[].path` is the request field,
 * dot-separated when nested). The first placed field gets focus.
 *
 * Returns the details it couldn't place, for a toast or a form-level message:
 * root-level problems (empty path), and — when `fields` is given — paths that aren't in it.
 * Without `fields`, every non-empty path is placed, so pass it unless the form's field names
 * mirror the request body exactly. Errors other than a 422 have no details: returns [].
 */
export function applyFieldErrors<T extends FieldValues>(
    error: unknown,
    setError: UseFormSetError<T>,
    fieldMap: FieldMap<T> = {},
    fields?: readonly Path<T>[],
): ApiErrorDetail[] {
    if (!isApiError(error) || error.code !== ERROR_CODES.VALIDATION_ERROR) return [];

    const unplaced: ApiErrorDetail[] = [];
    let focused = false;

    for (const detail of error.details) {
        const field = fieldMap[detail.path] ?? (detail.path as Path<T>);
        const placeable = detail.path !== '' && (!fields || fields.includes(field));
        if (!placeable) {
            unplaced.push(detail);
            continue;
        }
        setError(field, { type: 'server', message: detail.message }, { shouldFocus: !focused });
        focused = true;
    }

    return unplaced;
}
