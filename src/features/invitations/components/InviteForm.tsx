'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input, NativeSelect } from '@/components/ui/Input';
import { RoleTag } from '@/components/ui/Tag';
import { useProjectContext } from '@/features/projects/ProjectContext';
import { isApiError } from '@/lib/api/errors';
import { applyFieldErrors } from '@/lib/api/forms';
import { notifyError } from '@/lib/api/notify';

import { useCreateInvitation } from '../api';
import { inviteSchema, type InviteInput, type InviteValues } from '../schemas';

export const NOT_ADMIN_INVITE_MESSAGE = 'Only owners and admins can invite people or change roles.';

const FIELDS = ['email', 'role'] as const;

/**
 * "Invite people" (DESIGN.md §6 Members tab, §8; prototype): Email + Role + Send invite for
 * ADMIN+. Only the OWNER may invite admins, so an ADMIN's role is a fixed Member tag. Everyone
 * else gets the prototype's muted line.
 */
export function InviteSection() {
    const { project, can } = useProjectContext();
    const headingId = useId();

    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-3">
            <h4 id={headingId} className="m-0">
                Invite people
            </h4>
            {can.manageMembers ? (
                <InviteForm projectId={project.id} canInviteAdmin={can.inviteAdmin} />
            ) : (
                <p className="text-muted m-0">{NOT_ADMIN_INVITE_MESSAGE}</p>
            )}
        </section>
    );
}

function InviteForm({ projectId, canInviteAdmin }: { projectId: string; canInviteAdmin: boolean }) {
    const create = useCreateInvitation(projectId);
    const roleLabelId = useId();
    const {
        register,
        handleSubmit,
        setError,
        reset,
        formState: { errors, isValid, isSubmitting },
    } = useForm<InviteInput, unknown, InviteValues>({
        resolver: zodResolver(inviteSchema),
        defaultValues: { email: '', role: 'MEMBER' },
        // Errors from leaving the field; Send stays disabled until it's valid.
        mode: 'onTouched',
    });

    const onSubmit = handleSubmit(async (values) => {
        try {
            await create.mutateAsync(values);
        } catch (error) {
            if (isApiError(error) && error.status === 409) {
                // Already a member, or already invited: the API says which.
                setError(
                    'email',
                    { type: 'server', message: error.message },
                    { shouldFocus: true },
                );
            } else if (isApiError(error) && error.status === 422) {
                // Anything that doesn't belong to a field still needs saying.
                if (applyFieldErrors(error, setError, {}, FIELDS).length) notifyError(error);
            } else {
                notifyError(error);
            }
            return;
        }
        toast.success(`Invitation sent to ${values.email}`);
        reset();
    });

    return (
        <form
            noValidate
            onSubmit={onSubmit}
            className="flex flex-wrap items-end gap-2"
            aria-label="Invite people"
        >
            <Field label="Email" error={errors.email?.message} className="min-w-[220px] flex-1">
                <Input
                    type="email"
                    autoComplete="off"
                    placeholder="name@company.com"
                    {...register('email')}
                />
            </Field>
            {canInviteAdmin ? (
                <Field label="Role" error={errors.role?.message} className="w-[140px]">
                    <NativeSelect {...register('role')}>
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                    </NativeSelect>
                </Field>
            ) : (
                // Admins can only invite members: shown, not chosen.
                <div className="field w-[140px]" role="group" aria-labelledby={roleLabelId}>
                    {/* Styled like a field label (.field > label), but there's no control. */}
                    <span
                        id={roleLabelId}
                        className="mb-[5px] block text-[12px] text-[color-mix(in_srgb,var(--color-text)_70%,transparent)]"
                    >
                        Role
                    </span>
                    <div className="flex min-h-9 items-center">
                        <RoleTag role="MEMBER" />
                    </div>
                </div>
            )}
            <Button
                type="submit"
                variant="primary"
                className="min-h-9"
                disabled={!isValid}
                loading={isSubmitting}
            >
                Send invite
            </Button>
        </form>
    );
}
