'use client';

import { skipToken, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
    downloadAttachment,
    fetchAttachmentBlob,
    FILE_GONE_MESSAGE,
    isFileGone,
    saveBlob,
} from '@/lib/api/download';
import { errorMessage } from '@/lib/api/messages';
import type { Attachment } from '@/lib/api/types';
import { formatBytes } from '@/lib/format/bytes';
import { queryKeys } from '@/lib/query/keys';

import { fileKind } from '../fileKind';
import { previewKind, TEXT_PREVIEW_BYTES, type PreviewKind } from '../preview';
import { FILE_ICONS } from './fileIcons';

export const NO_PREVIEW_MESSAGE = 'No preview for this file type.';
export const TRUNCATED_MESSAGE = 'Preview truncated — download for the full file.';

type Loaded = { blob: Blob; text: string | null; truncated: boolean };

/** Arrow keys typed into a field are the field's. */
const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The file preview (DESIGN.md §6 Attachments): a large dialog over one of `attachments` (the
 * list's loaded files, in order) — open while `index` isn't null. The file is fetched when
 * shown (through the API client, like a download) and the fetch is aborted when the dialog
 * closes or moves on. Images, PDFs and text (the first 1 MB) are shown; anything else gets
 * a Download button. Previous / next (and ← / →) move through all the files.
 */
export function AttachmentPreview({
    projectId,
    attachments,
    index,
    onIndexChange,
}: {
    projectId: string;
    attachments: readonly Attachment[];
    index: number | null;
    onIndexChange: (index: number | null) => void;
}) {
    const attachment = index === null ? undefined : attachments[index];
    const kind: PreviewKind = attachment ? previewKind(attachment.mimeType) : 'none';
    const [downloading, setDownloading] = useState(false);

    const preview = useQuery({
        queryKey: queryKeys.attachments.blob(projectId, attachment?.id ?? ''),
        // Nothing to fetch for a file that can't be shown.
        queryFn:
            attachment && kind !== 'none'
                ? async ({ signal }): Promise<Loaded> => {
                      const blob = await fetchAttachmentBlob(projectId, attachment, signal);
                      if (kind !== 'text') return { blob, text: null, truncated: false };
                      const head = await blob.slice(0, TEXT_PREVIEW_BYTES).arrayBuffer();
                      return {
                          blob,
                          text: new TextDecoder().decode(head),
                          truncated: blob.size > TEXT_PREVIEW_BYTES,
                      };
                  }
                : skipToken,
        // Files are up to 10 MB: never kept once the preview moves on (that also aborts it).
        gcTime: 0,
        retry: false,
    });

    const count = attachments.length;
    const hasPrev = index !== null && index > 0;
    const hasNext = index !== null && index < count - 1;

    useEffect(() => {
        if (index === null) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (event.defaultPrevented || isTyping(event.target)) return;
            if (event.key === 'ArrowLeft' && index > 0) {
                event.preventDefault();
                onIndexChange(index - 1);
            } else if (event.key === 'ArrowRight' && index < count - 1) {
                event.preventDefault();
                onIndexChange(index + 1);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [index, count, onIndexChange]);

    const download = async () => {
        if (!attachment) return;
        // Already here for the preview: save it rather than fetch it again.
        if (preview.data) return saveBlob(preview.data.blob, attachment.originalName);
        setDownloading(true);
        await downloadAttachment(projectId, attachment);
        setDownloading(false);
    };

    const name = attachment?.originalName ?? '';
    const downloadButton = (variant: 'secondary' | 'primary') => (
        <Button
            variant={variant}
            size="sm"
            loading={downloading}
            onClick={() => void download()}
            aria-label={`Download ${name}`}
        >
            <Download aria-hidden size={14} />
            Download
        </Button>
    );

    let body = null;
    if (attachment) {
        if (kind === 'none') {
            const Icon = FILE_ICONS[fileKind(attachment.mimeType)];
            body = (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <Icon aria-hidden size={48} className="text-muted" />
                    <p className="text-muted m-0">{NO_PREVIEW_MESSAGE}</p>
                    {downloadButton('primary')}
                </div>
            );
        } else if (preview.isPending) {
            body = (
                <div aria-busy="true">
                    <span className="sr-only">Loading preview…</span>
                    <Skeleton height="50vh" className="block" />
                </div>
            );
        } else if (preview.isError) {
            body = isFileGone(preview.error) ? (
                <p className="text-muted m-0 py-10 text-center">{FILE_GONE_MESSAGE}</p>
            ) : (
                <ErrorState
                    compact
                    title="Couldn't load the preview"
                    message={errorMessage(preview.error)}
                    retrying={preview.isRefetching}
                    onRetry={() => void preview.refetch()}
                />
            );
        } else if (kind === 'text') {
            body = (
                <div className="flex flex-col gap-2">
                    {preview.data.truncated && (
                        <p className="text-muted m-0 text-[13px]">{TRUNCATED_MESSAGE}</p>
                    )}
                    {/* Plain text: React escapes it, so markup in the file shows as written. */}
                    <pre className="m-0 font-mono text-[13px] break-words whitespace-pre-wrap">
                        {preview.data.text}
                    </pre>
                </div>
            );
        } else {
            body = (
                <BlobView key={attachment.id} blob={preview.data.blob} kind={kind} name={name} />
            );
        }
    }

    return (
        <Dialog
            open={attachment !== undefined}
            onOpenChange={(open) => {
                if (!open) onIndexChange(null);
            }}
            title={
                <span className="block truncate" title={name}>
                    {name}
                </span>
            }
            description={
                attachment && `${formatBytes(attachment.sizeBytes)} · ${attachment.uploadedBy.name}`
            }
            headerActions={attachment && kind !== 'none' && downloadButton('secondary')}
            className="w-[min(92vw,1000px)]"
        >
            <div className="max-h-[80vh] min-h-[160px] overflow-auto">{body}</div>
            {count > 1 && index !== null && (
                <div className="flex items-center justify-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label="Previous file"
                        disabled={!hasPrev}
                        onClick={() => onIndexChange(index - 1)}
                    >
                        <ChevronLeft aria-hidden size={18} />
                    </Button>
                    <span className="text-muted text-[13px]" aria-live="polite">
                        {index + 1} of {count}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label="Next file"
                        disabled={!hasNext}
                        onClick={() => onIndexChange(index + 1)}
                    >
                        <ChevronRight aria-hidden size={18} />
                    </Button>
                </div>
            )}
        </Dialog>
    );
}

/** An image or PDF from a Blob, through an object URL revoked when the element goes. */
function BlobView({ blob, kind, name }: { blob: Blob; kind: 'image' | 'pdf'; name: string }) {
    // A ref with a cleanup (React 19): the URL lives exactly as long as the element shows it.
    const showBlob = useCallback(
        (element: { src: string } | null) => {
            if (!element) return;
            const url = URL.createObjectURL(blob);
            element.src = url;
            return () => URL.revokeObjectURL(url);
        },
        [blob],
    );

    return kind === 'image' ? (
        // A blob: URL, which next/image can't optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
            ref={showBlob}
            alt={name}
            className="mx-auto block max-h-[76vh] w-full object-contain"
        />
    ) : (
        <iframe ref={showBlob} title={name} className="block h-[76vh] w-full border-0" />
    );
}
