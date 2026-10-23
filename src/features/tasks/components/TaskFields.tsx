'use client';

import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, FieldError } from '@/components/ui/Field';
import { DateField, NativeSelect } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useProjectMembers } from '@/features/members/api';
import { ERROR_CODES, hasCode } from '@/lib/api/errors';
import type { Task } from '@/lib/api/types';
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from '@/lib/domain';

import { useUpdateTask, type TaskPatch, type TaskUpdate } from '../api';
import { fromDueInstant, toDueInstant } from '../due';
import { formatDue } from '../format';

/*
 * Editable task fields for the panel (DESIGN.md §6, §7). Each field has its own mutation, so
 * its spinner / disabled state is its own and the other fields stay usable while it saves.
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const EMPTY_TITLE_MESSAGE = "Title can't be empty";

type FieldProps = { projectId: string; task: Task };

/** Save one field; a 422 becomes this field's message (the hook toasts everything else). */
function useFieldSave(projectId: string, taskId: string) {
    const update = useUpdateTask(projectId, taskId);
    const [error, setError] = useState<string | null>(null);

    const save = async (change: TaskUpdate) => {
        setError(null);
        try {
            await update.mutateAsync(change);
            return true;
        } catch (failure) {
            if (hasCode(failure, ERROR_CODES.VALIDATION_ERROR)) {
                const key = Object.keys(change.patch)[0];
                const detail = failure.details.find((d) => d.path === key);
                setError(detail?.message ?? failure.message);
            }
            return false;
        }
    };

    return { save, pending: update.isPending, error, setError };
}

/** Label with the field's own saving spinner (the spinner isn't part of the accessible name). */
function SavingLabel({ text, pending }: { text: string; pending: boolean }) {
    return (
        <span className="inline-flex items-center gap-1">
            {text}
            {pending && <Spinner size={11} />}
        </span>
    );
}

// — title ————————————————————————————————————————————————————————————————————————————————

export function TitleField({ projectId, task }: FieldProps) {
    const { save, pending, error, setError } = useFieldSave(projectId, task.id);
    const [draft, setDraft] = useState(task.title);
    const [lastTitle, setLastTitle] = useState(task.title);
    // Follow the server (or a rollback) unless the user has typed something else meanwhile.
    if (task.title !== lastTitle) {
        setLastTitle(task.title);
        if (draft === lastTitle) setDraft(task.title);
    }
    const dirty = draft !== task.title;

    const commit = async () => {
        const title = draft.trim();
        if (title === task.title) {
            setDraft(task.title);
            return;
        }
        if (!title) {
            setDraft(task.title);
            setError(EMPTY_TITLE_MESSAGE);
            return;
        }
        setDraft(title);
        await save({ patch: { title } });
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
                <Textarea
                    autoGrow
                    rows={1}
                    aria-label="Title"
                    maxLength={TITLE_MAX}
                    value={draft}
                    disabled={pending}
                    aria-busy={pending || undefined}
                    aria-invalid={error ? true : undefined}
                    data-keep-open-on-escape={dirty || undefined}
                    // A single line: newlines (typed or pasted) become spaces.
                    onChange={(event) => {
                        setError(null);
                        setDraft(event.target.value.replace(/\s*\n\s*/g, ' '));
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur(); // saves via onBlur
                        } else if (event.key === 'Escape') {
                            // With unsaved text the panel stays open (Sheet) and Esc reverts.
                            event.preventDefault();
                            setDraft(task.title);
                            setError(null);
                            event.currentTarget.dataset.reverted = 'true';
                            event.currentTarget.blur();
                        }
                    }}
                    onBlur={(event) => {
                        if (event.currentTarget.dataset.reverted) {
                            delete event.currentTarget.dataset.reverted;
                            return;
                        }
                        void commit();
                    }}
                    className="min-h-0 flex-1 border-transparent bg-transparent px-1 py-0 font-heading text-[26px] leading-[1.15] font-extrabold hover:border-divider focus-visible:border-accent"
                />
                {pending && <Spinner size={16} className="mt-2" />}
            </div>
            {error && <FieldError>{error}</FieldError>}
        </div>
    );
}

// — selects ——————————————————————————————————————————————————————————————————————————————

function SelectField({
    label,
    pending,
    error,
    value,
    onChange,
    children,
}: {
    label: string;
    pending: boolean;
    error: string | null;
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
}) {
    return (
        <Field label={<SavingLabel text={label} pending={pending} />} error={error ?? undefined}>
            <NativeSelect
                value={value}
                disabled={pending}
                aria-busy={pending || undefined}
                onChange={(event) => onChange(event.target.value)}
            >
                {children}
            </NativeSelect>
        </Field>
    );
}

export function StatusField({ projectId, task }: FieldProps) {
    const { save, pending, error } = useFieldSave(projectId, task.id);
    return (
        <SelectField
            label="Status"
            pending={pending}
            error={error}
            value={task.status}
            onChange={(value) => void save({ patch: { status: value as Task['status'] } })}
        >
            {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                </option>
            ))}
        </SelectField>
    );
}

export function PriorityField({ projectId, task }: FieldProps) {
    const { save, pending, error } = useFieldSave(projectId, task.id);
    return (
        <SelectField
            label="Priority"
            pending={pending}
            error={error}
            value={task.priority}
            onChange={(value) => void save({ patch: { priority: value as Task['priority'] } })}
        >
            {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                </option>
            ))}
        </SelectField>
    );
}

export function AssigneeField({ projectId, task }: FieldProps) {
    const { save, pending, error } = useFieldSave(projectId, task.id);
    const members = useProjectMembers(projectId);
    const people = [...(members.data ?? [])]
        .map((member) => member.user)
        .sort((a, b) => a.name.localeCompare(b.name));
    // Someone no longer in the project (or members still loading) still needs an option.
    if (task.assignee && !people.some((person) => person.id === task.assignee?.id)) {
        people.push({ ...task.assignee, avatarUrl: null });
    }

    return (
        <SelectField
            label="Assignee"
            pending={pending}
            error={error}
            value={task.assignee?.id ?? ''}
            onChange={(value) => {
                const person = people.find((p) => p.id === value);
                void save({
                    patch: { assigneeId: value || null },
                    assignee: person ? { id: person.id, name: person.name } : null,
                });
            }}
        >
            <option value="">Unassigned</option>
            {people.map((person) => (
                <option key={person.id} value={person.id}>
                    {person.name}
                </option>
            ))}
        </SelectField>
    );
}

// — due ——————————————————————————————————————————————————————————————————————————————————

export function DueField({ projectId, task }: FieldProps) {
    const { save, pending, error } = useFieldSave(projectId, task.id);
    const due = formatDue(task.dueDate, task.status);
    const setDue = (patch: TaskPatch) => void save({ patch });

    return (
        <Field label={<SavingLabel text="Due" pending={pending} />} error={error ?? undefined}>
            <div className="flex items-center gap-1">
                <DateField
                    value={task.dueDate ? fromDueInstant(task.dueDate) : ''}
                    disabled={pending}
                    aria-busy={pending || undefined}
                    onChange={(event) =>
                        setDue({
                            dueDate: event.target.value ? toDueInstant(event.target.value) : null,
                        })
                    }
                    className={clsx(due.overdue && 'border-danger text-danger')}
                />
                {task.dueDate && (
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => setDue({ dueDate: null })}
                    >
                        Clear
                    </Button>
                )}
            </div>
            {due.overdue && (
                <span className="mt-1 block text-[12px] font-bold text-danger">Overdue</span>
            )}
        </Field>
    );
}

// — description ——————————————————————————————————————————————————————————————————————————

export function DescriptionField({ projectId, task }: FieldProps) {
    const { save, pending, error, setError } = useFieldSave(projectId, task.id);
    const saved = task.description ?? '';
    const [draft, setDraft] = useState(saved);
    const [lastSaved, setLastSaved] = useState(saved);
    const dirty = draft !== saved;
    // Adopt server changes unless there are unsaved edits (long text is never overwritten).
    if (saved !== lastSaved) {
        setLastSaved(saved);
        if (draft === lastSaved) setDraft(saved);
    }

    return (
        <Field
            label={<SavingLabel text="Description" pending={pending} />}
            error={error ?? undefined}
        >
            <Textarea
                autoGrow
                maxLength={DESCRIPTION_MAX}
                placeholder="Add details, links, acceptance criteria"
                value={draft}
                disabled={pending}
                aria-busy={pending || undefined}
                data-keep-open-on-escape={dirty || undefined}
                onChange={(event) => {
                    setError(null);
                    setDraft(event.target.value);
                }}
            />
            {dirty && (
                <div className="mt-2 flex gap-2">
                    <Button
                        variant="primary"
                        size="sm"
                        loading={pending}
                        onClick={async () => {
                            const description = draft.trim() ? draft : null;
                            if (await save({ patch: { description } })) setDraft(description ?? '');
                        }}
                    >
                        Save
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => setDraft(saved)}
                    >
                        Cancel
                    </Button>
                </div>
            )}
        </Field>
    );
}
