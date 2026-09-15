# Local testing data

This folder contains the removable mock API, fictional accounts, seed posts, media fixtures, and tests for NetworkAI. It lets you exercise the actual frontend on localhost without a working Go deployment, Elasticsearch instance, or OpenAI key.

## Start

Use Node.js 22.13+ and install dependencies with `npm ci` if needed. Run from the project root:

```sh
npm run dev:mock
```

Open [localhost:3000](http://localhost:3000). Sign in with one of these **local test accounts**:

| Username | Password |
| --- | --- |
| `charlie` | `test-password` |
| `maya` | `test-password` |
| `jordan` | `test-password` |

You can also register a new fictional account. Use test credentials only. The signed-out home still shows its existing inspiration gallery; sign in to see the mock community posts.

For a different port, use `MOCK_PORT=3002 npm run dev:mock` and open `http://localhost:3002`.

## Test real AI with local accounts

Set `OPENAI_API_KEY` to a valid OpenAI key with `gpt-image-2` access in the project root's ignored `.env.local` file. Keep it server-only, with no `NEXT_PUBLIC_` prefix. Stop the mock server and run:

```sh
npm run dev:mock:ai
```

For another port, use `MOCK_PORT=3002 npm run dev:mock:ai`. Sign in again with a test account after restarting. In AI Studio, enter a prompt and generate an image; with an image attached, the same control edits that reference image. Add a caption and share to verify publication to the local feed.

This mode forwards authenticated, same-origin image requests to the existing Next.js OpenAI route. It uses real `gpt-image-2` generation and editing and incurs OpenAI API charges. Registration, sign-in, search, uploads, and deletion still use this folder's local mock API. The key stays in the Next.js server and is never sent to the browser. A missing key prevents startup; provider authentication or access errors are shown as failed generation, never replaced with a sample photo.

Use `npm run dev:mock` for simulated images without external calls or charges.

## What you can test

- Registration, duplicate usernames, valid and invalid sign-in, logout, and authenticated requests.
- Recent posts, keyword search, exact-creator search, and My posts. Charlie owns four of the nine seed posts.
- Image and video upload, media preview, post creation, and deletion of your own posts. You cannot delete another test user's posts.
- AI Studio's generate, refine, preview, download, and publish interactions. Generation returns a bundled sample photo labeled `local-mock` in the API response. It does not run an AI model, change the image based on your prompt, or incur API charges.
- Existing browser-local bookmarks and draft behavior.

The mock preserves the existing JSON, multipart, and bearer-token API shapes. It does not implement an unsupported published-post update endpoint or run real Go, Elasticsearch, or cloud services.

## Share a post locally

Open Create, enter your story, attach an image or video, and choose **Share your post**. In both mock modes, `/upload` saves the caption and media in local server memory and the new post appears in **Discover** and **My posts**. Publishing from Saved posts does not automatically bookmark the new post. No post is sent to the real Go service.

For local post uploads, the mock identifies PNG, JPEG, WebP, and GIF images from their contents. A WebP photo named `cat.png` is saved and served as WebP. Unsupported files and SVG content are still rejected. The real API contract and AI reference-image validation are unchanged.

## Data and reset

Edit `users.json` and `posts.json` to customize the initial state. Bundled media is in `media/`. All registrations, uploaded media, and post changes live in server memory. Restart `npm run dev:mock` to restore the seed data. Restarting also invalidates mock sessions, so sign in again.

Bookmarks and drafts belong to the existing frontend and remain in browser storage. They are independent of the in-memory mock server.

## Switch back to the real API

1. Sign out of the mock account and stop the server with Ctrl+C.
2. Set `NEXT_PUBLIC_API_BASE_URL` to your working Go service in `.env.local`, and set the server-only `OPENAI_API_KEY` when needed.
3. Run `npm run dev`. For a production build, run `npm run build` and `npm start`.

The mock launcher sets the API URL only inside its own process and never edits `.env` files. Default mock mode disables the OpenAI key and intercepts image requests; `dev:mock:ai` preserves the server key and passes only authenticated, same-origin `POST /api/ai/image` requests to Next.js. Normal development and production commands never import this folder. The local server only listens on the loopback interface.

Deleting this `testing data` folder leaves normal development and production builds working; CI skips the mock test when the folder is absent. For complete cleanup, also remove the `dev:mock`, `dev:mock:ai`, and `test:mock` scripts from `package.json`, the optional mock-test CI step, and the corresponding local-testing paragraphs in the root README. No production application code needs to change.

## Verify

```sh
npm run test:mock
```

The tests start isolated local HTTP servers and exercise the actual mock API without external services.

## Photo credits

The fixtures reuse the project's bundled Unsplash photos. Original sources and attribution are listed in the root README's Preview photo credits section. These are sample photographs, not AI-generated output or real posts from these fictional accounts.
