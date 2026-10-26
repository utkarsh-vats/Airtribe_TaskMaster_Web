import { describe, expect, it } from 'vitest';

import { ApiError, ERROR_CODES, networkError } from '@/lib/api/errors';
import { errorMessage, FALLBACK_ERROR_MESSAGE } from '@/lib/api/messages';

const apiError = (status: number, code: string, message = 'API message') =>
    new ApiError({ status, code, message });

describe('errorMessage', () => {
    it.each([
        [401, ERROR_CODES.TOKEN_EXPIRED, 'Your session has expired. Please sign in again.'],
        [401, ERROR_CODES.UNAUTHORIZED, 'Your session has expired. Please sign in again.'],
        [401, ERROR_CODES.INVALID_REFRESH_TOKEN, 'Your session has expired. Please sign in again.'],
        [401, ERROR_CODES.INVALID_CREDENTIALS, 'Incorrect email or password.'],
        [400, ERROR_CODES.INVALID_CURRENT_PASSWORD, 'Your current password is incorrect.'],
        [403, ERROR_CODES.FORBIDDEN, "You don't have permission to do that."],
        [404, ERROR_CODES.NOT_FOUND, "That doesn't exist, or you no longer have access to it."],
        [410, ERROR_CODES.INVITATION_EXPIRED, 'This invitation has expired.'],
        [413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Too large — max 10 MB.'],
        [415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, "That file type isn't allowed."],
        [422, ERROR_CODES.VALIDATION_ERROR, 'Please check the highlighted fields.'],
        [429, ERROR_CODES.RATE_LIMITED, 'Too many attempts — try again in a minute.'],
        [502, ERROR_CODES.AI_UPSTREAM_ERROR, "AI couldn't respond — try again."],
        [503, ERROR_CODES.AI_DISABLED, "AI drafting isn't available right now."],
    ])('%i %s', (status, code, expected) => {
        expect(errorMessage(apiError(status, code))).toBe(expected);
    });

    it('uses the API message for 409', () => {
        expect(errorMessage(apiError(409, ERROR_CODES.CONFLICT, 'Already a member'))).toBe(
            'Already a member',
        );
    });

    it('explains a network failure', () => {
        expect(errorMessage(networkError(new TypeError('fetch failed')))).toBe(
            "Can't reach the server. Check your connection.",
        );
    });

    it('falls back for other failures and for values that are not ApiErrors', () => {
        expect(errorMessage(apiError(500, ERROR_CODES.INTERNAL_ERROR))).toBe(
            FALLBACK_ERROR_MESSAGE,
        );
        expect(errorMessage(apiError(502, ERROR_CODES.INTERNAL_ERROR))).toBe(
            FALLBACK_ERROR_MESSAGE,
        );
        expect(errorMessage(apiError(400, ERROR_CODES.BAD_REQUEST))).toBe(FALLBACK_ERROR_MESSAGE);
        expect(errorMessage(new Error('boom'))).toBe('Something went wrong.');
        expect(errorMessage('nope')).toBe('Something went wrong.');
        expect(errorMessage(undefined)).toBe('Something went wrong.');
    });
});
