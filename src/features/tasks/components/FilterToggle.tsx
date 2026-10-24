'use client';

import { clsx } from 'clsx';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * The toolbar's "Filters" button for the collapsible filter row (≥ 820px): badge = active
 * filters, chevron turns when open. Shared by a project's tasks and My tasks.
 */
export function FiltersToggle({
    open,
    onToggle,
    active,
    controls,
    className,
}: {
    open: boolean;
    onToggle: () => void;
    /** Active filters in the row. */
    active: number;
    /** The id of the FiltersCollapse it opens. */
    controls: string;
    className?: string;
}) {
    return (
        <Button
            variant="secondary"
            aria-expanded={open}
            aria-controls={controls}
            aria-label={active ? `Filters, ${active} active` : 'Filters'}
            data-testid="filter-toggle"
            onClick={onToggle}
            className={className}
        >
            <SlidersHorizontal aria-hidden size={14} />
            Filters
            {active > 0 && (
                <span aria-hidden className="tm-count-badge ml-1" data-testid="filter-badge">
                    {active}
                </span>
            )}
            <ChevronDown
                aria-hidden
                size={14}
                className={clsx(
                    'transition-transform duration-200 motion-reduce:transition-none',
                    open && 'rotate-180',
                )}
            />
        </Button>
    );
}

/**
 * The row FiltersToggle shows and hides: height and opacity animate (instantly under reduced
 * motion), and while closed it's inert and takes no room — `gap` is the parent's flex gap,
 * which it cancels.
 */
export function FiltersCollapse({
    id,
    open,
    animated,
    gap,
    className,
    children,
}: {
    id: string;
    open: boolean;
    /** False until the user toggles, so a remembered open row doesn't slide in on load. */
    animated: boolean;
    /** The parent's gap as a CSS length. */
    gap?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            id={id}
            data-state={open ? 'open' : 'closed'}
            data-animated={animated || undefined}
            inert={!open}
            // inert hides it from assistive tech too; aria-hidden for tools that don't know inert.
            aria-hidden={!open || undefined}
            className={clsx('tm-collapse', className)}
            style={gap ? ({ '--tm-collapse-gap': gap } as CSSProperties) : undefined}
        >
            <div>
                {/* Room for focus rings inside the clip; the margins cancel it out. */}
                <div className="p-1">{children}</div>
            </div>
        </div>
    );
}
