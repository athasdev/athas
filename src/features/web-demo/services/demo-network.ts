/**
 * The demo's stand-in for athas.dev. The workbench reaches the network through the Tauri HTTP
 * plugin, so these handlers answer those requests in memory: a signed-in Pro account and a
 * scripted model that streams OpenAI-style chat completions. Nothing leaves the browser.
 */

type Args = Record<string, any> | undefined;

interface DemoRequest {
  method: string;
  url: string;
  body: string;
}

interface DemoResponse {
  status: number;
  headers: [string, string][];
  chunks: string[];
  /** Pause before each chunk, so replies stream in like a real model. */
  delayMs: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const requests = new Map<number, DemoRequest>();
const responses = new Map<number, DemoResponse>();
let nextId = 10_000;

let getActiveFilePath: () => string | null = () => null;
let knownFilePaths: string[] = [];

/**
 * Lets the scripted agent read the file the visitor names in their question, or else the one
 * they are looking at.
 */
export function setDemoAgentFiles(options: { active: () => string | null; paths: string[] }) {
  getActiveFilePath = options.active;
  // Longest first, so `src/app/page.tsx` wins over a bare `page.tsx`.
  knownFilePaths = [...options.paths].sort((a, b) => b.length - a.length);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
    .join(" ");
}

function fileNamedIn(text: string): string | null {
  const lower = text.toLowerCase();
  return (
    knownFilePaths.find((path) => lower.includes(path.toLowerCase())) ??
    knownFilePaths.find((path) => lower.includes(path.split("/").pop()!.toLowerCase())) ??
    null
  );
}

const demoUser = {
  id: 1,
  email: "you@athas.dev",
  name: "You",
  avatar_url: null,
  provider: "github",
  github_username: null,
  subscription_status: "pro",
  subscriptionStatus: "pro",
  subscriptionPlan: "pro",
  created_at: "2026-01-01T00:00:00.000Z",
};

const demoSubscription = {
  status: "pro",
  subscription: { plan: "pro", renews_at: null, ends_at: null },
  capabilities: { intelligence: true, hostedAi: true, settingsSync: false },
};

const demoModels = {
  enabled: true,
  data: [
    {
      id: "auto",
      name: "Athas Automatic",
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      supportsImages: false,
    },
  ],
};

function json(status: number, value: unknown): DemoResponse {
  return {
    status,
    headers: [["content-type", "application/json"]],
    chunks: [JSON.stringify(value)],
    delayMs: 0,
  };
}

function completionChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-demo",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "athas-demo",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function streamText(text: string) {
  return text.match(/\S+\s*/g) ?? [text];
}

function sse(chunks: string[], delayMs = 28): DemoResponse {
  return {
    status: 200,
    headers: [
      ["content-type", "text/event-stream"],
      ["x-athas-model", "auto"],
    ],
    chunks,
    delayMs,
  };
}

function scriptedCompletion(body: string): DemoResponse {
  let messages: Array<{ role: string; content?: unknown }> = [];
  try {
    messages = JSON.parse(body).messages ?? [];
  } catch {
    // Treat an unreadable body as a fresh turn.
  }

  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const lastUserIndex = lastUser ? messages.lastIndexOf(lastUser) : -1;
  const hasToolResult = messages
    .slice(lastUserIndex + 1)
    .some((message) => message.role === "tool");
  const activeFile =
    fileNamedIn(messageText(lastUser?.content)) ?? getActiveFilePath() ?? "package.json";

  if (!hasToolResult) {
    const intro = `Let me look at \`${activeFile}\` first.`;
    return sse([
      completionChunk({ role: "assistant", content: "" }),
      ...streamText(intro).map((word) => completionChunk({ content: word })),
      completionChunk({
        tool_calls: [
          {
            index: 0,
            id: "call_demo_read",
            type: "function",
            function: { name: "read_file", arguments: JSON.stringify({ path: activeFile }) },
          },
        ],
      }),
      completionChunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ]);
  }

  const answer = [
    `\n\nI read \`${activeFile}\`. This window is Athas itself, the same workbench as the desktop app, running in your browser with a demo project.`,
    "",
    "Replies in this preview are scripted, so this is as far as I can go here. Download Athas to run the Athas Agent, Claude Code, Codex or any ACP agent on your own code, with your terminal and Git right beside it.",
  ].join("\n");

  return sse([
    completionChunk({ role: "assistant", content: "" }),
    ...streamText(answer).map((word) => completionChunk({ content: word })),
    completionChunk({}, "stop"),
    "data: [DONE]\n\n",
  ]);
}

function route(request: DemoRequest): DemoResponse {
  const { pathname } = new URL(request.url);

  if (pathname.endsWith("/api/auth/me")) return json(200, { user: demoUser });
  if (pathname.endsWith("/api/auth/subscription")) return json(200, demoSubscription);
  if (pathname.endsWith("/api/ai/chat") && request.method === "GET") return json(200, demoModels);
  if (pathname.endsWith("/api/ai/chat/completions")) return scriptedCompletion(request.body);

  return json(404, { error: "Not available in the browser preview." });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const networkHandlers: Record<string, (args: Args) => unknown> = {
  "plugin:http|fetch": (args) => {
    const config = args?.clientConfig ?? {};
    const rid = nextId++;
    requests.set(rid, {
      method: String(config.method ?? "GET").toUpperCase(),
      url: String(config.url),
      body: config.data ? decoder.decode(new Uint8Array(config.data)) : "",
    });
    return rid;
  },
  "plugin:http|fetch_send": (args) => {
    const request = requests.get(Number(args?.rid));
    requests.delete(Number(args?.rid));
    if (!request) throw new Error("Unknown request");

    const response = route(request);
    const responseRid = nextId++;
    responses.set(responseRid, response);
    return {
      status: response.status,
      statusText: response.status === 200 ? "OK" : "Not Found",
      url: request.url,
      headers: response.headers,
      rid: responseRid,
    };
  },
  "plugin:http|fetch_read_body": async (args) => {
    const rid = Number(args?.rid);
    const response = responses.get(rid);
    const chunk = response?.chunks.shift();
    if (!response || chunk === undefined) {
      responses.delete(rid);
      return [1];
    }
    if (response.delayMs) await wait(response.delayMs);
    return [...encoder.encode(chunk), 0];
  },
  "plugin:http|fetch_cancel": () => null,
  "plugin:http|fetch_cancel_body": (args) => {
    responses.delete(Number(args?.rid));
    return null;
  },
  get_auth_token: () => "athas-browser-preview",
  get_ai_provider_token: () => null,
};

/**
 * Keeps the page's own `fetch` from reaching any other host. The workbench's assets load from
 * this origin; everything else it might try (update checks, telemetry) is answered locally.
 */
export function blockExternalFetch() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    );
    if (url.origin === window.location.origin) return originalFetch(input, init);
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
}
