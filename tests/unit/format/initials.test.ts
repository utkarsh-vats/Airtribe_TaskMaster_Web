import { describe, expect, it } from 'vitest';

import { initials } from '@/lib/format/initials';

describe('initials', () => {
    it('uses the first letters of the first and last words', () => {
        expect(initials('Mara Okafor')).toBe('MO');
        expect(initials('Ana María de la Cruz')).toBe('AC');
    });

    it('uses one letter for a single name', () => {
        expect(initials('Cher')).toBe('C');
    });

    it('ignores extra whitespace', () => {
        expect(initials('  mara    okafor  ')).toBe('MO');
        expect(initials('\tPriya\nRaman ')).toBe('PR');
    });

    it('returns an empty string for an empty or blank name', () => {
        expect(initials('')).toBe('');
        expect(initials('   ')).toBe('');
    });

    it('keeps non-BMP characters whole', () => {
        expect(initials('𝒜da Lovelace')).toBe('𝒜L');
    });
});
