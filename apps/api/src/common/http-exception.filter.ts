import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : (body as Record<string, unknown>).message ?? 'Error';
      const details =
        typeof body === 'object' ? (body as Record<string, unknown>).details : undefined;

      return response.status(status).json({
        error: { code: httpStatusToCode(status), message, details },
      });
    }

    this.logger.error(exception);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
    });
  }
}

function httpStatusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_SERVER_ERROR',
  };
  return map[status] ?? `HTTP_${status}`;
}
