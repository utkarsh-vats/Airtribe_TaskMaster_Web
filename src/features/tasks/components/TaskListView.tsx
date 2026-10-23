'use client';

import { clsx } from 'clsx';
import { Columns3, List, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/Table';
import { PriorityMark, StatusTag } from '@/components/ui/Tag';
import { useProjectContext } from '@/features/projects/ProjectContext';
import { errorMessage } from '@/lib/api/messages';
import type { TaskListItem, TaskStatus } from '@/lib/api/types';
import { STATUS_LABELS, TASK_STATUSES } from '@/lib/domain';
import { shallowUrl } from '@/lib/hooks/shallowUrl';
import { useUrlWith } from '@/lib/hooks/useUrlWith';
import { isPlainClick } from '@/lib/react/plainClick';

import { useTasks, useTaskStatusCounts, type StatusCounts } from '../api';
import {
    filtersToSearch,
    hasActiveFilters,
    parseTaskFilters,
    updateFilters,
    type TaskFilters,
} from '../filters';
import { formatDue } from '../format';
import { openNewTaskDialog, openTaskPanel } from '../panelHistory';
import { NewTaskDialog } from './NewTaskDialog';
import { TaskBoard } from './TaskBoard';
import { TaskFilterBar } from './TaskFilterBar';
import { TaskPanel } from './TaskPanel';
import { TaskSearch } from './TaskSearch';

const firstLine = (text: string | null) => text?.split('\n').find((line) => line.trim()) ?? '';
const countLabel = (total: number) => (total === 1 ? '1 task' : `${total} tasks`);

type StatusOption = 'ALL' | TaskStatus;

type ViewMode = 'list' | 'board';
/** ?view=board shows the board; the list is the default and isn't written. */
const viewMode = (params: { get(name: string): string | null }): ViewMode =>
    params.get('view') === 'board' ? 'board' : 'list';

/**
 * A project's tasks (DESIGN.md §6): status segmented control with counts, search (toolbar
 * below 820px; the header search above), then a table from 820px (prototype density B, no ID
 * column — the API has no task keys) or rows below (density A). Both layouts are rendered and
 * CSS shows one, so there's no layout flash or hydration mismatch. Filters live in the URL
 * (filters.ts); selecting a task sets ?task= (7a), New task sets ?new=1 (7d). ?view=board swaps
 * the list for the board (8a), which keeps every filter but status and doesn't page.
 */
export function TaskListView() {
    const { project } = useProjectContext();
    const searchParams = useSearchParams();
    const urlWith = useUrlWith();
    const filters = parseTaskFilters(searchParams);
    const board = viewMode(searchParams) === 'board';
    // The list's own query (deduped); the board has no pages.
    const tasks = useTasks(project.id, filters, { enabled: !board });
    // Deleting the only row of a page past the first lands on the previous page.
    const previousPage = filters.page - 1;
    const afterDeleteUrl =
        !board && previousPage >= 1 && tasks.data?.items.length === 1
            ? urlWith({ task: null, page: previousPage > 1 ? String(previousPage) : null })
            : undefined;

    return (
        <>
            <TaskListBody />
            {/* ?task=<id> opens the detail sheet over the list, whatever state the list is in. */}
            <TaskPanel
                projectId={project.id}
                taskId={searchParams.get('task')}
                afterDeleteUrl={afterDeleteUrl}
            />
            <NewTaskDialog projectId={project.id} open={searchParams.get('new') === '1'} />
        </>
    );
}

function TaskListBody() {
    const { project } = useProjectContext();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const urlWith = useUrlWith();
    const filters = parseTaskFilters(searchParams);
    const view = viewMode(searchParams);
    const board = view === 'board';
    // The board makes its own column queries; the list and the status counts sit it out.
    const tasks = useTasks(project.id, filters, { enabled: !board });
    const counts = useTaskStatusCounts(project.id, filters, { enabled: !board });

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
    // Clears filters and sort, staying in the current view.
    const clearFilters = () => shallowUrl.push(filterUrl({ page: 1 }));
    // Switching keeps the filters (status too, though the board ignores it) and drops the page.
    const switchView = (next: ViewMode) =>
        shallowUrl.push(
            filterUrl({ ...filters, page: 1 }, { view: next === 'board' ? next : null }),
        );

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
    const taskHref = (taskId: string) => urlWith({ task: taskId, new: null });
    // Pushes a history entry, so Back closes the panel (panelHistory.ts).
    const openTask = (taskId: string) => openTaskPanel(taskHref(taskId), taskId);

    const newTaskButton = (
        <Button
            variant="primary"
            // Pushes an entry, so Back closes the dialog (panelHistory.ts).
            onClick={() => openNewTaskDialog(urlWith({ new: '1', task: null }))}
        >
            <Plus aria-hidden size={14} />
            New task
        </Button>
    );

    const toolbar = (
        <div className="flex flex-col gap-3" data-testid="task-toolbar">
            <div className="flex flex-wrap items-center gap-3">
                {/* On the board the columns are the statuses. */}
                {!board && (
                    <StatusFilter
                        status={filters.status}
                        counts={counts}
                        onChange={(option) =>
                            applyFilters({ status: option === 'ALL' ? undefined : [option] })
                        }
                    />
                )}
                <TaskSearch
                    value={filters.q ?? ''}
                    onSearch={onSearch}
                    className="min-w-[160px] flex-1 md:hidden"
                />
                <span className="ml-auto flex items-center gap-3">
                    <Segmented<ViewMode>
                        aria-label="View"
                        size="sm"
                        value={view}
                        onChange={switchView}
                        options={[
                            {
                                value: 'list',
                                label: (
                                    <>
                                        <List aria-hidden size={14} />
                                        List
                                    </>
                                ),
                            },
                            {
                                value: 'board',
                                label: (
                                    <>
                                        <Columns3 aria-hidden size={14} />
                                        Board
                                    </>
                                ),
                            },
                        ]}
                    />
                    {newTaskButton}
                </span>
            </div>
            <TaskFilterBar
                projectId={project.id}
                // A status in the URL doesn't narrow the board, so it isn't a filter to clear.
                filters={board ? { ...filters, status: undefined } : filters}
                onChange={applyFilters}
                onClear={clearFilters}
            />
            {!board && (
                <span className="text-muted text-sm" aria-live="polite">
                    {tasks.data ? countLabel(tasks.data.meta.total) : ' '}
                </span>
            )}
        </div>
    );

    if (board) {
        return (
            <div className="flex flex-col gap-4">
                {toolbar}
                <TaskBoard
                    projectId={project.id}
                    filters={filters}
                    taskHref={taskHref}
                    onOpen={openTask}
                    // "See all in the list": that status in the list, other filters kept.
                    listHref={(status) =>
                        filterUrl({ ...filters, status: [status], page: 1 }, { view: null })
                    }
                    onNavigate={shallowUrl.push}
                />
            </div>
        );
    }

    if (tasks.isPending) {
        return (
            <div className="flex flex-col gap-4">
                {toolbar}
                <TaskListSkeleton />
            </div>
        );
    }

    if (tasks.isError) {
        return (
            <div className="flex flex-col gap-4">
                {toolbar}
                <ErrorState
                    title="Couldn't load tasks"
                    message={errorMessage(tasks.error)}
                    retrying={tasks.isRefetching}
                    onRetry={() => void tasks.refetch()}
                />
            </div>
        );
    }

    const { items, meta } = tasks.data;

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
                        title="No tasks yet"
                        body="Create the first task for this project."
                        action={newTaskButton}
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
                    <TaskTable items={items} onOpen={openTask} />
                </div>
                <div className="md:hidden" data-testid="task-rows">
                    <TaskRows items={items} href={taskHref} onOpen={openTask} />
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

/** All · To do · In progress · Done with counts ("–" while loading). */
function StatusFilter({
    status,
    counts,
    onChange,
}: {
    status: TaskStatus[] | undefined;
    counts: StatusCounts;
    onChange: (option: StatusOption) => void;
}) {
    // A link combining several statuses matches no single option: highlight none.
    const value: StatusOption | null = !status
        ? 'ALL'
        : status.length === 1
          ? (status[0] ?? null)
          : null;
    const count = (option: StatusOption) => counts[option] ?? '–';

    return (
        <div className="max-w-full overflow-x-auto">
            <Segmented<StatusOption>
                aria-label="Status"
                value={value}
                onChange={onChange}
                options={[
                    { value: 'ALL', label: 'All', count: count('ALL') },
                    ...TASK_STATUSES.map((s) => ({
                        value: s,
                        label: STATUS_LABELS[s],
                        count: count(s),
                    })),
                ]}
            />
        </div>
    );
}

function DueCell({ task, className }: { task: TaskListItem; className?: string }) {
    const due = formatDue(task.dueDate, task.status);
    return (
        <span className={clsx(due.overdue && 'font-bold text-danger', className)}>{due.label}</span>
    );
}

function TaskTable({ items, onOpen }: { items: TaskListItem[]; onOpen: (taskId: string) => void }) {
    return (
        <Table minWidth={720} aria-label="Tasks">
            <THead>
                <tr>
                    <Th>Task</Th>
                    <Th className="w-[130px]">Status</Th>
                    <Th className="w-[110px]">Priority</Th>
                    <Th className="w-[170px]">Assignee</Th>
                    <Th className="w-[140px]">Due</Th>
                </tr>
            </THead>
            <TBody>
                {items.map((task) => {
                    const description = firstLine(task.description);
                    return (
                        <Tr key={task.id} onOpen={() => onOpen(task.id)} aria-label={task.title}>
                            <Td className="max-w-0">
                                <div className="truncate font-semibold">{task.title}</div>
                                {description && (
                                    <div className="text-muted truncate text-[13px]">
                                        {description}
                                    </div>
                                )}
                            </Td>
                            <Td>
                                <StatusTag status={task.status} />
                            </Td>
                            <Td>
                                <PriorityMark priority={task.priority} />
                            </Td>
                            <Td>
                                {task.assignee ? (
                                    <span className="flex min-w-0 items-center gap-[6px] text-[13px]">
                                        <Avatar name={task.assignee.name} size="sm" />
                                        <span className="truncate">{task.assignee.name}</span>
                                    </span>
                                ) : (
                                    <span className="text-muted text-[13px]">Unassigned</span>
                                )}
                            </Td>
                            <Td className="text-[13px]">
                                <DueCell task={task} />
                            </Td>
                        </Tr>
                    );
                })}
            </TBody>
        </Table>
    );
}

function TaskRows({
    items,
    href,
    onOpen,
}: {
    items: TaskListItem[];
    href: (taskId: string) => string;
    onOpen: (taskId: string) => void;
}) {
    return (
        <ul aria-label="Tasks" className="m-0 list-none border-t-rule border-divider p-0">
            {items.map((task) => {
                const description = firstLine(task.description);
                return (
                    <li key={task.id} className="border-b border-divider">
                        <Link
                            href={href(task.id)}
                            scroll={false}
                            onClick={(event) => {
                                // Plain clicks stay in the page; modified clicks (new tab) use the href.
                                if (!isPlainClick(event)) return;
                                event.preventDefault();
                                onOpen(task.id);
                            }}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-2 py-4 text-text no-underline hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)] hover:text-text focus-visible:[outline-offset:-2px]"
                        >
                            <span className="flex min-w-0 flex-col gap-1">
                                <PriorityMark priority={task.priority} className="text-xs" />
                                <span className="text-[16px] font-semibold break-words">
                                    {task.title}
                                </span>
                                {description && (
                                    <span className="text-muted truncate text-[13px]">
                                        {description}
                                    </span>
                                )}
                            </span>
                            <span className="flex flex-col items-end gap-2">
                                <StatusTag status={task.status} />
                                <span className="flex items-center gap-2 text-xs">
                                    <DueCell task={task} />
                                    {task.assignee ? (
                                        <Avatar name={task.assignee.name} size="sm" />
                                    ) : (
                                        <span className="sr-only">Unassigned</span>
                                    )}
                                </span>
                            </span>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}

export function TaskListSkeleton() {
    return (
        <>
            <div className="hidden md:block">
                <Table minWidth={720} aria-label="Loading tasks">
                    <THead>
                        <tr>
                            <Th>Task</Th>
                            <Th className="w-[130px]">Status</Th>
                            <Th className="w-[110px]">Priority</Th>
                            <Th className="w-[170px]">Assignee</Th>
                            <Th className="w-[140px]">Due</Th>
                        </tr>
                    </THead>
                    <TableSkeleton rows={8} cols={5} />
                </Table>
            </div>
            <div aria-busy="true" className="flex flex-col border-t-rule border-divider md:hidden">
                <span className="sr-only">Loading tasks…</span>
                {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="flex flex-col gap-2 border-b border-divider px-2 py-4">
                        <Skeleton width={70} height={12} />
                        <Skeleton width="70%" height={16} />
                        <Skeleton width="50%" />
                    </div>
                ))}
            </div>
        </>
    );
}
