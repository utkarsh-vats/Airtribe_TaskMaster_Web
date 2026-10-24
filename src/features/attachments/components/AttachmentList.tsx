'use client';

import { clsx } from 'clsx';
import {
    Download,
    File,
    FileArchive,
    FileImage,
    FileSpreadsheet,
    FileText,
    type LucideIcon,
} from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { downloadAttachment } from '@/lib/api/download';
import { errorMessage } from '@/lib/api/messages';
import type { Attachment } from '@/lib/api/types';
import { formatBytes } from '@/lib/format/bytes';
import { fullDateTime, relativeTime } from '@/lib/format/dates';

import { useAttachments } from '../api';
import { fileKind, type FileKind } from '../fileKind';

const ICONS: Record<FileKind, LucideIcon> = {
    image: FileImage,
    spreadsheet: FileSpreadsheet,
    archive: FileArchive,
    document: FileText,
    other: File,
};

/**
 * A list of attachments (DESIGN.md §6) for a task, or the project-level ones (`taskId` null):
 * "Attachments" + count, then the files newest first with "Load more" for the next page. Each
 * row downloads its file. Used by the task panel and the project's Files tab.
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
    const headingId = useId();
    // The files being downloaded right now, each with its own spinner.
    const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set());
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
        body = attachments.length ? (
            <>
                <ul aria-labelledby={headingId} className="m-0 flex list-none flex-col gap-2 p-0">
                    {attachments.map((attachment) => (
                        <AttachmentRow
                            key={attachment.id}
                            attachment={attachment}
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
        ) : (
            <p className="text-muted m-0 text-sm">No files yet.</p>
        );
    }

    return (
        <section aria-labelledby={headingId} className={clsx('flex flex-col gap-3', className)}>
            <div className="flex items-baseline gap-2">
                <h5 id={headingId} className="m-0">
                    {title}
                </h5>
                {shown != null && (
                    <span className="text-muted text-[12px]" data-testid="attachment-count">
                        {shown}
                    </span>
                )}
            </div>
            {body}
        </section>
    );
}

function AttachmentRow({
    attachment,
    downloading,
    onDownload,
}: {
    attachment: Attachment;
    downloading: boolean;
    onDownload: () => void;
}) {
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
        </li>
    );
}
