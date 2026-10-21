import { clsx } from 'clsx';
import type { ComponentProps } from 'react';

type CardProps = ComponentProps<'div'> & {
    elevation?: 'none' | 'sm' | 'md' | 'lg';
};

/** `.card`: surface-filled block; `elevation` adds `.elev-*`. */
export function Card({ elevation = 'none', className, ...props }: CardProps) {
    return (
        <div
            className={clsx('card', elevation !== 'none' && `elev-${elevation}`, className)}
            {...props}
        />
    );
}

export function CardKicker({ className, ...props }: ComponentProps<'div'>) {
    return <div className={clsx('card-kicker', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
    return <div className={clsx('card-title', className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<'p'>) {
    return <p className={clsx('card-body', className)} {...props} />;
}

export function CardMeta({ className, ...props }: ComponentProps<'div'>) {
    return <div className={clsx('card-meta', className)} {...props} />;
}
