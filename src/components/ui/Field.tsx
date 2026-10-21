'use client';

import { clsx } from 'clsx';
import { createContext, useContext, useId, type ReactNode } from 'react';

type FieldContextValue = {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
    required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

type ControlProps = {
    id?: string | undefined;
    required?: boolean | undefined;
    'aria-describedby'?: string | undefined;
    'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;
};

/**
 * Props a form control takes from its surrounding <Field>: id (matching the label's htmlFor),
 * aria-describedby (error + hint), aria-invalid and required. Explicit props win.
 */
export function useFieldControl<P extends ControlProps>(props: P): P {
    const field = useContext(FieldContext);
    if (!field) return props;

    const describedBy =
        [field.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined;

    return {
        ...props,
        id: props.id ?? field.id,
        required: props.required ?? (field.required || undefined),
        'aria-describedby': describedBy,
        'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    };
}

type FieldProps = {
    label: ReactNode;
    hint?: ReactNode;
    /** Error message; also marks the control aria-invalid. */
    error?: ReactNode;
    required?: boolean;
    /** Id for the control; generated when omitted. */
    id?: string;
    className?: string;
    /** One of Input, Textarea, NativeSelect, DateField (or anything using useFieldControl). */
    children: ReactNode;
};

/** `.field` wrapper: label, control, hint and error, wired together for assistive tech. */
export function Field({
    label,
    hint,
    error,
    required = false,
    id,
    className,
    children,
}: FieldProps) {
    const generatedId = useId();
    const controlId = id ?? generatedId;
    const hintId = hint ? `${controlId}-hint` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;

    const value: FieldContextValue = {
        id: controlId,
        describedBy: [errorId, hintId].filter(Boolean).join(' ') || undefined,
        invalid: Boolean(error),
        required,
    };

    return (
        <div className={clsx('field', className)}>
            <label htmlFor={controlId}>
                {label}
                {required && (
                    <span aria-hidden className="text-danger">
                        {' '}
                        *
                    </span>
                )}
            </label>
            <FieldContext value={value}>{children}</FieldContext>
            {hint && (
                <p id={hintId} className="text-muted mt-1 mb-0 text-[12px]">
                    {hint}
                </p>
            )}
            {error && <FieldError id={errorId}>{error}</FieldError>}
        </div>
    );
}

export function FieldError({ id, children }: { id?: string | undefined; children: ReactNode }) {
    return (
        <p id={id} className="mt-1 mb-0 text-[12px] font-semibold text-danger">
            {children}
        </p>
    );
}
