import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

describe('ConfirmDialog', () => {
    it('keeps confirm disabled until the exact confirmText is typed', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        const onOpenChange = vi.fn();
        render(
            <ConfirmDialog
                open
                onOpenChange={onOpenChange}
                title="Delete project?"
                confirmLabel="Delete project"
                confirmText="Website relaunch"
                destructive
                onConfirm={onConfirm}
            />,
        );
        const confirm = screen.getByRole('button', { name: 'Delete project' });
        const input = screen.getByRole('textbox', { name: /Type Website relaunch to confirm/ });

        expect(confirm).toBeDisabled();

        await user.type(input, 'website relaunch');
        expect(confirm).toBeDisabled();

        await user.clear(input);
        await user.type(input, 'Website relaunc');
        expect(confirm).toBeDisabled();

        await user.type(input, 'h');
        expect(confirm).toBeEnabled();

        await user.click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('confirms straight away without confirmText', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog
                open
                title="Leave project?"
                confirmLabel="Leave"
                onConfirm={onConfirm}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Leave' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
