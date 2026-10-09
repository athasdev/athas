import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  ExtensionWorkerInboundMessage,
  ExtensionWorkerMessage,
} from "../ui/services/ui-extension-worker";

type Api = Record<string, Record<string, (...args: unknown[]) => unknown>>;
type ActivateHook = (api: Api) => unknown;

const workerScope = vi.hoisted(() => {
  const state = {
    posted: [] as unknown[],
    listener: undefined as ((event: { data: unknown }) => void) | undefined,
  };
  Object.defineProperty(globalThis, "postMessage", {
    value: (message: unknown) => state.posted.push(message),
    writable: false,
    configurable: false,
  });
  Object.defineProperty(globalThis, "addEventListener", {
    value: (type: string, listener: (event: { data: unknown }) => void) => {
      if (type === "message") state.listener = listener;
    },
    writable: false,
    configurable: false,
  });
  return state;
});

const hooks = globalThis as unknown as {
  __workerTestActivate?: ActivateHook;
  __workerTestDeactivate?: () => unknown;
};

const fixtureDir = mkdtempSync(join(tmpdir(), "athas-worker-runtime-"));
const extensionEntry = join(fixtureDir, "extension.mjs");
const noActivateEntry = join(fixtureDir, "no-activate.mjs");
const sandboxProbeEntry = join(fixtureDir, "sandbox-probe.mjs");
writeFileSync(
  extensionEntry,
  [
    "export function activate(api) { return globalThis.__workerTestActivate(api); }",
    "export function deactivate() { return globalThis.__workerTestDeactivate?.(); }",
  ].join("\n"),
);
writeFileSync(noActivateEntry, "export const name = 'missing activate';");
writeFileSync(
  sandboxProbeEntry,
  [
    "export async function activate(api) {",
    "  const reachable = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'navigator', 'location', 'caches', 'BroadcastChannel']",
    "    .filter((name) => typeof globalThis[name] !== 'undefined');",
    "  let reassigned = true;",
    "  try { globalThis.fetch = () => 'escaped'; } catch { reassigned = false; }",
    "  let mutatedApi = true;",
    "  try { api.http.request = () => 'escaped'; } catch { mutatedApi = false; }",
    "  await api.storage.set('probe', { reachable, reassigned, mutatedApi });",
    "}",
  ].join("\n"),
);

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

let nextCallId = 1;

function send(message: ExtensionWorkerInboundMessage) {
  if (!workerScope.listener) throw new Error("worker runtime is not listening");
  workerScope.listener({ data: message });
}

function posted(): ExtensionWorkerMessage[] {
  return workerScope.posted as ExtensionWorkerMessage[];
}

function events(name?: string) {
  return posted().filter(
    (message): message is Extract<ExtensionWorkerMessage, { type: "event" }> =>
      message.type === "event" && (name === undefined || message.event === name),
  );
}

function hostCalls() {
  return posted().filter(
    (message): message is Extract<ExtensionWorkerMessage, { type: "host-call" }> =>
      message.type === "host-call",
  );
}

async function loadRuntime() {
  vi.resetModules();
  workerScope.posted.length = 0;
  workerScope.listener = undefined;
  await import("../ui/services/ui-extension-worker-runtime");
}

async function activate(
  run: ActivateHook,
  options: { extensionId?: string; compatibility?: "generated"; entry?: string } = {},
) {
  hooks.__workerTestActivate = run;
  send({
    type: "activate",
    entryPointUrl: options.entry ?? extensionEntry,
    extensionId: options.extensionId ?? "acme.tools",
    compatibility: options.compatibility,
  });
  await vi.waitFor(() => {
    expect(events().some((e) => e.event === "ready" || e.event === "activation.error")).toBe(true);
  });
}

async function call(method: string, ...params: unknown[]) {
  const id = nextCallId++;
  send({ type: "worker-call", id, method, params });
  let response: Extract<ExtensionWorkerMessage, { type: "response" }> | undefined;
  await vi.waitFor(() => {
    response = posted().find(
      (message): message is Extract<ExtensionWorkerMessage, { type: "response" }> =>
        message.type === "response" && message.id === id,
    );
    expect(response).toBeDefined();
  });
  return response!;
}

async function callResult(method: string, ...params: unknown[]) {
  const response = await call(method, ...params);
  if (response.error) throw new Error(response.error);
  return response.result;
}

beforeEach(async () => {
  hooks.__workerTestActivate = undefined;
  hooks.__workerTestDeactivate = undefined;
  await loadRuntime();
});

describe("extension worker sandbox", () => {
  it("removes network, worker, storage, and messaging globals from extension code", async () => {
    send({ type: "activate", entryPointUrl: sandboxProbeEntry, extensionId: "acme.probe" });
    await vi.waitFor(() => expect(hostCalls()).toHaveLength(1));

    const [storageCall] = hostCalls();
    send({ type: "response", id: storageCall.id, result: null });
    await vi.waitFor(() => expect(events("ready")).toHaveLength(1));
    expect(storageCall.method).toBe("storage.set");
    expect(storageCall.params).toEqual([
      "probe",
      { reachable: [], reassigned: false, mutatedApi: false },
    ]);
    expect(() =>
      Object.defineProperty(globalThis, "WebSocket", { value: class {}, configurable: true }),
    ).toThrow(TypeError);
  });

  it("routes privileged capabilities through host calls instead of direct access", async () => {
    let api: Api | undefined;
    await activate((received) => {
      api = received;
    });

    void api!.http.request({ url: "https://example.com" });
    void api!.secrets.set("token", "value");
    void api!.opener.openExternal("https://athas.dev");
    void api!.workspace.getCurrent();

    expect(hostCalls().map(({ method, params }) => [method, params])).toEqual([
      ["http.request", [{ url: "https://example.com" }]],
      ["secrets.set", ["token", "value"]],
      ["opener.openExternal", ["https://athas.dev"]],
      ["workspace.getCurrent", []],
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api!.secrets)).toBe(true);
  });
});

describe("extension worker activation", () => {
  it("reports ready after activate registers contributions", async () => {
    await activate((api) => {
      api.sidebar.registerView({ id: "panel", render: () => null });
      api.toolbar.registerAction({ id: "sync", position: "left", onClick: () => undefined });
      api.toolbar.registerAction({ id: "other", position: "middle", onClick: () => undefined });
      api.commands.register({ id: "hidden", palette: false, run: () => undefined });
      api.commands.register("legacy", "Legacy Title", () => undefined, "Tools");
    });

    expect(events().map((e) => [e.event, e.payload])).toEqual([
      [
        "sidebar.registerView",
        { id: "panel", title: "panel", icon: "puzzle-piece", order: undefined },
      ],
      [
        "toolbar.registerAction",
        { id: "sync", title: "sync", icon: "puzzle-piece", position: "left" },
      ],
      [
        "toolbar.registerAction",
        { id: "other", title: "other", icon: "puzzle-piece", position: "right" },
      ],
      ["commands.register", { id: "legacy", title: "Legacy Title", category: "Tools" }],
      ["ready", undefined],
    ]);
  });

  it("reports a module without activate as an activation error", async () => {
    await activate(() => undefined, { entry: noActivateEntry });

    expect(events("activation.error")[0].payload).toEqual({
      message: "Integration must export activate(api)",
    });
    expect(events("ready")).toEqual([]);
  });

  it("reports errors thrown by activate and invalid registrations", async () => {
    await activate((api) => {
      api.sidebar.registerView({ id: "panel" });
    });

    expect(events("activation.error")[0].payload).toEqual({
      message: "sidebar.registerView requires id and render",
    });
  });

  it("reports entrypoints that cannot be imported", async () => {
    await activate(() => undefined, { entry: join(fixtureDir, "missing.mjs") });

    expect(events("activation.error")).toHaveLength(1);
    expect(events("ready")).toEqual([]);
  });

  it("rejects incomplete contribution registrations", async () => {
    const errors: string[] = [];
    await activate((api) => {
      const attempts = [
        () => api.toolbar.registerAction({ id: "x" }),
        () => api.dialog.open({ id: "x" }),
        () => api.commands.register({ id: "x" }),
        () => api.ai.registerProvider({ id: "x", buildHeaders: () => ({}) }),
        () => api.ai.registerSettingsAction({ id: "x" }),
      ];
      for (const attempt of attempts) {
        try {
          attempt();
        } catch (error) {
          errors.push((error as Error).message);
        }
      }
    });

    expect(errors).toEqual([
      "toolbar.registerAction requires id and onClick",
      "dialog.open requires id and render",
      "commands.register requires id and run",
      "ai.registerProvider requires id, buildHeaders, buildPayload, and validateApiKey",
      "ai.registerSettingsAction requires id and commandId",
    ]);
    expect(events("ready")).toHaveLength(1);
  });
});

describe("extension worker host calls", () => {
  it("resolves concurrent host calls by response id, even out of order", async () => {
    let api: Api | undefined;
    await activate((received) => {
      api = received;
    });

    const first = api!.storage.get("first");
    const second = api!.settings.get("second");
    const [firstCall, secondCall] = hostCalls();

    send({ type: "response", id: secondCall.id, result: "second-value" });
    send({ type: "response", id: firstCall.id, result: "first-value" });

    await expect(first).resolves.toBe("first-value");
    await expect(second).resolves.toBe("second-value");
  });

  it("rejects host calls with the host error and ignores unknown or repeated ids", async () => {
    let api: Api | undefined;
    await activate((received) => {
      api = received;
    });

    const request = api!.clipboard.writeText("copied");
    const [hostCall] = hostCalls();

    send({ type: "response", id: 9999, result: "stray" });
    send({ type: "response", id: hostCall.id, error: "Permission denied: clipboard" });
    send({ type: "response", id: hostCall.id, result: "late" });

    await expect(request).rejects.toThrow("Permission denied: clipboard");
  });
});

describe("extension worker calls", () => {
  it("rejects unknown views, commands, toolbar actions, and methods", async () => {
    await activate(() => undefined);

    expect((await call("renderView", "missing")).error).toBe("Unknown integration view: missing");
    expect((await call("executeCommand", "missing")).error).toBe(
      "Unknown integration command: missing",
    );
    expect((await call("executeViewAction", "view", "missing")).error).toBe(
      "Unknown integration command: missing",
    );
    expect((await call("executeToolbarAction", "missing")).error).toBe(
      "Unknown toolbar action: missing",
    );
    expect((await call("doSomethingElse")).error).toBe("Unknown worker method: doSomethingElse");
  });

  it("executes registered commands with arguments and surfaces thrown errors", async () => {
    await activate((api) => {
      api.commands.register({ id: "sum", run: (a: unknown, b: unknown) => Number(a) + Number(b) });
      api.commands.register({
        id: "explode",
        run: () => {
          throw new Error("command failed");
        },
      });
      api.commands.register({
        id: "reject",
        run: () => Promise.reject("plain rejection"),
      });
    });

    expect(await callResult("executeCommand", "sum", 2, 3)).toBe(5);
    expect((await call("executeCommand", "explode")).error).toBe("command failed");
    expect((await call("executeCommand", "reject")).error).toBe("plain rejection");
  });

  it("stops serving disposed commands and toolbar actions", async () => {
    let disposables: Array<{ dispose: () => void }> = [];
    await activate((api) => {
      disposables = [
        api.commands.register({ id: "cmd", run: () => "ran" }) as { dispose: () => void },
        api.toolbar.registerAction({ id: "tool", onClick: () => "clicked" }) as {
          dispose: () => void;
        },
      ];
    });

    expect(await callResult("executeCommand", "cmd")).toBe("ran");
    expect(await callResult("executeToolbarAction", "tool")).toBe("clicked");

    for (const disposable of disposables) disposable.dispose();

    expect((await call("executeCommand", "cmd")).error).toBe("Unknown integration command: cmd");
    expect((await call("executeToolbarAction", "tool")).error).toBe("Unknown toolbar action: tool");
  });

  it("lets extension code execute its own commands through the api", async () => {
    let api: Api | undefined;
    await activate((received) => {
      api = received;
      received.commands.register({ id: "echo", run: (value: unknown) => value });
    });

    expect(api!.commands.execute("echo", "hi")).toBe("hi");
    expect(() => api!.commands.execute("nope")).toThrow("Unknown integration command: nope");
  });

  it("processes worker calls one at a time in arrival order", async () => {
    let release: () => void = () => undefined;
    const order: string[] = [];
    await activate((api) => {
      api.commands.register({
        id: "slow",
        run: () =>
          new Promise<void>((resolve) => {
            release = () => {
              order.push("slow");
              resolve();
            };
          }),
      });
      api.commands.register({ id: "fast", run: () => order.push("fast") });
    });

    const slow = call("executeCommand", "slow");
    const fast = call("executeCommand", "fast");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([]);

    release();
    await Promise.all([slow, fast]);

    expect(order).toEqual(["slow", "fast"]);
  });

  it("calls the module deactivate hook", async () => {
    hooks.__workerTestDeactivate = () => "cleaned up";
    await activate(() => undefined);

    expect(await callResult("deactivate")).toBe("cleaned up");
  });
});

describe("extension worker views", () => {
  it("binds inline handlers per render and invalidates the view after an action", async () => {
    let count = 0;
    await activate((api) => {
      const ui = api.ui;
      api.sidebar.registerView({
        id: "counter",
        title: "Counter",
        render: () =>
          ui.stack(
            ui.text(`Count ${count}`),
            ui.button({
              label: "Increment",
              onClick: () => {
                count += 1;
                return count;
              },
            }),
          ),
      });
    });

    const view = (await callResult("renderView", "counter")) as {
      children: Array<{ type: string; value?: string; action?: { command: string } }>;
    };
    expect(view.children[0]).toEqual({ type: "text", value: "Count 0", tone: undefined });
    const actionId = view.children[1].action!.command;
    expect(actionId).toBe("__generated.view.counter.inline.1");

    expect(await callResult("executeViewAction", "counter", actionId)).toBe(1);
    expect(events("views.invalidate").map((e) => e.payload)).toEqual([{ viewId: "counter" }]);

    const rerendered = (await callResult("renderView", "counter")) as typeof view;
    expect(rerendered.children[0].value).toBe("Count 1");
    expect(rerendered.children[1].action!.command).toBe(actionId);
  });

  it("does not invalidate twice when the action already invalidated the view", async () => {
    await activate((api) => {
      api.sidebar.registerView({
        id: "panel",
        render: () =>
          api.ui.button({
            label: "Refresh",
            onClick: () => api.views.invalidate("panel"),
          }),
      });
    });

    const view = (await callResult("renderView", "panel")) as { action: { command: string } };
    await callResult("executeViewAction", "panel", view.action.command);

    expect(events("views.invalidate")).toHaveLength(1);
  });

  it("drops inline handlers from the previous render and from disposed views", async () => {
    let showButton = true;
    let registration: { dispose: () => void } | undefined;
    await activate((api) => {
      registration = api.sidebar.registerView({
        id: "panel",
        render: () =>
          showButton
            ? api.ui.button({ label: "Go", onClick: () => "went" })
            : api.ui.empty("Nothing"),
      }) as { dispose: () => void };
    });

    const first = (await callResult("renderView", "panel")) as { action: { command: string } };
    expect(await callResult("executeCommand", first.action.command)).toBe("went");

    showButton = false;
    await callResult("renderView", "panel");
    expect((await call("executeCommand", first.action.command)).error).toContain(
      "Unknown integration command",
    );

    showButton = true;
    const third = (await callResult("renderView", "panel")) as { action: { command: string } };
    registration!.dispose();
    expect((await call("executeCommand", third.action.command)).error).toContain(
      "Unknown integration command",
    );
    expect((await call("renderView", "panel")).error).toBe("Unknown integration view: panel");
  });

  it("keeps the previous handlers when a render throws", async () => {
    let fail = false;
    await activate((api) => {
      api.sidebar.registerView({
        id: "panel",
        render: () => {
          if (fail) throw new Error("render failed");
          return api.ui.button({ label: "Go", onClick: () => "went" });
        },
      });
    });

    const view = (await callResult("renderView", "panel")) as { action: { command: string } };
    fail = true;
    expect((await call("renderView", "panel")).error).toBe("render failed");
    expect(await callResult("executeCommand", view.action.command)).toBe("went");
  });

  it("opens and closes dialogs, disposing the dialog view on close", async () => {
    let api: Api | undefined;
    await activate((received) => {
      api = received;
      received.dialog.open({
        id: "confirm",
        title: "Confirm",
        width: 400,
        render: () => received.ui.text("Sure?"),
      });
    });

    expect(await callResult("renderView", "confirm")).toEqual({
      type: "text",
      value: "Sure?",
      tone: undefined,
    });

    api!.dialog.close("confirm");

    expect(events("dialogs.open")[0].payload).toEqual({
      id: "confirm",
      title: "Confirm",
      width: 400,
      height: undefined,
    });
    expect(events("dialogs.close")[0].payload).toEqual({ id: "confirm" });
    expect((await call("renderView", "confirm")).error).toBe("Unknown integration view: confirm");
  });

  it("assigns global ids to inline actions created outside of a render", async () => {
    let action: { command: string } | undefined;
    await activate((api) => {
      action = (
        api.ui.button({ label: "Later", onClick: () => "later" }) as {
          action: { command: string };
        }
      ).action;
    });

    expect(action!.command).toBe("__generated.inline.1");
    expect(await callResult("executeCommand", action!.command)).toBe("later");
  });
});

describe("extension worker AI providers", () => {
  it("dispatches provider hooks and defaults optional ones", async () => {
    await activate((api) => {
      api.ai.registerProvider({
        id: "custom-llm",
        buildHeaders: (key: unknown) => ({ authorization: `Bearer ${key}` }),
        buildPayload: () => ({}),
        validateApiKey: (key: unknown) => key === "valid",
      });
      api.ai.registerSettingsAction({
        id: "configure",
        providerId: "custom-llm",
        label: "Configure",
        commandId: "openSettings",
      });
    });

    expect(await callResult("aiProvider.buildHeaders", "custom-llm", "k1")).toEqual({
      authorization: "Bearer k1",
    });
    expect(await callResult("aiProvider.validateApiKey", "custom-llm", "valid")).toBe(true);
    expect(await callResult("aiProvider.buildUrl", "custom-llm")).toBeUndefined();
    expect(await callResult("aiProvider.getModels", "custom-llm")).toEqual([]);
    expect(await callResult("aiProvider.getSystemPromptContext", "custom-llm")).toBe("");
    expect((await call("aiProvider.streamTokens", "custom-llm")).error).toBe(
      "External AI provider custom-llm does not implement streamTokens",
    );
    expect((await call("aiProvider.buildHeaders", "unknown")).error).toBe(
      "Unknown external AI provider: unknown",
    );
    expect(events("ai.registerProvider")[0].payload).toEqual({ providerId: "custom-llm" });
    expect(events("ai.registerSettingsAction")[0].payload).toMatchObject({
      id: "configure",
      commandId: "openSettings",
    });
  });

  it("stops dispatching to disposed providers", async () => {
    let registration: { dispose: () => void } | undefined;
    await activate((api) => {
      registration = api.ai.registerProvider({
        id: "temp",
        buildHeaders: () => ({}),
        buildPayload: () => ({}),
        validateApiKey: () => true,
      }) as { dispose: () => void };
    });

    registration!.dispose();

    expect((await call("aiProvider.buildHeaders", "temp")).error).toBe(
      "Unknown external AI provider: temp",
    );
  });
});

describe("generated extension compatibility", () => {
  it("namespaces contribution ids under the extension id", async () => {
    let api: Api | undefined;
    await activate(
      (received) => {
        api = received;
        received.sidebar.registerView({ id: "panel", render: () => "plain text view" });
        received.commands.register({ id: "acme.generated.already", run: () => "kept" });
        received.commands.register({ id: "short", run: () => "short" });
        received.ai.registerSettingsAction({
          id: "configure",
          providerId: "p",
          label: "Configure",
          commandId: "short",
        });
      },
      { extensionId: "acme.generated", compatibility: "generated" },
    );

    expect(events("sidebar.registerView")[0].payload?.id).toBe("acme.generated.panel");
    expect(events("commands.register").map((e) => e.payload?.id)).toEqual([
      "acme.generated.already",
      "acme.generated.short",
    ]);
    expect(events("ai.registerSettingsAction")[0].payload).toMatchObject({
      id: "acme.generated.configure",
      commandId: "acme.generated.short",
    });
    expect(await callResult("executeCommand", "short")).toBe("short");
    expect(api!.ui.action("short", 1)).toEqual({ command: "acme.generated.short", args: [1] });
    expect(await callResult("renderView", "acme.generated.panel")).toEqual({
      type: "text",
      value: "plain text view",
    });
  });

  it("normalizes legacy return values and layout configs", async () => {
    await activate(
      (api) => {
        const ui = api.ui;
        api.sidebar.registerView({
          id: "list",
          render: () => [ui.text("a"), null, [ui.text("b")]],
        });
        api.sidebar.registerView({
          id: "legacy",
          render: () =>
            ui.stack({
              children: [
                ui.text({ children: ["Hello ", 42, { nested: true }, null], tone: "muted" }),
                ui.badge({ label: "New", tone: "accent" }),
                ui.row({ children: ui.text("solo") }),
                ui.card({ title: "Card", children: [ui.text("inside")] }),
              ],
            }),
        });
      },
      { extensionId: "acme.generated", compatibility: "generated" },
    );

    expect(await callResult("renderView", "acme.generated.list")).toEqual({
      type: "stack",
      children: [
        { type: "text", value: "a", tone: undefined },
        { type: "text", value: "b", tone: undefined },
      ],
    });
    expect(await callResult("renderView", "acme.generated.legacy")).toEqual({
      type: "stack",
      children: [
        { type: "text", value: "Hello 42", tone: "muted" },
        { type: "badge", label: "New", tone: "accent" },
        { type: "row", children: [{ type: "text", value: "solo", tone: undefined }] },
        {
          type: "card",
          title: "Card",
          description: undefined,
          variant: undefined,
          children: [{ type: "text", value: "inside", tone: undefined }],
        },
      ],
    });
  });
});

describe("extension worker view builders", () => {
  it("coerces builder input into serializable view nodes", async () => {
    await activate((api) => {
      const ui = api.ui;
      api.sidebar.registerView({
        id: "dashboard",
        render: () =>
          ui.screen(
            { title: "Dashboard" },
            ui.section("Stats", ui.metric({ label: "Files", value: 12, detail: 3 })),
            ui.progress({ value: "40", label: 1 }),
            ui.sparkline({ label: "Load", values: ["1", 2] }),
            ui.barChart({ items: [{ label: "a", value: "5" }, {}] }),
            ui.callout({ title: "Heads up", description: 0 }),
            ui.table({ columns: ["name", 1], rows: [["x", 1, null]], caption: "Files" }),
            ui.code({ value: 10, language: "ts" }),
            ui.diff({ filePath: "a.ts", lines: [{ type: "add", newLine: 1 }] }),
            ui.keyValue({ items: [{ label: "size", value: 3 }, { value: null }] }),
            ui.divider(),
            ui.loading("Loading"),
            ui.error("Oops", "details"),
          ),
      });
    });

    const view = (await callResult("renderView", "dashboard")) as {
      type: string;
      title: string;
      children: unknown[];
    };
    expect(view.type).toBe("screen");
    expect(view.title).toBe("Dashboard");
    expect(view.children).toEqual([
      {
        type: "section",
        title: "Stats",
        children: [{ type: "metric", label: "Files", value: 12, detail: "3", tone: undefined }],
      },
      { type: "progress", value: 40, label: "1", detail: undefined },
      { type: "sparkline", label: "Load", values: [1, 2], detail: undefined, tone: undefined },
      {
        type: "barChart",
        label: undefined,
        items: [
          { label: "a", value: 5, detail: undefined, tone: undefined },
          { label: "", value: Number.NaN, detail: undefined, tone: undefined },
        ],
      },
      { type: "callout", title: "Heads up", description: "0", tone: undefined },
      { type: "table", columns: ["name", "1"], rows: [["x", 1, ""]], caption: "Files" },
      { type: "code", value: "10", language: "ts", wrap: undefined },
      {
        type: "diff",
        filePath: "a.ts",
        oldPath: undefined,
        language: undefined,
        lines: [{ type: "add", content: "", oldLine: undefined, newLine: 1 }],
        truncated: undefined,
      },
      {
        type: "keyValue",
        items: [
          { label: "size", value: 3, tone: undefined, monospace: undefined },
          { label: "", value: "", tone: undefined, monospace: undefined },
        ],
      },
      { type: "divider" },
      { type: "loading", message: "Loading" },
      { type: "error", message: "Oops", description: "details" },
    ]);
  });

  it("turns handler functions in form controls into callable inline actions", async () => {
    const received: Array<[string, unknown]> = [];
    const record = (name: string) => (value: unknown) => {
      received.push([name, value]);
      return name;
    };
    await activate((api) => {
      const ui = api.ui;
      api.sidebar.registerView({
        id: "form",
        render: () =>
          ui.form(
            { submitLabel: "Save", onSubmit: record("submit") },
            ui.input({ name: "title", type: "email", readOnly: true, onChange: record("input") }),
            ui.textarea({ name: "body", onSubmit: record("textarea") }),
            ui.numberInput({ name: "n", min: 1, onChange: record("number") }),
            ui.select({ name: "s", options: [], onChange: record("select") }),
            ui.toggle({ name: "t", onChange: record("toggle") }),
            ui.checkbox({ name: "c", onChange: record("checkbox") }),
            ui.choice({ name: "ch", onChange: record("choice") }),
            ui.tabs({ value: "a", onChange: record("tabs") }),
            ui.disclosure({ onChange: record("disclosure") }, ui.text("hidden")),
            ui.activity({ items: [{ title: "Built", onSelect: record("activity") }] }),
            ui.listItem({ title: "Item", subtitle: "Sub", onSelect: record("listItem") }),
            ui.tree({
              items: [
                { id: 1, title: "root", children: [{ id: "c", onSelect: record("tree") }] },
                "bad",
              ],
            }),
          ),
      });
    });

    const view = (await callResult("renderView", "form")) as Record<string, unknown> & {
      children: Array<Record<string, unknown>>;
    };
    const commandOf = (value: unknown) => (value as { command: string }).command;
    const [input, textarea, numberInput, select, toggle, checkbox, choice, tabs] = view.children;
    const disclosure = view.children[8];
    const activity = view.children[9] as { items: Array<{ onSelect: unknown }> };
    const listItem = view.children[10];
    const tree = view.children[11] as {
      label: string;
      items: Array<{ id: string; title: string; children?: Array<{ onSelect: unknown }> }>;
    };

    expect(input).toMatchObject({ inputType: "email", disabled: true });
    expect(listItem).toMatchObject({ title: "Item", description: "Sub" });
    expect(disclosure).toMatchObject({ title: "Details" });
    expect(tree.label).toBe("Items");
    expect(tree.items.map(({ id, title }) => [id, title])).toEqual([
      ["1", "root"],
      ["", ""],
    ]);

    const handlers = [
      ["submit", view.onSubmit],
      ["input", input.onChange],
      ["textarea", textarea.onSubmit],
      ["number", numberInput.onChange],
      ["select", select.onChange],
      ["toggle", toggle.onChange],
      ["checkbox", checkbox.onChange],
      ["choice", choice.onChange],
      ["tabs", tabs.onChange],
      ["disclosure", disclosure.onChange],
      ["activity", activity.items[0].onSelect],
      ["listItem", listItem.onSelect],
      ["tree", tree.items[0].children![0].onSelect],
    ] as const;
    for (const [name, action] of handlers) {
      expect(await callResult("executeViewAction", "form", commandOf(action), name)).toBe(name);
    }
    expect(received.map(([name]) => name)).toEqual(handlers.map(([name]) => name));
    expect(new Set(handlers.map(([, action]) => commandOf(action))).size).toBe(handlers.length);
  });

  it("composes helper layouts from plain values", async () => {
    await activate((api) => {
      const ui = api.ui;
      api.sidebar.registerView({
        id: "helpers",
        render: () =>
          ui.list(
            ui.sectionHeader({ title: "Header", subtitle: "Sub", action: ui.button("Go", "cmd") }),
            ui.emptyState({ description: "None yet" }),
            ui.empty("Empty", "desc"),
            ui.card({ title: 1, description: "d" }, ui.text("x", "muted")),
            ui.badge("Beta", "accent"),
          ),
      });
    });

    expect(await callResult("renderView", "helpers")).toEqual({
      type: "list",
      children: [
        {
          type: "stack",
          children: [
            { type: "text", value: "Header", tone: "default" },
            { type: "text", value: "Sub", tone: "muted" },
            {
              type: "button",
              label: "Go",
              pendingLabel: undefined,
              action: "cmd",
              tone: undefined,
              disabled: undefined,
            },
          ],
        },
        {
          type: "stack",
          children: [{ type: "empty", message: "Nothing here", description: "None yet" }],
        },
        { type: "empty", message: "Empty", description: "desc" },
        {
          type: "card",
          title: undefined,
          description: "d",
          variant: undefined,
          children: [{ type: "text", value: "x", tone: "muted" }],
        },
        { type: "badge", label: "Beta", tone: "accent" },
      ],
    });
  });
});
