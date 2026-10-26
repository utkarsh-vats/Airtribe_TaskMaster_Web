'use client';

import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useId, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';

/*
 * Open / closed per section key, remembered per browser in localStorage (`tm:section:<key>`).
 * Storage can be blocked (private mode, site data off), so every access is guarded and the
 * value also lives in memory for this page.
 */

export const sectionStorageKey = (key: string) => `tm:section:${key}`;

const listeners = new Set<() => void>();
/** Toggled in this page (the source of truth once set); otherwise the stored value is read. */
const memory = new Map<string, boolean>();

function readOpen(key: string): boolean {
    const known = memory.get(key);
    if (known !== undefined) return known;
    try {
        return window.localStorage.getItem(sectionStorageKey(key)) !== 'false';
    } catch {
        return true;
    }
}

function writeOpen(key: string, open: boolean) {
    memory.set(key, open);
    try {
        window.localStorage.setItem(sectionStorageKey(key), String(open));
    } catch {
        // Blocked storage: remembered for this page only.
    }
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** [open, setOpen] for a section key; open by default (and on the server). */
export function useSectionOpen(key: string) {
    const open = useSyncExternalStore(
        subscribe,
        () => readOpen(key),
        () => true,
    );
    return [open, (next: boolean) => writeOpen(key, next)] as const;
}

/** Tests only: forget the in-memory values, as a reload would. */
export function resetSectionsForTests() {
    memory.clear();
}

type CollapsibleSectionProps = Omit<ComponentProps<'section'>, 'title' | 'children'> & {
    /** Which remembered state this is (e.g. "task-attachments"). */
    sectionKey: string;
    title: ReactNode;
    /** Shown muted after the title, inside the toggle. */
    count?: ReactNode;
    /** Controls on the right of the header (e.g. Upload) — not part of the toggle. */
    actions?: ReactNode;
    children: ReactNode;
    /** The title's id, for content labelled by it (e.g. a list); the section uses it too. */
    titleId?: string;
};

/**
 * A section whose header toggles its content (DESIGN.md §6): the h4 holds a button — title,
 * muted count, chevron — with aria-expanded / aria-controls; `actions` sit beside it. Open by
 * default; the choice is remembered per `sectionKey`.
 */
export function CollapsibleSection({
    sectionKey,
    title,
    count,
    actions,
    children,
    titleId,
    className,
    ...sectionProps
}: CollapsibleSectionProps) {
    const [open, setOpen] = useSectionOpen(sectionKey);
    const contentId = useId();
    const generatedTitleId = useId();
    const labelId = titleId ?? generatedTitleId;

    return (
        // Labelled by the title alone, not the count.
        <section
            aria-labelledby={labelId}
            className={clsx('flex flex-col gap-3', className)}
            {...sectionProps}
        >
            <div className="flex items-center gap-2">
                <h4 className="m-0 min-w-0">
                    <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={contentId}
                        onClick={() => setOpen(!open)}
                        className="flex min-w-0 cursor-pointer items-baseline gap-2 text-left"
                    >
                        <span id={labelId} className="truncate">
                            {title}
                        </span>
                        {count != null && (
                            <span className="text-muted text-[12px] font-normal">{count}</span>
                        )}
                        <ChevronDown
                            aria-hidden
                            size={16}
                            className={clsx(
                                'flex-none self-center transition-transform motion-reduce:transition-none',
                                !open && '-rotate-90',
                            )}
                        />
                    </button>
                </h4>
                {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
            </div>
            <div id={contentId} hidden={!open} className="flex flex-col gap-3">
                {children}
            </div>
        </section>
    );
}
