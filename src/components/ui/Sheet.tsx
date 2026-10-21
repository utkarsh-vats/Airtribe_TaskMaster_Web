'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Button } from './Button';

type SidePanelProps = {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger?: ReactElement;
    /** Shown in the sticky header and used as the panel's accessible name. */
    title: ReactNode;
    /** Accessible description (visually hidden). */
    description?: ReactNode;
    /** Extra header content after the title, before the close button. */
    headerActions?: ReactNode;
    children?: ReactNode;
    /** Sticky-free footer row under the body (2px rule above). */
    footer?: ReactNode;
    className?: string;
};

function SidePanel({
    side,
    open,
    onOpenChange,
    trigger,
    title,
    description,
    headerActions,
    children,
    footer,
    className,
}: SidePanelProps & { side: 'left' | 'right' }) {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="tm-sheet-overlay tm-fade" />
                <DialogPrimitive.Content
                    data-side={side}
                    className={clsx('tm-sheet', className)}
                    {...(description ? {} : { 'aria-describedby': undefined })}
                >
                    <div className="tm-sheet-header">
                        <DialogPrimitive.Title className="m-0 mr-auto min-w-0 truncate font-body text-sm font-normal tracking-normal text-muted">
                            {title}
                        </DialogPrimitive.Title>
                        {description && (
                            <DialogPrimitive.Description className="sr-only">
                                {description}
                            </DialogPrimitive.Description>
                        )}
                        {headerActions}
                        <DialogPrimitive.Close asChild>
                            <Button
                                variant="ghost"
                                iconOnly
                                aria-label="Close"
                                className="text-text"
                            >
                                <X aria-hidden size={18} />
                            </Button>
                        </DialogPrimitive.Close>
                    </div>
                    <div className="tm-sheet-body">{children}</div>
                    {footer && <div className="tm-sheet-footer">{footer}</div>}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

/** Right-side panel (the task panel). Full screen below 820px. */
export function Sheet(props: SidePanelProps) {
    return <SidePanel side="right" {...props} />;
}

/** Left-side panel for the mobile navigation. */
export function Drawer(props: SidePanelProps) {
    return <SidePanel side="left" {...props} />;
}

export const SheetClose = DialogPrimitive.Close;
