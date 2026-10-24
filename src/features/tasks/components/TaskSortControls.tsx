'use client';

import { clsx } from 'clsx';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { NativeSelect } from '@/components/ui/Input';

import {
    DEFAULT_ORDER,
    DEFAULT_SORT,
    effectiveOrder,
    TASK_SORTS,
    type TaskFilters,
    type TaskSort,
} from '../filters';

const SORT_LABELS: Record<TaskSort, string> = {
    createdAt: 'Created',
    updatedAt: 'Updated',
    dueDate: 'Due date',
    priority: 'Priority',
    title: 'Title',
};

/**
 * Sort field + direction toggle. Inline in the toolbar (labelled for screen readers only), or
 * `stacked` with a visible "Sort by" label in the mobile Filters sheet. `className` sets the
 * display (e.g. `hidden md:flex`).
 */
export function TaskSortControls({
    filters,
    onChange,
    stacked = false,
    className,
}: {
    filters: TaskFilters;
    onChange: (changes: Partial<TaskFilters>) => void;
    stacked?: boolean;
    className?: string;
}) {
    const order = effectiveOrder(filters);
    const sort = filters.sort ?? DEFAULT_SORT;

    const select = (
        <NativeSelect
            {...(stacked ? {} : { 'aria-label': 'Sort by', className: 'w-[140px]' })}
            value={sort}
            onChange={(event) => {
                const next = event.target.value as TaskSort;
                // A new field starts in its own natural direction.
                onChange({ sort: next === DEFAULT_SORT ? undefined : next, order: undefined });
            }}
        >
            {TASK_SORTS.map((value) => (
                <option key={value} value={value}>
                    {SORT_LABELS[value]}
                </option>
            ))}
        </NativeSelect>
    );

    return (
        <div className={clsx('items-end gap-1', className)}>
            {stacked ? (
                <Field label="Sort by" className="flex-1">
                    {select}
                </Field>
            ) : (
                select
            )}
            <Button
                variant="secondary"
                iconOnly
                aria-label={order === 'asc' ? 'Sort ascending' : 'Sort descending'}
                title={
                    order === 'asc'
                        ? 'Ascending — switch to descending'
                        : 'Descending — switch to ascending'
                }
                onClick={() => {
                    const flipped = order === 'asc' ? 'desc' : 'asc';
                    // Back to the field's default direction → drop `order` from the URL.
                    onChange({ order: flipped === DEFAULT_ORDER[sort] ? undefined : flipped });
                }}
            >
                {order === 'asc' ? (
                    <ArrowUp aria-hidden size={16} />
                ) : (
                    <ArrowDown aria-hidden size={16} />
                )}
            </Button>
        </div>
    );
}
