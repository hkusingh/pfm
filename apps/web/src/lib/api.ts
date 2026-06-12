// Thin fetch wrapper — all API calls go through here.
// The Vite proxy forwards /api/* → http://localhost:3000/* in dev.
//
// On 401: automatically refreshes the access token once and retries.
// On refresh failure: clears stored tokens and redirects to /login.

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

// Collapses concurrent 401s into a single refresh call
let refreshPromise: Promise<void> | null = null;

async function doRefresh(): Promise<void> {
  const rt = localStorage.getItem('refreshToken');
  if (!rt) throw new Error('no refresh token');

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  });

  if (!res.ok) throw new Error('refresh failed');

  const body = (await res.json()) as { data: { accessToken: string; refreshToken: string } };
  localStorage.setItem('accessToken', body.data.accessToken);
  localStorage.setItem('refreshToken', body.data.refreshToken);
}

async function request<T>(path: string, init?: RequestInit, allowRefresh = true): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // Skip Content-Type for FormData — browser sets it with the multipart boundary.
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401 && allowRefresh) {
    try {
      // Deduplicate: if another request already started a refresh, wait for it
      if (!refreshPromise) {
        refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
      }
      await refreshPromise;
      // Retry once with the new token now in localStorage
      return request<T>(path, init, false);
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
      throw new ApiException('UNAUTHORIZED', 'Session expired. Please log in again.');
    }
  }

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
  delete: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'DELETE', ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }),
  // Multipart upload — Content-Type is omitted so the browser sets the multipart boundary.
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
};
