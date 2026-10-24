'use client';

import { toast } from 'sonner';

import type { Attachment } from '@/lib/api/types';

import { api } from './client';
import { isApiError, toApiError } from './errors';
import { notifyError } from './notify';

export const FILE_GONE_MESSAGE = 'This file is no longer available.';

/**
 * Download an attachment (DESIGN.md §7 "Downloads"). The endpoint needs the Authorization
 * header, so a plain link won't do: the file is fetched through the API client — bearer token
 * and the TOKEN_EXPIRED refresh-and-retry included — as a Blob, then saved through a temporary
 * object URL. The name is the attachment's originalName: Content-Disposition isn't readable
 * cross-origin until the API exposes it (§13).
 *
 * Resolves to whether it worked. Failures toast: a 404 "This file is no longer available.",
 * anything else the usual error message.
 */
export async function downloadAttachment(
    projectId: string,
    attachment: Pick<Attachment, 'id' | 'originalName'>,
): Promise<boolean> {
    try {
        const { data, error, response } = await api.GET(
            '/api/v1/projects/{projectId}/attachments/{attachmentId}/download',
            {
                params: { path: { projectId, attachmentId: attachment.id } },
                parseAs: 'blob',
            },
        );
        if (!response.ok || !data) throw await toApiError(response, error);
        saveBlob(data, attachment.originalName);
        return true;
    } catch (failure) {
        if (isApiError(failure) && failure.status === 404) toast.error(FILE_GONE_MESSAGE);
        else notifyError(failure);
        return false;
    }
}

/** Hand a Blob to the browser as a download named `filename`. */
function saveBlob(blob: Blob, filename: string) {
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
