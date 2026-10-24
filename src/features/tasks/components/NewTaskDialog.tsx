'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { FormAlert, useFormAlert } from '@/components/ui/FormAlert';
import { DateField, Input, NativeSelect } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toaster';
import { AiDraftRow } from '@/features/ai/components/AiDraftRow';
import { useProjectMembers } from '@/features/members/api';
import { ERROR_CODES, hasCode } from '@/lib/api/errors';
import { applyFieldErrors } from '@/lib/api/forms';
import { errorMessage } from '@/lib/api/messages';
import type { TaskStatus } from '@/lib/api/types';
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES } from '@/lib/domain';
import { useUrlWith } from '@/lib/hooks/useUrlWith';
import { mergeRefs } from '@/lib/react/mergeRefs';

import { useCreateTask, useUpdateTask, type CreateTaskInput } from '../api';
import { closeNewTaskDialog, openTaskPanel } from '../panelHistory';
import { newTaskSchema, type NewTaskFormInput, type NewTaskFormValues } from '../schemas';

export const TASK_CREATED_MESSAGE = 'Task created';
export const taskNotMovedMessage = (column: TaskStatus) =>
    `Task created in To do — couldn't move it to ${STATUS_LABELS[column]}`;

const FIELDS = ['title', 'description', 'priority', 'assignee', 'due'] as const;
/** Request fields → form fields, for a 422's details. */
const FIELD_MAP = { assigneeId: 'assignee', dueDate: 'due' } as const;

type NewTaskFormHandle = { isDirty: () => boolean };

/**
 * "New task" (DESIGN.md §6), open while ?new=1 is in the URL. Closing with a title or
 * description typed asks before discarding them; closing removes ?new (and ?column) without
 * leaving an extra history entry (panelHistory.ts). A board column's Add task sets `column`:
 * the API creates every task as To do, so another column is a PATCH after the POST (§5).
 */
export function NewTaskDialog({
    projectId,
    open,
    column = 'OPEN',
}: {
    projectId: string;
    open: boolean;
    column?: TaskStatus;
}) {
    const urlWith = useUrlWith();
    const [form, setForm] = useState<NewTaskFormHandle | null>(null);
    const [confirmDiscard, setConfirmDiscard] = useState(false);

    const close = () => {
        setConfirmDiscard(false);
        closeNewTaskDialog(urlWith({ new: null, column: null }));
    };
    // Cancel, Esc, the overlay and X all come here.
    const requestClose = () => {
        if (form?.isDirty()) setConfirmDiscard(true);
        else close();
    };

    return (
        <>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!next) requestClose();
                }}
                title="New task"
                description={
                    column === 'OPEN' ? undefined : (
                        <span className="text-muted">Will be added to {STATUS_LABELS[column]}</span>
                    )
                }
                width={580}
            >
                {/* Its own component so the form resets every time the dialog opens. */}
                <NewTaskForm
                    ref={setForm}
                    projectId={projectId}
                    column={column}
                    onCancel={requestClose}
                    onCreated={close}
                />
            </Dialog>
            <ConfirmDialog
                open={confirmDiscard}
                onOpenChange={setConfirmDiscard}
                title="Discard this task?"
                description="What you've typed will be lost."
                confirmLabel="Discard"
                cancelLabel="Keep editing"
                destructive
                onConfirm={close}
            />
        </>
    );
}

function NewTaskForm({
    ref,
    projectId,
    column,
    onCancel,
    onCreated,
}: {
    ref: Ref<NewTaskFormHandle>;
    projectId: string;
    column: TaskStatus;
    onCancel: () => void;
    onCreated: () => void;
}) {
    const urlWith = useUrlWith();
    const createTask = useCreateTask(projectId);
    const updateTask = useUpdateTask(projectId);
    const members = useProjectMembers(projectId);
    const { message: formError, show: showFormError, ref: formErrorRef } = useFormAlert();
    const [leaving, setLeaving] = useState(false);
    const {
        register,
        handleSubmit,
        setError,
        getValues,
        setValue,
        control,
        formState: { errors, isSubmitting },
    } = useForm<NewTaskFormInput, unknown, NewTaskFormValues>({
        resolver: zodResolver(newTaskSchema),
        defaultValues: { title: '', description: '', priority: 'MEDIUM', assignee: '', due: '' },
    });

    useImperativeHandle(
        ref,
        () => ({
            isDirty: () => {
                const { title, description } = getValues();
                return title.trim() !== '' || description.trim() !== '';
            },
        }),
        [getValues],
    );

    // The description element, for focus and the cursor after an AI draft.
    const descriptionEl = useRef<HTMLTextAreaElement>(null);
    const { ref: descriptionRef, ...descriptionField } = register('description');
    const putDescription = (text: string) => {
        setValue('description', text, { shouldDirty: true });
        const el = descriptionEl.current;
        if (!el) return;
        // A programmatic value doesn't fire `input`: let the auto-grow textarea refit.
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
        el.setSelectionRange(text.length, text.length);
    };

    const people = (members.data ?? [])
        .map((member) => member.user)
        .sort((a, b) => a.name.localeCompare(b.name));

    const onSubmit = handleSubmit(async (values) => {
        showFormError(null);
        // Only the fields that are set.
        const body: CreateTaskInput = {
            title: values.title,
            priority: values.priority,
            ...(values.description ? { description: values.description } : {}),
            ...(values.assignee ? { assigneeId: values.assignee } : {}),
            ...(values.due ? { dueDate: values.due } : {}),
        };
        let task;
        try {
            task = await createTask.mutateAsync(body);
        } catch (error) {
            if (hasCode(error, ERROR_CODES.VALIDATION_ERROR)) {
                const unplaced = applyFieldErrors(error, setError, FIELD_MAP, FIELDS);
                if (unplaced.length) showFormError(unplaced.map((d) => d.message).join(' '));
                return;
            }
            showFormError(errorMessage(error));
            return;
        }
        const { id } = task;
        const open = {
            label: 'Open',
            onClick: () => openTaskPanel(urlWith({ task: id, new: null, column: null }), id),
        };
        // Created as To do; move it to the column it was added from. The task exists either way,
        // so a failed move still closes the dialog (the columns refetch on settle).
        let moved = true;
        if (column !== 'OPEN') {
            moved = await updateTask
                .mutateAsync({ taskId: id, patch: { status: column }, silent: true })
                .then(
                    () => true,
                    () => false,
                );
        }
        setLeaving(true);
        onCreated();
        if (moved) toast.success(TASK_CREATED_MESSAGE, { action: open });
        else toast.error(taskNotMovedMessage(column), { action: open });
    });

    // Through the POST and, for another column, the PATCH after it.
    const pending = isSubmitting || leaving;

    return (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
            <FormAlert message={formError} ref={formErrorRef} />
            <Field label="Title" required error={errors.title?.message}>
                <Input autoFocus placeholder="What needs doing?" {...register('title')} />
            </Field>
            <AiDraft control={control} onDescription={putDescription} />
            <Field label="Description" error={errors.description?.message}>
                <Textarea
                    autoGrow
                    placeholder="Details, links, acceptance criteria"
                    ref={mergeRefs(descriptionEl, descriptionRef)}
                    {...descriptionField}
                />
            </Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Priority" error={errors.priority?.message}>
                    <NativeSelect {...register('priority')}>
                        {TASK_PRIORITIES.map((priority) => (
                            <option key={priority} value={priority}>
                                {PRIORITY_LABELS[priority]}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
                <Field label="Assignee" error={errors.assignee?.message}>
                    <NativeSelect {...register('assignee')}>
                        <option value="">Unassigned</option>
                        {people.map((person) => (
                            <option key={person.id} value={person.id}>
                                {person.name}
                            </option>
                        ))}
                    </NativeSelect>
                </Field>
                <Field label="Due date" error={errors.due?.message}>
                    <DateField {...register('due')} />
                </Field>
            </div>
            <DialogActions>
                <Button variant="secondary" disabled={pending} onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" variant="primary" loading={pending}>
                    Create task
                </Button>
            </DialogActions>
        </form>
    );
}

/** The AI row, watching title and description on its own so typing doesn't re-render the form. */
function AiDraft({
    control,
    onDescription,
}: {
    control: Control<NewTaskFormInput, unknown, NewTaskFormValues>;
    onDescription: (text: string) => void;
}) {
    const [title, description] = useWatch({ control, name: ['title', 'description'] });
    return <AiDraftRow title={title} description={description} onDescription={onDescription} />;
}
