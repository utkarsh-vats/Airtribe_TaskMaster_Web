import { clsx } from 'clsx';
import type { ReactNode } from 'react';

type EmptyStateProps = {
    title: ReactNode;
    body?: ReactNode;
    /** Usually a secondary Button ("Clear filters", "New project"). */
    action?: ReactNode;
    className?: string;
};

/** "Nothing here" block between 2px rules, flush left (prototype's "No tasks match"). */
export function EmptyState({ title, body, action, className }: EmptyStateProps) {
    return (
        <div
            className={clsx(
                'flex flex-col items-start gap-2 border-y-rule border-divider py-8',
                className,
            )}
        >
            <h4 className="m-0">{title}</h4>
            {body && <p className="text-muted m-0">{body}</p>}
            {action}
        </div>
    );
}
