/** How a file can be previewed (DESIGN.md §6 Attachments): by its MIME type. */
export type PreviewKind = 'image' | 'pdf' | 'text' | 'none';

const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT = new Set(['text/plain', 'text/csv']);

/** Text previews show at most this much of the file (1 MB). */
export const TEXT_PREVIEW_BYTES = 1024 * 1024;

export function previewKind(mimeType: string): PreviewKind {
    const type = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
    if (IMAGES.has(type)) return 'image';
    if (type === 'application/pdf') return 'pdf';
    if (TEXT.has(type)) return 'text';
    return 'none';
}
