import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createPost,
  deletePost,
  login,
  registerAccount,
  searchPosts,
} from "./api";
import { UNAUTHORIZED_EVENT } from "./session";

afterEach(() => vi.unstubAllGlobals());

function mockResponse(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("existing Go REST contracts", () => {
  it("signs in with JSON credentials and accepts the raw JWT response", async () => {
    const fetchMock = mockResponse(new Response("header.payload.signature\n"));
    expect(await login("  charlie  ", " pass word ")).toBe(
      "header.payload.signature",
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/signin$/);
    expect(options.method).toBe("POST");
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({
      username: "charlie",
      password: " pass word ",
    });
    expect(options.headers.has("Authorization")).toBe(false);
  });

  it("registers without requiring a response body or implicitly signing in", async () => {
    const fetchMock = mockResponse(new Response(null, { status: 200 }));
    await registerAccount("charlie", "test-password");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/signup$/);
  });

  it("encodes search terms without injecting query parameters and supplies JWT", async () => {
    const fetchMock = mockResponse(Response.json([]));
    await searchPosts("existing-jwt", {
      keywords: " plants & sun? ",
      user: "a+b",
    });
    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/search");
    expect([...parsed.searchParams]).toEqual([
      ["keywords", "plants & sun?"],
      ["user", "a+b"],
    ]);
    expect(options.headers.get("Authorization")).toBe("Bearer existing-jwt");
    expect(options.cache).toBe("no-store");
  });

  it("handles Go nil slices as an empty collection", async () => {
    mockResponse(Response.json(null));
    expect(await searchPosts("token")).toEqual([]);
  });

  it("preserves typed image and video results", async () => {
    const posts = [
      {
        id: "one",
        user: "charlie",
        message: "A garden",
        type: "image",
        url: "https://example.com/one.png",
      },
      {
        id: "two",
        user: "charlie",
        message: "A film",
        type: "video",
        url: "https://example.com/two.mp4",
      },
    ];
    mockResponse(Response.json(posts));
    expect(await searchPosts("token")).toEqual(posts);
  });

  it("rejects HTML or malformed results instead of presenting them as empty content", async () => {
    mockResponse(new Response("<html>Service not found</html>"));
    await expect(searchPosts("token")).rejects.toMatchObject({ status: 502 });
    mockResponse(Response.json([{ message: "Missing required fields" }]));
    await expect(searchPosts("token")).rejects.toMatchObject({ status: 502 });
  });

  it("uploads the exact existing multipart field names without overriding the boundary", async () => {
    const fetchMock = mockResponse(new Response(null, { status: 200 }));
    const media = new File(["png-data"], "garden.png", { type: "image/png" });
    await createPost("token", { message: " A garden ", media });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/upload$/);
    expect(options.method).toBe("POST");
    expect(options.body.get("message")).toBe("A garden");
    expect(options.body.get("media_file").name).toBe("garden.png");
    expect([...options.body.keys()]).toEqual(["message", "media_file"]);
    expect(options.headers.has("Content-Type")).toBe(false);
  });

  it("deletes by safely encoded post ID with the original method", async () => {
    const fetchMock = mockResponse(new Response(null, { status: 200 }));
    await deletePost("token", "folder/id?x=y");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/post\/folder%2Fid%3Fx%3Dy$/);
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("notifies the session provider only about the rejected authenticated token", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    mockResponse(new Response(null, { status: 401 }));
    await expect(searchPosts("rejected-token")).rejects.toBeInstanceOf(
      ApiError,
    );
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe(UNAUTHORIZED_EVENT);
    expect(event.detail).toEqual({ token: "rejected-token" });
    dispatchEvent.mockClear();
    await expect(login("charlie", "wrong-password")).rejects.toMatchObject({
      message: "The username or password is incorrect.",
      status: 401,
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("preserves request cancellation so stale searches can be discarded", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    controller.abort();
    await expect(searchPosts("token", {}, controller.signal)).rejects.toBe(
      abortError,
    );
  });

  it("returns a useful connection error and does not expose server HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(searchPosts("token")).rejects.toMatchObject({ status: 0 });
    mockResponse(
      new Response("<html>private stack trace</html>", { status: 500 }),
    );
    await expect(searchPosts("token")).rejects.toMatchObject({
      message: "The service is temporarily unavailable. Please try again.",
      status: 500,
    });
  });
});
