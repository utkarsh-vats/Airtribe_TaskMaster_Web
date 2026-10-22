'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 300;

type TaskSearchProps = {
    /** The current ?q (the URL is the source of truth). */
    value: string;
    /** Called with the trimmed text, debounced while typing and at once on Esc. */
    onSearch: (q: string) => void;
    className?: string;
};

/**
 * Toolbar search below 820px (the header search covers wider screens). Typing updates ?q
 * after a 300 ms pause; Esc clears. It follows the URL, so a change made elsewhere — the header
 * search, Clear filters — shows up here too.
 */
export function TaskSearch({ value, onSearch, className }: TaskSearchProps) {
    const [text, setText] = useState(value);
    const [lastValue, setLastValue] = useState(value);

    // Adopt a ?q that changed elsewhere; our own debounced update matches `text` already.
    if (value !== lastValue) {
        setLastValue(value);
        if (value !== text.trim()) setText(value);
    }

    useEffect(() => {
        const q = text.trim();
        if (q === value) return;
        const timer = setTimeout(() => onSearch(q), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [text, value, onSearch]);

    return (
        <div role="search" className={`relative ${className ?? ''}`}>
            <Search
                aria-hidden
                size={14}
                className="pointer-events-none absolute top-[11px] left-[10px] opacity-60"
            />
            <input
                type="search"
                aria-label="Search tasks"
                placeholder="Search tasks"
                autoComplete="off"
                enterKeyHint="search"
                className="input pl-[30px]"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        setText('');
                        if (value) onSearch('');
                        event.currentTarget.blur();
                    }
                }}
            />
        </div>
    );
}
