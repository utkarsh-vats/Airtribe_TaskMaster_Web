import { z } from 'zod';

import type { ApiErrorDetail } from './types';

/**
 * Error codes the API sends in `error.code`. Hand-written: the spec types `code` as a plain
 * string and only names the codes in response descriptions. NETWORK_ERROR is client-side.
 */
export const ERROR_CODES = {
    BAD_REQUEST: 'BAD_REQUEST',
    INVALID_CURRENT_PASSWORD: 'INVALID_CURRENT_PASSWORD',
    UNAUTHORIZED: 'UNAUTHORIZED',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    INVITATION_EXPIRED: 'INVITATION_EXPIRED',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
    UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    RATE_LIMITED: 'RATE_LIMITED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    AI_UPSTREAM_ERROR: 'AI_UPSTREAM_ERROR',
    AI_DISABLED: 'AI_DISABLED',
    /** No response at all: offline, DNS, CORS, connection refused. */
    NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type KnownErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
/** Known codes autocomplete; any other string the API adds still type-checks. */
export type ErrorCode = KnownErrorCode | (string & {});

type ApiErrorInit = {
    status: number;
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string | undefined;
    cause?: unknown;
};

/** A failed API call: HTTP status (0 when there was no response) plus the API's error envelope. */
export class ApiError extends Error {
    readonly status: number;
    readonly code: ErrorCode;
    /** Field-level problems on 422 (`path` is the request field, e.g. "title"). */
    readonly details: ApiErrorDetail[];
    readonly requestId: string | undefined;

    constructor({ status, code, message, details = [], requestId, cause }: ApiErrorInit) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
        this.requestId = requestId;
    }
}

export function isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
}

/**
 * The resource isn't there for you: a 404 (deleted, or you're not in its project) or the 422
 * the API sends for a malformed id in the URL. An answer, not a transient failure.
 */
export function isNotFound(error: unknown): error is ApiError {
    return isApiError(error) && (error.status === 404 || error.status === 422);
}

export function hasCode(error: unknown, code: ErrorCode): error is ApiError {
    return isApiError(error) && error.code === code;
}

const envelopeSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
        requestId: z.string().optional(),
    }),
});

/**
 * Build an ApiError from an error response. `body` is the parsed JSON (or text) when the caller
 * already read it; otherwise it's read from the response. Anything that isn't the API's
 * envelope — an HTML 502 from a proxy, an empty body — becomes INTERNAL_ERROR with the status kept.
 */
export async function toApiError(response: Response, body?: unknown): Promise<ApiError> {
    const payload = body === undefined ? await readBody(response) : body;
    const parsed = envelopeSchema.safeParse(payload);

    if (parsed.success) {
        const { code, message, details, requestId } = parsed.data.error;
        return new ApiError({ status: response.status, code, message, details, requestId });
    }

    return new ApiError({
        status: response.status,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: `Request failed with status ${response.status}`,
    });
}

async function readBody(response: Response): Promise<unknown> {
    if (response.bodyUsed) return undefined;
    const text = await response.text().catch(() => '');
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/** The ApiError for a request that never got a response. */
export function networkError(cause: unknown): ApiError {
    return new ApiError({
        status: 0,
        code: ERROR_CODES.NETWORK_ERROR,
        message: "Couldn't reach the server. Check your connection and try again.",
        cause,
    });
}
