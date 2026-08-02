import type { ExtensionViewNode } from "../types/extension-view";
import type { ExtensionWorkerInboundMessage } from "./ui-extension-worker";

interface ExtensionModule {
  activate?: (api: unknown) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

type ExtensionHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const views = new Map<string, () => ExtensionViewNode | Promise<ExtensionViewNode>>();
const commands = new Map<string, ExtensionHandler>();
const pending = new Map<number, PendingRequest>();
let nextRequestId = 1;
let extensionModule: ExtensionModule | undefined;

for (const capability of [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
  "Worker",
  "SharedWorker",
  "importScripts",
]) {
  try {
    Object.defineProperty(globalThis, capability, {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch {}
}

function sendEvent(event: string, payload?: Record<string, unknown>) {
  workerScope.postMessage({ type: "event", event, payload });
}

function hostCall(method: string, ...params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, reject });
    workerScope.postMessage({ type: "host-call", id, method, params });
  });
}

function action(command: string, ...args: unknown[]) {
  return { command, args };
}

function childNodes(items: unknown[]): ExtensionViewNode[] {
  return items.flat(Infinity).filter(Boolean) as ExtensionViewNode[];
}

const api = Object.freeze({
  sidebar: Object.freeze({
    registerView(config: {
      id: string;
      title?: string;
      icon?: string;
      order?: number;
      render: () => ExtensionViewNode | Promise<ExtensionViewNode>;
    }) {
      if (!config || typeof config.id !== "string" || typeof config.render !== "function") {
        throw new Error("sidebar.registerView requires id and render");
      }
      views.set(config.id, config.render);
      sendEvent("sidebar.registerView", {
        id: config.id,
        title: String(config.title || config.id),
        icon: String(config.icon || "puzzle-piece"),
        order: config.order,
      });
      return Object.freeze({ dispose: () => views.delete(config.id) });
    },
  }),
  views: Object.freeze({
    invalidate: (viewId: string) => sendEvent("views.invalidate", { viewId }),
  }),
  commands: Object.freeze({
    register(config: { id: string; title?: string; category?: string; run: ExtensionHandler }) {
      if (!config || typeof config.id !== "string" || typeof config.run !== "function") {
        throw new Error("commands.register requires id and run");
      }
      commands.set(config.id, config.run);
      sendEvent("commands.register", {
        id: config.id,
        title: String(config.title || config.id),
        category: config.category,
      });
      return Object.freeze({ dispose: () => commands.delete(config.id) });
    },
    execute(command: string, ...args: unknown[]) {
      const handler = commands.get(command);
      if (!handler) throw new Error(`Unknown extension command: ${command}`);
      return handler(...args);
    },
  }),
  http: Object.freeze({ request: (request: unknown) => hostCall("http.request", request) }),
  secrets: Object.freeze({
    get: (key: string) => hostCall("secrets.get", key),
    set: (key: string, value: string) => hostCall("secrets.set", key, value),
    delete: (key: string) => hostCall("secrets.delete", key),
  }),
  storage: Object.freeze({
    get: (key: string) => hostCall("storage.get", key),
    set: (key: string, value: unknown) => hostCall("storage.set", key, value),
    delete: (key: string) => hostCall("storage.delete", key),
  }),
  workspace: Object.freeze({ getCurrent: () => hostCall("workspace.getCurrent") }),
  opener: Object.freeze({
    openExternal: (url: string) => hostCall("opener.openExternal", url),
  }),
  ui: Object.freeze({
    action,
    screen: (config: Record<string, unknown> = {}, ...items: unknown[]) => ({
      type: "screen",
      ...config,
      children: childNodes(items),
    }),
    stack: (...items: unknown[]) => ({ type: "stack", children: childNodes(items) }),
    row: (...items: unknown[]) => ({ type: "row", children: childNodes(items) }),
    section: (title: string, ...items: unknown[]) => ({
      type: "section",
      title,
      children: childNodes(items),
    }),
    text: (value: unknown, tone?: string) => ({ type: "text", value: String(value), tone }),
    badge: (label: unknown, tone?: string) => ({ type: "badge", label: String(label), tone }),
    button: (label: string, viewAction: unknown, options: Record<string, unknown> = {}) => ({
      type: "button",
      label,
      action: viewAction,
      ...options,
    }),
    input: (options: Record<string, unknown>) => ({ type: "input", ...options }),
    list: (...items: unknown[]) => ({ type: "list", children: childNodes(items) }),
    listItem: (options: Record<string, unknown>) => ({ type: "listItem", ...options }),
    empty: (message: string, description?: string) => ({ type: "empty", message, description }),
    loading: (message?: string) => ({ type: "loading", message }),
    error: (message: string, description?: string) => ({ type: "error", message, description }),
    divider: () => ({ type: "divider" }),
  }),
});

async function respond(id: number, operation: () => unknown | Promise<unknown>) {
  try {
    workerScope.postMessage({ type: "response", id, result: await operation() });
  } catch (error) {
    workerScope.postMessage({
      type: "response",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

workerScope.addEventListener("message", (event: MessageEvent<ExtensionWorkerInboundMessage>) => {
  const message = event.data;
  if (message.type === "response") {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
    return;
  }

  if (message.type === "activate") {
    void (async () => {
      try {
        extensionModule = (await import(
          /* @vite-ignore */ message.entryPointUrl
        )) as ExtensionModule;
        if (typeof extensionModule.activate !== "function") {
          throw new Error("Extension must export activate(api)");
        }
        await extensionModule.activate(api);
        sendEvent("ready");
      } catch (error) {
        sendEvent("activation.error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return;
  }

  void respond(message.id, async () => {
    if (message.method === "renderView") {
      const render = views.get(String(message.params[0]));
      if (!render) throw new Error(`Unknown extension view: ${message.params[0]}`);
      return render();
    }
    if (message.method === "executeCommand") {
      const handler = commands.get(String(message.params[0]));
      if (!handler) throw new Error(`Unknown extension command: ${message.params[0]}`);
      return handler(...message.params.slice(1));
    }
    if (message.method === "deactivate") {
      return extensionModule?.deactivate?.();
    }
    throw new Error(`Unknown worker method: ${message.method}`);
  });
});

export {};
