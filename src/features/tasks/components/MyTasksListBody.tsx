'use client';

import { clsx } from 'clsx';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useId, useMemo } from 'react';

import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { errorMessage } from '@/lib/api/messages';

import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { useUrlWith } from '@/lib/hooks/useUrlWith';
import { queryView } from '@/lib/query/view';

import { useMyTasks, useMyTaskStatusCounts } from '../api';
import { useFilterBarOpen } from '../filterBarOpen';
import {
    countBarFilters,
    filtersToSearch,
    hasActiveFilters,
    parseTaskFilters,
    updateFilters,
    type TaskFilters,
} from '../filters';
import { openTaskPanel } from '../panelHistory';
import { FiltersToggle } from './FilterToggle';
import { TaskFilterBar } from './TaskFilterBar';
import { StatusFilter, TaskListSkeleton, TaskRows, TaskTable } from './TaskListView';
import { TaskSearch } from './TaskSearch';
import { TaskSortControls } from './TaskSortControls';
import { useProjects } from '@/features/projects/api';

/** What the live region announces when the list's result changes. */
const resultAnnouncement = (total: number, filtered: boolean) =>
    total === 0 && filtered ? 'No tasks match' : total === 1 ? '1 task' : `${total} tasks`;

export function MyTasksListBody() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const urlWith = useUrlWith();
    const filters = parseTaskFilters(searchParams);
    const tasks = useMyTasks(filters);
    const counts = useMyTaskStatusCounts(filters);
    const [filtersOpen, setFiltersOpen, filtersAnimated] = useFilterBarOpen();
    const filterRowId = useId();
    const projects = useProjects();
    const projectNames = useMemo(
        () => new Map((projects.data?.items ?? []).map((p) => [p.id, p.name])),
        [projects.data],
    );

    /**
     * URL for `next` filters, keeping the other params (task, new, view) apart from `params`
     * changes (null removes one).
     */
    const filterUrl = (next: TaskFilters, params: Record<string, string | null> = {}) => {
        const current = new URLSearchParams(searchParams.toString());
        for (const [key, value] of Object.entries(params)) {
            if (value === null) current.delete(key);
            else current.set(key, value);
        }
        const search = filtersToSearch(next, current);
        return search ? `${pathname}?${search}` : pathname;
    };
    // Filters, page and the open task are client state in the URL: no server round trip.
    const applyFilters = (changes: Partial<TaskFilters>) =>
        shallowUrl.push(filterUrl(updateFilters(filters, changes)));
    // Clears filters and sort.
    const clearFilters = () => shallowUrl.push(filterUrl({ page: 1 }));

    // Typing replaces the history entry instead of adding one per pause.
    const searchKey = searchParams.toString();
    const onSearch = useCallback(
        (q: string) => {
            const current = new URLSearchParams(searchKey);
            const next = updateFilters(parseTaskFilters(current), { q: q || undefined });
            const search = filtersToSearch(next, current);
            shallowUrl.replace(search ? `${pathname}?${search}` : pathname);
        },
        [pathname, searchKey],
    );

    // The task panel (?task) and the New task dialog (?new) never open together.
    const taskHref = (taskId: string) => urlWith({ task: taskId, new: null, column: null });
    // Pushes a history entry, so Back closes the panel (panelHistory.ts).
    const openTask = (taskId: string) => openTaskPanel(taskHref(taskId), taskId);
    // New task (always OPEN; My Tasks has no board columns to target).

    const toolbar = (
        <div className="flex flex-col gap-3" data-testid="task-toolbar">
            <div className="flex flex-wrap items-center gap-3">
                <StatusFilter
                    status={filters.status}
                    counts={counts}
                    onChange={(option) =>
                        applyFilters({ status: option === 'ALL' ? undefined : [option] })
                    }
                />
                <TaskSearch
                    value={filters.q ?? ''}
                    onSearch={onSearch}
                    className="min-w-[160px] flex-1 md:hidden"
                />
                {/* From 820px; below, the Filters sheet holds the filters and the sort. */}
                <FiltersToggle
                    open={filtersOpen}
                    onToggle={() => setFiltersOpen(!filtersOpen)}
                    active={countBarFilters(filters)}
                    controls={filterRowId}
                    className="hidden md:inline-flex"
                />
                <TaskSortControls
                    filters={filters}
                    onChange={applyFilters}
                    className="hidden md:flex"
                />
            </div>
            <TaskFilterBar
                id={filterRowId}
                open={filtersOpen}
                animated={filtersAnimated}
                projectId=""
                filters={filters}
                onChange={applyFilters}
                onClear={clearFilters}
            />
            {/* The status counts show the numbers; this announces a changed result. */}
            <span className="sr-only" aria-live="polite" data-testid="result-announcement">
                {tasks.data
                    ? resultAnnouncement(tasks.data.meta.total, hasActiveFilters(filters))
                    : ''}
            </span>
        </div>
    );

    const tasksView = queryView(tasks);
    if (tasksView.status === 'loading') {
        return (
            <div className="flex flex-col gap-4">
                {toolbar}
                <TaskListSkeleton />
            </div>
        );
    }

    if (tasksView.status === 'error') {
        return (
            <div className="flex flex-col gap-4">
                {toolbar}
                <ErrorState
                    title="Couldn't load tasks"
                    message={errorMessage(tasksView.error)}
                    retrying={tasks.isRefetching}
                    onRetry={() => void tasks.refetch()}
                />
            </div>
        );
    }

    const { items, meta } = tasksView.data;

    if (items.length === 0) {
        return (
            <div className="flex flex-col gap-4">
                {toolbar}
                {hasActiveFilters(filters) ? (
                    <EmptyState
                        title="No tasks match"
                        body="Clear the search or pick another status."
                        action={
                            <Button variant="secondary" onClick={clearFilters}>
                                Clear filters
                            </Button>
                        }
                    />
                ) : filters.page > 1 ? (
                    <EmptyState
                        title="Nothing on this page"
                        body="There are fewer tasks than that."
                        action={
                            <ButtonLink href={filterUrl({ ...filters, page: 1 })}>
                                Go to the first page
                            </ButtonLink>
                        }
                    />
                ) : (
                    <EmptyState
                        title="Nothing assigned to you"
                        body="Tasks assigned to you across all projects will show up here."
                    />
                )}
            </div>
        );
    }

    const dimmed = tasks.isPlaceholderData;

    return (
        <div className="flex flex-col gap-4">
            {toolbar}
            <div
                aria-busy={dimmed || undefined}
                className={clsx('transition-opacity', dimmed && 'opacity-60')}
            >
                <div className="hidden md:block" data-testid="task-table">
                    <TaskTable items={items} onOpen={openTask} projectNames={projectNames} />
                </div>
                <div className="md:hidden" data-testid="task-rows">
                    <TaskRows
                        items={items}
                        href={taskHref}
                        onOpen={openTask}
                        projectNames={projectNames}
                    />
                </div>
            </div>
            <Pagination
                page={filters.page}
                totalPages={meta.totalPages}
                onPageChange={(page) => applyFilters({ page })}
            />
        </div>
    );
}
