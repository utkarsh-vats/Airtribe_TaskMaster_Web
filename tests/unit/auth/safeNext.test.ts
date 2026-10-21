import { describe, expect, it } from 'vitest';

import { DEFAULT_NEXT, safeNext } from '@/lib/auth/safeNext';

describe('safeNext', () => {
    it.each([
        '/dashboard',
        '/dashboard/projects?x=1',
        '/dashboard?task=abc',
        '/dashboard/projects/0b6f9f3a/tasks?view=board&priority=HIGH',
        '/dashboard/projects/%E2%9C%93', // encoded non-ASCII stays as given
    ])('keeps %s', (next) => {
        expect(safeNext(next)).toBe(next);
    });

    it.each([null, undefined, ''])('falls back for %s', (next) => {
        expect(safeNext(next)).toBe(DEFAULT_NEXT);
    });

    it.each([
        '//evil.com',
        'https://evil.com',
        '/\\evil',
        '/%2F%2Fevil.com',
        '/dashboard/../login',
        '/dashboard/%2e%2e/login',
        '/dashboard/..',
        '/login',
        '/',
        'javascript:alert(1)',
        '/dashboardevil',
        '/dashboard\\..\\login',
        '/dashboard/%0d%0aSet-Cookie:x',
        '/dashboard/\tx',
        '/dashboard/%E0%A4%A', // malformed escape
        'dashboard',
        ' /dashboard',
    ])('rejects %s', (next) => {
        expect(safeNext(next)).toBe(DEFAULT_NEXT);
    });
});
