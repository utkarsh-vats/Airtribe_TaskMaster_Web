'use client';

import { clsx } from 'clsx';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
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
import { queryView } from '@/lib/query/view';

import { UPLOAD_ACCEPT } from '../allowlist';
import { useAttachments, useDeleteAttachment } from '../api';
import { fileKind } from '../fileKind';
import { useUploadQueue, type UploadItem } from '../useUploadQueue';
import { AttachmentPreview } from './AttachmentPreview';
import { FILE_ICONS } from './fileIcons';

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
    heading = 'Attachments',
    count,
    emptyText = 'No files yet.',
    sectionKey,
    cap,
    className,
}: {
    projectId: string;
    taskId: string | null;
    /** The section's heading ("Files" on the project's tab). */
    heading?: string;
    /**
     * The count to show: the task's attachmentCount (null while it isn't known yet, e.g. the panel is
     * still showing the list row), or the list's own total when omitted.
     */
    count?: number | null;
    /** Shown when there are no files (and none uploading). */
    emptyText?: string;
    /** Collapsible (the task panel), its open state remembered under this key. */
    sectionKey?: string;
    /** Show only the newest `cap` files, with "Show N more" for the rest. */
    cap?: number;
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
    // The file open in the preview: its index among the loaded files.
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const attachments = list.data?.pages.flatMap((page) => page.items) ?? [];
    // Files dragged over the list. dragenter/dragleave fire for every child, hence the depth.
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    // Past the cap: every file, or just the newest. Kept across deletes and uploads.
    const [expanded, setExpanded] = useState(false);
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
    const view = queryView(list);
    if (view.status === 'loading') {
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
    } else if (view.status === 'error') {
        body = (
            <ErrorState
                compact
                title="Couldn't load attachments"
                message={errorMessage(view.error)}
                retrying={list.isRefetching}
                onRetry={() => void list.refetch()}
            />
        );
    } else {
        // Newest first, as the API sends them (a new upload is prepended, Load more appends
        // older pages). Capped, the newest `cap` show — a file just uploaded is always among them.
        const total = Math.max(view.data.pages[0]?.meta.total ?? 0, attachments.length);
        const capped = cap !== undefined && total > cap;
        const visible = capped && !expanded ? attachments.slice(0, cap) : attachments;
        if (attachments.length) {
            body = (
                <>
                    <ul
                        aria-labelledby={headingId}
                        className="m-0 flex list-none flex-col gap-2 p-0"
                    >
                        {visible.map((attachment, index) => (
                            <AttachmentRow
                                key={attachment.id}
                                projectId={projectId}
                                attachment={attachment}
                                canDelete={can?.deleteAttachment(attachment) ?? false}
                                downloading={downloading.has(attachment.id)}
                                onDownload={() => void download(attachment)}
                                onPreview={() => setPreviewIndex(index)}
                            />
                        ))}
                    </ul>
                    {capped && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="self-start"
                            aria-expanded={expanded}
                            onClick={() => setExpanded(!expanded)}
                        >
                            {expanded ? 'Show less' : `Show ${total - (cap ?? 0)} more`}
                        </Button>
                    )}
                    {list.hasNextPage && (!capped || expanded) && (
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
            body = <p className="text-muted m-0 text-sm">{emptyText}</p>;
        }
    }

    const dropZone = {
        'data-dragging': dragging || undefined,
        className: clsx(
            'flex flex-col gap-3',
            dragging && 'bg-accent-100 outline-accent outline-2',
            className,
        ),
        onDragEnter: (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
        },
        onDragOver: (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: (event: DragEvent) => {
            if (!hasFiles(event)) return;
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            uploads.add(event.dataTransfer.files);
        },
    };

    const countBadge = shown != null && <span data-testid="attachment-count">{shown}</span>;

    const uploadControls = (
        <>
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
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
        </>
    );

    // Files being uploaded go above the list: the newest of all.
    const content = (
        <>
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
        </>
    );

    return (
        <>
            {sectionKey ? (
                <CollapsibleSection
                    sectionKey={sectionKey}
                    title={heading}
                    titleId={headingId}
                    count={countBadge || undefined}
                    actions={uploadControls}
                    {...dropZone}
                >
                    {content}
                </CollapsibleSection>
            ) : (
                <section aria-labelledby={headingId} {...dropZone}>
                    <div className="flex items-center gap-2">
                        <h5 id={headingId} className="m-0">
                            {heading}
                        </h5>
                        {countBadge && <span className="text-muted text-[12px]">{countBadge}</span>}
                        <div className="ml-auto flex items-center gap-2">{uploadControls}</div>
                    </div>
                    {content}
                </section>
            )}
            {/* Outside the section: drops on the dialog (a portal) mustn't reach the drop zone. */}
            <AttachmentPreview
                projectId={projectId}
                attachments={attachments}
                index={previewIndex}
                onIndexChange={setPreviewIndex}
            />
        </>
    );
}

function AttachmentRow({
    projectId,
    attachment,
    canDelete,
    downloading,
    onDownload,
    onPreview,
}: {
    projectId: string;
    attachment: Attachment;
    canDelete: boolean;
    downloading: boolean;
    onDownload: () => void;
    onPreview: () => void;
}) {
    const remove = useDeleteAttachment(projectId);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const kind = fileKind(attachment.mimeType);
    const Icon = FILE_ICONS[kind];
    const name = attachment.originalName;

    return (
        <li className="flex items-center gap-3" data-file-kind={kind}>
            <Icon aria-hidden size={20} className="text-muted flex-none" />
            <div className="flex min-w-0 flex-1 flex-col">
                {/* A button: click or Enter opens the preview. */}
                <button
                    type="button"
                    className="max-w-full cursor-pointer self-start truncate text-left text-sm font-semibold hover:underline"
                    title={name}
                    onClick={onPreview}
                >
                    {name}
                </button>
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
