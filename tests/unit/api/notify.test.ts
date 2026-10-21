import { CancelledError } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, ERROR_CODES } from '@/lib/api/errors';
import { notifyError } from '@/lib/api/notify';

vi.mock('sonner', () => ({ toast: { error: vi.fn(() => 'toast-id') } }));

const forbidden = new ApiError({ status: 403, code: ERROR_CODES.FORBIDDEN, message: 'Forbidden' });

afterEach(() => vi.mocked(toast.error).mockClear());

describe('notifyError', () => {
    it('shows the mapped message as an error toast', () => {
        const id = notifyError(forbidden);

        expect(id).toBe('toast-id');
        expect(toast.error).toHaveBeenCalledWith(
            "You don't have permission to do that.",
            expect.not.objectContaining({ action: expect.anything() }),
        );
    });

    it('adds a Retry action that calls retry', () => {
        const retry = vi.fn();

        notifyError(forbidden, { retry });

        const options = vi.mocked(toast.error).mock.calls[0]?.[1];
        expect(options?.action).toMatchObject({ label: 'Retry' });
        const action = options?.action;
        if (action && typeof action === 'object' && 'onClick' in action) {
            action.onClick({} as Parameters<typeof action.onClick>[0]);
        }
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('stays silent for cancelled requests', () => {
        expect(notifyError(new CancelledError())).toBeUndefined();
        expect(notifyError(new DOMException('Aborted', 'AbortError'))).toBeUndefined();
        expect(toast.error).not.toHaveBeenCalled();
    });
});
