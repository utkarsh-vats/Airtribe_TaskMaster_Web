'use client';

import { clsx } from 'clsx';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { PRIORITY_LABELS } from '@/lib/domain';
import { shortDate } from '@/lib/format/dates';

import type { TaskFilters } from '../filters';

export type FilterChip = {
    key: string;
    label: string;
    /** The change that removes just this filter. */
    clear: Partial<TaskFilters>;
};

/** A YYYY-MM-DD day as "Oct 20" (local midnight, so the day doesn't shift). */
const day = (value: string) => shortDate(`${value}T00:00:00`);

/** A user filter's value as shown: Me, Unassigned, or the person's name. */
const person = (value: string, nameOf: (id: string) => string) =>
    value === 'me' ? 'Me' : value === 'unassigned' ? 'Unassigned' : nameOf(value);

/**
 * One chip per active filter-row filter, in the row's order. Status and search have their own
 * controls in the toolbar, so they don't get chips.
 */
export function filterChips(filters: TaskFilters, nameOf: (id: string) => string): FilterChip[] {
    const chips: FilterChip[] = [];
    if (filters.priority?.length) {
        chips.push({
            key: 'priority',
            label: `Priority: ${filters.priority.map((p) => PRIORITY_LABELS[p]).join(', ')}`,
            clear: { priority: undefined },
        });
    }
    if (filters.assignee) {
        chips.push({
            key: 'assignee',
            label: `Assignee: ${person(filters.assignee, nameOf)}`,
            clear: { assignee: undefined },
        });
    }
    if (filters.createdBy) {
        chips.push({
            key: 'createdBy',
            label: `Created by: ${person(filters.createdBy, nameOf)}`,
            clear: { createdBy: undefined },
        });
    }
    if (filters.dueFrom || filters.dueTo) {
        const { dueFrom, dueTo } = filters;
        const range =
            dueFrom && dueTo
                ? `${day(dueFrom)} – ${day(dueTo)}`
                : dueFrom
                  ? `from ${day(dueFrom)}`
                  : `until ${day(dueTo ?? '')}`;
        chips.push({
            key: 'due',
            label: `Due: ${range}`,
            clear: { dueFrom: undefined, dueTo: undefined },
        });
    }
    if (filters.overdue) {
        chips.push({ key: 'overdue', label: 'Overdue', clear: { overdue: undefined } });
    }
    return chips;
}

/**
 * The collapsed filter row's summary: a chip per active filter, each with an × that removes
 * just that one (back to page 1), and "Clear all" for every chip at once. Renders nothing when
 * no filter is active. `className` sets the display (e.g. `hidden md:flex`). Shared by a
 * project's tasks and My tasks.
 */
export function ActiveFilterChips({
    filters,
    nameOf,
    onChange,
    className,
}: {
    filters: TaskFilters;
    /** A user id's display name (assignee, created by). */
    nameOf: (id: string) => string;
    onChange: (changes: Partial<TaskFilters>) => void;
    className?: string;
}) {
    const chips = filterChips(filters, nameOf);
    if (!chips.length) return null;

    return (
        <div
            role="group"
            aria-label="Active filters"
            data-testid="filter-chips"
            className={clsx('flex-wrap items-center gap-2', className)}
        >
            {chips.map((chip) => (
                <span key={chip.key} className="tag tag-neutral gap-1 pr-1 text-[12px]">
                    {chip.label}
                    <button
                        type="button"
                        className="tm-chip-remove"
                        aria-label={`Remove ${chip.label}`}
                        onClick={() => onChange(chip.clear)}
                    >
                        <X aria-hidden size={12} />
                    </button>
                </span>
            ))}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(Object.assign({}, ...chips.map((chip) => chip.clear)))}
            >
                Clear all
            </Button>
        </div>
    );
}
