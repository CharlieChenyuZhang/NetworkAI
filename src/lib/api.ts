import { UNAUTHORIZED_EVENT } from "./session";
import type { CreatePostInput, Post, SearchOptions } from "./types";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "https://socialai-496702.uw.r.appspot.com"
).replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const statusMessage = (status: number): string => {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to make this change.";
  if (status === 404) return "This content or service could not be found.";
  if (status === 409) return "That username is already taken. Try another one.";
  if (status === 413)
    return "This file is too large. Please choose a smaller file.";
  if (status === 429)
    return "Too many requests. Please wait a moment and try again.";
  if (status >= 500)
    return "The service is temporarily unavailable. Please try again.";
  return "The request could not be completed. Please check your details and try again.";
};

async function request(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    throw new ApiError(
      "Could not connect. Check your connection and try again.",
      0,
    );
  }
  if (!response.ok) {
    if (response.status === 401 && token && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(UNAUTHORIZED_EVENT, { detail: { token } }),
      );
    }
    throw new ApiError(statusMessage(response.status), response.status);
  }
  return response;
}

export async function login(
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const response = await request("/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
      signal,
    });
    // The existing Go endpoint responds with the token as plain text.
    const body = (await response.text()).trim();
    let token: unknown;
    try {
      token = body.startsWith('"') ? JSON.parse(body) : body;
    } catch {
      throw new ApiError(
        "The sign-in response was invalid. Please try again.",
        502,
      );
    }
    if (typeof token !== "string" || !token) {
      throw new ApiError(
        "The sign-in response was invalid. Please try again.",
        502,
      );
    }
    return token;
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw new ApiError(
        "The username or password is incorrect.",
        error.status,
      );
    }
    throw error;
  }
}

export async function registerAccount(
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<void> {
  await request("/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password }),
    signal,
  });
}

function isPost(value: unknown): value is Post {
  if (!value || typeof value !== "object") return false;
  const post = value as Record<string, unknown>;
  return (
    typeof post.id === "string" &&
    typeof post.user === "string" &&
    typeof post.message === "string" &&
    typeof post.url === "string" &&
    (post.type === "image" || post.type === "video")
  );
}

export async function searchPosts(
  token: string,
  options: SearchOptions = {},
  signal?: AbortSignal,
): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options.keywords?.trim()) params.set("keywords", options.keywords.trim());
  if (options.user?.trim()) params.set("user", options.user.trim());
  const query = params.size ? `?${params.toString()}` : "";
  const response = await request(`/search${query}`, { signal }, token);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "The service returned unreadable posts. Please try again.",
      502,
    );
  }
  // Go serializes a nil slice as null when there are no matching results.
  if (data === null) return [];
  if (!Array.isArray(data) || !data.every(isPost)) {
    throw new ApiError(
      "The service returned unexpected posts. Please try again.",
      502,
    );
  }
  return data;
}

export async function createPost(
  token: string,
  input: CreatePostInput,
  signal?: AbortSignal,
): Promise<void> {
  const data = new FormData();
  data.append("message", input.message.trim());
  data.append("media_file", input.media);
  // Let fetch supply the multipart boundary expected by the existing Go API.
  await request("/upload", { method: "POST", body: data, signal }, token);
}

export async function deletePost(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    `/post/${encodeURIComponent(id)}`,
    { method: "DELETE", signal },
    token,
  );
}
