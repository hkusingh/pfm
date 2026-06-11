// Thin fetch wrapper — all API calls go through here.
// The Vite proxy forwards /api/* → http://localhost:3000/* in dev.

const BASE = '/api';

type ApiSuccess<T> = { data: T };
type ApiError = { error: { code: string; message: string; details?: unknown } };
type ApiResult<T> = ApiSuccess<T> | ApiError;

export class ApiException extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  const body = (await res.json()) as ApiResult<T>;

  if ('error' in body) {
    throw new ApiException(body.error.code, body.error.message, body.error.details);
  }

  return body.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
