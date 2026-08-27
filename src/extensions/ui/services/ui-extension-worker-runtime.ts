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
const postToHost = workerScope.postMessage.bind(workerScope);
const listenToHost = workerScope.addEventListener.bind(workerScope);
const views = new Map<string, () => unknown | Promise<unknown>>();
const commands = new Map<string, ExtensionHandler>();
const toolbarActions = new Map<string, ExtensionHandler>();
const viewInvalidationCounts = new Map<string, number>();
const viewInlineActionIds = new Map<string, Set<string>>();
const pending = new Map<number, PendingRequest>();
let nextRequestId = 1;
let nextInlineActionId = 1;
let operationQueue = Promise.resolve();
let renderContext:
  | { viewId: string; nextActionId: number; handlers: Map<string, ExtensionHandler> }
  | undefined;
let extensionModule: ExtensionModule | undefined;
let activeExtensionId = "";
let generatedCompatibility = false;

for (const capability of [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "WebTransport",
  "Worker",
  "SharedWorker",
  "importScripts",
  "postMessage",
  "close",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "onmessage",
  "onmessageerror",
  "indexedDB",
  "caches",
  "BroadcastChannel",
  "navigator",
  "location",
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
  postToHost({ type: "event", event, payload });
}

function hostCall(method: string, ...params: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, reject });
    postToHost({ type: "host-call", id, method, params });
  });
}

function action(command: string, ...args: unknown[]) {
  return { command: contributionId(command), args };
}

function contributionId(value: unknown): string {
  const id = String(value);
  if (!generatedCompatibility || id.startsWith(`${activeExtensionId}.`)) return id;
  return `${activeExtensionId}.${id}`;
}

function inlineAction(handler: ExtensionHandler) {
  const id = renderContext
    ? contributionId(
        `__generated.view.${renderContext.viewId}.inline.${renderContext.nextActionId++}`,
      )
    : contributionId(`__generated.inline.${nextInlineActionId++}`);
  if (renderContext) renderContext.handlers.set(id, handler);
  else commands.set(id, handler);
  return { command: id };
}

function invalidateView(viewId: unknown) {
  const id = contributionId(viewId);
  viewInvalidationCounts.set(id, (viewInvalidationCounts.get(id) ?? 0) + 1);
  sendEvent("views.invalidate", { viewId: id });
}

function disposeView(viewId: string) {
  views.delete(viewId);
  for (const commandId of viewInlineActionIds.get(viewId) ?? []) commands.delete(commandId);
  viewInlineActionIds.delete(viewId);
  viewInvalidationCounts.delete(viewId);
}

function childNodes(items: unknown[]): ExtensionViewNode[] {
  return items.flat(Infinity).filter(Boolean) as ExtensionViewNode[];
}

function legacyChildren(value: unknown): ExtensionViewNode[] {
  if (Array.isArray(value)) return childNodes(value);
  return value == null ? [] : childNodes([value]);
}

function legacyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(legacyText).join("");
  if (value == null) return "";
  if (typeof value === "object") return "";
  return String(value);
}

function treeItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((value) => {
    const item =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return {
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      description: typeof item.description === "string" ? item.description : undefined,
      meta: typeof item.meta === "string" ? item.meta : undefined,
      icon: typeof item.icon === "string" ? item.icon : undefined,
      badges: item.badges,
      expanded: item.expanded,
      onSelect:
        typeof item.onSelect === "function"
          ? inlineAction(item.onSelect as ExtensionHandler)
          : item.onSelect,
      children: item.children == null ? undefined : treeItems(item.children),
    };
  });
}

function isLegacyLayoutConfig(value: unknown): value is Record<string, unknown> {
  return (
    generatedCompatibility &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("type" in value) &&
    "children" in value
  );
}

const api = Object.freeze({
  sidebar: Object.freeze({
    registerView(config: {
      id: string;
      title?: string;
      icon?: string;
      order?: number;
      render: () => unknown | Promise<unknown>;
    }) {
      if (!config || typeof config.id !== "string" || typeof config.render !== "function") {
        throw new Error("sidebar.registerView requires id and render");
      }
      const id = contributionId(config.id);
      views.set(id, config.render);
      sendEvent("sidebar.registerView", {
        id,
        title: String(config.title || id),
        icon: String(config.icon || "puzzle-piece"),
        order: config.order,
      });
      return Object.freeze({ dispose: () => disposeView(id) });
    },
  }),
  toolbar: Object.freeze({
    registerAction(config: {
      id: string;
      title?: string;
      icon?: string;
      position?: "left" | "right";
      onClick: ExtensionHandler;
    }) {
      if (!config || typeof config.id !== "string" || typeof config.onClick !== "function") {
        throw new Error("toolbar.registerAction requires id and onClick");
      }
      const id = contributionId(config.id);
      toolbarActions.set(id, config.onClick);
      sendEvent("toolbar.registerAction", {
        id,
        title: String(config.title || id),
        icon: String(config.icon || "puzzle-piece"),
        position: config.position === "left" ? "left" : "right",
      });
      return Object.freeze({ dispose: () => toolbarActions.delete(id) });
    },
  }),
  dialog: Object.freeze({
    open(config: {
      id: string;
      title?: string;
      render: () => unknown | Promise<unknown>;
      width?: number;
      height?: number;
    }) {
      if (!config || typeof config.id !== "string" || typeof config.render !== "function") {
        throw new Error("dialog.open requires id and render");
      }
      const id = contributionId(config.id);
      views.set(id, config.render);
      sendEvent("dialogs.open", {
        id,
        title: String(config.title || id),
        width: config.width,
        height: config.height,
      });
    },
    close(dialogId: string) {
      const id = contributionId(dialogId);
      disposeView(id);
      sendEvent("dialogs.close", { id });
    },
  }),
  views: Object.freeze({
    invalidate: invalidateView,
  }),
  commands: Object.freeze({
    register(
      configOrId: { id: string; title?: string; category?: string; run: ExtensionHandler } | string,
      legacyTitle?: string,
      legacyHandler?: ExtensionHandler,
      legacyCategory?: string,
    ) {
      const config =
        typeof configOrId === "string"
          ? {
              id: configOrId,
              title: legacyTitle,
              category: legacyCategory,
              run: legacyHandler,
            }
          : configOrId;
      if (!config || typeof config.id !== "string" || typeof config.run !== "function") {
        throw new Error("commands.register requires id and run");
      }
      const id = contributionId(config.id);
      commands.set(id, config.run);
      sendEvent("commands.register", {
        id,
        title: String(config.title || id),
        category: config.category,
      });
      return Object.freeze({ dispose: () => commands.delete(id) });
    },
    execute(command: string, ...args: unknown[]) {
      const handler = commands.get(contributionId(command)) ?? commands.get(command);
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
  notifications: Object.freeze({
    show: (options: unknown) => hostCall("notifications.show", options),
  }),
  clipboard: Object.freeze({
    writeText: (text: string) => hostCall("clipboard.writeText", text),
  }),
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
    stack: (...items: unknown[]) => ({
      type: "stack",
      children:
        items.length === 1 && isLegacyLayoutConfig(items[0])
          ? legacyChildren((items[0] as Record<string, unknown>).children)
          : childNodes(items),
    }),
    row: (...items: unknown[]) => ({
      type: "row",
      children:
        items.length === 1 && isLegacyLayoutConfig(items[0])
          ? legacyChildren((items[0] as Record<string, unknown>).children)
          : childNodes(items),
    }),
    section: (title: string, ...items: unknown[]) => ({
      type: "section",
      title,
      children: childNodes(items),
    }),
    card: (config: Record<string, unknown> = {}, ...items: unknown[]) => ({
      type: "card",
      title: typeof config.title === "string" ? config.title : undefined,
      description: typeof config.description === "string" ? config.description : undefined,
      variant: config.variant,
      children:
        generatedCompatibility && items.length === 0
          ? legacyChildren(config.children)
          : childNodes(items),
    }),
    form: (config: Record<string, unknown> = {}, ...items: unknown[]) => ({
      type: "form",
      submitLabel: config.submitLabel,
      pendingLabel: config.pendingLabel,
      disabled: config.disabled,
      children: childNodes(items),
      onSubmit:
        typeof config.onSubmit === "function"
          ? inlineAction(config.onSubmit as ExtensionHandler)
          : config.onSubmit,
    }),
    text: (value: unknown, tone?: string) => {
      const config =
        generatedCompatibility && value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : null;
      return {
        type: "text",
        value: config ? legacyText(config.children) : String(value),
        tone: config && typeof config.tone === "string" ? config.tone : tone,
      };
    },
    badge: (label: unknown, tone?: string) => {
      const config =
        generatedCompatibility && label && typeof label === "object"
          ? (label as Record<string, unknown>)
          : null;
      return {
        type: "badge",
        label: config ? String(config.label ?? "") : String(label),
        tone: config && typeof config.tone === "string" ? config.tone : tone,
      };
    },
    metric: (options: { label: unknown; value: unknown; detail?: unknown; tone?: string }) => ({
      type: "metric",
      label: String(options.label),
      value: typeof options.value === "number" ? options.value : String(options.value),
      detail: options.detail == null ? undefined : String(options.detail),
      tone: options.tone,
    }),
    progress: (options: { value: unknown; label?: unknown; detail?: unknown }) => ({
      type: "progress",
      value: Number(options.value),
      label: options.label == null ? undefined : String(options.label),
      detail: options.detail == null ? undefined : String(options.detail),
    }),
    sparkline: (options: {
      label: unknown;
      values?: unknown[];
      detail?: unknown;
      tone?: unknown;
    }) => ({
      type: "sparkline",
      label: String(options.label),
      values: (options.values ?? []).map(Number),
      detail: options.detail == null ? undefined : String(options.detail),
      tone: options.tone,
    }),
    barChart: (options: { label?: unknown; items?: Array<Record<string, unknown>> }) => ({
      type: "barChart",
      label: options.label == null ? undefined : String(options.label),
      items: (options.items ?? []).map((item) => ({
        label: String(item.label ?? ""),
        value: Number(item.value),
        detail: item.detail == null ? undefined : String(item.detail),
        tone: item.tone,
      })),
    }),
    callout: (options: { title: unknown; description?: unknown; tone?: string }) => ({
      type: "callout",
      title: String(options.title),
      description: options.description == null ? undefined : String(options.description),
      tone: options.tone,
    }),
    table: (options: { columns?: unknown[]; rows?: unknown[][]; caption?: unknown }) => ({
      type: "table",
      columns: (options.columns ?? []).map(String),
      rows: (options.rows ?? []).map((row) =>
        row.map((value) => (typeof value === "number" ? value : String(value ?? ""))),
      ),
      caption: options.caption == null ? undefined : String(options.caption),
    }),
    code: (options: { value: unknown; language?: unknown; wrap?: boolean }) => ({
      type: "code",
      value: String(options.value),
      language: options.language == null ? undefined : String(options.language),
      wrap: options.wrap,
    }),
    diff: (options: {
      filePath: unknown;
      oldPath?: unknown;
      language?: unknown;
      lines?: Array<Record<string, unknown>>;
      truncated?: boolean;
    }) => ({
      type: "diff",
      filePath: String(options.filePath),
      oldPath: options.oldPath == null ? undefined : String(options.oldPath),
      language: options.language == null ? undefined : String(options.language),
      lines: (options.lines ?? []).map((line) => ({
        type: line.type,
        content: String(line.content ?? ""),
        oldLine: line.oldLine,
        newLine: line.newLine,
      })),
      truncated: options.truncated,
    }),
    activity: (options: { items?: Array<Record<string, unknown>> }) => ({
      type: "activity",
      items: (options.items ?? []).map((item) => ({
        title: String(item.title ?? ""),
        description: item.description == null ? undefined : String(item.description),
        meta: item.meta == null ? undefined : String(item.meta),
        state: item.state,
        icon: item.icon,
        onSelect:
          typeof item.onSelect === "function"
            ? inlineAction(item.onSelect as ExtensionHandler)
            : item.onSelect,
      })),
    }),
    button: (
      labelOrConfig: string | Record<string, unknown>,
      viewAction?: unknown,
      options: Record<string, unknown> = {},
    ) => {
      const config = typeof labelOrConfig === "object" ? labelOrConfig : null;
      const handler = config?.onClick;
      return {
        type: "button",
        label: config ? String(config.label ?? "") : labelOrConfig,
        pendingLabel: config?.pendingLabel ?? options.pendingLabel,
        action:
          typeof handler === "function"
            ? inlineAction(handler as ExtensionHandler)
            : (viewAction ?? config?.action),
        tone: config?.variant === "accent" ? "accent" : options.tone,
        disabled: config?.disabled ?? options.disabled,
      };
    },
    input: (options: Record<string, unknown>) => ({
      type: "input",
      name: options.name,
      required: options.required,
      label: options.label,
      value: options.value,
      placeholder: options.placeholder,
      inputType: options.inputType ?? options.type,
      disabled: options.readOnly === true || options.disabled === true,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
      onSubmit:
        typeof options.onSubmit === "function"
          ? inlineAction(options.onSubmit as ExtensionHandler)
          : options.onSubmit,
    }),
    textarea: (options: Record<string, unknown>) => ({
      type: "textarea",
      name: options.name,
      required: options.required,
      label: options.label,
      value: options.value,
      placeholder: options.placeholder,
      rows: options.rows,
      disabled: options.readOnly === true || options.disabled === true,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
      onSubmit:
        typeof options.onSubmit === "function"
          ? inlineAction(options.onSubmit as ExtensionHandler)
          : options.onSubmit,
    }),
    numberInput: (options: Record<string, unknown>) => ({
      type: "numberInput",
      name: options.name,
      required: options.required,
      label: options.label,
      value: options.value,
      placeholder: options.placeholder,
      min: options.min,
      max: options.max,
      step: options.step,
      disabled: options.readOnly === true || options.disabled === true,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
      onSubmit:
        typeof options.onSubmit === "function"
          ? inlineAction(options.onSubmit as ExtensionHandler)
          : options.onSubmit,
    }),
    select: (options: Record<string, unknown>) => ({
      type: "select",
      ...options,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
    }),
    toggle: (options: Record<string, unknown>) => ({
      type: "toggle",
      ...options,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
    }),
    checkbox: (options: Record<string, unknown>) => ({
      type: "checkbox",
      ...options,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
    }),
    choice: (options: Record<string, unknown>) => ({
      type: "choice",
      ...options,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
    }),
    tabs: (options: Record<string, unknown>) => ({
      type: "tabs",
      ...options,
      onChange:
        typeof options.onChange === "function"
          ? inlineAction(options.onChange as ExtensionHandler)
          : options.onChange,
    }),
    disclosure: (config: Record<string, unknown> = {}, ...items: unknown[]) => ({
      type: "disclosure",
      title: String(config.title ?? "Details"),
      description: config.description,
      open: config.open,
      children: childNodes(items),
      onChange:
        typeof config.onChange === "function"
          ? inlineAction(config.onChange as ExtensionHandler)
          : config.onChange,
    }),
    keyValue: (options: { items?: Array<Record<string, unknown>> }) => ({
      type: "keyValue",
      items: (options.items ?? []).map((item) => ({
        label: String(item.label ?? ""),
        value: typeof item.value === "number" ? item.value : String(item.value ?? ""),
        tone: item.tone,
        monospace: item.monospace,
      })),
    }),
    sectionHeader: (options: Record<string, unknown>) => ({
      type: "stack",
      children: childNodes([
        { type: "text", value: String(options.title ?? ""), tone: "default" },
        options.subtitle ? { type: "text", value: String(options.subtitle), tone: "muted" } : null,
        options.action,
      ]),
    }),
    list: (...items: unknown[]) => ({ type: "list", children: childNodes(items) }),
    tree: (options: Record<string, unknown>) => ({
      type: "tree",
      label: String(options.label ?? "Items"),
      items: treeItems(options.items),
    }),
    listItem: (options: Record<string, unknown>) => ({
      type: "listItem",
      title: String(options.title ?? ""),
      description:
        options.description == null && options.subtitle == null
          ? undefined
          : String(options.description ?? options.subtitle),
      meta: typeof options.meta === "string" ? options.meta : undefined,
      badges: options.badges,
      onSelect:
        typeof options.onSelect === "function"
          ? inlineAction(options.onSelect as ExtensionHandler)
          : options.onSelect,
    }),
    emptyState: (options: Record<string, unknown>) => ({
      type: "stack",
      children: childNodes([
        {
          type: "empty",
          message: String(options.title ?? "Nothing here"),
          description: options.description == null ? undefined : String(options.description),
        },
        options.action,
      ]),
    }),
    empty: (message: string, description?: string) => ({ type: "empty", message, description }),
    loading: (message?: string) => ({ type: "loading", message }),
    error: (message: string, description?: string) => ({ type: "error", message, description }),
    divider: () => ({ type: "divider" }),
  }),
});

async function respond(id: number, operation: () => unknown | Promise<unknown>) {
  try {
    postToHost({ type: "response", id, result: await operation() });
  } catch (error) {
    postToHost({
      type: "response",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

listenToHost("message", (event: MessageEvent<ExtensionWorkerInboundMessage>) => {
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
        activeExtensionId = message.extensionId;
        generatedCompatibility = message.compatibility === "generated";
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

  operationQueue = operationQueue.then(() =>
    respond(message.id, async () => {
      if (message.method === "renderView") {
        const viewId = String(message.params[0]);
        const render = views.get(viewId);
        if (!render) throw new Error(`Unknown extension view: ${message.params[0]}`);
        const nextRenderContext = {
          viewId,
          nextActionId: 1,
          handlers: new Map<string, ExtensionHandler>(),
        };
        renderContext = nextRenderContext;
        let view: unknown;
        try {
          view = await render();
        } finally {
          renderContext = undefined;
        }
        for (const commandId of viewInlineActionIds.get(viewId) ?? []) commands.delete(commandId);
        for (const [commandId, handler] of nextRenderContext.handlers) {
          commands.set(commandId, handler);
        }
        viewInlineActionIds.set(viewId, new Set(nextRenderContext.handlers.keys()));
        if (generatedCompatibility && typeof view === "string") {
          return { type: "text", value: view };
        }
        if (generatedCompatibility && Array.isArray(view)) {
          return { type: "stack", children: childNodes(view) };
        }
        return view;
      }
      if (message.method === "executeCommand") {
        const command = String(message.params[0]);
        const handler = commands.get(command) ?? commands.get(contributionId(command));
        if (!handler) throw new Error(`Unknown extension command: ${message.params[0]}`);
        return handler(...message.params.slice(1));
      }
      if (message.method === "executeViewAction") {
        const viewId = contributionId(message.params[0]);
        const command = String(message.params[1]);
        const handler = commands.get(command) ?? commands.get(contributionId(command));
        if (!handler) throw new Error(`Unknown extension command: ${message.params[1]}`);
        const invalidationCount = viewInvalidationCounts.get(viewId) ?? 0;
        const result = await handler(...message.params.slice(2));
        if ((viewInvalidationCounts.get(viewId) ?? 0) === invalidationCount) {
          invalidateView(viewId);
        }
        return result;
      }
      if (message.method === "executeToolbarAction") {
        const handler = toolbarActions.get(String(message.params[0]));
        if (!handler) throw new Error(`Unknown toolbar action: ${message.params[0]}`);
        return handler();
      }
      if (message.method === "deactivate") {
        return extensionModule?.deactivate?.();
      }
      throw new Error(`Unknown worker method: ${message.method}`);
    }),
  );
});

export {};
