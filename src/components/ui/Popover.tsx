'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import type { ComponentProps } from 'react';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/** Floating panel: page ground, 2px rule, top elevation (as the prototype's notifications panel). */
export function PopoverContent({
    className,
    align = 'start',
    sideOffset = 4,
    collisionPadding = 16,
    ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                align={align}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={clsx('tm-popover tm-fade', className)}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
}
