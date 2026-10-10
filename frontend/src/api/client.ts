/** Fetch wrapper: JSON in/out, in-memory access token, single-flight refresh via the httpOnly cookie, uniform ApiError. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";
let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onAuthLost: (() => void) | null = null;

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setAuthLostHandler = (fn: (() => void) | null) => { onAuthLost = fn; };

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const e = body?.error;
    if (e?.code) return new ApiError(res.status, e.code, e.message ?? res.statusText, e.details);
  } catch { /* not JSON */ }
  if (res.status === 502 || res.status === 503 || res.status === 504) return new ApiError(res.status, "SERVICE_UNAVAILABLE", "The Lotus server is unavailable. Please try again in a moment.");
  return new ApiError(res.status, "HTTP_ERROR", res.statusText || "Request failed");
}

export async function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) return null;
      const body = await res.json();
      accessToken = body.access_token;
      return accessToken;
    } catch { return null; } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

export interface RequestOptions { method?: string; body?: unknown; form?: FormData; params?: Record<string, unknown>; signal?: AbortSignal; raw?: boolean }

export async function api<T = unknown>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "include", signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the Lotus server. Check your connection and try again.");
  }
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    const t = await refreshSession();
    if (t) return api<T>(path, opts, false);
    accessToken = null;
    onAuthLost?.();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  if (opts.raw) return (await res.text()) as T;
  return (await res.json()) as T;
}

export const get = <T,>(path: string, params?: Record<string, unknown>) => api<T>(path, { params });
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = (path: string) => api<void>(path, { method: "DELETE" });
