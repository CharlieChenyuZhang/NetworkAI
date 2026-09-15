import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

const IMAGE_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 50 * 1024 * 1024;
const FORM_OVERHEAD = 64 * 1024;
const MEDIA_PREFIX = "/testing-data/media/";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MEDIA_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
  ["image/gif", "gif"], ["video/mp4", "mp4"], ["video/webm", "webm"],
  ["video/quicktime", "mov"],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

function requireMethod(req, res, expected) {
  if (req.method !== expected) {
    res.setHeader("Allow", expected);
    throw new RequestError(405, "This operation is not supported by the local API.");
  }
}

// Read bounded bytes before using Node's multipart parser. Drain rejected bodies
// without storing them so oversized requests can receive an HTTP 413 response.
async function readBody(req, limit) {
  if (Number(req.headers["content-length"]) > limit) {
    req.resume();
    throw new RequestError(413, "The request is too large.");
  }
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
    };
    const fail = (error) => {
      cleanup();
      // An aborted IncomingMessage may emit an error after its aborted event.
      req.once("error", () => {});
      req.resume();
      reject(error);
    };
    const onData = (chunk) => {
      length += chunk.length;
      if (length > limit) return fail(new RequestError(413, "The request is too large."));
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, length));
    };
    const onError = () => fail(new RequestError(400, "The request could not be read."));
    const onAborted = () => fail(new RequestError(400, "The request was interrupted."));
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onAborted);
  });
}

async function readCredentials(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
    throw new RequestError(415, "Send your username and password as JSON.");
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8"));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "The request must contain valid JSON.");
  }
  if (
    !body || typeof body.username !== "string" || typeof body.password !== "string" ||
    !body.username.trim() || body.username.trim().length > 64 ||
    !body.password || body.password.length > 256
  ) {
    throw new RequestError(400, "Enter a username and password.");
  }
  return { username: body.username.trim(), password: body.password };
}

async function readForm(req, limit) {
  const contentType = req.headers["content-type"] ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new RequestError(415, "Send this request as multipart form data.");
  }
  const body = await readBody(req, limit + FORM_OVERHEAD);
  try {
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new RequestError(400, "The uploaded form could not be read.");
  }
}

function singleField(form, name, optional = false) {
  const values = form.getAll(name);
  if (values.length > 1 || (!optional && values.length !== 1)) {
    throw new RequestError(400, `Supply one ${name} field.`);
  }
  return values[0] ?? null;
}

async function readMedia(file, imageOnly = false) {
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    throw new RequestError(400, "Select a media file.");
  }
  const type = file.type.toLowerCase();
  if (!MEDIA_EXTENSIONS.has(type) || (imageOnly && !IMAGE_TYPES.has(type))) {
    throw new RequestError(415, "Choose a supported raster image or video. SVG files are not supported.");
  }
  const limit = type.startsWith("video/") ? VIDEO_LIMIT : IMAGE_LIMIT;
  if (!file.size || file.size > limit) {
    throw new RequestError(413, `Choose a non-empty file no larger than ${limit / 1024 / 1024} MB.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const signatures = {
    "image/jpeg": bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/webp": bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
    "image/gif": ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)),
    "video/mp4": bytes.toString("ascii", 4, 8) === "ftyp",
    "video/quicktime": ["ftyp", "moov", "mdat", "wide"].includes(bytes.toString("ascii", 4, 8)),
    "video/webm": bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])),
  };
  if (!signatures[type]) {
    throw new RequestError(400, "The file contents do not match its media type.");
  }
  return { bytes, type };
}

function serveMedia(req, res, media) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    throw new RequestError(405, "Media supports GET and HEAD requests.");
  }
  if (!media) throw new RequestError(404, "This local media file was not found.");
  const length = media.bytes.length;
  const headers = {
    "Content-Type": media.type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  let start = 0;
  let end = length - 1;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), length - 1) : length - 1;
      } else {
        start = Math.max(0, length - Number(match[2]));
      }
    }
    if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) || start >= length || start > end) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${length}`, "Content-Length": 0 });
      res.end();
      return;
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${length}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(range ? 206 : 200, headers);
  res.end(req.method === "HEAD" ? undefined : media.bytes.subarray(start, end + 1));
}

/** A fresh handler owns fresh users, posts, media, and a random signing key. */
export async function createMockApi({ origin, liveAi = false }) {
  const siteOrigin = new URL(origin).origin;
  const [seedUsers, seedPosts] = await Promise.all([
    readFile(new URL("./users.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("./posts.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const users = new Map(seedUsers.map(({ username, password }) => [username, password]));
  const posts = seedPosts.map((post) => ({ ...post }));
  const media = new Map();
  for (const post of posts) {
    const filename = post.url.slice(MEDIA_PREFIX.length);
    if (!post.url.startsWith(MEDIA_PREFIX) || !/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) {
      throw new Error("Fixture media must be a JPEG in the local media folder.");
    }
    if (!media.has(filename)) {
      media.set(filename, {
        bytes: await readFile(new URL(`./media/${filename}`, import.meta.url)),
        type: "image/jpeg",
      });
    }
  }
  // The AI fixture remains available when posts.json is edited or emptied.
  const generatedBytes = media.get("alpine-lake.jpg")?.bytes ??
    await readFile(new URL("./media/alpine-lake.jpg", import.meta.url));
  const generatedImage = `data:image/jpeg;base64,${generatedBytes.toString("base64")}`;
  const signingKey = randomBytes(32);
  const sign = (input) => createHmac("sha256", signingKey).update(input).digest("base64url");
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  function issueToken(username) {
    const now = Math.floor(Date.now() / 1000);
    const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ username, iat: now, exp: now + 86400 })}`;
    return `${input}.${sign(input)}`;
  }
  function authenticate(req) {
    const auth = req.headers.authorization ?? "";
    const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i.exec(auth);
    if (match && auth.length <= 8192) {
      const expected = Buffer.from(sign(`${match[1]}.${match[2]}`));
      const supplied = Buffer.from(match[3]);
      if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) {
        try {
          const header = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
          const claims = JSON.parse(Buffer.from(match[2], "base64url").toString("utf8"));
          if (header.alg === "HS256" && header.typ === "JWT" &&
            typeof claims.username === "string" && users.has(claims.username) &&
            Number.isSafeInteger(claims.exp) && claims.exp > Math.floor(Date.now() / 1000)) {
            return claims.username;
          }
        } catch { /* Invalid JWT payloads are unauthenticated. */ }
      }
    }
    throw new RequestError(401, "Sign in with a local test account to continue.");
  }

  return async function handleMockRequest(req, res) {
    try {
      const url = new URL(req.url, siteOrigin);
      if (url.origin !== siteOrigin) throw new RequestError(400, "Use a local request URL.");
      const path = decodeURIComponent(url.pathname);
      const reserved = /^\/(?:signin|signup|search|upload|post|api|testing-data)(?:\/|$)/.test(path);
      if (!reserved) return false;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const requestOrigin = req.headers.origin;
        const fetchSite = req.headers["sec-fetch-site"];
        if ((requestOrigin && requestOrigin !== siteOrigin) ||
          (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
          throw new RequestError(403, "Use the local NetworkAI page to make this request.");
        }
      }
      if (path.startsWith(MEDIA_PREFIX)) {
        serveMedia(req, res, media.get(path.slice(MEDIA_PREFIX.length)));
      } else if (path === "/signin" || path === "/signup") {
        requireMethod(req, res, "POST");
        const { username, password } = await readCredentials(req);
        if (path === "/signup") {
          if (users.has(username)) throw new RequestError(409, "That username is already taken.");
          users.set(username, password);
          send(res, 201, { message: "Account created." });
        } else {
          const expected = Buffer.from(users.get(username) ?? "");
          const supplied = Buffer.from(password);
          if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
            throw new RequestError(401, "The username or password is incorrect.");
          }
          send(res, 200, issueToken(username), "text/plain; charset=utf-8");
        }
      } else if (path === "/search") {
        requireMethod(req, res, "GET");
        authenticate(req);
        const keywords = (url.searchParams.get("keywords") ?? "").trim().toLowerCase();
        const username = (url.searchParams.get("user") ?? "").trim();
        send(res, 200, posts.filter((post) =>
          (!username || post.user === username) &&
          (!keywords || `${post.message} ${post.category ?? ""}`.toLowerCase().includes(keywords))));
      } else if (path === "/upload") {
        requireMethod(req, res, "POST");
        const username = authenticate(req);
        const form = await readForm(req, VIDEO_LIMIT);
        const message = singleField(form, "message");
        if (typeof message !== "string" || !message.trim() || message.length > 5000) {
          throw new RequestError(400, "Add a caption between 1 and 5,000 characters.");
        }
        const uploaded = await readMedia(singleField(form, "media_file"));
        const id = randomUUID();
        const filename = `upload-${id}.${MEDIA_EXTENSIONS.get(uploaded.type)}`;
        media.set(filename, uploaded);
        posts.unshift({
          id, user: username, message: message.trim(), url: `${MEDIA_PREFIX}${filename}`,
          type: uploaded.type.startsWith("video/") ? "video" : "image",
          createdAt: new Date().toISOString(),
        });
        send(res, 201, { message: "Post created." });
      } else if (/^\/post\/[^/]+$/.test(path)) {
        requireMethod(req, res, "DELETE");
        const username = authenticate(req);
        const index = posts.findIndex((post) => post.id === path.slice("/post/".length));
        if (index < 0) throw new RequestError(404, "This post was not found.");
        if (posts[index].user !== username) throw new RequestError(403, "You can only delete your own posts.");
        const [deleted] = posts.splice(index, 1);
        const filename = deleted.url.slice(MEDIA_PREFIX.length);
        if (filename.startsWith("upload-")) media.delete(filename);
        send(res, 200, { message: "Post deleted." });
      } else if (path === "/api/ai/image") {
        requireMethod(req, res, "POST");
        if (liveAi && req.headers.origin !== siteOrigin) {
          throw new RequestError(403, "Use the local NetworkAI page to make this request.");
        }
        authenticate(req);
        if (liveAi) {
          if (url.pathname !== "/api/ai/image") {
            throw new RequestError(404, "This endpoint is not available in the local API.");
          }
          // Next owns validation and OpenAI access. Leave the multipart stream untouched.
          return false;
        }
        const form = await readForm(req, IMAGE_LIMIT);
        const prompt = singleField(form, "prompt");
        const size = singleField(form, "size", true) ?? "1024x1024";
        const image = singleField(form, "image", true);
        if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
          throw new RequestError(400, "Describe your image in 1 to 4,000 characters.");
        }
        if (!["1024x1024", "1536x1024", "1024x1536"].includes(size)) {
          throw new RequestError(400, "Choose square, landscape, or portrait dimensions.");
        }
        if (image !== null) await readMedia(image, true);
        send(res, 200, { image: generatedImage, model: "local-mock" });
      } else {
        throw new RequestError(404, "This endpoint is not available in the local API.");
      }
    } catch (error) {
      if (error instanceof RequestError) send(res, error.status, { error: error.message });
      else if (error instanceof URIError || error instanceof TypeError) send(res, 400, { error: "The request is malformed." });
      else send(res, 500, { error: "The local API could not complete this request." });
      req.resume();
    }
    return true;
  };
}
