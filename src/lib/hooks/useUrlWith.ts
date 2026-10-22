'use client';

import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Build URLs from the current one with some query params changed (`null` removes one), for
 * router.push / replace and links. Other params are kept as they are.
 */
export function useUrlWith() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    return (changes: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams.toString());
        for (const [key, value] of Object.entries(changes)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
        }
        const query = params.toString();
        return query ? `${pathname}?${query}` : pathname;
    };
}

/** ?page as a positive integer (anything else → 1). */
export function pageParam(raw: string | null) {
    const page = Number(raw);
    return Number.isInteger(page) && page > 0 ? page : 1;
}
