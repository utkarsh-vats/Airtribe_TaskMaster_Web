'use client';

import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { clsx } from 'clsx';
import type { ComponentProps } from 'react';

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuGroup = MenuPrimitive.Group;

export function MenuContent({
    className,
    align = 'end',
    sideOffset = 4,
    collisionPadding = 16,
    ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
    return (
        <MenuPrimitive.Portal>
            <MenuPrimitive.Content
                align={align}
                sideOffset={sideOffset}
                collisionPadding={collisionPadding}
                className={clsx('tm-menu tm-fade', className)}
                {...props}
            />
        </MenuPrimitive.Portal>
    );
}

type MenuItemProps = ComponentProps<typeof MenuPrimitive.Item> & {
    /** Danger colouring for destructive items (Delete, Remove, Leave). */
    danger?: boolean;
};

export function MenuItem({ danger = false, className, ...props }: MenuItemProps) {
    return (
        <MenuPrimitive.Item
            data-danger={danger || undefined}
            className={clsx('tm-menu-item', className)}
            {...props}
        />
    );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
    return <MenuPrimitive.Label className={clsx('tm-menu-label', className)} {...props} />;
}

export function MenuSeparator({
    className,
    ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
    return <MenuPrimitive.Separator className={clsx('tm-menu-separator', className)} {...props} />;
}
