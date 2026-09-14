import { expect, test, type Page, type Route } from "@playwright/test";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "https://socialai-496702.uw.r.appspot.com").replace(/\/+$/, "");
const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const testImage = { name: "garden.png", mimeType: "image/png", buffer: Buffer.from(imageBase64, "base64") };
const token = (username = "charlie", expiresAt = Math.floor(Date.now() / 1000) + 3600) =>
  `header.${Buffer.from(JSON.stringify({ username, exp: expiresAt })).toString("base64url")}.signature`;

interface MockPost {
  id: string;
  user: string;
  message: string;
  url: string;
  type: "image" | "video";
}

async function seedSession(page: Page, jwt = token()) {
  await page.addInitScript((value) => localStorage.setItem("token", value), jwt);
}

async function mockBackend(page: Page) {
  const state = {
    posts: [
      { id: "own-one", user: "charlie", message: "Morning light in my garden", url: "/images/forest.jpg", type: "image" },
      { id: "own-two", user: "charlie", message: "A quiet alpine afternoon", url: "/images/alpine-lake.jpg", type: "image" },
      { id: "other-one", user: "alex", message: "A beautiful city corner", url: "/images/interior.jpg", type: "image" },
    ] as MockPost[],
    searches: [] as URL[],
    uploads: [] as string[],
    deletedIds: [] as string[],
    signIns: [] as Record<string, string>[],
    registrations: [] as Record<string, string>[],
    searchFailures: 0,
    unauthorized: false,
    jwt: token(),
  };
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/signin") {
      state.signIns.push(request.postDataJSON());
      return route.fulfill({ status: 200, contentType: "text/plain", headers: cors, body: state.jwt });
    }
    if (url.pathname === "/signup") {
      state.registrations.push(request.postDataJSON());
      return json(route, null);
    }
    if (url.pathname === "/search") {
      state.searches.push(url);
      if (state.unauthorized) return json(route, { error: "Unauthorized" }, 401);
      if (state.searchFailures > 0) {
        state.searchFailures -= 1;
        return json(route, { error: "Temporarily unavailable" }, 503);
      }
      const user = url.searchParams.get("user");
      const keyword = url.searchParams.get("keywords");
      return json(route, state.posts.filter((post) => (!user || post.user === user) && (!keyword || post.message.toLowerCase().includes(keyword.toLowerCase()))));
    }
    if (url.pathname === "/upload") {
      const body = request.postDataBuffer()?.toString() || "";
      state.uploads.push(body);
      const message = /name="message"\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] || "Uploaded post";
      state.posts.unshift({ id: `new-${state.uploads.length}`, user: "charlie", message, url: "/images/forest.jpg", type: "image" });
      return json(route, null);
    }
    if (url.pathname.startsWith("/post/") && request.method() === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/post/".length));
      state.deletedIds.push(id);
      state.posts = state.posts.filter((post) => post.id !== id);
      return json(route, null);
    }
    return json(route, { error: "Unexpected endpoint in test" }, 404);
  });
  return state;
}

const visibleLink = (page: Page, name: string) => page.getByRole("link", { name, exact: true }).filter({ visible: true }).first();
const createButton = (page: Page) => page.getByRole("button", { name: "Create a post", exact: true }).filter({ visible: true }).first();
const articleFor = (page: Page, caption: string) => page.getByRole("article").filter({ hasText: caption });

test("guest preview supports topics, search, persistent bookmarks, and responsive navigation", async ({ page }, testInfo) => {
  const backend = await mockBackend(page);
  await page.goto("/");
  await expect(page.getByText("A curated preview. Sign in to explore community posts.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(6);
  await page.getByRole("button", { name: "Nature", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "All inspiration", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search posts" }).fill("mountains");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Save post: Somewhere between the mountains and the sky.", exact: true }).click();
  await page.locator('a[href="/saved"]:visible').first().click();
  await expect(page).toHaveURL(/\/saved$/);
  await expect(page.getByRole("heading", { name: "Good ideas are worth keeping." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Unsave post: Somewhere between the mountains and the sky.", exact: true })).toBeVisible();
  await visibleLink(page, "Discover").click();
  await expect(page.getByRole("article")).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === "mobile") await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`discover-${testInfo.project.name}.png`), fullPage: true });
  expect(backend.searches).toHaveLength(0);
});

test("protected personal content returns to My posts after sign-in and searches captions locally", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/my-posts");
  await expect(page.getByRole("heading", { name: "A space of your own." })).toBeVisible();
  expect(backend.searches).toHaveLength(0);
  await page.getByRole("link", { name: "Sign in to continue" }).click();
  await page.getByLabel("Username", { exact: true }).fill("charlie");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/my-posts$/);
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search your posts" }).fill("garden");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(articleFor(page, "Morning light in my garden")).toBeVisible();
  expect(backend.signIns).toEqual([{ username: "charlie", password: "test-password" }]);
  expect(backend.searches.length).toBeGreaterThan(0);
  expect(backend.searches.every((url) => url.searchParams.get("user") === "charlie" && !url.searchParams.has("keywords"))).toBe(true);
  await visibleLink(page, "Discover").click();
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByText("A curated preview. Sign in to explore community posts.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("registration validates confirmation and signs into the original protected destination", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/register?next=%2Fmy-posts");
  await page.getByLabel("Username", { exact: true }).fill("charlie");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("form", { name: "Create your account" }).getByRole("alert")).toContainText("Your passwords do not match");
  expect(backend.registrations).toHaveLength(0);
  await page.getByLabel("Confirm password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/my-posts$/);
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(backend.registrations).toEqual([{ username: "charlie", password: "test-password" }]);
  expect(backend.signIns).toHaveLength(1);
});

test("upload preserves drafts, validates media, publishes multipart data, and refreshes the feed", async ({ page }) => {
  await seedSession(page);
  const backend = await mockBackend(page);
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(3);
  await createButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your story").fill("An afternoon in the greenhouse");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await createButton(page).click();
  await expect(dialog.getByLabel("Your story")).toHaveValue("An afternoon in the greenhouse");
  await dialog.getByLabel("Choose an image or video").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not media") });
  await expect(dialog.getByRole("alert")).toHaveText("Choose an image or video file.");
  await dialog.getByLabel("Choose an image or video").setInputFiles(testImage);
  await expect(dialog.getByRole("img", { name: "Preview of the image for your post" })).toBeVisible();
  await dialog.getByRole("button", { name: "Share your post", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(articleFor(page, "An afternoon in the greenhouse")).toBeVisible();
  expect(backend.uploads).toHaveLength(1);
  expect(backend.uploads[0]).toContain('name="message"');
  expect(backend.uploads[0]).toContain('name="media_file"; filename="garden.png"');
  expect(backend.searches.length).toBeGreaterThanOrEqual(2);
});

test("deletion is owner-only, requires confirmation, and removes a published post", async ({ page }) => {
  await seedSession(page);
  const backend = await mockBackend(page);
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(articleFor(page, "A beautiful city corner").getByRole("button", { name: /Delete post/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete post: Morning light in my garden", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Delete this post?");
  await page.getByRole("button", { name: "Keep post", exact: true }).click();
  expect(backend.deletedIds).toHaveLength(0);
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "Delete post: Morning light in my garden", exact: true }).click();
  await page.getByRole("button", { name: "Delete post", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(backend.deletedIds).toEqual(["own-one"]);
});

test("expired legacy tokens are cleared before protected requests are sent", async ({ page }) => {
  await seedSession(page, token("charlie", Math.floor(Date.now() / 1000) - 60));
  const backend = await mockBackend(page);
  await page.goto("/my-posts");
  await expect(page.getByRole("heading", { name: "A space of your own." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  expect(backend.searches).toHaveLength(0);
});

test("a rejected JWT ends the session and restores the private-view sign-in gate", async ({ page }) => {
  await seedSession(page);
  const backend = await mockBackend(page);
  backend.unauthorized = true;
  await page.goto("/my-posts");
  await expect(page.getByRole("heading", { name: "A space of your own." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  expect(backend.searches.length).toBeGreaterThan(0);
});

test("a community service failure presents a retry that recovers the feed", async ({ page }) => {
  await seedSession(page);
  const backend = await mockBackend(page);
  backend.searchFailures = 1;
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("We couldn't load the community.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(backend.searches).toHaveLength(2);
});

test("AI generation, image refinement, and publishing share one reviewable draft", async ({ page }) => {
  await seedSession(page);
  const backend = await mockBackend(page);
  const generations: string[] = [];
  await page.route("**/api/ai/image", async (route) => {
    generations.push(route.request().postDataBuffer()?.toString() || "");
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ image: `data:image/png;base64,${imageBase64}`, model: "gpt-image-2" }) });
  });
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(3);
  await createButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Create with AI" }).click();
  await dialog.getByLabel("From a little thought to something visual").fill("A peaceful garden at dawn");
  await dialog.getByRole("button", { name: "Generate image", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "Preview of the image for your post" })).toBeVisible();
  await dialog.getByLabel("Reimagine your image").fill("Add warm golden sunlight");
  await dialog.getByRole("button", { name: "Reimagine image", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Reimagine image", exact: true })).toBeEnabled();
  await dialog.getByLabel("Your story").fill("Imagining a warmer morning");
  await dialog.getByRole("button", { name: "Share your post", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(articleFor(page, "Imagining a warmer morning")).toBeVisible();
  expect(generations).toHaveLength(2);
  expect(generations[0]).toContain("A peaceful garden at dawn");
  expect(generations[0]).not.toContain('name="image"');
  expect(generations[1]).toContain("Add warm golden sunlight");
  expect(generations[1]).toContain('name="image"; filename="networkai-');
  expect(backend.uploads).toHaveLength(1);
});

test("signing out in another browser tab closes protected content", async ({ page, context }) => {
  await seedSession(page);
  await mockBackend(page);
  await page.goto("/my-posts");
  await expect(page.getByRole("article")).toHaveCount(2);
  const otherTab = await context.newPage();
  await mockBackend(otherTab);
  await otherTab.goto("/");
  await expect(otherTab.getByRole("button", { name: "Account menu" })).toBeVisible();
  await otherTab.getByRole("button", { name: "Account menu" }).click();
  await otherTab.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "A space of your own." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});
