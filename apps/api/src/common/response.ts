// Standard API response envelope — { data: T } | { error: { code, message, details? } }

export type ApiSuccess<T> = { data: T };
export type ApiError = { error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
export type CursorPage<T> = { data: T[]; meta: { nextCursor: string | null } };

export function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

export function paginated<T>(data: T[], nextCursor: string | null): ApiSuccess<CursorPage<T>> {
  return { data: { data, meta: { nextCursor } } };
}
