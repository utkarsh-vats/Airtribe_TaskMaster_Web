'use client';

import { clsx } from 'clsx';
import { useLayoutEffect, useRef, type ComponentProps } from 'react';

import { mergeRefs } from '@/lib/react/mergeRefs';

import { useFieldControl } from './Field';

type TextareaProps = ComponentProps<'textarea'> & {
    /** Grow with the content instead of scrolling. */
    autoGrow?: boolean;
};

function fitToContent(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    // scrollHeight excludes borders; add them back so the last line isn't clipped.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

export function Textarea({
    autoGrow = false,
    className,
    ref,
    value,
    onInput,
    ...props
}: TextareaProps) {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    const fieldProps = useFieldControl(props);

    // Controlled value changes (e.g. an AI draft filling the field) don't fire `input`.
    useLayoutEffect(() => {
        if (autoGrow && innerRef.current) fitToContent(innerRef.current);
    }, [autoGrow, value]);

    return (
        <textarea
            ref={mergeRefs(innerRef, ref)}
            className={clsx('input', autoGrow && 'input-autogrow', className)}
            value={value}
            onInput={(event) => {
                if (autoGrow) fitToContent(event.currentTarget);
                onInput?.(event);
            }}
            {...fieldProps}
        />
    );
}
