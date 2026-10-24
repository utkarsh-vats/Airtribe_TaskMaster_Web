/** What a file is, from its MIME type, for its icon. */
export type FileKind = 'image' | 'spreadsheet' | 'archive' | 'document' | 'other';

const SPREADSHEETS = new Set([
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
]);

const ARCHIVES = new Set([
    'application/zip',
    'application/x-zip-compressed',
    'application/gzip',
    'application/x-gzip',
    'application/x-tar',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/vnd.rar',
]);

const DOCUMENTS = new Set([
    'application/pdf',
    'application/json',
    'application/rtf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
]);

export function fileKind(mimeType: string): FileKind {
    const mime = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
    if (mime.startsWith('image/')) return 'image';
    // Before text/*: CSV is a spreadsheet.
    if (SPREADSHEETS.has(mime)) return 'spreadsheet';
    if (ARCHIVES.has(mime)) return 'archive';
    if (mime.startsWith('text/') || DOCUMENTS.has(mime)) return 'document';
    return 'other';
}
