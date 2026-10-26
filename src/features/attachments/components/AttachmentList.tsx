'use client';

import { clsx } from 'clsx';
import {
    Download,
    File,
    FileArchive,
    FileImage,
    FileSpreadsheet,
    FileText,
    Paperclip,
    Trash2,
    type LucideIcon,
} from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProject } from '@/features/projects/api';
import { bindPermissions } from '@/features/projects/permissions';
import { downloadAttachment } from '@/lib/api/download';
import { errorMessage } from '@/lib/api/messages';
import type { Attachment } from '@/lib/api/types';
import { useSession } from '@/lib/auth/SessionProvider';
import { formatBytes } from '@/lib/format/bytes';
import { fullDateTime, relativeTime } from '@/lib/format/dates';

import { UPLOAD_ACCEPT } from '../allowlist';
import { useAttachments, useDeleteAttachment } from '../api';
import { fileKind, type FileKind } from '../fileKind';
import { useUploadQueue, type UploadItem } from '../useUploadQueue';

const ICONS: Record<FileKind, LucideIcon> = {
    image: FileImage,
    spreadsheet: FileSpreadsheet,
    archive: FileArchive,
    document: FileText,
    other: File,
};

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/**
 * A list of attachments (DESIGN.md §6, §7 "Uploads") for a task, or the project-level ones
 * (`taskId` null): "Attachments" + count + Upload, the files being uploaded, then the files
 * newest first with "Load more" for the next page. Each row downloads its file, and deletes it
 * for the uploader or ADMIN+. Files can also be dropped onto the list. Used by the task panel
 * and the project's Files tab.
 */
export function AttachmentList({
    projectId,
    taskId,
    title = 'Attachments',
    count,
    className,
}: {
    projectId: string;
    taskId: string | null;
    title?: string;
    /**
     * The count to show: the task's attachmentCount (null while it isn't known yet, e.g. the panel is
     * still showing the list row), or the list's own total when omitted.
     */
    count?: number | null;
    className?: string;
}) {
    const list = useAttachments(projectId, taskId ?? 'none');
    const uploads = useUploadQueue(projectId, taskId);
    const headingId = useId();
    const input = useRef<HTMLInputElement>(null);
    // From the cached project + the signed-in user, like the comment thread. No delete buttons
    // until both are known; every member may upload, so Upload is always there.
    const project = useProject(projectId);
    const { user } = useSession();
    const can = project.data && user ? bindPermissions(project.data.myRole, user.id) : null;
    // The files being downloaded right now, each with its own spinner.
    const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set());
    // Files dragged over the list. dragenter/dragleave fire for every child, hence the depth.
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const shown = count === undefined ? list.data?.pages[0]?.meta.total : count;

    const download = async (attachment: Attachment) => {
        setDownloading((current) => new Set(current).add(attachment.id));
        await downloadAttachment(projectId, attachment);
        setDownloading((current) => {
            const next = new Set(current);
            next.delete(attachment.id);
            return next;
        });
    };

    let body;
    if (list.isPending) {
        body = (
            <div aria-busy="true" className="flex flex-col gap-3">
                <span className="sr-only">Loading attachments…</span>
                {Array.from({ length: 2 }, (_, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <Skeleton width={20} height={20} />
                        <div className="flex flex-1 flex-col gap-1">
                            <Skeleton width="55%" height={14} />
                            <Skeleton width="35%" height={11} />
                        </div>
                    </div>
                ))}
            </div>
        );
    } else if (list.isError) {
        body = (
            <ErrorState
                compact
                title="Couldn't load attachments"
                message={errorMessage(list.error)}
                retrying={list.isRefetching}
                onRetry={() => void list.refetch()}
            />
        );
    } else {
        const attachments = list.data.pages.flatMap((page) => page.items);
        if (attachments.length) {
            body = (
                <>
                    <ul
                        aria-labelledby={headingId}
                        className="m-0 flex list-none flex-col gap-2 p-0"
                    >
                        {attachments.map((attachment) => (
                            <AttachmentRow
                                key={attachment.id}
                                projectId={projectId}
                                attachment={attachment}
                                canDelete={can?.deleteAttachment(attachment) ?? false}
                                downloading={downloading.has(attachment.id)}
                                onDownload={() => void download(attachment)}
                            />
                        ))}
                    </ul>
                    {list.hasNextPage && (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="self-start"
                            loading={list.isFetchingNextPage}
                            onClick={() => void list.fetchNextPage()}
                        >
                            Load more
                        </Button>
                    )}
                </>
            );
        } else if (!uploads.items.length) {
            body = <p className="text-muted m-0 text-sm">No files yet.</p>;
        }
    }

    return (
        <section
            aria-labelledby={headingId}
            data-dragging={dragging || undefined}
            className={clsx(
                'flex flex-col gap-3',
                dragging && 'bg-accent-100 outline-accent outline-2',
                className,
            )}
            onDragEnter={(event) => {
                if (!hasFiles(event)) return;
                event.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
            }}
            onDragOver={(event) => {
                if (!hasFiles(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(event) => {
                if (!hasFiles(event)) return;
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
                if (!hasFiles(event)) return;
                event.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                uploads.add(event.dataTransfer.files);
            }}
        >
            <div className="flex items-center gap-2">
                <h5 id={headingId} className="m-0">
                    {title}
                </h5>
                {shown != null && (
                    <span className="text-muted text-[12px]" data-testid="attachment-count">
                        {shown}
                    </span>
                )}
                <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto"
                    onClick={() => input.current?.click()}
                >
                    <Paperclip aria-hidden size={14} />
                    Upload
                </Button>
                <input
                    ref={input}
                    type="file"
                    multiple
                    hidden
                    accept={UPLOAD_ACCEPT}
                    aria-label="Choose files to upload"
                    onChange={(event) => {
                        if (event.target.files) uploads.add(event.target.files);
                        // So choosing the same file again still fires change.
                        event.target.value = '';
                    }}
                />
            </div>
            {uploads.items.length > 0 && (
                <ul aria-label="Uploads" className="m-0 flex list-none flex-col gap-2 p-0">
                    {uploads.items.map((item) => (
                        <UploadRow
                            key={item.key}
                            item={item}
                            onCancel={() => uploads.cancel(item.key)}
                            onRetry={() => uploads.retry(item.key)}
                            onDismiss={() => uploads.dismiss(item.key)}
                        />
                    ))}
                </ul>
            )}
            {body}
        </section>
    );
}

function AttachmentRow({
    projectId,
    attachment,
    canDelete,
    downloading,
    onDownload,
}: {
    projectId: string;
    attachment: Attachment;
    canDelete: boolean;
    downloading: boolean;
    onDownload: () => void;
}) {
    const remove = useDeleteAttachment(projectId);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const kind = fileKind(attachment.mimeType);
    const Icon = ICONS[kind];
    const name = attachment.originalName;

    return (
        <li className="flex items-center gap-3" data-file-kind={kind}>
            <Icon aria-hidden size={20} className="text-muted flex-none" />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold" title={name}>
                    {name}
                </span>
                <span className="text-muted truncate text-[12px]">
                    {formatBytes(attachment.sizeBytes)} · {attachment.uploadedBy.name} ·{' '}
                    <time
                        dateTime={attachment.createdAt}
                        title={fullDateTime(attachment.createdAt)}
                    >
                        {relativeTime(attachment.createdAt)}
                    </time>
                </span>
            </div>
            <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={`Download ${name}`}
                loading={downloading}
                onClick={onDownload}
                className="flex-none"
            >
                {/* While loading, Button shows its spinner instead. */}
                <Download aria-hidden size={16} />
            </Button>
            {canDelete && (
                <>
                    <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label={`Delete ${name}`}
                        onClick={() => setConfirmOpen(true)}
                        className="flex-none"
                    >
                        <Trash2 aria-hidden size={16} />
                    </Button>
                    <ConfirmDialog
                        open={confirmOpen}
                        onOpenChange={setConfirmOpen}
                        title="Delete this file?"
                        description={`“${name}” will be permanently deleted.`}
                        confirmLabel="Delete"
                        destructive
                        // Rejects on failure (already toasted), which keeps the dialog open to retry.
                        onConfirm={async () => {
                            await remove.mutateAsync(attachment);
                        }}
                    />
                </>
            )}
        </li>
    );
}

/** A file waiting, being sent (progress + Cancel), or failed (its message + Retry / Dismiss). */
function UploadRow({
    item,
    onCancel,
    onRetry,
    onDismiss,
}: {
    item: UploadItem;
    onCancel: () => void;
    onRetry: () => void;
    onDismiss: () => void;
}) {
    const name = item.file.name;
    const failed = item.status === 'failed';

    return (
        <li className="flex items-center gap-3" data-upload-status={item.status}>
            <Paperclip aria-hidden size={20} className="text-muted flex-none" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-semibold" title={name}>
                    {name}
                </span>
                {failed ? (
                    <span className="text-danger text-[12px]">{item.error}</span>
                ) : (
                    <div className="flex items-center gap-2">
                        <span className="text-muted flex-none text-[12px]">
                            {formatBytes(item.file.size)}
                        </span>
                        <div
                            role="progressbar"
                            aria-label={`Uploading ${name}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={item.progress}
                            className="bg-divider h-1 flex-1 overflow-hidden rounded-full"
                        >
                            <div
                                className="bg-accent h-full transition-[width]"
                                style={{ width: `${item.progress}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>
            {failed ? (
                <>
                    {item.retryable && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onRetry}
                            aria-label={`Retry ${name}`}
                        >
                            Retry
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onDismiss}
                        aria-label={`Dismiss ${name}`}
                    >
                        Dismiss
                    </Button>
                </>
            ) : (
                <Button variant="ghost" size="sm" onClick={onCancel} aria-label={`Cancel ${name}`}>
                    Cancel
                </Button>
            )}
        </li>
    );
}
