/**
 * All browser requests intentionally stay relative to the current app origin.
 * The Express API and Vite proxy then work in local development, previews, and
 * production without baking a localhost or deployment URL into the bundle.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function getSessionId(): string {
  const key = "sovereign_persistent_session_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const created = `sovereign-session-${crypto.randomUUID()}`;
  localStorage.setItem(key, created);
  return created;
}

export async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

const WORKER_BASE = API_BASE;
export default WORKER_BASE;
