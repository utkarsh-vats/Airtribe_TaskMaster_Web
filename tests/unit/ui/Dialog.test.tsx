import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

function renderDialog() {
    return render(
        <>
            <Button>Outside</Button>
            <Dialog
                trigger={<Button>New task</Button>}
                title="New task"
                actions={
                    <DialogClose asChild>
                        <Button>Cancel</Button>
                    </DialogClose>
                }
            >
                <Field label="Title">
                    <Input />
                </Field>
            </Dialog>
        </>,
    );
}

describe('Dialog', () => {
    it('opens, traps focus, closes on Esc and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        renderDialog();
        const trigger = screen.getByRole('button', { name: 'New task' });

        await user.click(trigger);
        const dialog = screen.getByRole('dialog', { name: 'New task' });
        expect(dialog).toBeInTheDocument();
        expect(dialog).toContainElement(document.activeElement as HTMLElement);

        // Tab through more stops than the dialog has: focus must stay inside.
        for (let i = 0; i < 6; i++) {
            await user.tab();
            expect(dialog).toContainElement(document.activeElement as HTMLElement);
        }
        await user.tab({ shift: true });
        expect(dialog).toContainElement(document.activeElement as HTMLElement);

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it('closes from a DialogClose action', async () => {
        const user = userEvent.setup();
        renderDialog();

        await user.click(screen.getByRole('button', { name: 'New task' }));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
