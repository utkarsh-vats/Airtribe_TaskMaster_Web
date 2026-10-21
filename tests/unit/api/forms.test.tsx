import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { ApiError, ERROR_CODES } from '@/lib/api/errors';
import { applyFieldErrors } from '@/lib/api/forms';

type TaskForm = { title: string; assignee: string | null; dueDate: string };

const validation = (details: { path: string; message: string }[]) =>
    new ApiError({
        status: 422,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Request validation failed',
        details,
    });

// Read errors with getFieldState(): formState is a subscription proxy that only tracks what a
// render reads, and these tests never render the errors.
function renderForm() {
    return renderHook(() =>
        useForm<TaskForm>({ defaultValues: { title: '', assignee: null, dueDate: '' } }),
    ).result;
}

describe('applyFieldErrors', () => {
    it('sets server errors on matching fields', () => {
        const form = renderForm();

        let unplaced: unknown;
        act(() => {
            unplaced = applyFieldErrors(
                validation([
                    { path: 'title', message: 'Required' },
                    { path: 'dueDate', message: 'Invalid date' },
                ]),
                form.current.setError,
            );
        });

        expect(form.current.getFieldState('title').error).toMatchObject({
            type: 'server',
            message: 'Required',
        });
        expect(form.current.getFieldState('dueDate').error?.message).toBe('Invalid date');
        expect(unplaced).toEqual([]);
    });

    it('renames API paths with fieldMap', () => {
        const form = renderForm();

        act(() => {
            applyFieldErrors(
                validation([{ path: 'assigneeId', message: 'Not a member' }]),
                form.current.setError,
                { assigneeId: 'assignee' },
            );
        });

        expect(form.current.getFieldState('assignee').error?.message).toBe('Not a member');
    });

    it('returns the details it could not place', () => {
        const form = renderForm();
        const root = { path: '', message: 'Unrecognized key: "extra"' };
        const unknown = { path: 'priority', message: 'Invalid option' };

        let unplaced: unknown;
        act(() => {
            unplaced = applyFieldErrors(
                validation([{ path: 'title', message: 'Required' }, root, unknown]),
                form.current.setError,
                {},
                ['title', 'assignee', 'dueDate'],
            );
        });

        expect(unplaced).toEqual([root, unknown]);
        expect(form.current.getFieldState('title').error?.message).toBe('Required');
    });

    it('ignores errors that are not validation errors', () => {
        const form = renderForm();
        const forbidden = new ApiError({ status: 403, code: ERROR_CODES.FORBIDDEN, message: 'No' });

        expect(applyFieldErrors(forbidden, form.current.setError)).toEqual([]);
        expect(applyFieldErrors(new Error('boom'), form.current.setError)).toEqual([]);
    });
});
