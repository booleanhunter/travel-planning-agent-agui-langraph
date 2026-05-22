/**
 * Typed errors + Express middleware. Throw `AppError` with an `ErrorType`;
 * `handleError` maps it to a status code and a JSON response body.
 */

import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';

export const HttpStatusCode = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,

    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,

    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
} as const;
export type HttpStatusCode = (typeof HttpStatusCode)[keyof typeof HttpStatusCode];

export const ErrorType = {
    INVALID_INPUT: 'INVALID_INPUT',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    EXTERNAL_SERVICE: 'EXTERNAL_SERVICE',
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    UNKNOWN: 'UNKNOWN',
} as const;
export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType];

const ERROR_TYPE_TO_HTTP_STATUS: Record<ErrorType, HttpStatusCode> = {
    [ErrorType.INVALID_INPUT]: HttpStatusCode.BAD_REQUEST,
    [ErrorType.UNAUTHORIZED]: HttpStatusCode.UNAUTHORIZED,
    [ErrorType.FORBIDDEN]: HttpStatusCode.FORBIDDEN,
    [ErrorType.NOT_FOUND]: HttpStatusCode.NOT_FOUND,
    [ErrorType.CONFLICT]: HttpStatusCode.CONFLICT,
    [ErrorType.EXTERNAL_SERVICE]: HttpStatusCode.BAD_GATEWAY,
    [ErrorType.INTERNAL_SERVER_ERROR]: HttpStatusCode.INTERNAL_SERVER_ERROR,
    [ErrorType.UNKNOWN]: HttpStatusCode.INTERNAL_SERVER_ERROR,
};

export interface AppErrorOptions {
    publicMessage?: string;
    data?: unknown;
}

export class AppError extends Error {
    readonly errorType: ErrorType;
    readonly publicMessage: string | null;
    readonly data: unknown;

    constructor(
        name: string,
        message: string,
        errorType?: ErrorType,
        options: AppErrorOptions = {},
    ) {
        super(message);
        this.name = name;
        this.errorType = errorType ?? ErrorType.UNKNOWN;
        this.publicMessage = options.publicMessage ?? null;
        this.data = options.data ?? null;
        Error.captureStackTrace(this, AppError);
    }

    getHttpStatus(): HttpStatusCode {
        return ERROR_TYPE_TO_HTTP_STATUS[this.errorType] ?? HttpStatusCode.INTERNAL_SERVER_ERROR;
    }
}

const FALLBACK_PUBLIC_MESSAGE =
    "We couldn't complete this action. Please try again in a bit. If the problem persists, contact the maintainer for help.";

/** Centralised Express error-handling middleware. */
export const handleError: ErrorRequestHandler = (
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
) => {
    try {
        const named = error as { name?: string; message?: string; stack?: string };
        console.error('Error occurred:', {
            name: named?.name,
            message: named?.message,
            errorType: error instanceof AppError ? error.errorType : undefined,
            stack: named?.stack,
            path: req.path,
            method: req.method,
            timestamp: new Date().toISOString(),
        });

        if (error instanceof AppError) {
            res.status(error.getHttpStatus()).json({
                success: false,
                error: error.publicMessage ?? error.message,
                ...(error.data !== null && error.data !== undefined ? { data: error.data } : {}),
            });
            return;
        }

        res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({
            success: false,
            error:
                process.env.NODE_ENV === 'development'
                    ? (named?.message ?? String(error))
                    : FALLBACK_PUBLIC_MESSAGE,
        });
    } catch (handlerError) {
        console.error('Error in error handler:', handlerError);
        res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: FALLBACK_PUBLIC_MESSAGE,
        });
    }
};
