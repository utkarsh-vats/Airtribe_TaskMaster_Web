'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toaster';
import { ERROR_CODES, hasCode } from '@/lib/api/errors';
import { applyFieldErrors } from '@/lib/api/forms';
import { errorMessage } from '@/lib/api/messages';
import { notifyError } from '@/lib/api/notify';
import type { User } from '@/lib/api/types';
import { monthYear } from '@/lib/format/dates';
import { queryView } from '@/lib/query/view';

import { useMe, useUpdateProfile } from '../api';
import {
    profileChanges,
    profileFormValues,
    profileSchema,
    type ProfileFormInput,
    type ProfileFormValues,
} from '../schemas';

const FIELDS = ['name', 'bio', 'avatarUrl'] as const;

export const PROFILE_UPDATED_MESSAGE = 'Profile updated';

/**
 * /dashboard/profile (DESIGN.md §6): a card with my avatar, name, email and "Member since",
 * then the profile form — name, bio and avatar URL (PATCH /users/me); email is read-only (the
 * API can't change it). Change password is 13b.
 */
export function ProfileView() {
    const me = useMe();
    const view = queryView(me);

    let body;
    if (view.status === 'loading') {
        body = (
            <div aria-busy="true" className="flex flex-col gap-4">
                <span className="sr-only">Loading your profile…</span>
                <div className="flex items-center gap-4">
                    <Skeleton width={64} height={64} />
                    <div className="flex flex-1 flex-col gap-2">
                        <Skeleton width="40%" height={18} />
                        <Skeleton width="55%" height={13} />
                    </div>
                </div>
                <Skeleton width="100%" height={180} />
            </div>
        );
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                title="Couldn't load your profile"
                message={errorMessage(view.error)}
                retrying={me.isRefetching}
                onRetry={() => void me.refetch()}
            />
        );
    } else {
        body = (
            <>
                <ProfileCard user={view.data} />
                <ProfileForm user={view.data} />
            </>
        );
    }

    return (
        <div className="flex max-w-[560px] flex-col gap-6">
            <h2 className="m-0">Profile</h2>
            {body}
        </div>
    );
}

function ProfileCard({ user }: { user: User }) {
    return (
        <Card className="flex items-center gap-4" data-testid="profile-card">
            <Avatar name={user.name} src={user.avatarUrl} size="lg" />
            <div className="flex min-w-0 flex-col gap-1">
                <span className="font-heading text-lg font-extrabold break-words">{user.name}</span>
                <span className="text-muted text-sm break-all">{user.email}</span>
                <span className="text-muted text-[12px]">
                    Member since {monthYear(user.createdAt)}
                </span>
            </div>
        </Card>
    );
}

function ProfileForm({ user }: { user: User }) {
    const update = useUpdateProfile();
    const {
        register,
        handleSubmit,
        reset,
        setError,
        formState: { errors, isDirty, isValid },
    } = useForm<ProfileFormInput, unknown, ProfileFormValues>({
        resolver: zodResolver(profileSchema),
        mode: 'onTouched',
        // A newer saved profile (e.g. from another tab, on refetch) becomes the baseline;
        // fields being edited keep their text.
        values: profileFormValues(user),
        resetOptions: { keepDirtyValues: true },
    });

    // useForm merges resetOptions into every reset(); an explicit one drops the edits.
    const resetTo = (next: User) => reset(profileFormValues(next), { keepDirtyValues: false });

    const onSubmit = handleSubmit(async (values) => {
        const changes = profileChanges(user, values);
        // Only whitespace changed: nothing to save.
        if (Object.keys(changes).length === 0) {
            resetTo(user);
            return;
        }
        try {
            const saved = await update.mutateAsync(changes);
            resetTo(saved);
            toast.success(PROFILE_UPDATED_MESSAGE);
        } catch (error) {
            if (hasCode(error, ERROR_CODES.VALIDATION_ERROR)) {
                const unplaced = applyFieldErrors(error, setError, {}, FIELDS);
                if (unplaced.length) notifyError(error);
                return;
            }
            // The edits stay in the form, to try again.
            notifyError(error);
        }
    });

    return (
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field label="Name" required error={errors.name?.message}>
                <Input autoComplete="name" {...register('name')} />
            </Field>
            <Field label="Email" hint="Your email can't be changed.">
                <Input type="email" value={user.email} readOnly />
            </Field>
            <Field label="Bio" hint="Optional. Up to 500 characters." error={errors.bio?.message}>
                <Textarea autoGrow rows={3} {...register('bio')} />
            </Field>
            <Field
                label="Avatar URL"
                hint="Optional. A link to an image (http or https)."
                error={errors.avatarUrl?.message}
            >
                <Input type="url" inputMode="url" {...register('avatarUrl')} />
            </Field>
            <div className="flex items-center gap-2">
                <Button
                    type="submit"
                    variant="primary"
                    loading={update.isPending}
                    disabled={!isDirty || !isValid}
                >
                    Save changes
                </Button>
                <Button
                    variant="ghost"
                    disabled={!isDirty || update.isPending}
                    onClick={() => resetTo(user)}
                >
                    Reset
                </Button>
            </div>
        </form>
    );
}
