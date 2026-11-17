'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { toast } from '@/components/ui/Toaster';
import { PasswordInput } from '@/features/auth/components/PasswordInput';
import { ERROR_CODES, hasCode } from '@/lib/api/errors';
import { applyFieldErrors } from '@/lib/api/forms';
import { errorMessage } from '@/lib/api/messages';
import { notifyError } from '@/lib/api/notify';
import { signOut } from '@/lib/auth/actions';

import { useChangePassword } from '../api';
import { passwordChangeSchema, type PasswordChangeValues } from '../schemas';

const FIELDS = ['currentPassword', 'newPassword'] as const;

export const PASSWORD_CHANGED_MESSAGE = 'Password changed. Sign in with your new password.';

/**
 * Change password (DESIGN.md §6): current, new and confirm (each with a show / hide toggle).
 * On success the API has ended every session, so this tab signs out (other tabs follow over
 * tm-auth) and goes to /login. A wrong current password, a 422, a 429 or anything else stays
 * a form or toast error: none of them signs out.
 */
export function ChangePasswordForm() {
    const router = useRouter();
    const change = useChangePassword();
    const [leaving, setLeaving] = useState(false);
    const {
        register,
        handleSubmit,
        setError,
        trigger,
        getFieldState,
        formState: { errors, isValid },
    } = useForm<PasswordChangeValues>({
        resolver: zodResolver(passwordChangeSchema),
        mode: 'onTouched',
        defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    });

    // The cross-field rules (differs from current, confirm matches): re-check the other field
    // when this one changes, but only once that one has been left (onTouched).
    const recheck = (name: 'newPassword' | 'confirmPassword') => () => {
        if (getFieldState(name).isTouched) void trigger(name);
    };

    const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
        try {
            await change.mutateAsync({ currentPassword, newPassword });
        } catch (error) {
            if (hasCode(error, ERROR_CODES.INVALID_CURRENT_PASSWORD)) {
                setError(
                    'currentPassword',
                    { type: 'server', message: errorMessage(error) },
                    { shouldFocus: true },
                );
                return;
            }
            if (hasCode(error, ERROR_CODES.VALIDATION_ERROR)) {
                const unplaced = applyFieldErrors(error, setError, {}, FIELDS);
                if (unplaced.length) notifyError(error);
                return;
            }
            // 429 reads "Too many attempts — try again in a minute."; the rest as usual.
            notifyError(error);
            return;
        }
        setLeaving(true);
        toast.success(PASSWORD_CHANGED_MESSAGE);
        // Client-side navigation keeps the toast on screen.
        await signOut({ navigate: (path) => router.replace(path) });
    });

    const pending = change.isPending || leaving;

    return (
        <section aria-labelledby="change-password" className="flex flex-col gap-4">
            <h3 id="change-password" className="m-0">
                Change password
            </h3>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
                <Field label="Current password" required error={errors.currentPassword?.message}>
                    <PasswordInput
                        autoComplete="current-password"
                        {...register('currentPassword', { onChange: recheck('newPassword') })}
                    />
                </Field>
                <Field
                    label="New password"
                    required
                    hint="8–128 characters, different from your current one."
                    error={errors.newPassword?.message}
                >
                    <PasswordInput
                        autoComplete="new-password"
                        {...register('newPassword', { onChange: recheck('confirmPassword') })}
                    />
                </Field>
                <Field
                    label="Confirm new password"
                    required
                    error={errors.confirmPassword?.message}
                >
                    <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
                </Field>
                <div>
                    <Button type="submit" variant="primary" loading={pending} disabled={!isValid}>
                        Change password
                    </Button>
                </div>
            </form>
        </section>
    );
}
