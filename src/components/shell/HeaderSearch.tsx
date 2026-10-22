'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { shallowUrl } from '@/lib/hooks/shallowUrl';

/** Routes whose task list reads ?q (the search applies in place). */
const PROJECT_TASKS = /^\/dashboard\/projects\/[^/]+\/tasks$/;
const MY_TASKS = '/dashboard/my-tasks';
const isSearchRoute = (path: string) => PROJECT_TASKS.test(path) || path === MY_TASKS;

/** Whether a keypress started inside something the user is typing into. */
function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
    );
}

/**
 * Header search (DESIGN.md §5 "Header Search tasks"). On a project's task list or My tasks it
 * sets ?q on the current URL (other filters kept, page reset); anywhere else it opens
 * My tasks with ?q. "/" focuses it from anywhere; Esc clears and leaves.
 */
export function HeaderSearch() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const urlQuery = isSearchRoute(pathname) ? (searchParams.get('q') ?? '') : '';

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
            if (isTypingTarget(event.target)) return;
            event.preventDefault();
            inputRef.current?.focus();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    const submit = (raw: string) => {
        const q = raw.trim();
        if (isSearchRoute(pathname)) {
            const params = new URLSearchParams(searchParams.toString());
            if (q) params.set('q', q);
            else params.delete('q');
            params.delete('page');
            const query = params.toString();
            // Same page, new ?q: client-side URL state, no server round trip.
            shallowUrl.push(query ? `${pathname}?${query}` : pathname);
            return;
        }
        router.push(q ? `${MY_TASKS}?q=${encodeURIComponent(q)}` : MY_TASKS);
    };

    return (
        <form
            role="search"
            className="relative hidden w-[260px] md:block"
            onSubmit={(event) => {
                event.preventDefault();
                submit(inputRef.current?.value ?? '');
            }}
        >
            <Search
                aria-hidden
                size={14}
                className="pointer-events-none absolute top-[11px] left-[10px] opacity-60"
            />
            <input
                // Remount when the URL's ?q changes, so the box always shows the active search.
                key={`${pathname}?q=${urlQuery}`}
                ref={inputRef}
                type="search"
                name="q"
                aria-label="Search tasks"
                placeholder="Search tasks"
                defaultValue={urlQuery}
                enterKeyHint="search"
                autoComplete="off"
                className="input pl-[30px]"
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.currentTarget.value = '';
                        event.currentTarget.blur();
                    }
                }}
            />
        </form>
    );
}
