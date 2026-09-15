# Local testing data

This folder contains the removable mock API, fictional accounts, seed posts, media fixtures, and tests for NetworkAI. It lets you exercise the actual frontend on localhost without a working Go deployment, Elasticsearch instance, or OpenAI key.

## Start

Use Node.js 22.13+ and install dependencies with `npm ci` if needed. Stop any server already running on port 3000, then run from the project root:

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

## What you can test

- Registration, duplicate usernames, valid and invalid sign-in, logout, and authenticated requests.
- Recent posts, keyword search, exact-creator search, and My posts. Charlie owns four of the nine seed posts.
- Image and video upload, media preview, post creation, and deletion of your own posts. You cannot delete another test user's posts.
- AI Studio's generate, refine, preview, download, and publish interactions. Generation returns a bundled sample photo labeled `local-mock` in the API response. It does not run an AI model, change the image based on your prompt, or incur API charges.
- Existing browser-local bookmarks and draft behavior.

The mock preserves the existing JSON, multipart, and bearer-token API shapes. It does not implement an unsupported published-post update endpoint or run real Go, Elasticsearch, or cloud services.

## Data and reset

Edit `users.json` and `posts.json` to customize the initial state. Bundled media is in `media/`. All registrations, uploaded media, and post changes live in server memory. Restart `npm run dev:mock` to restore the seed data. Restarting also invalidates mock sessions, so sign in again.

Bookmarks and drafts belong to the existing frontend and remain in browser storage. They are independent of the in-memory mock server.

## Switch back to the real API

1. Sign out of the mock account and stop the server with Ctrl+C.
2. Set `NEXT_PUBLIC_API_BASE_URL` to your working Go service in `.env.local`, and set the server-only `OPENAI_API_KEY` when needed.
3. Run `npm run dev`. For a production build, run `npm run build` and `npm start`.

The mock launcher sets the API URL and disables the OpenAI key only inside its own process. It never edits `.env` files. Normal development and production commands never import this folder. The local server intercepts API calls before they reach Next.js's real AI handler, and only listens on the loopback interface.

Deleting this `testing data` folder leaves normal development and production builds working; CI skips the mock test when the folder is absent. For complete cleanup, also remove the `dev:mock` and `test:mock` scripts from `package.json`, the optional mock-test CI step, and the corresponding paragraph in the root README. No production application code needs to change.

## Verify

```sh
npm run test:mock
```

The tests start isolated local HTTP servers and exercise the actual mock API without external services.

## Photo credits

The fixtures reuse the project's bundled Unsplash photos. Original sources and attribution are listed in the root README's Preview photo credits section. These are sample photographs, not AI-generated output or real posts from these fictional accounts.
