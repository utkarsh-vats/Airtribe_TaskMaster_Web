'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Button } from './Button';

export type DialogProps = {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Element that opens the dialog (rendered via Radix `asChild`). Omit when controlled. */
    trigger?: ReactElement;
    title: ReactNode;
    description?: ReactNode;
    /** Body content: fields, text, etc. */
    children?: ReactNode;
    /** Footer buttons, right-aligned (`.dialog-actions`). */
    actions?: ReactNode;
    /** Max width in px. Modernist's default is 440; the New task dialog uses 580. */
    width?: number;
    /** Hide the corner close button (Esc and Cancel still close). */
    hideClose?: boolean;
    /** Extra buttons in the header, before the close button (e.g. Download). */
    headerActions?: ReactNode;
    className?: string;
};

/**
 * Modal on Radix Dialog with the Modernist `.dialog-backdrop` / `.dialog` classes: focus is
 * trapped inside, Esc and a backdrop click close it, and focus returns to the trigger.
 */
export function Dialog({
    open,
    onOpenChange,
    trigger,
    title,
    description,
    children,
    actions,
    width,
    hideClose = false,
    headerActions,
    className,
}: DialogProps) {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
            <DialogPrimitive.Portal>
                {/* Content inside the overlay: the backdrop centres it and scrolls if it's tall. */}
                <DialogPrimitive.Overlay className="dialog-backdrop tm-dialog-overlay tm-fade">
                    <DialogPrimitive.Content
                        className={clsx('dialog tm-dialog', className)}
                        style={width ? { width: `min(${width}px, 100%)` } : undefined}
                        // Radix warns when there's no description; opt out explicitly.
                        {...(description ? {} : { 'aria-describedby': undefined })}
                    >
                        <div className="flex items-start gap-2">
                            <DialogPrimitive.Title className="dialog-title mr-auto min-w-0">
                                {title}
                            </DialogPrimitive.Title>
                            {headerActions}
                            {!hideClose && (
                                <DialogPrimitive.Close asChild>
                                    <Button
                                        variant="ghost"
                                        iconOnly
                                        aria-label="Close"
                                        className="-mt-1 -mr-2 text-text"
                                    >
                                        <X aria-hidden size={18} />
                                    </Button>
                                </DialogPrimitive.Close>
                            )}
                        </div>
                        {description && (
                            <DialogPrimitive.Description className="dialog-body">
                                {description}
                            </DialogPrimitive.Description>
                        )}
                        {children}
                        {actions && <DialogActions>{actions}</DialogActions>}
                    </DialogPrimitive.Content>
                </DialogPrimitive.Overlay>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

export function DialogActions({ children }: { children: ReactNode }) {
    return <div className="dialog-actions flex-wrap">{children}</div>;
}

/** Closes the surrounding dialog when its child is clicked (e.g. a Cancel button). */
export const DialogClose = DialogPrimitive.Close;
