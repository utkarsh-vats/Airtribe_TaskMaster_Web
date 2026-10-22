'use client';

import { clsx } from 'clsx';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Avatar } from '@/components/ui/Avatar';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableSkeleton, TBody, Td, Th, THead, Tr } from '@/components/ui/Table';
import { PriorityMark, StatusTag } from '@/components/ui/Tag';
import { useProjectContext } from '@/features/projects/ProjectContext';
import { errorMessage } from '@/lib/api/messages';
import type { TaskListItem } from '@/lib/api/types';
import { pageParam, useUrlWith } from '@/lib/hooks/useUrlWith';

import { TASKS_PAGE_SIZE, useTasks } from '../api';
import { formatDue } from '../format';

const firstLine = (text: string | null) => text?.split('\n').find((line) => line.trim()) ?? '';
const countLabel = (total: number) => (total === 1 ? '1 task' : `${total} tasks`);

/**
 * A project's tasks (DESIGN.md §6): a table from 820px (prototype density B, no ID column —
 * the API has no task keys), rows below that (density A). Both are rendered and CSS shows one,
 * so there's no layout flash or hydration mismatch. Selecting a task sets ?task= (step 7a
 * opens the panel); New task sets ?new=1 (step 7d).
 */
export function TaskListView() {
    const { project } = useProjectContext();
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlWith = useUrlWith();
    const page = pageParam(searchParams.get('page'));
    const tasks = useTasks(project.id, { page, limit: TASKS_PAGE_SIZE });

    // The task panel (?task) and the New task dialog (?new) never open together.
    const taskHref = (taskId: string) => urlWith({ task: taskId, new: null });
    const openTask = (taskId: string) => router.push(taskHref(taskId), { scroll: false });

    const newTaskButton = (
        <Button
            variant="primary"
            onClick={() => router.push(urlWith({ new: '1', task: null }), { scroll: false })}
        >
            <Plus aria-hidden size={14} />
            New task
        </Button>
    );

    const toolbar = (
        <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted text-sm" aria-live="polite">
                {tasks.data ? countLabel(tasks.data.meta.total) : ' '}
            </span>
            <span className="ml-auto">{newTaskButton}</span>
        </div>
    );

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
                {page > 1 ? (
                    <EmptyState
                        title="Nothing on this page"
                        body="There are fewer tasks than that."
                        action={
                            <ButtonLink href={urlWith({ page: null })}>
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
                    <TaskRows items={items} href={taskHref} />
                </div>
            </div>
            <Pagination
                page={page}
                totalPages={meta.totalPages}
                onPageChange={(next) =>
                    router.push(urlWith({ page: next === 1 ? null : String(next) }))
                }
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

function TaskRows({ items, href }: { items: TaskListItem[]; href: (taskId: string) => string }) {
    return (
        <ul aria-label="Tasks" className="m-0 list-none border-t-rule border-divider p-0">
            {items.map((task) => {
                const description = firstLine(task.description);
                return (
                    <li key={task.id} className="border-b border-divider">
                        <Link
                            href={href(task.id)}
                            scroll={false}
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
