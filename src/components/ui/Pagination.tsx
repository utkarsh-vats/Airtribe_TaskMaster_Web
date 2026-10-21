'use client';

import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './Button';

type PaginationProps = {
    /** 1-based. */
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    className?: string;
};

/** "Page X of Y" with previous / next. Renders nothing when there's a single page. */
export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
    if (totalPages <= 1) return null;

    return (
        <nav aria-label="Pagination" className={clsx('flex items-center gap-3 text-sm', className)}>
            <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
            >
                <ChevronLeft aria-hidden size={14} />
                Previous
            </Button>
            <span aria-live="polite" className="tabular-nums">
                Page {page} of {totalPages}
            </span>
            <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
            >
                Next
                <ChevronRight aria-hidden size={14} />
            </Button>
        </nav>
    );
}
