'use client';

import { useState, type ReactElement, type ReactNode } from 'react';

import { Button } from './Button';
import { Dialog, DialogActions, DialogClose } from './Dialog';
import { Field } from './Field';
import { Input } from './Input';

type ConfirmDialogProps = {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger?: ReactElement;
    title: ReactNode;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Danger-coloured confirm button. */
    destructive?: boolean;
    /** When set, the user must type exactly this (e.g. the project name) before confirming. */
    confirmText?: string;
    /**
     * Called on confirm. If it returns a promise the button shows a spinner until it settles;
     * the dialog closes when it resolves and stays open if it rejects.
     */
    onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
    open: openProp,
    onOpenChange,
    trigger,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    confirmText,
    onConfirm,
}: ConfirmDialogProps) {
    const [openState, setOpenState] = useState(false);
    const open = openProp ?? openState;
    const setOpen = (next: boolean) => {
        setOpenState(next);
        onOpenChange?.(next);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={setOpen}
            trigger={trigger}
            title={title}
            description={description}
            hideClose
        >
            {/* Separate component so typed text and pending state reset each time it opens. */}
            <ConfirmBody
                confirmLabel={confirmLabel}
                cancelLabel={cancelLabel}
                destructive={destructive}
                confirmText={confirmText}
                onConfirm={onConfirm}
                onDone={() => setOpen(false)}
            />
        </Dialog>
    );
}

function ConfirmBody({
    confirmLabel,
    cancelLabel,
    destructive,
    confirmText,
    onConfirm,
    onDone,
}: {
    confirmLabel: string;
    cancelLabel: string;
    destructive: boolean;
    confirmText: string | undefined;
    onConfirm: () => void | Promise<void>;
    onDone: () => void;
}) {
    const [typed, setTyped] = useState('');
    const [pending, setPending] = useState(false);
    const matches = confirmText === undefined || typed === confirmText;

    const confirm = async () => {
        setPending(true);
        try {
            await onConfirm();
            onDone();
        } catch {
            // The caller reports the error (toast); keep the dialog open to retry.
        } finally {
            setPending(false);
        }
    };

    return (
        <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
                event.preventDefault();
                if (matches && !pending) void confirm();
            }}
        >
            {confirmText !== undefined && (
                <Field
                    label={
                        <>
                            Type <strong className="font-semibold">{confirmText}</strong> to confirm
                        </>
                    }
                >
                    <Input
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        placeholder={confirmText}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </Field>
            )}
            <DialogActions>
                <DialogClose asChild>
                    <Button variant="secondary" disabled={pending}>
                        {cancelLabel}
                    </Button>
                </DialogClose>
                <Button
                    type="submit"
                    variant="primary"
                    danger={destructive}
                    disabled={!matches}
                    loading={pending}
                >
                    {confirmLabel}
                </Button>
            </DialogActions>
        </form>
    );
}
