import { afterEach, describe, expect, it, vi } from "vitest";
import {
  persistSession,
  readSession,
  sessionFromToken,
  TOKEN_KEY,
  USERNAME_KEY,
} from "./session";

const now = 1_800_000_000_000;
const jwt = (claims: unknown) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

afterEach(() => vi.unstubAllGlobals());

describe("JWT session lifecycle", () => {
  it("reads username and expiry without assuming a fixed payload padding", () => {
    const token = jwt({ username: "charlie", exp: now / 1000 + 60 });
    expect(sessionFromToken(token, undefined, now)).toEqual({
      token,
      user: { username: "charlie" },
      expiresAt: now + 60_000,
    });
  });

  it("decodes UTF-8 usernames in URL-safe JWT payloads", () => {
    expect(
      sessionFromToken(jwt({ username: "创作者🌿" }), undefined, now)?.user
        .username,
    ).toBe("创作者🌿");
  });

  it("rejects expired, malformed, and invalid-expiry tokens", () => {
    for (const token of [
      jwt({ username: "charlie", exp: now / 1000 }),
      jwt({ username: "charlie", exp: "tomorrow" }),
      jwt({ username: "charlie", exp: Number.MAX_VALUE }),
      jwt([]),
      "not-a-jwt",
      "header.invalid.signature",
      "header..signature",
    ]) {
      expect(sessionFromToken(token, undefined, now)).toBeNull();
    }
  });

  it("supports legacy tokens without expiry and supplied sign-in usernames", () => {
    expect(
      sessionFromToken(jwt({ sub: "charlie" }), undefined, now)?.expiresAt,
    ).toBeNull();
    expect(sessionFromToken(jwt({}), "charlie", now)?.user.username).toBe(
      "charlie",
    );
    expect(sessionFromToken(jwt({}), undefined, now)).toBeNull();
  });

  it("restores the original token storage key and clears both stored values on logout", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const token = jwt({ username: "legacy-user" });
    values.set("token", token);
    expect(readSession()?.user.username).toBe("legacy-user");
    const session = sessionFromToken(jwt({}), "new-user");
    persistSession(session);
    expect(values.get(TOKEN_KEY)).toBe(session?.token);
    expect(values.get(USERNAME_KEY)).toBe("new-user");
    expect(readSession()?.user.username).toBe("new-user");
    persistSession(null);
    expect(readSession()).toBeNull();
    expect(values.size).toBe(0);
  });

  it("handles browsers that deny localStorage without crashing", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new DOMException("Access denied", "SecurityError");
        },
        setItem: () => {
          throw new DOMException("Access denied", "SecurityError");
        },
        removeItem: () => {
          throw new DOMException("Access denied", "SecurityError");
        },
      },
    });
    expect(readSession()).toBeNull();
    expect(() =>
      persistSession(sessionFromToken(jwt({ username: "charlie" }))),
    ).not.toThrow();
    expect(() => persistSession(null)).not.toThrow();
  });
});
