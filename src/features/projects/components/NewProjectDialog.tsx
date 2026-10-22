'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions, DialogClose } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { FormAlert, useFormAlert } from '@/components/ui/FormAlert';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toaster';
import { hasCode, ERROR_CODES } from '@/lib/api/errors';
import { applyFieldErrors } from '@/lib/api/forms';
import { errorMessage } from '@/lib/api/messages';

import { useCreateProject } from '../api';
import { projectSchema, type ProjectFormInput, type ProjectFormValues } from '../schemas';

const FIELDS = ['name', 'description'] as const;

export const PROJECT_CREATED_MESSAGE = 'Project created';

type NewProjectDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/** "New project": name + description → POST /projects → the new project's tasks. */
export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="New project" width={520}>
            {/* Its own component so the form resets every time the dialog opens. */}
            <NewProjectForm />
        </Dialog>
    );
}

function NewProjectForm() {
    const router = useRouter();
    const createProject = useCreateProject();
    const { message: formError, show: showFormError, ref: formErrorRef } = useFormAlert();
    const [leaving, setLeaving] = useState(false);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors },
    } = useForm<ProjectFormInput, unknown, ProjectFormValues>({
        resolver: zodResolver(projectSchema),
        defaultValues: { name: '', description: '' },
    });

    const onSubmit = handleSubmit(async (values) => {
        showFormError(null);
        try {
            const project = await createProject.mutateAsync(values);
            setLeaving(true);
            toast.success(PROJECT_CREATED_MESSAGE);
            router.push(`/dashboard/projects/${project.id}/tasks`);
        } catch (error) {
            if (hasCode(error, ERROR_CODES.VALIDATION_ERROR)) {
                const unplaced = applyFieldErrors(error, setError, {}, FIELDS);
                if (unplaced.length) showFormError(unplaced.map((d) => d.message).join(' '));
                return;
            }
            showFormError(errorMessage(error));
        }
    });

    const pending = createProject.isPending || leaving;

    return (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
            <FormAlert message={formError} ref={formErrorRef} />
            <Field label="Name" required error={errors.name?.message}>
                <Input autoFocus {...register('name')} />
            </Field>
            <Field
                label="Description"
                hint="Optional. What is this project for?"
                error={errors.description?.message}
            >
                <Textarea autoGrow {...register('description')} />
            </Field>
            <DialogActions>
                <DialogClose asChild>
                    <Button variant="secondary" disabled={pending}>
                        Cancel
                    </Button>
                </DialogClose>
                <Button type="submit" variant="primary" loading={pending}>
                    Create project
                </Button>
            </DialogActions>
        </form>
    );
}
