import { describe, expect, it } from 'vitest';

import { formatBytes } from '@/lib/format/bytes';

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [1, '1 B'],
        [512, '512 B'],
        [1023, '1023 B'],
        [1024, '1 KB'], // .0 dropped
        [1536, '1.5 KB'],
        [10 * 1024 - 1, '10 KB'], // 9.999 KB rounds up past one decimal
        [12 * 1024, '12 KB'],
        [12.6 * 1024, '13 KB'], // no decimal from 10 up
        [1023.7 * 1024, '1 MB'], // not "1024 KB"
        [3.4 * 1024 * 1024, '3.4 MB'],
        [10 * 1024 * 1024, '10 MB'], // the upload limit
        [2.25 * 1024 ** 3, '2.3 GB'],
    ])('%d → %s', (bytes, expected) => {
        expect(formatBytes(bytes)).toBe(expected);
    });

    it('returns "" for nonsense', () => {
        expect(formatBytes(-1)).toBe('');
        expect(formatBytes(Number.NaN)).toBe('');
    });
});
