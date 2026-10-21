'use client';

import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

import { Button } from './Button';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export type MultiSelectOption<T extends string> = { value: T; label: string };

type MultiSelectProps<T extends string> = {
    /** Noun for the summary: "Priority" → "Priority: Urgent, High" / "Any priority". */
    label: string;
    options: readonly MultiSelectOption<T>[];
    value: readonly T[];
    onChange: (value: T[]) => void;
    /** Summary when nothing is selected. Defaults to "Any <label>". */
    placeholder?: string;
    size?: 'default' | 'sm';
    className?: string;
};

/** Summary of the selection, in option order so it reads the same however it was built. */
export function summarizeSelection<T extends string>(
    label: string,
    options: readonly MultiSelectOption<T>[],
    value: readonly T[],
    placeholder = `Any ${label.toLowerCase()}`,
) {
    const selected = options.filter((option) => value.includes(option.value));
    if (selected.length === 0) return placeholder;
    return `${label}: ${selected.map((option) => option.label).join(', ')}`;
}

/** Filter-style multi choice: a trigger that summarises the selection, checkboxes in a popover. */
export function MultiSelect<T extends string>({
    label,
    options,
    value,
    onChange,
    placeholder,
    size,
    className,
}: MultiSelectProps<T>) {
    const summary = summarizeSelection(label, options, value, placeholder);

    const toggle = (optionValue: T, checked: boolean) => {
        const next = new Set(value);
        if (checked) next.add(optionValue);
        else next.delete(optionValue);
        // Keep option order so the value is stable (it ends up in the URL).
        onChange(options.map((option) => option.value).filter((v) => next.has(v)));
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="secondary"
                    size={size}
                    title={summary}
                    className={clsx('max-w-[280px] justify-between', className)}
                >
                    <span className="min-w-0 truncate">{summary}</span>
                    <ChevronDown aria-hidden size={14} className="flex-none" />
                </Button>
            </PopoverTrigger>
            <PopoverContent aria-label={label} className="flex flex-col gap-2">
                <fieldset className="m-0 flex flex-col border-0 p-0">
                    <legend className="sr-only">{label}</legend>
                    {options.map((option) => (
                        <label key={option.value} className="tm-option">
                            <input
                                type="checkbox"
                                className="check"
                                checked={value.includes(option.value)}
                                onChange={(event) => toggle(option.value, event.target.checked)}
                            />
                            {option.label}
                        </label>
                    ))}
                </fieldset>
                <div className="flex border-t border-divider pt-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={value.length === 0}
                        onClick={() => onChange([])}
                    >
                        Clear
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
