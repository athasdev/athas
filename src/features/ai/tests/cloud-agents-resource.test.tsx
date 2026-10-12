// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { DialogServiceProvider } from "@/ui/dialog";
import type { CloudAgentRun } from "../cloud-agents/cloud-agents-api";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    runs: [] as CloudAgentRun[],
    started: [] as Array<Record<string, unknown>>,
    cancelled: [] as string[],
    logs: new Map<string, Array<{ at: number; stream: string; text: string }>>(),
    failLogs: false,
    failStart: null as string | null,
    keys: new Map<string, string>(),
    opened: [] as string[],
    copied: [] as string[],
    previews: [] as Array<[string, number]>,
  };
});

vi.mock("@/features/auth/services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth-api")>()),
  authenticatedFetch: async (path: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const url = new URL(path, "https://athas.test");
    if (url.pathname === "/api/cloud-agents/runs" && init?.method === "POST") {
      if (io.failStart) return json({ error: io.failStart }, 402);
      const input = JSON.parse(String(init.body)) as Record<string, unknown>;
      io.started.push(input);
      const run = makeRun("new-run", {
        repo: String(input.repo),
        baseBranch: String(input.baseBranch),
        title: String(input.prompt).split("\n")[0],
        agent: input.agent as CloudAgentRun["agent"],
        status: "queued",
      });
      io.runs = [run, ...io.runs];
      return json({ run });
    }
    if (url.pathname === "/api/cloud-agents/runs") return json({ runs: io.runs });
    const cancel = url.pathname.match(/^\/api\/cloud-agents\/runs\/(.+)\/cancel$/);
    if (cancel) {
      io.cancelled.push(cancel[1]);
      io.runs = io.runs.map((run) =>
        run.id === cancel[1] ? { ...run, status: "cancelled" as const } : run,
      );
      return json({ run: io.runs.find((run) => run.id === cancel[1]) });
    }
    const logs = url.pathname.match(/^\/api\/cloud-agents\/runs\/(.+)\/logs$/);
    if (logs) {
      if (io.failLogs) return json({ error: "Logs are offline" }, 503);
      const lines = io.logs.get(logs[1]) ?? [];
      return json({ lines, cursor: lines.length });
    }
    return json({ error: "not found" }, 404);
  },
}));
vi.mock("@/features/ai/services/ai-token-service", () => ({
  getProviderApiToken: async (provider: string) => io.keys.get(provider) ?? null,
  onProviderApiTokenChange: () => () => {},
}));
vi.mock("@/features/views/services/view-github", () => ({
  resolveProjectGitHubRepository: async () => ({ owner: "athasdev", repo: "athas" }),
}));
vi.mock("@/features/previews/services/previews-api", () => ({
  createSandboxPreview: async (runId: string, port: number) => {
    io.previews.push([runId, port]);
    return { url: `https://${port}-${runId}.preview.test` };
  },
}));
vi.mock("@/utils/external-url", () => ({
  openExternalUrl: async (url: string) => {
    io.opened.push(url);
  },
}));
vi.mock("@/utils/clipboard", () => ({
  tryWriteClipboardText: async (text: string) => {
    io.copied.push(text);
    return true;
  },
}));

const { default: CloudAgentsResource } = await import("../cloud-agents/resource");

function makeRun(id: string, extra: Partial<CloudAgentRun> = {}): CloudAgentRun {
  return {
    id,
    repo: "athasdev/athas",
    baseBranch: "main",
    branch: `agent/${id}`,
    title: `Run ${id}`,
    agent: "claude-code",
    status: "succeeded",
    pool: "prepaid_wallet",
    maxMinutes: 60,
    billedSeconds: 3720,
    chargedCents: 41,
    holdCents: 40,
    prUrl: null,
    error: null,
    createdAt: "2026-10-01T00:00:00Z",
    startedAt: null,
    finishedAt: null,
    ...extra,
  };
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 6; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DialogServiceProvider>
          <CloudAgentsResource />
        </DialogServiceProvider>
      </QueryClientProvider>,
    ),
  );
  await flush();
}

function setCapabilities(cloudAgents: boolean, previews = false, pro = false) {
  useAuthStore.setState({
    user: pro ? ({ subscription_status: "pro" } as never) : null,
    subscription: {
      capabilities: {
        intelligence: pro,
        hostedAi: false,
        settingsSync: pro,
        cloudWorkspaces: false,
        cloudAgents,
        previews,
        collaboration: false,
        enterprisePolicy: false,
      },
    } as never,
  });
}

const view = () => within(document.body);
const button = (name: string | RegExp) => view().getByRole("button", { name });

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

async function fill(label: string, value: string) {
  await act(async () => {
    fireEvent.change(view().getByLabelText(label), { target: { value } });
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  io.runs = [];
  io.started = [];
  io.cancelled = [];
  io.logs = new Map();
  io.failLogs = false;
  io.failStart = null;
  io.keys = new Map([["anthropic", "sk-ant-test"]]);
  io.opened = [];
  io.copied = [];
  io.previews = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useProjectStore.setState({ rootFolderPath: "/code/athas" });
  useGitStore.setState({ gitStatus: { branch: "feature/dates" } } as never);
  setCapabilities(true);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  client.clear();
  useAuthStore.setState({ user: null, subscription: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cloud agents resource", () => {
  it("invites users without cloud agents to see the plans", async () => {
    setCapabilities(false);
    await render();
    expect(view().getByText("Cloud agents are part of Athas Pro.")).toBeTruthy();
    await click(button(/See plans/));
    expect(io.opened).toEqual(["https://athas.dev/pricing"]);
  });

  it("tells Pro users that cloud agents are not on yet", async () => {
    setCapabilities(false, false, true);
    await render();
    expect(view().getByText("Cloud agents are not available yet.")).toBeTruthy();
  });

  it("prefills the repository and branch and starts a run", async () => {
    await render();
    expect((view().getByLabelText("Repository") as HTMLInputElement).value).toBe("athasdev/athas");
    expect((view().getByLabelText("Base branch") as HTMLInputElement).value).toBe("feature/dates");
    const start = button(/Run in the cloud/);
    expect(start.hasAttribute("disabled")).toBe(true);

    await fill("Task", "Fix the date parser\nand its tests");
    await click(view().getByRole("button", { name: "2 hours" }));
    expect(view().getByText(/at most \$0\.80/)).toBeTruthy();
    await click(button(/Run in the cloud/));

    expect(io.started).toEqual([
      {
        repo: "athasdev/athas",
        baseBranch: "feature/dates",
        prompt: "Fix the date parser\nand its tests",
        agent: "claude-code",
        maxMinutes: 120,
        credentials: { anthropicApiKey: "sk-ant-test" },
      },
    ]);
    expect(view().getAllByText("Fix the date parser").length).toBeGreaterThan(1);
    expect(view().getByText("Starting")).toBeTruthy();
    expect(view().getByText("1 running in the cloud")).toBeTruthy();
  });

  it("asks for a provider key before running Codex", async () => {
    await render();
    await click(view().getByRole("button", { name: "Codex" }));
    expect(view().getByText("API key needed")).toBeTruthy();
    expect(view().getByText(/Add your OpenAI API key to run Codex/)).toBeTruthy();
    await click(button("Add key"));
    expect(useUIState.getState().isSettingsVisible).toBe(true);
    expect(useUIState.getState().settingsInitialTab).toBe("ai-models");
  });

  it("reports a run the service refuses to start", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => 1);
    io.failStart = "Not enough credit";
    await render();
    await fill("Task", "Upgrade dependencies");
    await fill("Repository", "athasdev/www");
    await fill("Base branch", "main");
    await click(button(/Run in the cloud/));
    expect(error).toHaveBeenCalledWith("Not enough credit");
    expect(io.started).toEqual([]);
  });

  it("shows a finished run with its activity and pull request", async () => {
    io.runs = [makeRun("done", { prUrl: "https://github.test/pr/1", title: "Fix tests" })];
    io.logs.set("done", [
      { at: 0, stream: "system", text: "Cloning athasdev/athas" },
      { at: 1, stream: "stdout", text: JSON.stringify({ type: "result", result: "All green." }) },
    ]);
    await render();
    expect(view().getByText("Runs continue with Athas closed")).toBeTruthy();
    await click(view().getByText("Fix tests").closest("button")!);
    expect(view().getByText("Pull request opened")).toBeTruthy();
    expect(view().getByText("1 h 2 min in the sandbox, $0.41 charged.")).toBeTruthy();
    expect(view().getByText(/Cloning athasdev\/athas/)).toBeTruthy();
    expect(view().getByText(/All green\./)).toBeTruthy();
    await click(button(/Open pull request/));
    expect(io.opened).toEqual(["https://github.test/pr/1"]);

    await click(view().getAllByRole("button", { name: "New cloud run" })[0]);
    expect(view().getByLabelText("Task")).toBeTruthy();
  });

  it("explains a failed run and missing activity", async () => {
    io.runs = [
      makeRun("bad", { status: "failed", error: "Tests never passed", billedSeconds: 42 }),
    ];
    io.failLogs = true;
    await render();
    await click(view().getByText("Run bad").closest("button")!);
    expect(view().getByText("Run failed")).toBeTruthy();
    expect(view().getByText("Tests never passed")).toBeTruthy();
    expect(view().getByText("Logs are offline")).toBeTruthy();
    expect(view().getByText(/42s in the sandbox/)).toBeTruthy();
  });

  it("previews a port of a running sandbox and stops the run", async () => {
    setCapabilities(true, true);
    io.runs = [makeRun("live", { status: "running", title: "Live run", maxMinutes: 30 })];
    await render();
    await click(view().getByText("Live run").closest("button")!);
    expect(view().getByText("Up to 30 min, holding $0.40 until it finishes.")).toBeTruthy();
    expect(view().getByText("Waiting for the sandbox…")).toBeTruthy();

    const success = vi.spyOn(toast, "success").mockImplementation(() => 1);
    await fill("Sandbox port", "3000");
    await click(button(/Preview port/));
    expect(io.previews).toEqual([["live", 3000]]);
    expect(io.copied).toEqual(["https://3000-live.preview.test"]);
    expect(success).toHaveBeenCalledWith("Preview link copied");
    expect(io.opened).toEqual(["https://3000-live.preview.test"]);

    await click(button(/Stop run/));
    await click(view().getByRole("button", { name: "Stop" }));
    expect(io.cancelled).toEqual(["live"]);
  });
});
