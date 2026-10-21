import { clsx } from 'clsx';
import type { CSSProperties } from 'react';

type SkeletonProps = {
    /** CSS width, e.g. '60%' or 120. Defaults to full width. */
    width?: CSSProperties['width'];
    /** CSS height. Defaults to 1em. */
    height?: CSSProperties['height'];
    className?: string;
};

/** Loading placeholder bar. Decorative: mark the loading region with aria-busy instead. */
export function Skeleton({ width, height, className }: SkeletonProps) {
    return (
        <span
            aria-hidden
            className={clsx('skeleton motion-safe:animate-pulse', className)}
            style={{ width, height }}
        />
    );
}
