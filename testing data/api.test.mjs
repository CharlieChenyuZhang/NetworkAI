import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { createMockApi } from "./api.mjs";

// Keep the test client available while spying on fetch calls made by the API.
const clientFetch = globalThis.fetch.bind(globalThis);
const credentials = { username: "charlie", password: "test-password" };

async function startMock(t, { liveAi = false, downstream } = {}) {
  let handler;
  const server = createServer(async (request, response) => {
    try {
      if (!(await handler(request, response))) {
        if (downstream) {
          await downstream(request, response);
          return;
        }
        response.writeHead(404, { "x-test-unhandled": "true" });
        response.end("Unhandled test route");
      }
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = await createMockApi({ origin, liveAi });
  return {
    origin,
    request(path, options = {}, token) {
      const headers = new Headers(options.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return clientFetch(new URL(path, origin), { ...options, headers });
    },
  };
}

function jsonBody(value) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

async function signIn(api, account = credentials) {
  const response = await api.request("/signin", jsonBody(account));
  assert.equal(response.status, 200);
  return (await response.text()).trim();
}

async function search(api, token, params = {}) {
  const response = await api.request(`/search?${new URLSearchParams(params)}`, {}, token);
  assert.equal(response.status, 200);
  const posts = await response.json();
  // The Go contract also permits null for an empty slice.
  assert.ok(posts === null || Array.isArray(posts));
  return posts ?? [];
}

async function readRaster(post) {
  const filename = new URL(post.url, "http://127.0.0.1").pathname.split("/").at(-1);
  const bytes = await readFile(new URL(`./media/${filename}`, import.meta.url));
  const type = filename.endsWith(".png") ? "image/png" : "image/jpeg";
  assert.ok(bytes.length > 100, "Upload a real raster fixture, not an empty placeholder");
  return { bytes, file: new File([bytes], filename, { type }) };
}

function assertLocalRaster(data) {
  assert.equal(data.model, "local-mock");
  assert.match(data.image, /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/);
  const bytes = Buffer.from(data.image.split(",")[1], "base64");
  assert.ok(bytes.length > 100);
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(isJpeg || isPng, "AI output must contain raster image bytes");
}

test("sign-in rejects bad credentials and returns a raw JWT accepted by protected routes", async (t) => {
  const api = await startMock(t);
  for (const account of [
    { ...credentials, password: "wrong-password" },
    { username: "missing-user", password: credentials.password },
  ]) {
    const response = await api.request("/signin", jsonBody(account));
    assert.equal(response.status, 401);
  }

  const response = await api.request("/signin", jsonBody(credentials));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/plain/);
  const token = (await response.text()).trim();
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(claims.username ?? claims.sub, credentials.username);
  assert.ok(claims.exp * 1000 > Date.now());
  assert.ok((await search(api, token)).length > 0);
});

test("protected routes reject missing sessions and tampered JWT claims", async (t) => {
  const api = await startMock(t);
  const token = await signIn(api);
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, username: "maya", sub: "maya" })).toString("base64url");

  for (const invalidToken of [undefined, "invalid-token", `${header}.${forgedPayload}.${signature}`]) {
    for (const [path, method] of [
      ["/search", "GET"],
      ["/upload", "POST"],
      ["/post/nonexistent", "DELETE"],
      ["/api/ai/image", "POST"],
    ]) {
      const response = await api.request(path, { method }, invalidToken);
      assert.equal(response.status, 401, `${method} ${path} must authenticate first`);
    }
  }
});

test("signup rejects duplicates and preserves case-sensitive account ownership", async (t) => {
  const api = await startMock(t);
  const account = { username: "Charlie", password: "NewLocalPassword123!" };
  const created = await api.request("/signup", jsonBody(account));
  assert.ok(created.ok);
  const duplicate = await api.request("/signup", jsonBody(account));
  assert.equal(duplicate.status, 409);
  const seededDuplicate = await api.request("/signup", jsonBody(credentials));
  assert.equal(seededDuplicate.status, 409);
  const token = await signIn(api, account);
  assert.deepEqual(await search(api, token, { user: account.username }), []);
  const lowerCasePosts = await search(api, token, { user: credentials.username });
  assert.ok(lowerCasePosts.length > 0);

  const { file } = await readRaster(lowerCasePosts[0]);
  const form = new FormData();
  form.append("message", "A post by capital-C Charlie");
  form.append("media_file", file);
  assert.ok((await api.request("/upload", { method: "POST", body: form }, token)).ok);
  const newUsersPosts = await search(api, token, { user: account.username });
  assert.equal(newUsersPosts.length, 1);
  assert.equal(newUsersPosts[0].user, "Charlie");
  assert.equal(newUsersPosts[0].message, "A post by capital-C Charlie");
  assert.deepEqual(await search(api, token, { user: credentials.username }), lowerCasePosts);
});

test("seeded posts support keyword, personal, combined, and empty-result searches", async (t) => {
  const api = await startMock(t);
  const token = await signIn(api);
  const posts = await search(api, token);
  assert.ok(posts.length >= 6);
  assert.ok(new Set(posts.map((post) => post.user)).size >= 2);
  for (const post of posts) {
    for (const field of ["id", "user", "message", "url"]) {
      assert.equal(typeof post[field], "string");
      assert.ok(post[field].length > 0);
    }
    assert.ok(["image", "video"].includes(post.type));
    assert.equal(new URL(post.url, api.origin).origin, api.origin);
  }

  const personal = posts.filter((post) => post.user === credentials.username);
  assert.ok(personal.length >= 2);
  assert.deepEqual(await search(api, token, { user: credentials.username }), personal);
  const keyword = personal[0].message.match(/[a-z]{5,}/i)?.[0].toLowerCase();
  assert.ok(keyword, "Seed a caption with a searchable word");
  const expected = posts.filter((post) => post.message.toLowerCase().includes(keyword));
  assert.deepEqual(await search(api, token, { keywords: keyword.toUpperCase() }), expected);
  assert.deepEqual(
    await search(api, token, { keywords: keyword, user: credentials.username }),
    expected.filter((post) => post.user === credentials.username),
  );
  assert.deepEqual(await search(api, token, { keywords: "no-matching-post-9e4ec74d" }), []);
});

test("multipart upload enforces the caption limit, preserves raster bytes, and checks delete ownership", async (t) => {
  const api = await startMock(t);
  const token = await signIn(api);
  const initial = await search(api, token);
  const { bytes, file } = await readRaster(initial.find((post) => post.type === "image"));
  const caption = "Locally uploaded raster fixture 52b7d0".padEnd(5000, "x");
  const tooLong = new FormData();
  tooLong.append("message", `${caption}x`);
  tooLong.append("media_file", file);
  const rejected = await api.request("/upload", { method: "POST", body: tooLong }, token);
  assert.equal(rejected.status, 400);
  assert.deepEqual(await search(api, token), initial);

  const form = new FormData();
  form.append("message", caption);
  form.append("media_file", file);
  const upload = await api.request("/upload", { method: "POST", body: form }, token);
  assert.ok(upload.ok, await upload.text());

  const uploadedPosts = await search(api, token, { keywords: caption });
  assert.equal(uploadedPosts.length, 1);
  const uploaded = uploadedPosts[0];
  assert.equal(uploaded.user, credentials.username);
  assert.equal(uploaded.message, caption);
  assert.equal(uploaded.type, "image");
  assert.equal(new URL(uploaded.url, api.origin).origin, api.origin);
  const media = await api.request(uploaded.url);
  assert.equal(media.status, 200);
  assert.match(media.headers.get("content-type"), /^image\/(?:jpeg|png)/);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);

  const otherUsersPost = initial.find((post) => post.user !== credentials.username);
  assert.ok(otherUsersPost);
  const forbidden = await api.request(`/post/${encodeURIComponent(otherUsersPost.id)}`, { method: "DELETE" }, token);
  assert.equal(forbidden.status, 403);
  assert.ok((await search(api, token)).some((post) => post.id === otherUsersPost.id));
  const deleted = await api.request(`/post/${encodeURIComponent(uploaded.id)}`, { method: "DELETE" }, token);
  assert.ok(deleted.ok);
  assert.deepEqual(await search(api, token, { keywords: caption }), []);
});

test("AI generation and reference-image editing return local rasters without upstream fetches", async (t) => {
  const api = await startMock(t);
  const token = await signIn(api);
  const posts = await search(api, token);
  const { file } = await readRaster(posts.find((post) => post.type === "image"));
  const upstreamFetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("The local mock must not contact an upstream service");
  });

  for (const reference of [undefined, file]) {
    const form = new FormData();
    form.append("prompt", "A quiet lake with warm morning light");
    if (reference) form.append("image", reference);
    const response = await api.request("/api/ai/image", { method: "POST", body: form }, token);
    assert.equal(response.status, 200);
    assertLocalRaster(await response.json());
  }
  assert.equal(upstreamFetch.mock.callCount(), 0);
});

test("live AI hands untouched generation and reference-image multipart requests to the Next route", async (t) => {
  const forwarded = [];
  const api = await startMock(t, {
    liveAi: true,
    async downstream(request, response) {
      assert.equal(request.readableDidRead, false, "The mock must not read from the live request stream");
      assert.equal(request.readableFlowing, null, "The mock must not start draining the live request stream");
      assert.equal(request.listenerCount("data"), 0);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      forwarded.push({
        path: request.url,
        method: request.method,
        headers: { ...request.headers },
        bytes: Buffer.concat(chunks),
      });
      response.writeHead(200, { "x-test-next-route": "true" });
      response.end("Next route sentinel");
    },
  });
  const token = await signIn(api);
  const posts = await search(api, token);
  const { file } = await readRaster(posts.find((post) => post.type === "image"));
  const upstreamFetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Live forwarding tests must not contact an upstream service");
  });

  for (const reference of [undefined, file]) {
    const form = new FormData();
    form.append("prompt", "A quiet lake with warm morning light");
    form.append("size", "1536x1024");
    if (reference) form.append("image", reference);
    const encoded = new Request(`${api.origin}/api/ai/image`, { method: "POST", body: form });
    const contentType = encoded.headers.get("Content-Type");
    const bytes = Buffer.from(await encoded.arrayBuffer());
    const response = await api.request("/api/ai/image", {
      method: "POST",
      headers: { "Content-Type": contentType, Origin: api.origin },
      body: bytes,
    }, token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-test-next-route"), "true");
    assert.equal(await response.text(), "Next route sentinel");
    const received = forwarded.at(-1);
    assert.equal(received.path, "/api/ai/image");
    assert.equal(received.method, "POST");
    assert.equal(received.headers.authorization, `Bearer ${token}`);
    assert.equal(received.headers.origin, api.origin);
    assert.equal(received.headers["content-type"], contentType);
    assert.deepEqual(received.bytes, bytes);
  }
  assert.equal(forwarded.length, 2);
  assert.equal(upstreamFetch.mock.callCount(), 0);
});

test("live AI blocks invalid sessions, origins, methods, and neighboring API paths locally", async (t) => {
  let forwarded = 0;
  const api = await startMock(t, {
    liveAi: true,
    downstream(request, response) {
      forwarded += 1;
      response.writeHead(500, { "x-test-next-route": "true" });
      response.end("This request must not reach Next");
    },
  });
  const token = await signIn(api);
  const otherApi = await startMock(t);
  const otherToken = await signIn(otherApi);
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, username: "maya" })).toString("base64url");
  const upstreamFetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Rejected live AI requests must not contact an upstream service");
  });

  for (const invalidToken of [undefined, "invalid-token", otherToken, `${header}.${forgedPayload}.${signature}`]) {
    const response = await api.request("/api/ai/image", {
      method: "POST", headers: { Origin: api.origin }, body: "unread form",
    }, invalidToken);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("x-test-next-route"), null);
  }
  for (const headers of [
    {},
    { Origin: "https://example.test" },
    { Origin: "null" },
    { Origin: api.origin, "Sec-Fetch-Site": "cross-site" },
  ]) {
    const response = await api.request("/api/ai/image", { method: "POST", headers, body: "unread form" }, token);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-test-next-route"), null);
  }
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await api.request("/api/ai/image", { method, headers: { Origin: api.origin } }, token);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
    assert.equal(response.headers.get("x-test-next-route"), null);
  }
  for (const path of ["/api/unknown-local-endpoint", "/api/ai/image/", "/api/ai/image/edit", "/api/ai/%69mage"]) {
    const response = await api.request(path, { method: "POST", headers: { Origin: api.origin } }, token);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-test-next-route"), null);
  }
  assert.equal(forwarded, 0);
  assert.equal(upstreamFetch.mock.callCount(), 0);
});

test("cross-origin mutations are rejected without changing local state", async (t) => {
  const api = await startMock(t);
  const token = await signIn(api);
  const originalPosts = await search(api, token);
  const ownPost = originalPosts.find((post) => post.user === credentials.username);
  const { file } = await readRaster(ownPost);
  const upload = new FormData();
  upload.append("message", "A cross-origin post must not be created");
  upload.append("media_file", file);
  const ai = new FormData();
  ai.append("prompt", "A lake at sunrise");

  for (const [path, options] of [
    ["/signup", jsonBody({ username: "cross-origin-user", password: "Password123!" })],
    ["/upload", { method: "POST", body: upload }],
    [`/post/${encodeURIComponent(ownPost.id)}`, { method: "DELETE" }],
    ["/api/ai/image", { method: "POST", body: ai }],
  ]) {
    const headers = new Headers(options.headers);
    headers.set("Origin", "https://example.test");
    const response = await api.request(path, { ...options, headers }, token);
    assert.equal(response.status, 403, `${options.method} ${path} must reject a foreign origin`);
    assert.equal(response.headers.get("x-test-unhandled"), null);
  }
  assert.deepEqual(await search(api, token), originalPosts);
  const unwantedAccount = await api.request("/signin", jsonBody({
    username: "cross-origin-user",
    password: "Password123!",
  }));
  assert.equal(unwantedAccount.status, 401);
});

test("malformed multipart, empty AI prompts, and SVG uploads fail locally", async (t) => {
  const api = await startMock(t);
  const token = await signIn(api);
  const originalPosts = await search(api, token);
  const upstreamFetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Invalid mock requests must not contact an upstream service");
  });

  for (const path of ["/upload", "/api/ai/image"]) {
    const malformed = await api.request(path, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=local-test-boundary" },
      body: "not-a-valid-multipart-body",
    }, token);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("x-test-unhandled"), null);
  }
  const emptyPrompt = new FormData();
  emptyPrompt.append("prompt", "   ");
  const emptyAi = await api.request("/api/ai/image", { method: "POST", body: emptyPrompt }, token);
  assert.equal(emptyAi.status, 400);

  const svg = new FormData();
  svg.append("message", "An unsupported SVG upload");
  svg.append("media_file", new File([
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
  ], "unsupported.svg", { type: "image/svg+xml" }));
  const rejectedSvg = await api.request("/upload", { method: "POST", body: svg }, token);
  assert.ok([400, 415].includes(rejectedSvg.status));
  assert.equal(rejectedSvg.headers.get("x-test-unhandled"), null);
  assert.deepEqual(await search(api, token), originalPosts);

  const wrongMethod = await api.request("/api/ai/image", {}, token);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("x-test-unhandled"), null);
  assert.equal(upstreamFetch.mock.callCount(), 0);
});

test("unsupported post updates fail without changing posts or falling through to a proxy", async (t) => {
  const api = await startMock(t);
  const token = await signIn(api);
  const initial = await search(api, token);
  const ownPost = initial.find((post) => post.user === credentials.username);
  for (const method of ["PUT", "PATCH"]) {
    const response = await api.request(`/post/${encodeURIComponent(ownPost.id)}`, {
      ...jsonBody({ message: "Unsupported edit" }),
      method,
    }, token);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("x-test-unhandled"), null);
  }
  assert.deepEqual(await search(api, token), initial);
  const unsupportedApi = await api.request("/api/unknown-local-endpoint", {}, token);
  assert.equal(unsupportedApi.status, 404);
  assert.equal(unsupportedApi.headers.get("x-test-unhandled"), null);
});

test("each handler instance starts from the original accounts, posts, and sessions", async (t) => {
  const first = await startMock(t);
  const firstToken = await signIn(first);
  const originalPosts = await search(first, firstToken);
  const ownPost = originalPosts.find((post) => post.user === credentials.username);
  const account = { username: "temporary-user", password: "TemporaryPassword123!" };
  assert.ok((await first.request("/signup", jsonBody(account))).ok);
  assert.ok((await first.request(`/post/${encodeURIComponent(ownPost.id)}`, { method: "DELETE" }, firstToken)).ok);
  assert.equal((await search(first, firstToken)).length, originalPosts.length - 1);

  const second = await startMock(t);
  const secondToken = await signIn(second);
  const resetPosts = await search(second, secondToken);
  assert.deepEqual(resetPosts.map(({ id, user, message }) => ({ id, user, message })),
    originalPosts.map(({ id, user, message }) => ({ id, user, message })));
  const missingAccount = await second.request("/signin", jsonBody(account));
  assert.equal(missingAccount.status, 401);
  const staleSession = await second.request("/search", {}, firstToken);
  assert.equal(staleSession.status, 401);
});
