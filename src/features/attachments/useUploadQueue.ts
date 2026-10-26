'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ERROR_CODES, networkError, type ApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/api/messages';
import { uploadAttachment, type UploadResult } from '@/lib/api/upload';

import { uploadMimeType, uploadProblem } from './allowlist';
import { addUploadedAttachment } from './api';

export const TASK_GONE_UPLOAD_MESSAGE = 'This task no longer exists.';

export type UploadItem = {
    key: string;
    file: File;
    status: 'queued' | 'uploading' | 'failed';
    /** 0–100. */
    progress: number;
    error: string | null;
    /** False for a file the pre-check refused: sending it again wouldn't help. */
    retryable: boolean;
};

let seq = 0;

/** The row's text for a failed upload (DESIGN.md §7 error table). */
export function uploadErrorMessage(error: ApiError, toTask: boolean): string {
    if (error.status === 404 && toTask) return TASK_GONE_UPLOAD_MESSAGE;
    if (error.status === 422) return error.details[0]?.message ?? errorMessage(error);
    return errorMessage(error);
}

/** 413 / 415 are about the file and stay on its row; other failures toast too. */
const isAboutTheFile = (error: ApiError) =>
    error.code === ERROR_CODES.PAYLOAD_TOO_LARGE ||
    error.code === ERROR_CODES.UNSUPPORTED_MEDIA_TYPE ||
    error.status === 413 ||
    error.status === 415;

/**
 * The files being uploaded to one list (DESIGN.md §7 "Uploads"). The API takes one file per
 * request, so they go one at a time, in the order added. Each is checked first (size, type) and
 * only sent if it passes; a failure stays as a row with its message until retried or
 * dismissed. Cancel aborts the file being sent (silently) and moves on to the next. Uploads
 * still running when the list unmounts are cancelled.
 */
export function useUploadQueue(projectId: string, taskId: string | null) {
    const queryClient = useQueryClient();
    const [items, setItems] = useState<readonly UploadItem[]>([]);
    // The source of truth (state lags a render behind), and the upload in flight.
    const queue = useRef<readonly UploadItem[]>([]);
    const current = useRef<{ key: string; controller: AbortController } | null>(null);

    useEffect(() => () => current.current?.controller.abort(), []);

    const commit = (next: readonly UploadItem[]) => {
        queue.current = next;
        setItems(next);
    };
    const patch = (key: string, fields: Partial<UploadItem>) =>
        commit(queue.current.map((item) => (item.key === key ? { ...item, ...fields } : item)));
    const drop = (key: string) => commit(queue.current.filter((item) => item.key !== key));

    const pump = () => {
        if (current.current) return;
        const next = queue.current.find((item) => item.status === 'queued');
        if (!next) return;

        const controller = new AbortController();
        current.current = { key: next.key, controller };
        patch(next.key, { status: 'uploading', progress: 0, error: null });

        // The browser's own label for some allowed files isn't one the API accepts (a .zip from
        // Windows); send those with the type their extension stands for.
        const type = uploadMimeType(next.file) ?? next.file.type;
        const file =
            type === next.file.type
                ? next.file
                : new File([next.file], next.file.name, {
                      type,
                      lastModified: next.file.lastModified,
                  });

        void uploadAttachment({
            projectId,
            file,
            taskId: taskId ?? undefined,
            signal: controller.signal,
            onProgress: ({ loaded, total }) => {
                if (total > 0) patch(next.key, { progress: Math.round((loaded / total) * 100) });
            },
        })
            // It resolves even on failure; this is only for a bug, so no row is left spinning.
            .catch((cause: unknown): UploadResult => ({
                status: 'failed',
                error: networkError(cause),
            }))
            .then((result) => {
                current.current = null;
                if (result.status === 'uploaded') {
                    drop(next.key);
                    addUploadedAttachment(queryClient, projectId, result.attachment);
                } else if (result.status === 'cancelled') {
                    drop(next.key);
                } else {
                    const message = uploadErrorMessage(result.error, taskId !== null);
                    patch(next.key, { status: 'failed', progress: 0, error: message });
                    if (!isAboutTheFile(result.error)) {
                        toast.error(`Couldn't upload ${next.file.name}`, { description: message });
                    }
                }
                pump();
            });
    };

    return {
        items,
        /** Queue files (from the file input or a drop). */
        add(files: Iterable<File>) {
            const added = Array.from(files, (file): UploadItem => {
                const problem = uploadProblem(file);
                seq += 1;
                return {
                    key: `upload-${seq}`,
                    file,
                    status: problem ? 'failed' : 'queued',
                    progress: 0,
                    error: problem,
                    retryable: !problem,
                };
            });
            if (!added.length) return;
            commit([...queue.current, ...added]);
            pump();
        },
        /** Stop the file being sent (or take a waiting one off the queue). */
        cancel(key: string) {
            if (current.current?.key === key) current.current.controller.abort();
            else drop(key);
        },
        retry(key: string) {
            patch(key, { status: 'queued', progress: 0, error: null });
            pump();
        },
        dismiss: drop,
    };
}
