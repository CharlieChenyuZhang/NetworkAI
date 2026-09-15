import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createMockApi } from "./api.mjs";

if (process.env.NODE_ENV === "production") {
  throw new Error("Local mock data is only available in development.");
}

const port = Number(process.env.MOCK_PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("MOCK_PORT must be an integer between 1024 and 65535.");
}

const origin = `http://localhost:${port}`;
const projectDir = fileURLToPath(new URL("../", import.meta.url));

// Overrides apply only to this process. Existing .env files stay untouched.
process.env.NODE_ENV = "development";
process.env.NEXT_PUBLIC_API_BASE_URL = origin;
process.env.OPENAI_API_KEY = "";

const handleMock = await createMockApi({ origin });
let handlePage;
let app;
const server = createServer(async (request, response) => {
  if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(request.headers.host)) {
    response.writeHead(403).end("Localhost requests only.");
    return;
  }
  try {
    if (await handleMock(request, response)) return;
    if (!handlePage) {
      response.writeHead(503, { "Retry-After": "1" }).end("Starting NetworkAI...");
      return;
    }
    await handlePage(request, response);
  } catch {
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain" });
    }
    response.end("The local test server could not complete this request.");
  }
});

let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(exitCode), 3000);
  deadline.unref();
  server.close();
  server.closeAllConnections();
  await app?.close();
  process.exit(exitCode);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  // Bind before starting Next so an occupied port produces a clear error.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const { default: next } = await import("next");
  app = next({ dev: true, dir: projectDir, hostname: "localhost", port, httpServer: server });
  await app.prepare();
  handlePage = app.getRequestHandler();
  console.log(`\nNetworkAI local testing: ${origin}`);
  console.log("Sign in: charlie / test-password");
  console.log("All API requests and AI previews use local test data. No OpenAI calls.");
  console.log("Posts, registrations and uploads reset when this process restarts.\n");
} catch (error) {
  console.error(error.code === "EADDRINUSE"
    ? `Port ${port} is already in use. Stop the existing server or set MOCK_PORT=3002.`
    : "Could not start local testing. Check your Node.js version and installed dependencies.");
  await stop(1);
}
