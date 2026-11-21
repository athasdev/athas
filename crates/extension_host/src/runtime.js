// The worker side of a UI extension: the `api` object the extension's `activate(api)` receives
// and the message loop with the host (the original's `ui-extension-worker-runtime.ts`). It runs
// in QuickJS on the desktop and in a Web Worker in the browser; `host` carries the few things
// that differ (posting a message, timers, logging, loading the entry module).
(function (host) {
  "use strict";
  const postToHost = (message) => host.post(JSON.stringify(message));
  const views = new Map();
  const commands = new Map();
  const toolbarActions = new Map();
  const aiProviders = new Map();
  const viewInvalidationCounts = new Map();
  const viewInlineActionIds = new Map();
  const pending = new Map();
  const timers = new Map();
  let nextRequestId = 1;
  let nextInlineActionId = 1;
  let nextTimerId = 1;
  let operationQueue = Promise.resolve();
  let renderContext;
  let extensionModule;

  if (host.timers) {
    const schedule = (handler, delay, args, repeat) => {
      if (typeof handler !== "function") throw new TypeError("Timer handler must be a function");
      const id = nextTimerId++;
      const ms = Math.max(0, Number(delay) || 0);
      timers.set(id, { handler, args, repeat, ms });
      host.setTimer(id, ms);
      return id;
    };
    const clear = (id) => {
      if (timers.delete(id)) host.clearTimer(id);
    };
    const define = (name, value) =>
      Object.defineProperty(globalThis, name, { value, writable: false, configurable: false });
    define("setTimeout", (handler, delay, ...args) => schedule(handler, delay, args, false));
    define("setInterval", (handler, delay, ...args) => schedule(handler, delay, args, true));
    define("clearTimeout", clear);
    define("clearInterval", clear);
    define("queueMicrotask", (callback) => void Promise.resolve().then(callback));
    const write =
      (level) =>
      (...items) =>
        host.log(
          level,
          items
            .map((item) => {
              if (typeof item === "string") return item;
              try {
                return JSON.stringify(item);
              } catch {
                return String(item);
              }
            })
            .join(" "),
        );
    define(
      "console",
      Object.freeze({
        log: write("log"),
        info: write("info"),
        debug: write("debug"),
        warn: write("warn"),
        error: write("error"),
      }),
    );
  }

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

  function sendEvent(event, payload) {
    postToHost({ type: "event", event, payload });
  }

  function hostCall(method, ...params) {
    return new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pending.set(id, { resolve, reject });
      postToHost({ type: "host-call", id, method, params });
    });
  }

  function contributionId(value) {
    return String(value);
  }

  function action(command, ...args) {
    return { command: contributionId(command), args };
  }

  function inlineAction(handler) {
    const id = renderContext
      ? contributionId(
          `__generated.view.${renderContext.viewId}.inline.${renderContext.nextActionId++}`,
        )
      : contributionId(`__generated.inline.${nextInlineActionId++}`);
    if (renderContext) renderContext.handlers.set(id, handler);
    else commands.set(id, handler);
    return { command: id };
  }

  const maybeInline = (value) => (typeof value === "function" ? inlineAction(value) : value);

  function invalidateView(viewId) {
    const id = contributionId(viewId);
    viewInvalidationCounts.set(id, (viewInvalidationCounts.get(id) ?? 0) + 1);
    sendEvent("views.invalidate", { viewId: id });
  }

  function disposeView(viewId) {
    views.delete(viewId);
    for (const commandId of viewInlineActionIds.get(viewId) ?? []) commands.delete(commandId);
    viewInlineActionIds.delete(viewId);
    viewInvalidationCounts.delete(viewId);
  }

  function childNodes(items) {
    return items.flat(Infinity).filter(Boolean);
  }

  function treeItems(value) {
    if (!Array.isArray(value)) return [];
    return value.map((value) => {
      const item = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      return {
        id: String(item.id ?? ""),
        title: String(item.title ?? ""),
        description: typeof item.description === "string" ? item.description : undefined,
        meta: typeof item.meta === "string" ? item.meta : undefined,
        icon: typeof item.icon === "string" ? item.icon : undefined,
        badges: item.badges,
        expanded: item.expanded,
        onSelect: maybeInline(item.onSelect),
        children: item.children == null ? undefined : treeItems(item.children),
      };
    });
  }

  const layout = (type) =>
    (...items) => ({ type, children: childNodes(items) });

  const field = (type, options, extra) => ({
    type,
    name: options.name,
    required: options.required,
    label: options.label,
    value: options.value,
    placeholder: options.placeholder,
    ...extra,
    disabled: options.readOnly === true || options.disabled === true,
    onChange: maybeInline(options.onChange),
    onSubmit: maybeInline(options.onSubmit),
  });

  const spread = (type) => (options) => ({
    type,
    ...options,
    onChange: maybeInline(options.onChange),
  });

  const api = Object.freeze({
    sidebar: Object.freeze({
      registerView(config) {
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
      registerAction(config) {
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
      open(config) {
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
      close(dialogId) {
        const id = contributionId(dialogId);
        disposeView(id);
        sendEvent("dialogs.close", { id });
      },
    }),
    views: Object.freeze({ invalidate: invalidateView }),
    commands: Object.freeze({
      register(configOrId, legacyTitle, legacyHandler, legacyCategory) {
        const config =
          typeof configOrId === "string"
            ? {
                id: configOrId,
                title: legacyTitle,
                category: legacyCategory,
                palette: true,
                run: legacyHandler,
              }
            : configOrId;
        if (!config || typeof config.id !== "string" || typeof config.run !== "function") {
          throw new Error("commands.register requires id and run");
        }
        const id = contributionId(config.id);
        commands.set(id, config.run);
        if (config.palette !== false) {
          sendEvent("commands.register", {
            id,
            title: String(config.title || id),
            category: config.category,
          });
        }
        return Object.freeze({ dispose: () => commands.delete(id) });
      },
      execute(command, ...args) {
        const handler = commands.get(contributionId(command)) ?? commands.get(command);
        if (!handler) throw new Error(`Unknown integration command: ${command}`);
        return handler(...args);
      },
    }),
    http: Object.freeze({ request: (request) => hostCall("http.request", request) }),
    secrets: Object.freeze({
      get: (key) => hostCall("secrets.get", key),
      set: (key, value) => hostCall("secrets.set", key, value),
      delete: (key) => hostCall("secrets.delete", key),
    }),
    storage: Object.freeze({
      get: (key) => hostCall("storage.get", key),
      set: (key, value) => hostCall("storage.set", key, value),
      delete: (key) => hostCall("storage.delete", key),
    }),
    workspace: Object.freeze({ getCurrent: () => hostCall("workspace.getCurrent") }),
    notifications: Object.freeze({ show: (options) => hostCall("notifications.show", options) }),
    clipboard: Object.freeze({ writeText: (text) => hostCall("clipboard.writeText", text) }),
    opener: Object.freeze({ openExternal: (url) => hostCall("opener.openExternal", url) }),
    editor: Object.freeze({
      updateSettings: (settings) => hostCall("editor.updateSettings", settings),
      clearSettingOverrides: () => hostCall("editor.clearSettingOverrides"),
    }),
    settings: Object.freeze({
      get: (key) => hostCall("settings.get", key),
      set: (key, value) => hostCall("settings.set", key, value),
    }),
    ai: Object.freeze({
      registerProvider(config) {
        if (
          !config ||
          typeof config.id !== "string" ||
          typeof config.buildHeaders !== "function" ||
          typeof config.buildPayload !== "function" ||
          typeof config.validateApiKey !== "function"
        ) {
          throw new Error(
            "ai.registerProvider requires id, buildHeaders, buildPayload, and validateApiKey",
          );
        }
        aiProviders.set(config.id, config);
        sendEvent("ai.registerProvider", { providerId: config.id });
        return Object.freeze({ dispose: () => aiProviders.delete(config.id) });
      },
      registerSettingsAction(config) {
        if (!config || typeof config.id !== "string" || typeof config.commandId !== "string") {
          throw new Error("ai.registerSettingsAction requires id and commandId");
        }
        sendEvent("ai.registerSettingsAction", {
          ...config,
          id: contributionId(config.id),
          commandId: contributionId(config.commandId),
        });
      },
    }),
    ui: Object.freeze({
      action,
      screen: (config = {}, ...items) => ({ type: "screen", ...config, children: childNodes(items) }),
      stack: layout("stack"),
      row: layout("row"),
      section: (title, ...items) => ({ type: "section", title, children: childNodes(items) }),
      card: (config = {}, ...items) => ({
        type: "card",
        title: typeof config.title === "string" ? config.title : undefined,
        description: typeof config.description === "string" ? config.description : undefined,
        variant: config.variant,
        children: childNodes(items),
      }),
      form: (config = {}, ...items) => ({
        type: "form",
        submitLabel: config.submitLabel,
        pendingLabel: config.pendingLabel,
        disabled: config.disabled,
        children: childNodes(items),
        onSubmit: maybeInline(config.onSubmit),
      }),
      text: (value, tone) => ({ type: "text", value: String(value), tone }),
      badge: (label, tone) => ({ type: "badge", label: String(label), tone }),
      metric: (options) => ({
        type: "metric",
        label: String(options.label),
        value: typeof options.value === "number" ? options.value : String(options.value),
        detail: options.detail == null ? undefined : String(options.detail),
        tone: options.tone,
      }),
      progress: (options) => ({
        type: "progress",
        value: Number(options.value),
        label: options.label == null ? undefined : String(options.label),
        detail: options.detail == null ? undefined : String(options.detail),
      }),
      sparkline: (options) => ({
        type: "sparkline",
        label: String(options.label),
        values: (options.values ?? []).map(Number),
        detail: options.detail == null ? undefined : String(options.detail),
        tone: options.tone,
      }),
      barChart: (options) => ({
        type: "barChart",
        label: options.label == null ? undefined : String(options.label),
        items: (options.items ?? []).map((item) => ({
          label: String(item.label ?? ""),
          value: Number(item.value),
          detail: item.detail == null ? undefined : String(item.detail),
          tone: item.tone,
        })),
      }),
      callout: (options) => ({
        type: "callout",
        title: String(options.title),
        description: options.description == null ? undefined : String(options.description),
        tone: options.tone,
      }),
      table: (options) => ({
        type: "table",
        columns: (options.columns ?? []).map(String),
        rows: (options.rows ?? []).map((row) =>
          row.map((value) => (typeof value === "number" ? value : String(value ?? ""))),
        ),
        caption: options.caption == null ? undefined : String(options.caption),
      }),
      code: (options) => ({
        type: "code",
        value: String(options.value),
        language: options.language == null ? undefined : String(options.language),
        wrap: options.wrap,
      }),
      diff: (options) => ({
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
      activity: (options) => ({
        type: "activity",
        items: (options.items ?? []).map((item) => ({
          title: String(item.title ?? ""),
          description: item.description == null ? undefined : String(item.description),
          meta: item.meta == null ? undefined : String(item.meta),
          state: item.state,
          icon: item.icon,
          onSelect: maybeInline(item.onSelect),
        })),
      }),
      button: (labelOrConfig, viewAction, options = {}) => {
        const config = typeof labelOrConfig === "object" ? labelOrConfig : null;
        const handler = config?.onClick;
        return {
          type: "button",
          label: config ? String(config.label ?? "") : labelOrConfig,
          pendingLabel: config?.pendingLabel ?? options.pendingLabel,
          action:
            typeof handler === "function"
              ? inlineAction(handler)
              : (viewAction ?? config?.action),
          tone: config?.variant === "accent" ? "accent" : options.tone,
          disabled: config?.disabled ?? options.disabled,
        };
      },
      input: (options) =>
        field("input", options, { inputType: options.inputType ?? options.type }),
      textarea: (options) => field("textarea", options, { rows: options.rows }),
      numberInput: (options) =>
        field("numberInput", options, { min: options.min, max: options.max, step: options.step }),
      select: spread("select"),
      toggle: spread("toggle"),
      checkbox: spread("checkbox"),
      choice: spread("choice"),
      tabs: spread("tabs"),
      disclosure: (config = {}, ...items) => ({
        type: "disclosure",
        title: String(config.title ?? "Details"),
        description: config.description,
        open: config.open,
        children: childNodes(items),
        onChange: maybeInline(config.onChange),
      }),
      keyValue: (options) => ({
        type: "keyValue",
        items: (options.items ?? []).map((item) => ({
          label: String(item.label ?? ""),
          value: typeof item.value === "number" ? item.value : String(item.value ?? ""),
          tone: item.tone,
          monospace: item.monospace,
        })),
      }),
      sectionHeader: (options) => ({
        type: "stack",
        children: childNodes([
          { type: "text", value: String(options.title ?? ""), tone: "default" },
          options.subtitle ? { type: "text", value: String(options.subtitle), tone: "muted" } : null,
          options.action,
        ]),
      }),
      list: (...items) => ({ type: "list", children: childNodes(items) }),
      tree: (options) => ({
        type: "tree",
        label: String(options.label ?? "Items"),
        items: treeItems(options.items),
      }),
      listItem: (options) => ({
        type: "listItem",
        title: String(options.title ?? ""),
        description:
          options.description == null && options.subtitle == null
            ? undefined
            : String(options.description ?? options.subtitle),
        meta: typeof options.meta === "string" ? options.meta : undefined,
        badges: options.badges,
        onSelect: maybeInline(options.onSelect),
      }),
      emptyState: (options) => ({
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
      empty: (message, description) => ({ type: "empty", message, description }),
      loading: (message) => ({ type: "loading", message }),
      error: (message, description) => ({ type: "error", message, description }),
      divider: () => ({ type: "divider" }),
    }),
  });

  const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

  async function respond(id, operation) {
    try {
      postToHost({ type: "response", id, result: await operation() });
    } catch (error) {
      postToHost({ type: "response", id, error: errorMessage(error) });
    }
  }

  async function workerCall(message) {
    if (message.method === "renderView") {
      const viewId = String(message.params[0]);
      const render = views.get(viewId);
      if (!render) throw new Error(`Unknown integration view: ${message.params[0]}`);
      const nextRenderContext = { viewId, nextActionId: 1, handlers: new Map() };
      renderContext = nextRenderContext;
      let view;
      try {
        view = await render();
      } finally {
        renderContext = undefined;
      }
      for (const commandId of viewInlineActionIds.get(viewId) ?? []) commands.delete(commandId);
      for (const [commandId, handler] of nextRenderContext.handlers) commands.set(commandId, handler);
      viewInlineActionIds.set(viewId, new Set(nextRenderContext.handlers.keys()));
      return view;
    }
    if (message.method === "executeCommand") {
      const command = String(message.params[0]);
      const handler = commands.get(command) ?? commands.get(contributionId(command));
      if (!handler) throw new Error(`Unknown integration command: ${message.params[0]}`);
      return handler(...message.params.slice(1));
    }
    if (message.method === "executeViewAction") {
      const viewId = contributionId(message.params[0]);
      const command = String(message.params[1]);
      const handler = commands.get(command) ?? commands.get(contributionId(command));
      if (!handler) throw new Error(`Unknown integration command: ${message.params[1]}`);
      const invalidationCount = viewInvalidationCounts.get(viewId) ?? 0;
      const result = await handler(...message.params.slice(2));
      if ((viewInvalidationCounts.get(viewId) ?? 0) === invalidationCount) invalidateView(viewId);
      return result;
    }
    if (message.method === "executeToolbarAction") {
      const handler = toolbarActions.get(String(message.params[0]));
      if (!handler) throw new Error(`Unknown toolbar action: ${message.params[0]}`);
      return handler();
    }
    if (message.method.startsWith("aiProvider.")) {
      const providerId = String(message.params[0]);
      const provider = aiProviders.get(providerId);
      if (!provider) throw new Error(`Unknown external AI provider: ${providerId}`);
      const hook = message.method.slice("aiProvider.".length);
      const handler = provider[hook];
      if (typeof handler !== "function") {
        if (hook === "buildUrl") return undefined;
        if (hook === "getModels") return [];
        if (hook === "getSystemPromptContext") return "";
        throw new Error(`External AI provider ${providerId} does not implement ${hook}`);
      }
      return handler(...message.params.slice(1));
    }
    if (message.method === "deactivate") return extensionModule?.deactivate?.();
    throw new Error(`Unknown worker method: ${message.method}`);
  }

  function receive(data) {
    const message = typeof data === "string" ? JSON.parse(data) : data;
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
          extensionModule = await host.importModule(message.source, message.extensionId);
          if (typeof extensionModule.activate !== "function") {
            throw new Error("Integration must export activate(api)");
          }
          await extensionModule.activate(api);
          sendEvent("ready");
        } catch (error) {
          sendEvent("activation.error", { message: errorMessage(error) });
        }
      })();
      return;
    }
    operationQueue = operationQueue.then(() => respond(message.id, () => workerCall(message)));
  }

  function fireTimer(id) {
    const timer = timers.get(id);
    if (!timer) return;
    if (timer.repeat) host.setTimer(id, timer.ms);
    else timers.delete(id);
    timer.handler(...timer.args);
  }

  return { receive, fireTimer };
});
