'use client';

import { clsx } from 'clsx';
import type { ComponentProps } from 'react';

import { useFieldControl } from './Field';

export function Input({ className, ...props }: ComponentProps<'input'>) {
    return <input className={clsx('input', className)} {...useFieldControl(props)} />;
}

/** Native date picker. Value is a `YYYY-MM-DD` string. */
export function DateField({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
    return <input type="date" className={clsx('input', className)} {...useFieldControl(props)} />;
}

/** Native <select> on `.input`; pass <option> children. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
    return <select className={clsx('input', className)} {...useFieldControl(props)} />;
}
