'use client';

import { clsx } from 'clsx';
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';

import { Skeleton } from './Skeleton';

type TableProps = ComponentProps<'table'> & {
    /** Below this width the table scrolls horizontally instead of squashing. */
    minWidth?: number;
};

/** `.table` inside a horizontal scroller (tables never wrap columns at 375px). */
export function Table({ minWidth, className, style, ...props }: TableProps) {
    return (
        <div className="overflow-x-auto">
            <table className={clsx('table', className)} style={{ minWidth, ...style }} {...props} />
        </div>
    );
}

export function THead(props: ComponentProps<'thead'>) {
    return <thead {...props} />;
}

export function TBody(props: ComponentProps<'tbody'>) {
    return <tbody {...props} />;
}

type TrProps = ComponentProps<'tr'> & {
    /**
     * Makes the row open something (e.g. the task panel): pointer click, or Enter when the row
     * has keyboard focus. Buttons and links inside the row keep their own behaviour.
     */
    onOpen?: () => void;
};

const isInteractive = (target: EventTarget) =>
    target instanceof Element && target.closest('a, button, input, select, textarea, label');

export function Tr({ onOpen, className, onClick, onKeyDown, ...props }: TrProps) {
    if (!onOpen)
        return <tr className={className} onClick={onClick} onKeyDown={onKeyDown} {...props} />;

    return (
        <tr
            tabIndex={0}
            className={clsx('table-row-link', className)}
            onClick={(event) => {
                onClick?.(event);
                if (!event.defaultPrevented && !isInteractive(event.target)) onOpen();
            }}
            onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                onKeyDown?.(event);
                if (event.key === 'Enter' && event.target === event.currentTarget) {
                    event.preventDefault();
                    onOpen();
                }
            }}
            {...props}
        />
    );
}

export function Th({ scope = 'col', ...props }: ComponentProps<'th'>) {
    return <th scope={scope} {...props} />;
}

export function Td(props: ComponentProps<'td'>) {
    return <td {...props} />;
}

/** A single full-width row for "nothing here" inside a table body. */
export function TableEmpty({
    colSpan,
    title,
    children,
}: {
    colSpan: number;
    title: ReactNode;
    children?: ReactNode;
}) {
    return (
        <tbody>
            <tr>
                <td colSpan={colSpan} className="py-8">
                    <div className="font-semibold">{title}</div>
                    {children && <div className="text-muted text-sm">{children}</div>}
                </td>
            </tr>
        </tbody>
    );
}

/** Placeholder body while rows load. Use in place of <TBody>. */
export function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
    return (
        <tbody aria-busy="true">
            {Array.from({ length: rows }, (_, row) => (
                <tr key={row}>
                    {Array.from({ length: cols }, (_, col) => (
                        <td key={col}>
                            <Skeleton width={col === 0 ? '80%' : '60%'} />
                        </td>
                    ))}
                </tr>
            ))}
        </tbody>
    );
}
