'use client';

import { clsx } from 'clsx';
import { useId, type ReactNode } from 'react';

export type SegmentedOption<T extends string> = {
    value: T;
    label: ReactNode;
    /** Shown after the label, dimmed (e.g. task counts, or "–" while loading). */
    count?: number | string;
};

type SegmentedProps<T extends string> = {
    options: readonly SegmentedOption<T>[];
    /** null = no option selected (e.g. a URL combining several values). */
    value: T | null;
    onChange: (value: T) => void;
    /** Accessible name of the group. */
    'aria-label': string;
    name?: string;
    /** 'sm': tighter padding and type, for secondary switches (e.g. List / Board). */
    size?: 'default' | 'sm';
    className?: string;
};

/**
 * Single choice on `.seg` / `.seg-opt`, built from native radios so arrow keys, Tab and
 * screen readers behave like any radio group.
 */
export function Segmented<T extends string>({
    options,
    value,
    onChange,
    name,
    size = 'default',
    className,
    'aria-label': ariaLabel,
}: SegmentedProps<T>) {
    const generatedName = useId();
    const groupName = name ?? generatedName;

    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className={clsx('seg', size === 'sm' && 'seg-sm', className)}
        >
            {options.map((option) => (
                <label key={option.value} className="seg-opt">
                    <input
                        type="radio"
                        name={groupName}
                        value={option.value}
                        checked={option.value === value}
                        onChange={() => onChange(option.value)}
                    />
                    {option.label}
                    {option.count !== undefined && (
                        <span className="opacity-65">{option.count}</span>
                    )}
                </label>
            ))}
        </div>
    );
}
