'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { signIn } from '@/lib/auth/actions';
import { safeNext } from '@/lib/auth/safeNext';

import { authFormError } from '../errors';
import { loginSchema, type LoginInput, type LoginValues } from '../schemas';
import { AuthSwitch } from './AuthSwitch';
import { FormAlert, useFormAlert } from '@/components/ui/FormAlert';
import { PasswordInput } from './PasswordInput';
import { SubmitButton } from './SubmitButton';

const FIELDS = ['email', 'password'] as const;

export function LoginForm({ next }: { next?: string | undefined }) {
    const router = useRouter();
    const { message: formError, show: showFormError, ref: formErrorRef } = useFormAlert();
    // Stays true after success until the navigation replaces this page.
    const [leaving, setLeaving] = useState(false);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<LoginInput, unknown, LoginValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: { email: '', password: '' },
    });

    const onSubmit = handleSubmit(async ({ email, password }) => {
        showFormError(null);
        try {
            await signIn(email, password);
        } catch (error) {
            showFormError(authFormError(error, setError, FIELDS));
            return;
        }
        setLeaving(true);
        // Client-side navigation keeps the in-memory session: no second refresh on arrival.
        router.replace(safeNext(next));
    });

    const pending = isSubmitting || leaving;

    return (
        <>
            <AuthSwitch current="login" next={next} />
            <h2 className="m-0">Welcome back</h2>
            <FormAlert message={formError} ref={formErrorRef} />
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
                <Field label="Email" error={errors.email?.message}>
                    <Input
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        {...register('email')}
                    />
                </Field>
                <Field label="Password" error={errors.password?.message}>
                    <PasswordInput autoComplete="current-password" {...register('password')} />
                </Field>
                <SubmitButton pending={pending}>Sign in</SubmitButton>
            </form>
        </>
    );
}
