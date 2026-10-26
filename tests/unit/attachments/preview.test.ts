import { describe, expect, it } from 'vitest';

import { previewKind } from '@/features/attachments/preview';

describe('previewKind', () => {
    it.each([
        ['image/png', 'image'],
        ['image/jpeg', 'image'],
        ['image/gif', 'image'],
        ['IMAGE/WEBP', 'image'],
        ['image/svg+xml', 'none'], // could carry script: not previewed
        ['application/pdf', 'pdf'],
        ['text/plain', 'text'],
        ['text/plain; charset=utf-8', 'text'],
        ['text/csv', 'text'],
        ['text/html', 'none'],
        ['application/zip', 'none'],
        ['application/vnd.ms-excel', 'none'],
        ['', 'none'],
    ])('%s → %s', (mime, kind) => {
        expect(previewKind(mime)).toBe(kind);
    });
});
