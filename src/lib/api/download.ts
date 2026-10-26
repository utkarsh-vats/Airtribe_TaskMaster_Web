'use client';

import { toast } from 'sonner';

import type { Attachment } from '@/lib/api/types';

import { api } from './client';
import { isApiError, toApiError } from './errors';
import { notifyError } from './notify';

export const FILE_GONE_MESSAGE = 'This file is no longer available.';

/** A 404 for a file: it was deleted (or its task / project is gone). */
export const isFileGone = (error: unknown) => isApiError(error) && error.status === 404;

/**
 * Fetch an attachment's content as a Blob (DESIGN.md §7 "Downloads"). The endpoint needs the
 * Authorization header, so a plain link won't do: this goes through the API client — bearer
 * token and the TOKEN_EXPIRED refresh-and-retry included. Throws an ApiError (a 404 when the
 * file is gone, see isFileGone), or the AbortError when `signal` aborts it.
 */
export async function fetchAttachmentBlob(
    projectId: string,
    attachment: Pick<Attachment, 'id'>,
    signal?: AbortSignal,
): Promise<Blob> {
    const { data, error, response } = await api.GET(
        '/api/v1/projects/{projectId}/attachments/{attachmentId}/download',
        {
            params: { path: { projectId, attachmentId: attachment.id } },
            parseAs: 'blob',
            signal,
        },
    );
    if (!response.ok || !data) throw await toApiError(response, error);
    return data;
}

/**
 * Download an attachment: fetchAttachmentBlob, then save it through a temporary object URL.
 * The name is the attachment's originalName: Content-Disposition isn't readable cross-origin
 * until the API exposes it (§13).
 *
 * Resolves to whether it worked. Failures toast: a 404 "This file is no longer available.",
 * anything else the usual error message.
 */
export async function downloadAttachment(
    projectId: string,
    attachment: Pick<Attachment, 'id' | 'originalName'>,
): Promise<boolean> {
    try {
        saveBlob(await fetchAttachmentBlob(projectId, attachment), attachment.originalName);
        return true;
    } catch (failure) {
        if (isFileGone(failure)) toast.error(FILE_GONE_MESSAGE);
        else notifyError(failure);
        return false;
    }
}

/** Hand a Blob to the browser as a download named `filename`. */
export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    // After the click has been handled: some browsers read the URL asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
