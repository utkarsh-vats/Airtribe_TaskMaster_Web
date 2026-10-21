import { clsx } from 'clsx';
import Link from 'next/link';
import type { ComponentProps } from 'react';

import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'default' | 'sm';

type ButtonStyleProps = {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Full width, label flush left (`.btn-block`). */
    block?: boolean;
    /** Destructive colouring for any variant (uses --tm-danger). */
    danger?: boolean;
};

/** An icon-only button has no visible text, so it must have an accessible name. */
type IconOnlyProps =
    { iconOnly: true; 'aria-label': string } | { iconOnly?: false; 'aria-label'?: string };

export function buttonClassName({
    variant = 'secondary',
    size = 'default',
    block = false,
    danger = false,
    iconOnly = false,
    className,
}: ButtonStyleProps & { iconOnly?: boolean; className?: string | undefined }) {
    return clsx(
        'btn',
        `btn-${variant}`,
        size === 'sm' && 'btn-sm',
        iconOnly && 'btn-icon',
        block && 'btn-block',
        danger && 'btn-danger',
        className,
    );
}

export type ButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> &
    ButtonStyleProps &
    IconOnlyProps & {
        /** Shows a spinner, sets aria-busy and disables the button. */
        loading?: boolean;
    };

export function Button({
    variant,
    size,
    block,
    danger,
    iconOnly,
    loading = false,
    disabled,
    className,
    type = 'button',
    children,
    ...props
}: ButtonProps) {
    return (
        <button
            type={type}
            className={buttonClassName({ variant, size, block, danger, iconOnly, className })}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            {...props}
        >
            {loading && <Spinner size={size === 'sm' ? 14 : 16} />}
            {loading && iconOnly ? null : children}
        </button>
    );
}

export type ButtonLinkProps = Omit<ComponentProps<typeof Link>, 'aria-label'> &
    ButtonStyleProps &
    IconOnlyProps;

/** A next/link styled as a button. */
export function ButtonLink({
    variant,
    size,
    block,
    danger,
    iconOnly,
    className,
    ...props
}: ButtonLinkProps) {
    return (
        <Link
            className={buttonClassName({ variant, size, block, danger, iconOnly, className })}
            {...props}
        />
    );
}
