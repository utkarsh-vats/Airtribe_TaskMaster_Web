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
    className?: string;
};

/** Failed-load block: same shape as EmptyState, with a danger rule and a retry action. */
export function ErrorState({
    title = 'Something went wrong',
    message,
    onRetry,
    retrying = false,
    className,
}: ErrorStateProps) {
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
