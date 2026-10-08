// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getProvider } from "@/features/ai/services/providers/ai-provider-registry";
import { useAIProviderSettingsActions } from "@/features/ai/services/providers/ai-provider-settings-registry";
import type { ExtensionManifest } from "../types/extension-manifest";
import { uiExtensionHost } from "../ui/services/ui-extension-host";
import type {
  ExtensionWorkerInboundMessage,
  ExtensionWorkerMessage,
} from "../ui/services/ui-extension-worker";
import { useUIExtensionStore } from "../ui/stores/ui-extension-store";

const mocks = vi.hoisted(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: () => Promise.resolve([]),
    transformCallback: () => 0,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };

  return { invoke: vi.fn() };
});

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: mocks.invoke,
}));

enableMapSet();

type WorkerCall = Extract<ExtensionWorkerInboundMessage, { type: "worker-call" }>;

const NO_RESPONSE = Symbol("no-response");

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  static onActivate: (worker: FakeWorker) => void = (worker) =>
    queueMicrotask(() => worker.emit({ type: "event", event: "ready" }));
  static onCall: (call: WorkerCall) => unknown = () => undefined;

  posted: ExtensionWorkerInboundMessage[] = [];
  terminated = false;

  constructor(
    readonly scriptUrl: URL | string,
    readonly options?: WorkerOptions,
  ) {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: ExtensionWorkerInboundMessage) {
    this.posted.push(message);
    if (message.type === "activate") {
      FakeWorker.onActivate(this);
    } else if (message.type === "worker-call") {
      void this.answer(message);
    }
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: ExtensionWorkerMessage) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }

  fail(message: string) {
    this.dispatchEvent(Object.assign(new Event("error"), { message }));
  }

  workerCalls() {
    return this.posted.filter((message): message is WorkerCall => message.type === "worker-call");
  }

  lastWorkerCall() {
    const calls = this.workerCalls();
    return calls[calls.length - 1];
  }

  private async answer(call: WorkerCall) {
    await Promise.resolve();
    try {
      const result = await FakeWorker.onCall(call);
      if (result === NO_RESPONSE) return;
      this.emit({ type: "response", id: call.id, result });
    } catch (error) {
      this.emit({
        type: "response",
        id: call.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const loadedIds = new Set<string>();
let objectUrlCount = 0;
const revokedUrls: string[] = [];

function createManifest(id: string, overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  loadedIds.add(id);
  return {
    id,
    name: id,
    displayName: id,
    description: "UI integration",
    version: "1.0.0",
    publisher: "Athas",
    categories: ["UI"],
    main: "dist/index.js",
    ...overrides,
  };
}

function extensionState(extensionId: string) {
  return useUIExtensionStore.getState().extensions.get(extensionId);
}

async function loadWorkerExtension(id: string, overrides: Partial<ExtensionManifest> = {}) {
  const manifest = createManifest(id, overrides);
  await uiExtensionHost.loadExtension(manifest);
  return { manifest, worker: FakeWorker.instances[FakeWorker.instances.length - 1] };
}

function emitAndSettle(worker: FakeWorker, message: ExtensionWorkerMessage) {
  worker.emit(message);
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type AIProviderSettingsAction = ReturnType<typeof useAIProviderSettingsActions>[number];

function readSettingsActions(providerId: string): AIProviderSettingsAction[] {
  let actions: AIProviderSettingsAction[] = [];
  function Probe() {
    actions = useAIProviderSettingsActions(providerId);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return actions;
}

async function deliverDirectly(extensionId: string, message: ExtensionWorkerMessage) {
  const host = uiExtensionHost as unknown as {
    loaded: Map<string, unknown>;
    handleMessage: (loaded: unknown, message: ExtensionWorkerMessage) => Promise<void>;
  };
  return host.handleMessage(host.loaded.get(extensionId), message);
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.onActivate = (worker) =>
    queueMicrotask(() => worker.emit({ type: "event", event: "ready" }));
  FakeWorker.onCall = () => undefined;
  mocks.invoke.mockReset();
  objectUrlCount = 0;
  revokedUrls.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
  Object.assign(URL, {
    createObjectURL: () => `blob:extension-${++objectUrlCount}`,
    revokeObjectURL: (url: string) => revokedUrls.push(url),
  });
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_extension_entrypoint") {
      return `export function activate() { return ${JSON.stringify(args?.entrypoint)}; }`;
    }
    return null;
  });
});

afterEach(async () => {
  vi.useRealTimers();
  FakeWorker.onCall = () => undefined;
  for (const extensionId of loadedIds) {
    await uiExtensionHost.unloadExtension(extensionId);
    useUIExtensionStore.getState().actions.unregisterExtension(extensionId);
  }
  loadedIds.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("UI extension host loading", () => {
  it("activates declarative extensions without starting a worker", async () => {
    const manifest = createManifest("test.declarative", { main: undefined });

    await uiExtensionHost.loadExtension(manifest);
    await uiExtensionHost.loadExtension(manifest);

    expect(uiExtensionHost.isLoaded("test.declarative")).toBe(true);
    expect(extensionState("test.declarative")?.state).toBe("active");
    expect(FakeWorker.instances).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalledWith("read_extension_entrypoint", expect.anything());
  });

  it("runs the installed entrypoint in a dedicated worker", async () => {
    const { worker } = await loadWorkerExtension("test.worker");

    expect(mocks.invoke).toHaveBeenCalledWith("read_extension_entrypoint", {
      extensionId: "test.worker",
      entrypoint: "dist/index.js",
    });
    expect(worker.options).toEqual({ type: "module", name: "test.worker" });
    expect(worker.posted[0]).toEqual({
      type: "activate",
      entryPointUrl: "blob:extension-1",
      extensionId: "test.worker",
      compatibility: undefined,
    });
    expect(extensionState("test.worker")?.state).toBe("active");
    expect(uiExtensionHost.isLoaded("test.worker")).toBe(true);
  });

  it("loads each extension only once", async () => {
    const manifest = createManifest("test.once");

    await Promise.all([
      uiExtensionHost.loadExtension(manifest),
      uiExtensionHost.loadExtension(manifest),
    ]);

    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("marks generated extensions so the worker applies compatibility shims", async () => {
    const manifest = createManifest("test.generated");

    await uiExtensionHost.loadGeneratedExtension(manifest, "export const activate = () => {};");

    expect(mocks.invoke).not.toHaveBeenCalledWith("read_extension_entrypoint", expect.anything());
    expect(FakeWorker.instances[0].posted[0]).toMatchObject({
      type: "activate",
      extensionId: "test.generated",
      compatibility: "generated",
    });
  });

  it("tears the worker down when activation reports an error", async () => {
    FakeWorker.onActivate = (worker) =>
      queueMicrotask(() =>
        worker.emit({ type: "event", event: "activation.error", payload: { message: "boom" } }),
      );
    const manifest = createManifest("test.activation-error");

    await expect(uiExtensionHost.loadExtension(manifest)).rejects.toThrow("boom");

    expect(extensionState("test.activation-error")).toMatchObject({
      state: "error",
      error: "boom",
    });
    expect(uiExtensionHost.isLoaded("test.activation-error")).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(revokedUrls).toEqual(["blob:extension-1"]);
  });

  it("uses a generic message when activation fails without details", async () => {
    FakeWorker.onActivate = (worker) =>
      queueMicrotask(() => worker.emit({ type: "event", event: "activation.error" }));

    await expect(
      uiExtensionHost.loadExtension(createManifest("test.silent-error")),
    ).rejects.toThrow("Integration activation failed");
  });

  it("fails activation when the worker script errors", async () => {
    FakeWorker.onActivate = (worker) => queueMicrotask(() => worker.fail("SyntaxError: bad token"));

    await expect(
      uiExtensionHost.loadExtension(createManifest("test.worker-error")),
    ).rejects.toThrow("SyntaxError: bad token");
    expect(extensionState("test.worker-error")).toMatchObject({
      state: "error",
      error: "SyntaxError: bad token",
    });
  });

  it("ignores unrelated worker events while waiting for activation", async () => {
    FakeWorker.onActivate = (worker) =>
      queueMicrotask(() => {
        worker.emit({ type: "response", id: 99, result: null });
        worker.emit({
          type: "event",
          event: "views.invalidate",
          payload: { viewId: "test.patient.view" },
        });
        worker.emit({ type: "event", event: "ready" });
      });

    await uiExtensionHost.loadExtension(createManifest("test.patient"));

    expect(extensionState("test.patient")?.state).toBe("active");
  });

  it("times out extensions that never finish activating", async () => {
    vi.useFakeTimers();
    FakeWorker.onActivate = () => undefined;

    const loading = uiExtensionHost.loadExtension(createManifest("test.hung"));
    const assertion = expect(loading).rejects.toThrow("Integration activation timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(uiExtensionHost.isLoaded("test.hung")).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("reports entrypoint read failures without starting a worker", async () => {
    mocks.invoke.mockRejectedValue(new Error("Entrypoint escapes integration directory"));

    await expect(uiExtensionHost.loadExtension(createManifest("test.escape"))).rejects.toThrow(
      "Entrypoint escapes integration directory",
    );

    expect(FakeWorker.instances).toEqual([]);
    expect(extensionState("test.escape")).toMatchObject({
      state: "error",
      error: "Entrypoint escapes integration directory",
    });
    expect(uiExtensionHost.isLoaded("test.escape")).toBe(false);
  });

  it("records worker errors raised after activation", async () => {
    const { worker } = await loadWorkerExtension("test.crash");

    worker.fail("Worker crashed");

    expect(extensionState("test.crash")).toMatchObject({ state: "error", error: "Worker crashed" });
  });
});

describe("UI extension host contributions", () => {
  it("registers sidebar views and bumps their revision when invalidated", async () => {
    const { worker } = await loadWorkerExtension("test.views");

    await emitAndSettle(worker, {
      type: "event",
      event: "sidebar.registerView",
      payload: { id: "test.views.panel", title: "Panel", icon: "list", order: 3 },
    });
    await emitAndSettle(worker, {
      type: "event",
      event: "sidebar.registerView",
      payload: { id: "test.views.defaults", order: "first" },
    });

    const state = useUIExtensionStore.getState();
    expect(state.sidebarViews.get("test.views.panel")).toMatchObject({
      extensionId: "test.views",
      title: "Panel",
      icon: "list",
      order: 3,
    });
    expect(state.sidebarViews.get("test.views.panel")?.render()).toBeTruthy();
    expect(state.sidebarViews.get("test.views.defaults")).toMatchObject({
      title: "test.views.defaults",
      icon: "puzzle-piece",
      order: undefined,
    });

    await emitAndSettle(worker, {
      type: "event",
      event: "views.invalidate",
      payload: { viewId: "test.views.panel" },
    });
    expect(useUIExtensionStore.getState().viewRevisions.get("test.views.panel")).toBe(1);
  });

  it("rejects contributions that are not namespaced to the extension", async () => {
    await loadWorkerExtension("test.namespace");

    await expect(
      deliverDirectly("test.namespace", {
        type: "event",
        event: "sidebar.registerView",
        payload: { id: "athas.explorer" },
      }),
    ).rejects.toThrow("Integration contribution ids must start with test.namespace.");
    await expect(
      deliverDirectly("test.namespace", {
        type: "event",
        event: "commands.register",
        payload: { id: "test.namespace-evil.run" },
      }),
    ).rejects.toThrow(/must start with test\.namespace\./);

    const state = useUIExtensionStore.getState();
    expect(state.sidebarViews.has("athas.explorer")).toBe(false);
    expect(state.commands.has("test.namespace-evil.run")).toBe(false);
  });

  it("routes toolbar clicks to the worker and surfaces failures", async () => {
    const { worker } = await loadWorkerExtension("test.toolbar");
    await emitAndSettle(worker, {
      type: "event",
      event: "toolbar.registerAction",
      payload: { id: "test.toolbar.refresh", title: "Refresh", position: "left" },
    });
    await emitAndSettle(worker, {
      type: "event",
      event: "toolbar.registerAction",
      payload: { id: "test.toolbar.other", position: "top" },
    });

    const toolbarActions = useUIExtensionStore.getState().toolbarActions;
    expect(toolbarActions.get("test.toolbar.refresh")).toMatchObject({
      title: "Refresh",
      icon: "puzzle-piece",
      position: "left",
    });
    expect(toolbarActions.get("test.toolbar.other")?.position).toBe("right");

    FakeWorker.onCall = () => {
      throw new Error("Refresh failed");
    };
    toolbarActions.get("test.toolbar.refresh")!.onClick();

    await vi.waitFor(() =>
      expect(extensionState("test.toolbar")).toMatchObject({
        state: "error",
        error: "Refresh failed",
      }),
    );
    expect(worker.lastWorkerCall()).toMatchObject({
      method: "executeToolbarAction",
      params: ["test.toolbar.refresh"],
    });
  });

  it("executes registered commands inside the worker with their arguments", async () => {
    const { worker } = await loadWorkerExtension("test.commands");
    await emitAndSettle(worker, {
      type: "event",
      event: "commands.register",
      payload: { id: "test.commands.greet", title: "Greet", category: "Test" },
    });
    await emitAndSettle(worker, {
      type: "event",
      event: "commands.register",
      payload: { id: "test.commands.plain", category: 42 },
    });

    const commands = useUIExtensionStore.getState().commands;
    expect(commands.get("test.commands.greet")).toMatchObject({ title: "Greet", category: "Test" });
    expect(commands.get("test.commands.plain")).toMatchObject({
      title: "test.commands.plain",
      category: undefined,
    });

    await commands.get("test.commands.greet")!.execute("Ada", 3);

    expect(worker.lastWorkerCall()).toMatchObject({
      method: "executeCommand",
      params: ["test.commands.greet", "Ada", 3],
    });
  });

  it("opens dialogs with clamped dimensions and closes them on request", async () => {
    const { worker } = await loadWorkerExtension("test.dialogs");

    await emitAndSettle(worker, {
      type: "event",
      event: "dialogs.open",
      payload: { id: "test.dialogs.small", title: "Small", width: 10, height: 5000 },
    });
    await emitAndSettle(worker, {
      type: "event",
      event: "dialogs.open",
      payload: { id: "test.dialogs.auto", width: Number.NaN, height: "tall" },
    });

    const dialogs = useUIExtensionStore.getState().activeDialogs;
    expect(dialogs.find((dialog) => dialog.id === "test.dialogs.small")).toMatchObject({
      title: "Small",
      width: 320,
      height: 800,
    });
    expect(dialogs.find((dialog) => dialog.id === "test.dialogs.small")?.render()).toBeTruthy();
    expect(dialogs.find((dialog) => dialog.id === "test.dialogs.auto")).toMatchObject({
      title: "test.dialogs.auto",
      width: undefined,
      height: undefined,
    });

    await emitAndSettle(worker, {
      type: "event",
      event: "dialogs.close",
      payload: { id: "test.dialogs.small" },
    });

    expect(useUIExtensionStore.getState().activeDialogs.map((dialog) => dialog.id)).not.toContain(
      "test.dialogs.small",
    );
  });

  it("registers AI providers declared in the manifest and removes them on unload", async () => {
    const { worker } = await loadWorkerExtension("test.ai", {
      icon: "https://cdn.example.com/test-ai.svg",
      aiProviders: [
        {
          id: "test-ai-provider",
          name: "Test AI",
          apiUrl: "https://ai.example.com/v1",
          requiresApiKey: true,
          transport: "tauri",
          models: [{ id: "test-model", name: "Test Model", maxTokens: 8192 }],
        },
      ],
    });
    FakeWorker.onCall = (call) => call.method === "aiProvider.validateApiKey";

    await emitAndSettle(worker, {
      type: "event",
      event: "ai.registerProvider",
      payload: { providerId: "test-ai-provider" },
    });
    await emitAndSettle(worker, {
      type: "event",
      event: "commands.register",
      payload: { id: "test.ai.configure" },
    });
    await emitAndSettle(worker, {
      type: "event",
      event: "ai.registerSettingsAction",
      payload: {
        id: "test.ai.settings",
        commandId: "test.ai.configure",
        providerId: "test-ai-provider",
        description: "Choose a model",
        icon: "sparkles",
      },
    });

    const provider = getProvider("test-ai-provider");
    expect(provider).toBeDefined();
    await expect(provider!.validateApiKey("secret")).resolves.toBe(true);
    expect(worker.lastWorkerCall()).toMatchObject({
      method: "aiProvider.validateApiKey",
      params: ["test-ai-provider", "secret"],
    });

    const [settingsAction] = readSettingsActions("test-ai-provider");
    expect(settingsAction).toMatchObject({
      id: "test.ai.settings",
      label: "Provider settings",
      buttonLabel: "Configure",
      description: "Choose a model",
      icon: "sparkles",
    });
    await settingsAction.execute();
    expect(worker.lastWorkerCall()).toMatchObject({
      method: "executeCommand",
      params: ["test.ai.configure"],
    });

    await uiExtensionHost.unloadExtension("test.ai");

    expect(getProvider("test-ai-provider")).toBeUndefined();
    expect(readSettingsActions("test-ai-provider")).toEqual([]);
  });

  it("refuses AI providers the manifest does not declare", async () => {
    await loadWorkerExtension("test.ai-undeclared");

    await expect(
      deliverDirectly("test.ai-undeclared", {
        type: "event",
        event: "ai.registerProvider",
        payload: { providerId: "openai" },
      }),
    ).rejects.toThrow("Integration does not contribute AI provider openai");
    await expect(
      deliverDirectly("test.ai-undeclared", {
        type: "event",
        event: "ai.registerSettingsAction",
        payload: {
          id: "test.ai-undeclared.settings",
          commandId: "test.ai-undeclared.configure",
          providerId: "openai",
        },
      }),
    ).rejects.toThrow("Integration does not contribute AI provider openai");
    expect(getProvider("openai")?.id).not.toBe("test.ai-undeclared");
  });
});

describe("UI extension host requests", () => {
  it("answers host calls from the worker, including permission failures", async () => {
    const { worker } = await loadWorkerExtension("test.host-calls");

    await emitAndSettle(worker, {
      type: "host-call",
      id: 1,
      method: "storage.set",
      params: ["layout", { columns: 2 }],
    });
    await emitAndSettle(worker, {
      type: "host-call",
      id: 2,
      method: "storage.get",
      params: ["layout"],
    });
    await emitAndSettle(worker, {
      type: "host-call",
      id: 3,
      method: "secrets.get",
      params: ["token"],
    });

    const responses = worker.posted.filter((message) => message.type === "response");
    expect(responses).toEqual([
      { type: "response", id: 1, result: undefined },
      { type: "response", id: 2, result: { columns: 2 } },
      { type: "response", id: 3, error: "Integration does not have secrets permission" },
    ]);
  });

  it("renders views returned by the worker and rejects malformed ones", async () => {
    await loadWorkerExtension("test.render");
    FakeWorker.onCall = (call) =>
      call.params[0] === "test.render.ok"
        ? { type: "text", value: "Hello" }
        : { type: "not-a-node" };

    await expect(
      uiExtensionHost.renderView("test.render", "test.render.ok"),
    ).resolves.toMatchObject({ type: "text", value: "Hello" });
    await expect(uiExtensionHost.renderView("test.render", "test.render.bad")).rejects.toThrow();
  });

  it("forwards view actions and propagates worker errors", async () => {
    const { worker } = await loadWorkerExtension("test.view-actions");
    FakeWorker.onCall = (call) => {
      if (call.params[1] === "test.view-actions.fail") throw new Error("Action failed");
      return undefined;
    };

    await uiExtensionHost.executeViewAction(
      "test.view-actions",
      "test.view-actions.view",
      "test.view-actions.save",
      [{ name: "value" }],
    );
    expect(worker.lastWorkerCall()).toMatchObject({
      method: "executeViewAction",
      params: ["test.view-actions.view", "test.view-actions.save", { name: "value" }],
    });

    await expect(
      uiExtensionHost.executeViewAction(
        "test.view-actions",
        "test.view-actions.view",
        "test.view-actions.fail",
      ),
    ).rejects.toThrow("Action failed");
  });

  it("rejects requests to extensions without an active worker", async () => {
    await uiExtensionHost.loadExtension(createManifest("test.no-worker", { main: undefined }));

    await expect(uiExtensionHost.executeCommand("test.no-worker", "x")).rejects.toThrow(
      "Integration test.no-worker is not active",
    );
    await expect(uiExtensionHost.renderView("test.missing", "view")).rejects.toThrow(
      "Integration test.missing is not active",
    );
  });

  it("times out requests the worker never answers", async () => {
    await loadWorkerExtension("test.slow");
    FakeWorker.onCall = () => NO_RESPONSE;
    vi.useFakeTimers();

    const request = uiExtensionHost.executeCommand("test.slow", "test.slow.run");
    const assertion = expect(request).rejects.toThrow(
      "Integration request timed out: executeCommand",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});

describe("UI extension host unloading", () => {
  it("deactivates the worker, rejects pending requests, and clears contributions", async () => {
    const { worker } = await loadWorkerExtension("test.unload");
    await emitAndSettle(worker, {
      type: "event",
      event: "sidebar.registerView",
      payload: { id: "test.unload.panel" },
    });
    FakeWorker.onCall = (call) => (call.method === "deactivate" ? undefined : NO_RESPONSE);
    const pending = uiExtensionHost.renderView("test.unload", "test.unload.panel");
    const pendingAssertion = expect(pending).rejects.toThrow("Integration was unloaded");

    await uiExtensionHost.unloadExtension("test.unload");
    await pendingAssertion;

    expect(worker.workerCalls().map((call) => call.method)).toEqual(["renderView", "deactivate"]);
    expect(worker.terminated).toBe(true);
    expect(revokedUrls).toEqual(["blob:extension-1"]);
    expect(uiExtensionHost.isLoaded("test.unload")).toBe(false);
    expect(useUIExtensionStore.getState().sidebarViews.has("test.unload.panel")).toBe(false);
  });

  it("still unloads when the worker fails to deactivate", async () => {
    const { worker } = await loadWorkerExtension("test.stubborn");
    FakeWorker.onCall = () => {
      throw new Error("deactivate failed");
    };

    await uiExtensionHost.unloadExtension("test.stubborn");

    expect(worker.terminated).toBe(true);
    expect(uiExtensionHost.isLoaded("test.stubborn")).toBe(false);
  });

  it("ignores unload requests for extensions that are not loaded", async () => {
    await expect(uiExtensionHost.unloadExtension("test.never-loaded")).resolves.toBeUndefined();
  });

  it("can load an extension again after it was unloaded", async () => {
    const manifest = createManifest("test.reload");
    await uiExtensionHost.loadExtension(manifest);
    await uiExtensionHost.unloadExtension("test.reload");

    await uiExtensionHost.loadExtension(manifest);

    expect(FakeWorker.instances).toHaveLength(2);
    expect(uiExtensionHost.isLoaded("test.reload")).toBe(true);
  });
});
