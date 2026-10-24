'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { DateField, NativeSelect } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Sheet } from '@/components/ui/Sheet';
import { useProjectMembers } from '@/features/members/api';
import type { TaskPriority } from '@/lib/api/types';
import { PRIORITY_LABELS, TASK_PRIORITIES } from '@/lib/domain';

import { countBarFilters, hasAnyListParams, type TaskFilters } from '../filters';
import { ActiveFilterChips } from './ActiveFilterChips';
import { FiltersCollapse } from './FilterToggle';
import { TaskSortControls } from './TaskSortControls';

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }));

type FilterBarProps = {
    projectId: string;
    filters: TaskFilters;
    onChange: (changes: Partial<TaskFilters>) => void;
    /** Clears every filter and the sort. */
    onClear: () => void;
};

/**
 * Advanced filters (DESIGN.md §5). From 820px a row that the toolbar's FiltersToggle opens and
 * closes (`open`, `id`); while it's closed, active filters show as removable chips. Sort lives
 * in the toolbar there (TaskSortControls). Below 820px a "Filters" button (badge = active
 * filters) opens a sheet with the same controls plus sort, applied as they change.
 */
export function TaskFilterBar({
    open,
    animated,
    id,
    ...props
}: FilterBarProps & {
    /** Whether the wide-screen row is open. */
    open: boolean;
    /** False until the user toggles (no slide-in on load). */
    animated: boolean;
    /** The row's id, for the toggle's aria-controls. */
    id: string;
}) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const members = useProjectMembers(props.projectId);
    const active = countBarFilters(props.filters);

    const nameOf = (userId: string) => {
        if (!members.data) return '…';
        const member = members.data.find((m) => m.user.id === userId);
        return member?.user.name ?? 'Former member';
    };

    return (
        <>
            <FiltersCollapse
                id={id}
                open={open}
                animated={animated}
                gap="var(--space-3)"
                className="hidden md:grid"
            >
                <div className="flex flex-wrap items-end gap-3" data-testid="filter-row">
                    <FilterControls {...props} />
                </div>
            </FiltersCollapse>
            {!open && (
                <ActiveFilterChips
                    filters={props.filters}
                    nameOf={nameOf}
                    onChange={props.onChange}
                    className="hidden md:flex"
                />
            )}

            <div className="md:hidden">
                <Button
                    variant="secondary"
                    aria-haspopup="dialog"
                    aria-label={active ? `Filters, ${active} active` : 'Filters'}
                    data-testid="filter-sheet-button"
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
                        <FilterControls
                            {...props}
                            stacked
                            sort={
                                <TaskSortControls
                                    filters={props.filters}
                                    onChange={props.onChange}
                                    stacked
                                    className="flex w-full"
                                />
                            }
                        />
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
    sort,
}: FilterBarProps & { stacked?: boolean; sort?: ReactNode }) {
    const members = useProjectMembers(projectId);
    const overdueId = useId();
    const sorted = [...(members.data ?? [])].sort((a, b) => a.user.name.localeCompare(b.user.name));
    const knownIds = new Set(sorted.map((member) => member.user.id));
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

            {sort}

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
