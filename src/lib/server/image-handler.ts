import { API_BASE_URL } from "../api";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const MAX_PROMPT_LENGTH = 4000;
const IMAGE_MODEL = "gpt-image-2";
const IMAGE_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Dependencies = {
  fetch: typeof fetch;
  apiKey?: string;
  apiBaseUrl: string;
};

class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Count actual bytes, including chunked requests, before parsing multipart data.
async function readForm(request: Request) {
  if (
    !request.headers.get("content-type")?.startsWith("multipart/form-data;")
  ) {
    throw new RequestError(
      415,
      "Send a prompt and optional image as form data.",
    );
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new RequestError(413, "Choose an image smaller than 10 MB.");
  }
  if (!request.body)
    throw new RequestError(400, "Add a description for your image.");

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "Choose an image smaller than 10 MB.");
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new RequestError(
      400,
      "The image upload could not be read. Try selecting it again.",
    );
  }
}

async function validateImage(image: File) {
  if (!image.size || image.size > MAX_IMAGE_BYTES) {
    throw new RequestError(413, "Choose a non-empty image smaller than 10 MB.");
  }
  if (!IMAGE_TYPES.has(image.type)) {
    throw new RequestError(400, "Choose a PNG, JPEG, or WebP image.");
  }
  const bytes = new Uint8Array(await image.slice(0, 12).arrayBuffer());
  const png =
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (!(
    (image.type === "image/png" && png) ||
    (image.type === "image/jpeg" && jpeg) ||
    (image.type === "image/webp" && webp)
  )) {
    throw new RequestError(
      400,
      "That file does not appear to be a supported image.",
    );
  }
}

async function verifySession(
  request: Request,
  authorization: string,
  deps: Dependencies,
) {
  let response: Response;
  try {
    response = await deps.fetch(
      `${deps.apiBaseUrl.replace(/\/$/, "")}/search`,
      {
        headers: { Authorization: authorization, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      },
    );
  } catch {
    throw new RequestError(
      503,
      "We could not verify your session. Please try again shortly.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RequestError(
      401,
      "Your session has expired. Please sign in again.",
    );
  }
  if (!response.ok) {
    throw new RequestError(
      503,
      "We could not verify your session. Please try again shortly.",
    );
  }
  // A successful HTML fallback page must never authorize a paid generation.
  const payload: unknown = await response.json().catch(() => undefined);
  if (payload !== null && !Array.isArray(payload)) {
    throw new RequestError(
      503,
      "We could not verify your session. Please try again shortly.",
    );
  }
}

export async function handleImageRequest(
  request: Request,
  dependencies?: Dependencies,
) {
  const deps = dependencies ?? {
    fetch,
    apiKey: process.env.OPENAI_API_KEY,
    apiBaseUrl: API_BASE_URL,
  };

  try {
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (
      origin !== new URL(request.url).origin ||
      (site && site !== "same-origin")
    ) {
      throw new RequestError(
        403,
        "Image creation is only available from NetworkAI.",
      );
    }
    const authorization = request.headers.get("authorization") ?? "";
    if (
      !/^Bearer [A-Za-z0-9._~+\/-]+=*$/i.test(authorization) ||
      authorization.length > 8192
    ) {
      throw new RequestError(401, "Sign in to create an image.");
    }

    const form = await readForm(request);
    const prompt = form.get("prompt");
    const size = form.get("size") ?? "1024x1024";
    const image = form.get("image");
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > MAX_PROMPT_LENGTH
    ) {
      throw new RequestError(
        400,
        "Describe your image in 1 to 4,000 characters.",
      );
    }
    if (typeof size !== "string" || !IMAGE_SIZES.has(size)) {
      throw new RequestError(
        400,
        "Choose square, landscape, or portrait image dimensions.",
      );
    }
    if (image !== null && typeof image === "string") {
      throw new RequestError(
        400,
        "Select an image file to use as a reference.",
      );
    }
    if (form.getAll("image").length > 1) {
      throw new RequestError(400, "Use one reference image at a time.");
    }
    if (image) await validateImage(image);
    if (!deps.apiKey) {
      throw new RequestError(
        503,
        "AI image creation is not configured yet. You can still upload your own image.",
      );
    }

    // Go remains the source of truth for JWT validation. Decoding a token is not authentication.
    await verifySession(request, authorization, deps);

    const parameters = {
      model: IMAGE_MODEL,
      prompt: prompt.trim(),
      n: 1,
      size,
      quality: "medium",
      output_format: "png",
    };
    let body: BodyInit;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${deps.apiKey}`,
    };
    if (image) {
      const multipart = new FormData();
      for (const [key, value] of Object.entries(parameters))
        multipart.set(key, String(value));
      multipart.set("image", image, `reference.${image.type.split("/")[1]}`);
      body = multipart;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(parameters);
    }

    let response: Response;
    try {
      response = await deps.fetch(
        `https://api.openai.com/v1/images/${image ? "edits" : "generations"}`,
        {
          method: "POST",
          headers,
          body,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(180_000),
          ]),
        },
      );
    } catch {
      throw new RequestError(
        504,
        "Image creation did not finish. Please try again.",
      );
    }

    if (!response.ok) {
      // Never forward provider errors, which can include credentials or internal account details.
      if (response.status === 429)
        throw new RequestError(
          429,
          "AI image creation is busy. Please try again in a moment.",
        );
      if (response.status === 400)
        throw new RequestError(
          400,
          "This image could not be created. Try a different description or reference image.",
        );
      throw new RequestError(
        502,
        "AI image creation is temporarily unavailable. Please try again later.",
      );
    }
    const result = (await response.json().catch(() => null)) as {
      data?: { b64_json?: unknown }[];
    } | null;
    const base64 = result?.data?.[0]?.b64_json;
    if (
      typeof base64 !== "string" ||
      !base64 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ) {
      throw new RequestError(502, "No image was returned. Please try again.");
    }
    return json({
      image: `data:image/png;base64,${base64}`,
      model: IMAGE_MODEL,
    });
  } catch (error) {
    if (error instanceof RequestError)
      return json({ error: error.message }, error.status);
    return json({ error: "Image creation failed. Please try again." }, 500);
  }
}
