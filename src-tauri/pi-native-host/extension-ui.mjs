import { randomUUID } from "node:crypto";

const UNSUPPORTED_THEME_RESULT = {
  success: false,
  error: "Theme control is not supported in Athas pi-native host.",
};

const defaultResultForMethod = (method) => {
  switch (method) {
    case "confirm":
      return false;
    case "select":
    case "input":
    case "editor":
      return undefined;
    default:
      return undefined;
  }
};

const permissionTypeForMethod = (method) => {
  switch (method) {
    case "confirm":
      return "confirm";
    case "select":
      return "select";
    case "editor":
      return "input";
    case "input":
    default:
      return "input";
  }
};

const createPermissionDescription = (method, title, detail) => {
  if (method === "confirm") {
    return detail ? `${title}\n\n${detail}` : title;
  }

  return detail ? `${title}: ${detail}` : title;
};

const buildPermissionEvent = (routeKey, requestId, method, payload) => {
  const title = payload.title ?? "Pi request";
  const detail =
    method === "confirm"
      ? (payload.message ?? "")
      : method === "editor"
        ? (payload.prefill ?? "")
        : (payload.placeholder ?? "");

  return {
    type: "permission_request",
    routeKey,
    requestId,
    permissionType: permissionTypeForMethod(method),
    resource: title,
    description: createPermissionDescription(method, title, detail),
    title,
    placeholder: payload.placeholder ?? null,
    defaultValue: payload.prefill ?? null,
    options: payload.options ?? null,
  };
};

const resolveResponseValue = (method, response) => {
  if (response.cancelled) {
    return defaultResultForMethod(method);
  }

  switch (method) {
    case "confirm":
      return Boolean(response.approved);
    case "select":
    case "input":
    case "editor":
      return response.approved ? response.value : undefined;
    default:
      return defaultResultForMethod(method);
  }
};

export function createExtensionUiBridge({ routeKey, emitEvent }) {
  const pending = new Map();

  const clearPending = (requestId, fallbackValue) => {
    const request = pending.get(requestId);
    if (!request) {
      return false;
    }

    pending.delete(requestId);
    request.cleanup();
    request.resolve(fallbackValue);
    return true;
  };

  const createDialog = (method, payload, opts = {}) =>
    new Promise((resolve) => {
      const requestId = randomUUID();
      let timeoutId;
      let abortHandler;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        if (opts.signal && abortHandler) {
          opts.signal.removeEventListener("abort", abortHandler);
        }
      };

      pending.set(requestId, {
        method,
        resolve,
        cleanup,
      });

      if (typeof opts.timeout === "number" && opts.timeout > 0) {
        timeoutId = setTimeout(() => {
          clearPending(requestId, defaultResultForMethod(method));
        }, opts.timeout);
      }

      if (opts.signal) {
        abortHandler = () => {
          clearPending(requestId, defaultResultForMethod(method));
        };
        opts.signal.addEventListener("abort", abortHandler, { once: true });
      }

      emitEvent(buildPermissionEvent(routeKey, requestId, method, payload));
    });

  return {
    uiContext: {
      select(title, options, opts) {
        return createDialog("select", { title, options }, opts);
      },
      confirm(title, message, opts) {
        return createDialog("confirm", { title, message }, opts);
      },
      input(title, placeholder, opts) {
        return createDialog("input", { title, placeholder }, opts);
      },
      notify() {},
      onTerminalInput() {
        return () => {};
      },
      setStatus() {},
      setWorkingMessage() {},
      setWidget() {},
      setFooter() {},
      setHeader() {},
      setTitle() {},
      custom() {
        return Promise.resolve(undefined);
      },
      pasteToEditor() {},
      setEditorText() {},
      getEditorText() {
        return "";
      },
      editor(title, prefill, opts) {
        return createDialog("editor", { title, prefill }, opts);
      },
      setEditorComponent() {},
      theme: {},
      getAllThemes() {
        return [];
      },
      getTheme() {
        return undefined;
      },
      setTheme() {
        return UNSUPPORTED_THEME_RESULT;
      },
      getToolsExpanded() {
        return false;
      },
      setToolsExpanded() {},
    },
    respond(requestId, response) {
      const request = pending.get(requestId);
      if (!request) {
        return false;
      }

      pending.delete(requestId);
      request.cleanup();
      request.resolve(resolveResponseValue(request.method, response));
      return true;
    },
    clear() {
      for (const [requestId, request] of pending.entries()) {
        pending.delete(requestId);
        request.cleanup();
        request.resolve(defaultResultForMethod(request.method));
      }
    },
  };
}
