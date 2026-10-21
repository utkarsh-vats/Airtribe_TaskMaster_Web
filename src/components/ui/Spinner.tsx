import { clsx } from 'clsx';
import { LoaderCircle } from 'lucide-react';

type SpinnerProps = {
    size?: number;
    /** Announced to screen readers. Omit when the surrounding control already says it's busy. */
    label?: string;
    className?: string;
};

export function Spinner({ size = 16, label, className }: SpinnerProps) {
    const icon = (
        <LoaderCircle
            aria-hidden
            size={size}
            className={clsx('flex-none animate-spin', className)}
        />
    );
    if (!label) return icon;

    return (
        <span role="status" className="inline-flex items-center">
            {icon}
            <span className="sr-only">{label}</span>
        </span>
    );
}
