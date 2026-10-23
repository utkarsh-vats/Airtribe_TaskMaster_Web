'use client';

import { useMutation } from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';

export type DraftDescriptionInput = {
    title: string;
    /** The description typed so far, if any: the AI builds on it. */
    notes?: string | undefined;
    /** Abort to discard the result (e.g. the dialog closed mid-request). */
    signal?: AbortSignal | undefined;
};

/** POST /ai/task-description → a suggested description (plain text). */
export function useGenerateDescription() {
    return useMutation({
        mutationFn: async ({ title, notes, signal }: DraftDescriptionInput) => {
            const { description } = await unwrap(
                api.POST('/api/v1/ai/task-description', {
                    body: notes ? { title, notes } : { title },
                    signal,
                }),
            );
            return description;
        },
    });
}
