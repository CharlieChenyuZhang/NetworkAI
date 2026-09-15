import type { Session } from "./types";

// Keep the original key so existing sessions survive the frontend migration.
export const TOKEN_KEY = "token";
export const USERNAME_KEY = "networkai:username";
export const UNAUTHORIZED_EVENT = "networkai:unauthorized";

/** Read JWT claims for client UX only. The Go API verifies the signature. */
export function sessionFromToken(
  token: string,
  fallbackUsername?: string | null,
  now = Date.now(),
): Session | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!claims || typeof claims !== "object" || Array.isArray(claims))
      return null;
    const values = claims as Record<string, unknown>;
    const username = [
      values.username,
      values.Username,
      values.user,
      values.sub,
      fallbackUsername,
    ].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );
    if (!username) return null;
    if (
      values.exp !== undefined &&
      (typeof values.exp !== "number" || !Number.isFinite(values.exp))
    )
      return null;
    const expiresAt = typeof values.exp === "number" ? values.exp * 1000 : null;
    if (expiresAt !== null && !Number.isFinite(expiresAt)) return null;
    if (expiresAt !== null && expiresAt <= now) return null;
    return { token, user: { username }, expiresAt };
  } catch {
    return null;
  }
}

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    return token
      ? sessionFromToken(token, window.localStorage.getItem(USERNAME_KEY))
      : null;
  } catch {
    return null;
  }
}

export function persistSession(session: Session | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.localStorage.setItem(USERNAME_KEY, session.user.username);
      window.localStorage.setItem(TOKEN_KEY, session.token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USERNAME_KEY);
    }
  } catch {
    // Private browsing or a storage policy may block persistence. The current
    // in-memory session still works and the user can continue this visit.
  }
}
