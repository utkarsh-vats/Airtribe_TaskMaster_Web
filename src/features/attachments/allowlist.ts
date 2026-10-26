import { TOO_LARGE_MESSAGE, TYPE_NOT_ALLOWED_MESSAGE } from '@/lib/api/messages';
import { env } from '@/lib/env';

/*
 * What the API accepts as an attachment (DESIGN.md §7 "Uploads"): a mirror of the backend's
 * ALLOWED_MIME_TYPES (src/middleware/upload.ts) and MAX_UPLOAD_MB. The backend trusts the
 * MIME type the browser declares, so that's what is checked here; the extension only rescues
 * files the browser labels oddly (Windows reports .zip as application/x-zip-compressed, and
 * some files get no type or application/octet-stream).
 */

/** Allowed MIME type → its extensions (the first is the usual one). */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'application/pdf': ['.pdf'],
    'text/plain': ['.txt'],
    'text/csv': ['.csv'],
    'application/zip': ['.zip'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

const MIME_BY_EXTENSION = new Map(
    Object.entries(ALLOWED).flatMap(([mime, extensions]) =>
        extensions.map((extension) => [extension, mime] as const),
    ),
);

export const MAX_UPLOAD_MB = env.NEXT_PUBLIC_MAX_UPLOAD_MB;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** The file input's `accept`: every allowed extension and MIME type. */
export const UPLOAD_ACCEPT = [...MIME_BY_EXTENSION.keys(), ...Object.keys(ALLOWED)].join(',');

const extensionOf = (name: string) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/**
 * The MIME type to upload `file` as, or null when the API won't take it: its own type when
 * that's allowed, else the one its extension stands for.
 */
export function uploadMimeType(file: Pick<File, 'name' | 'type'>): string | null {
    const type = file.type.toLowerCase();
    if (Object.hasOwn(ALLOWED, type)) return type;
    return MIME_BY_EXTENSION.get(extensionOf(file.name)) ?? null;
}

/** What's wrong with uploading `file` (the row's message), or null if it can go. */
export function uploadProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
    if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE_MESSAGE;
    if (!uploadMimeType(file)) return TYPE_NOT_ALLOWED_MESSAGE;
    return null;
}
