import { describe, expect, it, vi } from "vitest";
import { handleImageRequest, MAX_IMAGE_BYTES } from "./image-handler";

const origin = "https://networkai.example";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function request(
  fields: { prompt?: string; image?: File; size?: string } = {},
  headers: Record<string, string> = {},
) {
  const body = new FormData();
  body.set("prompt", fields.prompt ?? "A city floating in the clouds");
  if (fields.image) body.set("image", fields.image);
  if (fields.size) body.set("size", fields.size);
  return new Request(`${origin}/api/ai/image`, {
    method: "POST",
    body,
    headers: {
      Origin: origin,
      Authorization: "Bearer test.jwt.signature",
      ...headers,
    },
  });
}

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  responses.forEach((response) => fetch.mockResolvedValueOnce(response));
  return {
    fetch,
    apiBaseUrl: "https://go.example/",
    apiKey: "test-server-key",
  };
}

describe("AI image boundary", () => {
  it("blocks cross-origin callers and missing sessions before contacting services", async () => {
    const deps = setup();
    expect(
      (
        await handleImageRequest(
          request({}, { Origin: "https://other.example" }),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleImageRequest(request({}, { Origin: "" }), deps)).status,
    ).toBe(403);
    expect(
      (await handleImageRequest(request({}, { Authorization: "" }), deps))
        .status,
    ).toBe(401);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("does not authorize a token that Go rejects", async () => {
    const deps = setup(new Response("invalid JWT", { status: 401 }));
    const response = await handleImageRequest(request(), deps);
    expect(response.status).toBe(401);
    expect(deps.fetch).toHaveBeenCalledOnce();
    expect(deps.fetch).toHaveBeenCalledWith(
      "https://go.example/search",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test.jwt.signature",
          Accept: "application/json",
        },
        redirect: "error",
        cache: "no-store",
      }),
    );
  });

  it.each([
    new Response("<!doctype html><p>Login</p>"),
    Response.json({ error: "unavailable" }),
    new Response("not found", { status: 404 }),
  ])(
    "fails closed when session verification returns a non-search response",
    async (backendResponse) => {
      const deps = setup(backendResponse);
      expect((await handleImageRequest(request(), deps)).status).toBe(503);
      expect(deps.fetch).toHaveBeenCalledOnce();
    },
  );

  it("uses the server secret and requested model only after verifying Go auth", async () => {
    const deps = setup(
      Response.json([]),
      Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }),
    );
    const response = await handleImageRequest(
      request({ size: "1536x1024" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      image: "data:image/png;base64,aW1hZ2U=",
      model: "gpt-image-2",
    });
    const [url, options] = deps.fetch.mock.calls[1];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(options?.headers).toEqual({
      Authorization: "Bearer test-server-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(options?.body as string)).toEqual({
      model: "gpt-image-2",
      prompt: "A city floating in the clouds",
      n: 1,
      size: "1536x1024",
      quality: "medium",
      output_format: "png",
    });
  });

  it("sends a reference file to image edits as multipart without forcing a boundary", async () => {
    const deps = setup(
      Response.json(null),
      Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }),
    );
    const response = await handleImageRequest(
      request({
        image: new File([png], "original.png", { type: "image/png" }),
      }),
      deps,
    );
    expect(response.status).toBe(200);
    const [url, options] = deps.fetch.mock.calls[1];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect(options?.headers).toEqual({
      Authorization: "Bearer test-server-key",
    });
    const body = options?.body as FormData;
    expect(body.get("model")).toBe("gpt-image-2");
    expect(body.get("n")).toBe("1");
    expect((body.get("image") as File).size).toBe(png.length);
    expect(body.has("input_fidelity")).toBe(false);
  });

  it("validates prompts, dimensions, MIME types, and image signatures before making requests", async () => {
    const deps = setup();
    const inputs = [
      { prompt: "   " },
      { prompt: "a".repeat(4001) },
      { size: "9999x9999" },
      { image: new File(["svg"], "image.svg", { type: "image/svg+xml" }) },
      { image: new File(["not an image"], "image.png", { type: "image/png" }) },
    ];
    for (const input of inputs)
      expect((await handleImageRequest(request(input), deps)).status).toBe(400);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("enforces real request length even without a Content-Length header", async () => {
    const deps = setup();
    const cancel = vi.fn();
    let sentBytes = 0;
    // Model the incoming server stream directly. Node's outgoing FormData
    // encoder can enqueue after cancellation, unlike this pull-based source.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(64 * 1024);
        sentBytes += chunk.byteLength;
        controller.enqueue(chunk);
        if (sentBytes > MAX_IMAGE_BYTES + 3 * chunk.byteLength) {
          controller.close();
        }
      },
      cancel,
    });
    const options: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
      headers: {
        Origin: origin,
        Authorization: "Bearer test.jwt.signature",
        "Content-Type": "multipart/form-data; boundary=oversized-upload",
      },
    };
    const oversizedRequest = new Request(`${origin}/api/ai/image`, options);
    expect(oversizedRequest.headers.has("content-length")).toBe(false);
    expect((await handleImageRequest(oversizedRequest, deps)).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("explains missing configuration without using a browser key", async () => {
    const deps = { ...setup(), apiKey: undefined };
    const response = await handleImageRequest(request(), deps);
    expect(response.status).toBe(503);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("sanitizes upstream errors and supports retry after rate limiting", async () => {
    const deps = setup(
      Response.json([]),
      Response.json(
        { error: { message: "secret key test-server-key" } },
        { status: 429 },
      ),
    );
    const response = await handleImageRequest(request(), deps);
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain("test-server-key");
  });

  it("handles an interrupted or timed out upstream request", async () => {
    const deps = setup(Response.json([]));
    deps.fetch.mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    expect((await handleImageRequest(request(), deps)).status).toBe(504);
  });
});
