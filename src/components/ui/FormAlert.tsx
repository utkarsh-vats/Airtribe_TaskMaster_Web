'use client';

import { CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';

/**
 * Form-level error state. Setting a message moves focus to the alert so keyboard and
 * screen-reader users land on it (field errors focus their field instead).
 */
export function useFormAlert() {
    const [message, setMessage] = useState<string | null>(null);
    const ref = useRef<HTMLParagraphElement>(null);
    // Bumped on every set, so the same message shown twice still re-focuses.
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (message) ref.current?.focus();
    }, [message, version]);

    const show = (next: string | null) => {
        setMessage(next);
        setVersion((v) => v + 1);
    };

    return { message, show, ref };
}

export function FormAlert({
    message,
    ref,
}: {
    message: string | null;
    ref: Ref<HTMLParagraphElement>;
}) {
    if (!message) return null;
    return (
        <p
            ref={ref}
            role="alert"
            tabIndex={-1}
            className="m-0 flex items-start gap-2 border-l-rule border-danger py-1 pl-3 text-sm font-semibold text-danger"
        >
            <CircleAlert aria-hidden size={16} className="mt-[2px] flex-none" />
            {message}
        </p>
    );
}
