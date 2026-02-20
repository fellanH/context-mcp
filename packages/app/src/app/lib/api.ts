import { getStoredToken, clearStoredToken } from "./auth";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  // Only set Content-Type for requests with a body
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    // Try to parse error body
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // use statusText fallback
    }

    // On 401, clear stored token
    if (res.status === 401) {
      clearStoredToken();
    }

    throw new ApiError(res.status, message, code);
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json();
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};

/**
 * Upload local vault entries to a hosted vault.
 * Reads entries from the local server, posts them to the hosted import endpoint.
 */
export async function uploadLocalVault(hostedToken: string): Promise<{ imported: number; failed: number }> {
  // Fetch all entries from local server
  const localEntries = await request<{ entries: Array<Record<string, unknown>>; total: number }>(
    "/vault/entries?limit=100"
  );

  if (!localEntries.entries.length) {
    return { imported: 0, failed: 0 };
  }

  // Post to hosted bulk import
  const hostedUrl = import.meta.env.VITE_HOSTED_URL || "https://api.context-vault.com";
  const res = await fetch(`${hostedUrl}/api/vault/import/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hostedToken}`,
    },
    body: JSON.stringify({ entries: localEntries.entries }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new ApiError(res.status, body.error || "Upload failed");
  }

  return res.json();
}

// Keep legacy export for any existing usage
export const apiFetch = request;
