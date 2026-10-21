'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

/** Mounted once in src/app/providers.tsx. */
export const TooltipProvider = TooltipPrimitive.Provider;

type TooltipProps = {
    content: ReactNode;
    /**
     * A single focusable element. Disabled buttons get no pointer or focus events, so wrap
     * them in a `<span tabIndex={0}>` when the tooltip explains why they're disabled.
     */
    children: ReactElement;
    side?: 'top' | 'right' | 'bottom' | 'left';
};

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
    return (
        <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                    side={side}
                    sideOffset={6}
                    collisionPadding={8}
                    className="tm-tooltip tm-fade"
                >
                    {content}
                </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
    );
}
