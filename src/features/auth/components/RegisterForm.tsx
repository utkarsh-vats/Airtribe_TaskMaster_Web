'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toaster';
import { register as registerAccount } from '@/lib/auth/actions';
import { safeNext } from '@/lib/auth/safeNext';

import { authFormError } from '../errors';
import { registerSchema, type RegisterInput, type RegisterValues } from '../schemas';
import { AuthSwitch, withNext } from './AuthSwitch';
import { FormAlert, useFormAlert } from '@/components/ui/FormAlert';
import { PasswordInput } from './PasswordInput';
import { SubmitButton } from './SubmitButton';

const FIELDS = ['name', 'email', 'password'] as const;

export const ACCOUNT_CREATED_MESSAGE = 'Account created — please sign in.';

export function RegisterForm({ next }: { next?: string | undefined }) {
    const router = useRouter();
    const { message: formError, show: showFormError, ref: formErrorRef } = useFormAlert();
    const [leaving, setLeaving] = useState(false);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<RegisterInput, unknown, RegisterValues>({
        resolver: zodResolver(registerSchema),
        defaultValues: { name: '', email: '', password: '' },
    });

    const onSubmit = handleSubmit(async ({ name, email, password }) => {
        showFormError(null);
        let result: Awaited<ReturnType<typeof registerAccount>>;
        try {
            result = await registerAccount(name, email, password);
        } catch (error) {
            showFormError(authFormError(error, setError, FIELDS));
            return;
        }
        setLeaving(true);
        if (result.needsLogin) {
            // The account exists but the automatic sign-in didn't go through.
            toast.success(ACCOUNT_CREATED_MESSAGE);
            router.replace(withNext('/login', next));
            return;
        }
        router.replace(safeNext(next));
    });

    const pending = isSubmitting || leaving;

    return (
        <>
            <AuthSwitch current="register" next={next} />
            <h2 className="m-0">Start with a project</h2>
            <FormAlert message={formError} ref={formErrorRef} />
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
                <Field label="Full name" error={errors.name?.message}>
                    <Input autoComplete="name" placeholder="Mara Okafor" {...register('name')} />
                </Field>
                <Field label="Email" error={errors.email?.message}>
                    <Input
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        {...register('email')}
                    />
                </Field>
                <Field
                    label="Password"
                    hint="At least 8 characters"
                    error={errors.password?.message}
                >
                    <PasswordInput autoComplete="new-password" {...register('password')} />
                </Field>
                <SubmitButton pending={pending}>Create account</SubmitButton>
            </form>
        </>
    );
}
