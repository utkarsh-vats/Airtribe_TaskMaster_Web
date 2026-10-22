'use client';

import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { DateField, NativeSelect } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Sheet } from '@/components/ui/Sheet';
import { useProjectMembers } from '@/features/members/api';
import type { TaskPriority } from '@/lib/api/types';
import { PRIORITY_LABELS, TASK_PRIORITIES } from '@/lib/domain';

import {
    countBarFilters,
    DEFAULT_ORDER,
    DEFAULT_SORT,
    effectiveOrder,
    hasAnyListParams,
    TASK_SORTS,
    type TaskFilters,
    type TaskSort,
} from '../filters';

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }));

const SORT_LABELS: Record<TaskSort, string> = {
    createdAt: 'Created',
    updatedAt: 'Updated',
    dueDate: 'Due date',
    priority: 'Priority',
    title: 'Title',
};

type FilterBarProps = {
    projectId: string;
    filters: TaskFilters;
    onChange: (changes: Partial<TaskFilters>) => void;
    /** Clears every filter and the sort. */
    onClear: () => void;
};

/**
 * Advanced filters and sort (DESIGN.md §5): a wrapping row from 820px; below that a "Filters"
 * button (badge = active filters) opening a sheet with the same controls, applied as they change.
 */
export function TaskFilterBar(props: FilterBarProps) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const active = countBarFilters(props.filters);

    return (
        <>
            <div className="hidden flex-wrap items-end gap-3 md:flex" data-testid="filter-row">
                <FilterControls {...props} />
            </div>

            <div className="md:hidden">
                <Button
                    variant="secondary"
                    aria-label={active ? `Filters, ${active} active` : 'Filters'}
                    onClick={() => setSheetOpen(true)}
                >
                    <SlidersHorizontal aria-hidden size={14} />
                    Filters
                    {active > 0 && (
                        <span
                            aria-hidden
                            className="tm-count-badge ml-1"
                            data-testid="filter-badge"
                        >
                            {active}
                        </span>
                    )}
                </Button>
                <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Filters">
                    <div className="flex flex-col gap-4">
                        <FilterControls {...props} stacked />
                        {/* Wide button: label flush left (design system). */}
                        <Button variant="primary" block onClick={() => setSheetOpen(false)}>
                            Done
                        </Button>
                    </div>
                </Sheet>
            </div>
        </>
    );
}

function FilterControls({
    projectId,
    filters,
    onChange,
    onClear,
    stacked = false,
}: FilterBarProps & { stacked?: boolean }) {
    const members = useProjectMembers(projectId);
    const overdueId = useId();
    const sorted = [...(members.data ?? [])].sort((a, b) => a.user.name.localeCompare(b.user.name));
    const knownIds = new Set(sorted.map((member) => member.user.id));
    const order = effectiveOrder(filters);
    const sort = filters.sort ?? DEFAULT_SORT;
    const width = stacked ? 'w-full' : '';

    /** A user id in the URL that isn't (or is no longer) a member still needs an option. */
    const unknownOption = (value: string | undefined) =>
        value &&
        value !== 'me' &&
        value !== 'unassigned' &&
        members.data &&
        !knownIds.has(value) ? (
            <option value={value}>Former member</option>
        ) : null;

    return (
        <>
            {/* The trigger's own text names it ("Priority: …"); the caption just lines it up. */}
            <div className={`flex flex-col ${width}`}>
                <span aria-hidden className="mb-[5px] text-[12px] opacity-70">
                    Priority
                </span>
                <MultiSelect<TaskPriority>
                    label="Priority"
                    options={PRIORITY_OPTIONS}
                    value={filters.priority ?? []}
                    onChange={(priority) => onChange({ priority })}
                    className={stacked ? 'w-full max-w-none' : ''}
                />
            </div>

            <Field label="Assignee" className={stacked ? 'w-full' : 'w-[170px]'}>
                <NativeSelect
                    value={filters.assignee ?? ''}
                    onChange={(event) => onChange({ assignee: event.target.value || undefined })}
                >
                    <option value="">Anyone</option>
                    <option value="me">Me</option>
                    <option value="unassigned">Unassigned</option>
                    {sorted.map((member) => (
                        <option key={member.user.id} value={member.user.id}>
                            {member.user.name}
                        </option>
                    ))}
                    {unknownOption(filters.assignee)}
                </NativeSelect>
            </Field>

            <Field label="Created by" className={stacked ? 'w-full' : 'w-[170px]'}>
                <NativeSelect
                    value={filters.createdBy ?? ''}
                    onChange={(event) => onChange({ createdBy: event.target.value || undefined })}
                >
                    <option value="">Anyone</option>
                    <option value="me">Me</option>
                    {sorted.map((member) => (
                        <option key={member.user.id} value={member.user.id}>
                            {member.user.name}
                        </option>
                    ))}
                    {unknownOption(filters.createdBy)}
                </NativeSelect>
            </Field>

            <Field label="Due from" className={stacked ? 'w-full' : 'w-[150px]'}>
                <DateField
                    value={filters.dueFrom ?? ''}
                    max={filters.dueTo}
                    onChange={(event) => onChange({ dueFrom: event.target.value || undefined })}
                />
            </Field>
            <Field label="Due to" className={stacked ? 'w-full' : 'w-[150px]'}>
                <DateField
                    value={filters.dueTo ?? ''}
                    min={filters.dueFrom}
                    onChange={(event) => onChange({ dueTo: event.target.value || undefined })}
                />
            </Field>

            <label
                htmlFor={overdueId}
                // Bottom-aligned in the row; left-aligned in the sheet's column.
                className={`tm-option min-h-[36px] ${stacked ? 'self-start' : 'self-end'}`}
            >
                <input
                    id={overdueId}
                    type="checkbox"
                    className="check"
                    checked={Boolean(filters.overdue)}
                    onChange={(event) => onChange({ overdue: event.target.checked || undefined })}
                />
                Overdue only
            </label>

            <div className={`flex items-end gap-1 ${stacked ? 'w-full' : ''}`}>
                <Field label="Sort by" className={stacked ? 'flex-1' : 'w-[140px]'}>
                    <NativeSelect
                        value={sort}
                        onChange={(event) => {
                            const next = event.target.value as TaskSort;
                            // A new field starts in its own natural direction.
                            onChange({
                                sort: next === DEFAULT_SORT ? undefined : next,
                                order: undefined,
                            });
                        }}
                    >
                        {TASK_SORTS.map((value) => (
                            <option key={value} value={value}>
                                {SORT_LABELS[value]}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
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

            {hasAnyListParams(filters) && (
                <Button
                    variant="ghost"
                    onClick={onClear}
                    className={stacked ? 'self-start' : 'self-end'}
                >
                    Clear filters
                </Button>
            )}
        </>
    );
}
