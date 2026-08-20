export const API_URL = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL || '';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) }, ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.errors?.[0]?.detail || `Request failed ${res.status}`);
  return json as T;
}
