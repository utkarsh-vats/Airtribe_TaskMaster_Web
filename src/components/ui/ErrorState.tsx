'use client';

import { clsx } from 'clsx';
import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './Button';

type ErrorStateProps = {
    title?: ReactNode;
    message: ReactNode;
    /** Shows a "Try again" button. */
    onRetry?: () => void;
    retrying?: boolean;
    /** Inline variant for tight spaces (sidebar): no rules, small type, small button. */
    compact?: boolean;
    className?: string;
};

/** Failed-load block: same shape as EmptyState, with a danger rule and a retry action. */
export function ErrorState({
    title = 'Something went wrong',
    message,
    onRetry,
    retrying = false,
    compact = false,
    className,
}: ErrorStateProps) {
    if (compact) {
        return (
            <div
                role="alert"
                className={clsx('flex flex-col items-start gap-1 py-2 text-sm', className)}
            >
                <span className="font-semibold text-danger">{title}</span>
                <span className="text-muted">{message}</span>
                {onRetry && (
                    <Button variant="ghost" size="sm" onClick={onRetry} loading={retrying}>
                        {!retrying && <RotateCw aria-hidden size={12} />}
                        Try again
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div
            role="alert"
            className={clsx(
                'flex flex-col items-start gap-2 border-t-rule border-b-rule border-t-danger border-b-divider py-8',
                className,
            )}
        >
            <h4 className="m-0 text-danger">{title}</h4>
            <p className="text-muted m-0">{message}</p>
            {onRetry && (
                <Button variant="secondary" onClick={onRetry} loading={retrying}>
                    {!retrying && <RotateCw aria-hidden size={14} />}
                    Try again
                </Button>
            )}
        </div>
    );
}
